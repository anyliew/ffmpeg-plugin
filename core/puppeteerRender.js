// core/puppeteerRender.js
// 共享的 HTML → PNG 渲染器。
// 设计参考 D:\Temp\Yunzai\renderers\puppeteer：单例浏览器复用（避免每次请求都冷启动 chromium），
// 并通过 browserInitPromise 防止并发重复启动；每渲染 N 次后重启浏览器，规避 chromium 越跑越慢。
//
// 字体：版本卡 / 帮助卡使用自带 @font-face（LXGW / Inconsolata / NotoEmoji）本地 TTF，
// 经 file:// 加载。截图前等待 document.fonts.ready，避免首帧偶发回退字体。
//
// 高度防护：chromium fullPage 截图存在 16384px 像素高度上限（超限会截断或失败），
// 长页面（如 #ff配置 全量详情）按内容高度自动下调 deviceScaleFactor。
import puppeteer from 'puppeteer'
import fs from 'node:fs/promises'
import path from 'node:path'
import { TEMP_DIR, cleanupStaleTemp } from './io.js'

let browser = null
let browserInitPromise = null
let renderCount = 0
// 每 N 次截图重启一次浏览器（同 Yunzai 渲染器的 restartNum 思路，避免内存累积导致生成变慢）
const RESTART_EVERY = 100
// chromium fullPage 截图像素高度安全上限（硬上限 16384，留余量）
const MAX_CAPTURE_PIXEL_HEIGHT = 16000

// 模块加载时清理一次 24h 前的陈旧临时文件（跨重启残留的图片/HTML 属于垃圾）
cleanupStaleTemp().catch(() => {})

async function createBrowser() {
  const b = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--no-zygote'],
  })
  b.on('disconnected', () => { browser = null })
  browser = b
  return b
}

async function getBrowser() {
  if (browser) return browser
  if (browserInitPromise) return browserInitPromise
  browserInitPromise = createBrowser()
  try {
    return await browserInitPromise
  } finally {
    browserInitPromise = null
  }
}

/**
 * 将 HTML 字符串渲染为 PNG 并返回路径。
 * @param {string} html
 * @param {object} [opts]
 * @param {number} [opts.width=1000] 视口宽度（用于整页截图）
 * @param {number} [opts.scale=2]    deviceScaleFactor（2-3 提高分辨率，抵消 QQ 压缩画质损失）；
 *        页面实际像素高度超过 MAX_CAPTURE_PIXEL_HEIGHT 时会自动下调，保证截图完整
 * @param {string|null} [opts.outputPath=null] 指定输出路径（如帮助缓存文件）；
 *        不指定则返回 temp/ffmpeg 下的临时文件，由调用方自行 delayedRemove。
 * @returns {Promise<string>} 生成的 PNG 路径
 */
export async function renderHtmlToImage(html, { width = 1000, scale = 2, outputPath = null } = {}) {
  const br = await getBrowser()
  await fs.mkdir(TEMP_DIR, { recursive: true })
  const id = `ffr_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const tmpHtml = path.join(TEMP_DIR, `${id}.html`)
  const finalPath = outputPath || path.join(TEMP_DIR, `${id}.png`)
  let page
  try {
    await fs.writeFile(tmpHtml, html, 'utf-8')
    page = await br.newPage()
    await page.setViewport({ width, height: 600, deviceScaleFactor: scale })
    await page.goto('file:///' + tmpHtml.replace(/\\/g, '/'), { waitUntil: 'networkidle0', timeout: 120000 })
    // 等自带字体加载完成，避免首帧回退字体（file:// 本地 TTF 通常很快，加一层兜底不阻塞）
    await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve())).catch(() => {})

    // 高度防护：内容像素高度超过 chromium 截图上限时自动降 scale（最低降到 1）
    const cssHeight = await page.evaluate(() => document.body.scrollHeight).catch(() => 0)
    const maxScale = cssHeight > 0 ? Math.floor(MAX_CAPTURE_PIXEL_HEIGHT / cssHeight) : scale
    if (maxScale < scale) {
      scale = Math.max(1, maxScale)
      await page.setViewport({ width, height: 600, deviceScaleFactor: scale })
      // 即使降到 scale 1 仍超硬上限（极端长内容）：截图会截断，给出告警便于定位
      if (cssHeight > MAX_CAPTURE_PIXEL_HEIGHT) {
        logger.warn(`[ffmpeg-plugin] 渲染内容过高 (${cssHeight}px) 超过截图上限 ${MAX_CAPTURE_PIXEL_HEIGHT}px，已降至最低 scale=${scale}，图片可能被截断`)
      }
    }

    await page.screenshot({ path: finalPath, type: 'png', fullPage: true })
    renderCount++
    if (renderCount % RESTART_EVERY === 0 && browser) {
      const old = browser
      browser = null
      old.close().catch(() => {})
    }
    return finalPath
  } finally {
    if (page) await page.close().catch(() => {})
    await fs.unlink(tmpHtml).catch(() => {})
  }
}

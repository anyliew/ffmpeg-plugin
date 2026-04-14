import { exec } from 'child_process'
import { promisify } from 'util'
import { promises as fs } from 'fs'
import path from 'path'
import puppeteer from 'puppeteer'

const execPromise = promisify(exec)

let segment
try {
  segment = (await import('icqq')).segment
} catch (e) {
  segment = global.segment || { image: (file) => `[CQ:image,file=${file}]` }
}

const TEMP_DIR = path.join(process.cwd(), 'temp', 'ffmpeg')
const PLUGIN_NAME = 'ffmpeg-plugin'
const OLD_FONT_PATH = path.join(process.cwd(), 'plugins', PLUGIN_NAME, 'font', 'uisdc.ttf')
const NEW_FONT_PATH = path.join(process.cwd(), 'plugins', PLUGIN_NAME, 'resources', 'font', 'fonts.ttf')
const HTML_TEMPLATE_PATH = path.join(process.cwd(), 'plugins', PLUGIN_NAME, 'resources', 'html', 'version.html')
const CSS_TEMPLATE_PATH = path.join(process.cwd(), 'plugins', PLUGIN_NAME, 'resources', 'html', 'version.css')

async function ensureTempDir() {
  await fs.mkdir(TEMP_DIR, { recursive: true })
  return TEMP_DIR
}

async function getFfmpegVersionInfo() {
  try {
    const { stdout } = await execPromise('ffmpeg -version')
    return stdout
  } catch (err) {
    throw new Error(`执行 ffmpeg -version 失败: ${err.message}`)
  }
}

function extractVersionNumber(versionOutput) {
  const match = versionOutput.match(/ffmpeg version\s+(\S+)/i)
  return match ? match[1] : '未知'
}

function extractFullConfigureString(versionOutput) {
  const match = versionOutput.match(/configuration:\s+(.+)/)
  return match ? match[1] : '未找到配置信息'
}

async function getGitLogDetailed(pluginDir) {
  try {
    await execPromise('git rev-parse --is-inside-work-tree', { cwd: pluginDir })
    const { stdout } = await execPromise(
      'git log -n 5 --pretty=format:"%h|%s|%an|%ad" --date=short',
      { cwd: pluginDir }
    )
    if (!stdout.trim()) return []
    return stdout.split('\n').map(line => {
      const [hash, title, author, date] = line.split('|')
      return { hash: hash || '未知', title: title || '无标题', author: author || '未知', date: date || '未知' }
    })
  } catch (err) {
    console.error('获取 Git 日志失败:', err.message)
    return []
  }
}

async function getFontDataUrl() {
  let fontPath = NEW_FONT_PATH
  try {
    await fs.access(fontPath)
  } catch {
    fontPath = OLD_FONT_PATH
  }
  try {
    const fontBuffer = await fs.readFile(fontPath)
    const base64 = fontBuffer.toString('base64')
    return `data:font/truetype;charset=utf-8;base64,${base64}`
  } catch (err) {
    console.error('读取字体文件失败，将使用系统默认字体:', err.message)
    return ''
  }
}

function buildCardsHtml(versionNumber, versionRaw, commits, fullConfigure) {
  const escapeHtml = (str) => {
    if (!str) return ''
    return str.replace(/[&<>]/g, (m) => {
      if (m === '&') return '&amp;'
      if (m === '<') return '&lt;'
      if (m === '>') return '&gt;'
      return m
    })
  }

  let baseVersionDesc = ''
  const stableMatch = versionRaw.match(/ffmpeg version\s+(\d+\.\d+)/i)
  if (stableMatch) {
    baseVersionDesc = `基于 FFmpeg ${stableMatch[1]} 构建`
  } else if (versionNumber.startsWith('N-') || versionNumber.includes('g') || versionNumber.includes('-')) {
    baseVersionDesc = `基于 FFmpeg git 开发版 (BtbN 自动构建)`
  } else {
    baseVersionDesc = `基于 FFmpeg 自定义构建`
  }

  const versionCard = `
    <div class="version-card">
      <div class="title">📦 FFmpeg 版本 · 运行时环境</div>
      <div class="content">
        <ul>
          <li><span class="strong">版本号:</span> ${escapeHtml(versionNumber)}</li>
          <li><span class="strong">构建说明:</span> ${escapeHtml(baseVersionDesc)}</li>
        </ul>
      </div>
    </div>
  `

  let commitsHtml = '<ul>'
  if (commits.length === 0) {
    commitsHtml += '<li>暂无提交记录</li>'
  } else {
    commits.forEach(c => {
      commitsHtml += `
        <li class="commit-item">
          <span class="commit-hash">${escapeHtml(c.hash)}</span>
          <div class="commit-title">${escapeHtml(c.title)}</div>
          <div class="commit-meta">👤 ${escapeHtml(c.author)} · 📅 ${escapeHtml(c.date)}</div>
        </li>
      `
    })
  }
  commitsHtml += '</ul>'
  const commitsCard = `
    <div class="version-card">
      <div class="title">📝 ffmpeg-plugin 插件更新记录 (最近5条)</div>
      <div class="content">
        ${commitsHtml}
      </div>
    </div>
  `

  const codecsCard = `
    <div class="version-card">
      <div class="title">🎬 FFmpeg 编解码库支持</div>
      <div class="content">
        <div class="codec-category"><h3>🎞️ 视频编码器</h3><div class="codec-list"><span class="codec-badge">H.264/AVC</span><span class="codec-badge">H.265/HEVC</span><span class="codec-badge">VP9</span><span class="codec-badge">AV1</span><span class="codec-badge">MPEG-4</span></div></div>
        <div class="codec-category"><h3>🎵 音频编码器</h3><div class="codec-list"><span class="codec-badge">AAC</span><span class="codec-badge">MP3</span><span class="codec-badge">Opus</span><span class="codec-badge">FLAC</span><span class="codec-badge">Vorbis</span></div></div>
        <div class="codec-category"><h3>⚡ 硬件加速</h3><div class="codec-list"><span class="codec-badge">VAAPI</span><span class="codec-badge">NVENC</span><span class="codec-badge">QSV</span><span class="codec-badge">AMF</span></div></div>
        <div class="codec-category"><h3>📦 封装格式</h3><div class="codec-list"><span class="codec-badge">MP4/MOV</span><span class="codec-badge">MKV</span><span class="codec-badge">WebM</span><span class="codec-badge">HLS</span></div></div>
      </div>
    </div>
  `

  // 处理编译配置参数：过滤移除 --enable- 前缀，并改为芯片布局
  const configOptions = fullConfigure.split(/\s+/).filter(opt => opt.trim().length > 0)
  let configChipsHtml = ''
  configOptions.forEach(opt => {
    let displayOpt = opt
    // 如果以 --enable- 开头，则移除该前缀
    if (displayOpt.startsWith('--enable-')) {
      displayOpt = displayOpt.substring(9) // 移除 '--enable-'
    }
    if (displayOpt.trim() === '') return
    configChipsHtml += `<span class="config-chip">${escapeHtml(displayOpt)}</span>`
  })

  const configCard = `
    <div class="version-card">
      <div class="title">🔧 FFmpeg 编译配置详情</div>
      <div class="content">
        <div class="config-chip-list">
          ${configChipsHtml}
        </div>
      </div>
    </div>
  `

  return versionCard + commitsCard + codecsCard + configCard
}

async function renderFinalHtml() {
  let htmlTemplate = await fs.readFile(HTML_TEMPLATE_PATH, 'utf8')
  let cssContent = await fs.readFile(CSS_TEMPLATE_PATH, 'utf8')

  const fontDataUrl = await getFontDataUrl()
  let fontFaceRule = ''
  if (fontDataUrl) {
    fontFaceRule = `
      @font-face {
        font-family: "FZB";
        src: url('${fontDataUrl}') format('truetype');
        font-weight: normal;
        font-style: normal;
      }
    `
  }

  const versionRaw = await getFfmpegVersionInfo()
  const versionNumber = extractVersionNumber(versionRaw)
  const fullConfigure = extractFullConfigureString(versionRaw)

  const rootDir = process.cwd()
  const pluginDir = path.join(rootDir, 'plugins', PLUGIN_NAME)
  let commits = []
  try {
    await fs.access(pluginDir)
    commits = await getGitLogDetailed(pluginDir)
  } catch (err) {
    console.error('插件目录访问失败:', err.message)
  }

  const cardsHtml = buildCardsHtml(versionNumber, versionRaw, commits, fullConfigure)
  const generateTime = new Date().toLocaleString('zh-CN', { hour12: false })

  let finalHtml = htmlTemplate
    .replace('{{CSS_CONTENT}}', cssContent)
    .replace('{{FONT_FACE_RULE}}', fontFaceRule)
    .replace('{{CARDS_PLACEHOLDER}}', cardsHtml)
    .replace('{{GENERATE_TIME}}', generateTime)

  return finalHtml
}

async function htmlToImageFile(html) {
  let browser = null
  const tempDir = await ensureTempDir()
  const tempFilePath = path.join(tempDir, `ffmpeg_info_${Date.now()}_${Math.random().toString(36).slice(2)}.webp`)

  try {
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: 'new'
    })
    const page = await browser.newPage()

    const viewportWidth = 800
    const deviceScaleFactor = 2

    await page.setViewport({ width: viewportWidth, height: 600, deviceScaleFactor })
    await page.setContent(html, { waitUntil: 'networkidle0' })

    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready
      }
    })
    await new Promise(resolve => setTimeout(resolve, 300))

    const bodyHeight = await page.evaluate(() => document.body.scrollHeight)
    await page.setViewport({ width: viewportWidth, height: bodyHeight + 20, deviceScaleFactor })

    await page.screenshot({
      path: tempFilePath,
      type: 'webp',
      quality: 95,
      fullPage: true
    })

    return tempFilePath
  } finally {
    if (browser) await browser.close()
  }
}

export class ffmpegVersion extends plugin {
  constructor() {
    super({
      name: 'FFmpeg版本查询',
      event: 'message',
      priority: 1000,
      rule: [
        {
          reg: /^#(ffmpeg版本|ff版本)$/i,
          fnc: 'getFfmpegInfo'
        }
      ]
    })
  }

  async getFfmpegInfo(e) {
    const waitMsg = await e.reply('🔍 正在查询 FFmpeg 信息，请稍候...', true)

    try {
      const finalHtml = await renderFinalHtml()
      const imagePath = await htmlToImageFile(finalHtml)

      await e.reply(segment.image(imagePath))

      setTimeout(async () => {
        try {
          await fs.unlink(imagePath)
        } catch (ignore) {}
      }, 5000)

      if (waitMsg && waitMsg.message_id) {
        try {
          await e.bot.sendApi('delete_msg', { message_id: waitMsg.message_id })
        } catch (ignore) {}
      }
    } catch (err) {
      logger.error('查询 FFmpeg 信息失败:', err)
      await e.reply(`❌ 查询失败: ${err.message}`, true)
    }
  }
}
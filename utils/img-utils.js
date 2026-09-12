/**
 * 图片处理通用工具库（基于 sharp）
 * 功能参考 nonebot-plugin-imagetools，移植到 Yunzai / Node 环境
 */
import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import axios from 'axios'
import sharp from 'sharp'
import { colorTable } from './color-table.js'

export const TEMP_DIR = path.join(process.cwd(), 'temp', 'ffmpeg')

/** 单张图片下载上限（MB） */
const MAX_DOWNLOAD_MB = 25
/** 单图最大边长 */
export const MAX_SIDE = 4000
/** 动图最多处理帧数 */
export const MAX_FRAMES = 150
/** GIF 输出大小上限（字节），超过自动缩减 */
const GIF_MAX_SIZE = 8 * 1024 * 1024
/** GIF 最小帧间隔（ms），低于该值多数播放器会按 100ms 处理 */
export const MIN_DELAY = 20

// ================= 目录 / 文件 =================

export async function ensureTempDir() {
  await fsp.mkdir(TEMP_DIR, { recursive: true })
  return TEMP_DIR
}

export function newTempFile(ext = '.png', prefix = 'img') {
  return path.join(TEMP_DIR, `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`)
}

export async function writeTemp(buffer, ext = '.png', prefix = 'img') {
  await ensureTempDir()
  const file = newTempFile(ext, prefix)
  await fsp.writeFile(file, buffer)
  return file
}

export async function removeFile(file) {
  if (!file) return
  try {
    await fsp.unlink(file)
  } catch {
    /* 忽略清理失败 */
  }
}

/** 延迟删除（兼容部分协议发送时异步读文件） */
export function delayedRemove(files, seconds = 60) {
  const list = (Array.isArray(files) ? files : [files]).filter(Boolean)
  if (!list.length) return
  setTimeout(() => {
    for (const f of list) removeFile(f)
  }, seconds * 1000).unref?.()
}

// ================= 网络 =================

async function downloadBuffer(url, maxMb = MAX_DOWNLOAD_MB) {
  const res = await axios({
    method: 'GET',
    url,
    responseType: 'arraybuffer',
    timeout: 60000,
    maxContentLength: maxMb * 1024 * 1024,
    maxBodyLength: maxMb * 1024 * 1024,
    headers: { 'User-Agent': 'Mozilla/5.0 ffmpeg-plugin' }
  })
  return Buffer.from(res.data)
}

/** 下载消息中的图片，返回 Buffer 数组 */
export async function downloadImages(urls, maxMb = MAX_DOWNLOAD_MB) {
  const out = []
  for (const url of urls) {
    out.push(await downloadBuffer(url, maxMb))
  }
  return out
}

export { downloadBuffer }

// ================= 颜色 =================

const HEX_RE = /^#?([0-9a-fA-F]{6})$/
const HEX3_RE = /^#?([0-9a-fA-F]{3})$/
const NUM_RE = /^(?:rgb)?\s*[（(]?\s*(\d{1,3})\s*[，,、\s]\s*(\d{1,3})\s*[，,、\s]\s*(\d{1,3})\s*[)）]?$/

/** 常用英文颜色名 */
const EN_COLORS = {
  black: '#000000', white: '#FFFFFF', red: '#FF0000', green: '#008000', blue: '#0000FF',
  yellow: '#FFFF00', cyan: '#00FFFF', magenta: '#FF00FF', gray: '#808080', grey: '#808080',
  silver: '#C0C0C0', maroon: '#800000', olive: '#808000', lime: '#00FF00', aqua: '#00FFFF',
  teal: '#008080', navy: '#000080', fuchsia: '#FF00FF', purple: '#800080', orange: '#FFA500',
  pink: '#FFC0CB', hotpink: '#FF69B4', deeppink: '#FF1493', crimson: '#DC143C',
  salmon: '#FA8072', coral: '#FF7F50', tomato: '#FF6347', gold: '#FFD700',
  khaki: '#F0E68C', lavender: '#E6E6FA', plum: '#DDA0DD', violet: '#EE82EE',
  orchid: '#DA70D6', thistle: '#D8BFD8', tan: '#D2B48C', beige: '#F5F5DC',
  brown: '#A52A2A', chocolate: '#D2691E', indigo: '#4B0082', ivory: '#FFFFF0',
  linen: '#FAF0E6', snow: '#FFFAFA', wheat: '#F5DEB3', azure: '#F0FFFF',
  skyblue: '#87CEEB', steelblue: '#4682B4', royalblue: '#4169E1', dodgerblue: '#1E90FF',
  lightblue: '#ADD8E6', darkblue: '#00008B', seagreen: '#2E8B57', springgreen: '#00FF7F',
  forestgreen: '#228B22', limegreen: '#32CD32', darkgreen: '#006400', turquoise: '#40E0D0',
  goldenrod: '#DAA520', darkred: '#8B0000', darkgray: '#A9A9A9', darkgrey: '#A9A9A9',
  lightgray: '#D3D3D3', lightgrey: '#D3D3D3', dimgray: '#696969', dimgrey: '#696969',
  whitesmoke: '#F5F5F5', ghostwhite: '#F8F8FF', mintcream: '#F5FFFA', oldlace: '#FDF5E6',
  seashell: '#FFF5EE', floralwhite: '#FFFAF0', aliceblue: '#F0F8FF', honeydew: '#F0FFF0',
  peachpuff: '#FFDAB9', moccasin: '#FFE4B5', papayawhip: '#FFEFD5', mistyrose: '#FFE4E1',
  slategray: '#708090', slategrey: '#708090', lightslategray: '#778899', cadetblue: '#5F9EA0',
  peru: '#CD853F', sienna: '#A0522D', sienna2: '#A0522D', firebrick: '#B22222'
}

/** 单字/口语颜色别名 */
const SHORT_ALIAS = {
  红: '红色', 绿: '绿色', 蓝: '蓝色', 黄: '黄色', 黑: '黑色', 白: '白色', 灰: '灰色',
  紫: '紫色', 橙: '橙色', 青: '青色', 金: '金色', 银: '银色',
  粉: '#FFC0CB', 棕: '#A52A2A', 褐: '#A52A2A', 天蓝: '#87CEEB', 淡红: '#FF6666',
  米白: '#F5F5DC', 藏青: '#000080', 浅灰: '#D3D3D3', 深灰: '#696969'
}

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16)
  }
}

/**
 * 解析颜色：支持 #66ccff / fff / rgb(1,2,3) / 1,2,3 / 中文名（红色）/ 英文名（red）
 * @returns {{r:number,g:number,b:number}|null}
 */
export function parseColor(input) {
  if (input == null) return null
  const arg = String(input).trim()
  if (!arg) return null

  let m = HEX_RE.exec(arg)
  if (m) return hexToRgb(m[1])
  m = HEX3_RE.exec(arg)
  if (m) {
    const [a, b, c] = m[1]
    return hexToRgb(`${a}${a}${b}${b}${c}${c}`)
  }
  m = NUM_RE.exec(arg)
  if (m) {
    const [r, g, b] = [+m[1], +m[2], +m[3]]
    if ([r, g, b].every((v) => v >= 0 && v <= 255)) return { r, g, b }
    return null
  }
  if (colorTable[arg]) return hexToRgb(colorTable[arg])
  // 简写别名：红 / 蓝 / 粉 ...
  if (SHORT_ALIAS[arg]) {
    const mapped = SHORT_ALIAS[arg]
    return mapped.startsWith('#') ? hexToRgb(mapped) : hexToRgb(colorTable[mapped] || '#000000')
  }
  const en = EN_COLORS[arg.toLowerCase()]
  if (en) return hexToRgb(en)
  return null
}

export const COLOR_TIPS = '请使用正确的颜色格式，如：#66ccff、red、红色、102,204,255'

// ================= 帧处理 =================

function clampDelay(delay) {
  const d = Math.round(Number(delay) || 100)
  if (!isFinite(d)) return 100
  return Math.min(65535, Math.max(MIN_DELAY, d))
}

/**
 * 读取图片（支持动图），拆分为帧
 * @returns {Promise<{frames:Buffer[], delays:number[], width:number, height:number, animated:boolean}>}
 */
export async function readFrames(buffer) {
  const meta = await sharp(buffer, { animated: true }).metadata()
  let pages = Math.max(1, meta.pages || 1)
  const width = meta.width || 0
  const fullHeight = meta.height || 0
  const pageHeight = meta.pageHeight || Math.round(fullHeight / pages) || fullHeight

  if (width > MAX_SIDE || pageHeight > MAX_SIDE) {
    throw new Error('图片尺寸过大，暂不支持处理')
  }

  let delays = Array.isArray(meta.delay) && meta.delay.length === pages ? meta.delay.slice() : null
  let indexes = Array.from({ length: pages }, (_, i) => i)

  // 帧数过多时均匀抽帧，并等比例放大帧间隔以保持总时长
  if (pages > MAX_FRAMES) {
    const ratio = pages / MAX_FRAMES
    indexes = Array.from({ length: MAX_FRAMES }, (_, i) => Math.floor(i * ratio))
    const base = delays || new Array(pages).fill(100)
    delays = indexes.map((i) => base[i] * ratio)
    pages = MAX_FRAMES
  }
  if (!delays) delays = new Array(pages).fill(100)

  if (pages <= 1) {
    return { frames: [buffer], delays: [100], width, height: pageHeight, animated: false }
  }

  const frames = []
  for (const i of indexes) {
    frames.push(await sharp(buffer, { page: i, pages: 1 }).png().toBuffer())
  }
  return { frames, delays: delays.map(clampDelay), width, height: pageHeight, animated: true }
}

/** 逐帧处理 */
export async function mapFrames(frames, fn) {
  const out = []
  for (let i = 0; i < frames.length; i++) {
    out.push(await fn(frames[i], i))
  }
  return out
}

/** 统一所有帧尺寸（居中补白），动图合成前必须调用 */
export async function unifySize(frames) {
  if (frames.length <= 1) return frames
  const sizes = []
  for (const f of frames) {
    const m = await sharp(f).metadata()
    sizes.push({ w: m.width, h: m.height })
  }
  const maxW = Math.max(...sizes.map((s) => s.w))
  const maxH = Math.max(...sizes.map((s) => s.h))
  if (sizes.every((s) => s.w === maxW && s.h === maxH)) return frames
  return mapFrames(frames, (f, i) =>
    sharp(f)
      .resize(maxW, maxH, { fit: 'contain', background: '#ffffff', withoutEnlargement: true })
      .png()
      .toBuffer()
  )
}

async function buildGif(frames, delays) {
  const d = frames.map((_, i) => clampDelay(delays?.[i]))
  return await sharp(frames, { join: { animated: true } })
    .gif({ delay: d, loop: 0, effort: 4 })
    .toBuffer()
}

/**
 * 输出为图片 Buffer
 * @returns {Promise<{buffer:Buffer, ext:string}>}
 */
export async function packFrames(frames, delays = [], animated = false) {
  if (!animated || frames.length <= 1) {
    return { buffer: await sharp(frames[0]).png().toBuffer(), ext: '.png' }
  }
  let list = await unifySize(frames)
  let out = await buildGif(list, delays)
  let guard = 0
  while (out.length > GIF_MAX_SIZE && guard < 3) {
    guard++
    if (list.length > 24) {
      // 抽帧减半
      const nextFrames = []
      const nextDelays = []
      for (let i = 0; i < list.length; i += 2) {
        nextFrames.push(list[i])
        nextDelays.push((Number(delays[i]) || 100) + (Number(delays[i + 1]) || 100))
      }
      list = nextFrames
      delays = nextDelays
    } else {
      // 缩小尺寸
      const m = await sharp(list[0]).metadata()
      const w = Math.max(32, Math.round(m.width * 0.75))
      list = await mapFrames(list, (f) => sharp(f).resize({ width: w }).png().toBuffer())
    }
    out = await buildGif(list, delays)
  }
  return { buffer: out, ext: '.gif' }
}

// ================= 基础图像处理算子 =================

const WHITE = '#ffffff'

export const ops = {
  /** 水平翻转 */
  flipH: () => (b) => sharp(b).flop().png().toBuffer(),
  /** 竖直翻转 */
  flipV: () => (b) => sharp(b).flip().png().toBuffer(),
  /** 灰度 */
  grey: () => (b) => sharp(b).grayscale().png().toBuffer(),
  /** 反相（反色） */
  invert: () => (b) => sharp(b).flatten({ background: WHITE }).negate().png().toBuffer(),
  /** 轮廓 */
  contour: () => (b) =>
    sharp(b).convolve({ width: 3, height: 3, kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1] }).png().toBuffer(),
  /** 浮雕 */
  emboss: () => (b) =>
    sharp(b)
      .convolve({ width: 3, height: 3, scale: 1, offset: 128, kernel: [-1, 0, 0, 0, 1, 0, 0, 0, 0] })
      .png()
      .toBuffer(),
  /** 锐化 */
  sharpen: () => (b) =>
    sharp(b).convolve({ width: 3, height: 3, kernel: [0, -1, 0, -1, 5, -1, 0, -1, 0] }).png().toBuffer(),
  /** 模糊 */
  blur: (sigma = 1.6) => (b) => sharp(b).blur(Math.min(100, Math.max(0.3, sigma))).png().toBuffer(),
  /** 像素化 */
  pixelate: (level = 8, size) => async (b) => {
    let w, h
    if (size) {
      w = size.width
      h = size.height
    } else {
      const m = await sharp(b).metadata()
      w = m.width
      h = m.height
    }
    const sw = Math.max(1, Math.round(w / level))
    const sh = Math.max(1, Math.round(h / level))
    return await sharp(b)
      .resize(sw, sh, { kernel: 'nearest', fit: 'fill' })
      .resize(w, h, { kernel: 'nearest' })
      .png()
      .toBuffer()
  },
  /**
   * 旋转（支持任意角度，自动扩展画布）
   */
  rotate: (angle = 90) => async (b) => {
    const a = ((Number(angle) % 360) + 360) % 360
    if (a % 360 === 0) return b
    if (a % 90 === 0) return await sharp(b).rotate(a, { background: WHITE }).png().toBuffer()

    const m = await sharp(b).metadata()
    const w = m.width
    const h = m.height
    const rad = (a * Math.PI) / 180
    const cos = Math.abs(Math.cos(rad))
    const sin = Math.abs(Math.sin(rad))
    const nw = Math.max(1, Math.round(w * cos + h * sin))
    const nh = Math.max(1, Math.round(w * sin + h * cos))

    const diag = Math.ceil(Math.hypot(w, h)) + 2
    const left = Math.floor((diag - w) / 2)
    const top = Math.floor((diag - h) / 2)
    const padded = await sharp(b)
      .extend({
        top,
        left,
        right: diag - w - left,
        bottom: diag - h - top,
        background: WHITE
      })
      .png()
      .toBuffer()
    const rotated = await sharp(padded).rotate(a, { background: WHITE }).png().toBuffer()
    const rm = await sharp(rotated).metadata()
    const ex = Math.max(0, Math.floor((rm.width - nw) / 2))
    const ey = Math.max(0, Math.floor((rm.height - nh) / 2))
    return await sharp(rotated)
      .extract({ left: ex, top: ey, width: Math.min(nw, rm.width), height: Math.min(nh, rm.height) })
      .png()
      .toBuffer()
  },
  /**
   * 缩放
   * @param {{width?:number,height?:number,ratio?:number}} opt
   */
  resize: (opt) => async (b) => {
    if (opt.ratio) {
      const m = await sharp(b).metadata()
      return await sharp(b)
        .resize({
          width: Math.max(1, Math.round(m.width * opt.ratio)),
          height: Math.max(1, Math.round(m.height * opt.ratio)),
          fit: 'fill'
        })
        .png()
        .toBuffer()
    }
    if (opt.width && opt.height) {
      return await sharp(b).resize(opt.width, opt.height, { fit: 'fill' }).png().toBuffer()
    }
    if (opt.width) return await sharp(b).resize({ width: opt.width }).png().toBuffer()
    if (opt.height) return await sharp(b).resize({ height: opt.height }).png().toBuffer()
    return b
  },
  /**
   * 裁剪：居中裁剪到指定尺寸/比例（原图小于目标时用白色补边）
   * @param {{width?:number,height?:number}} opt 至少提供宽或高
   */
  crop: (opt) => async (b) => {
    let tw = Math.max(1, Math.min(MAX_SIDE, Math.round(opt.width || 0)))
    let th = Math.max(1, Math.min(MAX_SIDE, Math.round(opt.height || 0)))
    if (!tw || !th) return b

    let cur = b
    const cm = await sharp(cur).metadata()
    // 原图小于目标：先补白到目标尺寸，再居中裁剪（避免拉伸变形）
    if (cm.width < tw || cm.height < th) {
      cur = await sharp(cur)
        .resize(Math.max(cm.width, tw), Math.max(cm.height, th), {
          fit: 'contain',
          background: WHITE,
          withoutEnlargement: true
        })
        .png()
        .toBuffer()
    }
    return await sharp(cur).resize(tw, th, { fit: 'cover', position: 'centre' }).png().toBuffer()
  },
  /**
   * 颜色滤镜：与原图做正片叠底混合
   */
  colorFilter: (color) => async (b) => {
    const { data, info } = await sharp(b).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const ch = info.channels
    const kr = color.r / 255
    const kg = color.g / 255
    const kb = color.b / 255
    for (let i = 0; i < data.length; i += ch) {
      data[i] = Math.round(data[i] * kr)
      data[i + 1] = Math.round(data[i + 1] * kg)
      data[i + 2] = Math.round(data[i + 2] * kb)
    }
    return await sharp(data, { raw: { width: info.width, height: info.height, channels: ch } })
      .png()
      .toBuffer()
  }
}

// ================= 生成类 =================

/** 纯色图 */
export async function solidColor(color, width = 500, height = 500) {
  return await sharp({
    create: {
      width: Math.max(1, Math.min(MAX_SIDE, width)),
      height: Math.max(1, Math.min(MAX_SIDE, height)),
      channels: 3,
      background: color
    }
  })
    .png()
    .toBuffer()
}

/** 线性渐变图 */
export async function gradientImage(colors, angle = 0, width = 500, height = 500) {
  const w = Math.max(1, Math.min(MAX_SIDE, width))
  const h = Math.max(1, Math.min(MAX_SIDE, height))
  const rad = (angle * Math.PI) / 180
  const tan = (v) => {
    const t = Math.tan(v)
    return Math.abs(t) < 1e-9 ? 0 : t
  }
  let dx, dy
  if (Math.hypot(w, h) * Math.cos(rad) <= w) {
    dy = h / 2
    dx = Math.abs(Math.cos(rad)) < 1e-9 ? 0 : dy / tan(rad)
    if (!isFinite(dx)) dx = 0
  } else {
    dx = w / 2
    dy = dx * tan(rad)
    if (!isFinite(dy)) dy = 0
  }

  const x0 = w / 2 - dx
  const y0 = h / 2 - dy
  const len2 = dx * dx + dy * dy
  const data = Buffer.alloc(w * h * 3)
  const stops = colors.length > 1 ? colors : [colors[0], colors[0]]

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let t = 0
      if (len2 > 0) t = ((x - x0) * dx + (y - y0) * dy) / len2
      t = Math.min(1, Math.max(0, t)) * (stops.length - 1)
      const i0 = Math.floor(t)
      const i1 = Math.min(stops.length - 1, i0 + 1)
      const f = t - i0
      const c0 = stops[i0]
      const c1 = stops[i1]
      const idx = (y * w + x) * 3
      data[idx] = Math.round(c0.r + (c1.r - c0.r) * f)
      data[idx + 1] = Math.round(c0.g + (c1.g - c0.g) * f)
      data[idx + 2] = Math.round(c0.b + (c1.b - c0.b) * f)
    }
  }
  return await sharp(data, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer()
}

const FONT_STACK =
  '"Microsoft YaHei","PingFang SC","Noto Sans CJK SC","Source Han Sans SC","WenQuanYi Micro Hei","Heiti SC",sans-serif'

function escapeHtml(str) {
  return String(str).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]))
}

/** 文本转图片：优先 puppeteer，失败回退 sharp SVG */
export async function textToImage(text, opt = {}) {
  const fontSize = opt.fontSize || 30
  const color = opt.color || '#1f2328'
  const background = opt.background || '#ffffff'
  const content = String(text)
    .replace(/\r\n/g, '\n')
    .replace(/\[br\]/gi, '\n')
  if (!content.trim()) throw new Error('请输入要转换的文字')

  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:${background};font-family:${FONT_STACK}}
  .wrapper{display:inline-block;padding:20px;background:${background};
    font-size:${fontSize}px;line-height:1.5;color:${color};white-space:pre-wrap;word-break:break-word;max-width:1000px}
  </style></head><body><div class="wrapper">${escapeHtml(content)}</div></body></html>`

  try {
    const puppeteer = (await import('puppeteer')).default
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: 'new'
    })
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 1100, height: 200, deviceScaleFactor: 2 })
      await page.setContent(html, { waitUntil: 'networkidle0' })
      const box = await page.evaluate(() => {
        const el = document.querySelector('.wrapper')
        const r = el.getBoundingClientRect()
        return { width: Math.ceil(r.width), height: Math.ceil(r.height) }
      })
      await page.setViewport({
        width: Math.max(10, box.width),
        height: Math.max(10, box.height),
        deviceScaleFactor: 2
      })
      return await page.screenshot({ type: 'png' })
    } finally {
      await browser.close().catch(() => {})
    }
  } catch (err) {
    logger?.warn?.(`[图片工具] puppeteer 渲染失败，回退 SVG: ${err.message}`)
  }

  // 回退：sharp + SVG
  const lines = content.split('\n')
  const lineHeight = Math.round(fontSize * 1.5)
  const width = Math.min(1000, Math.max(60, ...lines.map((l) => l.length * fontSize)) + 40)
  const height = lines.length * lineHeight + 40
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="${background}"/>
  <text font-family="Microsoft YaHei,sans-serif" font-size="${fontSize}" fill="${color}" xml:space="preserve">
  ${lines
    .map(
      (l, i) =>
        `<tspan x="20" y="${20 + fontSize + i * lineHeight}">${escapeHtml(l)}</tspan>`
    )
    .join('')}
  </text></svg>`
  return await sharp(Buffer.from(svg)).png().toBuffer()
}

// ================= 拼接 / 合成 =================

/** 居中放置到指定画布（等比缩放适配，不放大） */
export async function placeOnCanvas(buffer, width, height, background = WHITE) {
  return await sharp(buffer)
    .resize(width, height, { fit: 'contain', background, withoutEnlargement: true })
    .png()
    .toBuffer()
}

/** 网格切图：先居中正方形裁剪，再切成 n×n 块 */
export async function gridSplit(buffer, n) {
  const m = await sharp(buffer).metadata()
  const side = Math.min(m.width, m.height)
  const square = await sharp(buffer).resize(side, side, { fit: 'cover', position: 'centre' }).png().toBuffer()
  const a = Math.floor(side / n)
  const out = []
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const left = col * a
      const top = row * a
      const w = col === n - 1 ? side - left : a
      const h = row === n - 1 ? side - top : a
      out.push(await sharp(square).extract({ left, top, width: w, height: h }).png().toBuffer())
    }
  }
  return out
}

/**
 * 多图拼接 / 合成
 * @param {Array<{frames:Buffer[],delays:number[],animated:boolean,width:number,height:number}>} inputs
 * @param {'horizontal'|'vertical'|'gif'} mode
 */
export async function joinImages(inputs, mode = 'horizontal', delay = 100) {
  if (!inputs.length) throw new Error('至少需要 1 张图片')
  if (inputs.length < 2) throw new Error('图片拼接/合成至少需要 2 张图片')

  if (mode === 'gif') {
    const maxW = Math.max(...inputs.map((i) => i.width))
    const maxH = Math.max(...inputs.map((i) => i.height))
    const frames = []
    for (const input of inputs) {
      frames.push(await placeOnCanvas(input.frames[0], maxW, maxH))
    }
    const delays = new Array(frames.length).fill(clampDelay(delay))
    return await packFrames(frames, delays, true)
  }

  // 计算目标尺寸：横向取最小高度，纵向取最小宽度
  const target =
    mode === 'horizontal'
      ? Math.min(...inputs.map((i) => i.height))
      : Math.min(...inputs.map((i) => i.width))

  const maxFrames = Math.max(...inputs.map((i) => i.frames.length))
  const animated = inputs.some((i) => i.animated || i.frames.length > 1)
  const delays = inputs.find((i) => i.animated)?.delays || new Array(maxFrames).fill(100)

  const outFrames = []
  for (let f = 0; f < maxFrames; f++) {
    const parts = []
    for (const input of inputs) {
      const frame = input.frames[Math.min(f, input.frames.length - 1)]
      const resized =
        mode === 'horizontal'
          ? await sharp(frame).resize({ height: target }).png().toBuffer()
          : await sharp(frame).resize({ width: target }).png().toBuffer()
      parts.push(resized)
    }
    const sizes = []
    for (const p of parts) {
      const m = await sharp(p).metadata()
      sizes.push({ w: m.width, h: m.height })
    }
    const width = mode === 'horizontal' ? sizes.reduce((s, v) => s + v.w, 0) : Math.max(...sizes.map((s) => s.w))
    const height = mode === 'horizontal' ? Math.max(...sizes.map((s) => s.h)) : sizes.reduce((s, v) => s + v.h, 0)

    let canvas = sharp({
      create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } }
    }).png()
    let offset = 0
    const composites = parts.map((p, i) => {
      const pos =
        mode === 'horizontal' ? { left: offset, top: 0 } : { left: 0, top: offset }
      offset += mode === 'horizontal' ? sizes[i].w : sizes[i].h
      return { input: p, ...pos }
    })
    outFrames.push(await canvas.composite(composites).png().toBuffer())
  }

  if (!animated) {
    return { buffer: outFrames[0], ext: '.png' }
  }
  return await packFrames(outFrames, delays, true)
}

// ================= 其他 =================

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

export { sharp }

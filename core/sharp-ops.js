/**
 * 图片处理核心算子（基于 sharp）
 * 从原 utils/img-utils.js 抽出：帧拆分/重组、ops 算子、生成类、拼接/合成
 */
import sharp from 'sharp'
import { MIN_DELAY, MAX_SIDE, MAX_FRAMES, GIF_MAX_SIZE } from './io.js'

const WHITE = '#ffffff'

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

/** 逐帧处理（有限并发，避免大动图串行过慢） */
export async function mapFrames(frames, fn, concurrency = 8) {
  const out = new Array(frames.length)
  let cursor = 0
  async function worker() {
    while (cursor < frames.length) {
      const i = cursor++
      out[i] = await fn(frames[i], i)
    }
  }
  const n = Math.min(Math.max(1, concurrency), frames.length)
  await Promise.all(Array.from({ length: n }, () => worker()))
  return out
}

/** 统一所有帧尺寸（居中补白），动图合成前必须调用 */
export async function unifySize(frames) {
  if (frames.length <= 1) return frames
  // 并发获取各帧尺寸（原先串行，帧多时明显偏慢）
  const sizes = await mapFrames(frames, async (f) => {
    const m = await sharp(f).metadata()
    return { w: m.width, h: m.height }
  })
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

export const ops = {
  /** 水平翻转 */
  flipH: () => (b) => sharp(b).flop().png().toBuffer(),
  /** 竖直翻转 */
  flipV: () => (b) => sharp(b).flip().png().toBuffer(),
  /** 灰度 */
  grey: () => (b) => sharp(b).grayscale().png().toBuffer(),
  /** 反相（反色）：取反 RGB，alpha:false 保留透明通道不被反转 */
  invert: () => (b) => sharp(b).negate({ alpha: false }).png().toBuffer(),
  /** 轮廓 */
  contour: () => (b) =>
    sharp(b)
      .removeAlpha()
      .convolve({ width: 3, height: 3, kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1] })
      .png()
      .toBuffer(),
  /** 浮雕 */
  emboss: () => (b) =>
    sharp(b)
      .removeAlpha()
      .convolve({ width: 3, height: 3, scale: 1, offset: 128, kernel: [-1, 0, 0, 0, 1, 0, 0, 0, 0] })
      .png()
      .toBuffer(),
  /** 锐化 */
  sharpen: () => (b) =>
    sharp(b)
      .removeAlpha()
      .convolve({ width: 3, height: 3, kernel: [0, -1, 0, -1, 5, -1, 0, -1, 0] })
      .png()
      .toBuffer(),
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
   * 裁剪：居中裁剪到指定尺寸（原图小于目标时用白色补边）
   * 仅提供 width 时按原图比例算高度，仅提供 height 时按原图比例算宽度
   * @param {{width?:number,height?:number}} opt 至少提供宽或高之一
   */
  crop: (opt) => async (b) => {
    if (!opt) return b
    const m = await sharp(b).metadata()
    let tw = opt.width ? Math.max(1, Math.min(MAX_SIDE, Math.round(opt.width))) : 0
    let th = opt.height ? Math.max(1, Math.min(MAX_SIDE, Math.round(opt.height))) : 0
    // 单尺寸：按原图比例补全另一维度（避免塌成 1px）
    if (tw && !th) th = Math.max(1, Math.round((tw * m.height) / m.width))
    if (!tw && th) tw = Math.max(1, Math.round((th * m.width) / m.height))
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
   * 说明：保留 alpha 通道（透明区域不会被 removeAlpha 置为黑色）
   */
  colorFilter: (color) => async (b) => {
    const { data, info } = await sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const ch = info.channels
    const kr = color.r / 255
    const kg = color.g / 255
    const kb = color.b / 255
    for (let i = 0; i < data.length; i += ch) {
      data[i] = Math.round(data[i] * kr)
      data[i + 1] = Math.round(data[i + 1] * kg)
      data[i + 2] = Math.round(data[i + 2] * kb)
      // data[i + 3] 为 alpha，保持不变
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

/** 线性渐变图（全幅平滑过渡） */
export async function gradientImage(colors, angle = 0, width = 500, height = 500) {
  const w = Math.max(1, Math.min(MAX_SIDE, width))
  const h = Math.max(1, Math.min(MAX_SIDE, height))
  const rad = (angle * Math.PI) / 180
  // 梯度方向单位向量（角度 0 = 从左到右，90 = 从上到下）
  const gx = Math.cos(rad)
  const gy = Math.sin(rad)
  // 计算投影在四角的取值范围，保证渐变覆盖整幅而非半幅
  const corners = [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h]
  ]
  let pMin = Infinity
  let pMax = -Infinity
  for (const [cx, cy] of corners) {
    const p = cx * gx + cy * gy
    if (p < pMin) pMin = p
    if (p > pMax) pMax = p
  }
  const span = pMax - pMin || 1
  const data = Buffer.alloc(w * h * 3)
  const stops = colors.length > 1 ? colors : [colors[0], colors[0]]

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let t = ((x * gx + y * gy) - pMin) / span
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
  </style></head><body><div class="wrapper">${escapeHtmlLocal(content)}</div></body></html>`

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
        `<tspan x="20" y="${20 + fontSize + i * lineHeight}">${escapeHtmlLocal(l)}</tspan>`
    )
    .join('')}
  </text></svg>`
  return await sharp(Buffer.from(svg)).png().toBuffer()
}

// textToImage 内部使用的 HTML 转义（不依赖 io 模块，避免循环依赖）
function escapeHtmlLocal(str) {
  if (str == null) return ''
  return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]))
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

  // 取帧数最多的动图作为帧时序来源，并补齐到 maxFrames（避免长短动图拼接时后续帧失步）
  let delays = new Array(maxFrames).fill(100)
  const source = inputs
    .filter((i) => i.animated && Array.isArray(i.delays) && i.delays.length)
    .sort((a, b) => b.frames.length - a.frames.length)[0]
  if (source) {
    delays = source.delays.slice(0, maxFrames)
    const tail = delays[delays.length - 1] ?? 100
    while (delays.length < maxFrames) delays.push(tail)
  }

  // 预算各部分尺寸：同一输入各帧宽高比一致，尺寸只需算一次（原先每帧都做一次 metadata 读取）
  const sizes = []
  for (const input of inputs) {
    const first =
      mode === 'horizontal'
        ? await sharp(input.frames[0]).resize({ height: target }).png().toBuffer()
        : await sharp(input.frames[0]).resize({ width: target }).png().toBuffer()
    const m = await sharp(first).metadata()
    sizes.push({ w: m.width, h: m.height })
  }
  const width = mode === 'horizontal' ? sizes.reduce((s, v) => s + v.w, 0) : Math.max(...sizes.map((s) => s.w))
  const height = mode === 'horizontal' ? Math.max(...sizes.map((s) => s.h)) : sizes.reduce((s, v) => s + v.h, 0)

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

export { sharp }

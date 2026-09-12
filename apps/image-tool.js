import fs from 'fs'
import * as Img from '../utils/img-utils.js'

const { sharp, ops, parseColor, COLOR_TIPS } = Img

// ================= 参数解析 =================

const SIZE_RE = /^(\d{1,4})\s*[*xX,，]\s*(\d{1,4})$/
const SIZE_ONE_RE = /^(\d{1,4})\s*[*xX,，]\s*$|^\s*[*xX,，]\s*(\d{1,4})$/
const PERCENT_RE = /^(\d{1,3})%$/
const RATIO_RE = /^(\d{1,2})\s*[:：比]\s*(\d{1,2})$/

/** 解析缩放参数：100x100 / 100x / x100 / 50% */
function parseResize(arg) {
  const s = String(arg || '').trim()
  let m = PERCENT_RE.exec(s)
  if (m) return { ratio: Number(m[1]) / 100 }
  m = SIZE_RE.exec(s)
  if (m) return { width: Number(m[1]), height: Number(m[2]) }
  m = SIZE_ONE_RE.exec(s)
  if (m) {
    if (m[1]) return { width: Number(m[1]) }
    if (m[2]) return { height: Number(m[2]) }
  }
  return null
}

/** 解析裁剪参数：100x100 / 2:1 */
function parseCrop(arg, size) {
  const s = String(arg || '').trim()
  let m = SIZE_RE.exec(s)
  if (m) return { width: Number(m[1]), height: Number(m[2]) }
  m = RATIO_RE.exec(s)
  if (m) {
    const wp = Number(m[1])
    const hp = Number(m[2])
    if (!wp || !hp) return null
    const unit = Math.min((size?.width || 500) / wp, (size?.height || 500) / hp)
    return { width: Math.round(wp * unit), height: Math.round(hp * unit) }
  }
  return null
}

/** 解析变速参数：0.5x / 50% / 20fps / 0.05s */
function parseSpeed(arg) {
  const s = String(arg || '').trim().toLowerCase()
  const f = /^\d{0,3}(?:\.\d{1,3})?$/
  let m = /^(\d{0,3}(?:\.\d{1,3})?)\s*(?:x|X|倍速?)$/.exec(s)
  if (m && f.test(m[1])) return { type: 'rate', value: Number(m[1]) }
  m = /^(\d{0,3}(?:\.\d{1,3})?)%$/.exec(s)
  if (m) return { type: 'percent', value: Number(m[1]) }
  m = /^(\d{0,3}(?:\.\d{1,3})?)\s*fps$/.exec(s)
  if (m) return { type: 'fps', value: Number(m[1]) }
  m = /^(\d{0,3}(?:\.\d{1,3})?)\s*(m?)s$/.exec(s)
  if (m) return { type: 'second', value: Number(m[1]), ms: m[2] === 'm' }
  return null
}

function toSizeArgs(tokens) {
  // 从参数列表中挑出尺寸（第一个匹配尺寸格式的 token）
  for (let i = 0; i < tokens.length; i++) {
    const m = SIZE_RE.exec(tokens[i])
    if (m) return { width: Number(m[1]), height: Number(m[2]), index: i }
  }
  return null
}

// ================= 插件主体 =================

export class imageTool extends plugin {
  constructor() {
    super({
      name: '[ffmpeg-plugin]图片工具箱',
      dsc: '图片翻转/灰度/旋转/缩放/裁剪/滤镜、GIF 倒放变速合成、四宫格九宫格拼接、文字转图',
      event: 'message',
      priority: 320,
      rule: [
        // —— 基础图片处理 ——
        { reg: /^#?(水平翻转|左右翻转|镜像翻转|左翻|右翻)$/, fnc: 'flipHorizontal' },
        { reg: /^#?(竖直翻转|垂直翻转|上下翻转|上翻|下翻)$/, fnc: 'flipVertical' },
        { reg: /^#?(灰度图?|黑白图?|去色)$/, fnc: 'grey' },
        { reg: /^#?旋转\s*(-?\d{1,4}(?:\.\d+)?)\s*度?$/, fnc: 'rotate' },
        { reg: /^#?旋转$/, fnc: 'rotate' },
        { reg: /^#?缩放\s*(\S+)$/, fnc: 'resize' },
        { reg: /^#?裁剪\s*(\S+)$/, fnc: 'crop' },
        { reg: /^#?(反相|反色|负片)$/, fnc: 'invert' },
        { reg: /^#?轮廓$/, fnc: 'contour' },
        { reg: /^#?浮雕$/, fnc: 'emboss' },
        { reg: /^#?模糊\s*(\d{1,3}(?:\.\d+)?)?$/, fnc: 'blur' },
        { reg: /^#?锐化$/, fnc: 'sharpen' },
        { reg: /^#?(像素化|马赛克)\s*(\d{1,4})?$/, fnc: 'pixelate' },
        // —— 颜色 / 滤镜 ——
        { reg: /^#?(颜色滤镜|滤镜)\s*(.+)$/, fnc: 'colorFilter' },
        { reg: /^#?纯色图?\s*(.+)$/, fnc: 'colorImage' },
        { reg: /^#?渐变图?\s*(.+)$/, fnc: 'gradientImage' },
        // —— GIF ——
        { reg: /^#?(gif)?倒放$/i, fnc: 'gifReverse' },
        { reg: /^#?(gif)?正放倒放$/i, fnc: 'gifObverseReverse' },
        { reg: /^#?(gif)?变速\s*(\S+)$/i, fnc: 'gifChangeSpeed' },
        { reg: /^#?(gif)?合成\s*(\d{1,5})?$/i, fnc: 'gifJoin' },
        // —— 网格 / 拼接 ——
        { reg: /^#?四宫格$/, fnc: 'fourGrid' },
        { reg: /^#?九宫格$/, fnc: 'nineGrid' },
        { reg: /^#?(横向拼接|横向合成|横向合并)$/, fnc: 'horizontalJoin' },
        { reg: /^#?(纵向拼接|竖向拼接|纵向合成|纵向合并)$/, fnc: 'verticalJoin' },
        // —— 文字转图 ——
        { reg: /^#?(文字转图|文字成图|文转图|文字生成图片)\s*([\s\S]+)$/, fnc: 'text2Image' },
        { reg: /^#?(文字转图|文字成图|文转图|文字生成图片)$/, fnc: 'text2Image' }
      ]
    })
  }

  // ================= 消息 / 图片获取 =================

  msgSegments(raw) {
    if (!raw) return []
    if (Array.isArray(raw)) return raw
    if (Array.isArray(raw.message)) return raw.message
    if (Array.isArray(raw.segments)) return raw.segments
    return []
  }

  imageSegments(raw) {
    return this.msgSegments(raw).filter((s) => s && s.type === 'image')
  }

  /** 获取被引用/回复的消息段 */
  async getQuotedSegments(e) {
    if (typeof e.getReply === 'function') {
      try {
        const raw = await e.getReply()
        const segs = this.msgSegments(raw)
        if (segs.length) return segs
      } catch {
        /* 忽略，走下面的兜底 */
      }
    }

    let replyId = e.reply_id
    if (!replyId) {
      for (const seg of e.message || []) {
        if (seg.type === 'reply' && seg.id) {
          replyId = seg.id
          break
        }
      }
    }
    if (replyId) {
      try {
        const raw = await e.bot.sendApi('get_msg', { message_id: replyId })
        const segs = this.msgSegments(raw)
        if (segs.length) return segs
      } catch {
        /* 忽略 */
      }
    }
    if (e.source && e.group) {
      try {
        const msgs = await e.group.getChatHistory(e.source.seq, 1)
        const raw = Array.isArray(msgs) ? msgs.pop() : msgs
        const segs = this.msgSegments(raw)
        if (segs.length) return segs
      } catch {
        /* 忽略 */
      }
    }
    return []
  }

  /** 解析图片段下载链接 */
  async resolveUrl(seg, e) {
    const data = seg.data || {}
    const direct = seg.url || data.url
    if (direct && /^https?:\/\//i.test(direct)) return direct
    if (direct && typeof direct === 'string' && direct.startsWith('base64://')) {
      return { base64: direct.slice(9) }
    }
    const fileId = data.file_id || data.fileId || data.file_key
    if (!fileId) throw new Error('无法获取图片下载地址（缺少 url / file_id）')
    const isGroup = !!(e.isGroup || e.group_id)
    const api = isGroup ? 'get_group_file_url' : 'get_private_file_url'
    const params = isGroup
      ? { group_id: e.group_id || e.group?.group_id, file_id: fileId }
      : { user_id: e.user_id, file_id: fileId }
    const res = await e.bot.sendApi(api, params)
    const url = res?.url || res?.file_url
    if (!url) throw new Error('获取图片下载链接失败')
    return url
  }

  /** 收集图片 Buffer：优先引用消息，其次当前消息 */
  async collectImages(e, min = 1) {
    let segs = this.imageSegments(await this.getQuotedSegments(e))
    if (segs.length < min) {
      const cur = this.imageSegments(e.message)
      if (cur.length > segs.length) segs = cur
    }
    if (!segs.length) return []
    const list = []
    for (const seg of segs) {
      const url = await this.resolveUrl(seg, e)
      if (typeof url === 'object' && url.base64) {
        list.push(Buffer.from(url.base64, 'base64'))
      } else {
        list.push(await Img.downloadBuffer(url))
      }
    }
    return list
  }

  // ================= 结果发送 =================

  async sendImage(e, buffer, ext = '.png') {
    const file = await Img.writeTemp(buffer, ext)
    try {
      await e.reply(segment.image(file))
    } finally {
      Img.delayedRemove(file, 90)
    }
  }

  /** 多图发送：合并转发优先，失败逐张发送 */
  async sendImages(e, buffers, title = '图片助手') {
    const files = []
    for (const b of buffers) files.push(await Img.writeTemp(b, '.png'))
    try {
      const uin = String(e.bot?.uin || e.self_id || 10000)
      const build = (contentOf) =>
        files.map((f) => ({
          type: 'node',
          data: { name: title, uin, content: contentOf(f) }
        }))
      const params = {
        messages: build((f) => [{ type: 'image', data: { file: `file://${f}` } }])
      }
      if (e.isGroup || e.group_id) params.group_id = e.group_id || e.group?.group_id
      else params.user_id = e.user_id
      try {
        await e.bot.sendApi('send_forward_msg', params)
        return
      } catch (err) {
        logger.warn(`[图片工具] 合并转发(file://)失败，尝试 base64: ${err.message}`)
      }
      params.messages = build((f) => [
        { type: 'image', data: { file: `base64://${fs.readFileSync(f).toString('base64')}` } }
      ])
      await e.bot.sendApi('send_forward_msg', params)
    } catch (err) {
      logger.warn(`[图片工具] 合并转发失败，改为逐张发送: ${err.message}`)
      for (const f of files) await e.reply(segment.image(f))
    } finally {
      Img.delayedRemove(files, 90)
    }
  }

  // ================= 通用处理流程 =================

  /** 统一异常兜底 */
  async guard(e, fn) {
    try {
      return await fn()
    } catch (err) {
      logger.error(`[图片工具] 处理失败: ${err.stack || err.message}`)
      await e.reply(`❌ ${err.message || '处理失败'}`, true).catch(() => {})
      return true
    }
  }

  /** 取第一张图片（支持动图） */
  async firstImage(e) {
    const buffers = await this.collectImages(e, 1)
    if (!buffers.length) return null
    return await Img.readFrames(buffers[0])
  }

  /** 单图处理通用流程 */
  async processSingle(e, tip, makeOp) {
    return await this.guard(e, async () => {
      const img = await this.firstImage(e)
      if (!img) {
        await e.reply('❌ 请回复/引用一张图片，或直接发送图片 + 命令', true)
        return true
      }
      if (img.animated && img.frames.length > 30) {
        await e.reply(`⏳ 正在${tip}（共 ${img.frames.length} 帧），请稍候...`, true)
      }
      const op = await makeOp(img)
      const frames = await Img.mapFrames(img.frames, op)
      const { buffer, ext } = await Img.packFrames(frames, img.delays, img.animated)
      await this.sendImage(e, buffer, ext)
      return true
    })
  }

  /** 取文本参数（去掉命令前缀） */
  argOf(e, cmdRe) {
    const m = cmdRe.exec(e.msg || '')
    if (m && m[1] != null) return String(m[1]).trim()
    return ''
  }

  // ================= 基础图片处理 =================

  async flipHorizontal(e) {
    return await this.processSingle(e, '水平翻转', () => ops.flipH())
  }

  async flipVertical(e) {
    return await this.processSingle(e, '竖直翻转', () => ops.flipV())
  }

  async grey(e) {
    return await this.processSingle(e, '转灰度图', () => ops.grey())
  }

  async invert(e) {
    return await this.processSingle(e, '反相处理', () => ops.invert())
  }

  async contour(e) {
    return await this.processSingle(e, '轮廓处理', () => ops.contour())
  }

  async emboss(e) {
    return await this.processSingle(e, '浮雕处理', () => ops.emboss())
  }

  async sharpen(e) {
    return await this.processSingle(e, '锐化处理', () => ops.sharpen())
  }

  async rotate(e) {
    const raw = this.argOf(e, /^#?旋转\s*(-?\d{1,4}(?:\.\d+)?)/)
    const angle = raw === '' ? 90 : Number(raw)
    if (!isFinite(angle)) {
      await e.reply('❌ 请使用正确的角度，如：#旋转 90', true)
      return true
    }
    return await this.processSingle(e, `旋转 ${angle}°`, () => ops.rotate(angle))
  }

  async resize(e) {
    const arg = this.argOf(e, /^#?缩放\s*(\S+)/)
    if (!arg) {
      await e.reply('❌ 请使用正确的尺寸格式，如：#缩放 100x100、#缩放 100x、#缩放 50%', true)
      return true
    }
    const opt = parseResize(arg)
    if (!opt) {
      await e.reply('❌ 请使用正确的尺寸格式，如：#缩放 100x100、#缩放 100x、#缩放 50%', true)
      return true
    }
    return await this.processSingle(e, '缩放', () => ops.resize(opt))
  }

  async crop(e) {
    const arg = this.argOf(e, /^#?裁剪\s*(\S+)/)
    if (!arg) {
      await e.reply('❌ 请使用正确的裁剪格式，如：#裁剪 100x100、#裁剪 2:1', true)
      return true
    }
    let opt = null
    return await this.processSingle(e, '裁剪', (img) => {
      opt = parseCrop(arg, { width: img.width, height: img.height })
      if (!opt) throw new Error('请使用正确的裁剪格式，如：#裁剪 100x100、#裁剪 2:1')
      return ops.crop({ width: opt.width, height: opt.height })
    })
  }

  async blur(e) {
    const raw = this.argOf(e, /^#?模糊\s*(\d{1,3}(?:\.\d+)?)/)
    const sigma = raw === '' ? 1.6 : Number(raw)
    return await this.processSingle(e, '模糊处理', () => ops.blur(sigma))
  }

  async pixelate(e) {
    const raw = this.argOf(e, /^#?(?:像素化|马赛克)\s*(\d{1,4})/)
    let level = raw === '' ? 8 : Number(raw)
    if (!isFinite(level) || level < 1) level = 8
    return await this.processSingle(e, '像素化', (img) =>
      ops.pixelate(Math.min(200, Math.max(1, Math.round(level))), { width: img.width, height: img.height })
    )
  }

  // ================= 颜色 / 滤镜 =================

  async colorFilter(e) {
    const arg = this.argOf(e, /^#?(?:颜色滤镜|滤镜)\s*(.+)$/)
    if (!arg) {
      await e.reply(`❌ ${COLOR_TIPS}`, true)
      return true
    }
    const color = parseColor(arg)
    if (!color) {
      await e.reply(`❌ ${COLOR_TIPS}`, true)
      return true
    }
    return await this.processSingle(e, '颜色滤镜处理', () => ops.colorFilter(color))
  }

  async colorImage(e) {
    return await this.guard(e, async () => {
      const arg = this.argOf(e, /^#?纯色图?\s*(.+)$/)
      if (!arg) {
        await e.reply(`❌ 用法：#纯色图 颜色 [尺寸]，如：#纯色图 red、#纯色图 #66ccff 500x500\n${COLOR_TIPS}`, true)
        return true
      }
      const tokens = arg.split(/\s+/).filter(Boolean)
      const size = toSizeArgs(tokens)
      let colorArg = tokens.find((t, i) => i !== size?.index)
      if (!colorArg) {
        await e.reply(`❌ ${COLOR_TIPS}`, true)
        return true
      }
      const color = parseColor(colorArg)
      if (!color) {
        await e.reply(`❌ 无法识别颜色「${colorArg}」\n${COLOR_TIPS}`, true)
        return true
      }
      const buffer = await Img.solidColor(color, size?.width || 500, size?.height || 500)
      await this.sendImage(e, buffer)
      return true
    })
  }

  async gradientImage(e) {
    return await this.guard(e, async () => {
      const arg = this.argOf(e, /^#?渐变图?\s*(.+)$/)
      if (!arg) {
        await e.reply(
          '❌ 用法：#渐变图 [方向/角度] 颜色1 颜色2 ...\n例：#渐变图 上下 红 蓝、#渐变图 45 #66ccff #ff66cc',
          true
        )
        return true
      }
      const tokens = arg.split(/\s+/).filter(Boolean)
      let angle = 0
      if (/^(上下|竖直|纵向)$/.test(tokens[0])) {
        angle = 90
        tokens.shift()
      } else if (/^(左右|水平|横向)$/.test(tokens[0])) {
        angle = 0
        tokens.shift()
      } else if (/^\d{1,3}$/.test(tokens[0])) {
        angle = Number(tokens.shift())
      }

      const size = toSizeArgs(tokens)
      if (size) tokens.splice(size.index, 1)

      const colors = []
      for (const t of tokens) {
        const c = parseColor(t)
        if (!c) {
          await e.reply(`❌ 无法识别颜色「${t}」\n${COLOR_TIPS}`, true)
          return true
        }
        colors.push(c)
      }
      if (!colors.length) {
        await e.reply('❌ 请至少指定 1 个颜色，例：#渐变图 上下 红 蓝', true)
        return true
      }
      const buffer = await Img.gradientImage(colors, angle, size?.width || 500, size?.height || 500)
      await this.sendImage(e, buffer)
      return true
    })
  }

  // ================= GIF =================

  /** GIF 类功能统一入口：校验动图 */
  async withGif(e, tip, fn) {
    return await this.guard(e, async () => {
      const img = await this.firstImage(e)
      if (!img) {
        await e.reply('❌ 请回复/引用一张 GIF 动图，或直接发送 GIF + 命令', true)
        return true
      }
      if (!img.animated || img.frames.length < 2) {
        await e.reply('❌ 该功能仅支持 GIF 动图（当前图片只有 1 帧）', true)
        return true
      }
      if (img.frames.length > 40) {
        await e.reply(`⏳ 正在${tip}（共 ${img.frames.length} 帧），请稍候...`, true)
      }
      return await fn(img)
    })
  }

  async gifReverse(e) {
    return await this.withGif(e, '倒放', async (img) => {
      const frames = img.frames.slice().reverse()
      const delays = img.delays.slice().reverse()
      const { buffer, ext } = await Img.packFrames(frames, delays, true)
      await this.sendImage(e, buffer, ext)
      return true
    })
  }

  async gifObverseReverse(e) {
    return await this.withGif(e, '正放倒放', async (img) => {
      const frames = img.frames.concat(img.frames.slice(0, -1).reverse())
      const delays = img.delays.concat(img.delays.slice(0, -1).reverse())
      const { buffer, ext } = await Img.packFrames(frames, delays, true)
      await this.sendImage(e, buffer, ext)
      return true
    })
  }

  async gifChangeSpeed(e) {
    const arg = this.argOf(e, /^#?(?:gif)?变速\s*(\S+)$/i)
    if (!arg) {
      await e.reply('❌ 请使用正确的倍率格式，如：#gif变速 0.5x、50%、20FPS、0.05s', true)
      return true
    }
    const parsed = parseSpeed(arg)
    if (!parsed) {
      await e.reply('❌ 请使用正确的倍率格式，如：#gif变速 0.5x、50%、20FPS、0.05s', true)
      return true
    }
    return await this.withGif(e, '变速', async (img) => {
      // 以平均帧间隔（秒）为基准换算
      const avg = img.delays.reduce((s, d) => s + d, 0) / img.delays.length / 1000
      let duration = avg
      if (parsed.type === 'rate') duration = avg / parsed.value
      else if (parsed.type === 'percent') duration = avg / (parsed.value / 100)
      else if (parsed.type === 'fps') duration = 1 / parsed.value
      else if (parsed.type === 'second') duration = parsed.ms ? parsed.value / 1000 : parsed.value

      if (!isFinite(duration) || duration <= 0) {
        await e.reply('❌ 倍率不合法', true)
        return true
      }
      if (duration < 0.02) {
        await e.reply(
          `❌ 帧间隔必须大于 0.02s（即 ≤ 50 FPS），\n超过该限制可能导致 GIF 播放速度异常。\n当前帧间隔为 ${duration.toFixed(3)}s（${(1 / duration).toFixed(1)} FPS）`,
          true
        )
        return true
      }
      const delays = img.delays.map(() => Math.round(duration * 1000))
      const { buffer, ext } = await Img.packFrames(img.frames, delays, true)
      await this.sendImage(e, buffer, ext)
      return true
    })
  }

  async gifJoin(e) {
    return await this.guard(e, async () => {
      const raw = this.argOf(e, /^#?(?:gif)?合成\s*(\d{1,5})?$/i)
      const delay = raw ? Number(raw) : 100
      const buffers = await this.collectImages(e, 2)
      if (buffers.length < 2) {
        await e.reply('❌ GIF 合成至少需要 2 张图片，请一次发送多张图片或引用含多图的消息', true)
        return true
      }
      if (buffers.length > 60) {
        await e.reply('❌ 一次最多合成 60 张图片', true)
        return true
      }
      const inputs = []
      for (const b of buffers) {
        const meta = await sharp(b).metadata()
        inputs.push({
          frames: [await sharp(b, { page: 0 }).png().toBuffer()],
          delays: [100],
          animated: false,
          width: meta.width,
          height: meta.pageHeight || meta.height
        })
      }
      const { buffer, ext } = await Img.joinImages(inputs, 'gif', delay)
      await this.sendImage(e, buffer, ext)
      return true
    })
  }

  // ================= 网格 / 拼接 =================

  async fourGrid(e) {
    return await this.gridHandler(e, 2)
  }

  async nineGrid(e) {
    return await this.gridHandler(e, 3)
  }

  async gridHandler(e, n) {
    return await this.guard(e, async () => {
      const buffers = await this.collectImages(e, 1)
      if (!buffers.length) {
        await e.reply('❌ 请回复/引用一张图片，或直接发送图片 + 命令', true)
        return true
      }
      const parts = await Img.gridSplit(buffers[0], n)
      await this.sendImages(e, parts, n === 2 ? '四宫格' : '九宫格')
      return true
    })
  }

  async joinHandler(e, mode) {
    return await this.guard(e, async () => {
      const buffers = await this.collectImages(e, 2)
      if (buffers.length < 2) {
        await e.reply('❌ 图片拼接至少需要 2 张图片，请一次发送多张图片或引用含多图的消息', true)
        return true
      }
      if (buffers.length > 10) {
        await e.reply('❌ 一次最多拼接 10 张图片', true)
        return true
      }
      const inputs = []
      for (const b of buffers) {
        const img = await Img.readFrames(b)
        inputs.push(img)
      }
      if (inputs.some((i) => i.animated)) {
        const total = Math.max(...inputs.map((i) => i.frames.length))
        if (total > 30) await e.reply(`⏳ 正在拼接（共 ${total} 帧），请稍候...`, true)
      }
      const { buffer, ext } = await Img.joinImages(inputs, mode)
      await this.sendImage(e, buffer, ext)
      return true
    })
  }

  async horizontalJoin(e) {
    return await this.joinHandler(e, 'horizontal')
  }

  async verticalJoin(e) {
    return await this.joinHandler(e, 'vertical')
  }

  // ================= 文字转图 =================

  async text2Image(e) {
    return await this.guard(e, async () => {
      const text = this.argOf(e, /^#?(?:文字转图|文字成图|文转图|文字生成图片)\s*([\s\S]+)$/)
      if (!text) {
        await e.reply('❌ 用法：#文字转图 要转换的文字（支持换行）', true)
        return true
      }
      if (text.length > 1000) {
        await e.reply('❌ 文字过长，请控制在 1000 字以内', true)
        return true
      }
      const buffer = await Img.textToImage(text)
      await this.sendImage(e, buffer)
      return true
    })
  }
}

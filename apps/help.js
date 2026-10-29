import fs from 'fs/promises'
import path from 'path'
import { notifyCommandError } from '../core/errorNotify.js'
import { TEMP_DIR, loadIconDataUri } from '../core/io.js'
import { segment } from '../core/segment.js'
import { renderHtmlToImage } from '../core/puppeteerRender.js'
import { buildHelpHtml } from '../core/help-html.js'

const CACHE_DIR = path.join(TEMP_DIR, 'help')
const CACHE_FILE = path.join(CACHE_DIR, 'help.png')

// 缓存相关
async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true })
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function isCacheValid() {
  try {
    const stat = await fs.stat(CACHE_FILE)
    const mtime = new Date(stat.mtime)
    const mtimeStr = `${mtime.getFullYear()}-${String(mtime.getMonth() + 1).padStart(2, '0')}-${String(mtime.getDate()).padStart(2, '0')}`
    return mtimeStr === todayStr()
  } catch {
    return false
  }
}

async function clearCache() {
  try { await fs.unlink(CACHE_FILE) } catch {}
}

async function loadAllIcons() {
  const [ffmpeg, update, version, clip, media, help, info, image, color, gif, grid, text] = await Promise.all([
    loadIconDataUri('ffmpeg'),
    loadIconDataUri('update'),
    loadIconDataUri('version'),
    loadIconDataUri('clip'),
    loadIconDataUri('media'),
    loadIconDataUri('help'),
    loadIconDataUri('info'),
    loadIconDataUri('image'),
    loadIconDataUri('color'),
    loadIconDataUri('gif'),
    loadIconDataUri('grid'),
    loadIconDataUri('text')
  ])
  // 功能指令图标（按名批量加载）
  const funcNames = [
    'flip-h', 'flip-v', 'grayscale', 'rotate', 'resize', 'crop', 'invert', 'contour', 'emboss',
    'blur', 'sharpen', 'pixelate', 'color-filter', 'solid', 'gradient', 'gif-reverse', 'gif-obrev',
    'gif-speed', 'gif-join', 'gif-extract', 'gif-pack', 'grid4', 'grid9', 'join-h', 'join-v', 'text2img',
    // 其余模块指令复用的通用图标
    'update', 'version', 'info', 'clip', 'media', 'help', 'image', 'gif', 'music', 'video', 'config'
  ]
  const funcEntries = await Promise.all(funcNames.map(async (n) => [n, await loadIconDataUri(n)]))
  const map = {}
  for (const [n, uri] of funcEntries) map[n] = uri
  return { ffmpeg, update, version, clip, media, help, info, image, color, gif, grid, text, map }
}

async function htmlToImageFile(html, outputPath) {
  // 复用 core/puppeteerRender.js 的共享浏览器实例（单例 + 字体就绪等待）。
  // outputPath 指定时（帮助缓存文件）保留 PNG，否则返回临时文件。
  const finalPath = outputPath || path.join(TEMP_DIR, `ffmpeg_help_${Date.now()}_${Math.random().toString(36).slice(2)}.png`)
  return renderHtmlToImage(html, { width: 760, scale: 3, outputPath: finalPath })
}

async function generateAndCache(icons) {
  const html = await buildHelpHtml(icons)
  await ensureCacheDir()
  return await htmlToImageFile(html, CACHE_FILE)
}

let cacheTimer = null
function startHelpCacheScheduler() {
  function scheduleNext() {
    const now = new Date()
    const next5 = new Date(now)
    next5.setHours(5, 0, 0, 0)
    if (now >= next5) next5.setDate(next5.getDate() + 1)
    const delay = next5.getTime() - now.getTime()
    cacheTimer = setTimeout(() => {
      clearCache().then(() => {
        logger.mark('[FFmpeg-Plugin] 帮助缓存已清理（每日5点），下次请求时重新生成')
        scheduleNext()
      })
    }, delay)
  }
  scheduleNext()
}
startHelpCacheScheduler()

let generating = false

export class ffmpegHelp extends plugin {
  constructor() {
    super({
      name: '[FFmpeg-Plugin]FFmpeg插件帮助',
      dsc: '#ff帮助 / #ffmpeg-plugin帮助',
      event: 'message',
      priority: 100,
      rule: [
        { reg: /^#(ff|ffmpeg-plugin)帮助$/i, fnc: 'showHelp' },
        { reg: /^#(ff|ffmpeg-plugin)帮助刷新$/i, fnc: 'refreshHelp' }
      ]
    })
  }

  async showHelp(e) {
    if (generating) {
      await this.reply('⏳ 正在生成帮助图片，请稍后再试...')
      return false
    }
    generating = true
    try {
      await ensureCacheDir()
      let imagePath
      if (await isCacheValid()) {
        imagePath = CACHE_FILE
      } else {
        const icons = await loadAllIcons()
        imagePath = await generateAndCache(icons)
      }
      await this.reply(segment.image(imagePath))
    } catch (err) {
      await notifyCommandError(err, 'FFmpeg帮助生成')
      await this.reply('❌ 生成帮助菜单失败', true)
    } finally {
      generating = false
    }
    return true
  }

  async refreshHelp(e) {
    // 仅主人可用
    if (!e.isMaster) {
      await this.reply('只有主人可以使用此命令', true)
      return false
    }

    if (generating) {
      await this.reply('⏳ 正在刷新帮助图片，请稍后再试...')
      return false
    }
    generating = true
    try {
      await clearCache()
      const icons = await loadAllIcons()
      const imagePath = await generateAndCache(icons)
      await this.reply(segment.image(imagePath))
      await this.reply('✅ 帮助菜单已刷新', true)
    } catch (err) {
      await notifyCommandError(err, 'FFmpeg帮助刷新')
      await this.reply('❌ 刷新帮助失败', true)
    } finally {
      generating = false
    }
    return true
  }
}

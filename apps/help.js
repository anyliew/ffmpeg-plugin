import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import puppeteer from 'puppeteer'

// 兼容不同框架获取 segment
let segment
try {
  segment = (await import('icqq')).segment
} catch (e) {
  segment = global.segment || { image: (file) => `[CQ:image,file=${file}]` }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RESOURCES_DIR = path.join(__dirname, '..', 'resources', 'icon')
const TEMP_DIR = path.join(process.cwd(), 'temp', 'ffmpeg')
const CACHE_DIR = path.join(TEMP_DIR, 'help')
const CACHE_FILE = path.join(CACHE_DIR, 'help.png')

// 确保临时目录存在
async function ensureTempDir() {
  await fs.mkdir(TEMP_DIR, { recursive: true })
}

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

// 加载 SVG 图标并转为 data URI
async function loadIconDataUri(name) {
  const filePath = path.join(RESOURCES_DIR, `${name}.svg`)
  try {
    const content = await fs.readFile(filePath)
    return `data:image/svg+xml;base64,${content.toString('base64')}`
  } catch {
    return ''
  }
}

async function loadAllIcons() {
  const [ffmpeg, update, version, clip, media, help, info] = await Promise.all([
    loadIconDataUri('ffmpeg'),
    loadIconDataUri('update'),
    loadIconDataUri('version'),
    loadIconDataUri('clip'),
    loadIconDataUri('media'),
    loadIconDataUri('help'),
    loadIconDataUri('info')
  ])
  return { ffmpeg, update, version, clip, media, help, info }
}

async function buildHelpHtml(icons) {
  const now = new Date()
  const formattedTime = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`

  // 标题图标尺寸（较大）
  const headerIconStyle = 'height:24px; width:24px; vertical-align:middle; margin-right:6px;'
  // 模块图标尺寸（中等）
  const moduleIconStyle = 'height:20px; width:20px; vertical-align:middle; margin-right:6px;'

  const ffmpegIcon  = icons.ffmpeg  ? `<img src="${icons.ffmpeg}"  style="${headerIconStyle}">` : '🎬'
  const updateIcon  = icons.update  ? `<img src="${icons.update}"  style="${moduleIconStyle}">` : '🔄'
  const versionIcon = icons.version ? `<img src="${icons.version}" style="${moduleIconStyle}">` : '📊'
  const clipIcon    = icons.clip    ? `<img src="${icons.clip}"    style="${moduleIconStyle}">` : '🎬'
  const mediaIcon   = icons.media   ? `<img src="${icons.media}"   style="${moduleIconStyle}">` : '🔧'
  const helpIcon    = icons.help    ? `<img src="${icons.help}"    style="${moduleIconStyle}">` : '📖'
  const infoIcon    = icons.info    ? `<img src="${icons.info}"    style="${moduleIconStyle}">` : '📋'

  const modules = [
    {
      icon: updateIcon,
      name: '更新管理',
      desc: '插件自更新功能（仅BOT主人可用）',
      commands: [
        { cmd: '#ff更新 / #ffmpeg-plugin更新', desc: '检查并更新插件（保留本地修改）' },
        { cmd: '#ff强制更新', desc: '强制覆盖本地修改，重置到远程最新版本' }
      ]
    },
    {
      icon: versionIcon,
      name: '版本信息',
      desc: '查看 FFmpeg 及插件详细信息',
      commands: [
        { cmd: '#ff版本 / #ffmpeg版本', desc: '生成 FFmpeg 版本信息卡片' }
      ]
    },
    {
      icon: infoIcon,
      name: '媒体信息',
      desc: '获取音视频/图片的详细元数据',
      commands: [
        { cmd: '#音频信息', desc: '查看音频文件详情（格式、时长、比特率等）' },
        { cmd: '#图片信息', desc: '查看图片详情（分辨率、格式、GIF帧数等）' },
        { cmd: '#视频信息', desc: '查看视频详情（编码、分辨率、码率等）' }
      ],
      note: '💡 使用方法：回复/引用包含媒体的消息，或直接发送带有媒体的命令'
    },
    {
      icon: clipIcon,
      name: '去黑边 / 去白边 / 去纯色',
      desc: '自动裁剪图片/视频/GIF 的四周黑边、白边或纯色区域',
      commands: [
        { cmd: '#去黑边', desc: '自动检测并裁剪媒体文件四周的黑边' },
        { cmd: '#去白边', desc: '自动检测并裁剪媒体文件四周的白边' },
        { cmd: '#去纯色', desc: '基于左上角颜色裁剪图片/GIF 四周的纯色区域（仅限图片）' }
      ],
      note: '💡 支持图片（含GIF）、视频批量处理（最多10个），GIF可保留动画'
    },
    {
      icon: mediaIcon,
      name: '多媒体工具箱',
      desc: '视频转GIF、GIF分解打包、音频/视频格式转换',
      commands: [
        { cmd: '#转动图 / #转gif', desc: '将视频转换为 GIF 动图' },
        { cmd: '#动图分解 / #gif分解', desc: '将 GIF 动图分解为 PNG 帧序列' },
        { cmd: '#动图打包 / #gif打包', desc: '将 GIF 动图的所有帧打包为 ZIP' },
        { cmd: '#转语音', desc: '提取视频音频并转为 MP3 语音消息' },
        { cmd: '#转mp3', desc: '将音/视频文件转换为 MP3 音频文件' },
        { cmd: '#转flac', desc: '将音/视频文件转换为 FLAC 无损音频' }
      ]
    },
    {
      icon: helpIcon,
      name: '帮助菜单',
      desc: '显示本帮助信息',
      commands: [
        { cmd: '#ff帮助 / #ffmpeg-plugin帮助', desc: '生成此帮助菜单图片' },
        { cmd: '#ff帮助刷新 / #ffmpeg-plugin帮助刷新', desc: '手动刷新帮助菜单缓存' }
      ]
    }
  ]

  const modulesHtml = modules.map(mod => `
    <div class="module-card">
      <div class="module-header">
        <h3>${mod.icon} ${escapeHtml(mod.name)}</h3>
        <p>${escapeHtml(mod.desc)}</p>
      </div>
      <div class="command-list">
        ${mod.commands.map(cmd => `
          <div class="command-item">
            <code>${escapeHtml(cmd.cmd)}</code>
            <span>${escapeHtml(cmd.desc)}</span>
          </div>
        `).join('')}
      </div>
      ${mod.note ? `<div class="module-note">${escapeHtml(mod.note)}</div>` : ''}
    </div>
  `).join('')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>FFmpeg Plugin 帮助菜单</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background: #f6f8fa; 
    color: #1f2328; 
    display: flex; 
    justify-content: center;
    padding: 20px; 
    -webkit-font-smoothing: antialiased;
  }
  .container {
    width: 600px; 
    background: #ffffff; 
    border: 1px solid #d0d7de; 
    border-radius: 12px;
    overflow: hidden; 
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  }
  .header {
    padding: 16px 20px; 
    border-bottom: 1px solid #d0d7de; 
    background: #f6f8fa;
  }
  .header h1 {
    font-size: 24px;              /* 标题字体增大 */
    font-weight: 600; 
    color: #1f2328; 
    display: flex; 
    align-items: center; 
    gap: 6px;
  }
  .content {
    padding: 16px 20px 8px;
  }
  .module-card {
    background: #ffffff; 
    border: 1px solid #d0d7de; 
    border-radius: 12px; 
    padding: 16px; 
    margin-bottom: 16px;
  }
  .module-card:last-child { margin-bottom: 0; }
  .module-header {
    margin-bottom: 12px; 
    padding-bottom: 8px; 
    border-bottom: 1px solid #d8dee4;
  }
  .module-header h3 {
    font-size: 18px;              /* 模块标题字体增大 */
    font-weight: 600; 
    color: #1f2328; 
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .module-header p {
    font-size: 13px; 
    color: #656d76;
  }
  .command-list {
    display: flex; 
    flex-direction: column; 
    gap: 10px;
  }
  .command-item {
    display: flex; 
    flex-wrap: wrap; 
    align-items: baseline; 
    gap: 10px;
  }
  .command-item code {
    background: #f6f8fa; 
    border: 1px solid #d0d7de; 
    padding: 3px 10px; 
    border-radius: 20px;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace; 
    font-size: 13px; 
    font-weight: 600;
    color: #0969da; 
    white-space: nowrap;
  }
  .command-item span {
    flex: 1; 
    font-size: 13px; 
    color: #57606a; 
    line-height: 1.5;
  }
  .module-note {
    margin-top: 10px; 
    padding: 8px 12px; 
    font-size: 12px; 
    color: #656d76;
    background: #f6f8fa; 
    border-left: 3px solid #d0d7de; 
    border-radius: 4px;
  }
  .footer {
    padding: 12px 20px; 
    border-top: 1px solid #d0d7de; 
    text-align: center;
    font-size: 12px; 
    color: #656d76; 
    background: #f6f8fa; 
    line-height: 1.6;
  }
  /* 图标与文字垂直居中 */
  h1 img, h3 img {
    vertical-align: middle;
  }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>${ffmpegIcon} FFmpeg Plugin</h1>
  </div>
  <div class="content">
    ${modulesHtml}
  </div>
  <div class="footer">
    Created By Yunzai-Bot & ffmpeg-plugin<br>
    生成时间: ${formattedTime}
  </div>
</div>
</body>
</html>`
}

function escapeHtml(str) {
  if (!str) return ''
  return str.replace(/[&<>]/g, (m) => {
    if (m === '&') return '&amp;'
    if (m === '<') return '&lt;'
    if (m === '>') return '&gt;'
    return m
  })
}

async function htmlToImageFile(html, outputPath) {
  let browser = null
  await ensureTempDir()
  const finalPath = outputPath || path.join(TEMP_DIR, `ffmpeg_help_${Date.now()}_${Math.random().toString(36).slice(2)}.png`)
  try {
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: 'new'
    })
    const page = await browser.newPage()
    await page.setViewport({ width: 640, height: 480, deviceScaleFactor: 2 })
    await page.setContent(html, { waitUntil: 'networkidle0' })
    const bodyHeight = await page.evaluate(() => document.body.scrollHeight)
    await page.setViewport({ width: 640, height: bodyHeight + 30, deviceScaleFactor: 2 })
    await page.screenshot({ path: finalPath, type: 'png', fullPage: true })
    return finalPath
  } finally {
    if (browser) await browser.close()
  }
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
        logger.mark('[ffmpeg-plugin] 帮助缓存已清理（每日5点），下次请求时重新生成')
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
      name: '[ffmpeg-plugin]FFmpeg插件帮助',
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
      logger.error(`[ffmpeg-plugin] 帮助生成失败: ${err}`)
      await this.reply('❌ 生成帮助菜单失败', true)
    } finally {
      generating = false
    }
    return true
  }

  async refreshHelp(e) {
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
      logger.error(`[ffmpeg-plugin] 刷新帮助失败: ${err}`)
      await this.reply('❌ 刷新帮助失败', true)
    } finally {
      generating = false
    }
    return true
  }
}
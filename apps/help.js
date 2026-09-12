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
  return { ffmpeg, update, version, clip, media, help, info, image, color, gif, grid, text }
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
  const imageIcon   = icons.image   ? `<img src="${icons.image}"   style="${moduleIconStyle}">` : '🖼️'
  const colorIcon   = icons.color   ? `<img src="${icons.color}"   style="${moduleIconStyle}">` : '🎨'
  const gifIcon     = icons.gif     ? `<img src="${icons.gif}"     style="${moduleIconStyle}">` : '🎞️'
  const gridIcon    = icons.grid    ? `<img src="${icons.grid}"    style="${moduleIconStyle}">` : '🧩'
  const textIcon    = icons.text    ? `<img src="${icons.text}"    style="${moduleIconStyle}">` : '🔤'

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
      desc: '视频转GIF、GIF分解打包、音频/视频格式转换、GIF转MP4、转APNG',
      commands: [
        { cmd: '#转动图 / #转gif', desc: '将视频转换为 GIF 动图' },
        { cmd: '#动图分解 / #gif分解', desc: '将 GIF 动图分解为 PNG 帧序列' },
        { cmd: '#动图打包 / #gif打包', desc: '将 GIF 动图的所有帧打包为 ZIP' },
        { cmd: '#转语音', desc: '提取视频音频并转为 MP3 语音消息' },
        { cmd: '#转mp3', desc: '将音/视频文件转换为 MP3 音频文件' },
        { cmd: '#转flac', desc: '将音/视频文件转换为 FLAC 无损音频' },
        { cmd: '#转wav', desc: '将音/视频文件转换为 WAV 音频文件' },
        { cmd: '#转视频', desc: '将 GIF 动图转换为带背景音乐的 MP4 视频' },
        { cmd: '#转apng', desc: '将图片/GIF/视频转换为 APNG 动图（PNG动画）' }
      ]
    },
    {
      icon: imageIcon,
      name: '基础图片处理',
      desc: '翻转、灰度、旋转、缩放、裁剪、反色、滤镜等（静态图与 GIF 均支持）',
      commands: [
        { cmd: '#水平翻转 / #左翻 / #右翻', desc: '水平镜像翻转图片' },
        { cmd: '#竖直翻转 / #上翻 / #下翻', desc: '竖直翻转图片（上下颠倒）' },
        { cmd: '#灰度图 / #黑白', desc: '转为黑白灰度图' },
        { cmd: '#旋转 [角度]', desc: '旋转指定角度，默认 90°，如：#旋转 45' },
        { cmd: '#缩放 尺寸', desc: '缩放：100x100、100x、x100、50%' },
        { cmd: '#裁剪 尺寸', desc: '居中裁剪：100x100、2:1' },
        { cmd: '#反相 / #反色', desc: '反色处理（负片效果）' },
        { cmd: '#轮廓 / #浮雕', desc: '轮廓描边 / 浮雕效果' },
        { cmd: '#模糊 [强度]', desc: '高斯模糊，默认 1.6，如：#模糊 5' },
        { cmd: '#锐化', desc: '锐化图片细节' },
        { cmd: '#像素化 / #马赛克 [强度]', desc: '像素化（马赛克），默认 8' }
      ],
      note: '💡 使用方法：回复/引用一条图片消息，或直接发送图片 + 命令；GIF 动图会逐帧处理并保留动画'
    },
    {
      icon: colorIcon,
      name: '颜色 / 滤镜 / 生成',
      desc: '颜色滤镜、纯色图、渐变图',
      commands: [
        { cmd: '#颜色滤镜 颜色', desc: '给图片叠加指定颜色滤镜' },
        { cmd: '#纯色图 颜色 [尺寸]', desc: '生成纯色图，默认 500x500，如：#纯色图 红色 300x300' },
        { cmd: '#渐变图 [方向] 颜色1 颜色2', desc: '生成渐变图，如：#渐变图 上下 红 蓝、#渐变图 45 #66ccff #ff66cc' }
      ],
      note: '💡 颜色支持：#66ccff、red、红色、102,204,255；渐变方向：上下 / 左右 / 角度数字（默认左右）'
    },
    {
      icon: gifIcon,
      name: 'GIF 动图处理',
      desc: '倒放、正放倒放、变速、多图合成',
      commands: [
        { cmd: '#gif倒放 / #倒放', desc: '将 GIF 倒序播放' },
        { cmd: '#gif正放倒放 / #正放倒放', desc: '正放一遍再倒放一遍' },
        { cmd: '#gif变速 倍率', desc: '调整速度：0.5x、50%、20FPS、0.05s' },
        { cmd: '#gif合成 [间隔]', desc: '多张图片合成为 GIF，间隔默认 100ms' },
        { cmd: '#动图分解 / #gif分解', desc: '将 GIF 分解为 PNG 帧序列' },
        { cmd: '#动图打包 / #gif打包', desc: '将 GIF 所有帧打包为 ZIP' }
      ],
      note: '💡 合成请一次发送多张图片（≥2 张）；帧间隔需 ≥ 20ms（即 ≤ 50FPS）'
    },
    {
      icon: gridIcon,
      name: '网格 / 拼接',
      desc: '四宫格、九宫格、横向/纵向拼接',
      commands: [
        { cmd: '#四宫格', desc: '将图片切成 2×2 四块' },
        { cmd: '#九宫格', desc: '将图片切成 3×3 九块' },
        { cmd: '#横向拼接', desc: '多张图片横向拼接（左→右）' },
        { cmd: '#纵向拼接', desc: '多张图片纵向拼接（上→下）' }
      ],
      note: '💡 切图会先居中正方形裁剪；拼接至少需要 2 张图片，结果以合并转发形式发送'
    },
    {
      icon: textIcon,
      name: '文字转图',
      desc: '把文字渲染成图片',
      commands: [
        { cmd: '#文字转图 文字', desc: '将文字转换为图片，支持换行，最长 1000 字' }
      ],
      note: '💡 如：#文字转图 你好\\n世界'
    },
    {
      icon: helpIcon,
      name: '帮助菜单',
      desc: '显示本帮助信息',
      commands: [
        { cmd: '#ff帮助 / #ffmpeg-plugin帮助', desc: '生成此帮助菜单图片' },
        { cmd: '#ff帮助刷新 / #ffmpeg-plugin帮助刷新', desc: '手动刷新帮助菜单缓存（仅主人）' }
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
    // 仅主人可用
    if (!this.e.isMaster) {
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
      logger.error(`[ffmpeg-plugin] 刷新帮助失败: ${err}`)
      await this.reply('❌ 刷新帮助失败', true)
    } finally {
      generating = false
    }
    return true
  }
}
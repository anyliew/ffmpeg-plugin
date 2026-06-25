import { exec } from 'child_process'
import { promisify } from 'util'
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import puppeteer from 'puppeteer'

const execPromise = promisify(exec)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 导入 segment（Yunzai 框架常用）
let segment
try {
  segment = (await import('icqq')).segment
} catch (e) {
  segment = global.segment || { image: (file) => `[CQ:image,file=${file}]` }
}

/**
 * 确保临时目录存在
 */
async function ensureTempDir() {
  const tempDir = path.join(process.cwd(), 'temp', 'ffmpeg')
  await fs.mkdir(tempDir, { recursive: true })
  return tempDir
}

/**
 * 加载 SVG 图标并转为 data URI（相对路径）
 */
async function loadIconDataUri(filename) {
  const filePath = path.join(__dirname, '..', 'resources', 'icon', filename)
  try {
    const content = await fs.readFile(filePath)
    return `data:image/svg+xml;base64,${content.toString('base64')}`
  } catch {
    return ''
  }
}

/**
 * 加载所有需要的图标
 */
async function loadAllIcons() {
  const [ffmpeg, update, rely, video, music, hardware, packaged, config] = await Promise.all([
    loadIconDataUri('ffmpeg.svg'),
    loadIconDataUri('update.svg'),
    loadIconDataUri('rely.svg'),
    loadIconDataUri('video.svg'),
    loadIconDataUri('music.svg'),
    loadIconDataUri('hardware.svg'),
    loadIconDataUri('packaged.svg'),
    loadIconDataUri('config.svg')
  ])
  return { ffmpeg, update, rely, video, music, hardware, packaged, config }
}

/**
 * 获取 ffmpeg 版本信息
 */
async function getFfmpegVersionInfo() {
  try {
    const { stdout } = await execPromise('ffmpeg -version')
    return stdout
  } catch (err) {
    throw new Error(`执行 ffmpeg -version 失败: ${err.message}`)
  }
}

/**
 * 提取版本号（支持官方稳定版和各类 git 构建版）
 */
function extractVersionNumber(versionOutput) {
  const match = versionOutput.match(/ffmpeg version\s+(\S+)/i)
  return match ? match[1] : '未知'
}

/**
 * 从版本信息中提取基础版本描述（适配 gyan.dev / BtbN 等常见构建）
 */
function getBaseVersionDescription(versionOutput, versionNumber) {
  // 检测构建来源（gyan.dev 或 BtbN）
  if (versionOutput.includes('gyan.dev')) {
    return `基于 FFmpeg git 开发版 (gyan.dev 自动构建)`
  }
  if (versionOutput.includes('BtbN')) {
    return `基于 FFmpeg git 开发版 (BtbN 自动构建)`
  }

  // 尝试匹配稳定版本号（如 6.0, 7.0 等）
  const stableMatch = versionOutput.match(/ffmpeg version\s+(\d+\.\d+)/i)
  if (stableMatch) {
    const baseVer = stableMatch[1]
    return `基于 FFmpeg ${baseVer} 构建`
  }

  // 其他情况：可能是其他开发版（包含 N-、git 等标识）
  if (versionNumber.startsWith('N-') || versionNumber.includes('g') || versionNumber.includes('-')) {
    return `基于 FFmpeg git 开发版`
  }

  return `基于 FFmpeg 自定义构建`
}

/**
 * 提取所有 --enable-xxx 中的特性名（去掉 --enable- 前缀）
 */
function getEnabledFeatures(versionOutput) {
  const match = versionOutput.match(/configuration:\s+(.+)/)
  if (!match) return []
  const configStr = match[1].trim()
  const parts = configStr.split(/\s+/)
  const enableFeatures = parts
    .filter(part => part.startsWith('--enable-'))
    .map(part => part.slice(9)) // 去掉 '--enable-'
  return [...new Set(enableFeatures)] // 去重
}

/**
 * 获取插件目录的 git log 最近5条（带完整日期时间）
 */
async function getGitLogDetailed(pluginDir) {
  try {
    await execPromise('git rev-parse --is-inside-work-tree', { cwd: pluginDir })
    const { stdout } = await execPromise(
      'git log -n 5 --pretty=format:"%h|%s|%an|%ad" --date=format-local:\'%Y-%m-%d %H:%M:%S\'',
      { cwd: pluginDir }
    )
    if (!stdout.trim()) return []
    const lines = stdout.split('\n')
    return lines.map(line => {
      const [hash, title, author, date] = line.split('|')
      return { hash: hash || '未知', title: title || '无标题', author: author || '未知', date: date || '未知' }
    })
  } catch (err) {
    console.error('获取 Git 日志失败:', err.message)
    return []
  }
}

/**
 * 生成 HTML（使用 SVG 图标替换 Emoji）
 */
function buildHtml(versionRaw, versionNumber, commits, icons) {
  const escapeHtml = (str) => {
    if (!str) return ''
    return str.replace(/[&<>]/g, (m) => {
      if (m === '&') return '&amp;'
      if (m === '<') return '&lt;'
      if (m === '>') return '&gt;'
      return m
    })
  }

  const baseVersionDesc = getBaseVersionDescription(versionRaw, versionNumber)
  const enabledFeatures = getEnabledFeatures(versionRaw)
  const featuresHtml = enabledFeatures.map(f => `<span class="config-chip">${escapeHtml(f)}</span>`).join('')

  // 提交记录 HTML
  const commitsHtml = commits.map(commit => `
    <li class="commit-item">
      <div class="commit-hash">${escapeHtml(commit.hash)}</div>
      <div class="commit-body">
        <div class="commit-title">${escapeHtml(commit.title)}</div>
        <div class="commit-meta">
          <span>👤 ${escapeHtml(commit.author)}</span>
          <span>📅 ${escapeHtml(commit.date)}</span>
          <span>🌿 main</span>
        </div>
      </div>
    </li>
  `).join('')

  const now = new Date()
  const formattedTime = `${now.getFullYear()}/${now.getMonth()+1}/${now.getDate()} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`

  // 图标样式
  const mainIconStyle = 'height:28px; width:28px; vertical-align:middle; margin-right:8px;'
  const headerIconStyle = 'height:24px; width:24px; vertical-align:middle; margin-right:6px;'
  const subIconStyle = 'height:20px; width:20px; vertical-align:middle; margin-right:6px;'

  const ffmpegIcon = icons.ffmpeg ? `<img src="${icons.ffmpeg}" style="${mainIconStyle}">` : ''
  const updateIcon = icons.update ? `<img src="${icons.update}" style="${headerIconStyle}">` : ''
  const relyIcon = icons.rely ? `<img src="${icons.rely}" style="${headerIconStyle}">` : ''
  const videoIcon = icons.video ? `<img src="${icons.video}" style="${subIconStyle}">` : ''
  const musicIcon = icons.music ? `<img src="${icons.music}" style="${subIconStyle}">` : ''
  const hardwareIcon = icons.hardware ? `<img src="${icons.hardware}" style="${subIconStyle}">` : ''
  const packagedIcon = icons.packaged ? `<img src="${icons.packaged}" style="${subIconStyle}">` : ''
  const configIcon = icons.config ? `<img src="${icons.config}" style="${headerIconStyle}">` : ''

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ffmpeg-plugin 信息看板</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background: #f4f7fc;
            color: #0f172a;
            line-height: 1.5;
            padding: 2rem 1.5rem;
            font-size: 16px;
        }

        .container {
            max-width: 1280px;
            margin: 0 auto;
        }

        .page-header {
            margin-bottom: 2.5rem;
            text-align: center;
            border-bottom: 2px solid #e2edf7;
            padding-bottom: 1.2rem;
        }

        .page-header h1 {
            font-size: 2.6rem;
            font-weight: 600;
            background: linear-gradient(135deg, #1e4a76, #2c6288);
            background-clip: text;
            -webkit-background-clip: text;
            color: transparent;
            display: inline-flex;
            align-items: center;
            gap: 0.6rem;
        }

        .sub {
            color: #2c5a74;
            margin-top: 0.6rem;
            font-size: 1rem;
            font-weight: 500;
        }

        .card {
            background: #ffffff;
            border-radius: 1.5rem;
            box-shadow: 0 12px 30px -12px rgba(0, 0, 0, 0.08);
            padding: 1.6rem 2rem;
            margin-bottom: 2rem;
            border: 1px solid #e6edf4;
        }

        .card-header {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            border-bottom: 2px solid #eef3fa;
            padding-bottom: 0.85rem;
            margin-bottom: 1.5rem;
        }

        .card-header h2 {
            font-size: 1.8rem;
            font-weight: 600;
            color: #0f4c5f;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .version-info {
            display: flex;
            flex-wrap: wrap;
            gap: 1rem;
            align-items: baseline;
        }

        .version-tag {
            background: #eef2fa;
            padding: 0.5rem 1.4rem;
            border-radius: 2rem;
            font-family: monospace;
            font-weight: 700;
            font-size: 1.2rem;
            color: #1b6b87;
            word-break: break-all;
        }

        .version-detail {
            color: #2c627a;
            font-size: 0.95rem;
            background: #f0f6fe;
            padding: 0.5rem 1.2rem;
            border-radius: 2rem;
        }

        .config-list {
            margin-top: 0;
            display: flex;
            flex-wrap: wrap;
            gap: 0.8rem;
        }

        .config-chip {
            background: #f8fafc;
            border: 1px solid #dfe8f0;
            border-radius: 2rem;
            padding: 0.5rem 1.2rem;
            font-size: 1rem;
            font-family: monospace;
            color: #1f5e7e;
        }

        .commit-list {
            list-style: none;
        }

        .commit-item {
            display: flex;
            align-items: flex-start;
            gap: 1rem;
            padding: 1rem 0;
            border-bottom: 1px solid #eef2f7;
        }

        .commit-item:last-child {
            border-bottom: none;
        }

        .commit-hash {
            font-family: monospace;
            background: #ecf3f9;
            padding: 0.3rem 0.8rem;
            border-radius: 0.6rem;
            font-size: 0.9rem;
            font-weight: 600;
            color: #1a6885;
        }

        .commit-body {
            flex: 1;
        }

        .commit-title {
            font-weight: 650;
            font-size: 1rem;
            color: #115e7c;
            margin-bottom: 0.3rem;
        }

        .commit-meta {
            font-size: 0.8rem;
            color: #5f7f9a;
            display: flex;
            gap: 1rem;
            flex-wrap: wrap;
        }

        .codec-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
            gap: 1.2rem;
        }

        .codec-category {
            background: #fbfdff;
            border-radius: 1.2rem;
            padding: 1rem 1.2rem;
            border: 1px solid #e4edf6;
        }

        .codec-category h3 {
            font-size: 1.2rem;
            font-weight: 700;
            margin-bottom: 0.8rem;
            color: #1c5a78;
            display: flex;
            align-items: center;
            gap: 0.4rem;
        }

        .codec-list {
            display: flex;
            flex-wrap: wrap;
            gap: 0.8rem;
        }

        .codec-badge {
            background: #e7f0f9;
            padding: 0.5rem 1.2rem;
            border-radius: 1.5rem;
            font-size: 1rem;
            font-weight: 500;
            font-family: monospace;
            color: #146b8a;
        }

        .footer {
            margin-top: 2rem;
            text-align: center;
            padding: 1.2rem 1rem;
            font-size: 0.9rem;
            color: #54708f;
            border-top: 1px solid #dfeaf3;
            background: #ffffffdd;
            border-radius: 1rem;
        }

        .footer .powered {
            font-weight: 600;
            color: #1d6f93;
            margin-top: 0.3rem;
            font-size: 0.9rem;
        }

        @media (max-width: 640px) {
            body { padding: 1rem; font-size: 14px; }
            .card { padding: 1.2rem; }
            .card-header h2 { font-size: 1.5rem; }
            .commit-item { flex-direction: column; gap: 0.4rem; }
            .version-tag { font-size: 1rem; }
        }
    </style>
</head>
<body>
<div class="container">
    <div class="page-header">
        <h1>${ffmpegIcon} ffmpeg-plugin</h1>
        <div class="sub">基于 FFmpeg 的 Yunzai-Bot 插件，提供图像、音视频处理及信息查询功能</div>
    </div>

    <!-- 顺序1: FFmpeg版本 -->
    <div class="card">
        <div class="card-header">
            <h2>${ffmpegIcon} FFmpeg 版本</h2>
        </div>
        <div class="version-info">
            <div class="version-tag">ffmpeg version ${escapeHtml(versionNumber)}</div>
            <div class="version-detail">${escapeHtml(baseVersionDesc)}</div>
        </div>
    </div>

    <!-- 顺序2: 插件更新记录 -->
    <div class="card">
        <div class="card-header">
            <h2>${updateIcon} ffmpeg-plugin 插件更新记录</h2>
        </div>
        <ul class="commit-list">
            ${commitsHtml || '<li style="padding:1rem;">暂无提交记录</li>'}
        </ul>
    </div>

    <!-- 顺序3: ffmpeg 编解码库 -->
    <div class="card">
        <div class="card-header">
            <h2>${relyIcon} ffmpeg 编解码库</h2>
        </div>
        <div class="codec-grid">
            <div class="codec-category">
                <h3>${videoIcon} 视频编码器</h3>
                <div class="codec-list">
                    <span class="codec-badge">H.264 / AVC</span>
                    <span class="codec-badge">H.265 / HEVC</span>
                    <span class="codec-badge">VP9</span>
                    <span class="codec-badge">AV1 (libaom)</span>
                    <span class="codec-badge">MPEG-4</span>
                </div>
            </div>
            <div class="codec-category">
                <h3>${musicIcon} 音频编码器</h3>
                <div class="codec-list">
                    <span class="codec-badge">AAC</span>
                    <span class="codec-badge">MP3 (LAME)</span>
                    <span class="codec-badge">Opus</span>
                    <span class="codec-badge">FLAC</span>
                    <span class="codec-badge">Vorbis</span>
                </div>
            </div>
            <div class="codec-category">
                <h3>${hardwareIcon} 硬件加速</h3>
                <div class="codec-list">
                    <span class="codec-badge">VAAPI</span>
                    <span class="codec-badge">NVENC</span>
                    <span class="codec-badge">QSV</span>
                    <span class="codec-badge">AMF</span>
                </div>
            </div>
            <div class="codec-category">
                <h3>${packagedIcon} 封装格式</h3>
                <div class="codec-list">
                    <span class="codec-badge">MP4 / MOV</span>
                    <span class="codec-badge">MKV</span>
                    <span class="codec-badge">WebM</span>
                    <span class="codec-badge">HLS (M3U8)</span>
                </div>
            </div>
        </div>
    </div>

    <!-- 顺序4: 详细编译配置 -->
    <div class="card">
        <div class="card-header">
            <h2>${configIcon} 详细编译配置</h2>
        </div>
        <div class="config-list">
            ${featuresHtml || '<span class="config-chip">无 --enable- 项</span>'}
        </div>
    </div>

    <div class="footer">
        <div>生成时间: ${formattedTime}</div>
        <div class="powered">Created By Yunzai-Bot & ffmpeg-plugin</div>
    </div>
</div>
</body>
</html>`
}

/**
 * HTML 转 PNG 图片，返回临时文件路径
 */
async function htmlToImageFile(html) {
  let browser = null
  const tempDir = await ensureTempDir()
  const tempFilePath = path.join(tempDir, `ffmpeg_info_${Date.now()}_${Math.random().toString(36).slice(2)}.png`)
  try {
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: 'new'
    })
    const page = await browser.newPage()
    await page.setViewport({ width: 1000, height: 600, deviceScaleFactor: 2 })
    await page.setContent(html, { waitUntil: 'networkidle0' })
    const bodyHeight = await page.evaluate(() => document.body.scrollHeight)
    await page.setViewport({ width: 1000, height: bodyHeight + 50, deviceScaleFactor: 2 })
    await page.screenshot({ path: tempFilePath, type: 'png', fullPage: true })
    return tempFilePath
  } finally {
    if (browser) await browser.close()
  }
}

export class ffmpegVersion extends plugin {
  constructor() {
    super({
      name: '[ffmpeg-plugin]FFmpeg版本查询',
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
    try {
      const versionRaw = await getFfmpegVersionInfo()
      const versionNumber = extractVersionNumber(versionRaw)

      const rootDir = process.cwd()
      const pluginDir = path.join(rootDir, 'plugins', 'ffmpeg-plugin')
      let commits = []
      try {
        await fs.access(pluginDir)
        commits = await getGitLogDetailed(pluginDir)
      } catch (err) {
        console.error('插件目录访问失败:', err.message)
        commits = []
      }

      // 加载所有图标
      const icons = await loadAllIcons()

      const html = buildHtml(versionRaw, versionNumber, commits, icons)
      const imagePath = await htmlToImageFile(html)

      await e.reply(segment.image(imagePath))

      setTimeout(async () => {
        try {
          await fs.unlink(imagePath)
        } catch (ignore) {}
      }, 5000)
    } catch (err) {
      logger.error('查询 FFmpeg 信息失败:', err)
      await e.reply(`❌ 查询失败: ${err.message}`, true)
    }
  }
}
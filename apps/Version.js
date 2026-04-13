import { exec } from 'child_process'
import { promisify } from 'util'
import { promises as fs } from 'fs'
import path from 'path'
import puppeteer from 'puppeteer'

const execPromise = promisify(exec)

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
 * 提取版本号（支持官方稳定版和 BtbN 自动构建版）
 * 示例输入: "ffmpeg version N-122785-g38cd91c99a-20260218 Copyright ..."
 * 输出: "N-122785-g38cd91c99a-20260218"
 */
function extractVersionNumber(versionOutput) {
  const match = versionOutput.match(/ffmpeg version\s+(\S+)/i)
  return match ? match[1] : '未知'
}

/**
 * 从版本信息中提取基础版本（如 6.1, 7.0）或标记为开发版
 * @param {string} versionOutput - ffmpeg -version 完整输出
 * @param {string} versionNumber - 已提取的版本号字符串
 * @returns {string} 描述字符串，如 "基于 FFmpeg 6.1 构建" 或 "基于 FFmpeg git 开发版 (自动构建)"
 */
function getBaseVersionDescription(versionOutput, versionNumber) {
  // 尝试匹配主版本号（例如 6.1.0 -> 6.1，或者 7.0.2 -> 7.0）
  const stableMatch = versionOutput.match(/ffmpeg version\s+(\d+\.\d+)/i)
  if (stableMatch) {
    const baseVer = stableMatch[1]
    return `基于 FFmpeg ${baseVer} 构建`
  }
  // 如果是 BtbN 风格（以 N- 开头）或包含 git 哈希
  if (versionNumber.startsWith('N-') || versionNumber.includes('g') || versionNumber.includes('-')) {
    return `基于 FFmpeg git 开发版 (BtbN 自动构建)`
  }
  return `基于 FFmpeg 自定义构建`
}

/**
 * 提取编译配置项（--enable-xxx / --disable-xxx）
 */
function extractConfigureOptions(versionOutput) {
  const match = versionOutput.match(/configuration:\s+(.+)/)
  if (!match) return []
  const configStr = match[1]
  const options = configStr.split(/\s+/).filter(opt => opt.startsWith('--enable-') || opt.startsWith('--disable-'))
  // 只取前12个常用项，避免过多
  return options.slice(0, 12)
}

/**
 * 获取插件目录的 git log 最近5条（详细信息）
 * 返回格式: [{ hash, title, author, date }, ...]
 */
async function getGitLogDetailed(pluginDir) {
  try {
    // 检查是否为 git 仓库
    await execPromise('git rev-parse --is-inside-work-tree', { cwd: pluginDir })
    // 获取最近5条提交，格式: hash|标题|作者|日期(short)
    const { stdout } = await execPromise(
      'git log -n 5 --pretty=format:"%h|%s|%an|%ad" --date=short',
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
 * 生成 HTML（优化版：正确显示 BtbN 版本号 + 动态版本描述）
 * @param {string} versionRaw - ffmpeg -version 原始输出
 * @param {string} versionNumber - 提取的版本号
 * @param {Array} commits - 提交记录数组 [{ hash, title, author, date }]
 * @param {Array} configureOptions - 编译选项数组
 */
function buildHtml(versionRaw, versionNumber, commits, configureOptions) {
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

  // 生成提交记录列表 HTML
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

  // 生成编译选项标签
  const configChips = configureOptions.map(opt => `<span class="config-chip">${escapeHtml(opt)}</span>`).join('')

  // 动态生成当前时间
  const now = new Date()
  const formattedTime = `${now.getFullYear()}/${now.getMonth()+1}/${now.getDate()} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`

  // 完整 HTML 结构（卡片布局）
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

        /* 自定义字体：相对路径 \\plugins\\ffmpeg-plugin\\fontLorchinSansP0.woff2 */
        @font-face {
            font-family: 'Lorchin Sans P0';
            src: url('./plugins/ffmpeg-plugin/fontLorchinSansP0.woff2') format('woff2');
            font-weight: normal;
            font-style: normal;
            font-display: swap;
        }

        body {
            font-family: 'Lorchin Sans P0', 'Segoe UI', 'Roboto', 'Helvetica Neue', sans-serif;
            background: #f4f7fc;
            color: #0f172a;
            line-height: 1.5;
            padding: 2rem 1.5rem;
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
            font-size: 2.4rem;
            font-weight: 600;
            background: linear-gradient(135deg, #1e4a76, #2c6288);
            background-clip: text;
            -webkit-background-clip: text;
            color: transparent;
            display: inline-flex;
            align-items: center;
            gap: 0.6rem;
        }

        .page-header h1 span {
            font-size: 2rem;
        }

        .sub {
            color: #2c5a74;
            margin-top: 0.5rem;
            font-size: 0.9rem;
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

        .card-header .icon {
            font-size: 1.9rem;
        }

        .card-header h2 {
            font-size: 1.6rem;
            font-weight: 600;
            color: #0f4c5f;
        }

        .card-header .badge {
            background: #e3f0fc;
            border-radius: 40px;
            padding: 0.2rem 0.8rem;
            font-size: 0.7rem;
            font-weight: 600;
            color: #1c6c8c;
            margin-left: 0.5rem;
        }

        .version-info {
            display: flex;
            flex-wrap: wrap;
            gap: 1rem;
            align-items: baseline;
        }

        .version-tag {
            background: #eef2fa;
            padding: 0.4rem 1.2rem;
            border-radius: 2rem;
            font-family: monospace;
            font-weight: 700;
            font-size: 1.1rem;
            color: #1b6b87;
            word-break: break-all;
        }

        .version-detail {
            color: #2c627a;
            font-size: 0.85rem;
            background: #f0f6fe;
            padding: 0.4rem 1rem;
            border-radius: 2rem;
        }

        .config-list {
            margin-top: 1rem;
            display: flex;
            flex-wrap: wrap;
            gap: 0.6rem;
        }

        .config-chip {
            background: #f8fafc;
            border: 1px solid #dfe8f0;
            border-radius: 2rem;
            padding: 0.2rem 0.9rem;
            font-size: 0.75rem;
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
            padding: 0.2rem 0.7rem;
            border-radius: 0.6rem;
            font-size: 0.8rem;
            font-weight: 600;
            color: #1a6885;
        }

        .commit-body {
            flex: 1;
        }

        .commit-title {
            font-weight: 650;
            color: #115e7c;
            margin-bottom: 0.3rem;
        }

        .commit-meta {
            font-size: 0.7rem;
            color: #5f7f9a;
            display: flex;
            gap: 1rem;
            flex-wrap: wrap;
        }

        .codec-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
            gap: 1rem;
        }

        .codec-category {
            background: #fbfdff;
            border-radius: 1.2rem;
            padding: 0.9rem 1.1rem;
            border: 1px solid #e4edf6;
        }

        .codec-category h3 {
            font-size: 1rem;
            font-weight: 700;
            margin-bottom: 0.7rem;
            color: #1c5a78;
        }

        .codec-list {
            display: flex;
            flex-wrap: wrap;
            gap: 0.5rem;
        }

        .codec-badge {
            background: #e7f0f9;
            padding: 0.2rem 0.8rem;
            border-radius: 1.5rem;
            font-size: 0.75rem;
            font-weight: 500;
            font-family: monospace;
            color: #146b8a;
        }

        .footer {
            margin-top: 2rem;
            text-align: center;
            padding: 1.2rem 1rem;
            font-size: 0.8rem;
            color: #54708f;
            border-top: 1px solid #dfeaf3;
            background: #ffffffdd;
            border-radius: 1rem;
        }

        .footer .powered {
            font-weight: 600;
            color: #1d6f93;
            margin-top: 0.3rem;
        }

        @media (max-width: 640px) {
            body { padding: 1rem; }
            .card { padding: 1.2rem; }
            .card-header h2 { font-size: 1.3rem; }
            .commit-item { flex-direction: column; gap: 0.4rem; }
        }
    </style>
</head>
<body>
<div class="container">
    <div class="page-header">
        <h1><span>🎬</span> ffmpeg-plugin</h1>
        <div class="sub">FFmpeg 增强插件 · 智能音视频处理核心</div>
    </div>

    <!-- 顺序1: FFmpeg版本 -->
    <div class="card">
        <div class="card-header">
            <div class="icon">📦</div>
            <h2>FFmpeg 版本</h2>
            <div class="badge">运行时环境</div>
        </div>
        <div class="version-info">
            <div class="version-tag">ffmpeg version ${escapeHtml(versionNumber)}</div>
            <div class="version-detail">${escapeHtml(baseVersionDesc)}</div>
        </div>
        <div class="config-list">
            ${configChips || '<span class="config-chip">--enable-gpl</span><span class="config-chip">--enable-libx264</span>'}
        </div>
        <div style="margin-top: 12px; font-size: 0.75rem; color: #3b6e8b;">🔧 详细配置见下方完整输出</div>
    </div>

    <!-- 顺序2: 插件更新记录 (最近5条) -->
    <div class="card">
        <div class="card-header">
            <div class="icon">📝</div>
            <h2>ffmpeg-plugin 插件更新记录</h2>
            <div class="badge">最近5条</div>
        </div>
        <ul class="commit-list">
            ${commitsHtml || '<li style="padding:1rem;">暂无提交记录</li>'}
        </ul>
        <div style="margin-top: 0.8rem; font-size: 0.7rem; background: #ecf5fc; padding: 0.3rem 0.8rem; border-radius: 2rem; display: inline-block;">
            🧩 基于主分支 git log -5 --pretty=format
        </div>
    </div>

    <!-- 顺序3: ffmpeg 编解码库 (静态展示) -->
    <div class="card">
        <div class="card-header">
            <div class="icon">⚙️</div>
            <h2>ffmpeg 编解码库</h2>
            <div class="badge">编码器/解码器/滤镜</div>
        </div>
        <div class="codec-grid">
            <div class="codec-category">
                <h3>🎞️ 视频编码器</h3>
                <div class="codec-list">
                    <span class="codec-badge">H.264 / AVC</span>
                    <span class="codec-badge">H.265 / HEVC</span>
                    <span class="codec-badge">VP9</span>
                    <span class="codec-badge">AV1 (libaom)</span>
                    <span class="codec-badge">MPEG-4</span>
                </div>
            </div>
            <div class="codec-category">
                <h3>🎵 音频编码器</h3>
                <div class="codec-list">
                    <span class="codec-badge">AAC</span>
                    <span class="codec-badge">MP3 (LAME)</span>
                    <span class="codec-badge">Opus</span>
                    <span class="codec-badge">FLAC</span>
                    <span class="codec-badge">Vorbis</span>
                </div>
            </div>
            <div class="codec-category">
                <h3>🔓 硬件加速</h3>
                <div class="codec-list">
                    <span class="codec-badge">VAAPI</span>
                    <span class="codec-badge">NVENC</span>
                    <span class="codec-badge">QSV</span>
                    <span class="codec-badge">AMF</span>
                </div>
            </div>
            <div class="codec-category">
                <h3>📦 封装格式</h3>
                <div class="codec-list">
                    <span class="codec-badge">MP4 / MOV</span>
                    <span class="codec-badge">MKV</span>
                    <span class="codec-badge">WebM</span>
                    <span class="codec-badge">HLS (M3U8)</span>
                </div>
            </div>
        </div>
    </div>

    <!-- 底部：动态时间 + Powered by ffmpeg-plugin -->
    <div class="footer">
        <div>生成时间: ${formattedTime}</div>
        <div class="powered">Powered by ffmpeg-plugin</div>
    </div>
</div>
</body>
</html>`
}

/**
 * HTML 转 WebP 图片，返回临时文件路径
 */
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
    await page.setViewport({ width: 1000, height: 600, deviceScaleFactor: 1.5 })
    await page.setContent(html, { waitUntil: 'networkidle0' })
    const bodyHeight = await page.evaluate(() => document.body.scrollHeight)
    await page.setViewport({ width: 1000, height: bodyHeight + 50, deviceScaleFactor: 1.5 })
    await page.screenshot({ path: tempFilePath, type: 'webp', fullPage: true })
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
          reg: '^#ffmpeg版本$',
          fnc: 'getFfmpegInfo'
        }
      ]
    })
  }

  async getFfmpegInfo(e) {
    const waitMsg = await e.reply('🔍 正在查询 FFmpeg 信息，请稍候...', true)

    try {
      const versionRaw = await getFfmpegVersionInfo()
      const versionNumber = extractVersionNumber(versionRaw)
      const configureOptions = extractConfigureOptions(versionRaw)

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

      const html = buildHtml(versionRaw, versionNumber, commits, configureOptions)
      const imagePath = await htmlToImageFile(html)

      // 发送图片
      await e.reply(segment.image(imagePath))

      // 异步删除临时文件
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
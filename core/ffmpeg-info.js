// core/ffmpeg-info.js
// FFmpeg 信息解析 + 版本卡 HTML 构建（纯函数层）。
// 注意：这些函数必须放在 core/ 而不是 apps/ —— Yunzai 的插件加载器会把 apps/*.js
// 中每个 export 都当作插件类去 new，带参数解构的函数（如 buildHtml）会被无参调用
// 而直接把整个插件加载炸掉；core/ 目录不在加载器扫描范围内，export 安全。
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { fileURLToPath } from 'url'
import { escapeHtml } from './io.js'

const execPromise = promisify(exec)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const RES_BASE = 'file:///' + path.join(__dirname, '..', 'resources').replace(/\\/g, '/') + '/'

// ---- 自带字体（来自 git-plugin 同款方案）：中文 LXGW、英文/等宽 Inconsolata、Emoji 兜底 ----
export const FONT_FACE = `
@font-face{font-family:"LXGW";src:url("${RES_BASE}font/LXGWNeoXiHeiScreen.ttf") format("truetype");}
@font-face{font-family:"Inconsolata";src:url("${RES_BASE}font/InconsolataNerdFontPropo-Bold.ttf") format("truetype");}
@font-face{font-family:"NotoEmoji";src:url("${RES_BASE}font/NotoColorEmoji.ttf") format("truetype");}
`

export function extractVersionNumber(versionOutput) {
  const match = versionOutput.match(/ffmpeg version\s+(\S+)/i)
  return match ? match[1] : '未知'
}

/**
 * 解析 ffmpeg 版本元信息：构建来源 + 编译日期
 * 兼容 gyan.dev（版本号前缀 YYYY-MM-DD）、BtbN（版本号后缀 YYYYMMDD / YYYY-MM-DD）等常见构建。
 */
export function parseFfmpegMeta(versionOutput, versionNumber) {
  // 构建来源
  // 注意：BtbN 的 `ffmpeg -version` 输出里通常并不含 "BtbN" 字样，而是以 `N-<构建号>-g<hash>-<日期>`
  // 的版本号形式出现（git master 自动构建），故用版本号正则识别；gyan.dev 则在输出里带域名。
  let buildSource = '未知构建'
  if (versionOutput.includes('gyan.dev')) buildSource = 'Gyan.dev 自动构建'
  else if (versionOutput.includes('BtbN') || /^N-\d+-g/i.test(versionNumber)) buildSource = 'BtbN (Media Autobuild Suite)'
  else if (versionOutput.includes('johnvansickle')) buildSource = 'John Van Sickle (Static)'
  else if (/^[\d.]+$/.test(versionNumber)) buildSource = '官方稳定版'

  // 编译日期：优先取版本号开头的 YYYY-MM-DD（gyan），其次结尾的 YYYYMMDD / YYYY-MM-DD（BtbN 等）
  let compileDate = ''
  let dm = versionNumber.match(/^(\d{4}-\d{2}-\d{2})/)
  if (dm) compileDate = dm[1]
  else {
    dm = versionNumber.match(/(\d{4}-\d{2}-\d{2})$/)
    if (dm) compileDate = dm[1]
    else {
      dm = versionNumber.match(/(\d{8})$/)
      if (dm) {
        const s = dm[1]
        compileDate = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
      }
    }
  }

  return { buildSource, compileDate }
}


/**
 * 提取所有 --enable-xxx 中的特性名（去掉 --enable- 前缀）
 */
export function getEnabledFeatures(versionOutput) {
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
 * 解析 `ffmpeg -encoders` / `-decoders` 输出，按媒体类型归类。
 * 格式样例： ` V..... = libx264  H.264 ...` 或 ` V..... h264  H.264 ...`
 * 首位字符为类型：V=视频 A=音频 S=字幕 . =其它。
 */
export function parseCodecList(stdout) {
  const out = { video: [], audio: [], subtitle: [], other: [] }
  for (const raw of stdout.split('\n')) {
    const line = raw.trim()
    if (!line || line.endsWith(':')) continue
    if (/^[-=]+$/.test(line)) continue
    // 跳过图例行（如 " V..... = Video" / " .....D = Supports ..."）：
    // 实测（gyan.dev 构建）只有图例行含 '='，数据行（编解码器条目）绝不含 '='，
    // 否则图例文本 Video/Audio/Subtitle 会被误当成编解码器名。
    if (line.includes('=')) continue
    const m = line.match(/^([VASF.])[\w.-]{0,6}\s+(\S+)/)
    if (!m) continue
    const name = m[2]
    if (m[1] === 'V') out.video.push(name)
    else if (m[1] === 'A') out.audio.push(name)
    else if (m[1] === 'S') out.subtitle.push(name)
    else out.other.push(name)
  }
  return out
}

export async function getHwaccels() {
  try {
    const { stdout } = await execPromise('ffmpeg -hwaccels')
    return stdout
      .split('\n')
      .map(s => s.trim())
      .filter(s => s && !s.endsWith(':') && /^[a-z0-9_]+$/i.test(s))
  } catch {
    return []
  }
}

export async function getMuxers() {
  try {
    const { stdout } = await execPromise('ffmpeg -muxers')
    const list = []
    for (const raw of stdout.split('\n')) {
      const line = raw.trim()
      // 跳过表头/图例（以 ':' 结尾的行）、分隔线与图例行（" D.. = Demuxing supported"，含 '='）
      if (!line || line.endsWith(':') || line.includes('=')) continue
      // 每行形如 " E mp4  MP4..." / " DE mov,mp4,... QuickTime / MOV"
      // 第 1 个 token 是 E/D/DE 标志位，第 2 个 token 才是封装格式名（可能含逗号）
      const parts = line.split(/\s+/).filter(Boolean)
      // 名字 token 仅允许字母/数字/下划线/逗号，进一步排除图例残留
      if (parts.length >= 2 && /^[A-Za-z0-9_,]+$/.test(parts[1])) list.push(parts[1])
    }
    return [...new Set(list)]
  } catch {
    return []
  }
}


/**
 * 生成版本卡 HTML（使用 SVG 图标替换 Emoji）。
 * 编解码/编译配置的详细内容在 #ff配置 页（core/config-html.js），版本卡只保留数量统计。
 */
export function buildHtml({ versionNumber, commits, icons, meta, stats, configCount }) {
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

  // 编解码库数量统计（仅数字，详情见 #ff配置）
  const { encoders, decoders, hwaccels, muxers } = stats
  const statsGridHtml = [
    { icon: videoIcon, num: encoders.video.length, label: '视频编码器', sub: 'encoders' },
    { icon: videoIcon, num: decoders.video.length, label: '视频解码器', sub: 'decoders' },
    { icon: musicIcon, num: encoders.audio.length, label: '音频编码器', sub: 'encoders' },
    { icon: musicIcon, num: decoders.audio.length, label: '音频解码器', sub: 'decoders' },
    { icon: hardwareIcon, num: hwaccels.length, label: '硬件加速', sub: 'hwaccels' },
    { icon: packagedIcon, num: muxers.length, label: '封装格式', sub: 'muxers' },
    { icon: configIcon, num: configCount, label: '编译配置', sub: '--enable-*' },
  ].map(({ icon, num, label, sub }) => `
      <div class="stat-item">
        <div class="stat-icon">${icon}</div>
        <div class="stat-num">${num}</div>
        <div class="stat-label">${escapeHtml(label)}</div>
        <div class="stat-sub">${escapeHtml(sub)}</div>
      </div>`).join('')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>FFmpeg-Plugin 信息看板</title>
    <style>
${FONT_FACE}
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: "LXGW","NotoEmoji","PingFang SC","Microsoft YaHei",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
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
            font-family: "Inconsolata", monospace;
            font-weight: 700;
            font-size: 1.2rem;
            color: #1b6b87;
            word-break: break-all;
        }

        .version-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 1.5rem;
            margin-top: 0.8rem;
            font-size: 0.98rem;
            color: #2c627a;
            font-family: "Inconsolata", monospace;
        }

        .version-meta .vm-key {
            color: #5f7f9a;
            margin-right: 0.4rem;
        }

        .version-meta .vm-val {
            font-weight: 700;
            color: #1b6b87;
        }

        .config-count {
            font-size: 1.05rem;
            font-weight: 700;
            color: #6b8aa5;
            background: #eef3f8;
            padding: 0.25rem 1rem;
            border-radius: 1rem;
            margin-left: 0.5rem;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
            gap: 1rem;
        }

        .stat-item {
            background: #fbfdff;
            border: 1px solid #e4edf6;
            border-radius: 1.2rem;
            padding: 1.1rem 1rem;
            text-align: center;
        }

        .stat-icon {
            height: 26px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 0.5rem;
        }

        .stat-icon img { height: 24px; width: 24px; }

        .stat-num {
            font-family: "Inconsolata", monospace;
            font-size: 2.1rem;
            font-weight: 700;
            color: #1b6b87;
            line-height: 1.15;
        }

        .stat-label {
            font-size: 1rem;
            font-weight: 700;
            color: #1c5a78;
            margin-top: 0.25rem;
        }

        .stat-sub {
            font-size: 0.82rem;
            font-family: "Inconsolata", monospace;
            color: #6b8aa5;
            margin-top: 0.2rem;
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
        <h1>${ffmpegIcon} FFmpeg-Plugin</h1>
        <div class="sub">基于 FFmpeg 的 Yunzai 插件，提供图像、音视频处理及信息查询功能</div>
    </div>

    <!-- 顺序1: FFmpeg版本 -->
    <div class="card">
        <div class="card-header">
            <h2>${ffmpegIcon} FFmpeg 版本</h2>
        </div>
        <div class="version-info">
            <div class="version-tag">ffmpeg version ${escapeHtml(versionNumber)}</div>
        </div>
        <div class="version-meta">
            <div><span class="vm-key">构建来源：</span><span class="vm-val">${escapeHtml(meta.buildSource)}</span></div>
            <div><span class="vm-key">编译日期：</span><span class="vm-val">${escapeHtml(meta.compileDate || '未知')}</span></div>
        </div>
    </div>

    <!-- 顺序2: 插件更新记录 -->
    <div class="card">
        <div class="card-header">
            <h2>${updateIcon} FFmpeg-Plugin 插件更新记录</h2>
        </div>
        <ul class="commit-list">
            ${commitsHtml || '<li style="padding:1rem;">暂无提交记录</li>'}
        </ul>
    </div>

    <!-- 顺序3: FFmpeg 编解码库（数量统计，详情见 #ff配置） -->
    <div class="card">
        <div class="card-header">
            <h2>${relyIcon} FFmpeg 编解码库 <span class="config-count">详情发送 #ff配置</span></h2>
        </div>
        <div class="stats-grid">
            ${statsGridHtml}
        </div>
    </div>

    <div class="footer">
        <div>生成时间: ${formattedTime}</div>
        <div class="powered">Created By Yunzai · FFmpeg-Plugin · Anyliew</div>
    </div>
</div>
</body>
</html>`
}

// ================= FFmpeg 运行时探测（供 #ff版本 / #ff配置 共用） =================

/** 获取 ffmpeg -version 原始输出 */
export async function getFfmpegVersionInfo() {
  try {
    const { stdout } = await execPromise('ffmpeg -version')
    return stdout
  } catch (err) {
    throw new Error(`执行 ffmpeg -version 失败: ${err.message}`)
  }
}

async function getEncoders() {
  try {
    const { stdout } = await execPromise('ffmpeg -encoders')
    return parseCodecList(stdout)
  } catch {
    return { video: [], audio: [], subtitle: [], other: [] }
  }
}

async function getDecoders() {
  try {
    const { stdout } = await execPromise('ffmpeg -decoders')
    return parseCodecList(stdout)
  } catch {
    return { video: [], audio: [], subtitle: [], other: [] }
  }
}

// 编解码库统计缓存：ffmpeg 编解码/封装列表几乎不变，无需每次都重新 spawn 4 个子进程。
// 缓存 15 分钟，过期或缺失才重新探测。
const CODEC_STATS_TTL = 15 * 60 * 1000
let codecStatsCache = null
let codecStatsCacheAt = 0

/** 并行探测全部编解码 / 硬件 / 封装统计（任一失败不影响其余），带 TTL 缓存 */
export async function getCodecStats() {
  const now = Date.now()
  if (codecStatsCache && now - codecStatsCacheAt < CODEC_STATS_TTL) {
    return codecStatsCache
  }
  const [encoders, decoders, hwaccels, muxers] = await Promise.all([
    getEncoders(),
    getDecoders(),
    getHwaccels(),
    getMuxers(),
  ])
  codecStatsCache = { encoders, decoders, hwaccels, muxers }
  codecStatsCacheAt = now
  return codecStatsCache
}

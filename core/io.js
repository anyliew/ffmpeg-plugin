/**
 * 公共 IO / 下载 / 路径安全 / HTML 转义工具
 * 从原 utils/img-utils.js 抽出，作为插件通用基础层（core）
 */
import fsp from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import axios from 'axios'

export const TEMP_DIR = path.join(process.cwd(), 'temp', 'ffmpeg')

/** 单张图片下载上限（MB） */
export const MAX_IMAGE_MB = 25
/** 大媒体（视频等）下载上限（MB） */
export const MAX_MEDIA_MB = 200
/** 单图最大边长 */
export const MAX_SIDE = 4000
/** 动图最多处理帧数 */
export const MAX_FRAMES = 150
/** GIF 输出大小上限（字节），超过自动缩减 */
export const GIF_MAX_SIZE = 8 * 1024 * 1024
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

// ================= 图标 =================

/** 读取 icon 目录下 SVG 并转为 data URI（供各渲染模块复用，避免重复实现） */
export async function loadIconDataUri(name) {
  const filePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'icon', name.endsWith('.svg') ? name : `${name}.svg`)
  try {
    const content = await fsp.readFile(filePath)
    return `data:image/svg+xml;base64,${content.toString('base64')}`
  } catch {
    return ''
  }
}

// ================= 陈旧临时文件清理 =================

/**
 * 清理 TEMP_DIR 下超过 maxAgeMs 的陈旧临时文件。
 * 场景：进程崩溃/重启导致 delayedRemove 定时器丢失，temp 目录残留跨会话垃圾。
 * 只清本插件专属目录，且文件年龄远超任何正常任务时长，安全。
 */
export async function cleanupStaleTemp(maxAgeMs = 24 * 60 * 60 * 1000) {
  try {
    const entries = await fsp.readdir(TEMP_DIR)
    const now = Date.now()
    await Promise.all(entries.map(async (name) => {
      // 帮助缓存（temp/ffmpeg/help）是目录，跳过
      const full = path.join(TEMP_DIR, name)
      try {
        const st = await fsp.stat(full)
        if (st.isFile() && now - st.mtimeMs > maxAgeMs) await fsp.unlink(full)
      } catch { /* 忽略单文件失败 */ }
    }))
  } catch { /* 目录不存在等情况忽略 */ }
}

// ================= 网络 =================

async function downloadBuffer(url, maxMb = MAX_IMAGE_MB) {
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

export { downloadBuffer }

/**
 * 下载图片到临时文件（带大小上限，统一入口，供各模块复用）
 * @param {string} url 图片地址
 * @param {number} maxMb 体积上限（MB），默认 MAX_IMAGE_MB
 * @returns {Promise<string>} 临时文件路径
 */
export async function downloadImageToTemp(url, maxMb = MAX_IMAGE_MB) {
  const buf = await downloadBuffer(url, maxMb)
  const raw = String(url).split('?')[0]
  const ext = path.extname(raw).toLowerCase() || '.img'
  return await writeTemp(buf, ext)
}

// ================= 路径安全 =================

/**
 * 安全的路径拼接：禁止越出 base 目录（防止 ../ 目录遍历）
 * @returns {string|null} 合法则返回绝对路径，越界返回 null
 */
export function safeJoin(base, ...parts) {
  const root = path.resolve(base)
  const resolved = path.resolve(root, ...parts)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null
  return resolved
}

// ================= HTML 转义 =================

/** HTML 转义（统一导出，供 help 等模块复用，避免多处重复实现） */
export function escapeHtml(str) {
  if (str == null) return ''
  return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]))
}

import { exec } from 'child_process'
import { promisify } from 'util'
import { promises as fs } from 'fs'
import path from 'path'
import { notifyCommandError } from '../core/errorNotify.js'
import { delayedRemove, loadIconDataUri } from '../core/io.js'
import { segment } from '../core/segment.js'
import { renderHtmlToImage } from '../core/puppeteerRender.js'
import { extractVersionNumber, parseFfmpegMeta, getEnabledFeatures, getFfmpegVersionInfo, getCodecStats, buildHtml } from '../core/ffmpeg-info.js'

const execPromise = promisify(exec)

// 命令级并发锁：避免连发时重复渲染多张图
let rendering = false

/**
 * 加载版本卡所需图标
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
    logger.error('获取 Git 日志失败:', err.message)
    return []
  }
}

export class ffmpegVersion extends plugin {
  constructor() {
    super({
      name: '[FFmpeg-Plugin]FFmpeg版本查询',
      dsc: '#ff版本 / #ffmpeg版本',
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
    if (rendering) {
      await e.reply('⏳ 正在生成版本卡片，请稍后再试...', true)
      return false
    }
    rendering = true
    try {
      const versionRaw = await getFfmpegVersionInfo()
      const versionNumber = extractVersionNumber(versionRaw)
      const meta = parseFfmpegMeta(versionRaw, versionNumber)

      const rootDir = process.cwd()
      const pluginDir = path.join(rootDir, 'plugins', 'ffmpeg-plugin')
      let commits = []
      try {
        await fs.access(pluginDir)
        commits = await getGitLogDetailed(pluginDir)
      } catch (err) {
        logger.error('插件目录访问失败:', err.message)
        commits = []
      }

      // 并行探测编解码库 / 硬件加速 / 封装格式统计
      const stats = await getCodecStats()

      // 编译配置项只解析一次，供卡片展示与计数共用
      const configCount = getEnabledFeatures(versionRaw).length

      // 加载所有图标
      const icons = await loadAllIcons()

      const html = buildHtml({ versionNumber, commits, icons, meta, stats, configCount })
      const imagePath = await renderHtmlToImage(html, { width: 1080, scale: 3 })

      await e.reply(segment.image(imagePath))

      // 发送后延时清理临时图片（避免占用 temp 目录）
      delayedRemove(imagePath)
    } catch (err) {
      // 参考 furina-daily：功能指令出错写入 error.log，并合并转发私聊主人
      await notifyCommandError(err, 'FFmpeg版本查询')
      await e.reply(`❌ 查询失败: ${err.message}`, true)
    } finally {
      rendering = false
    }
    return true
  }
}

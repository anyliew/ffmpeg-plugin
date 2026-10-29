import { notifyCommandError } from '../core/errorNotify.js'
import { delayedRemove } from '../core/io.js'
import { segment } from '../core/segment.js'
import { renderHtmlToImage } from '../core/puppeteerRender.js'
import { extractVersionNumber, parseFfmpegMeta, getEnabledFeatures, getFfmpegVersionInfo, getCodecStats } from '../core/ffmpeg-info.js'
import { buildConfigHtml } from '../core/config-html.js'

// 命令级并发锁：避免连发时重复渲染多张图
let rendering = false

export class ffmpegConfig extends plugin {
  constructor() {
    super({
      name: '[FFmpeg-Plugin]FFmpeg配置详情',
      dsc: '#ff配置 / #ffmpeg-plugin配置',
      event: 'message',
      priority: 1000,
      rule: [
        {
          reg: /^#(ffmpeg-plugin|ff)配置$/i,
          fnc: 'getConfigDetail'
        }
      ]
    })
  }

  async getConfigDetail(e) {
    if (rendering) {
      await e.reply('⏳ 正在生成配置详情，请稍后再试...', true)
      return false
    }
    rendering = true
    try {
      const versionRaw = await getFfmpegVersionInfo()
      const versionNumber = extractVersionNumber(versionRaw)
      const meta = parseFfmpegMeta(versionRaw, versionNumber)
      const stats = await getCodecStats()
      const features = getEnabledFeatures(versionRaw)

      const html = buildConfigHtml({ versionNumber, meta, stats, features })
      const imagePath = await renderHtmlToImage(html, { width: 1080, scale: 3 })

      await e.reply(segment.image(imagePath))

      // 发送后延时清理临时图片
      delayedRemove(imagePath)
    } catch (err) {
      // 出错写 error.log 并合并转发私聊主人（同 #ff版本 策略）
      await notifyCommandError(err, 'FFmpeg配置详情')
      await e.reply(`❌ 查询失败: ${err.message}`, true)
    } finally {
      rendering = false
    }
    return true
  }
}

import { exec } from 'child_process'
import { promisify } from 'util'
import { promises as fs } from 'fs'
import { createWriteStream } from 'fs'
import path from 'path'
import axios from 'axios'

const execPromise = promisify(exec)

// 临时文件存放目录（相对于项目根目录）
const TEMP_DIR = path.join(process.cwd(), 'temp', 'ffmpeg')

/**
 * 确保临时目录存在
 */
async function ensureTempDir() {
    await fs.mkdir(TEMP_DIR, { recursive: true })
}

/**
 * 从 URL 中安全地提取文件扩展名（只取路径部分，过滤非法字符）
 * @param {string} url 
 * @returns {string} 扩展名（如 '.mp4'），若无法获取则返回 '.tmp'
 */
function getSafeExtFromUrl(url) {
    try {
        const urlObj = new URL(url)
        const pathname = urlObj.pathname
        let ext = path.extname(pathname)
        if (ext && ext !== '.') {
            // 去除可能残留的查询参数（实际上 pathname 已经没参数了）
            ext = ext.split('?')[0]
            // 只允许字母数字和点，其他字符替换为空
            ext = ext.replace(/[^a-zA-Z0-9.]/g, '')
            if (ext.length > 1 && ext[0] === '.') {
                return ext
            }
        }
    } catch (e) {
        // URL 解析失败，忽略
    }
    return '.tmp'
}

/**
 * 从视频消息段中获取安全的文件扩展名（优先使用 file 字段）
 * @param {Object} segment - 消息段对象（包含 data.file 或 data.url）
 * @returns {string} 扩展名（如 '.mp4'），默认 '.tmp'
 */
function getSafeExtFromSegment(segment) {
    const data = segment.data || {}
    // 1. 优先从 file 字段提取（例如 "f5024dae...mp4"）
    if (data.file && typeof data.file === 'string') {
        const base = path.basename(data.file)
        const ext = path.extname(base)
        if (ext && ext !== '.' && ext.length > 1) {
            return ext
        }
    }
    // 2. 从 URL 提取
    if (data.url) {
        return getSafeExtFromUrl(data.url)
    }
    return '.tmp'
}

/**
 * 从视频 URL 下载到临时文件，并返回文件路径
 * @param {string} url - 视频 URL
 * @param {string} fallbackExt - 可选的备用扩展名（来自消息段的 file 字段）
 */
async function downloadVideoToTemp(url, fallbackExt = null) {
    await ensureTempDir()
    const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        timeout: 60000, // 视频可能较大，延长超时
        maxContentLength: Infinity,
        maxBodyLength: Infinity
    })
    // 确定扩展名：优先使用 fallbackExt，否则从 URL 提取
    let ext = fallbackExt && /^\.[a-zA-Z0-9]+$/.test(fallbackExt) ? fallbackExt : null
    if (!ext) {
        ext = getSafeExtFromUrl(url)
    }
    // 随机文件名，避免冲突
    const tempFile = path.join(TEMP_DIR, `video_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`)
    const writer = createWriteStream(tempFile)
    response.data.pipe(writer)
    await new Promise((resolve, reject) => {
        writer.on('finish', resolve)
        writer.on('error', reject)
    })
    return tempFile
}

/**
 * 使用 ffprobe 获取视频详细信息（容器格式、视频流、音频流等）
 * @returns {Promise<Object>} 包含视频各项信息的对象
 */
async function getVideoInfoByFfprobe(filePath) {
    try {
        const { stdout } = await execPromise(
            `ffprobe -v quiet -print_format json -show_streams -show_format "${filePath}"`
        )
        const data = JSON.parse(stdout)

        // 提取视频流（取第一个视频流）
        const videoStream = data.streams?.find(s => s.codec_type === 'video')
        if (!videoStream) {
            throw new Error('未找到视频流')
        }

        // 容器格式
        const container = data.format?.format_name?.split(',')[0]?.toUpperCase() || '未知'

        // 视频编码
        const videoCodec = videoStream.codec_name?.toUpperCase() || '未知'

        // 分辨率
        const width = videoStream.width || 0
        const height = videoStream.height || 0

        // 时长（秒）
        let durationSec = parseFloat(videoStream.duration || data.format?.duration)
        if (isNaN(durationSec)) durationSec = 0

        // 帧率（fps）
        let fps = null
        const frameRateStr = videoStream.r_frame_rate || videoStream.avg_frame_rate
        if (frameRateStr) {
            const [num, den] = frameRateStr.split('/')
            if (num && den && parseInt(den) !== 0) {
                fps = parseFloat(num) / parseFloat(den)
            } else if (num && !den) {
                fps = parseFloat(num)
            }
        }

        // 视频码率（bps）
        let videoBitrate = parseInt(videoStream.bit_rate)
        if (isNaN(videoBitrate)) videoBitrate = null

        // 音频流信息（取第一个音频流）
        const audioStream = data.streams?.find(s => s.codec_type === 'audio')
        let audioCodec = null
        let audioBitrate = null
        let sampleRate = null
        let channels = null
        if (audioStream) {
            audioCodec = audioStream.codec_name?.toUpperCase() || '未知'
            audioBitrate = parseInt(audioStream.bit_rate)
            if (isNaN(audioBitrate)) audioBitrate = null
            sampleRate = audioStream.sample_rate ? `${parseInt(audioStream.sample_rate) / 1000} kHz` : null
            channels = audioStream.channels ? `${audioStream.channels}` : null
        }

        // 总码率（bps）
        let totalBitrate = parseInt(data.format?.bit_rate)
        if (isNaN(totalBitrate)) totalBitrate = null

        // 文件大小（字节）
        const fileSize = parseInt(data.format?.size) || (await fs.stat(filePath)).size

        // 如果视频码率缺失但总码率和音频码率存在，可推算视频码率
        if (!videoBitrate && totalBitrate && audioBitrate) {
            videoBitrate = totalBitrate - audioBitrate
            if (videoBitrate < 0) videoBitrate = null
        }

        return {
            container,
            videoCodec,
            width,
            height,
            durationSec,
            fps: fps ? parseFloat(fps.toFixed(2)) : null,
            videoBitrate,
            audioCodec,
            audioBitrate,
            sampleRate,
            channels,
            totalBitrate,
            size: fileSize
        }
    } catch (err) {
        throw new Error(`ffprobe 分析失败: ${err.message}`)
    }
}

/**
 * 将秒数格式化为 HH:MM:SS 或 MM:SS
 */
function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '0 秒'
    const hrs = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    if (hrs > 0) {
        return `${hrs} 小时 ${mins} 分 ${secs} 秒`
    } else if (mins > 0) {
        return `${mins} 分 ${secs} 秒`
    } else {
        return `${secs} 秒`
    }
}

/**
 * 格式化码率（bps -> kbps 或 Mbps）
 */
function formatBitrate(bps) {
    if (!bps || bps <= 0) return '未知'
    if (bps >= 1_000_000) return (bps / 1_000_000).toFixed(2) + ' Mbps'
    if (bps >= 1000) return (bps / 1000).toFixed(2) + ' kbps'
    return bps + ' bps'
}

function formatSizeMB(bytes) {
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
}

export class videoInfo extends plugin {
    constructor() {
        super({
            name: '视频信息',
            event: 'message',
            priority: 1000,
            rule: [
                {
                    reg: '^#?视频信息$',
                    fnc: 'videoInfo'
                }
            ]
        })
    }

    async getReplyByMsgId(e) {
        let replyId
        for (const msg of e.message || []) {
            if (msg.type === 'reply') {
                replyId = msg.id
                break
            }
        }
        if (!replyId) return null
        try {
            const rawMessage = await e.bot.sendApi('get_msg', { message_id: replyId })
            if (!rawMessage || !rawMessage.message) return null
            logger.info(`获取到引用消息：\n${JSON.stringify(rawMessage, null, 4)}`)
            return rawMessage
        } catch (error) {
            logger.error(`通过 replyId 获取消息失败: ${error}`)
            return null
        }
    }

    async getReplyBySource(e) {
        if (!e.source || !e.group) return null
        try {
            const messages = await e.group.getChatHistory(e.source.seq, 1)
            const rawMessage = messages.pop()
            if (!rawMessage || !rawMessage.message) return null
            logger.info(`通过 source 获取到消息：\n${JSON.stringify(rawMessage, null, 4)}`)
            return rawMessage
        } catch (error) {
            logger.error(`通过 source 获取消息失败: ${error}`)
            return null
        }
    }

    async getReplyMsg(e) {
        const replyMsg = await this.getReplyByMsgId(e)
        if (replyMsg) return replyMsg
        const sourceMsg = await this.getReplyBySource(e)
        if (sourceMsg) return sourceMsg
        return null
    }

    extractVideosFromMsg(messageArray) {
        if (!Array.isArray(messageArray)) return []
        return messageArray.filter(seg => seg.type === 'video')
    }

    /**
     * 从视频消息段中提取显示用的文件名（含扩展名）
     */
    _getFullDisplayName(videoSegment, idx) {
        const data = videoSegment.data || {}
        // 1. 优先使用明确的 filename 字段
        if (data.filename && typeof data.filename === 'string') {
            return data.filename
        }
        // 2. 尝试从 file 字段提取文件名
        if (data.file && typeof data.file === 'string') {
            const base = path.basename(data.file)
            if (base && base !== '/' && base !== '\\') {
                return base
            }
        }
        // 3. 从 URL 中解析文件名
        if (data.url && typeof data.url === 'string') {
            try {
                const urlWithoutQuery = data.url.split('?')[0]
                const urlBase = path.basename(urlWithoutQuery)
                if (urlBase && urlBase.length > 0 && urlBase !== '/') {
                    return decodeURIComponent(urlBase)
                }
            } catch (e) {
                // 忽略解析错误
            }
        }
        // 4. 回退名称
        return `视频_${idx + 1}`
    }

    /**
     * 获取不带扩展名的文件名主体
     */
    _getNameWithoutExtension(fullName) {
        const extIndex = fullName.lastIndexOf('.')
        if (extIndex > 0) {
            return fullName.substring(0, extIndex)
        }
        return fullName
    }

    async videoInfo(e) {
        let videos = []

        const replyMsg = await this.getReplyMsg(e)
        if (replyMsg && replyMsg.message) {
            videos = this.extractVideosFromMsg(replyMsg.message)
        }

        if (videos.length === 0 && e.message) {
            videos = this.extractVideosFromMsg(e.message)
        }

        if (videos.length === 0) {
            return e.reply('❌ 请回复或引用一条包含视频的消息，或直接发送带有视频的命令。', true)
        }

        const results = []
        for (let idx = 0; idx < videos.length; idx++) {
            const video = videos[idx]
            const url = video.data?.url
            if (!url) {
                results.push(`❌ 视频 ${this._getFullDisplayName(video, idx)}：无法获取 URL`)
                continue
            }

            const fullDisplayName = this._getFullDisplayName(video, idx)
            const displayNameNoExt = this._getNameWithoutExtension(fullDisplayName)

            // 从 file 字段提取备用扩展名
            let fallbackExt = null
            if (video.data?.file) {
                const base = path.basename(video.data.file)
                const ext = path.extname(base)
                if (ext && ext !== '.') {
                    fallbackExt = ext
                }
            }

            let fileSizeBytes = parseInt(video.data?.file_size)
            if (isNaN(fileSizeBytes)) fileSizeBytes = null

            let tempFilePath = null
            try {
                tempFilePath = await downloadVideoToTemp(url, fallbackExt)
                const info = await getVideoInfoByFfprobe(tempFilePath)

                const finalSize = info.size || fileSizeBytes || 0
                const sizeMB = formatSizeMB(finalSize)

                // 构建输出内容
                const lines = [
                    `文件名：${displayNameNoExt}`,
                    `容器：${info.container}`,
                    `分辨率：${info.width} x ${info.height}`,
                    `时长：${formatDuration(info.durationSec)}`,
                    `视频编码：${info.videoCodec}`,
                ]

                if (info.fps) {
                    lines.push(`帧率：${info.fps} fps`)
                }
                if (info.videoBitrate) {
                    lines.push(`视频码率：${formatBitrate(info.videoBitrate)}`)
                }
                if (info.audioCodec) {
                    lines.push(`音频编码：${info.audioCodec}`)
                    if (info.sampleRate) lines.push(`采样率：${info.sampleRate}`)
                    if (info.channels) lines.push(`声道：${info.channels}`)
                    if (info.audioBitrate) lines.push(`音频码率：${formatBitrate(info.audioBitrate)}`)
                }
                if (info.totalBitrate) {
                    lines.push(`总码率：${formatBitrate(info.totalBitrate)}`)
                }
                lines.push(`文件大小：${sizeMB}`)
                lines.push(`URL：${url}`)

                const infoText = lines.join('\n')
                results.push(infoText)
            } catch (err) {
                logger.error(`处理视频失败: ${err.message}`)
                if (err.message.includes('未找到视频流')) {
                    results.push(`❌ 视频 ${displayNameNoExt} 可能不是视频文件（或为 GIF 动图），请使用 #图片信息 命令。`)
                } else {
                    results.push(`❌ 视频 ${displayNameNoExt} 处理失败：${err.message}`)
                }
            } finally {
                if (tempFilePath) {
                    await fs.unlink(tempFilePath).catch(() => {})
                }
            }
        }

        const finalMsg = results.join('\n\n----------------\n\n')

        // 合并转发回复
        try {
            const botInfo = e.bot || {}
            const botUserId = botInfo.uin || (e.self_id || 10000)
            const botNickname = botInfo.nickname || '视频信息助手'
            if (e.group) {
                const forwardMsg = [{
                    message: finalMsg,
                    nickname: botNickname,
                    user_id: botUserId,
                }]
                const forward = await e.group.makeForwardMsg(forwardMsg)
                await e.reply(forward)
            } else {
                await e.reply(finalMsg, true)
            }
        } catch (forwardErr) {
            logger.error('创建合并转发消息失败:', forwardErr)
            await e.reply(finalMsg, true)
        }
    }
}
import { exec } from 'child_process'
import { promisify } from 'util'
import { promises as fs } from 'fs'
import { createWriteStream } from 'fs'
import path from 'path'
import os from 'os'
import axios from 'axios'

const execPromise = promisify(exec)

/**
 * 从音频 URL 下载到临时文件，并返回文件路径
 */
async function downloadAudioToTemp(url) {
    const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        timeout: 30000 // 音频可能较大，延长超时时间
    })
    const ext = path.extname(url).split('?')[0] || '.tmp'
    const tempFile = path.join(os.tmpdir(), `audio_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`)
    const writer = createWriteStream(tempFile)
    response.data.pipe(writer)
    await new Promise((resolve, reject) => {
        writer.on('finish', resolve)
        writer.on('error', reject)
    })
    return tempFile
}

/**
 * 将秒数格式化为 mm:ss 或 hh:mm:ss
 * @param {number} seconds - 时长（秒）
 * @returns {string} 格式化后的时间字符串
 */
function formatDuration(seconds) {
    if (!isFinite(seconds) || seconds <= 0) return '未知'
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`
}

/**
 * 比特率（bps）转 kbps 字符串
 * @param {number} bitrate - 比特率 (bps)
 * @returns {string} 格式化后的比特率，如 "128 kbps"
 */
function formatBitrate(bitrate) {
    if (!bitrate || bitrate <= 0) return '未知'
    const kbps = Math.round(bitrate / 1000)
    return `${kbps} kbps`
}

/**
 * 采样率（Hz）转可读字符串
 * @param {number} sampleRate - 采样率 (Hz)
 * @returns {string} 格式化后的采样率，如 "44.1 kHz"
 */
function formatSampleRate(sampleRate) {
    if (!sampleRate || sampleRate <= 0) return '未知'
    if (sampleRate >= 1000) {
        return `${(sampleRate / 1000).toFixed(1)} kHz`
    }
    return `${sampleRate} Hz`
}

/**
 * 声道数转文本描述
 * @param {number} channels - 声道数
 * @returns {string} 描述，如 "立体声"
 */
function formatChannels(channels) {
    if (channels === 1) return '单声道'
    if (channels === 2) return '立体声'
    if (channels > 2) return `${channels} 声道`
    return '未知'
}

/**
 * 使用 ffprobe 获取音频详细信息
 * @returns {Promise<{format: string, duration: number, bitrate: number, sampleRate: number, channels: number, size: number}>}
 */
async function getAudioInfoByFfprobe(filePath) {
    try {
        const { stdout } = await execPromise(
            `ffprobe -v quiet -print_format json -show_streams -show_format "${filePath}"`
        )
        const data = JSON.parse(stdout)
        const audioStream = data.streams?.find(s => s.codec_type === 'audio')
        if (!audioStream) {
            throw new Error('未找到音频流')
        }

        // 音频格式（编码名称）
        let format = audioStream.codec_name?.toUpperCase() || '未知'
        // 常见格式映射
        const formatMap = {
            'MP3': 'MP3',
            'MP2': 'MP2',
            'AAC': 'AAC',
            'FLAC': 'FLAC',
            'ALAC': 'ALAC',
            'WMA': 'WMA',
            'OGG': 'OGG',
            'OPUS': 'Opus',
            'VORBIS': 'Vorbis',
            'PCM_S16LE': 'WAV',
            'PCM_S16BE': 'WAV',
            'PCM_U8': 'WAV',
            'PCM_S24LE': 'WAV',
        }
        if (formatMap[format]) format = formatMap[format]
        else if (format.startsWith('PCM')) format = 'WAV'

        // 时长（秒）
        let duration = parseFloat(audioStream.duration)
        if (isNaN(duration) && data.format?.duration) {
            duration = parseFloat(data.format.duration)
        }
        if (isNaN(duration)) duration = 0

        // 比特率（bps）优先使用流的比特率，否则使用容器的比特率
        let bitrate = parseInt(audioStream.bit_rate)
        if (isNaN(bitrate) && data.format?.bit_rate) {
            bitrate = parseInt(data.format.bit_rate)
        }
        if (isNaN(bitrate)) bitrate = 0

        // 采样率（Hz）
        let sampleRate = parseInt(audioStream.sample_rate)
        if (isNaN(sampleRate)) sampleRate = 0

        // 声道数
        let channels = parseInt(audioStream.channels)
        if (isNaN(channels)) channels = 0

        // 文件大小
        const fileSize = parseInt(data.format?.size) || (await fs.stat(filePath)).size

        return {
            format,
            duration,
            bitrate,
            sampleRate,
            channels,
            size: fileSize
        }
    } catch (err) {
        throw new Error(`ffprobe 分析失败: ${err.message}`)
    }
}

function formatSizeMB(bytes) {
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
}

export class audioInfo extends plugin {
    constructor() {
        super({
            name: '音频信息',
            event: 'message',
            priority: 1000,
            rule: [
                {
                    reg: '^#?音频信息$',
                    fnc: 'audioInfo'
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

    extractAudiosFromMsg(messageArray) {
        if (!Array.isArray(messageArray)) return []
        // 常见的音频消息段类型：audio, record, file (某些框架可能用 file 传音频)
        return messageArray.filter(seg => seg.type === 'audio' || seg.type === 'record' || (seg.type === 'file' && seg.data?.file_type === 'audio'))
    }

    /**
     * 从音频消息段中提取显示用的文件名（含扩展名）
     * @param {Object} audioSegment - 音频消息段
     * @param {number} idx - 音频序号（用于回退命名）
     * @returns {string} 完整文件名（含扩展名）
     */
    _getFullDisplayName(audioSegment, idx) {
        const data = audioSegment.data || {}
        // 1. 优先使用明确的 filename 字段
        if (data.filename && typeof data.filename === 'string') {
            return data.filename
        }
        // 2. 尝试从 file 字段提取文件名（可能是路径或ID）
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
                // URL 解析失败，忽略
            }
        }
        // 4. 最终回退到通用名称
        return `音频_${idx + 1}`
    }

    /**
     * 获取不带扩展名的文件名主体
     * @param {string} fullName - 完整文件名
     * @returns {string} 文件名主体（去除最后一个点及之后的内容）
     */
    _getNameWithoutExtension(fullName) {
        const extIndex = fullName.lastIndexOf('.')
        if (extIndex > 0) {
            return fullName.substring(0, extIndex)
        }
        return fullName
    }

    async audioInfo(e) {
        let audios = []

        const replyMsg = await this.getReplyMsg(e)
        if (replyMsg && replyMsg.message) {
            audios = this.extractAudiosFromMsg(replyMsg.message)
        }

        if (audios.length === 0 && e.message) {
            audios = this.extractAudiosFromMsg(e.message)
        }

        if (audios.length === 0) {
            return e.reply('❌ 请回复或引用一条包含音频的消息，或直接发送带有音频的命令。', true)
        }

        const results = []
        for (let idx = 0; idx < audios.length; idx++) {
            const audio = audios[idx]
            const url = audio.data?.url
            if (!url) {
                results.push(`❌ 音频 ${this._getFullDisplayName(audio, idx)}：无法获取 URL`)
                continue
            }

            const fullDisplayName = this._getFullDisplayName(audio, idx)
            const displayNameNoExt = this._getNameWithoutExtension(fullDisplayName)

            let fileSizeBytes = parseInt(audio.data?.file_size)
            if (isNaN(fileSizeBytes)) fileSizeBytes = null

            let tempFilePath = null
            try {
                tempFilePath = await downloadAudioToTemp(url)
                const info = await getAudioInfoByFfprobe(tempFilePath)

                const finalSize = info.size || fileSizeBytes || 0
                const sizeMB = formatSizeMB(finalSize)
                const durationStr = formatDuration(info.duration)
                const bitrateStr = formatBitrate(info.bitrate)
                const sampleRateStr = formatSampleRate(info.sampleRate)
                const channelsStr = formatChannels(info.channels)

                const lines = [
                    `文件名：${displayNameNoExt}`,
                    `类型：${info.format}`,
                    `时长：${durationStr}`,
                    `比特率：${bitrateStr}`,
                    `采样率：${sampleRateStr}`,
                    `声道：${channelsStr}`,
                    `大小：${sizeMB}`,
                    `URL：${url}`
                ]

                const infoText = lines.join('\n')
                results.push(infoText)
            } catch (err) {
                logger.error(`处理音频失败: ${err.message}`)
                results.push(`❌ 音频 ${displayNameNoExt} 处理失败：${err.message}`)
            } finally {
                if (tempFilePath) {
                    await fs.unlink(tempFilePath).catch(() => {})
                }
            }
        }

        const finalMsg = results.join('\n\n----------------\n\n')

        // 使用合并转发回复
        try {
            const botInfo = e.bot || {}
            const botUserId = botInfo.uin || (e.self_id || 10000)
            const botNickname = botInfo.nickname || '音频信息助手'
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
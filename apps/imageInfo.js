import { exec } from 'child_process'
import { promisify } from 'util'
import { promises as fs } from 'fs'
import { createWriteStream } from 'fs'
import path from 'path'
import os from 'os'
import axios from 'axios'

const execPromise = promisify(exec)

/**
 * 从图片 URL 下载到临时文件，并返回文件路径
 */
async function downloadImageToTemp(url) {
    const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        timeout: 15000
    })
    const ext = path.extname(url).split('?')[0] || '.tmp'
    const tempFile = path.join(os.tmpdir(), `img_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`)
    const writer = createWriteStream(tempFile)
    response.data.pipe(writer)
    await new Promise((resolve, reject) => {
        writer.on('finish', resolve)
        writer.on('error', reject)
    })
    return tempFile
}

/**
 * 使用 ffprobe 获取图片详细信息（包含帧率）
 * @returns {Promise<{format: string, width: number, height: number, frames: number|null, fps: number|null, size: number}>}
 */
async function getImageInfoByFfprobe(filePath) {
    try {
        const { stdout } = await execPromise(
            `ffprobe -v quiet -print_format json -show_streams -show_format "${filePath}"`
        )
        const data = JSON.parse(stdout)
        const videoStream = data.streams?.find(s => s.codec_type === 'video')
        if (!videoStream) {
            throw new Error('未找到视频/图像流')
        }

        // 格式
        let format = videoStream.codec_name?.toUpperCase() || '未知'
        if (format === 'JPEG') format = 'JPG'
        else if (format === 'PNG') format = 'PNG'
        else if (format === 'GIF') format = 'GIF'
        else if (format === 'WEBP') format = 'WEBP'

        const width = videoStream.width || 0
        const height = videoStream.height || 0

        // 帧数 & 帧率（仅 GIF）
        let frames = null
        let fps = null
        if (format === 'GIF') {
            // 获取帧数
            frames = videoStream.nb_frames
            if (!frames && videoStream.avg_frame_rate) {
                const [num, den] = videoStream.avg_frame_rate.split('/')
                const duration = parseFloat(videoStream.duration)
                if (!isNaN(duration) && num && den) {
                    frames = Math.round(duration * (parseInt(num) / parseInt(den)))
                }
            }
            // 获取帧率 (fps)
            const frameRateStr = videoStream.r_frame_rate || videoStream.avg_frame_rate
            if (frameRateStr) {
                const [num, den] = frameRateStr.split('/')
                if (num && den && parseInt(den) !== 0) {
                    fps = parseFloat(num) / parseFloat(den)
                } else if (num && !den) {
                    fps = parseFloat(num)
                }
            }
        }

        const fileSize = parseInt(data.format?.size) || (await fs.stat(filePath)).size

        return { format, width, height, frames, fps, size: fileSize }
    } catch (err) {
        throw new Error(`ffprobe 分析失败: ${err.message}`)
    }
}

function formatSizeMB(bytes) {
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
}

export class imageInfo extends plugin {
    constructor() {
        super({
            name: '图片信息',
            event: 'message',
            priority: 1000,
            rule: [
                {
                    reg: '^#?图片信息$',
                    fnc: 'imageInfo'
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

    extractImagesFromMsg(messageArray) {
        if (!Array.isArray(messageArray)) return []
        return messageArray.filter(seg => seg.type === 'image')
    }

    /**
     * 从图片消息段中提取显示用的文件名（含扩展名）
     * @param {Object} imgSegment - 图片消息段 { type: 'image', data: {...} }
     * @param {number} idx - 图片序号（用于回退命名）
     * @returns {string} 完整文件名（含扩展名）
     */
    _getFullDisplayName(imgSegment, idx) {
        const data = imgSegment.data || {}
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
        return `图片_${idx + 1}`
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

    /**
     * 根据 fps 计算帧时长（秒每帧），并格式化为可读字符串
     * @param {number} fps - 帧率
     * @returns {string} 格式化后的帧时长字符串，如 "0.01 秒"
     */
    _formatFrameDuration(fps) {
        if (!fps || fps <= 0) return null
        const secondsPerFrame = 1 / fps
        // 保留最多4位小数，去除末尾多余的零
        let formatted = secondsPerFrame.toFixed(4).replace(/\.?0+$/, '')
        // 如果去除后变成空或小数点结尾，补一个零
        if (formatted === '' || formatted === '.') formatted = '0'
        return `${formatted} 秒`
    }

    async imageInfo(e) {
        let images = []

        const replyMsg = await this.getReplyMsg(e)
        if (replyMsg && replyMsg.message) {
            images = this.extractImagesFromMsg(replyMsg.message)
        }

        if (images.length === 0 && e.message) {
            images = this.extractImagesFromMsg(e.message)
        }

        if (images.length === 0) {
            return e.reply('❌ 请回复或引用一条包含图片的消息，或直接发送带有图片的命令。', true)
        }

        const results = []
        for (let idx = 0; idx < images.length; idx++) {
            const img = images[idx]
            const url = img.data?.url
            if (!url) {
                results.push(`❌ 图片 ${this._getFullDisplayName(img, idx)}：无法获取 URL`)
                continue
            }

            const fullDisplayName = this._getFullDisplayName(img, idx)
            const displayNameNoExt = this._getNameWithoutExtension(fullDisplayName)

            let fileSizeBytes = parseInt(img.data?.file_size)
            if (isNaN(fileSizeBytes)) fileSizeBytes = null

            let tempFilePath = null
            try {
                tempFilePath = await downloadImageToTemp(url)
                const info = await getImageInfoByFfprobe(tempFilePath)

                const finalSize = info.size || fileSizeBytes || 0
                const sizeMB = formatSizeMB(finalSize)

                // 按照顺序构建输出行（无外显）
                const lines = [
                    `文件名：${displayNameNoExt}`,
                    `类型：${info.format}`,
                    `大小：${sizeMB}`,
                    `分辨率：${info.width} x ${info.height}`
                ]

                // 动态图额外添加帧数、帧率、帧时长
                if (info.format === 'GIF') {
                    if (info.frames !== null) {
                        lines.push(`帧数：${info.frames} 帧`)
                    }
                    if (info.fps !== null && info.fps > 0) {
                        lines.push(`帧率：${info.fps.toFixed(2)} fps`)
                        const frameDuration = this._formatFrameDuration(info.fps)
                        if (frameDuration) {
                            lines.push(`帧时长：${frameDuration}`)
                        }
                    }
                }

                // URL 始终放在最后
                lines.push(`URL：${url}`)

                const infoText = lines.join('\n')
                results.push(infoText)
            } catch (err) {
                logger.error(`处理图片失败: ${err.message}`)
                results.push(`❌ 图片 ${displayNameNoExt} 处理失败：${err.message}`)
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
            const botNickname = botInfo.nickname || '图片信息助手'
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
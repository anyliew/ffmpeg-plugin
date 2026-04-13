import { exec } from 'child_process'
import { promisify } from 'util'
import { promises as fs } from 'fs'
import { createWriteStream } from 'fs'
import path from 'path'
import os from 'os'
import axios from 'axios'

const execPromise = promisify(exec)

/**
 * 下载图片到临时文件
 * @param {string} url 图片URL
 * @returns {Promise<string>} 临时文件路径
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
 * 使用 ffprobe 快速获取图片格式（仅判断是否为 GIF）
 * @param {string} filePath 文件路径
 * @returns {Promise<string>} 格式名称 (GIF/其他)
 */
async function getImageFormatByFfprobe(filePath) {
    try {
        const { stdout } = await execPromise(
            `ffprobe -v quiet -print_format json -show_streams "${filePath}"`
        )
        const data = JSON.parse(stdout)
        const videoStream = data.streams?.find(s => s.codec_type === 'video')
        if (!videoStream) return '未知'
        let format = videoStream.codec_name?.toUpperCase() || '未知'
        if (format === 'JPEG') format = 'JPG'
        else if (format === 'PNG') format = 'PNG'
        else if (format === 'GIF') format = 'GIF'
        else if (format === 'WEBP') format = 'WEBP'
        return format
    } catch (err) {
        return '未知'
    }
}

/**
 * 使用 ffmpeg 将 GIF 分解为 PNG 序列
 * @param {string} inputGifPath 输入 GIF 文件路径
 * @param {string} outputDir 输出目录
 * @param {number} maxFrames 最大帧数限制
 * @returns {Promise<string[]>} 生成的 PNG 文件路径列表（已排序）
 */
async function decomposeGifToPngs(inputGifPath, outputDir, maxFrames = 100) {
    await fs.mkdir(outputDir, { recursive: true })
    const outputPattern = path.join(outputDir, '%d.png')
    const cmd = `ffmpeg -i "${inputGifPath}" -frames:v ${maxFrames} -f image2 "${outputPattern}"`
    try {
        await execPromise(cmd, { timeout: 30000 })
    } catch (err) {
        throw new Error(`ffmpeg 分解失败: ${err.message}`)
    }
    const files = await fs.readdir(outputDir)
    const pngFiles = files
        .filter(f => f.endsWith('.png'))
        .map(f => ({
            name: f,
            num: parseInt(path.basename(f, '.png'), 10)
        }))
        .sort((a, b) => a.num - b.num)
        .map(item => path.join(outputDir, item.name))
    if (pngFiles.length === 0) {
        throw new Error('未生成任何 PNG 帧')
    }
    return pngFiles
}

/**
 * 递归删除目录
 * @param {string} dirPath 目录路径
 */
async function removeDir(dirPath) {
    try {
        await fs.rm(dirPath, { recursive: true, force: true })
    } catch (e) {
        // 忽略清理错误
    }
}

export class decomposeGif extends plugin {
    constructor() {
        super({
            name: '动图分解',
            event: 'message',
            priority: 1000,
            rule: [
                {
                    reg: '^#?动图分解$',
                    fnc: 'decomposeGif'
                }
            ]
        })
    }

    // 从引用消息中获取回复的原消息
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
     * 获取图片显示名称（用于错误提示）
     */
    _getFullDisplayName(imgSegment, idx) {
        const data = imgSegment.data || {}
        if (data.filename && typeof data.filename === 'string') {
            return data.filename
        }
        if (data.file && typeof data.file === 'string') {
            const base = path.basename(data.file)
            if (base && base !== '/' && base !== '\\') {
                return base
            }
        }
        if (data.url && typeof data.url === 'string') {
            try {
                const urlWithoutQuery = data.url.split('?')[0]
                const urlBase = path.basename(urlWithoutQuery)
                if (urlBase && urlBase.length > 0 && urlBase !== '/') {
                    return decodeURIComponent(urlBase)
                }
            } catch (e) {}
        }
        return `图片_${idx + 1}`
    }

    async decomposeGif(e) {
        let images = []

        // 1. 获取引用或当前消息中的图片
        const replyMsg = await this.getReplyMsg(e)
        if (replyMsg && replyMsg.message) {
            images = this.extractImagesFromMsg(replyMsg.message)
        }

        if (images.length === 0 && e.message) {
            images = this.extractImagesFromMsg(e.message)
        }

        if (images.length === 0) {
            return e.reply('❌ 请回复或引用一条包含 GIF 图片的消息，或直接发送带有 GIF 的命令。', true)
        }

        // 只处理第一张图片
        const targetImg = images[0]
        const url = targetImg.data?.url
        if (!url) {
            return e.reply(`❌ 无法获取图片 URL`, true)
        }

        let tempGifPath = null
        let outputDir = null

        try {
            // 2. 下载图片
            await e.reply(`⏳ 正在下载图片并检测格式...`, true)
            tempGifPath = await downloadImageToTemp(url)

            // 3. 检测格式（仅支持 GIF）
            const format = await getImageFormatByFfprobe(tempGifPath)
            if (format !== 'GIF') {
                return e.reply(`❌ 该图片格式为 ${format}，仅支持 GIF 动图分解。`, true)
            }

            // 4. 创建临时输出目录
            const uniqueId = `${Date.now()}_${Math.random().toString(36).slice(2)}`
            outputDir = path.join(os.tmpdir(), 'ffmpeg_decompose', uniqueId)

            // 5. 分解 GIF（最多 100 帧）
            const maxFrames = 100
            await e.reply(`⏳ 正在分解 GIF...\n温馨提醒（最多 ${maxFrames} 帧）`, true)
            const pngFiles = await decomposeGifToPngs(tempGifPath, outputDir, maxFrames)

            const totalFrames = pngFiles.length
            if (totalFrames === 0) {
                return e.reply('❌ 分解后未生成任何图片帧。', true)
            }

            // 6. 将所有帧读取为 Base64（避免文件锁定）
            const base64Frames = []
            for (const pngPath of pngFiles) {
                const base64Data = await fs.readFile(pngPath, 'base64')
                base64Frames.push(base64Data)
            }

            // 7. 构建合并转发消息（标准 node 格式，支持私聊和群聊）
            const forwardMessages = []
            for (let i = 0; i < totalFrames; i++) {
                const frameNum = i + 1
                forwardMessages.push({
                    type: 'node',
                    data: {
                        name: '动图分解助手',
                        uin: e.bot.uin || e.self_id || 10000,
                        content: [
                            { type: 'text', data: { text: `第 ${frameNum} 帧\n` } },
                            { type: 'image', data: { file: `base64://${base64Frames[i]}` } }
                        ]
                    }
                })
            }

            // 8. 准备 API 参数（根据聊天类型填充 id）
            const apiParams = { messages: forwardMessages }
            if (e.isGroup || e.group_id) {
                apiParams.group_id = e.group_id || e.group?.group_id
            } else {
                apiParams.user_id = e.user_id
            }

            // 9. 发送合并转发
            try {
                await e.bot.sendApi('send_forward_msg', apiParams)
                await e.reply(`✅ 分解完成，共 ${totalFrames} 帧。`, true)
            } catch (forwardErr) {
                logger.error('合并转发失败，降级为逐张发送:', forwardErr)
                await e.reply(`⚠️ 合并转发失败，改为逐张发送（共 ${totalFrames} 帧）`, true)
                for (let i = 0; i < totalFrames; i++) {
                    await e.reply([
                        { type: 'text', data: { text: `第 ${i+1} 帧` } },
                        { type: 'image', data: { file: `base64://${base64Frames[i]}` } }
                    ])
                    await new Promise(r => setTimeout(r, 500))
                }
            }

        } catch (err) {
            logger.error(`动图分解失败: ${err.message}`)
            await e.reply(`❌ 处理失败：${err.message}`, true)
        } finally {
            // 清理临时文件
            if (tempGifPath) {
                await fs.unlink(tempGifPath).catch(() => {})
            }
            if (outputDir) {
                await removeDir(outputDir).catch(() => {})
            }
        }
    }
}
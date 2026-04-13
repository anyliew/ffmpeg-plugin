import fs from 'fs'
import path from 'path'
import axios from 'axios'
import { exec } from 'child_process'
import { promisify } from 'util'
import { createWriteStream } from 'fs'

const execPromise = promisify(exec)

/**
 * 确保临时目录存在
 */
function ensureTempDir() {
    const tempDir = path.join(process.cwd(), 'temp', 'ffmpeg')
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true })
        logger.info(`[语音转换] 创建临时目录: ${tempDir}`)
    }
    return tempDir
}

/**
 * 生成随机临时文件路径
 */
function getTempFilePath(extension) {
    const tempDir = ensureTempDir()
    const randomName = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}${extension}`
    return path.join(tempDir, randomName)
}

/**
 * 下载文件到本地
 */
async function downloadFile(url, destPath) {
    const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        timeout: 60000,
        maxContentLength: 200 * 1024 * 1024
    })
    const writer = createWriteStream(destPath)
    response.data.pipe(writer)
    await new Promise((resolve, reject) => {
        writer.on('finish', resolve)
        writer.on('error', reject)
    })
    return destPath
}

/**
 * 格式化文件大小
 */
function formatSizeMB(bytes) {
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
}

/**
 * 清理临时文件
 */
async function cleanupTempFile(filePath) {
    if (filePath && fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath).catch(err => logger.warn(`清理失败: ${filePath} - ${err.message}`))
    }
}

export class voiceConverter extends plugin {
    constructor() {
        super({
            name: '视频转语音插件（MP3）',
            dsc: '将视频转为MP3语音消息发送',
            event: 'message',
            priority: 310,
            rule: [
                {
                    reg: '^#转语音$',
                    fnc: 'convertToVoice'
                }
            ]
        })
    }

    // ================= 媒体提取 =================

    extractVideoFromMsg(messageArray) {
        if (!Array.isArray(messageArray)) return []
        // 支持 video 类型以及 file 类型中的视频文件
        const videos = messageArray.filter(seg => seg.type === 'video')
        const files = messageArray.filter(seg => seg.type === 'file')
        for (const file of files) {
            const fileName = file.data?.filename || ''
            const ext = path.extname(fileName).toLowerCase()
            const videoExts = ['.mp4', '.mkv', '.avi', '.mov', '.flv', '.webm', '.wmv']
            if (videoExts.includes(ext)) {
                videos.push(file)
            }
        }
        return videos
    }

    async getReplyMsg(e) {
        let replyId = null
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
            return rawMessage
        } catch (error) {
            logger.error(`[语音转换] 获取引用消息失败: ${error}`)
            return null
        }
    }

    async getReplyBySource(e) {
        if (!e.source || !e.group) return null
        try {
            const messages = await e.group.getChatHistory(e.source.seq, 1)
            const rawMessage = messages.pop()
            if (!rawMessage || !rawMessage.message) return null
            return rawMessage
        } catch (error) {
            logger.error(`[语音转换] 通过source获取消息失败: ${error}`)
            return null
        }
    }

    async getQuotedMessage(e) {
        const replyMsg = await this.getReplyMsg(e)
        if (replyMsg) return replyMsg
        return await this.getReplyBySource(e)
    }

    async getTargetVideo(e) {
        let videoSegments = []

        const quoted = await this.getQuotedMessage(e)
        if (quoted && quoted.message) {
            videoSegments = this.extractVideoFromMsg(quoted.message)
        }

        if (videoSegments.length === 0) {
            videoSegments = this.extractVideoFromMsg(e.message)
        }

        if (videoSegments.length === 0) return null

        const seg = videoSegments[0]
        const data = seg.data || {}
        let fileUrl = data.url || data.file
        if (!fileUrl) return null

        let fileName = data.filename || ''
        if (!fileName && fileUrl) {
            const urlPath = fileUrl.split('?')[0]
            fileName = path.basename(urlPath)
        }

        let fileSize = data.file_size ? parseInt(data.file_size) : null
        return {
            segment: seg,
            fileUrl,
            fileName: fileName || 'video.mp4',
            fileSize,
        }
    }

    // ================= FFmpeg 转换 =================

    async runFFmpeg(cmd, timeoutMs = 120000) {
        logger.info(`[语音转换] 执行命令: ${cmd}`)
        try {
            const { stdout, stderr } = await execPromise(cmd, { timeout: timeoutMs, maxBuffer: 50 * 1024 * 1024 })
            if (stderr && !stderr.includes('frame=') && !stderr.includes('size=')) {
                logger.warn(`[语音转换] stderr: ${stderr.slice(0, 300)}`)
            }
            return { stdout, stderr }
        } catch (err) {
            logger.error(`[语音转换] 命令失败: ${err.message}`)
            throw new Error(`FFmpeg处理失败: ${err.stderr || err.message}`)
        }
    }

    /**
     * 视频转 MP3（libmp3lame, q:a 2）
     */
    async convertToMp3File(inputPath, outputPath) {
        const cmd = `ffmpeg -i "${inputPath}" -c:a libmp3lame -q:a 2 "${outputPath}" -y`
        await this.runFFmpeg(cmd, 120000)
        return outputPath
    }

    // ================= 命令处理 =================

    async convertToVoice(e) {
        let inputTempPath = null
        let outputTempPath = null
        try {
            // 发送处理提示
            const hintMsg = await e.reply('⏳ 正在将视频转为语音，请稍等...')

            const video = await this.getTargetVideo(e)
            if (!video) {
                await e.reply('❌ 请回复或发送一个视频文件（mp4, mkv, avi, mov等），然后发送 #转语音')
                return true
            }
            logger.info(`[转语音] 开始处理: ${video.fileName}`)

            // 下载视频
            inputTempPath = getTempFilePath(path.extname(video.fileName) || '.mp4')
            await downloadFile(video.fileUrl, inputTempPath)
            const stat = await fs.promises.stat(inputTempPath)
            logger.info(`[转语音] 下载完成，大小: ${formatSizeMB(stat.size)}`)

            // 转换 MP3
            outputTempPath = getTempFilePath('.mp3')
            await this.convertToMp3File(inputTempPath, outputTempPath)
            const outStat = await fs.promises.stat(outputTempPath)
            logger.info(`[转语音] MP3生成完成，大小: ${formatSizeMB(outStat.size)}`)

            // 发送语音消息（record）
            await e.reply(segment.record(outputTempPath))
            logger.info(`[转语音] MP3语音消息发送成功`)

        } catch (err) {
            logger.error(`[转语音] 失败: ${err.message}`)
            await e.reply(`❌ 转语音失败: ${err.message}`)
        } finally {
            await cleanupTempFile(inputTempPath)
            await cleanupTempFile(outputTempPath)
        }
        return true
    }
}
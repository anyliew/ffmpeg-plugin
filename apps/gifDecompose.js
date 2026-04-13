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
        logger.info(`[GIF转换] 创建临时目录: ${tempDir}`)
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

export class gifConverter extends plugin {
    constructor() {
        super({
            name: '视频转GIF插件',
            dsc: '将视频转为GIF动图（fps=12，宽度320，lanczos算法）',
            event: 'message',
            priority: 310,
            rule: [
                {
                    reg: /^#(转动图|转gif)$/i,
                    fnc: 'convertToGif'
                }
            ]
        })
    }

    // ================= 媒体提取 =================

    extractVideoFromMsg(messageArray) {
        if (!Array.isArray(messageArray)) return []
        return messageArray.filter(seg => seg.type === 'video')
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
            logger.error(`[GIF转换] 获取引用消息失败: ${error}`)
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
            logger.error(`[GIF转换] 通过source获取消息失败: ${error}`)
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
        logger.info(`[GIF转换] 执行命令: ${cmd}`)
        try {
            const { stdout, stderr } = await execPromise(cmd, { timeout: timeoutMs, maxBuffer: 50 * 1024 * 1024 })
            if (stderr && !stderr.includes('frame=') && !stderr.includes('size=')) {
                logger.warn(`[GIF转换] stderr: ${stderr.slice(0, 300)}`)
            }
            return { stdout, stderr }
        } catch (err) {
            logger.error(`[GIF转换] 命令失败: ${err.message}`)
            throw new Error(`FFmpeg处理失败: ${err.stderr || err.message}`)
        }
    }

    async convertToGifFile(inputPath, outputPath) {
        const filter = "fps=12,scale=320:-1:flags=lanczos"
        const cmd = `ffmpeg -i "${inputPath}" -vf "${filter}" -loop 0 "${outputPath}" -y`
        await this.runFFmpeg(cmd, 180000)
        return outputPath
    }

    // ================= 命令处理 =================

    async convertToGif(e) {
        let inputTempPath = null
        let outputTempPath = null
        try {
            // 发送处理提示
            const hintMsg = await e.reply('⏳ 正在将视频转为GIF，请稍等... (较大文件可能需要数十秒)')

            const video = await this.getTargetVideo(e)
            if (!video) {
                await e.reply('❌ 请回复或发送一个视频文件（支持 mp4, mkv, avi, mov 等），例如：回复一条视频消息并发送 #转动图')
                return true
            }
            logger.info(`[GIF转换] 开始处理: ${video.fileName}`)

            // 下载视频
            inputTempPath = getTempFilePath(path.extname(video.fileName) || '.mp4')
            await downloadFile(video.fileUrl, inputTempPath)
            const stat = await fs.promises.stat(inputTempPath)
            logger.info(`[GIF转换] 下载完成，大小: ${formatSizeMB(stat.size)}`)

            // 转换GIF
            outputTempPath = getTempFilePath('.gif')
            await this.convertToGifFile(inputTempPath, outputTempPath)
            const outStat = await fs.promises.stat(outputTempPath)
            logger.info(`[GIF转换] GIF生成完成，大小: ${formatSizeMB(outStat.size)}`)

            // 发送GIF
            await e.reply(segment.image(outputTempPath))
            logger.info(`[GIF转换] GIF发送成功`)

            // 可选：撤回提示消息（无需额外处理）
        } catch (err) {
            logger.error(`[GIF转换] 失败: ${err.message}`)
            await e.reply(`❌ 转动图失败: ${err.message}`)
        } finally {
            await cleanupTempFile(inputTempPath)
            await cleanupTempFile(outputTempPath)
        }
        return true
    }
}
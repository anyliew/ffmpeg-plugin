import { exec } from 'child_process'
import { promisify } from 'util'
import { promises as fs } from 'fs'
import { createWriteStream } from 'fs'
import path from 'path'
import os from 'os'
import axios from 'axios'
import archiver from 'archiver'

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
async function decomposeGifToPngs(inputGifPath, outputDir, maxFrames = 300) {
    await fs.mkdir(outputDir, { recursive: true })
    const outputPattern = path.join(outputDir, '%d.png')
    const cmd = `ffmpeg -i "${inputGifPath}" -frames:v ${maxFrames} -f image2 "${outputPattern}"`
    try {
        await execPromise(cmd, { timeout: 60000 })  // 增加超时到60秒
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
 * 递归删除目录或文件
 * @param {string} targetPath 目录或文件路径
 */
async function removePath(targetPath) {
    try {
        await fs.rm(targetPath, { recursive: true, force: true })
    } catch (e) {
        // 忽略清理错误
    }
}

/**
 * 将 PNG 帧列表打包成 ZIP 文件
 * @param {string[]} pngFiles PNG 文件路径数组
 * @param {string} zipOutputPath 输出的 ZIP 文件路径
 * @returns {Promise<void>}
 */
async function packPngsToZip(pngFiles, zipOutputPath) {
    return new Promise((resolve, reject) => {
        const output = createWriteStream(zipOutputPath)
        const archive = archiver('zip', {
            zlib: { level: 9 } // 最高压缩级别
        })

        output.on('close', () => resolve())
        output.on('error', (err) => reject(err))
        archive.on('error', (err) => reject(err))

        archive.pipe(output)

        // 添加每个 PNG 文件到 ZIP 根目录，保留原文件名
        for (const pngPath of pngFiles) {
            const baseName = path.basename(pngPath)
            archive.file(pngPath, { name: baseName })
        }

        archive.finalize()
    })
}

export class gifPackZip extends plugin {
    constructor() {
        super({
            name: '动图打包',
            event: 'message',
            priority: 1000,
            rule: [
                {
                    reg: '^#?(动图打包|gif打包)$',
                    fnc: 'packGifToZip'
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

    async packGifToZip(e) {
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
        let zipFilePath = null

        try {
            // 2. 下载图片并检测格式
            await e.reply(`⏳ 正在下载图片并检测格式...`, true)
            tempGifPath = await downloadImageToTemp(url)

            const format = await getImageFormatByFfprobe(tempGifPath)
            if (format !== 'GIF') {
                return e.reply(`❌ 该图片格式为 ${format}，仅支持 GIF 动图打包。`, true)
            }

            // 3. 创建临时输出目录
            const uniqueId = `${Date.now()}_${Math.random().toString(36).slice(2)}`
            outputDir = path.join(os.tmpdir(), 'ffmpeg_decompose', uniqueId)

            // 4. 分解 GIF（最多 300 帧）
            const maxFrames = 300
            await e.reply(`⏳ 正在分解 GIF（最多 ${maxFrames} 帧）...`, true)
            const pngFiles = await decomposeGifToPngs(tempGifPath, outputDir, maxFrames)
            const totalFrames = pngFiles.length

            // 5. 打包成 ZIP
            await e.reply(`⏳ 正在打包 ${totalFrames} 帧为 ZIP 文件...`, true)
            zipFilePath = path.join(os.tmpdir(), `gif_frames_${uniqueId}.zip`)
            await packPngsToZip(pngFiles, zipFilePath)

            // 6. 发送 ZIP 文件（OneBot v11 文件消息段）
            const fileSize = (await fs.stat(zipFilePath)).size
            const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2)

            // 构造文件消息段
            const fileMessage = {
                type: 'file',
                data: {
                    file: `file://${zipFilePath}`,
                    name: `gif_frames_${uniqueId}.zip`
                }
            }

            // 发送文件
            await e.bot.sendApi('send_msg', {
                message_type: e.isGroup ? 'group' : 'private',
                user_id: e.isGroup ? undefined : e.user_id,
                group_id: e.isGroup ? (e.group_id || e.group?.group_id) : undefined,
                message: [fileMessage]
            })

            await e.reply(`✅ 打包完成！共 ${totalFrames} 帧，压缩包大小 ${fileSizeMB} MB。`, true)

        } catch (err) {
            logger.error(`动图打包失败: ${err.message}`)
            await e.reply(`❌ 处理失败：${err.message}`, true)
        } finally {
            // 清理临时文件
            if (tempGifPath) {
                await removePath(tempGifPath).catch(() => {})
            }
            if (outputDir) {
                await removePath(outputDir).catch(() => {})
            }
            if (zipFilePath) {
                await removePath(zipFilePath).catch(() => {})
            }
        }
    }
}
import { exec } from 'child_process'
import { promisify } from 'util'
import { promises as fs } from 'fs'
import { createWriteStream } from 'fs'
import path from 'path'
import axios from 'axios'
import sharp from 'sharp'

const execPromise = promisify(exec)

const TEMP_DIR = path.join(process.cwd(), 'temp', 'ffmpeg')
const MAX_SIZE_MB = 10
const MAX_BATCH_COUNT = 10
const DELAY_DELETE_SECONDS = 60

async function ensureTempDir() {
    await fs.mkdir(TEMP_DIR, { recursive: true })
}

function getSafeExtFromUrl(url) {
    try {
        const urlObj = new URL(url)
        const pathname = urlObj.pathname
        let ext = path.extname(pathname)
        if (ext && ext !== '.') {
            ext = ext.split('?')[0]
            ext = ext.replace(/[^a-zA-Z0-9.]/g, '')
            if (ext.length > 1 && ext[0] === '.') return ext
        }
    } catch (e) {}
    return '.tmp'
}

function getSafeExtFromSegment(segment) {
    const data = segment.data || {}
    if (data.file && typeof data.file === 'string') {
        const base = path.basename(data.file)
        const ext = path.extname(base)
        if (ext && ext !== '.' && ext.length > 1) return ext
    }
    if (data.url) return getSafeExtFromUrl(data.url)
    return '.tmp'
}

async function downloadMediaToTemp(url, fallbackExt = null) {
    await ensureTempDir()
    const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        timeout: 60000,
        maxContentLength: MAX_SIZE_MB * 1024 * 1024,
        maxBodyLength: MAX_SIZE_MB * 1024 * 1024
    })
    let ext = fallbackExt && /^\.[a-zA-Z0-9]+$/.test(fallbackExt) ? fallbackExt : null
    if (!ext) ext = getSafeExtFromUrl(url)
    const tempFile = path.join(TEMP_DIR, `crop_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`)
    const writer = createWriteStream(tempFile)
    response.data.pipe(writer)
    await new Promise((resolve, reject) => {
        writer.on('finish', resolve)
        writer.on('error', reject)
    })
    console.log(`[去黑边] 已下载临时文件: ${tempFile} (${(await fs.stat(tempFile)).size} bytes)`)
    return tempFile
}

/**
 * 递归提取消息中的所有图片和视频（异步，支持合并转发）
 * @param {Array|Object} message - 消息段数组或消息对象
 * @param {object} bot - bot 实例，用于调用 get_forward_msg
 * @returns {Promise<Array>} [{ type, url }]
 */
async function extractMediaRecursivelyAsync(message, bot) {
    const mediaList = []

    if (Array.isArray(message)) {
        for (const seg of message) {
            if (seg.type === 'image' || seg.type === 'video') {
                const url = seg.data?.url
                if (url) mediaList.push({ type: seg.type, url })
            } else if (seg.type === 'forward') {
                let forwardContent = seg.data?.content
                if (!forwardContent) {
                    const forwardId = seg.data?.id
                    if (forwardId && bot) {
                        try {
                            const forwardMsg = await bot.sendApi('get_forward_msg', { message_id: forwardId })
                            if (forwardMsg && forwardMsg.messages) {
                                for (const node of forwardMsg.messages) {
                                    const nodeContent = node.content
                                    if (nodeContent && Array.isArray(nodeContent)) {
                                        const subMedia = await extractMediaRecursivelyAsync(nodeContent, bot)
                                        mediaList.push(...subMedia)
                                    }
                                }
                            }
                        } catch (err) {
                            console.error('[去黑边] 获取合并转发内容失败:', err)
                        }
                    }
                } else if (Array.isArray(forwardContent)) {
                    for (const item of forwardContent) {
                        const subMsg = item.message
                        if (subMsg) {
                            const subMedia = await extractMediaRecursivelyAsync(subMsg, bot)
                            mediaList.push(...subMedia)
                        }
                    }
                }
            }
        }
    } else if (message && typeof message === 'object') {
        const msgArray = message.message
        if (Array.isArray(msgArray)) {
            const subMedia = await extractMediaRecursivelyAsync(msgArray, bot)
            mediaList.push(...subMedia)
        }
    }

    return mediaList
}

async function cropMediaWithFFmpeg(inputPath, outputPath, type) {
    if (type === 'image') {
        try {
            console.log(`[去黑边] 使用 sharp 处理图片: ${inputPath}`)
            await sharp(inputPath)
                .trim({ threshold: 16 })
                .toFile(outputPath)
            console.log(`[去黑边] sharp 裁剪完成: ${outputPath}`)
            return true
        } catch (err) {
            console.error(`[去黑边] sharp 裁剪失败: ${err.message}`)
            return false
        }
    }

    // 视频处理
    const detectCmd = [
        'ffmpeg', '-y', '-i', inputPath,
        '-vf', 'cropdetect=16:8:0',
        '-vframes', '20',
        '-f', 'null', '-'
    ]
    console.log(`[去黑边] 执行检测命令: ${detectCmd.join(' ')}`)
    try {
        const { stderr } = await execPromise(detectCmd.join(' '))
        console.log(`[去黑边] 检测输出(stderr):\n${stderr}`)
        const matches = stderr.match(/crop=[0-9]+:[0-9]+:[0-9]+:[0-9]+/g)
        if (!matches || matches.length === 0) {
            console.log('[去黑边] 未检测到黑边')
            return false
        }
        const cropFilter = matches[matches.length - 1]
        console.log(`[去黑边] 检测到黑边参数: ${cropFilter}`)

        const cropCmd = [
            'ffmpeg', '-y', '-i', inputPath,
            '-vf', cropFilter,
            '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
            '-c:a', 'copy', outputPath
        ]
        console.log(`[去黑边] 执行裁剪命令: ${cropCmd.join(' ')}`)
        const { stdout, stderr: cropStderr } = await execPromise(cropCmd.join(' '))
        if (cropStderr) console.log(`[去黑边] 裁剪输出:\n${cropStderr}`)
        console.log(`[去黑边] 裁剪完成，输出文件: ${outputPath}`)
        return true
    } catch (err) {
        console.error(`[去黑边] FFmpeg 裁剪失败: ${err.message}`)
        if (err.stderr) console.error(`[去黑边] stderr:\n${err.stderr}`)
        if (err.stdout) console.error(`[去黑边] stdout:\n${err.stdout}`)
        return false
    }
}

// ========== 新增：去白边处理函数 ==========
async function cropMediaWithFFmpegWhite(inputPath, outputPath, type) {
    if (type === 'image') {
        try {
            console.log(`[去白边] 使用 sharp 处理图片: ${inputPath}`)
            await sharp(inputPath)
                .trim({ threshold: 16 })   // 同样使用阈值16，去除边缘相近色（白边）
                .toFile(outputPath)
            console.log(`[去白边] sharp 裁剪完成: ${outputPath}`)
            return true
        } catch (err) {
            console.error(`[去白边] sharp 裁剪失败: ${err.message}`)
            return false
        }
    }

    // 视频白边处理：先通过 negate 滤镜反转颜色，使白边变黑，再用 cropdetect 检测黑边
    const detectCmd = [
        'ffmpeg', '-y', '-i', inputPath,
        '-vf', 'negate,cropdetect=16:8:0',
        '-vframes', '20',
        '-f', 'null', '-'
    ]
    console.log(`[去白边] 执行检测命令: ${detectCmd.join(' ')}`)
    try {
        const { stderr } = await execPromise(detectCmd.join(' '))
        console.log(`[去白边] 检测输出(stderr):\n${stderr}`)
        const matches = stderr.match(/crop=[0-9]+:[0-9]+:[0-9]+:[0-9]+/g)
        if (!matches || matches.length === 0) {
            console.log('[去白边] 未检测到白边')
            return false
        }
        const cropFilter = matches[matches.length - 1]
        console.log(`[去白边] 检测到白边对应的裁剪参数: ${cropFilter}`)

        const cropCmd = [
            'ffmpeg', '-y', '-i', inputPath,
            '-vf', cropFilter,
            '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
            '-c:a', 'copy', outputPath
        ]
        console.log(`[去白边] 执行裁剪命令: ${cropCmd.join(' ')}`)
        const { stdout, stderr: cropStderr } = await execPromise(cropCmd.join(' '))
        if (cropStderr) console.log(`[去白边] 裁剪输出:\n${cropStderr}`)
        console.log(`[去白边] 裁剪完成，输出文件: ${outputPath}`)
        return true
    } catch (err) {
        console.error(`[去白边] FFmpeg 裁剪失败: ${err.message}`)
        if (err.stderr) console.error(`[去白边] stderr:\n${err.stderr}`)
        if (err.stdout) console.error(`[去白边] stdout:\n${err.stdout}`)
        return false
    }
}
// =======================================

async function delayedDelete(filePaths, delay) {
    await new Promise(resolve => setTimeout(resolve, delay * 1000))
    for (const filePath of filePaths) {
        try {
            if (await fs.stat(filePath).then(() => true).catch(() => false)) {
                await fs.unlink(filePath)
                console.log(`[去黑边] 已清理临时文件: ${filePath}`)
            }
        } catch (err) {
            console.error(`[去黑边] 清理失败 ${filePath}: ${err.message}`)
        }
    }
}

export class cropBlackBorder extends plugin {
    constructor() {
        super({
            name: '[ffmpeg-plugin]去黑边/去白边',
            event: 'message',
            priority: 1000,
            rule: [
                {
                    reg: '^#?去黑边$',
                    fnc: 'crop'
                },
                {
                    reg: '^#?去白边$',   // 新增去白边指令
                    fnc: 'cropWhite'
                }
            ]
        })
    }

    async extractMediaFromMsg(messageArray, bot) {
        if (!Array.isArray(messageArray)) return []
        return await extractMediaRecursivelyAsync(messageArray, bot)
    }

    async getReplyMedia(e) {
        let replyId = null
        for (const msg of e.message || []) {
            if (msg.type === 'reply') {
                replyId = msg.id
                break
            }
        }
        if (replyId) {
            try {
                const rawMsg = await e.bot.sendApi('get_msg', { message_id: replyId })
                if (rawMsg && rawMsg.message) {
                    return await this.extractMediaFromMsg(rawMsg.message, e.bot)
                }
            } catch (err) {
                console.error('[去黑边] 通过 replyId 获取消息失败:', err)
            }
        }
        if (e.source && e.group) {
            try {
                const msgs = await e.group.getChatHistory(e.source.seq, 1)
                const rawMsg = msgs.pop()
                if (rawMsg && rawMsg.message) {
                    return await this.extractMediaFromMsg(rawMsg.message, e.bot)
                }
            } catch (err) {
                console.error('[去黑边] 通过 source 获取消息失败:', err)
            }
        }
        return []
    }

    // 原有去黑边方法
    async crop(e) {
        let mediaList = []

        const replyMedia = await this.getReplyMedia(e)
        if (replyMedia.length > 0) {
            mediaList = replyMedia
        }

        if (mediaList.length === 0 && e.message) {
            mediaList = await this.extractMediaFromMsg(e.message, e.bot)
        }

        if (mediaList.length === 0) {
            return e.reply('❌ 请回复或引用一条包含图片/视频的消息，或直接发送带有图片/视频的命令。', true)
        }

        if (mediaList.length > MAX_BATCH_COUNT) {
            return e.reply(`❌ 媒体数量过多！一次最多处理 ${MAX_BATCH_COUNT} 个。`, true)
        }

        const isBatch = mediaList.length > 1
        if (isBatch) {
            await e.reply(`📦 发现 ${mediaList.length} 个媒体，开始批量处理（去黑边），请耐心等待...`)
        } else {
            await e.reply('✂️ 正在处理中（去黑边），请稍候...')
        }

        const tempFilesPool = []
        const successItems = []
        const failReasons = []

        try {
            for (let idx = 0; idx < mediaList.length; idx++) {
                const media = mediaList[idx]
                const mediaType = media.type
                const url = media.url
                if (!url) {
                    failReasons.push(`第 ${idx+1} 个媒体：无法获取 URL`)
                    continue
                }

                let inputPath = null
                let outputPath = null
                try {
                    inputPath = await downloadMediaToTemp(url)
                    tempFilesPool.push(inputPath)

                    const isImage = mediaType === 'image' || /\.(jpg|jpeg|png|bmp|webp)$/i.test(path.extname(inputPath))
                    const outExt = isImage ? '.jpg' : '.mp4'
                    const baseName = path.basename(inputPath, path.extname(inputPath))
                    outputPath = path.join(TEMP_DIR, `${baseName}_cropped${outExt}`)
                    tempFilesPool.push(outputPath)

                    console.log(`[去黑边] 处理第 ${idx+1} 个媒体: ${mediaType}, 输入=${inputPath}, 输出=${outputPath}`)

                    const success = await cropMediaWithFFmpeg(inputPath, outputPath, isImage ? 'image' : 'video')

                    if (success && await fs.stat(outputPath).then(() => true).catch(() => false)) {
                        console.log(`[去黑边] 裁剪成功，加入成功列表`)
                        successItems.push({ path: outputPath, type: isImage ? 'image' : 'video' })
                    } else {
                        console.log(`[去黑边] 裁剪失败或输出文件不存在`)
                        failReasons.push(`第 ${idx+1} 个${isImage ? '图片' : '视频'}处理失败：可能是格式不支持或未检测到黑边。`)
                    }
                } catch (err) {
                    console.error(`[去黑边] 处理第 ${idx+1} 个媒体时异常:`, err)
                    if (err.message && err.message.includes('maxContentLength')) {
                        failReasons.push(`第 ${idx+1} 个媒体大于 ${MAX_SIZE_MB} MB，拒绝处理。`)
                    } else {
                        failReasons.push(`第 ${idx+1} 个媒体处理异常：${err.message}`)
                    }
                }
            }

            if (failReasons.length > 0) {
                const failMsg = `❌ 批量处理中发生以下错误：\n${failReasons.map((r, i) => `${i+1}. ${r}`).join('\n')}`
                await e.reply(failMsg, true)
            }

            if (successItems.length === 0) {
                if (failReasons.length === 0) {
                    await e.reply('❌ 没有成功处理任何媒体，请检查输入。', true)
                }
                return
            }

            if (successItems.length === 1) {
                const item = successItems[0]
                if (item.type === 'image') {
                    await e.reply(segment.image(item.path))
                } else {
                    await e.reply(segment.video(item.path))
                }
            } else {
                await e.reply(`✅ 成功处理 ${successItems.length} 个媒体（去黑边），正在打包合并转发...`, true)

                const forwardNodes = []
                const botUin = e.bot.uin || e.bot.selfId || '10000'
                const botName = '去黑边助手'

                for (const item of successItems) {
                    const msgSegment = {
                        type: item.type,
                        data: {
                            file: `file://${item.path}`
                        }
                    }
                    const content = [msgSegment]
                    forwardNodes.push({
                        type: 'node',
                        data: {
                            name: botName,
                            uin: String(botUin),
                            content: content
                        }
                    })
                }

                try {
                    if (e.isGroup) {
                        await e.bot.sendApi('send_group_forward_msg', {
                            group_id: e.group_id,
                            messages: forwardNodes
                        })
                    } else {
                        await e.bot.sendApi('send_private_forward_msg', {
                            user_id: e.user_id,
                            messages: forwardNodes
                        })
                    }
                } catch (forwardErr) {
                    console.error('[去黑边] 合并转发发送失败，回退逐条发送:', forwardErr)
                    await e.reply('⚠️ 合并转发发送失败，改为逐条发送。', true)
                    for (const item of successItems) {
                        if (item.type === 'image') {
                            await e.reply(segment.image(item.path))
                        } else {
                            await e.reply(segment.video(item.path))
                        }
                    }
                }
            }
        } finally {
            if (tempFilesPool.length > 0) {
                delayedDelete(tempFilesPool, DELAY_DELETE_SECONDS)
            }
        }
    }

    // ========== 新增：去白边方法 ==========
    async cropWhite(e) {
        let mediaList = []

        const replyMedia = await this.getReplyMedia(e)
        if (replyMedia.length > 0) {
            mediaList = replyMedia
        }

        if (mediaList.length === 0 && e.message) {
            mediaList = await this.extractMediaFromMsg(e.message, e.bot)
        }

        if (mediaList.length === 0) {
            return e.reply('❌ 请回复或引用一条包含图片/视频的消息，或直接发送带有图片/视频的命令。', true)
        }

        if (mediaList.length > MAX_BATCH_COUNT) {
            return e.reply(`❌ 媒体数量过多！一次最多处理 ${MAX_BATCH_COUNT} 个。`, true)
        }

        const isBatch = mediaList.length > 1
        if (isBatch) {
            await e.reply(`📦 发现 ${mediaList.length} 个媒体，开始批量处理（去白边），请耐心等待...`)
        } else {
            await e.reply('✂️ 正在处理中（去白边），请稍候...')
        }

        const tempFilesPool = []
        const successItems = []
        const failReasons = []

        try {
            for (let idx = 0; idx < mediaList.length; idx++) {
                const media = mediaList[idx]
                const mediaType = media.type
                const url = media.url
                if (!url) {
                    failReasons.push(`第 ${idx+1} 个媒体：无法获取 URL`)
                    continue
                }

                let inputPath = null
                let outputPath = null
                try {
                    inputPath = await downloadMediaToTemp(url)
                    tempFilesPool.push(inputPath)

                    const isImage = mediaType === 'image' || /\.(jpg|jpeg|png|bmp|webp)$/i.test(path.extname(inputPath))
                    const outExt = isImage ? '.jpg' : '.mp4'
                    const baseName = path.basename(inputPath, path.extname(inputPath))
                    outputPath = path.join(TEMP_DIR, `${baseName}_cropped_white${outExt}`)
                    tempFilesPool.push(outputPath)

                    console.log(`[去白边] 处理第 ${idx+1} 个媒体: ${mediaType}, 输入=${inputPath}, 输出=${outputPath}`)

                    const success = await cropMediaWithFFmpegWhite(inputPath, outputPath, isImage ? 'image' : 'video')

                    if (success && await fs.stat(outputPath).then(() => true).catch(() => false)) {
                        console.log(`[去白边] 裁剪成功，加入成功列表`)
                        successItems.push({ path: outputPath, type: isImage ? 'image' : 'video' })
                    } else {
                        console.log(`[去白边] 裁剪失败或输出文件不存在`)
                        failReasons.push(`第 ${idx+1} 个${isImage ? '图片' : '视频'}处理失败：可能是格式不支持或未检测到白边。`)
                    }
                } catch (err) {
                    console.error(`[去白边] 处理第 ${idx+1} 个媒体时异常:`, err)
                    if (err.message && err.message.includes('maxContentLength')) {
                        failReasons.push(`第 ${idx+1} 个媒体大于 ${MAX_SIZE_MB} MB，拒绝处理。`)
                    } else {
                        failReasons.push(`第 ${idx+1} 个媒体处理异常：${err.message}`)
                    }
                }
            }

            if (failReasons.length > 0) {
                const failMsg = `❌ 批量处理中发生以下错误：\n${failReasons.map((r, i) => `${i+1}. ${r}`).join('\n')}`
                await e.reply(failMsg, true)
            }

            if (successItems.length === 0) {
                if (failReasons.length === 0) {
                    await e.reply('❌ 没有成功处理任何媒体，请检查输入。', true)
                }
                return
            }

            if (successItems.length === 1) {
                const item = successItems[0]
                if (item.type === 'image') {
                    await e.reply(segment.image(item.path))
                } else {
                    await e.reply(segment.video(item.path))
                }
            } else {
                await e.reply(`✅ 成功处理 ${successItems.length} 个媒体（去白边），正在打包合并转发...`, true)

                const forwardNodes = []
                const botUin = e.bot.uin || e.bot.selfId || '10000'
                const botName = '去白边助手'

                for (const item of successItems) {
                    const msgSegment = {
                        type: item.type,
                        data: {
                            file: `file://${item.path}`
                        }
                    }
                    const content = [msgSegment]
                    forwardNodes.push({
                        type: 'node',
                        data: {
                            name: botName,
                            uin: String(botUin),
                            content: content
                        }
                    })
                }

                try {
                    if (e.isGroup) {
                        await e.bot.sendApi('send_group_forward_msg', {
                            group_id: e.group_id,
                            messages: forwardNodes
                        })
                    } else {
                        await e.bot.sendApi('send_private_forward_msg', {
                            user_id: e.user_id,
                            messages: forwardNodes
                        })
                    }
                } catch (forwardErr) {
                    console.error('[去白边] 合并转发发送失败，回退逐条发送:', forwardErr)
                    await e.reply('⚠️ 合并转发发送失败，改为逐条发送。', true)
                    for (const item of successItems) {
                        if (item.type === 'image') {
                            await e.reply(segment.image(item.path))
                        } else {
                            await e.reply(segment.video(item.path))
                        }
                    }
                }
            }
        } finally {
            if (tempFilesPool.length > 0) {
                delayedDelete(tempFilesPool, DELAY_DELETE_SECONDS)
            }
        }
    }
    // =======================================
}
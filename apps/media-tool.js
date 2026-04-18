import fs from 'fs'
import path from 'path'
import axios from 'axios'
import { exec } from 'child_process'
import { promisify } from 'util'
import { createWriteStream } from 'fs'
import os from 'os'
import archiver from 'archiver'

const execPromise = promisify(exec)

// ================= 公共辅助函数 =================

function ensureTempDir() {
    const tempDir = path.join(process.cwd(), 'temp', 'ffmpeg')
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true })
        logger.info(`[多媒体插件] 创建临时目录: ${tempDir}`)
    }
    return tempDir
}

function getTempFilePath(extension) {
    const tempDir = ensureTempDir()
    const randomName = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}${extension}`
    return path.join(tempDir, randomName)
}

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

function formatSizeMB(bytes) {
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
}

async function cleanupTempFile(filePath) {
    if (filePath && fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath).catch(err => logger.warn(`清理失败: ${filePath} - ${err.message}`))
    }
}

async function removePath(targetPath) {
    try {
        await fs.promises.rm(targetPath, { recursive: true, force: true })
    } catch (e) {}
}

async function getImageFormatByFfprobe(filePath) {
    try {
        const { stdout } = await execPromise(`ffprobe -v quiet -print_format json -show_streams "${filePath}"`)
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

async function decomposeGifToPngs(inputGifPath, outputDir, maxFrames = 100) {
    await fs.promises.mkdir(outputDir, { recursive: true })
    const outputPattern = path.join(outputDir, '%d.png')
    const cmd = `ffmpeg -i "${inputGifPath}" -frames:v ${maxFrames} -f image2 "${outputPattern}"`
    try {
        await execPromise(cmd, { timeout: 60000 })
    } catch (err) {
        throw new Error(`ffmpeg 分解失败: ${err.message}`)
    }
    const files = await fs.promises.readdir(outputDir)
    const pngFiles = files.filter(f => f.endsWith('.png')).map(f => ({
        name: f,
        num: parseInt(path.basename(f, '.png'), 10)
    })).sort((a, b) => a.num - b.num).map(item => path.join(outputDir, item.name))
    if (pngFiles.length === 0) throw new Error('未生成任何 PNG 帧')
    return pngFiles
}

async function packPngsToZip(pngFiles, zipOutputPath) {
    return new Promise((resolve, reject) => {
        const output = createWriteStream(zipOutputPath)
        const archive = archiver('zip', { zlib: { level: 9 } })
        output.on('close', () => resolve())
        output.on('error', reject)
        archive.on('error', reject)
        archive.pipe(output)
        for (const pngPath of pngFiles) {
            archive.file(pngPath, { name: path.basename(pngPath) })
        }
        archive.finalize()
    })
}

// ================= 主插件类 =================

export class mediaTool extends plugin {
    constructor() {
        super({
            name: '[ffmpeg-plugin]多媒体工具箱',
            dsc: '视频转GIF、GIF分解、GIF打包ZIP、视频转语音、音视频转MP3/FLAC',
            event: 'message',
            priority: 310,
            rule: [
                { reg: /^#(转动图|转gif)$/i, fnc: 'convertToGif' },
                { reg: /^#?动图分解$/, fnc: 'decomposeGif' },
                { reg: /^#?gif分解$/i, fnc: 'decomposeGif' },
                { reg: '^#?(动图打包|gif打包)$', fnc: 'packGifToZip' },
                { reg: '^#转语音$', fnc: 'convertToVoice' },
                { reg: '^#转mp3$', fnc: 'convertToMp3' },
                { reg: '^#转flac$', fnc: 'convertToFlac' }
            ]
        })
    }

    // ================= 消息提取方法 =================

    extractVideoFromMsg(messageArray) {
        if (!Array.isArray(messageArray)) return []
        logger.info(`[DEBUG] extractVideoFromMsg 输入数组长度: ${messageArray.length}`)
        const videos = messageArray.filter(seg => seg.type === 'video')
        const files = messageArray.filter(seg => seg.type === 'file')
        logger.info(`[DEBUG] 找到 video 段: ${videos.length}, file 段: ${files.length}`)

        for (const file of files) {
            const data = file.data || {}
            let fileName = data.filename || data.file || ''
            if (!fileName && data.url) {
                const urlPath = data.url.split('?')[0]
                fileName = path.basename(urlPath)
            }
            logger.info(`[DEBUG] file 段数据: ${JSON.stringify(data)}`)
            logger.info(`[DEBUG] 提取的文件名: ${fileName}`)
            const ext = path.extname(fileName).toLowerCase()
            const videoExts = ['.mp4', '.mkv', '.avi', '.mov', '.flv', '.webm', '.wmv']
            const isVideo = videoExts.includes(ext)
            logger.info(`[DEBUG] 扩展名: ${ext}, 是否为视频: ${isVideo}`)
            if (isVideo) {
                videos.push(file)
                logger.info(`[DEBUG] 已将该 file 段加入视频列表`)
            }
        }
        logger.info(`[DEBUG] 最终视频段数量: ${videos.length}`)
        return videos
    }

    extractAudioFromMsg(messageArray) {
        if (!Array.isArray(messageArray)) return []
        const audioSegments = []
        const directAudios = messageArray.filter(seg => seg.type === 'audio')
        audioSegments.push(...directAudios)
        const files = messageArray.filter(seg => seg.type === 'file')
        const audioExts = ['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.opus']
        for (const file of files) {
            const data = file.data || {}
            let fileName = data.filename || data.file || ''
            if (!fileName && data.url) {
                const urlPath = data.url.split('?')[0]
                fileName = path.basename(urlPath)
            }
            const ext = path.extname(fileName).toLowerCase()
            if (audioExts.includes(ext)) {
                audioSegments.push(file)
            }
        }
        return audioSegments
    }

    extractImagesFromMsg(messageArray) {
        if (!Array.isArray(messageArray)) return []
        return messageArray.filter(seg => seg.type === 'image')
    }

    async getReplyByMsgId(e) {
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
            logger.error(`[多媒体插件] 获取引用消息失败: ${error}`)
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
            logger.error(`[多媒体插件] 通过source获取消息失败: ${error}`)
            return null
        }
    }

    async getQuotedMessageRaw(e) {
        const replyMsg = await this.getReplyByMsgId(e)
        if (replyMsg) return replyMsg
        return await this.getReplyBySource(e)
    }

    async _getMediaUrl(segment, e) {
        const data = segment.data || {}
        if (data.url && data.url.trim() !== '') {
            logger.debug(`[多媒体插件] 使用消息段中的 url: ${data.url}`)
            return data.url
        }

        const fileId = data.file_id || data.fileId
        if (!fileId) {
            throw new Error('无法获取文件链接：缺少 url 和 file_id')
        }

        const isGroup = !!(e.isGroup || e.group_id)
        let apiName = '', params = {}
        if (isGroup) {
            apiName = 'get_group_file_url'
            params = { group_id: e.group_id || e.group?.group_id, file_id: fileId }
        } else {
            apiName = 'get_private_file_url'
            params = { user_id: e.user_id, file_id: fileId }
        }

        logger.info(`[多媒体插件] 通过 API ${apiName} 获取文件链接，file_id: ${fileId}`)
        try {
            const result = await e.bot.sendApi(apiName, params)
            const realUrl = result?.url || result?.file_url
            if (!realUrl) throw new Error(`API 返回数据中无 url 字段: ${JSON.stringify(result)}`)
            logger.debug(`[多媒体插件] 获取到真实链接: ${realUrl}`)
            return realUrl
        } catch (err) {
            logger.error(`[多媒体插件] 调用 ${apiName} 失败: ${err.message}`)
            throw new Error(`获取文件下载链接失败: ${err.message}`)
        }
    }

    async getTargetVideo(e) {
        let videoSegments = []
        const quoted = await this.getQuotedMessageRaw(e)
        if (quoted && quoted.message) {
            logger.info(`[DEBUG] 引用消息原始内容: ${JSON.stringify(quoted.message)}`)
            videoSegments = this.extractVideoFromMsg(quoted.message)
            logger.info(`[DEBUG] 从引用消息提取到 ${videoSegments.length} 个视频段`)
        }
        if (videoSegments.length === 0) {
            videoSegments = this.extractVideoFromMsg(e.message)
            logger.info(`[DEBUG] 从当前消息提取到 ${videoSegments.length} 个视频段`)
        }
        if (videoSegments.length === 0) return null

        const seg = videoSegments[0]
        const data = seg.data || {}
        let fileUrl
        try {
            fileUrl = await this._getMediaUrl(seg, e)
        } catch (err) {
            logger.error(`[多媒体插件] 获取视频链接失败: ${err.message}`)
            return null
        }

        let fileName = data.filename || data.file || ''
        if (!fileName && fileUrl) {
            const urlPath = fileUrl.split('?')[0]
            fileName = path.basename(urlPath)
        }
        if (!fileName) fileName = 'video.mp4'

        return {
            segment: seg,
            fileUrl,
            fileName,
            fileSize: data.file_size ? parseInt(data.file_size) : null,
        }
    }

    async getTargetAudio(e) {
        let audioSegments = []
        const quoted = await this.getQuotedMessageRaw(e)
        if (quoted && quoted.message) {
            audioSegments = this.extractAudioFromMsg(quoted.message)
        }
        if (audioSegments.length === 0) {
            audioSegments = this.extractAudioFromMsg(e.message)
        }
        if (audioSegments.length === 0) return null

        const seg = audioSegments[0]
        const data = seg.data || {}
        let fileUrl
        try {
            fileUrl = await this._getMediaUrl(seg, e)
        } catch (err) {
            logger.error(`[多媒体插件] 获取音频链接失败: ${err.message}`)
            return null
        }

        let fileName = data.filename || data.file || ''
        if (!fileName && fileUrl) {
            const urlPath = fileUrl.split('?')[0]
            fileName = path.basename(urlPath)
        }
        if (!fileName) fileName = 'audio.bin'

        return {
            segment: seg,
            fileUrl,
            fileName,
            fileSize: data.file_size ? parseInt(data.file_size) : null,
        }
    }

    async getTargetImage(e) {
        let images = []
        const quoted = await this.getQuotedMessageRaw(e)
        if (quoted && quoted.message) {
            images = this.extractImagesFromMsg(quoted.message)
        }
        if (images.length === 0) {
            images = this.extractImagesFromMsg(e.message)
        }
        if (images.length === 0) return null

        const targetImg = images[0]
        let url
        try {
            url = await this._getMediaUrl(targetImg, e)
        } catch (err) {
            logger.error(`[多媒体插件] 获取图片链接失败: ${err.message}`)
            return null
        }
        return { segment: targetImg, url }
    }

    async getTargetMediaForTranscode(e) {
        const video = await this.getTargetVideo(e)
        if (video) return { type: 'video', ...video }
        const audio = await this.getTargetAudio(e)
        if (audio) return { type: 'audio', ...audio }
        return null
    }

    // ================= FFmpeg 通用 =================

    async runFFmpeg(cmd, timeoutMs = 120000) {
        logger.info(`[多媒体插件] 执行命令: ${cmd}`)
        try {
            const { stdout, stderr } = await execPromise(cmd, { timeout: timeoutMs, maxBuffer: 50 * 1024 * 1024 })
            if (stderr && !stderr.includes('frame=') && !stderr.includes('size=')) {
                logger.warn(`[多媒体插件] stderr: ${stderr.slice(0, 300)}`)
            }
            return { stdout, stderr }
        } catch (err) {
            logger.error(`[多媒体插件] 命令失败: ${err.message}`)
            throw new Error(`FFmpeg处理失败: ${err.stderr || err.message}`)
        }
    }

    async convertToGifFile(inputPath, outputPath) {
        const filter = "fps=12,scale=320:-1:flags=lanczos"
        const cmd = `ffmpeg -i "${inputPath}" -vf "${filter}" -loop 0 "${outputPath}" -y`
        await this.runFFmpeg(cmd, 180000)
        return outputPath
    }

    async convertToMp3File(inputPath, outputPath) {
        const cmd = `ffmpeg -i "${inputPath}" -c:a libmp3lame -q:a 2 "${outputPath}" -y`
        await this.runFFmpeg(cmd, 120000)
        return outputPath
    }

    async convertToFlacFile(inputPath, outputPath) {
        const cmd = `ffmpeg -i "${inputPath}" -c:a flac "${outputPath}" -y`
        await this.runFFmpeg(cmd, 120000)
        return outputPath
    }

    async sendFileAsMessage(e, filePath, displayName) {
        const stat = await fs.promises.stat(filePath)
        const fileSizeMB = (stat.size / (1024 * 1024)).toFixed(2)
        logger.info(`[多媒体插件] 准备发送文件: ${displayName}, 大小 ${fileSizeMB} MB`)

        try {
            const fileMessage = {
                type: 'file',
                data: {
                    file: `file://${filePath}`,
                    name: displayName
                }
            }
            await e.bot.sendApi('send_msg', {
                message_type: e.isGroup ? 'group' : 'private',
                user_id: e.isGroup ? undefined : e.user_id,
                group_id: e.isGroup ? (e.group_id || e.group?.group_id) : undefined,
                message: [fileMessage]
            })
            logger.info(`[多媒体插件] 使用 file:// 发送成功`)
            return true
        } catch (err) {
            logger.warn(`[多媒体插件] file:// 发送失败: ${err.message}, 尝试 base64 回退`)
        }

        try {
            const fileBuffer = await fs.promises.readFile(filePath)
            const base64Data = fileBuffer.toString('base64')
            const fileMessage = {
                type: 'file',
                data: {
                    file: `base64://${base64Data}`,
                    name: displayName
                }
            }
            await e.bot.sendApi('send_msg', {
                message_type: e.isGroup ? 'group' : 'private',
                user_id: e.isGroup ? undefined : e.user_id,
                group_id: e.isGroup ? (e.group_id || e.group?.group_id) : undefined,
                message: [fileMessage]
            })
            logger.info(`[多媒体插件] 使用 base64:// 发送成功`)
            return true
        } catch (err2) {
            logger.error(`[多媒体插件] base64 发送也失败: ${err2.message}`)
            throw new Error(`发送文件失败: ${err2.message}`)
        }
    }

    // ================= 错误处理（合并转发优先） =================

    async sendErrorAsForward(e, errorMessage) {
        const forwardMsg = [
            {
                type: 'node',
                data: {
                    name: '小助手',
                    uin: e.bot.uin || e.self_id || 10000,
                    content: [{ type: 'text', data: { text: `❌ ${errorMessage}` } }]
                }
            }
        ]
        try {
            const apiParams = { messages: forwardMsg }
            if (e.isGroup || e.group_id) {
                apiParams.group_id = e.group_id || e.group?.group_id
            } else {
                apiParams.user_id = e.user_id
            }
            await e.bot.sendApi('send_forward_msg', apiParams)
            return true
        } catch (err) {
            logger.warn(`[多媒体插件] 合并转发错误消息失败，降级为普通消息: ${err.message}`)
            await e.reply(`❌ ${errorMessage}`, true)
            return false
        }
    }

    // ================= 功能实现 =================

    async convertToGif(e) {
        let inputTempPath = null, outputTempPath = null
        try {
            await e.reply('⏳ 正在将视频转为GIF，请稍等...')
            const video = await this.getTargetVideo(e)
            if (!video) {
                await this.sendErrorAsForward(e, '请回复或发送一个视频文件（支持 mp4, mkv, avi, mov 等），例如：回复一条视频消息并发送 #转动图')
                return true
            }
            logger.info(`[GIF转换] 开始处理: ${video.fileName}`)
            inputTempPath = getTempFilePath(path.extname(video.fileName) || '.mp4')
            await downloadFile(video.fileUrl, inputTempPath)
            const stat = await fs.promises.stat(inputTempPath)
            logger.info(`[GIF转换] 下载完成，大小: ${formatSizeMB(stat.size)}`)
            outputTempPath = getTempFilePath('.gif')
            await this.convertToGifFile(inputTempPath, outputTempPath)
            const outStat = await fs.promises.stat(outputTempPath)
            logger.info(`[GIF转换] GIF生成完成，大小: ${formatSizeMB(outStat.size)}`)
            await e.reply(segment.image(outputTempPath))
            logger.info(`[GIF转换] GIF发送成功`)
        } catch (err) {
            logger.error(`[GIF转换] 失败: ${err.message}`)
            await this.sendErrorAsForward(e, `转动图失败: ${err.message}`)
        } finally {
            await cleanupTempFile(inputTempPath)
            await cleanupTempFile(outputTempPath)
        }
        return true
    }

    async decomposeGif(e) {
        let tempGifPath = null, outputDir = null
        try {
            const targetImage = await this.getTargetImage(e)
            if (!targetImage) {
                await this.sendErrorAsForward(e, '请回复或引用一条包含 GIF 图片的消息，或直接发送带有 GIF 的命令。')
                return true
            }
            tempGifPath = await downloadImageToTemp(targetImage.url)
            const format = await getImageFormatByFfprobe(tempGifPath)
            if (format !== 'GIF') {
                await this.sendErrorAsForward(e, `该图片格式为 ${format}，仅支持 GIF 动图分解。`)
                return true
            }
            const uniqueId = `${Date.now()}_${Math.random().toString(36).slice(2)}`
            outputDir = path.join(os.tmpdir(), 'ffmpeg_decompose', uniqueId)
            const maxFrames = 100
            const pngFiles = await decomposeGifToPngs(tempGifPath, outputDir, maxFrames)
            const totalFrames = pngFiles.length
            if (totalFrames === 0) {
                await this.sendErrorAsForward(e, '分解后未生成任何图片帧。')
                return true
            }

            // 构建合并转发消息节点
            const forwardMessages = []
            // 节点1：下载检测提示
            forwardMessages.push({
                type: 'node',
                data: {
                    name: '小助手',
                    uin: e.bot.uin || e.self_id || 10000,
                    content: [{ type: 'text', data: { text: '⏳ 正在下载图片并检测格式...' } }]
                }
            })
            // 节点2：分解提示（含温馨提醒）
            forwardMessages.push({
                type: 'node',
                data: {
                    name: '小助手',
                    uin: e.bot.uin || e.self_id || 10000,
                    content: [{ type: 'text', data: { text: `⏳ 正在分解 GIF...\n温馨提醒（最多 ${maxFrames} 帧）` } }]
                }
            })
            // 后续节点：每一帧图片 + 文字说明
            for (let i = 0; i < totalFrames; i++) {
                const base64Data = await fs.promises.readFile(pngFiles[i], 'base64')
                forwardMessages.push({
                    type: 'node',
                    data: {
                        name: '动图分解助手',
                        uin: e.bot.uin || e.self_id || 10000,
                        content: [
                            { type: 'text', data: { text: `第 ${i+1} 帧\n` } },
                            { type: 'image', data: { file: `base64://${base64Data}` } }
                        ]
                    }
                })
            }
            // 最后一个节点：完成信息
            forwardMessages.push({
                type: 'node',
                data: {
                    name: '小助手',
                    uin: e.bot.uin || e.self_id || 10000,
                    content: [{ type: 'text', data: { text: `✅ 分解完成，共 ${totalFrames} 帧。` } }]
                }
            })

            const apiParams = { messages: forwardMessages }
            if (e.isGroup || e.group_id) {
                apiParams.group_id = e.group_id || e.group?.group_id
            } else {
                apiParams.user_id = e.user_id
            }
            try {
                await e.bot.sendApi('send_forward_msg', apiParams)
            } catch (forwardErr) {
                logger.error('合并转发失败，降级为逐张发送:', forwardErr)
                // 降级：先发送两个文本提示
                await e.reply('⏳ 正在下载图片并检测格式...\n⏳ 正在分解 GIF...\n温馨提醒（最多 100 帧）', true)
                // 逐张发送图片
                for (let i = 0; i < totalFrames; i++) {
                    const base64Data = await fs.promises.readFile(pngFiles[i], 'base64')
                    await e.reply([
                        { type: 'text', data: { text: `第 ${i+1} 帧` } },
                        { type: 'image', data: { file: `base64://${base64Data}` } }
                    ])
                    await new Promise(r => setTimeout(r, 500))
                }
                await e.reply(`✅ 分解完成，共 ${totalFrames} 帧。`, true)
            }
        } catch (err) {
            logger.error(`动图分解失败: ${err.message}`)
            await this.sendErrorAsForward(e, `处理失败：${err.message}`)
        } finally {
            if (tempGifPath) await cleanupTempFile(tempGifPath).catch(() => {})
            if (outputDir) await removePath(outputDir).catch(() => {})
        }
    }

    async packGifToZip(e) {
        let tempGifPath = null, outputDir = null, zipFilePath = null
        try {
            const targetImage = await this.getTargetImage(e)
            if (!targetImage) {
                await this.sendErrorAsForward(e, '请回复或引用一条包含 GIF 图片的消息，或直接发送带有 GIF 的命令。')
                return true
            }
            tempGifPath = await downloadImageToTemp(targetImage.url)
            const format = await getImageFormatByFfprobe(tempGifPath)
            if (format !== 'GIF') {
                await this.sendErrorAsForward(e, `该图片格式为 ${format}，仅支持 GIF 动图打包。`)
                return true
            }
            const uniqueId = `${Date.now()}_${Math.random().toString(36).slice(2)}`
            outputDir = path.join(os.tmpdir(), 'ffmpeg_decompose', uniqueId)
            const maxFrames = 300
            const pngFiles = await decomposeGifToPngs(tempGifPath, outputDir, maxFrames)
            const totalFrames = pngFiles.length
            zipFilePath = path.join(os.tmpdir(), `gif_frames_${uniqueId}.zip`)
            await packPngsToZip(pngFiles, zipFilePath)
            const displayName = `gif_frames_${uniqueId}.zip`
            await this.sendFileAsMessage(e, zipFilePath, displayName)
            // 不发送任何文本提示
        } catch (err) {
            logger.error(`动图打包失败: ${err.message}`)
            await this.sendErrorAsForward(e, `处理失败：${err.message}`)
        } finally {
            if (tempGifPath) await cleanupTempFile(tempGifPath).catch(() => {})
            if (outputDir) await removePath(outputDir).catch(() => {})
            if (zipFilePath) await cleanupTempFile(zipFilePath).catch(() => {})
        }
    }

    async convertToVoice(e) {
        let inputTempPath = null, outputTempPath = null
        try {
            await e.reply('⏳ 正在将视频转为语音，请稍等...')
            const video = await this.getTargetVideo(e)
            if (!video) {
                await this.sendErrorAsForward(e, '请回复或发送一个视频文件（mp4, mkv, avi, mov等），然后发送 #转语音')
                return true
            }
            logger.info(`[转语音] 开始处理: ${video.fileName}`)
            inputTempPath = getTempFilePath(path.extname(video.fileName) || '.mp4')
            await downloadFile(video.fileUrl, inputTempPath)
            const stat = await fs.promises.stat(inputTempPath)
            logger.info(`[转语音] 下载完成，大小: ${formatSizeMB(stat.size)}`)
            outputTempPath = getTempFilePath('.mp3')
            await this.convertToMp3File(inputTempPath, outputTempPath)
            const outStat = await fs.promises.stat(outputTempPath)
            logger.info(`[转语音] MP3生成完成，大小: ${formatSizeMB(outStat.size)}`)
            await e.reply(segment.record(outputTempPath))
            logger.info(`[转语音] MP3语音消息发送成功`)
        } catch (err) {
            logger.error(`[转语音] 失败: ${err.message}`)
            await this.sendErrorAsForward(e, `转语音失败: ${err.message}`)
        } finally {
            await cleanupTempFile(inputTempPath)
            await cleanupTempFile(outputTempPath)
        }
        return true
    }

    async convertToMp3(e) {
        let inputTempPath = null, outputTempPath = null
        try {
            await e.reply('⏳ 正在将音视频转为 MP3 文件，请稍等...')
            const media = await this.getTargetMediaForTranscode(e)
            if (!media) {
                await this.sendErrorAsForward(e, '请回复或发送一个视频/音频文件（支持 mp4, mkv, avi, mov, mp3, flac, wav, m4a 等），然后发送 #转mp3')
                return true
            }
            logger.info(`[转MP3] 开始处理: ${media.fileName}`)
            inputTempPath = getTempFilePath(path.extname(media.fileName) || '.bin')
            await downloadFile(media.fileUrl, inputTempPath)
            const stat = await fs.promises.stat(inputTempPath)
            logger.info(`[转MP3] 下载完成，大小: ${formatSizeMB(stat.size)}`)
            outputTempPath = getTempFilePath('.mp3')
            await this.convertToMp3File(inputTempPath, outputTempPath)
            const outStat = await fs.promises.stat(outputTempPath)
            logger.info(`[转MP3] MP3 生成完成，大小: ${formatSizeMB(outStat.size)}`)
            const outputFileName = path.basename(media.fileName, path.extname(media.fileName)) + '.mp3'
            await this.sendFileAsMessage(e, outputTempPath, outputFileName)
            logger.info(`[转MP3] 文件发送成功`)
            // 不发送完成提示消息
        } catch (err) {
            logger.error(`[转MP3] 失败: ${err.message}`)
            await this.sendErrorAsForward(e, `转 MP3 失败: ${err.message}`)
        } finally {
            await cleanupTempFile(inputTempPath)
            await cleanupTempFile(outputTempPath)
        }
        return true
    }

    async convertToFlac(e) {
        let inputTempPath = null, outputTempPath = null
        try {
            await e.reply('⏳ 正在将音视频转为 FLAC 文件，请稍等...')
            const media = await this.getTargetMediaForTranscode(e)
            if (!media) {
                await this.sendErrorAsForward(e, '请回复或发送一个视频/音频文件（支持 mp4, mkv, avi, mov, mp3, flac, wav, m4a 等），然后发送 #转flac')
                return true
            }
            logger.info(`[转FLAC] 开始处理: ${media.fileName}`)
            inputTempPath = getTempFilePath(path.extname(media.fileName) || '.bin')
            await downloadFile(media.fileUrl, inputTempPath)
            const stat = await fs.promises.stat(inputTempPath)
            logger.info(`[转FLAC] 下载完成，大小: ${formatSizeMB(stat.size)}`)
            outputTempPath = getTempFilePath('.flac')
            await this.convertToFlacFile(inputTempPath, outputTempPath)
            const outStat = await fs.promises.stat(outputTempPath)
            logger.info(`[转FLAC] FLAC 生成完成，大小: ${formatSizeMB(outStat.size)}`)
            const outputFileName = path.basename(media.fileName, path.extname(media.fileName)) + '.flac'
            await this.sendFileAsMessage(e, outputTempPath, outputFileName)
            logger.info(`[转FLAC] 文件发送成功`)
            // 不发送完成提示消息
        } catch (err) {
            logger.error(`[转FLAC] 失败: ${err.message}`)
            await this.sendErrorAsForward(e, `转 FLAC 失败: ${err.message}`)
        } finally {
            await cleanupTempFile(inputTempPath)
            await cleanupTempFile(outputTempPath)
        }
        return true
    }
}
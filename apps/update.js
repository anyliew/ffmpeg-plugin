import fs from "node:fs/promises"

let updating = false

export class ffmpegUpdate extends plugin {
  constructor() {
    super({
      name: "FFmpeg插件更新",
      dsc: "#ff更新 / #ffmpeg-plugin更新",
      event: "message",
      priority: -Infinity,
      rule: [
        {
          reg: /^#(ff|ffmpeg-plugin)(强制)?更新$/i,
          fnc: "updateFFmpeg",
        },
      ],
    })
  }

  get isForce() {
    return /强制/.test(this.e.msg)
  }

  async updateFFmpeg() {
    if (!this.e.isMaster) {
      await this.reply("只有主人可以使用此命令")
      return false
    }

    if (updating) {
      await this.reply("正在更新中，请稍后再试")
      return false
    }

    updating = true
    const pluginPath = "plugins/ffmpeg-plugin"

    try {
      // 检查目录是否存在
      const exists = await fs.access(pluginPath).then(() => true).catch(() => false)
      if (!exists) {
        await this.reply(`未找到插件目录：${pluginPath}`)
        return false
      }

      const oldCommit = await this.getCommitId(pluginPath)
      const cmd = this.isForce
        ? await this.buildForceCommand(pluginPath)
        : "git pull"

      logger.mark(`[FFmpeg] 开始${this.isForce ? "强制" : ""}更新`)
      await this.reply(`开始${this.isForce ? "强制" : ""}更新 ffmpeg-plugin`)

      const ret = await this.exec(cmd, pluginPath)
      if (ret.error) {
        await this.handleGitError(ret, pluginPath)
        return false
      }

      const time = await this.getTime(pluginPath)
      const isUpToDate = /Already up|已经是最新/.test(ret.stdout)

      if (isUpToDate) {
        await this.reply(`ffmpeg-plugin 已是最新\n最后更新时间：${time}`)
        return false
      }

      // 有更新
      const pkgChanged = /package\.json/.test(ret.stdout)
      await this.reply(`ffmpeg-plugin 更新成功\n更新时间：${time}`)
      await this.reply(await this.getLog(oldCommit, pluginPath))

      if (pkgChanged) {
        await this.updateDeps(pluginPath)
      }

      await this.reply("更新完成（未自动重启，如需重启请手动操作）")
    } catch (err) {
      logger.error(`[FFmpeg] 异常：${err}`)
      await this.reply(`更新出错：${err.message}`)
    } finally {
      updating = false
    }
  }

  // 构建强制更新命令（动态获取远程分支）
  async buildForceCommand(cwdPath) {
    const remoteBranch = await this.getRemoteBranch(cwdPath)
    if (!remoteBranch) {
      throw new Error("无法获取远程分支，强制更新失败")
    }
    return `git reset --hard ${remoteBranch} && git pull --rebase`
  }

  // 执行命令
  async exec(cmd, cwdPath) {
    return Bot.exec(cmd, { cwd: cwdPath })
  }

  // 获取短 commit hash
  async getCommitId(cwdPath) {
    const ret = await this.exec("git rev-parse --short HEAD", cwdPath)
    return ret.stdout.trim()
  }

  // 获取最后提交时间
  async getTime(cwdPath) {
    const ret = await this.exec('git log -1 --pretty=%cd --date=format:"%F %T"', cwdPath)
    return ret.stdout.trim()
  }

  // 获取当前分支名
  async getBranch(cwdPath) {
    const ret = await this.exec("git branch --show-current", cwdPath)
    return ret.stdout.trim()
  }

  // 获取远程仓库名
  async getRemote(branch, cwdPath) {
    const ret = await this.exec(`git config branch.${branch}.remote`, cwdPath)
    return ret.stdout.trim()
  }

  // 获取完整远程分支名 (remote/branch)
  async getRemoteBranch(cwdPath) {
    const branch = await this.getBranch(cwdPath)
    if (!branch) return ""
    const remote = await this.getRemote(branch, cwdPath)
    if (!remote) return ""
    return `${remote}/${branch}`
  }

  // 错误处理
  async handleGitError(ret, cwdPath) {
    const errMsg = ret.error?.message || ""
    const stdout = ret.stdout || ""

    if (/unable to access|无法访问/.test(errMsg)) {
      const url = errMsg.match(/'(.*?)'/)?.[1] || "未知地址"
      await this.reply(`远程仓库连接错误：${url}`)
    } else if (/not found|未找到|does not exist|不存在|Authentication failed/.test(errMsg)) {
      const url = errMsg.match(/'(.*?)'/)?.[1] || "未知地址"
      await this.reply(`远程仓库地址错误：${url}`)
    } else if (/be overwritten by merge|Merge conflict/.test(errMsg) || /合并冲突/.test(stdout)) {
      await this.reply(`存在合并冲突，请手动解决或使用 #ff强制更新 覆盖本地修改`)
    } else if (/divergent branches/.test(errMsg)) {
      const rebaseRet = await this.exec("git pull --rebase", cwdPath)
      if (!rebaseRet.error && /Successfully rebased|成功变基/.test(rebaseRet.stdout + rebaseRet.stderr)) {
        await this.reply("已通过 rebase 解决分支偏离")
        return
      }
      await this.reply(`分支偏离，请手动处理或使用 #ff强制更新`)
    } else {
      await this.reply(`更新失败：${errMsg}\n${stdout}`)
    }
  }

  // 获取更新日志
  async getLog(oldCommitId, cwdPath) {
    const ret = await this.exec('git log -100 --pretty="%h||[%cd] %s" --date=format:"%F %T"', cwdPath)
    if (ret.error) return "无法获取更新日志"

    const lines = ret.stdout.split("\n")
    const logs = []
    for (const line of lines) {
      const [hash, msg] = line.split("||")
      if (hash === oldCommitId) break
      if (msg && !msg.includes("Merge branch")) logs.push(msg)
    }
    if (logs.length === 0) return "无新日志"
    return `更新日志（共${logs.length}条）：\n${logs.join("\n")}`
  }

  // 更新依赖
  async updateDeps(cwdPath) {
    if (process.platform === "win32") {
      await this.reply("检测到 package.json 变更，请手动执行 pnpm install（或在 Windows 下使用 #关机 后手动安装）")
      return
    }
    await this.reply("检测到依赖更新，正在执行 pnpm install ...")
    const ret = await this.exec("pnpm install", cwdPath)
    if (ret.error) {
      await this.reply(`依赖安装失败：${ret.error.message}`)
    } else {
      await this.reply("依赖更新完成")
    }
  }
}
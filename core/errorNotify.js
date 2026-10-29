// core/errorNotify.js
// 指令级错误上报：功能指令（#ff版本 / #ff帮助 / #ff更新 等）出错时，
// ① 写入 Yunzai error.log（事实记录）；
// ② 以「合并转发」私聊全部主人，把错误信息主动推送出来。
//
// 参考 furina-daily / git-plugin 的错误上报方案，三条铁律：
//   1. error.log 是事实记录（logger.error 照旧），本模块只是主动告警的额外通道；
//   2. 冷却去重：同一指令来源在冷却期内不重复打扰；
//   3. 本模块自身绝不抛错——通知失败只记日志，绝不能把主流程炸第二次。
const TAG = '[FFmpeg-Plugin/ErrorNotify]'
const COOLDOWN_MS = 5 * 60 * 1000

const clip = (s, n) => {
  s = String(s || '')
  return s.length > n ? s.slice(0, n) + '…' : s
}

// Yunzai 配置模块（lib/config/config.js）懒加载 + 失败容忍：
// 非 Yunzai 环境下 import 会失败，此时降级到 Bot 暴露的主人信息。
let cfgPromise = null
function loadYunzaiCfg() {
  if (cfgPromise) return cfgPromise
  // 测试注入点：单测环境下无法加载真实 cfg（本机加载会因文件监听被沙箱终止），
  // 可通过 globalThis.__ffmpegYunzaiCfg 提供同结构对象验证取主人逻辑。
  if (globalThis.__ffmpegYunzaiCfg) {
    cfgPromise = Promise.resolve(globalThis.__ffmpegYunzaiCfg)
    return cfgPromise
  }
  cfgPromise = import('../../../lib/config/config.js')
    .then(m => m.default || m)
    .catch(() => null)
  return cfgPromise
}

function pushMaster(out, v) {
  if (v == null) return
  // other.yaml 的 masterQQ 可能含 "stdin" 这类非 QQ 占位值，只取 5-11 位数字
  const m = String(v).match(/\d{5,11}/)
  if (m && !out.includes(m[0])) out.push(m[0])
}

/**
 * 取主人 QQ 列表，优先级：
 *   ① config/config/other.yaml 的 masterQQ（Yunzai 主人的权威来源，cfg.masterQQ）
 *   ② other.yaml 的 master（"botUin:masterUin" 映射，取全部主人）
 *   ③ Bot.master / Bot.cfg.master（协议端或框架自行暴露时的兜底）
 */
async function getMasters() {
  const out = []
  try {
    const cfg = await loadYunzaiCfg()
    const mq = cfg?.masterQQ
    // masterQQ 可能是数组，也可能是 other.yaml 里单个数字/字符串，统一归一为数组
    const mqList = Array.isArray(mq) ? mq : (mq != null ? [mq] : [])
    for (const v of mqList) pushMaster(out, v)
    const master = cfg?.master
    if (master && typeof master === 'object' && !Array.isArray(master)) {
      for (const list of Object.values(master)) for (const v of list || []) pushMaster(out, v)
    } else if (Array.isArray(master)) {
      for (const v of master) pushMaster(out, v)
    }
  } catch {}
  try {
    for (const v of globalThis.Bot?.master || globalThis.Bot?.cfg?.master || []) pushMaster(out, v)
  } catch {}
  return out
}

// 构造转发节点：同时提供 message 与 content 两种字段，
// 兼容「Yunzai 框架 makeForwardMsg」与「OneBot v11 标准 node 结构」两种消费方。
function buildNodes(text) {
  const uid = Array.isArray(globalThis.Bot?.uin) ? globalThis.Bot.uin[0] : (globalThis.Bot?.uin || 10000)
  return [{
    nickname: 'FFmpeg-Plugin',
    user_id: uid,
    message: text,
    content: [{ type: 'text', data: { text } }],
  }]
}

// 纯文本降级：协议端不支持合并转发（或转发构造失败）时，退化为单条纯文本，
// 保证「通知本身」不会因为转发能力缺失而彻底丢失。
async function sendForwardToMaster(text) {
  try {
    if (typeof globalThis.Bot?.pickFriend !== 'function') {
      globalThis.logger?.error?.(`${TAG} Bot 未就绪，错误仅记录日志`)
      return false
    }
    const masters = await getMasters()
    if (!masters.length) {
      globalThis.logger?.error?.(`${TAG} 未找到主人配置（config/config/other.yaml 的 masterQQ），错误仅记录日志`)
      return false
    }
    let ok = false
    for (const uin of masters) {
      // ① 首选合并转发
      try {
        if (typeof globalThis.Bot.makeForwardMsg === 'function') {
          const forward = globalThis.Bot.makeForwardMsg(buildNodes(text))
          await globalThis.Bot.pickFriend(uin).sendMsg(forward)
          ok = true
          globalThis.logger?.info?.(`${TAG} 已向主人 ${uin} 推送错误报告（合并转发）`)
          continue
        }
        throw new Error('makeForwardMsg 不可用')
      } catch (e) {
        globalThis.logger?.warn?.(`${TAG} 主人 ${uin} 合并转发失败（${e.message}），降级为纯文本单条`)
      }
      // ② 降级：纯文本单条
      try {
        await globalThis.Bot.pickFriend(uin).sendMsg(text)
        ok = true
        globalThis.logger?.info?.(`${TAG} 已向主人 ${uin} 推送错误报告（纯文本）`)
      } catch (e) {
        globalThis.logger?.error?.(`${TAG} 私聊主人 ${uin} 失败（转发与纯文本均失败）: ${e.message}`)
      }
    }
    return ok
  } catch (e) {
    globalThis.logger?.error?.(`${TAG} 上报流程异常: ${e.message}`)
    return false
  }
}

// 冷却去重：避免同一指令的错误在短时间内反复刷屏主人私聊。
// key = label + 错误首行：同指令的同一种错误在冷却期内只报一次，
// 但同指令出现**不同**错误（如先超时后失败）仍会即时上报，不会互相吞掉。
const lastNotify = new Map()

/** 取错误的指纹（首行，截断 120 字符），作为冷却 key 的一部分 */
function errorFingerprint(err) {
  const msg = String(err?.message || err || '').split('\n')[0].trim()
  return msg.slice(0, 120)
}

/**
 * 指令级错误上报：写 error.log + 合并转发私聊主人。
 * @param {Error|string} err 错误对象或错误信息
 * @param {string} label 触发来源（如 "FFmpeg版本查询" / "FFmpeg帮助生成" / "FFmpeg插件更新"）
 */
export async function notifyCommandError(err, label = '未知指令') {
  try {
    const msg = err?.stack || err?.message || String(err)
    // ① 写入 Yunzai error.log（事实记录，始终执行）
    globalThis.logger?.error?.(`${TAG} ${label} 出错: ${clip(msg, 2000)}`)

    // ② 冷却去重，避免同指令同错误刷屏
    const now = Date.now()
    const key = `${label}::${errorFingerprint(err)}`
    const last = lastNotify.get(key) || 0
    if (now - last < COOLDOWN_MS) return
    lastNotify.set(key, now)

    const time = new Date().toLocaleString('zh-CN', { hour12: false })
    const text = [
      '【FFmpeg-Plugin 指令错误】',
      '─────────────',
      `来源：${label}`,
      `时间：${time}`,
      clip(msg, 1500),
      '─────────────',
      '完整日志见服务器 logs/error.log',
    ].join('\n')
    await sendForwardToMaster(text)
  } catch (e) {
    globalThis.logger?.error?.(`${TAG} 通知异常: ${e.message}`)
  }
}

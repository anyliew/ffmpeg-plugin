// core/segment.js
// 兼容不同框架获取 segment：优先 icqq，失败回退全局 segment，
// 再兜底一个 CQ 码实现。此前在 apps/version.js、apps/help.js、apps/config.js 各重复一份，统一下沉至此。
let segment
try {
  segment = (await import('icqq')).segment
} catch {
  segment = global.segment || { image: (file) => `[CQ:image,file=${file}]` }
}

export { segment }

// core/config-html.js
// #ff配置 详情页 HTML 构建 —— 参考 karin-plugin-kkk 报错页的视觉风格：
// 近黑背景 + 暗红强调色 + 等宽字体 + 分区标签（SECTION）+ pill 徽章 + 统计数字卡。
// 注意：本文件位于 core/（Yunzai loader 不扫描），export 安全，原因见 core/ffmpeg-info.js 顶部说明。
import { escapeHtml } from './io.js'
import { FONT_FACE } from './ffmpeg-info.js'

/**
 * 生成 #ff配置 详情页 HTML（暗色 kkk 报错页风格）
 * @param {object} d
 * @param {string} d.versionNumber   ffmpeg 版本号原始串
 * @param {object} d.meta            { buildSource, compileDate }
 * @param {object} d.stats           { encoders:{video,audio,subtitle,other}, decoders:{...}, hwaccels:[], muxers:[] }
 * @param {string[]} d.features      --enable-* 特性全量列表
 * @param {string}  [d.pluginDirName] 插件目录名（footer 展示）
 */
export function buildConfigHtml({ versionNumber, meta, stats, features }) {
  const { encoders, decoders, hwaccels, muxers } = stats

  const now = new Date()
  const p2 = (n) => String(n).padStart(2, '0')
  const timeStr = `${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}`
  const dateStr = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`
  const fullTime = `${dateStr} ${timeStr}`

  // 分区标题：kkk 风格 "▸ SECTION · 中文名 [数量]"
  const sec = (en, zh, count) => `
      <div class="sec-title"><span class="sec-arrow">▸</span> ${escapeHtml(en)} <span class="sec-zh">${escapeHtml(zh)}</span>${count != null ? `<span class="sec-count">[ ${count} ]</span>` : ''}</div>`

  // 徽章列表（全量展示）
  const badgeList = (items) => items.map(n => `<span class="badge">${escapeHtml(n)}</span>`).join('')
    || '<span class="badge badge-empty">无</span>'

  const statCards = [
    { label: '视频编码器', sub: 'video encoders', num: encoders.video.length },
    { label: '视频解码器', sub: 'video decoders', num: decoders.video.length },
    { label: '音频编码器', sub: 'audio encoders', num: encoders.audio.length },
    { label: '音频解码器', sub: 'audio decoders', num: decoders.audio.length },
    { label: '硬件加速', sub: 'hwaccels', num: hwaccels.length },
    { label: '封装格式', sub: 'muxers', num: muxers.length },
    { label: '编译配置', sub: 'enable features', num: features.length },
  ].map(({ label, sub, num }) => `
      <div class="num-card">
        <div class="num">${num}</div>
        <div class="num-label">${escapeHtml(label)}</div>
        <div class="num-sub">${escapeHtml(sub)}</div>
      </div>`).join('')

  const featureBadges = features.map(f => `<span class="badge badge-feat">${escapeHtml(f)}</span>`).join('')
    || '<span class="badge badge-empty">无 --enable- 项</span>'

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>FFmpeg-Plugin 配置详情</title>
<style>
${FONT_FACE}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: "LXGW","NotoEmoji","PingFang SC","Microsoft YaHei",-apple-system,"Segoe UI",Roboto,Arial,sans-serif;
    background: #0b0d10;
    color: #d7dde6;
    padding: 28px 22px;
    font-size: 15px;
    line-height: 1.6;
  }
  .wrap { max-width: 1080px; margin: 0 auto; }

  /* ---- header ---- */
  .head { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 22px; }
  .logo {
    background: #e5484d; color: #0b0d10;
    font-family: "Inconsolata", monospace; font-weight: 700;
    padding: 6px 10px; border-radius: 8px; font-size: 22px; letter-spacing: 1px;
  }
  .head-main { flex: 1; }
  .kicker {
    font-family: "Inconsolata", monospace; font-size: 12px; letter-spacing: 2px;
    color: #ff6b6e; text-transform: uppercase;
  }
  .h1 { font-size: 26px; font-weight: 700; color: #f2f5f9; line-height: 1.3; }
  .head-time {
    font-family: "Inconsolata", monospace; font-size: 13px; color: #8b93a1;
    text-align: right; white-space: nowrap; line-height: 1.7;
  }

  /* ---- 通用卡片 / 分区标题 ---- */
  .card {
    background: #14171d;
    border: 1px solid #262b33;
    border-radius: 12px;
    padding: 16px 18px;
    margin-bottom: 16px;
  }
  .sec-title {
    font-family: "Inconsolata", monospace;
    font-size: 14px; font-weight: 700; letter-spacing: 1.5px;
    color: #ff6b6e;
    border-left: 3px solid #e5484d;
    padding-left: 10px;
    margin-bottom: 12px;
    text-transform: uppercase;
    display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
  }
  .sec-arrow { color: #e5484d; }
  .sec-zh { color: #aeb7c4; font-family: "LXGW","NotoEmoji",sans-serif; letter-spacing: 0; font-size: 14px; }
  .sec-count { color: #6b7482; font-size: 12px; margin-left: auto; }

  /* ---- 版本信息 ---- */
  .ver-line { font-family: "Inconsolata", monospace; font-size: 14.5px; color: #7ee787; word-break: break-all; }
  .pill-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .pill {
    background: #2a1215; color: #ff8a8d;
    border: 1px solid #4a1d20;
    border-radius: 999px; padding: 3px 12px;
    font-size: 12.5px; font-family: "Inconsolata", monospace;
  }
  .pill.ok { background: #12261a; color: #7ee787; border-color: #1d4028; }

  /* ---- 统计数字卡 ---- */
  .num-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
  .num-card {
    background: #191d24; border: 1px solid #2a3039; border-radius: 10px;
    padding: 12px 10px; text-align: center;
  }
  .num {
    font-family: "Inconsolata", monospace; font-size: 30px; font-weight: 700;
    color: #ff6b6e; line-height: 1.1;
  }
  .num-label { font-size: 13.5px; font-weight: 700; color: #d7dde6; margin-top: 4px; }
  .num-sub { font-family: "Inconsolata", monospace; font-size: 11px; color: #6b7482; margin-top: 2px; }

  /* ---- 徽章 ---- */
  .badge-row { display: flex; flex-wrap: wrap; gap: 6px; }
  .badge {
    background: #1a1f27; border: 1px solid #2a3039;
    border-radius: 6px; padding: 2px 9px;
    font-size: 13px; font-family: "Inconsolata", monospace;
    color: #9fb6cc;
  }
  .badge-feat { color: #8fd0a0; }
  .badge-empty { color: #55606d; }

  /* ---- footer ---- */
  .foot {
    background: #14171d; border: 1px solid #262b33; border-radius: 12px;
    padding: 14px 18px; margin-top: 2px;
  }
  .foot-help {
    font-family: "Inconsolata", monospace; font-size: 13px; color: #ff6b6e;
    font-weight: 700; margin-bottom: 6px;
  }
  .foot-grid { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 12.5px; color: #8b93a1; }
  .foot-grid b { color: #aeb7c4; font-weight: 600; }
  .foot-line {
    margin-top: 10px; padding-top: 10px; border-top: 1px solid #262b33;
    display: flex; flex-wrap: wrap; gap: 6px 16px;
    font-family: "Inconsolata", monospace; font-size: 12px; color: #6b7482;
  }
  .foot-line .v { color: #aeb7c4; }
</style>
</head>
<body>
<div class="wrap">

  <div class="head">
    <div class="logo">FF</div>
    <div class="head-main">
      <div class="kicker">FFmpeg-Plugin · Config Overview</div>
      <div class="h1">FFmpeg 编解码与编译配置详情</div>
    </div>
    <div class="head-time">${timeStr}<br>${dateStr}</div>
  </div>

  <div class="card">
    ${sec('VERSION INFO', '版本信息')}
    <div class="ver-line">ffmpeg version ${escapeHtml(versionNumber)}</div>
    <div class="pill-row">
      <span class="pill">构建来源: ${escapeHtml(meta.buildSource)}</span>
      <span class="pill">编译日期: ${escapeHtml(meta.compileDate || '未知')}</span>
      <span class="pill ok">RUNTIME OK</span>
    </div>
  </div>

  <div class="card">
    ${sec('STATISTICS OVERVIEW', '数量统计')}
    <div class="num-grid">${statCards}</div>
  </div>

  <div class="card">
    ${sec('VIDEO ENCODERS', '视频编码器', encoders.video.length)}
    <div class="badge-row">${badgeList(encoders.video)}</div>
  </div>

  <div class="card">
    ${sec('VIDEO DECODERS', '视频解码器', decoders.video.length)}
    <div class="badge-row">${badgeList(decoders.video)}</div>
  </div>

  <div class="card">
    ${sec('AUDIO ENCODERS', '音频编码器', encoders.audio.length)}
    <div class="badge-row">${badgeList(encoders.audio)}</div>
  </div>

  <div class="card">
    ${sec('AUDIO DECODERS', '音频解码器', decoders.audio.length)}
    <div class="badge-row">${badgeList(decoders.audio)}</div>
  </div>

  <div class="card">
    ${sec('HARDWARE ACCEL', '硬件加速', hwaccels.length)}
    <div class="badge-row">${badgeList(hwaccels)}</div>
  </div>

  <div class="card">
    ${sec('MUXERS', '封装格式', muxers.length)}
    <div class="badge-row">${badgeList(muxers)}</div>
  </div>

  <div class="card">
    ${sec('BUILD CONFIGURATION', '详细编译配置', features.length)}
    <div class="badge-row">${featureBadges}</div>
  </div>

  <div class="foot">
    <div class="foot-help">Need Help? 需要帮助？</div>
    <div class="foot-grid">
      <span><b>Git Repository:</b> github.com/Anyliew/ffmpeg-plugin</span>
      <span><b>使用:</b> 发送 #ff版本 查看精简总览</span>
    </div>
    <div class="foot-line">
      <span>Created By Yunzai · FFmpeg-Plugin · Anyliew</span>
      <span class="v">${fullTime}</span>
    </div>
  </div>

</div>
</body>
</html>`
}

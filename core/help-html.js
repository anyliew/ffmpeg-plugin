// core/help-html.js
// 帮助卡 HTML 构建（纯函数层）。搬出 apps/ 的原因见 core/ffmpeg-info.js 顶部说明。
import { escapeHtml } from './io.js'
import { FONT_FACE } from './ffmpeg-info.js'

export async function buildHelpHtml(icons) {
  const now = new Date()
  const formattedTime = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`

  // 标题图标尺寸（较大）
  const headerIconStyle = 'height:24px; width:24px; vertical-align:middle; margin-right:6px;'
  // 模块图标尺寸（中等）
  const moduleIconStyle = 'height:20px; width:20px; vertical-align:middle; margin-right:6px;'

  const ffmpegIcon = icons.ffmpeg ? `<img src="${icons.ffmpeg}" style="${headerIconStyle}">` : '🎬'

  const modules = [
    {
      icon: 'update', accent: '#6b7280', accentSoft: '#f1f2f4',
      name: '更新管理',
      desc: '插件自更新功能（仅BOT主人可用）',
      commands: [
        { cmd: '#ff更新 / #ffmpeg-plugin更新', desc: '检查并更新插件（保留本地修改）', icon: 'update' },
        { cmd: '#ff强制更新', desc: '强制覆盖本地修改，重置到远程最新版本', icon: 'update' }
      ]
    },
    {
      icon: 'version', accent: '#4f86f7', accentSoft: '#eaf1ff',
      name: '版本信息',
      desc: '查看 FFmpeg 及插件详细信息',
      commands: [
        { cmd: '#ff版本 / #ffmpeg版本', desc: '生成 FFmpeg 版本信息卡片（精简总览）', icon: 'version' },
        { cmd: '#ff配置', desc: '生成编解码器/封装格式/编译配置详情页（暗色全量）', icon: 'config' }
      ]
    },
    {
      icon: 'info', accent: '#8b5cf6', accentSoft: '#f0ebfd',
      name: '媒体信息',
      desc: '获取音视频/图片的详细元数据',
      commands: [
        { cmd: '#音频信息', desc: '查看音频文件详情（格式、时长、比特率等）', icon: 'music' },
        { cmd: '#图片信息', desc: '查看图片详情（分辨率、格式、GIF帧数等）', icon: 'image' },
        { cmd: '#视频信息', desc: '查看视频详情（编码、分辨率、码率等）', icon: 'video' }
      ],
      note: '💡 使用方法：回复/引用包含媒体的消息，或直接发送带有媒体的命令'
    },
    {
      icon: 'clip', accent: '#f59e0b', accentSoft: '#fef3e0',
      name: '去黑边 / 去白边 / 去纯色',
      desc: '自动裁剪图片/视频/GIF 的四周黑边、白边或纯色区域',
      commands: [
        { cmd: '#去黑边', desc: '自动检测并裁剪媒体文件四周的黑边', icon: 'clip' },
        { cmd: '#去白边', desc: '自动检测并裁剪媒体文件四周的白边', icon: 'clip' },
        { cmd: '#去纯色', desc: '基于左上角颜色裁剪图片/GIF 四周的纯色区域（仅限图片）', icon: 'clip' }
      ],
      note: '💡 支持图片（含GIF）、视频批量处理（最多10个），GIF可保留动画'
    },
    {
      icon: 'media', accent: '#10b981', accentSoft: '#e7f8f1',
      name: '多媒体工具箱',
      desc: '视频转GIF、GIF分解打包、音频/视频格式转换、GIF转MP4、转APNG',
      commands: [
        { cmd: '#转动图 / #转gif', desc: '将视频转换为 GIF 动图', icon: 'gif' },
        { cmd: '#转语音', desc: '提取视频音频并转为 MP3 语音消息', icon: 'music' },
        { cmd: '#转mp3', desc: '将音/视频文件转换为 MP3 音频文件', icon: 'music' },
        { cmd: '#转flac', desc: '将音/视频文件转换为 FLAC 无损音频', icon: 'music' },
        { cmd: '#转wav', desc: '将音/视频文件转换为 WAV 音频文件', icon: 'music' },
        { cmd: '#转视频 [音频名] [秒数]', desc: 'GIF 转带背景音乐的 MP4。可指定音频名与时长(秒)，省略则随机选曲并按 GIF 时长', icon: 'video' },
        { cmd: '#转apng', desc: '将图片/GIF/视频转换为 APNG 动图（PNG动画）', icon: 'image' }
      ],
      note: '💡 #转视频 用法：#转视频（随机音乐）、#转视频 菲比（指定音乐）、#转视频 菲比 10（指定音乐且视频 10 秒）；单次时长上限 600 秒'
    },
    {
      icon: 'image', accent: '#4f86f7', accentSoft: '#eaf1ff',
      name: '基础图片处理',
      desc: '翻转、灰度、旋转、缩放、裁剪、反色、滤镜等（静态图与 GIF 均支持）',
      commands: [
        { cmd: '#水平翻转 / #左翻 / #右翻', desc: '水平镜像翻转图片', icon: 'flip-h' },
        { cmd: '#竖直翻转 / #上翻 / #下翻', desc: '竖直翻转图片（上下颠倒）', icon: 'flip-v' },
        { cmd: '#灰度图 / #黑白', desc: '转为黑白灰度图', icon: 'grayscale' },
        { cmd: '#旋转 [角度]', desc: '旋转指定角度，默认 90°，如：#旋转 45', icon: 'rotate' },
        { cmd: '#缩放 尺寸', desc: '缩放：100x100、100x、x100、50%', icon: 'resize' },
        { cmd: '#裁剪 尺寸', desc: '居中裁剪：100x100、100x、2:1', icon: 'crop' },
        { cmd: '#反相 / #反色', desc: '反色处理（负片效果）', icon: 'invert' },
        { cmd: '#轮廓 / #浮雕', desc: '轮廓描边 / 浮雕效果', icon: 'contour' },
        { cmd: '#模糊 [强度]', desc: '高斯模糊，默认 1.6，如：#模糊 5', icon: 'blur' },
        { cmd: '#锐化', desc: '锐化图片细节', icon: 'sharpen' },
        { cmd: '#像素化 / #马赛克 [强度]', desc: '像素化（马赛克），默认 8', icon: 'pixelate' }
      ],
      note: '💡 使用方法：回复/引用一条图片消息，或直接发送图片 + 命令；GIF 动图会逐帧处理并保留动画'
    },
    {
      icon: 'color', accent: '#ec5990', accentSoft: '#fdeaf1',
      name: '颜色 / 滤镜 / 生成',
      desc: '颜色滤镜、纯色图、渐变图',
      commands: [
        { cmd: '#颜色滤镜 颜色', desc: '给图片叠加指定颜色滤镜', icon: 'color-filter' },
        { cmd: '#纯色图 颜色 [尺寸]', desc: '生成纯色图，默认 500x500，如：#纯色图 红色 300x300', icon: 'solid' },
        { cmd: '#渐变图 [方向] 颜色1 颜色2', desc: '生成渐变图，如：#渐变图 上下 红 蓝、#渐变图 45 #66ccff #ff66cc', icon: 'gradient' }
      ],
      note: '💡 颜色支持：#66ccff、red、红色、102,204,255；渐变方向：上下 / 左右 / 角度数字（默认左右）'
    },
    {
      icon: 'gif', accent: '#f59e0b', accentSoft: '#fef3e0',
      name: 'GIF 动图处理',
      desc: '倒放、正放倒放、变速、多图合成',
      commands: [
        { cmd: '#gif倒放 / #倒放', desc: '将 GIF 倒序播放', icon: 'gif-reverse' },
        { cmd: '#gif正放倒放 / #正放倒放', desc: '正放一遍再倒放一遍', icon: 'gif-obrev' },
        { cmd: '#gif变速 倍率', desc: '调整速度：0.5x、50%、20FPS、0.05s', icon: 'gif-speed' },
        { cmd: '#gif合成 [间隔]', desc: '多张图片合成为 GIF，间隔默认 100ms', icon: 'gif-join' },
        { cmd: '#动图分解 / #gif分解', desc: '将 GIF 分解为 PNG 帧序列', icon: 'gif-extract' },
        { cmd: '#动图打包 / #gif打包', desc: '将 GIF 所有帧打包为 ZIP', icon: 'gif-pack' }
      ],
      note: '💡 合成请一次发送多张图片（≥2 张，动图仅取第一帧）；帧间隔需 ≥ 20ms（即 ≤ 50FPS）'
    },
    {
      icon: 'grid', accent: '#10b981', accentSoft: '#e7f8f1',
      name: '网格 / 拼接',
      desc: '四宫格、九宫格、横向/纵向拼接',
      commands: [
        { cmd: '#四宫格', desc: '将图片切成 2×2 四块', icon: 'grid4' },
        { cmd: '#九宫格', desc: '将图片切成 3×3 九块', icon: 'grid9' },
        { cmd: '#横向拼接', desc: '多张图片横向拼接（左→右）', icon: 'join-h' },
        { cmd: '#纵向拼接', desc: '多张图片纵向拼接（上→下）', icon: 'join-v' }
      ],
      note: '💡 切图会先居中正方形裁剪；拼接至少需要 2 张图片，结果以合并转发形式发送'
    },
    {
      icon: 'text', accent: '#06b6d4', accentSoft: '#e3f7fb',
      name: '文字转图',
      desc: '把文字渲染成图片',
      commands: [
        { cmd: '#文字转图 文字', desc: '将文字转换为图片，支持换行，最长 1000 字', icon: 'text2img' }
      ],
      note: '💡 如：#文字转图 你好 世界（支持换行）'
    },
    {
      icon: 'help', accent: '#6b7280', accentSoft: '#f1f2f4',
      name: '帮助菜单',
      desc: '显示本帮助信息',
      commands: [
        { cmd: '#ff帮助 / #ffmpeg-plugin帮助', desc: '生成此帮助菜单图片', icon: 'help' },
        { cmd: '#ff帮助刷新 / #ffmpeg-plugin帮助刷新', desc: '手动刷新帮助菜单缓存（仅主人）', icon: 'help' }
      ]
    }
  ]

  const modulesHtml = modules.map(mod => `
    <div class="module-card" style="--accent:${mod.accent};--accent-soft:${mod.accentSoft}">
      <div class="module-header">
        <h3>${mod.icon ? `<img src="${icons[mod.icon] || ''}" style="${moduleIconStyle}">` : ''} ${escapeHtml(mod.name)}</h3>
        <p>${escapeHtml(mod.desc)}</p>
      </div>
      <div class="command-list">
        ${mod.commands.map(cmd => `
          <div class="command-item">
            <span class="cmd-icon">${cmd.icon ? `<img src="${icons.map[cmd.icon] || ''}">` : ''}</span>
            <code>${escapeHtml(cmd.cmd)}</code>
            <span class="cmd-desc">${escapeHtml(cmd.desc)}</span>
          </div>
        `).join('')}
      </div>
      ${mod.note ? `<div class="module-note">${escapeHtml(mod.note)}</div>` : ''}
    </div>
  `).join('')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>FFmpeg-Plugin 帮助菜单</title>
<style>
${FONT_FACE}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: "LXGW","NotoEmoji","PingFang SC","Microsoft YaHei",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
    background: #f6f8fa;
    color: #1f2328;
    display: flex;
    justify-content: center;
    padding: 20px;
    -webkit-font-smoothing: antialiased;
  }
  .container {
    width: 720px;
    background: #ffffff;
    border: 1px solid #d0d7de;
    border-radius: 14px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(27,31,36,.06);
  }
  .header {
    padding: 18px 22px;
    border-bottom: 1px solid #d0d7de;
    background: linear-gradient(135deg, #f6f8fa 0%, #eef2f6 100%);
  }
  .header h1 {
    font-size: 28px;
    font-weight: 700;
    color: #1f2328;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .content { padding: 16px 20px 8px; }
  .module-card {
    background: #ffffff;
    border: 1px solid #d0d7de;
    border-left: 4px solid var(--accent, #4f86f7);
    border-radius: 12px;
    padding: 16px;
    margin-bottom: 16px;
    transition: box-shadow .2s ease, transform .2s ease;
  }
  .module-card:last-child { margin-bottom: 0; }
  .module-card:hover {
    box-shadow: 0 6px 18px rgba(27,31,36,.08);
    transform: translateY(-1px);
  }
  .module-header {
    margin-bottom: 12px;
    padding: 10px 12px;
    background: var(--accent-soft, #eaf1ff);
    border-radius: 10px;
  }
  .module-header h3 {
    font-size: 19px;
    font-weight: 600;
    color: #1f2328;
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .module-header p {
    font-size: 14.5px;
    color: #57606a;
    line-height: 1.5;
  }
  .command-list {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .command-item {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    padding: 6px 8px;
    border-radius: 8px;
    transition: background .15s ease;
  }
  .command-item:hover { background: #f6f8fa; }
  .cmd-icon {
    flex: 0 0 auto;
    width: 34px;
    height: 34px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-soft, #eaf1ff);
    border-radius: 8px;
  }
  .cmd-icon img { width: 20px; height: 20px; display: block; }
  .command-item code {
    flex: 0 0 auto;
    background: #f6f8fa;
    border: 1px solid #d0d7de;
    padding: 4px 12px;
    border-radius: 20px;
    font-family: "Inconsolata", "SF Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 15.5px;
    font-weight: 600;
    color: #0969da;
    white-space: nowrap;
  }
  .command-item .cmd-desc {
    flex: 1 1 160px;
    font-size: 14.5px;
    color: #57606a;
    line-height: 1.5;
  }
  .module-note {
    margin-top: 10px;
    padding: 9px 13px;
    font-size: 13.5px;
    color: #57606a;
    background: var(--accent-soft, #eaf1ff);
    border-left: 3px solid var(--accent, #4f86f7);
    border-radius: 4px;
  }
  .footer {
    padding: 12px 20px;
    border-top: 1px solid #d0d7de;
    text-align: center;
    font-size: 13px;
    color: #656d76;
    background: #f6f8fa;
    line-height: 1.6;
  }
  /* 图标与文字垂直居中 */
  h1 img, h3 img { vertical-align: middle; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>${ffmpegIcon} FFmpeg-Plugin</h1>
  </div>
  <div class="content">
    ${modulesHtml}
  </div>
  <div class="footer">
    Created By Yunzai · FFmpeg-Plugin · Anyliew<br>
    生成时间: ${formattedTime}
  </div>
</div>
</body>
</html>`
}

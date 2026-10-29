// guoba.support.js
// 锅巴 (Guoba-Plugin) 配置面板适配。
// 锅巴会扫描每个插件目录下的 guoba.support.js 并调用 supportGuoba()。
// 该文件仅在本机安装了 guoba-plugin 时才会被加载，无 guoba 时不会报错。
//
// 本插件仅展示插件信息，不提供任何可配置项（无 config schemas）。
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function supportGuoba() {
  return {
    pluginInfo: {
      // name 是插件技术标识，必须与 package.json 保持一致，锅巴据此定位插件，不要改；
      // title / description 才是面板展示名，统一为品牌名 FFmpeg-Plugin。
      name: 'ffmpeg-plugin',
      title: 'FFmpeg-Plugin',
      description: '基于 FFmpeg 的 Yunzai 插件：多媒体转码（视频转GIF / 转语音 / 转mp3·flac·wav / GIF转视频 / 转APNG）、GIF 分解打包、基础图片处理、颜色滤镜生成、GIF 动图处理、网格拼接、文字转图、媒体信息查询、FFmpeg 版本总览（#ff版本）与编解码/编译配置详情（#ff配置）。',
      author: ['Anyliew'],
      authorLink: ['https://github.com/Anyliew'],
      link: 'https://github.com/Anyliew/ffmpeg-plugin',
      isV3: true,
      isV2: false,
      // 插件图标：复用仓库自带的品牌 svg（resources/icon/ffmpeg.svg）。
      iconPath: path.join(__dirname, 'resources', 'icon', 'ffmpeg.svg'),
    },
    // 仅展示插件信息，不提供配置项（空 schemas => 面板显示「该配置项暂无可视化表单」）。
    configInfo: {
      schemas: [],
    },
  }
}

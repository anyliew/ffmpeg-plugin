import { ImageBase } from '../core/image-base.js'

/**
 * 颜色 / 滤镜 / 生成：颜色滤镜、纯色图、渐变图
 */
export class imageColor extends ImageBase {
  constructor() {
    super({
      name: '[FFmpeg-Plugin]颜色滤镜生成',
      dsc: '颜色滤镜、纯色图、渐变图生成',
      event: 'message',
      priority: 321,
      rule: [
        { reg: /^#?(颜色滤镜|滤镜)\s*(.+)$/, fnc: 'colorFilter' },
        { reg: /^#?纯色图?\s*(.+)$/, fnc: 'colorImage' },
        { reg: /^#?渐变图?\s*(.+)$/, fnc: 'gradientImage' }
      ]
    })
  }
}

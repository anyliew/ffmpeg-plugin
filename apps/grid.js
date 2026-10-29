import { ImageBase } from '../core/image-base.js'

/**
 * 网格 / 拼接：四宫格、九宫格、横向/纵向拼接
 */
export class imageGrid extends ImageBase {
  constructor() {
    super({
      name: '[FFmpeg-Plugin]网格拼接',
      dsc: '四宫格、九宫格、横向/纵向拼接',
      event: 'message',
      priority: 323,
      rule: [
        { reg: /^#?四宫格$/, fnc: 'fourGrid' },
        { reg: /^#?九宫格$/, fnc: 'nineGrid' },
        { reg: /^#?(横向拼接|横向合成|横向合并)$/, fnc: 'horizontalJoin' },
        { reg: /^#?(纵向拼接|竖向拼接|纵向合成|纵向合并)$/, fnc: 'verticalJoin' }
      ]
    })
  }
}

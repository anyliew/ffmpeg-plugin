import { ImageBase } from '../core/image-base.js'

/**
 * GIF 动图处理：倒放、正放倒放、变速、多图合成
 */
export class imageGif extends ImageBase {
  constructor() {
    super({
      name: '[FFmpeg-Plugin]GIF动图处理',
      dsc: 'GIF 倒放、正放倒放、变速、多图合成',
      event: 'message',
      priority: 322,
      rule: [
        { reg: /^#?(gif)?倒放$/i, fnc: 'gifReverse' },
        { reg: /^#?(gif)?正放倒放$/i, fnc: 'gifObverseReverse' },
        { reg: /^#?(gif)?变速\s*(\S+)$/i, fnc: 'gifChangeSpeed' },
        { reg: /^#?(gif)?合成\s*(\d{1,5})?$/i, fnc: 'gifJoin' }
      ]
    })
  }
}

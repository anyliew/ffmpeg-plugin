import { ImageBase } from '../core/image-base.js'

/**
 * 文字转图：把文字渲染成图片
 */
export class imageText extends ImageBase {
  constructor() {
    super({
      name: '[FFmpeg-Plugin]文字转图',
      dsc: '把文字渲染成图片',
      event: 'message',
      priority: 324,
      rule: [
        { reg: /^#?(文字转图|文字成图|文转图|文字生成图片)\s*([\s\S]*)$/, fnc: 'text2Image' }
      ]
    })
  }
}

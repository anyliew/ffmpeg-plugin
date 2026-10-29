import { MediaBase } from '../core/media-base.js'

/**
 * GIF 分解 / 打包：将 GIF 分解为 PNG 帧序列，或将全部帧打包为 ZIP
 */
export class gifDecompose extends MediaBase {
  constructor() {
    super({
      name: '[FFmpeg-Plugin]GIF分解打包',
      dsc: 'GIF 分解为 PNG 帧序列 / 打包为 ZIP',
      event: 'message',
      priority: 312,
      rule: [
        { reg: /^#?动图分解$/, fnc: 'decomposeGif' },
        { reg: /^#?gif分解$/i, fnc: 'decomposeGif' },
        { reg: '^#?(动图打包|gif打包)$', fnc: 'packGifToZip' }
      ]
    })
  }
}

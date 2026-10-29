import { MediaBase } from '../core/media-base.js'

/**
 * GIF 转视频：将 GIF 转为带背景音乐的 MP4（支持指定音频名与时长）
 */
export class gifToVideo extends MediaBase {
  constructor() {
    super({
      name: '[FFmpeg-Plugin]GIF转视频',
      dsc: 'GIF 转带背景音乐的 MP4（支持指定音频名与时长）',
      event: 'message',
      priority: 311,
      rule: [
        { reg: /^#?转视频(\s+(.+))?$/, fnc: 'convertGifToVideo' }
      ]
    })
  }
}

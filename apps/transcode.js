import { MediaBase } from '../core/media-base.js'

/**
 * 多媒体转码：视频转 GIF、视频转语音、音视频转 MP3/FLAC/WAV、图片/GIF/视频转 APNG
 */
export class transcode extends MediaBase {
  constructor() {
    super({
      name: '[FFmpeg-Plugin]多媒体转码',
      dsc: '视频转GIF、视频转语音、音视频转MP3/FLAC/WAV、图片/GIF/视频转APNG',
      event: 'message',
      priority: 310,
      rule: [
        { reg: /^#(转动图|转gif)$/i, fnc: 'convertToGif' },
        { reg: '^#转语音$', fnc: 'convertToVoice' },
        { reg: '^#转mp3$', fnc: 'convertToMp3' },
        { reg: '^#转flac$', fnc: 'convertToFlac' },
        { reg: '^#转wav$', fnc: 'convertToWav' },
        { reg: '^#转apng$', fnc: 'convertToApng' }
      ]
    })
  }
}

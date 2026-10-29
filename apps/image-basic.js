import { ImageBase } from '../core/image-base.js'

/**
 * 基础图片处理：翻转、灰度、旋转、缩放、裁剪、反色、轮廓、浮雕、模糊、锐化、像素化
 */
export class imageBasic extends ImageBase {
  constructor() {
    super({
      name: '[FFmpeg-Plugin]基础图片处理',
      dsc: '图片翻转/灰度/旋转/缩放/裁剪/反色/轮廓/浮雕/模糊/锐化/像素化',
      event: 'message',
      priority: 320,
      rule: [
        { reg: /^#?(水平翻转|左右翻转|镜像翻转|左翻|右翻)$/, fnc: 'flipHorizontal' },
        { reg: /^#?(竖直翻转|垂直翻转|上下翻转|上翻|下翻)$/, fnc: 'flipVertical' },
        { reg: /^#?(灰度图?|黑白图?|去色)$/, fnc: 'grey' },
        { reg: /^#?旋转\s*(-?\d{1,4}(?:\.\d+)?)?\s*度?$/, fnc: 'rotate' },
        { reg: /^#?缩放\s*(\S+)$/, fnc: 'resize' },
        { reg: /^#?裁剪\s*(\S+)$/, fnc: 'crop' },
        { reg: /^#?(反相|反色|负片)$/, fnc: 'invert' },
        { reg: /^#?轮廓$/, fnc: 'contour' },
        { reg: /^#?浮雕$/, fnc: 'emboss' },
        { reg: /^#?模糊\s*(\d{1,3}(?:\.\d+)?)?$/, fnc: 'blur' },
        { reg: /^#?锐化$/, fnc: 'sharpen' },
        { reg: /^#?(像素化|马赛克)\s*(\d{1,4})?$/, fnc: 'pixelate' }
      ]
    })
  }
}

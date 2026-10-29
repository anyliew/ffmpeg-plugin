/**
 * 颜色解析工具：支持 #66ccff / fff / rgb(1,2,3) / 1,2,3 / 中文名 / 英文名
 * 从原 utils/img-utils.js 抽出，合并原 utils/color-table.js 的颜色名表
 */
import { colorTable } from './color-table.js'

const HEX_RE = /^#?([0-9a-fA-F]{6})$/
const HEX3_RE = /^#?([0-9a-fA-F]{3})$/
const NUM_RE = /^(?:rgb)?\s*[（(]?\s*(\d{1,3})\s*[，,、\s]\s*(\d{1,3})\s*[，,、\s]\s*(\d{1,3})\s*[)）]?$/

/** 常用英文颜色名 */
const EN_COLORS = {
  black: '#000000', white: '#FFFFFF', red: '#FF0000', green: '#008000', blue: '#0000FF',
  yellow: '#FFFF00', cyan: '#00FFFF', magenta: '#FF00FF', gray: '#808080', grey: '#808080',
  silver: '#C0C0C0', maroon: '#800000', olive: '#808000', lime: '#00FF00', aqua: '#00FFFF',
  teal: '#008080', navy: '#000080', fuchsia: '#FF00FF', purple: '#800080', orange: '#FFA500',
  pink: '#FFC0CB', hotpink: '#FF69B4', deeppink: '#FF1493', crimson: '#DC143C',
  salmon: '#FA8072', coral: '#FF7F50', tomato: '#FF6347', gold: '#FFD700',
  khaki: '#F0E68C', lavender: '#E6E6FA', plum: '#DDA0DD', violet: '#EE82EE',
  orchid: '#DA70D6', thistle: '#D8BFD8', tan: '#D2B48C', beige: '#F5F5DC',
  brown: '#A52A2A', chocolate: '#D2691E', indigo: '#4B0082', ivory: '#FFFFF0',
  linen: '#FAF0E6', snow: '#FFFAFA', wheat: '#F5DEB3', azure: '#F0FFFF',
  skyblue: '#87CEEB', steelblue: '#4682B4', royalblue: '#4169E1', dodgerblue: '#1E90FF',
  lightblue: '#ADD8E6', darkblue: '#00008B', seagreen: '#2E8B57', springgreen: '#00FF7F',
  forestgreen: '#228B22', limegreen: '#32CD32', darkgreen: '#006400', turquoise: '#40E0D0',
  goldenrod: '#DAA520', darkred: '#8B0000', darkgray: '#A9A9A9', darkgrey: '#A9A9A9',
  lightgray: '#D3D3D3', lightgrey: '#D3D3D3', dimgray: '#696969', dimgrey: '#696969',
  whitesmoke: '#F5F5F5', ghostwhite: '#F8F8FF', mintcream: '#F5FFFA', oldlace: '#FDF5E6',
  seashell: '#FFF5EE', floralwhite: '#FFFAF0', aliceblue: '#F0F8FF', honeydew: '#F0FFF0',
  peachpuff: '#FFDAB9', moccasin: '#FFE4B5', papayawhip: '#FFEFD5', mistyrose: '#FFE4E1',
  slategray: '#708090', slategrey: '#708090', lightslategray: '#778899', cadetblue: '#5F9EA0',
  peru: '#CD853F', sienna: '#A0522D', sienna2: '#A0522D', firebrick: '#B22222'
}

/** 单字/口语颜色别名 */
const SHORT_ALIAS = {
  红: '红色', 绿: '绿色', 蓝: '蓝色', 黄: '黄色', 黑: '黑色', 白: '白色', 灰: '灰色',
  紫: '紫色', 橙: '橙色', 青: '青色', 金: '金色', 银: '银色',
  粉: '#FFC0CB', 棕: '#A52A2A', 褐: '#A52A2A', 天蓝: '#87CEEB', 淡红: '#FF6666',
  米白: '#F5F5DC', 藏青: '#000080', 浅灰: '#D3D3D3', 深灰: '#696969'
}

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16)
  }
}

/**
 * 解析颜色：支持 #66ccff / fff / rgb(1,2,3) / 1,2,3 / 中文名（红色）/ 英文名（red）
 * @returns {{r:number,g:number,b:number}|null}
 */
export function parseColor(input) {
  if (input == null) return null
  const arg = String(input).trim()
  if (!arg) return null

  let m = HEX_RE.exec(arg)
  if (m) return hexToRgb(m[1])
  m = HEX3_RE.exec(arg)
  if (m) {
    const [a, b, c] = m[1]
    return hexToRgb(`${a}${a}${b}${b}${c}${c}`)
  }
  m = NUM_RE.exec(arg)
  if (m) {
    const [r, g, b] = [+m[1], +m[2], +m[3]]
    if ([r, g, b].every((v) => v >= 0 && v <= 255)) return { r, g, b }
    return null
  }
  if (colorTable[arg]) return hexToRgb(colorTable[arg])
  // 简写别名：红 / 蓝 / 粉 ...
  if (SHORT_ALIAS[arg]) {
    const mapped = SHORT_ALIAS[arg]
    return mapped.startsWith('#') ? hexToRgb(mapped) : hexToRgb(colorTable[mapped] || '#000000')
  }
  const en = EN_COLORS[arg.toLowerCase()]
  if (en) return hexToRgb(en)
  return null
}

export const COLOR_TIPS = '请使用正确的颜色格式，如：#66ccff、red、红色、102,204,255'

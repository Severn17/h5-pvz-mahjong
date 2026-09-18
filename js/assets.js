/**
 * 素材加载与动画帧工具
 */
const IMAGES = {}                 // 路径 -> Image
const FRAMES = {}                 // 动画目录 -> [Image]
const SINGLE = {
  bg: 'background1.jpg', cover: 'coverBg.jpg', pea: 'bullet.png', peaHit: 'bullet_hit.png',
  peaIce: 'misc/peaice/00.png', car: 'car.png', zombieWon: 'zombieWon.png',
}

function loadImage (path) {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = img.onerror = () => resolve(img)
    img.src = 'images/' + path
    IMAGES[path] = img
  })
}

// 预加载全部素材，onProgress(0~1)
async function loadAssets (onProgress) {
  const paths = Object.values(SINGLE)
  for (const key in MANIFEST) paths.push(...MANIFEST[key])
  let done = 0
  await Promise.all(paths.map(p => loadImage(p).then(() => onProgress(++done / paths.length))))
  for (const key in MANIFEST) FRAMES[key] = MANIFEST[key].map(p => IMAGES[p])
  buildCardImages()
}

const img = key => IMAGES[SINGLE[key]]

/**
 * 帧动画：按时间推进，loop=false 时停在最后一帧
 */
class Anim {
  constructor (key, fps, loop = true) {
    this.frames = FRAMES[key]
    this.fps = fps
    this.loop = loop
    this.t = 0
  }
  update (dt) { this.t += dt }
  get index () {
    const i = Math.floor(this.t * this.fps)
    return this.loop ? i % this.frames.length : Math.min(i, this.frames.length - 1)
  }
  get done () { return !this.loop && this.t * this.fps >= this.frames.length }
  get img () { return this.frames[this.index] }
}

/**
 * 植物卡片：统一用画布绘制，保证新旧植物风格一致
 */
const CARD_W = 100, CARD_H = 44
const CARD_IMAGES = {}
function buildCardImages () {
  for (const key of PLANT_ORDER) {
    const def = PLANTS[key]
    const c = document.createElement('canvas')
    c.width = CARD_W; c.height = CARD_H
    const x = c.getContext('2d')
    // 卡片底板
    roundRect(x, 1, 1, CARD_W - 2, CARD_H - 2, 6)
    x.fillStyle = '#f2e6b3'; x.fill()
    x.lineWidth = 2; x.strokeStyle = '#6b4a1f'; x.stroke()
    // 植物背景框
    const g = x.createLinearGradient(0, 4, 0, CARD_H - 4)
    g.addColorStop(0, '#bfe6ff'); g.addColorStop(0.65, '#bfe6ff'); g.addColorStop(0.66, '#7cc24e'); g.addColorStop(1, '#5a9e35')
    roundRect(x, 5, 4, 56, CARD_H - 8, 4)
    x.fillStyle = g; x.fill()
    // 植物图像：取第一帧，按可见区域缩放进框
    const firstAnim = def.anim.idle || def.anim.idleH
    const frame = FRAMES[firstAnim][0]
    const box = spriteBox(frame)
    const s = Math.min(52 / box.w, (CARD_H - 10) / box.h, 1)
    x.save()
    roundRect(x, 5, 4, 56, CARD_H - 8, 4); x.clip()
    x.drawImage(frame, box.x, box.y, box.w, box.h, 33 - box.w * s / 2, CARD_H - 5 - box.h * s, box.w * s, box.h * s)
    x.restore()
    CARD_IMAGES[key] = c
  }
}

// 计算图片不透明像素的包围盒
function spriteBox (image) {
  const c = document.createElement('canvas')
  c.width = image.width; c.height = image.height
  const x = c.getContext('2d')
  x.drawImage(image, 0, 0)
  const d = x.getImageData(0, 0, c.width, c.height).data
  let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0
  for (let y = 0; y < c.height; y++) {
    for (let i = 0; i < c.width; i++) {
      if (d[(y * c.width + i) * 4 + 3] > 20) {
        if (i < x0) x0 = i
        if (i > x1) x1 = i
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < x0) return { x: 0, y: 0, w: image.width, h: image.height }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

function roundRect (x, l, t, w, h, r) {
  x.beginPath()
  x.moveTo(l + r, t)
  x.arcTo(l + w, t, l + w, t + h, r)
  x.arcTo(l + w, t + h, l, t + h, r)
  x.arcTo(l, t + h, l, t, r)
  x.arcTo(l, t, l + w, t, r)
  x.closePath()
}

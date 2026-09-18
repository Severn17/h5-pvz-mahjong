/**
 * 游戏实体：植物、僵尸、豌豆、掉落的牌、除草车、特效
 * 所有逻辑均按 dt（秒）推进，暂停/加速只需控制 dt
 */
const BIG_DMG = 1800               // 爆炸类植物伤害
const BOSS_BIG_DMG = 600           // 爆炸类植物对僵尸王的伤害上限

class Plant {
  constructor (type, row, col, opts = {}) {
    const def = PLANTS[type], m = G.mods
    this.type = type
    this.def = def
    this.row = row
    this.col = col
    this.x = cellCx(col)
    this.maxHp = def.hp * m.plantHp * (type === 'wallnut' ? m.wallnutHp : 1) * (opts.hpMul || 1)
    this.dmgMul = opts.dmgMul || 1  // 爆炸类伤害倍率（字牌对子 = 0.5）
    this.hp = this.maxHp
    this.anims = {}
    for (const k in def.anim) this.anims[k] = new Anim(def.anim[k], def.fps, true)
    this.state = def.anim.idle ? 'idle' : 'idleH'
    this.t = 0                     // 通用计时器
    this.flash = 0                 // 受击闪烁
    this.dead = false
    this.busy = false              // 行动中（不可被啃食）
    this.shotQueue = []            // 待发射豌豆的延迟
    this.shootTimer = 0.5
    this.pop = 0.3                 // 种下时的弹跳动画
    if (type === 'sunflower') this.t = 3
    if (type === 'potatomine') { this.state = 'init'; this.t = m.mineArm }
    if (type === 'cherrybomb' || type === 'jalapeno') { this.busy = true; this.anims.idle.loop = false }
    if (type === 'squash') this.targetX = this.x
  }
  get anim () { return this.anims[this.state] }
  setState (s) {
    if (this.state === s) return
    this.state = s
    this.anims[s].t = 0
  }
  update (dt) {
    const m = G.mods
    this.anim.update(dt)
    this.flash = Math.max(0, this.flash - dt)
    this.pop = Math.max(0, this.pop - dt)
    if (m.regen && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + this.maxHp * m.regen * dt)
    const fn = this['update_' + this.type]
    if (fn) fn.call(this, dt)
    else if (this.def.shooter) this.updateShooter(dt)
  }
  // —— 射手 ——
  updateShooter (dt) {
    const s = this.def.shooter, m = G.mods
    const lanes = (s.lanes || [0]).map(d => this.row + d).filter(r => r >= 0 && r < ROWS)
    const hasTarget = lanes.some(r => G.zombies.some(z => z.alive && z.row === r && z.x > this.x - 10 && z.x < W - 20))
    if (this.anims.attack) this.setState(hasTarget ? 'attack' : 'idle')
    // 连发队列
    for (let i = this.shotQueue.length - 1; i >= 0; i--) {
      this.shotQueue[i] -= dt
      if (this.shotQueue[i] <= 0) {
        this.shotQueue.splice(i, 1)
        for (const r of lanes) G.peas.push(new Pea(this, r, s.ice))
        Sound.play('shoot')
      }
    }
    this.shootTimer -= dt
    if (hasTarget && this.shootTimer <= 0) {
      this.shootTimer = s.interval / (m.fireRate * (m.tenpaiRage && G.tenpai ? 1.3 : 1))
      const shots = s.shots + m.extraShots
      for (let i = 0; i < shots; i++) this.shotQueue.push(i * 0.13)
    }
  }
  update_sunflower (dt) {
    this.t -= dt
    if (this.t <= 0) {
      this.t = 12 / G.mods.sunflowerRate
      for (let i = 0; i < G.mods.sunflowerAmt; i++) G.dropTile(this.x - 10 + i * 20, rowTop(this.row) + 30, 'plant')
    }
  }
  update_wallnut () {
    const r = this.hp / this.maxHp
    this.setState(r > 2 / 3 ? 'idleH' : r > 1 / 3 ? 'idleM' : 'idleL')
  }
  update_spikeweed (dt) {
    this.t -= dt
    if (this.t > 0) return
    const hits = G.zombies.filter(z => z.alive && z.row === this.row && z.x > this.x - 50 && z.x < this.x + 35)
    if (hits.length) {
      this.t = 1
      for (const z of hits) z.damage(20 * G.mods.spikeDmg, { pierceArmor: G.mods.spikePierceArmor })
      burst(this.x, plantGround(this.row) - 5, { n: 4, colors: ['#8a8f6a', '#c9b98a'], speed: [40, 100], size: [1.5, 3], life: [0.2, 0.35], up: 90 })
      Sound.play('hitCone')
    }
  }
  update_potatomine (dt) {
    if (this.state === 'init') {
      this.t -= dt
      if (this.t <= 0) this.setState('idle')
    } else if (this.state === 'idle') {
      if (G.zombies.some(z => z.alive && z.row === this.row && z.x > this.x - 40 && z.x < this.x + 30)) {
        this.setState('explode')
        this.busy = true
        this.t = 0.8
        blast(z => z.row === this.row && Math.abs(z.x - this.x) < 70)
        FX.explosion(this.x, plantGround(this.row) - 20, 0.6)
        G.impact(0.25, 0.06, 'rgba(255,240,200,0.35)')
        Sound.play('explode')
      }
    } else {
      this.t -= dt
      if (this.t <= 0) this.dead = true
    }
  }
  update_squash (dt) {
    if (this.state === 'idle') {
      const z = G.zombies.find(z => z.alive && z.row === this.row && z.x > this.x - 45 && z.x < this.x + 110)
      if (z) {
        this.setState('aim')
        this.busy = true
        this.t = 0.4
        this.target = z
      }
    } else if (this.state === 'aim') {
      this.t -= dt
      if (this.t <= 0) {
        this.setState('attack')
        this.anims.attack.loop = false
        this.targetX = this.target.alive ? this.target.x + 25 : this.x
      }
    } else if (this.state === 'attack') {
      this.x += (this.targetX - this.x) * Math.min(1, dt * 10)
      if (this.anim.done) {
        blast(z => z.row === this.row && Math.abs(z.x - this.targetX + 25) < 75)
        FX.dirt(this.targetX, plantGround(this.row), 18)
        burst(this.targetX, plantGround(this.row), { n: 10, colors: ['rgba(200,190,160,0.7)'], speed: [80, 200], size: [8, 14], life: [0.4, 0.7], up: 20, g: -30, drag: 3, grow: 15, dir: 0, spread: Math.PI * 2 })
        G.impact(0.3, 0.07)
        Sound.play('squash')
        this.dead = true
      }
    }
  }
  update_chomper (dt) {
    if (this.state === 'idle') {
      const z = G.zombies.find(z => z.alive && z.row === this.row && z.x > this.x - 25 && z.x < this.x + 100)
      if (z) {
        this.setState('attack')
        this.anims.attack.loop = false
        this.target = z
        this.t = 0.45
      }
    } else if (this.state === 'attack') {
      this.t -= dt
      if (this.t <= 0 && this.target) {
        const z = this.target
        this.target = null
        if (z.alive) z.def.boss ? z.damage(BOSS_BIG_DMG) : z.swallow()
        G.floatText('咕嘟！', this.x + 40, rowTop(this.row) + 20, '#e0a8ff')
        G.impact(0.12, 0.04)
        Sound.play('swallow')
      }
      if (this.anim.done) {
        this.setState('digest')
        this.t = 18 * G.mods.digest
      }
    } else if (this.state === 'digest') {
      this.t -= dt
      if (this.t <= 0) this.setState('idle')
    }
  }
  update_cherrybomb () {
    if (this.state === 'idle' && this.anim.done) {
      this.setState('attack')
      this.anims.attack.loop = false
      const r = G.mods.cherryRange
      blast(z => Math.abs(z.row - this.row) <= r && Math.abs(z.x - this.x) < (r + 0.5) * CELL_W + 25, this.dmgMul)
      FX.explosion(this.x, rowTop(this.row) + 50, r)
      G.impact(0.45, 0.09, 'rgba(255,230,180,0.6)')
      Sound.play('explode')
    } else if (this.state === 'attack' && this.anim.done) {
      this.dead = true
    }
  }
  update_jalapeno () {
    if (this.state === 'idle' && this.anim.done) {
      this.setState('explode')
      this.anims.explode.loop = false
      blast(z => z.row === this.row, this.dmgMul)
      FX.fireRow(this.row)
      G.impact(0.4, 0.08, 'rgba(255,140,40,0.45)')
      Sound.play('fireRow')
    } else if (this.state === 'explode' && this.anim.done) {
      this.dead = true
    }
  }
  hurt (dmg) {
    this.hp -= dmg
    this.flash = 0.12
    if (this.hp <= 0 && !this.dead) {
      this.dead = true
      FX.leaves(this.x, plantGround(this.row) - 30)
      Sound.play('plantDie')
    }
  }
  draw (x) {
    const image = this.anim.img, def = this.def
    if (!image) return
    let dx = this.x - image.width / 2 + (def.ox || 0)
    let dy = plantGround(this.row) - image.height + (def.oy || 0)
    if (this.type === 'cherrybomb' && this.state === 'attack') {
      dx = this.x - image.width / 2; dy = rowTop(this.row) + 50 - image.height / 2
    } else if (this.type === 'jalapeno' && this.state === 'explode') {
      dx = LAWN_X - 20; dy = zombieGround(this.row) - image.height + 8
    } else if (this.type === 'potatomine' && this.state === 'explode') {
      dy = plantGround(this.row) - image.height + 20
    } else if (this.type === 'squash') {
      dy += 8
    }
    if (this.flash > 0) x.filter = 'brightness(1.6)'
    if (this.pop > 0) {
      // 种下时从压扁状态弹起（easeOutBack）
      const k = 1 - this.pop / 0.3, s = 1 + 2.7 * Math.pow(k - 1, 3) + 1.7 * Math.pow(k - 1, 2)
      const ax = this.x, ay = plantGround(this.row)
      x.save()
      x.translate(ax, ay)
      x.scale(1 + (1 - s) * 0.4, s)
      x.drawImage(image, dx - ax, dy - ay)
      x.restore()
    } else {
      x.drawImage(image, dx, dy)
    }
    x.filter = 'none'
  }
}

// 对满足条件的僵尸造成爆炸伤害
function blast (pred, mul = 1) {
  const hits = G.zombies.filter(z => z.alive && z.x < W && pred(z))
  for (const z of hits) z.damage((z.def.boss ? BOSS_BIG_DMG : BIG_DMG) * mul, { boom: true })
  if (!hits.length) return
  // 多只僵尸同时受击时只显示一个合并的伤害数字
  const cx = hits.reduce((a, z) => a + z.x, 0) / hits.length + 20
  const cy = hits.reduce((a, z) => a + zombieGround(z.row), 0) / hits.length - 120
  const dmg = (hits.some(z => z.def.boss) ? BOSS_BIG_DMG : BIG_DMG) * mul
  G.dmgText(dmg + (hits.length > 1 ? ' ×' + hits.length : ''), cx, cy, true)
}

class Zombie {
  constructor (type, row) {
    this.type = type
    this.def = ZOMBIES[type]
    this.row = row
    this.x = SPAWN_X + Math.random() * 30
    this.hp = this.def.hp
    this.armor = this.def.armor
    this.maxTotal = this.hp + this.armor
    this.animSet = Object.assign({}, ZOMBIE_COMMON, this.def.anim)
    this.anim = new Anim(this.animSet.walk, 10)
    this.animName = 'walk'
    this.alive = true
    this.dead = false             // 可移除
    this.lostHead = false
    this.angry = false            // 读报僵尸丢失报纸后暴走
    this.slowT = 0
    this.flash = 0
    this.fade = 1
    this.kick = 0                 // 受击后退的视觉偏移
    this.eatFx = 0
    this.bossT = 6                // 僵尸王召唤计时
    this.leaps = 0
    if (this.def.boss) this.hp = this.maxTotal = this.def.hp * (1 + 0.1 * G.stageIndex)
  }
  setAnim (name, loop = true) {
    // 失去头部后使用 lost 系列动画
    let key = name
    if (this.lostHead && (name === 'walk' || name === 'attack')) key = 'lost' + name
    else if (this.type === 'paper' && this.armor <= 0 && (name === 'walk' || name === 'attack')) key = 'nopaper' + name
    if (this.animName === key) return
    this.animName = key
    this.anim = new Anim(this.animSet[key], name === 'die' || name === 'boom' ? 9 : 10, loop)
  }
  get speedFactor () {
    return (this.slowT > 0 ? G.mods.slow : 1) * G.mods.zombieSpeed * G.stageMods.zombieSpeed
  }
  update (dt) {
    this.flash = Math.max(0, this.flash - dt)
    this.kick = Math.max(0, this.kick - dt * 40)
    if (!this.alive) {
      this.anim.update(dt)
      if (this.anim.done) {
        this.fade -= dt * 2
        if (this.fade <= 0) this.dead = true
      }
      return
    }
    this.slowT = Math.max(0, this.slowT - dt)
    const f = this.speedFactor
    // 走路动画随移动速度加快，避免“滑步”
    this.anim.update(dt * f * (this.animName.includes('walk') ? 1.6 : 1))
    if (this.def.boss) this.updateBoss(dt)
    // 查找可啃食的植物
    const p = G.plants.find(p => p.row === this.row && !p.dead && !p.busy && !p.def.noEat &&
      this.x < p.x + 28 && this.x > p.x - 45)
    if (p) {
      this.setAnim('attack')
      const dps = (this.def.boss ? 600 : this.angry ? 200 : 100) * f
      p.hurt(dps * dt)
      Sound.play('chomp')
      this.eatFx -= dt
      if (this.eatFx <= 0) {
        this.eatFx = 0.35
        burst(p.x + 15, plantGround(p.row) - 35, { n: 3, colors: ['#5cbf2a', '#9be85a', '#c9a15a'], speed: [40, 110], size: [2, 3], life: [0.25, 0.45], up: 60 })
      }
      if (p.type === 'wallnut' && G.mods.thorns) this.damage(G.mods.thorns * dt, { silent: true })
    } else {
      this.setAnim('walk')
      const speed = this.angry ? this.def.angrySpeed : this.def.speed
      this.x -= speed * f * dt
    }
  }
  updateBoss (dt) {
    // 定时召唤小弟
    this.bossT -= dt
    if (this.bossT <= 0) {
      this.bossT = 8
      for (let i = 0; i < 2; i++) {
        const r = Math.floor(Math.random() * ROWS)
        G.spawnZombie(Math.random() < 0.5 ? 'normal' : 'cone', r, this.x + 60)
      }
      G.banner('僵尸王召唤了援军！', 1.5)
      Sound.play('groan')
    }
    // 血量降到 2/3、1/3 时跳到其他行
    const ratio = this.hp / this.maxTotal
    if ((this.leaps === 0 && ratio < 2 / 3) || (this.leaps === 1 && ratio < 1 / 3)) {
      this.leaps++
      let r = this.row
      while (r === this.row) r = Math.floor(Math.random() * ROWS)
      G.effects.push(new Effect({ text: '💨', x: this.x, y: zombieGround(this.row) - 80, life: 0.8 }))
      this.row = r
      this.x = Math.min(this.x + 120, W - 60)
      G.banner('僵尸王跳到了第 ' + (r + 1) + ' 行！', 1.5)
      Sound.play('bossRoar')
      G.impact(0.35, 0)
      FX.dirt(this.x + 40, zombieGround(r), 20)
    }
  }
  /**
   * 受到伤害
   * opts.ice: 减速；opts.boom: 爆炸致死；opts.pierceArmor: 无视护具
   */
  damage (dmg, opts = {}) {
    if (!this.alive) return
    if (opts.ice) this.slowT = 10
    if (!opts.silent) this.flash = 0.1
    if (opts.kick) this.kick = Math.min(8, this.kick + opts.kick)
    if (this.armor > 0 && !opts.pierceArmor) {
      this.armor -= dmg
      if (this.armor > 0) return
      dmg = -this.armor
      this.armor = 0
      this.onArmorLost()
    }
    this.hp -= dmg
    if (!this.def.boss && !this.lostHead && this.hp <= 90) this.loseHead()
    if (this.hp <= 0) this.die(opts.boom)
  }
  onArmorLost () {
    FX.armor(this)
    Sound.play('armorOff')
    if (this.type === 'paper') {
      this.angry = true
      this.animName = ''
      G.effects.push(new Effect({ text: '💢', x: this.x + 20, y: zombieGround(this.row) - 130, life: 1 }))
    } else if (this.type === 'cone' || this.type === 'bucket') {
      // 护具掉落后变为普通僵尸外观
      this.animSet = Object.assign({}, ZOMBIE_COMMON)
      this.animName = ''
    }
  }
  loseHead () {
    this.lostHead = true
    Sound.play('headOff')
    this.animName = ''
    const d = this.def
    G.effects.push(new Effect({
      anim: new Anim(this.animSet.head, 10, false),
      x: this.x - d.ax + 50, y: zombieGround(this.row) - d.ay + 5, life: 2.2,
    }))
  }
  die (boom) {
    this.alive = false
    this.hp = 0
    this.setAnim(boom && !this.def.boss ? 'boom' : 'die', false)
    const cx = this.x + 20, cy = zombieGround(this.row) - 60
    boom ? FX.ash(cx, cy) : FX.gore(cx, cy)
    Sound.play('zombieDie')
    if (this.def.boss) { FX.explosion(cx, cy, 2); G.impact(0.8, 0.25, 'rgba(255,255,255,0.8)') }
    G.onZombieKilled(this)
  }
  // 被大嘴花吞掉：直接消失
  swallow () {
    this.alive = false
    this.dead = true
    G.onZombieKilled(this)
  }
  draw (x) {
    const image = this.anim.img
    if (!image) return
    const d = this.def, s = d.scale || 1
    const dx = this.x - d.ax * s + this.kick, dy = zombieGround(this.row) - d.ay * s
    x.globalAlpha = Math.max(0, this.fade)
    const filters = []
    if (d.boss) filters.push('hue-rotate(-50deg) saturate(1.6)')
    if (this.slowT > 0 && this.alive) filters.push('sepia(0.6) hue-rotate(160deg) saturate(2.2)')
    if (this.flash > 0) filters.push('brightness(1.7)')
    x.filter = filters.length ? filters.join(' ') : 'none'
    x.drawImage(image, dx, dy, image.width * s, image.height * s)
    x.filter = 'none'
    x.globalAlpha = 1
    if (d.boss && this.alive) {
      // 僵尸王的王冠
      const cx = dx + 100 * s, cy = dy + 2 * s
      x.fillStyle = '#ffd23f'; x.strokeStyle = '#8a5a00'; x.lineWidth = 2
      x.beginPath()
      x.moveTo(cx - 22, cy + 16); x.lineTo(cx - 24, cy - 6); x.lineTo(cx - 11, cy + 4); x.lineTo(cx, cy - 12)
      x.lineTo(cx + 11, cy + 4); x.lineTo(cx + 24, cy - 6); x.lineTo(cx + 22, cy + 16); x.closePath()
      x.fill(); x.stroke()
    }
  }
}

class Pea {
  constructor (plant, row, ice) {
    const m = G.mods
    this.row = row
    this.x = plant.x + 12
    this.y = rowTop(row) + 18
    this.ice = ice || Math.random() < m.iceChance
    this.fire = m.firePea && !this.ice
    this.dmg = 20 * m.peaDmg * (this.ice ? m.iceDmg : 1) * (this.fire ? 2 : 1)
    this.pierce = m.pierce
    this.hit = new Set()
    this.dead = false
  }
  update (dt) {
    this.x += 330 * dt
    if (this.x > W + 20) { this.dead = true; return }
    const front = this.x + 40
    const z = G.zombies
      .filter(z => z.alive && z.row === this.row && !this.hit.has(z) && z.x <= front && z.x + 45 >= this.x && z.x < W - 10)
      .sort((a, b) => a.x - b.x)[0]
    if (!z) return
    const armorType = z.armor > 0 ? z.type : ''
    z.damage(this.dmg, { ice: this.ice, kick: 3 })
    FX.peaHit(this.x + 35, this.y + 14, this.fire ? 'fire' : this.ice ? 'ice' : '')
    Sound.play(this.fire ? 'hitFire' : this.ice ? 'hitIce' : armorType === 'bucket' ? 'hitBucket' : armorType === 'cone' ? 'hitCone' : 'hit')
    if (this.fire) G.dmgText(this.dmg, z.x + 25, this.y - 10)
    this.hit.add(z)
    if (this.fire) {
      for (const o of G.zombies) {
        if (o !== z && o.alive && o.row === this.row && Math.abs(o.x - z.x) < 80) o.damage(this.dmg / 3)
      }
    }
    G.effects.push(new Effect({ image: img('peaHit'), x: this.x + 10, y: this.y - 6, life: 0.15,
      filter: this.fire ? 'hue-rotate(-90deg) saturate(3)' : this.ice ? 'hue-rotate(120deg)' : '' }))
    if (this.pierce-- <= 0) this.dead = true
  }
  draw (x) {
    if (this.fire) {
      x.filter = 'hue-rotate(-90deg) saturate(3) brightness(1.2)'
      x.drawImage(img('pea'), this.x, this.y)
      x.filter = 'none'
    } else {
      x.drawImage(img(this.ice ? 'peaIce' : 'pea'), this.x, this.y)
    }
  }
}

/**
 * 掉落的麻将牌（天降 / 向日葵），点击收进手牌
 */
class TileDrop {
  constructor (tile, x, y, source, lucky) {
    this.tile = tile
    this.lucky = lucky            // 好牌：金色光晕
    this.x = x
    this.y = y
    this.life = 8
    this.collecting = false
    this.dead = false
    this.bob = Math.random() * 6
    if (source === 'sky') {
      this.vy = 90
      this.targetY = 160 + Math.random() * 330
    } else {
      // 从向日葵弹出
      this.vy = -140
      this.vx = (Math.random() - 0.5) * 60
      this.targetY = y + 50
      this.gravity = 420
    }
    this.landT = 0
  }
  update (dt) {
    this.bob += dt
    if (this.collecting) {
      const tx = HAND_X + G.hand.length * HAND_STEP, ty = HAND_Y
      this.x += (tx - this.x) * Math.min(1, dt * 9)
      this.y += (ty - this.y) * Math.min(1, dt * 9)
      if (Math.abs(this.x - tx) < 8 && Math.abs(this.y - ty) < 8) {
        this.dead = true
        G.pendingDrops--
        if (!G.addToHand(this.tile)) G.deck.putBack([this.tile])
      }
      return
    }
    if (this.gravity) {
      this.vy += this.gravity * dt
      this.x += this.vx * dt
    }
    if (this.y < this.targetY) {
      this.y = Math.min(this.targetY, this.y + this.vy * dt)
    } else {
      this.landT += dt
      this.life -= dt
      if (G.mods.autoCollect && this.landT > 0.6 && G.handRoom() > 0) this.collect()
      if (this.life <= 0) { this.dead = true; G.deck.putBack([this.tile]) }
    }
  }
  hitTest (px, py) {
    return !this.collecting && px > this.x - 8 && px < this.x + DROP_W + 8 && py > this.y - 8 && py < this.y + DROP_H + 8
  }
  collect () {
    if (this.collecting) return
    if (G.handRoom() <= 0) {
      Sound.play('deny')
      G.floatText('手牌已满', this.x, this.y - 10, '#ff8a7a')
      return
    }
    G.pendingDrops++
    this.collecting = true
    FX.sparkle(this.x + DROP_W / 2, this.y + DROP_H / 2)
    Sound.play('sun')
  }
  draw (x) {
    if (this.life < 2 && !this.collecting) x.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(this.life * 8))
    const oy = this.collecting || this.y < this.targetY ? 0 : Math.sin(this.bob * 3) * 3
    // 光晕，提示可以点击
    if (!this.collecting) {
      if (this.lucky) { x.shadowColor = '#ffc400'; x.shadowBlur = 14 + 6 * Math.sin(this.bob * 6) }
      x.fillStyle = this.lucky ? 'rgba(255,200,40,0.6)' : 'rgba(255,235,120,0.35)'
      roundRect(x, this.x - 5, this.y + oy - 5, DROP_W + 10, DROP_H + 10, 9); x.fill()
      x.shadowBlur = 0
    }
    drawTile(x, this.tile, this.x, this.y + oy, DROP_W, DROP_H)
    x.globalAlpha = 1
  }
}

class Mower {
  constructor (row) {
    this.row = row
    this.x = 60
    this.home = 60
    this.state = 'idle'          // idle / run / back
    this.dead = false
  }
  update (dt) {
    if (this.state === 'idle') {
      if (G.zombies.some(z => z.alive && z.row === this.row && z.x < 125)) {
        this.state = 'run'
        Sound.play('mower')
        G.impact(0.15, 0)
      }
    } else if (this.state === 'run') {
      this.x += 420 * dt
      if (Math.random() < 0.5) burst(this.x + 10, rowTop(this.row) + 90, { n: 1, colors: ['#5cbf2a', '#3f8f1c'], speed: [40, 120], size: [2, 4], life: [0.3, 0.5], up: 100, dir: Math.PI, spread: 1, shape: 'rect' })
      for (const z of G.zombies) {
        if (z.alive && z.row === this.row && z.x < this.x + 70 && z.x > this.x - 30) {
          z.def.boss ? (z.damage(1500), z.x += 150) : z.damage(99999)
        }
      }
      if (this.x > W + 40) {
        if (G.mods.mowerReturn) this.state = 'back'
        else this.dead = true
      }
    } else if (this.state === 'back') {
      this.x -= 300 * dt
      if (this.x <= this.home) { this.x = this.home; this.state = 'idle' }
    }
  }
  draw (x) {
    x.drawImage(img('car'), this.x, rowTop(this.row) + 38)
  }
}

/**
 * 通用特效：动画 / 静态图 / 文字
 */
class Effect {
  constructor (o) {
    Object.assign(this, { life: 1, vy: 0, filter: '' }, o)
    this.maxLife = this.life
    this.dead = false
  }
  update (dt) {
    this.life -= dt
    if (this.anim) this.anim.update(dt)
    this.y += this.vy * dt
    if (this.life <= 0) this.dead = true
  }
  draw (x) {
    x.globalAlpha = Math.min(1, this.life / Math.min(0.5, this.maxLife))
    if (this.filter) x.filter = this.filter
    if (this.anim) x.drawImage(this.anim.img, this.x, this.y)
    else if (this.image) x.drawImage(this.image, this.x, this.y)
    else if (this.text) {
      // pop: 出现时先放大再回落
      const age = this.maxLife - this.life
      const size = (this.size || 28) * (this.pop && age < 0.12 ? 1 + (0.12 - age) * 5 : 1)
      x.font = 'bold ' + size + 'px sans-serif'
      x.fillStyle = this.color || '#fff'
      x.textAlign = 'center'
      if (this.stroke) { x.lineWidth = 4; x.strokeStyle = this.stroke; x.strokeText(this.text, this.x, this.y) }
      x.fillText(this.text, this.x, this.y)
      x.textAlign = 'left'
    }
    x.filter = 'none'
    x.globalAlpha = 1
  }
}

/**
 * 粒子：简单的物理小块，用于飞溅、碎屑、烟尘、火星
 */
class Particle {
  constructor (o) {
    Object.assign(this, { vx: 0, vy: 0, g: 600, life: 0.6, size: 4, color: '#fff', shape: 'circle', rot: 0, vr: 0, drag: 0, grow: 0 }, o)
    this.maxLife = this.life
    this.dead = false
  }
  update (dt) {
    this.life -= dt
    if (this.life <= 0) { this.dead = true; return }
    this.vy += this.g * dt
    if (this.drag) { this.vx *= 1 - this.drag * dt; this.vy *= 1 - this.drag * dt }
    this.x += this.vx * dt
    this.y += this.vy * dt
    this.rot += this.vr * dt
    this.size += this.grow * dt
  }
  draw (x) {
    const a = Math.min(1, this.life / (this.maxLife * 0.5))
    x.globalAlpha = a * (this.alpha || 1)
    x.fillStyle = this.color
    x.save()
    x.translate(this.x, this.y)
    x.rotate(this.rot)
    const s = this.size
    if (this.shape === 'circle') {
      x.beginPath(); x.arc(0, 0, s, 0, Math.PI * 2); x.fill()
    } else if (this.shape === 'cone') {
      // 路障
      x.beginPath(); x.moveTo(0, -s * 1.3); x.lineTo(s, s); x.lineTo(-s, s); x.closePath(); x.fill()
      x.fillStyle = '#fff'; x.fillRect(-s * 0.55, -s * 0.1, s * 1.1, s * 0.3)
    } else if (this.shape === 'bucket') {
      // 铁桶
      x.beginPath(); x.moveTo(-s, -s); x.lineTo(s, -s); x.lineTo(s * 0.8, s); x.lineTo(-s * 0.8, s); x.closePath(); x.fill()
      x.strokeStyle = '#555'; x.lineWidth = 2; x.stroke()
    } else {
      x.fillRect(-s / 2, -s / 2, s, s)
    }
    x.restore()
    x.globalAlpha = 1
  }
}

const rand = (a, b) => a + Math.random() * (b - a)

/**
 * 在 (x, y) 处喷出一组粒子
 * n: 数量；colors: 颜色表；speed: 初速度范围；up: 向上偏移
 */
function burst (x, y, { n = 6, colors = ['#fff'], speed = [60, 180], size = [2, 4], life = [0.3, 0.6], g = 600, up = 80, shape = 'circle', spread = Math.PI * 2, dir = 0, drag = 0, grow = 0, alpha = 1 } = {}) {
  if (G.particles.length > 400) return
  for (let i = 0; i < n; i++) {
    const a = dir + (Math.random() - 0.5) * spread, v = rand(speed[0], speed[1])
    G.particles.push(new Particle({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - up, g, drag, grow, alpha,
      size: rand(size[0], size[1]), life: rand(life[0], life[1]),
      color: colors[Math.floor(Math.random() * colors.length)], shape, vr: rand(-8, 8),
    }))
  }
}

// 常用特效组合
const FX = {
  peaHit (x, y, kind) {
    const colors = kind === 'ice' ? ['#bfefff', '#7fd8ff', '#fff'] : kind === 'fire' ? ['#ffb640', '#ff6a00', '#ffe066'] : ['#9be85a', '#5cbf2a', '#d6ff9e']
    burst(x, y, { n: kind === 'fire' ? 8 : 5, colors, speed: [80, 200], size: [2, 4], life: [0.2, 0.4], up: 60, dir: Math.PI, spread: Math.PI * 1.2 })
  },
  dirt (x, y, n = 10) {
    burst(x, y, { n, colors: ['#7a5230', '#5c3d20', '#9b7048'], speed: [60, 170], size: [2, 5], life: [0.3, 0.6], up: 140, shape: 'rect', dir: -Math.PI / 2, spread: Math.PI })
  },
  leaves (x, y) {
    burst(x, y, { n: 10, colors: ['#5cbf2a', '#3f8f1c', '#9be85a'], speed: [60, 180], size: [3, 6], life: [0.5, 0.9], up: 120, shape: 'rect', g: 300 })
  },
  gore (x, y) {
    burst(x, y, { n: 8, colors: ['#6b7d4a', '#4f5e35', '#8a8f6a', '#3b2a1a'], speed: [80, 200], size: [2, 5], life: [0.4, 0.8], up: 120, shape: 'rect' })
  },
  ash (x, y) {
    burst(x, y, { n: 14, colors: ['#222', '#444', '#666'], speed: [30, 120], size: [2, 5], life: [0.6, 1.2], up: 60, g: -40, drag: 1.5, shape: 'rect' })
  },
  explosion (x, y, scale = 1) {
    burst(x, y, { n: 26 * scale, colors: ['#ffe066', '#ffb640', '#ff6a00', '#fff3c4'], speed: [150, 420], size: [3, 7], life: [0.3, 0.7], up: 120, drag: 2.5 })
    burst(x, y, { n: 12 * scale, colors: ['rgba(80,80,80,0.8)', 'rgba(120,120,120,0.7)'], speed: [40, 140], size: [10, 18], life: [0.7, 1.2], up: 40, g: -60, drag: 2, grow: 20 })
    burst(x, y, { n: 12 * scale, colors: ['#5c3d20', '#7a5230'], speed: [150, 320], size: [3, 6], life: [0.5, 0.9], up: 250, shape: 'rect' })
  },
  fireRow (row) {
    const y = zombieGround(row) - 30
    for (let px = LAWN_X; px < W; px += 45) {
      burst(px, y, { n: 3, colors: ['#ffe066', '#ffb640', '#ff6a00'], speed: [20, 80], size: [3, 7], life: [0.5, 1], up: 120, g: -150, drag: 1 })
    }
  },
  sparkle (x, y) {
    burst(x, y, { n: 8, colors: ['#fff6a8', '#ffe066', '#fff'], speed: [60, 150], size: [2, 3], life: [0.3, 0.5], up: 0, g: 0, drag: 3 })
  },
  // 飞出的护具
  armor (z) {
    const d = z.def
    const x = z.x + 30, y = zombieGround(z.row) - d.ay + 20
    if (z.type === 'paper') {
      burst(x - 20, y + 60, { n: 12, colors: ['#f2f2f2', '#d8d8d8', '#bbb'], speed: [60, 200], size: [4, 8], life: [0.6, 1.1], up: 150, g: 350, shape: 'rect' })
    } else {
      G.particles.push(new Particle({ x, y, vx: rand(60, 140), vy: -320, g: 900, life: 1.1, size: 14, vr: rand(6, 12),
        color: z.type === 'cone' ? '#ff8a1f' : '#a9b0b8', shape: z.type }))
    }
  },
}

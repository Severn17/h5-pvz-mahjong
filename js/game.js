/**
 * 游戏主体：主循环、关卡流程、输入、绘制
 */
class Game {
  constructor () {
    this.canvas = document.getElementById('canvas')
    this.ctx = this.canvas.getContext('2d')
    this.state = 'loading'           // loading / title / playing / draft / paused / over / victory
    this.speed = 1
    this.mouse = { x: -100, y: -100 }
    this.hoverCard = -1
    this.selected = null             // 选中的植物类型或 'shovel'
    this.shake = 0
    this.last = 0
    this.reset()
  }
  reset () {
    this.mods = baseMods()
    this.stageMods = { zombieSpeed: 1 }
    this.sun = 200
    this.plants = []
    this.zombies = []
    this.peas = []
    this.suns = []
    this.effects = []
    this.particles = []
    this.hitstop = 0              // 命中顿帧剩余时间
    this.screenFlash = null       // 全屏闪光 { color, t }
    this.vignette = 0             // 红色警告边框剩余时间
    this.mowers = []
    for (let r = 0; r < ROWS; r++) this.mowers.push(new Mower(r))
    this.cards = PLANT_ORDER.map(type => ({ type, cd: 0, cdMax: 1 }))
    this.owned = []                  // 已获得强化 id 列表
    this.stageIndex = -1
    this.kills = 0
    this.runTime = 0
    this.rerolls = 2
    this.selected = null
  }

  // ———————————————— 流程 ————————————————
  startRun () {
    this.reset()
    UI.hideAll()
    UI.showHud(true)
    this.state = 'draft'
    UI.showDraft('选择一项开局祝福', this.rollUpgrades(0), () => this.startStage(0))
  }
  startStage (i) {
    const cfg = STAGES[i]
    this.stageIndex = i
    this.stageT = 0
    this.skySunT = 2
    // 关卡特性
    const s = this.stageMods = { zombieSpeed: 1, budgetMul: 1, killSun: 0, noSkySun: false, bonusSun: 0, poolBoost: null }
    let mod
    if (cfg.boss) mod = { id: 'boss', name: '僵尸王来袭', desc: '击败铁桶僵尸王即可获胜！', icon: '👑' }
    else if (i === 0) mod = MODIFIERS[0]
    else mod = MODIFIERS[1 + Math.floor(Math.random() * (MODIFIERS.length - 1))]
    if (mod.apply) mod.apply(s)
    this.modifier = mod
    // 关卡开始奖励
    if (this.mods.interest && i > 0) {
      const bonus = Math.min(250, Math.floor(this.sun * 0.25))
      this.sun += bonus
      this.floatText('复利 +' + bonus, 170, 70, '#ffe066')
    }
    this.sun += s.bonusSun
    for (const c of this.cards) c.cd = 0
    this.buildSpawns(cfg)
    this.state = 'playing'
    UI.hideAll()
    UI.updateStage()
    UI.banner('第 ' + (i + 1) + ' 关　' + mod.icon + ' ' + mod.name, 2.8, mod.desc)
    Sound.play('stageStart')
    Sound.startMusic(cfg.boss ? 'tense' : 'calm')
    Sound.setMusicMode(cfg.boss ? 'tense' : 'calm')
  }
  // 生成本关僵尸出场表
  buildSpawns (cfg) {
    const s = this.stageMods
    const pool = Object.assign({}, cfg.pool)
    if (s.poolBoost) for (const k in s.poolBoost) pool[k] = (pool[k] || 0) + s.poolBoost[k]
    const pick = () => {
      const total = Object.values(pool).reduce((a, b) => a + b, 0)
      let r = Math.random() * total
      for (const k in pool) { if ((r -= pool[k]) < 0) return k }
      return 'normal'
    }
    const budget = cfg.budget * s.budgetMul
    const list = []
    // 零散刷怪：前期稀疏、后期密集
    let spent = 0
    const trickle = []
    while (spent < budget * 0.62) {
      const t = pick()
      trickle.push(t)
      spent += ZOMBIES[t].cost
    }
    trickle.forEach((type, k) => {
      const u = (k + 1) / trickle.length
      list.push({ t: 5 + (cfg.spawnTime - 5) * Math.pow(u, 0.75), type })
    })
    // 一大波僵尸：旗帜僵尸领头
    const waveT = cfg.spawnTime + 3
    list.push({ t: waveT, type: 'flag', wave: true })
    let wave = 0, n = 0
    while (wave < budget * 0.38) {
      const t = pick()
      list.push({ t: waveT + 0.6 + n * 0.35, type: t })
      wave += ZOMBIES[t].cost
      n++
    }
    if (cfg.boss) list.push({ t: 4, type: 'boss', row: 2 })
    list.sort((a, b) => a.t - b.t)
    list.forEach(e => { if (e.row === undefined) e.row = Math.floor(Math.random() * ROWS) })
    this.spawns = list
    this.spawnTotal = list.length
    this.waveT = waveT
    this.waveAnnounced = false
    this.skyFireAt = 0
  }
  spawnZombie (type, row, x) {
    const z = new Zombie(type, row)
    if (x) z.x = x
    this.zombies.push(z)
    return z
  }
  stageCleared () {
    const i = this.stageIndex
    if (i === STAGES.length - 1) return this.gameOver(true)
    this.state = 'draft'
    this.selected = null
    // 清理残留阳光：自动收集
    for (const s of this.suns) if (!s.collecting) this.sun += s.value
    this.suns = []
    this.peas = []
    UI.showDraft('第 ' + (i + 1) + ' 关完成！选择一项强化', this.rollUpgrades(i + 1), () => this.startStage(i + 1))
  }
  gameOver (win) {
    this.state = win ? 'victory' : 'over'
    Sound.stopMusic()
    Sound.play(win ? 'victory' : 'lose')
    this.selected = null
    UI.showEnd(win)
  }
  onZombieKilled (z) {
    this.kills++
    const bonus = this.mods.killSun + this.stageMods.killSun
    if (bonus) {
      this.sun += bonus
      this.floatText('+' + bonus, z.x + 20, zombieGround(z.row) - 110, '#ffe066')
    }
  }
  // 打击感：震屏 + 顿帧 + 全屏闪光
  impact (shake, stop = 0, flash = '') {
    this.shake = Math.max(this.shake, shake)
    this.hitstop = Math.max(this.hitstop, stop)
    if (flash) this.screenFlash = { color: flash, t: 0.18 }
  }
  // 伤害数字
  dmgText (v, x, y, big) {
    this.effects.push(new Effect({ text: typeof v === 'number' ? Math.round(v) : v, x: x + rand(-8, 8), y, life: big ? 0.9 : 0.6, vy: big ? -70 : -50,
      color: big ? '#ffd23f' : '#ffb640', stroke: '#5a1a00', size: big ? 30 : 18, pop: true }))
  }
  // 随机抽取三个强化
  rollUpgrades (stage) {
    const weights = stage === 0 ? { common: 70, rare: 27, legendary: 3 }
      : { common: 58 - stage * 5, rare: 34 + stage * 2, legendary: 8 + stage * 3 }
    const count = id => this.owned.filter(o => o === id).length
    const avail = UPGRADES.filter(u => count(u.id) < (u.max || 1))
    const res = []
    for (let k = 0; k < 3 && avail.length; k++) {
      const total = avail.reduce((a, u) => a + weights[u.rarity], 0)
      let r = Math.random() * total, idx = 0
      for (; idx < avail.length; idx++) { if ((r -= weights[avail[idx].rarity]) < 0) break }
      res.push(avail.splice(Math.min(idx, avail.length - 1), 1)[0])
    }
    return res
  }
  takeUpgrade (u) {
    this.owned.push(u.id)
    u.apply(this.mods, this)
    UI.updateRelics()
  }
  repairMowers () {
    for (let r = 0; r < ROWS; r++) {
      if (!this.mowers.some(m => m.row === r)) this.mowers.push(new Mower(r))
    }
  }
  banner (text, time, sub) { UI.banner(text, time, sub) }
  floatText (text, x, y, color) {
    this.effects.push(new Effect({ text, x, y, life: 1.2, vy: -30, color, stroke: '#4a2a00', size: 22 }))
  }

  // ———————————————— 卡片 ————————————————
  cost (type) { return Math.round(PLANTS[type].cost * this.mods.costMul / 5) * 5 }
  cardCd (type) {
    return PLANTS[type].cd * this.mods.cardCd * (EXPLOSIVES.includes(type) ? this.mods.explosiveCd : 1)
  }
  cardReady (c) { return c.cd <= 0 && this.sun >= this.cost(c.type) }
  selectCard (i) {
    const c = this.cards[i]
    if (!c || this.state !== 'playing') return
    if (this.selected === c.type) { this.selected = null; return }
    if (this.cardReady(c)) {
      this.selected = c.type
      Sound.play('select')
    } else {
      // 冷却中或阳光不足：卡片抖动
      c.shake = 0.3
      Sound.play('deny')
      if (this.sun < this.cost(c.type)) UI.flashSun()
    }
  }
  plantAt (row, col) {
    const type = this.selected
    const c = this.cards.find(c => c.type === type)
    if (!c || !this.cardReady(c)) return
    if (this.plants.some(p => p.row === row && p.col === col && !p.dead)) return
    this.sun -= this.cost(type)
    c.cdMax = c.cd = this.cardCd(type)
    this.plants.push(new Plant(type, row, col))
    this.selected = null
    FX.dirt(cellCx(col), plantGround(row) - 4)
    Sound.play('plant')
  }

  // ———————————————— 更新 ————————————————
  update (dt) {
    this.runTime += dt
    this.stageT += dt
    // 刷怪
    while (this.spawns.length && this.spawns[0].t <= this.stageT) {
      const e = this.spawns.shift()
      this.spawnZombie(e.type, e.row)
      if (e.type === 'boss') {
        UI.banner('👑 铁桶僵尸王出现了！', 2.5, '血量降低时它会跳到其他行')
        Sound.play('bossRoar')
        this.impact(0.5, 0)
      }
    }
    if (!this.waveAnnounced && this.stageT >= this.waveT - 3) {
      this.waveAnnounced = true
      UI.banner('一大波僵尸正在接近！', 2.5)
      Sound.play('wave')
      Sound.setMusicMode('tense')
      this.vignette = 3.5
      this.skyFireAt = this.waveT + 1.5
    }
    if (this.skyFireAt && this.stageT >= this.skyFireAt) {
      this.skyFireAt = 0
      if (this.mods.skyFire) this.skyFire()
    }
    // 天降阳光
    if (!this.stageMods.noSkySun) {
      this.skySunT -= dt
      if (this.skySunT <= 0) {
        this.skySunT = 4.5 / this.mods.skySunRate
        this.suns.push(new Sun(180 + Math.random() * 650, -80, 25, 'sky'))
      }
    }
    for (const c of this.cards) c.cd = Math.max(0, c.cd - dt)
    for (const p of this.plants) p.update(dt)
    for (const z of this.zombies) z.update(dt)
    for (const p of this.peas) p.update(dt)
    for (const s of this.suns) s.update(dt)
    for (const m of this.mowers) m.update(dt)
    for (const e of this.effects) e.update(dt)
    for (const p of this.particles) p.update(dt)
    // 偶尔的僵尸呻吟
    if (Math.random() < dt * 0.3 && this.zombies.some(z => z.alive && z.x < W)) Sound.play('groan')
    this.vignette = Math.max(0, this.vignette - dt)
    this.plants = this.plants.filter(p => !p.dead)
    this.zombies = this.zombies.filter(z => !z.dead)
    this.peas = this.peas.filter(p => !p.dead)
    this.suns = this.suns.filter(s => !s.dead)
    this.mowers = this.mowers.filter(m => !m.dead)
    this.effects = this.effects.filter(e => !e.dead)
    this.particles = this.particles.filter(p => !p.dead)
    this.shake = Math.max(0, this.shake - dt)
    // 失败判定
    const intruder = this.zombies.find(z => z.alive && z.x < HOUSE_X)
    if (intruder) {
      if (this.mods.insurance > 0) {
        this.mods.insurance--
        blast(() => true)
        for (const z of this.zombies) if (z.alive) z.damage(99999, { boom: true })
        this.impact(0.6, 0.15, 'rgba(255,255,255,0.7)')
        Sound.play('explode')
        UI.banner('📜 末日保险生效！', 2.5, '全场僵尸已被消灭')
      } else {
        return this.gameOver(false)
      }
    }
    // 过关判定
    if (!this.spawns.length && !this.zombies.some(z => z.alive)) this.stageCleared()
    UI.updateHud()
  }
  // 天火：焚烧僵尸最多的两行
  skyFire () {
    const counts = [...Array(ROWS).keys()].map(r => ({ r, n: this.zombies.filter(z => z.alive && z.row === r && z.x < W).length }))
    counts.sort((a, b) => b.n - a.n)
    for (const { r, n } of counts.slice(0, 2)) {
      if (!n) continue
      const p = new Plant('jalapeno', r, 4)
      p.anims.idle.t = 99
      this.plants.push(p)
    }
  }

  // ———————————————— 输入 ————————————————
  cellAt (x, y) {
    const col = Math.floor((x - LAWN_X) / CELL_W), row = Math.floor((y - LAWN_Y) / CELL_H)
    return row >= 0 && row < ROWS && col >= 0 && col < COLS ? { row, col } : null
  }
  cardAt (x, y) {
    if (x < 2 || x > CARD_W + 2) return -1
    const i = Math.floor((y - 2) / (CARD_H + 2))
    return i >= 0 && i < this.cards.length ? i : -1
  }
  onClick (x, y) {
    if (this.state !== 'playing') return
    // 优先收集阳光
    const sun = [...this.suns].reverse().find(s => s.hitTest(x, y))
    if (sun) return sun.collect()
    const ci = this.cardAt(x, y)
    if (ci >= 0) return this.selectCard(ci)
    const cell = this.cellAt(x, y)
    if (cell && this.selected === 'shovel') {
      const p = this.plants.find(p => p.row === cell.row && p.col === cell.col && !p.busy)
      if (p) {
        p.dead = true
        FX.dirt(p.x, plantGround(p.row) - 10, 14)
        Sound.play('shovel')
      }
      this.selected = null
    } else if (cell && this.selected) {
      this.plantAt(cell.row, cell.col)
    } else {
      this.selected = null
    }
  }
  onKey (e) {
    if (e.code === 'Space') { e.preventDefault(); this.togglePause() }
    if (this.state !== 'playing') return
    if (e.key === 'Escape') this.selected = null
    if (e.key === 's' || e.key === 'S') this.toggleShovel()
    if (e.key === 'f' || e.key === 'F') this.toggleSpeed()
    if (e.key === 'm' || e.key === 'M') Sound.toggleMute()
    const n = '1234567890'.indexOf(e.key)
    if (n >= 0) this.selectCard(n)
  }
  toggleShovel () {
    if (this.state !== 'playing') return
    this.selected = this.selected === 'shovel' ? null : 'shovel'
    Sound.play('select')
  }
  toggleSpeed () {
    this.speed = this.speed === 1 ? 2 : 1
    UI.updateHud()
  }
  togglePause () {
    if (this.state === 'playing') { this.state = 'paused'; UI.showPause() }
    else if (this.state === 'paused') { this.state = 'playing'; UI.hideAll() }
  }

  // ———————————————— 绘制 ————————————————
  draw () {
    const x = this.ctx
    x.save()
    if (this.shake > 0) x.translate((Math.random() - 0.5) * 10 * this.shake * 3, (Math.random() - 0.5) * 10 * this.shake * 3)
    if (this.state === 'loading' || this.state === 'title') {
      x.fillStyle = '#000'; x.fillRect(0, 0, W, H)
      if (img('cover') && img('cover').complete) x.drawImage(img('cover'), (W - 900) / 2, 0)
      x.restore()
      return
    }
    x.drawImage(img('bg'), BG_X, 0)
    for (const m of this.mowers) m.draw(x)
    this.drawGhost(x)
    // 按行绘制，保证遮挡关系
    for (let r = 0; r < ROWS; r++) {
      for (const p of this.plants) if (p.row === r) p.draw(x)
      const zs = this.zombies.filter(z => z.row === r).sort((a, b) => b.x - a.x)
      for (const z of zs) z.draw(x)
    }
    for (const p of this.peas) p.draw(x)
    for (const p of this.particles) p.draw(x)
    for (const e of this.effects) e.draw(x)
    this.drawBossBar(x)
    for (const s of this.suns) s.draw(x)
    this.drawCards(x)
    this.drawCursor(x)
    x.restore()
    this.drawScreenFx(x)
  }
  // 全屏闪光与警告边框
  drawScreenFx (x) {
    if (this.screenFlash) {
      x.globalAlpha = Math.max(0, this.screenFlash.t / 0.18)
      x.fillStyle = this.screenFlash.color
      x.fillRect(0, 0, W, H)
      x.globalAlpha = 1
    }
    if (this.vignette > 0) {
      const a = Math.min(1, this.vignette) * (0.35 + 0.25 * Math.sin(this.vignette * 9))
      const g = x.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, W * 0.62)
      g.addColorStop(0, 'rgba(200,0,0,0)')
      g.addColorStop(1, 'rgba(200,0,0,' + a + ')')
      x.fillStyle = g
      x.fillRect(0, 0, W, H)
    }
  }
  drawCards (x) {
    x.fillStyle = 'rgba(60, 35, 10, 0.55)'
    x.fillRect(0, 0, CARD_W + 4, H)
    this.cards.forEach((c, i) => {
      const y = 2 + i * (CARD_H + 2)
      // 拒绝时左右抖动
      const sx = c.shake > 0 ? Math.sin(c.shake * 60) * 4 * (c.shake / 0.3) : 0
      x.save()
      x.translate(sx, 0)
      const ready = this.cardReady(c)
      if (!ready) x.filter = 'grayscale(0.8) brightness(0.65)'
      x.drawImage(CARD_IMAGES[c.type], 2, y)
      x.filter = 'none'
      // 冷却遮罩
      if (c.cd > 0) {
        x.fillStyle = 'rgba(0,0,0,0.45)'
        x.fillRect(3, y + 1, CARD_W - 2, (CARD_H - 2) * c.cd / c.cdMax)
      }
      // 阳光消耗
      x.font = 'bold 17px sans-serif'
      x.textAlign = 'center'
      x.fillStyle = this.sun >= this.cost(c.type) ? '#3a2400' : '#c0392b'
      x.fillText(this.cost(c.type), 82, y + 28)
      x.textAlign = 'left'
      // 快捷键
      if (i < 10) {
        x.font = '11px sans-serif'; x.fillStyle = 'rgba(58,36,0,0.6)'
        x.fillText((i + 1) % 10, 88, y + 13)
      }
      if (this.selected === c.type || this.hoverCard === i) {
        x.lineWidth = 3
        x.strokeStyle = this.selected === c.type ? '#ffe14d' : 'rgba(255,255,255,0.7)'
        roundRect(x, 2, y, CARD_W, CARD_H, 6); x.stroke()
      }
      x.restore()
    })
  }
  // 种植位置预览
  drawGhost (x) {
    const cell = this.cellAt(this.mouse.x, this.mouse.y)
    if (!cell || !this.selected || this.state !== 'playing') return
    x.fillStyle = this.selected === 'shovel' ? 'rgba(255,80,80,0.18)' : 'rgba(255,255,255,0.18)'
    x.fillRect(LAWN_X + cell.col * CELL_W, LAWN_Y + cell.row * CELL_H, CELL_W, CELL_H)
    if (this.selected === 'shovel') return
    if (this.plants.some(p => p.row === cell.row && p.col === cell.col)) return
    const def = PLANTS[this.selected]
    const image = FRAMES[def.anim.idle || def.anim.idleH][0]
    x.globalAlpha = 0.45
    x.drawImage(image, cellCx(cell.col) - image.width / 2 + (def.ox || 0), plantGround(cell.row) - image.height + (def.oy || 0))
    x.globalAlpha = 1
  }
  drawCursor (x) {
    if (!this.selected || this.state !== 'playing') return
    const { x: mx, y: my } = this.mouse
    if (this.selected === 'shovel') {
      x.font = '38px sans-serif'
      x.fillText('⛏️', mx - 12, my + 10)
      return
    }
    const def = PLANTS[this.selected]
    const image = FRAMES[def.anim.idle || def.anim.idleH][0]
    x.drawImage(image, mx - image.width / 2 + (def.ox || 0), my - image.height / 2)
  }
  drawBossBar (x) {
    const b = this.zombies.find(z => z.def.boss && z.alive)
    if (!b) return
    const w = 360, l = (W - w) / 2 + 60, t = 578
    x.fillStyle = 'rgba(0,0,0,0.6)'; roundRect(x, l - 4, t - 4, w + 8, 18, 6); x.fill()
    x.fillStyle = '#c0392b'; x.fillRect(l, t, w * b.hp / b.maxTotal, 10)
    x.font = 'bold 13px sans-serif'; x.fillStyle = '#fff'; x.textAlign = 'center'
    x.fillText('👑 铁桶僵尸王  ' + Math.ceil(b.hp), l + w / 2, t - 8)
    x.textAlign = 'left'
  }

  // ———————————————— 主循环 ————————————————
  loop (now) {
    const dt = Math.min(0.05, (now - this.last) / 1000 || 0)
    this.last = now
    for (const c of this.cards) if (c.shake > 0) c.shake -= dt
    if (this.screenFlash && (this.screenFlash.t -= dt) <= 0) this.screenFlash = null
    if (this.hitstop > 0) {
      this.hitstop -= dt
    } else if (this.state === 'playing') {
      // 2 倍速时拆成两步，避免穿模
      for (let i = 0; i < this.speed && this.state === 'playing'; i++) this.update(dt)
    }
    this.draw()
    requestAnimationFrame(t => this.loop(t))
  }
  bindInput () {
    const toLocal = e => {
      const rect = this.canvas.getBoundingClientRect()
      return { x: (e.clientX - rect.left) / window.gameScale, y: (e.clientY - rect.top) / window.gameScale }
    }
    this.canvas.addEventListener('mousemove', e => {
      this.mouse = toLocal(e)
      const i = this.cardAt(this.mouse.x, this.mouse.y)
      if (i !== this.hoverCard) {
        this.hoverCard = i
        UI.cardTip(i >= 0 && this.state === 'playing' ? this.cards[i].type : null, i)
      }
    })
    this.canvas.addEventListener('mouseleave', () => { this.hoverCard = -1; UI.cardTip(null) })
    this.canvas.addEventListener('mousedown', e => {
      const p = toLocal(e)
      if (e.button === 2) this.selected = null
      else if (e.button === 0) this.onClick(p.x, p.y)
    })
    this.canvas.addEventListener('contextmenu', e => e.preventDefault())
    window.addEventListener('keydown', e => this.onKey(e))
    // 浏览器要求用户交互后才能播放声音
    const unlock = () => Sound.init()
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    // 切到后台时自动暂停
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.togglePause() })
  }
}

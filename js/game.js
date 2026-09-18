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
    this.selectedSeed = -1           // 选中的待种植物槽
    // ?seed=123 可固定牌山，方便复现
    const q = new URLSearchParams(location.search).get('seed')
    this.fixedSeed = q ? +q : null
    this.shake = 0
    this.last = 0
    this.reset()
  }
  reset () {
    this.mods = baseMods()
    this.stageMods = { zombieSpeed: 1 }
    this.seed = this.fixedSeed !== null ? this.fixedSeed : Math.floor(Math.random() * 1e9)
    this.random = Mahjong.rng(this.seed)
    this.deck = new Mahjong.Deck(this.random)
    this.hand = []                   // 手牌 [{ t, id, sel, fresh }]
    this.river = []                  // 弃牌/用掉的牌，牌山摸空时洗回
    this.seeds = []                  // 待种植物 [{ plant, hpMul, dmgMul, label, tiles }]
    this.waits = []
    this.canHu = false
    this.tenpai = false
    this.pendingDrops = 0            // 正在飞向手牌的牌
    this.tileSeq = 0
    this.handShake = 0
    this.huFx = null
    this.huCount = 0
    this.bestFan = null
    this.plants = []
    this.zombies = []
    this.peas = []
    this.drops = []
    this.effects = []
    this.particles = []
    this.hitstop = 0              // 命中顿帧剩余时间
    this.screenFlash = null       // 全屏闪光 { color, t }
    this.vignette = 0             // 红色警告边框剩余时间
    this.mowers = []
    for (let r = 0; r < ROWS; r++) this.mowers.push(new Mower(r))
    this.owned = []                  // 已获得强化 id 列表
    this.stageIndex = -1
    this.kills = 0
    this.runTime = 0
    this.rerolls = 2
    this.selected = null
    this.selectedSeed = -1
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
    const s = this.stageMods = { zombieSpeed: 1, budgetMul: 1, noSkySun: false, bonusDraw: 0, drawRate: 1, poolBoost: null }
    let mod
    if (cfg.boss) mod = { id: 'boss', name: '僵尸王来袭', desc: '击败铁桶僵尸王即可获胜！', icon: '👑' }
    else if (i === 0) mod = MODIFIERS[0]
    else mod = MODIFIERS[1 + Math.floor(Math.random() * (MODIFIERS.length - 1))]
    if (mod.apply) mod.apply(s)
    this.modifier = mod
    this.stageHuCount = 0
    this.newHand()
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
    this.selectedSeed = -1
    this.drops = []
    this.pendingDrops = 0
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
    if (this.mods.killDraw && this.kills % 4 === 0 && this.drawTile()) {
      this.floatText('赏金 +1 张', z.x + 20, zombieGround(z.row) - 110, '#ffe066')
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

  // ———————————————— 麻将手牌 ————————————————
  newHand () {
    this.deck = new Mahjong.Deck(this.random)
    this.hand = []
    this.river = []
    this.drops = []
    this.pendingDrops = 0
    this.drawT = MJ.drawInterval
    this.huReadyAt = -1
    const n = Math.min(MJ.handSize, MJ.startHand + this.mods.startBonus + this.stageMods.bonusDraw)
    for (let i = 0; i < n; i++) this.drawTile(true)
    this.onHandChanged(true)
  }
  handRoom () { return MJ.handSize - this.hand.length - this.pendingDrops }
  drawFromDeck () {
    if (!this.deck.count && this.river.length) {
      this.deck.putBack(this.river)
      this.river = []
      this.floatText('牌山摸空，弃牌洗回', HAND_X, HAND_Y + TILE_H + 18, '#fff')
    }
    return this.deck.draw()
  }
  drawTile (quiet) {
    if (this.handRoom() <= 0) return false
    const t = this.drawFromDeck()
    if (!t) return false
    return this.addToHand(t, quiet)
  }
  addToHand (t, quiet) {
    if (this.hand.length >= MJ.handSize) return false
    this.hand.push({ t, id: ++this.tileSeq, sel: false, fresh: quiet ? 0 : 0.6 })
    this.hand.sort((a, b) => Mahjong.cmp(a.t, b.t) || a.id - b.id)
    if (!quiet) {
      Sound.play('tile')
      this.onHandChanged()
    }
    return true
  }
  // 手牌变化后重新计算听牌 / 胡牌
  onHandChanged (quiet) {
    const tiles = this.hand.map(h => h.t)
    const wasTenpai = this.tenpai
    this.canHu = Mahjong.isHu(tiles, MJ.handSize)
    this.waits = this.canHu ? [] : Mahjong.waits(tiles, MJ.handSize)
    this.tenpai = this.canHu || this.waits.length > 0
    if (this.canHu && this.huReadyAt < 0) {
      this.huReadyAt = this.stageT
      if (!quiet) Sound.play('tenpai')
    }
    if (!this.canHu) this.huReadyAt = -1
    if (this.tenpai && !wasTenpai && !this.canHu && !quiet) {
      Sound.play('tenpai')
      this.floatText('听牌！', HAND_X + 150, HAND_Y + TILE_H + 20, '#ffe14d')
    }
    if (this.tenpai !== wasTenpai) Sound.setMusicMode(this.tenpai || this.waveAnnounced ? 'tense' : 'calm')
  }
  selectedTiles () { return this.hand.filter(h => h.sel) }
  clearTileSel () { for (const h of this.hand) h.sel = false }
  toggleTile (i) {
    const h = this.hand[i]
    if (!h) return
    if (!h.sel && this.selectedTiles().length >= 3) {
      this.deny('最多选 3 张')
      return
    }
    h.sel = !h.sel
    this.selected = null
    this.selectedSeed = -1
    Sound.play('select')
  }
  // 当前选中的牌能组成什么
  meldPreview () {
    const sel = this.selectedTiles()
    if (sel.length < 2) return null
    const meld = Mahjong.classifyMeld(sel.map(h => h.t))
    return meld ? meldToSeed(meld) : null
  }
  deny (msg) {
    this.handShake = 0.3
    Sound.play('deny')
    if (msg) this.floatText(msg, HAND_X + 120, HAND_Y + TILE_H + 20, '#ff8a7a')
  }
  combine () {
    if (this.state !== 'playing') return
    const sel = this.selectedTiles()
    const seed = this.meldPreview()
    if (!seed) return this.deny(sel.length ? '不是顺子 / 刻子 / 字牌对子' : '先选 3 张牌')
    if (seed.plant && this.seeds.length >= MJ.seedSlots) return this.deny('待种槽已满，先种下植物')
    this.hand = this.hand.filter(h => !h.sel)
    const tiles = sel.map(h => h.t)
    this.river.push(...tiles)
    Sound.play('meld')
    if (seed.plant) {
      this.seeds.push(Object.assign({ tiles }, seed))
      this.floatText('→ ' + (seed.label || PLANTS[seed.plant].name), 10, 30 + this.seeds.length * 48, '#b8ff8a')
    } else {
      this.applyEffect(seed)
    }
    this.onHandChanged()
  }
  applyEffect (seed) {
    if (seed.effect === 'draw2') {
      for (let i = 0; i < 2; i++) this.drawTile()
    } else {
      const t = seed.effect === 'freeze' ? 5 : 2
      for (const z of this.zombies) if (z.alive) z.slowT = Math.max(z.slowT, t)
      this.screenFlash = { color: 'rgba(160,220,255,0.5)', t: 0.18 }
    }
    UI.banner(seed.label, 1.5)
  }
  discard (i) {
    if (this.state !== 'playing') return
    const h = i === undefined ? this.selectedTiles() : [this.hand[i]].filter(Boolean)
    if (h.length !== 1) return this.deny('选中 1 张牌再打出')
    this.hand = this.hand.filter(x => x !== h[0])
    this.river.push(h[0].t)
    Sound.play('tile')
    this.onHandChanged()
  }
  declareHu () {
    if (this.state !== 'playing') return
    if (!this.canHu) return this.deny(this.tenpai ? '还差一张' : '还不能胡')
    const tiles = this.hand.map(h => h.t)
    const tsumo = this.stageT - this.huReadyAt <= 2 || (this.mods.freeTsumo && !this.stageHuCount)
    const fan = Mahjong.calcFan(tiles, { tsumo }, MJ.handSize)
    const dmg = MJ.huDamage * fan.mul * this.mods.huDmg
    const hits = this.zombies.filter(z => z.alive && z.x < W)
    for (const z of hits) z.damage(z.def.boss ? Math.min(dmg, z.maxTotal * MJ.huBossCap) : dmg, { boom: dmg >= 900 })
    for (const z of hits) burst(z.x + 30, zombieGround(z.row) - 60, { n: 8, colors: ['#ffe14d', '#fff3a8', '#ff9a3c'], speed: [80, 220], size: [2, 4], life: [0.4, 0.8], up: 120 })
    this.huCount++
    this.stageHuCount++
    if (!this.bestFan || fan.mul > this.bestFan.mul) this.bestFan = fan
    this.huFx = { t: 1.6, fan, text: hits.length ? '全场 ' + Math.round(dmg) + ' 伤害 · 命中 ' + hits.length + ' 只' : '场上没有僵尸' }
    this.impact(0.6, 0.15, 'rgba(255,215,80,0.6)')
    Sound.play('hu')
    // 手牌洗回牌山，重新摸牌
    this.deck.putBack(tiles)
    this.hand = []
    for (let i = 0; i < MJ.huRedraw; i++) this.drawTile(true)
    this.onHandChanged(true)
    this.drawT = MJ.drawInterval
  }
  // 掉落的牌：有一定概率是能直接凑成面子的"好牌"
  dropTile (x, y, source) {
    let t = null, lucky = false
    if (this.random() < MJ.luckyDrop) {
      const pool = Mahjong.usefulTiles(this.hand.map(h => h.t)).filter(k => this.deck.remaining(k) > 0)
      if (pool.length) { t = this.deck.take(pool[Math.floor(this.random() * pool.length)]); lucky = true }
    }
    if (!t) t = this.drawFromDeck()
    if (t) this.drops.push(new TileDrop(t, x, y, source, lucky))
  }
  selectSeed (i) {
    if (!this.seeds[i] || this.state !== 'playing') return
    if (this.selectedSeed === i) { this.selected = null; this.selectedSeed = -1; return }
    this.selectedSeed = i
    this.selected = this.seeds[i].plant
    this.clearTileSel()
    Sound.play('select')
  }
  plantAt (row, col) {
    const seed = this.seeds[this.selectedSeed]
    if (!seed) return
    if (this.plants.some(p => p.row === row && p.col === col && !p.dead)) return
    this.seeds.splice(this.selectedSeed, 1)
    this.plants.push(new Plant(seed.plant, row, col, seed))
    this.selected = null
    this.selectedSeed = -1
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
    // 天降牌
    if (!this.stageMods.noSkySun) {
      this.skySunT -= dt
      if (this.skySunT <= 0) {
        this.skySunT = MJ.skyDrop / this.mods.skySunRate
        this.dropTile(180 + Math.random() * 650, -60, 'sky')
      }
    }
    // 自动摸牌（手牌满时暂停）
    if (this.handRoom() > 0) {
      this.drawT -= dt * this.mods.drawRate * this.stageMods.drawRate
      if (this.drawT <= 0 && this.drawTile()) this.drawT = MJ.drawInterval
    }
    for (const h of this.hand) h.fresh = Math.max(0, h.fresh - dt)
    for (const p of this.plants) p.update(dt)
    for (const z of this.zombies) z.update(dt)
    for (const p of this.peas) p.update(dt)
    for (const s of this.drops) s.update(dt)
    for (const m of this.mowers) m.update(dt)
    for (const e of this.effects) e.update(dt)
    for (const p of this.particles) p.update(dt)
    // 偶尔的僵尸呻吟
    if (Math.random() < dt * 0.3 && this.zombies.some(z => z.alive && z.x < W)) Sound.play('groan')
    this.vignette = Math.max(0, this.vignette - dt)
    this.plants = this.plants.filter(p => !p.dead)
    this.zombies = this.zombies.filter(z => !z.dead)
    this.peas = this.peas.filter(p => !p.dead)
    this.drops = this.drops.filter(s => !s.dead)
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
  handAt (x, y) {
    if (y < HAND_Y - 10 || y > HAND_Y + TILE_H) return -1
    const i = Math.floor((x - HAND_X) / HAND_STEP)
    return i >= 0 && i < this.hand.length && x - HAND_X - i * HAND_STEP <= TILE_W ? i : -1
  }
  seedAt (x, y) {
    if (x < 2 || x > CARD_W + 2) return -1
    const i = Math.floor((y - SEED_Y) / SEED_STEP)
    return i >= 0 && i < this.seeds.length && y - SEED_Y - i * SEED_STEP <= CARD_H ? i : -1
  }
  buttonAt (x, y) {
    const b = PANEL_BUTTONS.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)
    return b ? b.action : null
  }
  onClick (x, y) {
    if (this.state !== 'playing') return
    // 优先收集掉落的牌
    const drop = [...this.drops].reverse().find(s => s.hitTest(x, y))
    if (drop) return drop.collect()
    const hi = this.handAt(x, y)
    if (hi >= 0) return this.toggleTile(hi)
    const si = this.seedAt(x, y)
    if (si >= 0) return this.selectSeed(si)
    const action = this.buttonAt(x, y)
    if (action) return this[action]()
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
      this.selectedSeed = -1
    }
  }
  onKey (e) {
    if (e.code === 'Space') { e.preventDefault(); this.togglePause() }
    if (this.state !== 'playing') return
    const k = e.key.toLowerCase()
    if (k === 'escape') { this.selected = null; this.selectedSeed = -1; this.clearTileSel() }
    if (k === 's') this.toggleShovel()
    if (k === 'f') this.toggleSpeed()
    if (k === 'm') Sound.toggleMute()
    if (k === 'q' || k === 'enter') this.combine()
    if (k === 'x' || k === 'delete' || k === 'backspace') this.discard()
    if (k === 'h') this.declareHu()
    const n = '123'.indexOf(e.key)
    if (n >= 0) this.selectSeed(n)
  }
  toggleShovel () {
    if (this.state !== 'playing') return
    this.selected = this.selected === 'shovel' ? null : 'shovel'
    this.selectedSeed = -1
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
    this.drawPanel(x)
    this.drawHand(x)
    for (const s of this.drops) s.draw(x)
    this.drawHuFx(x)
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
  // 左侧面板：待种植物 + 操作按钮 + 听牌信息
  drawPanel (x) {
    x.fillStyle = 'rgba(60, 35, 10, 0.6)'
    x.fillRect(0, 0, CARD_W + 4, H)
    x.textAlign = 'center'
    x.font = 'bold 13px sans-serif'; x.fillStyle = '#f2e6b3'
    x.fillText('待种植物', 52, 17)
    for (let i = 0; i < MJ.seedSlots; i++) {
      const y = SEED_Y + i * SEED_STEP, seed = this.seeds[i]
      if (!seed) {
        x.setLineDash([4, 4]); x.lineWidth = 1.5; x.strokeStyle = 'rgba(242,230,179,0.4)'
        roundRect(x, 4, y, CARD_W - 4, CARD_H, 6); x.stroke(); x.setLineDash([])
        continue
      }
      x.drawImage(CARD_IMAGES[seed.plant], 2, y)
      seed.tiles.forEach((t, k) => drawTile(x, t, 61 + k * 13, y + 8, 13, 18))
      if (seed.hpMul || seed.dmgMul) {
        x.font = 'bold 11px sans-serif'; x.fillStyle = '#7a2a00'
        x.fillText(seed.hpMul ? '血×2' : '威力½', 80, y + 39)
      }
      x.font = '11px sans-serif'; x.fillStyle = 'rgba(58,36,0,0.6)'
      x.fillText(i + 1, 94, y + 11)
      if (this.selectedSeed === i || this.hoverCard === i) {
        x.lineWidth = 3
        x.strokeStyle = this.selectedSeed === i ? '#ffe14d' : 'rgba(255,255,255,0.7)'
        roundRect(x, 2, y, CARD_W, CARD_H, 6); x.stroke()
      }
    }
    // 按钮
    const preview = this.meldPreview()
    for (const b of PANEL_BUTTONS) {
      const on = b.action === 'combine' ? !!preview : b.action === 'discard' ? this.selectedTiles().length === 1 : this.canHu
      let fill = on ? b.color : 'rgba(120,100,80,0.55)'
      if (b.action === 'declareHu' && on) {
        const k = 0.5 + 0.5 * Math.sin(this.runTime * 8)
        x.shadowColor = '#ffd23f'; x.shadowBlur = 10 + k * 16
        fill = 'rgb(' + (230 + 25 * k) + ',' + (150 + 40 * k) + ',30)'
      }
      roundRect(x, b.x, b.y, b.w, b.h, 8)
      x.fillStyle = fill; x.fill()
      x.shadowBlur = 0
      x.lineWidth = 2; x.strokeStyle = '#3d1f06'; x.stroke()
      x.fillStyle = on ? '#fff' : 'rgba(255,255,255,0.55)'
      x.font = 'bold ' + (b.big ? 24 : 16) + 'px sans-serif'
      x.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + (b.big ? 8 : 6))
      x.font = '10px sans-serif'
      x.fillText(b.key, b.x + b.w - 9, b.y + 12)
    }
    // 听牌信息
    let y = 360
    if (this.canHu) {
      x.font = 'bold 15px sans-serif'; x.fillStyle = '#ffe14d'
      x.fillText('可以胡了！', 52, y)
      const fan = Mahjong.calcFan(this.hand.map(h => h.t), { tsumo: this.stageT - this.huReadyAt <= 2 }, MJ.handSize)
      x.font = '12px sans-serif'; x.fillStyle = '#fff'
      x.fillText(fan.names.join('·') + ' ×' + fan.mul, 52, y + 20)
    } else if (this.waits.length) {
      x.font = 'bold 15px sans-serif'; x.fillStyle = '#ffe14d'
      x.fillText('听牌', 52, y)
      this.waits.slice(0, 8).forEach((t, k) => {
        const tx = 8 + (k % 4) * 23, ty = y + 10 + Math.floor(k / 4) * 44
        drawTile(x, t, tx, ty, 21, 28)
        x.font = '11px sans-serif'; x.fillStyle = '#f2e6b3'
        x.fillText('剩' + this.deck.remaining(t), tx + 10, ty + 40)
      })
    } else if (this.handRoom() <= 0 && this.hand.length >= MJ.handSize) {
      x.font = '12px sans-serif'; x.fillStyle = '#ffb4a8'
      x.fillText('手牌已满', 52, y)
      x.fillText('组合或打出后', 52, y + 18)
      x.fillText('才能继续摸牌', 52, y + 34)
    }
    // 牌山
    x.font = '12px sans-serif'; x.fillStyle = '#f2e6b3'
    x.fillText('牌山 ' + this.deck.count + ' 张', 52, H - 26)
    // 摸牌进度条
    const p = this.handRoom() > 0 ? 1 - Math.max(0, this.drawT) / MJ.drawInterval : 0
    x.fillStyle = 'rgba(0,0,0,0.4)'; x.fillRect(12, H - 18, 80, 5)
    x.fillStyle = '#9fd18b'; x.fillRect(12, H - 18, 80 * p, 5)
    x.textAlign = 'left'
  }
  // 顶部手牌
  drawHand (x) {
    const sx = this.handShake > 0 ? Math.sin(this.handShake * 60) * 4 * (this.handShake / 0.3) : 0
    const hover = this.handAt(this.mouse.x, this.mouse.y)
    const waitSet = this.canHu ? null : this.tenpai
    for (let i = 0; i < MJ.handSize; i++) {
      const l = HAND_X + i * HAND_STEP
      if (i >= this.hand.length) {
        x.fillStyle = 'rgba(0,0,0,0.18)'
        roundRect(x, l, HAND_Y, TILE_W, TILE_H, 6); x.fill()
        continue
      }
      const h = this.hand[i]
      const top = HAND_Y - (h.sel ? 9 : hover === i ? 3 : 0) - h.fresh * 20
      x.save()
      x.translate(h.sel ? sx : 0, 0)
      if (this.canHu) { x.shadowColor = '#ffd23f'; x.shadowBlur = 12 }
      else if (waitSet) { x.shadowColor = 'rgba(255,225,77,0.8)'; x.shadowBlur = 6 }
      drawTile(x, h.t, l, top)
      x.shadowBlur = 0
      if (h.sel) {
        x.lineWidth = 3; x.strokeStyle = '#ffe14d'
        roundRect(x, l, top, TILE_W, TILE_H, 6); x.stroke()
      }
      x.restore()
    }
    // 选中牌的组合预览
    const sel = this.selectedTiles()
    if (sel.length >= 2) {
      const seed = this.meldPreview()
      const text = seed ? '→ ' + (seed.label || PLANTS[seed.plant].name) + '（Q）' : '✗ 不成面子'
      x.font = 'bold 13px sans-serif'
      const w = x.measureText(text).width + 16
      const l = HAND_X + this.hand.indexOf(sel[0]) * HAND_STEP
      x.fillStyle = seed ? 'rgba(40,110,30,0.9)' : 'rgba(140,40,30,0.85)'
      roundRect(x, l, HAND_Y + TILE_H + 2, w, 18, 9); x.fill()
      x.fillStyle = '#fff'
      x.fillText(text, l + 8, HAND_Y + TILE_H + 15)
    }
  }
  // 胡牌大字
  drawHuFx (x) {
    const f = this.huFx
    if (!f) return
    const k = 1 - f.t / 1.6
    const s = k < 0.15 ? 0.5 + k / 0.15 * 0.9 : 1.4 - Math.min(0.4, (k - 0.15) * 0.8)
    x.save()
    x.globalAlpha = Math.min(1, f.t / 0.4)
    x.translate(W / 2 + 40, H / 2 - 20)
    x.scale(s, s)
    x.textAlign = 'center'
    x.font = 'bold 110px ' + TILE_FONT
    x.lineWidth = 10; x.strokeStyle = '#5a1a00'
    x.strokeText('胡', 0, 30)
    x.fillStyle = '#ffd23f'; x.fillText('胡', 0, 30)
    x.font = 'bold 26px sans-serif'
    x.lineWidth = 6; x.strokeText(f.fan.names.join(' · ') + '  ×' + f.fan.mul, 0, 80)
    x.fillStyle = '#fff'; x.fillText(f.fan.names.join(' · ') + '  ×' + f.fan.mul, 0, 80)
    x.font = 'bold 18px sans-serif'
    x.lineWidth = 5; x.strokeText(f.text, 0, 110)
    x.fillStyle = '#ffe14d'; x.fillText(f.text, 0, 110)
    x.restore()
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
    if (this.handShake > 0) this.handShake -= dt
    if (this.huFx && (this.huFx.t -= dt) <= 0) this.huFx = null
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
      const i = this.seedAt(this.mouse.x, this.mouse.y)
      if (i !== this.hoverCard) {
        this.hoverCard = i
        UI.cardTip(i >= 0 && this.state === 'playing' ? this.seeds[i] : null, i)
      }
    })
    this.canvas.addEventListener('mouseleave', () => { this.hoverCard = -1; UI.cardTip(null) })
    this.canvas.addEventListener('mousedown', e => {
      const p = toLocal(e)
      if (e.button === 2) {
        // 右键手牌 = 直接打出；其他位置 = 取消选择
        const hi = this.state === 'playing' ? this.handAt(p.x, p.y) : -1
        if (hi >= 0) this.discard(hi)
        else { this.selected = null; this.selectedSeed = -1 }
      } else if (e.button === 0) this.onClick(p.x, p.y)
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

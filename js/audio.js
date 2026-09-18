/**
 * 音效与背景音乐：全部用 Web Audio 实时合成，无需音频文件
 */
const Sound = {
  ctx: null,
  sfxGain: null,
  musicGain: null,
  noiseBuf: null,
  muted: false,
  last: {},                      // 各音效上次播放时间，用于限流
  music: { on: false, step: 0, next: 0, timer: null, mode: 'calm' },

  // 需在用户交互后调用（浏览器自动播放策略）
  init () {
    if (this.ctx) { this.ctx.resume(); return }
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    this.ctx = new AC()
    const master = this.ctx.createGain()
    master.connect(this.ctx.destination)
    // 压缩器防止多个音效叠加爆音
    const comp = this.ctx.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.ratio.value = 6
    comp.connect(master)
    this.sfxGain = this.ctx.createGain()
    this.sfxGain.gain.value = 0.55
    this.sfxGain.connect(comp)
    this.musicGain = this.ctx.createGain()
    this.musicGain.gain.value = 0.16
    this.musicGain.connect(comp)
    this.master = master
    // 白噪声缓冲
    const len = this.ctx.sampleRate
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const d = this.noiseBuf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    try { this.setMuted(localStorage.getItem('pvz-muted') === '1') } catch (e) {}
  },
  setMuted (v) {
    this.muted = v
    if (this.master) this.master.gain.value = v ? 0 : 1
    try { localStorage.setItem('pvz-muted', v ? '1' : '0') } catch (e) {}
    const btn = document.getElementById('muteBtn')
    if (btn) btn.textContent = v ? '🔇' : '🔊'
  },
  toggleMute () { this.init(); this.setMuted(!this.muted) },

  // —— 合成基础件 ——
  // 振荡器：频率从 f0 滑到 f1
  tone ({ type = 'sine', f0, f1 = f0, dur, vol = 0.3, delay = 0, attack = 0.005, out }) {
    const c = this.ctx, t = c.currentTime + delay
    const o = c.createOscillator(), g = c.createGain()
    o.type = type
    o.frequency.setValueAtTime(f0, t)
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(out || this.sfxGain)
    o.start(t)
    o.stop(t + dur + 0.02)
    return o
  },
  // 噪声：经滤波器，可做爆炸、沙沙、嘎吱声
  noise ({ dur, vol = 0.3, delay = 0, type = 'lowpass', f0 = 1000, f1 = f0, q = 1, attack = 0.003 }) {
    const c = this.ctx, t = c.currentTime + delay
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain()
    s.buffer = this.noiseBuf
    s.loop = true
    f.type = type
    f.Q.value = q
    f.frequency.setValueAtTime(f0, t)
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    s.connect(f).connect(g).connect(this.sfxGain)
    s.start(t, Math.random() * 0.5)
    s.stop(t + dur + 0.02)
  },

  /**
   * 播放音效
   * gap: 同名音效最小间隔（秒），避免密集射击时刷屏
   */
  play (name, opts = {}) {
    if (!this.ctx || this.muted) return
    const fx = SFX[name]
    if (!fx) return
    const now = this.ctx.currentTime
    const gap = fx.gap || 0
    if (gap && this.last[name] && now - this.last[name] < gap) return
    this.last[name] = now
    fx.fn.call(this, opts)
  },

  // —— 背景音乐：简单的步进音序器 ——
  startMusic (mode = 'calm') {
    if (!this.ctx) return
    this.music.mode = mode
    if (this.music.on) return
    this.music.on = true
    this.music.next = this.ctx.currentTime + 0.1
    this.music.timer = setInterval(() => this.scheduleMusic(), 50)
  },
  stopMusic () {
    this.music.on = false
    clearInterval(this.music.timer)
  },
  setMusicMode (mode) { this.music.mode = mode },
  scheduleMusic () {
    const m = this.music, c = this.ctx
    const tense = m.mode === 'tense'
    const stepDur = tense ? 0.125 : 0.16                  // 十六分音符时长
    while (m.next < c.currentTime + 0.25) {
      const s = m.step % 64, bar = Math.floor(s / 16), i = s % 16
      const prog = tense ? MUSIC.tenseProg : MUSIC.prog
      const root = prog[bar]
      // 低音：每拍一个音
      if (i % 4 === 0) this.tone({ type: 'triangle', f0: midi(root - 12), dur: stepDur * 3, vol: 0.5, delay: m.next - c.currentTime, out: this.musicGain })
      if (tense && i % 4 === 2) this.tone({ type: 'triangle', f0: midi(root - 12), dur: stepDur * 1.5, vol: 0.35, delay: m.next - c.currentTime, out: this.musicGain })
      // 旋律
      const mel = (tense ? MUSIC.tenseMelody : MUSIC.melody)[bar][i]
      if (mel) this.tone({ type: 'square', f0: midi(mel), dur: stepDur * 1.8, vol: 0.09, delay: m.next - c.currentTime, out: this.musicGain })
      // 打击：底鼓与踩镲
      if (i % 8 === 0) this.kick(m.next - c.currentTime)
      if (i % 4 === 2) this.hat(m.next - c.currentTime)
      m.next += stepDur
      m.step++
    }
  },
  kick (delay) {
    const c = this.ctx, t = c.currentTime + delay
    const o = c.createOscillator(), g = c.createGain()
    o.frequency.setValueAtTime(120, t)
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12)
    g.gain.setValueAtTime(0.6, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15)
    o.connect(g).connect(this.musicGain)
    o.start(t); o.stop(t + 0.16)
  },
  hat (delay) {
    const c = this.ctx, t = c.currentTime + delay
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain()
    s.buffer = this.noiseBuf
    f.type = 'highpass'; f.frequency.value = 7000
    g.gain.setValueAtTime(0.12, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04)
    s.connect(f).connect(g).connect(this.musicGain)
    s.start(t, Math.random() * 0.5); s.stop(t + 0.05)
  },
}

const midi = n => 440 * Math.pow(2, (n - 69) / 12)

// 原创旋律：A 小调，Am - F - C - G / 紧张版 Am - Am - F - E
const MUSIC = (() => {
  const _ = 0
  return {
    prog: [57, 53, 60, 55],
    melody: [
      [69, _, 72, _, 76, _, 72, _, 74, _, 72, _, 69, _, _, _],
      [69, _, 72, _, 77, _, 76, _, 74, _, 72, _, 74, _, _, _],
      [72, _, 76, _, 79, _, 76, _, 77, _, 76, _, 74, _, 72, _],
      [71, _, 74, _, 79, _, 77, _, 76, _, 74, _, 71, _, _, _],
    ],
    tenseProg: [57, 57, 53, 52],
    tenseMelody: [
      [69, 69, _, 72, _, 69, _, 76, 75, _, 74, _, 72, _, 71, _],
      [69, 69, _, 72, _, 69, _, 76, 77, _, 76, _, 74, _, 72, _],
      [65, 65, _, 69, _, 72, _, 77, 76, _, 74, _, 72, _, 69, _],
      [68, _, 71, _, 74, _, 76, _, 80, _, 76, _, 74, _, 71, _],
    ],
  }
})()

/**
 * 音效表：fn 在 Sound 上下文中执行
 */
const SFX = {
  shoot: { gap: 0.045, fn () { this.tone({ f0: 520, f1: 180, dur: 0.07, vol: 0.12 }) } },
  hit: { gap: 0.03, fn () {
    this.noise({ dur: 0.06, vol: 0.25, f0: 1800, f1: 400 })
    this.tone({ f0: 200, f1: 90, dur: 0.07, vol: 0.2 })
  } },
  hitIce: { gap: 0.04, fn () {
    this.tone({ type: 'triangle', f0: 2200, f1: 1500, dur: 0.12, vol: 0.12 })
    this.noise({ dur: 0.05, vol: 0.15, type: 'highpass', f0: 3000 })
  } },
  hitFire: { gap: 0.04, fn () {
    this.noise({ dur: 0.18, vol: 0.28, type: 'bandpass', f0: 900, f1: 300, q: 2 })
    this.tone({ f0: 160, f1: 70, dur: 0.1, vol: 0.2 })
  } },
  hitBucket: { gap: 0.05, fn () {
    this.tone({ type: 'square', f0: 950, f1: 900, dur: 0.12, vol: 0.08 })
    this.tone({ type: 'square', f0: 1420, f1: 1380, dur: 0.1, vol: 0.06 })
    this.noise({ dur: 0.04, vol: 0.15, type: 'highpass', f0: 2500 })
  } },
  hitCone: { gap: 0.05, fn () {
    this.tone({ type: 'triangle', f0: 420, f1: 300, dur: 0.06, vol: 0.25 })
    this.noise({ dur: 0.05, vol: 0.18, f0: 1200 })
  } },
  armorOff: { fn () {
    this.tone({ type: 'square', f0: 700, f1: 200, dur: 0.25, vol: 0.1 })
    this.noise({ dur: 0.15, vol: 0.2, f0: 2000, f1: 500 })
  } },
  headOff: { gap: 0.08, fn () { this.tone({ f0: 300, f1: 900, dur: 0.08, vol: 0.18 }) } },
  zombieDie: { gap: 0.1, fn () {
    this.tone({ type: 'sawtooth', f0: 160, f1: 60, dur: 0.35, vol: 0.08 })
    this.noise({ dur: 0.2, vol: 0.12, f0: 600, f1: 150, delay: 0.12 })
  } },
  groan: { gap: 2.5, fn () {
    const f = 85 + Math.random() * 40
    const o = this.tone({ type: 'sawtooth', f0: f, f1: f * 0.7, dur: 0.9, vol: 0.07, attack: 0.15 })
    // 颤音
    const lfo = this.ctx.createOscillator(), lg = this.ctx.createGain()
    lfo.frequency.value = 7; lg.gain.value = 6
    lfo.connect(lg).connect(o.frequency)
    lfo.start(); lfo.stop(this.ctx.currentTime + 0.95)
  } },
  chomp: { gap: 0.28, fn () {
    this.noise({ dur: 0.07, vol: 0.22, type: 'bandpass', f0: 700, q: 3 })
    this.noise({ dur: 0.06, vol: 0.18, type: 'bandpass', f0: 500, q: 3, delay: 0.1 })
  } },
  plant: { fn () {
    this.noise({ dur: 0.12, vol: 0.3, f0: 600, f1: 200 })
    this.tone({ f0: 140, f1: 60, dur: 0.12, vol: 0.35 })
  } },
  plantDie: { gap: 0.1, fn () {
    this.noise({ dur: 0.18, vol: 0.2, type: 'bandpass', f0: 1500, f1: 400, q: 1.5 })
    this.tone({ type: 'triangle', f0: 500, f1: 150, dur: 0.2, vol: 0.12 })
  } },
  select: { fn () { this.tone({ type: 'triangle', f0: 1100, dur: 0.05, vol: 0.18 }) } },
  deny: { gap: 0.15, fn () { this.tone({ type: 'square', f0: 140, f1: 110, dur: 0.14, vol: 0.12 }) } },
  shovel: { fn () {
    this.noise({ dur: 0.14, vol: 0.25, type: 'highpass', f0: 1500, f1: 4000 })
    this.tone({ f0: 250, f1: 120, dur: 0.1, vol: 0.2, delay: 0.05 })
  } },
  sun: { gap: 0.05, fn () {
    this.tone({ f0: 880, dur: 0.08, vol: 0.18 })
    this.tone({ f0: 1320, dur: 0.12, vol: 0.16, delay: 0.06 })
  } },
  explode: { fn () {
    this.noise({ dur: 0.9, vol: 0.7, f0: 3000, f1: 120, attack: 0.002 })
    this.tone({ f0: 110, f1: 30, dur: 0.6, vol: 0.6 })
  } },
  fireRow: { fn () {
    this.noise({ dur: 1.1, vol: 0.55, type: 'bandpass', f0: 300, f1: 1800, q: 0.8, attack: 0.08 })
    this.tone({ f0: 90, f1: 40, dur: 0.8, vol: 0.4 })
  } },
  squash: { fn () {
    this.tone({ f0: 180, f1: 40, dur: 0.3, vol: 0.6 })
    this.noise({ dur: 0.25, vol: 0.45, f0: 900, f1: 100 })
  } },
  swallow: { fn () {
    this.noise({ dur: 0.1, vol: 0.35, type: 'bandpass', f0: 600, q: 2 })
    this.tone({ f0: 300, f1: 90, dur: 0.3, vol: 0.25, delay: 0.08 })
  } },
  mower: { fn () {
    const o = this.tone({ type: 'sawtooth', f0: 70, f1: 110, dur: 1.2, vol: 0.12, attack: 0.05 })
    const lfo = this.ctx.createOscillator(), lg = this.ctx.createGain()
    lfo.frequency.value = 22; lg.gain.value = 20
    lfo.connect(lg).connect(o.frequency)
    lfo.start(); lfo.stop(this.ctx.currentTime + 1.25)
  } },
  wave: { fn () {
    for (let i = 0; i < 3; i++) {
      this.tone({ type: 'square', f0: 440, f1: 740, dur: 0.35, vol: 0.12, delay: i * 0.4 })
    }
  } },
  bossRoar: { fn () {
    this.tone({ type: 'sawtooth', f0: 70, f1: 45, dur: 1.4, vol: 0.3, attack: 0.1 })
    this.tone({ type: 'sawtooth', f0: 105, f1: 60, dur: 1.4, vol: 0.2, attack: 0.1 })
    this.noise({ dur: 1.3, vol: 0.3, type: 'bandpass', f0: 400, f1: 200, q: 1, attack: 0.1 })
  } },
  stageStart: { fn () {
    [60, 64, 67, 72].forEach((n, i) => this.tone({ type: 'triangle', f0: midi(n), dur: 0.25, vol: 0.25, delay: i * 0.1 }))
  } },
  draftOpen: { fn () {
    [72, 76, 79, 84, 88].forEach((n, i) => this.tone({ type: 'sine', f0: midi(n), dur: 0.3, vol: 0.12, delay: i * 0.05 }))
  } },
  pick: { fn ({ rarity }) {
    const chord = rarity === 'legendary' ? [60, 64, 67, 72, 76, 79] : rarity === 'rare' ? [62, 66, 69, 74] : [60, 64, 67]
    chord.forEach((n, i) => this.tone({ type: 'triangle', f0: midi(n), dur: 0.5, vol: 0.18, delay: i * 0.06 }))
    if (rarity === 'legendary') this.noise({ dur: 0.8, vol: 0.12, type: 'highpass', f0: 6000, delay: 0.2, attack: 0.1 })
  } },
  reroll: { fn () { for (let i = 0; i < 5; i++) this.tone({ type: 'square', f0: 600 + i * 150, dur: 0.04, vol: 0.06, delay: i * 0.04 }) } },
  victory: { fn () {
    [60, 64, 67, 72, 67, 72, 76, 79].forEach((n, i) => this.tone({ type: 'square', f0: midi(n), dur: 0.22, vol: 0.12, delay: i * 0.13 }))
  } },
  lose: { fn () {
    [67, 63, 60, 55].forEach((n, i) => this.tone({ type: 'sawtooth', f0: midi(n), dur: 0.45, vol: 0.12, delay: i * 0.3 }))
  } },
}

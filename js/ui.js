/**
 * DOM 界面：HUD、三选一、暂停、结算、提示
 */
const $ = id => document.getElementById(id)

const UI = {
  bannerTimer: null,
  hideAll () {
    for (const id of ['title', 'draft', 'pause', 'end']) $(id).classList.add('hidden')
  },
  showHud (v) { $('hud').classList.toggle('hidden', !v); $('relics').classList.toggle('hidden', !v) },
  showTitle () {
    this.hideAll()
    this.showHud(false)
    $('title').classList.remove('hidden')
  },
  updateHud () {
    $('sunNum').textContent = Math.floor(G.sun)
    $('shovelBtn').classList.toggle('active', G.selected === 'shovel')
    $('speedBtn').textContent = G.speed + '×'
    if (G.spawns) {
      const p = 1 - G.spawns.length / G.spawnTotal
      $('progressFill').style.width = (p * 100) + '%'
    }
  },
  // 阳光数字跳动
  bumpSun () { this.pulse($('sunNum').parentNode, 'bump') },
  // 阳光不足时闪红
  flashSun () { this.pulse($('sunNum').parentNode, 'deny') },
  pulse (el, cls) {
    el.classList.remove(cls)
    void el.offsetWidth
    el.classList.add(cls)
  },
  updateStage () {
    $('stageLabel').textContent = '第 ' + (G.stageIndex + 1) + ' / ' + STAGES.length + ' 关'
    const m = G.modifier
    $('modChip').textContent = m.icon + ' ' + m.name
    $('modChip').title = m.desc
  },
  updateRelics () {
    const counts = {}
    for (const id of G.owned) counts[id] = (counts[id] || 0) + 1
    $('relics').innerHTML = Object.keys(counts).map(id => {
      const u = UPGRADES.find(u => u.id === id)
      const n = counts[id] > 1 ? '<i>' + counts[id] + '</i>' : ''
      return '<span class="relic r-' + u.rarity + '" data-tip="' + u.name + '：' + u.desc + '">' + u.icon + n + '</span>'
    }).join('')
  },
  banner (text, time = 2.5, sub = '') {
    const b = $('banner')
    b.innerHTML = '<div>' + text + '</div>' + (sub ? '<small>' + sub + '</small>' : '')
    b.classList.remove('show')
    void b.offsetWidth
    b.classList.add('show')
    clearTimeout(this.bannerTimer)
    this.bannerTimer = setTimeout(() => b.classList.remove('show'), time * 1000)
  },
  cardTip (type, i) {
    const tip = $('cardTip')
    if (!type) { tip.classList.add('hidden'); return }
    const d = PLANTS[type]
    tip.innerHTML = '<b>' + d.name + '</b><span>☀️ ' + G.cost(type) + '　⏱️ ' + G.cardCd(type).toFixed(1) + ' 秒</span><p>' + d.desc + '</p>'
    tip.style.top = Math.min(2 + i * (CARD_H + 2), H - 110) + 'px'
    tip.classList.remove('hidden')
  },
  // 三选一
  showDraft (title, options, onDone) {
    const box = $('draft')
    const render = opts => {
      box.innerHTML = '<h2>' + title + '</h2><div class="choices">' + opts.map((u, i) => {
        const r = RARITY[u.rarity]
        const n = G.owned.filter(o => o === u.id).length
        return '<div class="choice r-' + u.rarity + '" data-i="' + i + '" style="animation-delay:' + (i * 0.12) + 's">' +
          '<div class="rarity" style="color:' + r.color + '">' + r.name + '</div>' +
          '<div class="icon">' + u.icon + '</div>' +
          '<div class="name">' + u.name + (n ? ' <em>Lv.' + (n + 1) + '</em>' : '') + '</div>' +
          '<div class="desc">' + u.desc + '</div></div>'
      }).join('') + '</div>' +
      '<div class="draft-foot"><button id="rerollBtn" ' + (G.rerolls ? '' : 'disabled') + '>🎲 刷新（剩余 ' + G.rerolls + ' 次）</button>' +
      '<span>本局已消灭 ' + G.kills + ' 只僵尸</span></div>'
      box.querySelectorAll('.choice').forEach(el => {
        el.onclick = () => {
          Sound.play('pick', { rarity: opts[+el.dataset.i].rarity })
          G.takeUpgrade(opts[+el.dataset.i])
          box.classList.add('hidden')
          onDone()
        }
      })
      $('rerollBtn').onclick = () => {
        if (!G.rerolls) return
        G.rerolls--
        Sound.play('reroll')
        render(G.rollUpgrades(Math.max(0, G.stageIndex + 1)))
      }
    }
    render(options)
    box.classList.remove('hidden')
    Sound.play('draftOpen')
  },
  showPause () {
    const box = $('pause')
    const list = G.owned.length ? [...new Set(G.owned)].map(id => {
      const u = UPGRADES.find(u => u.id === id)
      const n = G.owned.filter(o => o === id).length
      return '<li><span>' + u.icon + '</span><b style="color:' + RARITY[u.rarity].color + '">' + u.name + (n > 1 ? ' ×' + n : '') + '</b>' + u.desc + '</li>'
    }).join('') : '<li>还没有任何强化</li>'
    box.innerHTML = '<h2>游戏暂停</h2><h3>已获得的强化</h3><ul>' + list + '</ul>' +
      '<p class="keys">快捷键：1~0 选卡片　S 铲子　F 加速　M 静音　空格 暂停　右键/Esc 取消</p>' +
      '<div class="btns"><button id="resumeBtn">继续游戏</button><button id="quitBtn" class="ghost">放弃本局</button></div>'
    $('resumeBtn').onclick = () => G.togglePause()
    $('quitBtn').onclick = () => { G.state = 'title'; Sound.stopMusic(); this.showTitle() }
    box.classList.remove('hidden')
  },
  showEnd (win) {
    const box = $('end')
    const t = Math.floor(G.runTime)
    box.innerHTML = (win ? '<h2 class="win">🏆 胜利！</h2><p>你击败了铁桶僵尸王，守住了房子！</p>'
      : '<img src="images/zombieWon.png" alt="僵尸吃掉了你的脑子"><p>倒在了第 ' + (G.stageIndex + 1) + ' 关</p>') +
      '<div class="stats"><div><b>' + G.kills + '</b>消灭僵尸</div><div><b>' + Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0') + '</b>用时</div>' +
      '<div><b>' + G.owned.length + '</b>获得强化</div></div>' +
      '<div class="btns"><button id="againBtn">再来一局</button></div>'
    $('againBtn').onclick = () => { Sound.startMusic('calm'); Sound.setMusicMode('calm'); G.startRun() }
    box.classList.toggle('lose', !win)
    box.classList.remove('hidden')
  },
  bind () {
    $('startBtn').onclick = () => { Sound.init(); Sound.startMusic('calm'); G.startRun() }
    $('shovelBtn').onclick = () => G.toggleShovel()
    $('speedBtn').onclick = () => G.toggleSpeed()
    $('pauseBtn').onclick = () => G.togglePause()
    $('muteBtn').onclick = () => Sound.toggleMute()
    // 强化图标悬浮说明
    $('relics').addEventListener('mouseover', e => {
      const t = e.target.closest('.relic')
      $('relicTip').textContent = t ? t.dataset.tip : ''
      $('relicTip').classList.toggle('hidden', !t)
    })
    $('relics').addEventListener('mouseleave', () => $('relicTip').classList.add('hidden'))
  },
}

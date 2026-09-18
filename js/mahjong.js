/**
 * 麻将纯逻辑：牌山、面子识别、胡牌/听牌判定、番型计算
 * 不依赖 DOM / canvas，浏览器与 Node（单元测试）共用
 *
 * 牌的编码：花色字母 + 数字
 *   m1~m9 万　p1~p9 饼　s1~s9 条　z1 中　z2 发　z3 白
 */
const Mahjong = (() => {
  const SUITS = ['m', 'p', 's']
  const HONORS = ['z1', 'z2', 'z3']
  const SUIT_NAME = { m: '万', p: '饼', s: '条', z: '' }
  const HONOR_NAME = { z1: '中', z2: '发', z3: '白' }
  const NUM_NAME = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  const ORDER = { m: 0, p: 1, s: 2, z: 3 }

  const suit = t => t[0]
  const num = t => +t.slice(1)
  const isHonor = t => t[0] === 'z'
  const isTerminal = t => isHonor(t) || num(t) === 1 || num(t) === 9
  const name = t => isHonor(t) ? HONOR_NAME[t] : NUM_NAME[num(t)] + SUIT_NAME[suit(t)]
  const cmp = (a, b) => ORDER[suit(a)] - ORDER[suit(b)] || num(a) - num(b)
  const sort = tiles => [...tiles].sort(cmp)

  // 可复现的随机数（mulberry32）
  function rng (seed) {
    let a = seed >>> 0
    return () => {
      a = (a + 0x6D2B79F5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  // 全部牌种（不含重复）
  const KINDS = [...SUITS.flatMap(s => [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => s + n)), ...HONORS]

  /**
   * 牌山：每种 4 张，洗牌后从尾部摸牌
   * kinds：可选，只放入这些牌种（例如第 1 关不放萬）
   */
  class Deck {
    constructor (random = Math.random, kinds = KINDS) {
      this.random = random
      this.tiles = []
      for (const k of kinds) for (let i = 0; i < 4; i++) this.tiles.push(k)
      this.shuffle()
    }
    shuffle () {
      const a = this.tiles
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]]
      }
    }
    get count () { return this.tiles.length }
    draw () { return this.tiles.pop() || null }
    // 牌退回牌山（例如弃牌河洗回）
    putBack (tiles) { this.tiles.push(...tiles); this.shuffle() }
    remaining (t) { return this.tiles.filter(x => x === t).length }
    // 从牌山中取出指定的牌（没有则返回 null）
    take (t) {
      const i = this.tiles.lastIndexOf(t)
      return i < 0 ? null : this.tiles.splice(i, 1)[0]
    }
  }

  const countOf = tiles => {
    const c = {}
    for (const t of tiles) c[t] = (c[t] || 0) + 1
    return c
  }

  /**
   * 识别一组牌构成的面子
   * 返回 { kind: 'chow' 顺子 | 'pung' 刻子 | 'kong' 杠 | 'pair' 对子, suit, n（顺子为起头数字）} 或 null
   */
  function classifyMeld (tiles) {
    const t = sort(tiles)
    const same = t.every(x => x === t[0])
    if (t.length === 2 && same) return { kind: 'pair', suit: suit(t[0]), n: num(t[0]), tile: t[0] }
    if (t.length === 4 && same) return { kind: 'kong', suit: suit(t[0]), n: num(t[0]), tile: t[0] }
    if (t.length !== 3) return null
    if (same) return { kind: 'pung', suit: suit(t[0]), n: num(t[0]), tile: t[0] }
    if (isHonor(t[0]) || suit(t[0]) !== suit(t[2])) return null
    if (num(t[1]) === num(t[0]) + 1 && num(t[2]) === num(t[0]) + 2) return { kind: 'chow', suit: suit(t[0]), n: num(t[0]), tile: t[0] }
    return null
  }

  /**
   * 列出手牌所有"n 面子 + 1 雀头"的拆法
   * 返回 [{ pair: 'm5', melds: [{ kind, tiles }] }]
   */
  function decompose (hand) {
    if (hand.length % 3 !== 2) return []
    const res = []
    const c = countOf(hand)
    const kinds = Object.keys(c).sort(cmp)
    const takeMelds = (melds, out) => {
      const first = kinds.find(k => c[k] > 0)
      if (!first) { out.push(melds.slice()); return }
      // 刻子
      if (c[first] >= 3) {
        c[first] -= 3
        melds.push({ kind: 'pung', tiles: [first, first, first] })
        takeMelds(melds, out)
        melds.pop()
        c[first] += 3
      }
      // 顺子（最小的牌只能作为顺子起头）
      if (!isHonor(first) && num(first) <= 7) {
        const b = suit(first) + (num(first) + 1), d = suit(first) + (num(first) + 2)
        if (c[b] > 0 && c[d] > 0) {
          c[first]--; c[b]--; c[d]--
          melds.push({ kind: 'chow', tiles: [first, b, d] })
          takeMelds(melds, out)
          melds.pop()
          c[first]++; c[b]++; c[d]++
        }
      }
    }
    for (const p of kinds) {
      if (c[p] < 2) continue
      c[p] -= 2
      const out = []
      takeMelds([], out)
      for (const melds of out) res.push({ pair: p, melds })
      c[p] += 2
    }
    return res
  }

  // 有效牌：再来一张就能和手里的两张组成顺子或刻子
  function usefulTiles (hand) {
    const c = countOf(hand)
    const has = t => c[t] > 0
    return KINDS.filter(k => {
      if ((c[k] || 0) >= 2) return true
      if (isHonor(k)) return false
      const s = suit(k), n = num(k), at = d => n + d >= 1 && n + d <= 9 && has(s + (n + d))
      return (at(-2) && at(-1)) || (at(-1) && at(1)) || (at(1) && at(2))
    })
  }

  /**
   * 手牌里所有能组成的面子（按下标），accept(meld) 决定哪些算数
   * 同样牌面的组合只保留一个
   */
  function meldGroups (hand, accept = m => m.kind === 'chow' || m.kind === 'pung') {
    const res = [], seen = new Set()
    const add = idx => {
      const tiles = idx.map(i => hand[i])
      const m = classifyMeld(tiles)
      if (!m || !accept(m)) return
      const key = sort(tiles).join()
      if (seen.has(key)) return
      seen.add(key)
      res.push({ idx, meld: m })
    }
    const n = hand.length
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) add([i, j, k])
      add([i, j])
    }
    return res
  }

  // 挑出互不重叠的面子，三张的面子优先、数量尽量多
  function pickGroups (groups) {
    let best = [], bestScore = -1
    const score = gs => gs.reduce((a, g) => a + (g.idx.length === 3 ? 10 : 1), 0)
    const walk = (start, used, chosen) => {
      const s = score(chosen)
      if (s > bestScore) { bestScore = s; best = chosen.slice() }
      for (let i = start; i < groups.length; i++) {
        const g = groups[i]
        if (g.idx.some(k => used.has(k))) continue
        g.idx.forEach(k => used.add(k))
        chosen.push(g)
        walk(i + 1, used, chosen)
        chosen.pop()
        g.idx.forEach(k => used.delete(k))
      }
    }
    walk(0, new Set(), [])
    return best
  }

  // 差一张：第 i 张牌和手里另一张牌，再来哪张就能组成顺子或刻子
  function partialWaits (hand, i) {
    const res = new Set()
    hand.forEach((t, j) => {
      if (j === i) return
      for (const k of KINDS) {
        const m = classifyMeld([hand[i], t, k])
        if (m && (m.kind === 'chow' || m.kind === 'pung')) res.add(k)
      }
    })
    return sort([...res])
  }

  // 七对子（简化版：handSize/2 个互不相同的对子）
  function isPairs (hand) {
    if (hand.length < 4 || hand.length % 2) return false
    const c = countOf(hand)
    return Object.values(c).every(v => v === 2)
  }

  function isHu (hand, size = 8) {
    return hand.length === size && (isPairs(hand) || decompose(hand).length > 0)
  }

  // 听牌：再摸哪几张就能胡（hand 比胡牌张数少 1）
  function waits (hand, size = 8) {
    if (hand.length !== size - 1) return []
    const c = countOf(hand)
    return KINDS.filter(k => (c[k] || 0) < 4 && isHu([...hand, k], size))
  }

  /**
   * 番型：各拆法中取倍数最高的
   * ctx.tsumo：最后一张是自己摸到的（自摸）
   * 返回 { mul, names: ['清一色', ...] }；不能胡返回 null
   */
  const FAN = {
    pinghu: { name: '平胡', mul: 1 },
    tanyao: { name: '断幺', mul: 1.5 },
    toitoi: { name: '碰碰胡', mul: 2 },
    pairs: { name: '七对', mul: 2 },
    honitsu: { name: '混一色', mul: 2 },
    chinitsu: { name: '清一色', mul: 4 },
    tsuiiso: { name: '字一色', mul: 8 },
    tsumo: { name: '自摸', mul: 1.5 },
  }
  const FAN_CAP = 16

  function calcFan (hand, ctx = {}, size = 8) {
    if (!isHu(hand, size)) return null
    // 与拆法无关的番型
    const base = []
    const suits = new Set(hand.filter(t => !isHonor(t)).map(suit))
    const hasHonor = hand.some(isHonor)
    if (!suits.size) base.push('tsuiiso')
    else if (suits.size === 1) base.push(hasHonor ? 'honitsu' : 'chinitsu')
    if (!hand.some(isTerminal)) base.push('tanyao')
    if (ctx.tsumo) base.push('tsumo')
    // 与拆法相关的番型
    const shapes = decompose(hand).map(d => d.melds.every(m => m.kind === 'pung') ? ['toitoi'] : [])
    if (isPairs(hand)) shapes.push(['pairs'])
    let best = null
    for (const s of shapes) {
      const ids = [...s, ...base]
      const mul = Math.min(FAN_CAP, ids.reduce((a, id) => a * FAN[id].mul, 1))
      if (!best || mul > best.mul) best = { mul, ids }
    }
    const ids = best.ids.length ? best.ids : ['pinghu']
    if (ids.length === 1 && ids[0] === 'tsumo') ids.unshift('pinghu')
    return { mul: best.mul, names: ids.map(id => FAN[id].name) }
  }

  return { SUITS, HONORS, KINDS, FAN, FAN_CAP, Deck, rng, suit, num, isHonor, name, cmp, sort, classifyMeld, usefulTiles, meldGroups, pickGroups, partialWaits, decompose, isPairs, isHu, waits, calcFan }
})()

if (typeof module !== 'undefined') module.exports = Mahjong

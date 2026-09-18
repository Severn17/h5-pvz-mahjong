const test = require('node:test')
const assert = require('node:assert/strict')
const M = require('../js/mahjong.js')

const h = s => s.split(' ')

test('牌山：120 张，每种 4 张，同种子洗牌结果一致', () => {
  const a = new M.Deck(M.rng(42)), b = new M.Deck(M.rng(42))
  assert.equal(a.count, 120)
  assert.deepEqual(a.tiles, b.tiles)
  for (const k of M.KINDS) assert.equal(a.remaining(k), 4)
  const t = a.draw()
  assert.equal(a.count, 119)
  assert.equal(a.remaining(t), 3)
})

test('面子识别', () => {
  assert.deepEqual(M.classifyMeld(h('s3 s1 s2')), { kind: 'chow', suit: 's', n: 1, tile: 's1' })
  assert.equal(M.classifyMeld(h('p5 p5 p5')).kind, 'pung')
  assert.equal(M.classifyMeld(h('z1 z1 z1')).kind, 'pung')
  assert.equal(M.classifyMeld(h('z2 z2')).kind, 'pair')
  assert.equal(M.classifyMeld(h('m7 m7 m7 m7')).kind, 'kong')
  assert.equal(M.classifyMeld(h('s1 s2 p3')), null, '跨花色不是顺子')
  assert.equal(M.classifyMeld(h('z1 z2 z3')), null, '字牌不能成顺子')
  assert.equal(M.classifyMeld(h('s1 s2 s4')), null)
  assert.equal(M.classifyMeld(h('s8 s9 s1')), null, '不能 891 循环')
  assert.equal(M.classifyMeld(h('s1')), null)
})

test('胡牌：2 面子 + 1 雀头', () => {
  assert.ok(M.isHu(h('m1 m2 m3 p5 p5 p5 s9 s9')))
  assert.ok(M.isHu(h('m1 m1 m1 m2 m3 m4 z1 z1')))
  assert.ok(!M.isHu(h('m1 m2 m3 p5 p5 p5 s9 s8')))
  assert.ok(!M.isHu(h('m1 m2 m3 p5 p5 p5 s9')), '张数不对')
})

test('胡牌：需要回溯的拆法', () => {
  // 11 123 顺子与 111 23 冲突，只有 11+123+… 成立
  assert.ok(M.isHu(h('s1 s1 s1 s2 s3 s4 s4 s4')))
  assert.ok(M.isHu(h('m2 m2 m3 m3 m4 m4 m5 m5')))
})

test('胡牌：七对（4 对，不能是 4 张相同）', () => {
  assert.ok(M.isHu(h('m1 m1 p9 p9 s4 s4 z3 z3')))
  assert.ok(!M.isPairs(h('m1 m1 m1 m1 s4 s4 z3 z3')))
})

test('听牌', () => {
  assert.deepEqual(M.waits(h('m1 m2 m3 p5 p5 p5 s9')), ['s9'])
  // 两面听
  assert.deepEqual(M.waits(h('m2 m3 p5 p5 p5 s9 s9')), ['m1', 'm4'])
  assert.deepEqual(M.waits(h('m1 m2 m3 p5 p5 p5 s9 s9')), [], '张数不对不算听牌')
  assert.deepEqual(M.waits(h('m1 m4 p2 p8 s3 s6 z1')), [])
})

test('听牌：手里已有 4 张的牌不算', () => {
  // 单吊 m1，但 4 张 m1 已全部在手
  const w = M.waits(h('m1 m1 m1 m1 m2 m3 z1'))
  assert.ok(!w.includes('m1'))
})

test('番型', () => {
  assert.deepEqual(M.calcFan(h('m1 m2 m3 p5 p5 p5 s9 s9')), { mul: 1, names: ['平胡'] })
  assert.deepEqual(M.calcFan(h('s1 s2 s3 s4 s5 s6 s9 s9')), { mul: 4, names: ['清一色'] })
  assert.deepEqual(M.calcFan(h('s1 s2 s3 z1 z1 z1 z2 z2')), { mul: 2, names: ['混一色'] })
  assert.deepEqual(M.calcFan(h('m5 m5 m5 p6 p6 p6 s2 s2')), { mul: 3, names: ['碰碰胡', '断幺'] })
  assert.deepEqual(M.calcFan(h('z1 z1 z1 z2 z2 z2 z3 z3')), { mul: 16, names: ['碰碰胡', '字一色'] })
  assert.deepEqual(M.calcFan(h('m1 m1 p9 p9 s4 s4 z3 z3')), { mul: 2, names: ['七对'] })
  assert.deepEqual(M.calcFan(h('m1 m2 m3 p5 p5 p5 s9 s9'), { tsumo: true }), { mul: 1.5, names: ['平胡', '自摸'] })
  assert.equal(M.calcFan(h('m1 m2 m3 p5 p5 p5 s9 s8')), null)
})

test('番型：取倍数最高的拆法', () => {
  // 可拆成 3 个刻子思路或顺子思路：s2s2s2 s3s3s3 s4s4 → 碰碰胡 × 清一色 × 断幺 = 12
  const r = M.calcFan(h('s2 s2 s2 s3 s3 s3 s4 s4'))
  assert.equal(r.mul, 12)
  assert.ok(r.names.includes('碰碰胡'))
})

test('牌名', () => {
  assert.equal(M.name('m1'), '一万')
  assert.equal(M.name('s9'), '九条')
  assert.equal(M.name('z2'), '发')
})

test('有效牌：能和手里两张组成面子', () => {
  assert.deepEqual(M.usefulTiles(h('m1 m2 z1 z1')), ['m3', 'z1'])
  assert.deepEqual(M.usefulTiles(h('s4 s6')), ['s5'])
  assert.deepEqual(M.usefulTiles(h('p9 p8')), ['p7'])
  assert.deepEqual(M.usefulTiles(h('m1 p5 z3')), [])
})

test('牌山：取出指定的牌', () => {
  const d = new M.Deck(M.rng(1))
  assert.equal(d.take('z1'), 'z1')
  assert.equal(d.remaining('z1'), 3)
  d.take('z1'); d.take('z1'); d.take('z1')
  assert.equal(d.take('z1'), null)
  assert.equal(d.count, 116)
})

test('牌山：可以只放部分牌种', () => {
  const kinds = M.KINDS.filter(k => k[0] !== 'm')
  const d = new M.Deck(M.rng(1), kinds)
  assert.equal(d.count, 84)
  assert.equal(d.remaining('m5'), 0)
  assert.equal(d.remaining('p5'), 4)
})

test('提示：找出所有面子，并挑出互不重叠的一组', () => {
  const hand = h('s1 s2 s3 s4 p7 p7 p7 z1')
  const all = M.meldGroups(hand)
  // s123、s234、p777（三张相同的 p7 只算一组）
  assert.deepEqual(all.map(g => g.idx.map(i => hand[i]).join('')), ['s1s2s3', 's2s3s4', 'p7p7p7'])
  const picked = M.pickGroups(all)
  assert.equal(picked.length, 2)
  assert.ok(picked.some(g => g.meld.kind === 'pung'))
})

test('提示：可以接受字牌对子', () => {
  const hand = h('z1 z1 s5')
  const all = M.meldGroups(hand, m => m.kind !== 'kong' && (m.kind !== 'pair' || m.suit === 'z'))
  assert.deepEqual(all.map(g => g.meld.kind), ['pair'])
})

test('提示：优先三张的面子而不是对子', () => {
  const hand = h('z1 z1 z1')
  const all = M.meldGroups(hand, m => m.kind !== 'kong')
  const picked = M.pickGroups(all)
  assert.equal(picked.length, 1)
  assert.equal(picked[0].meld.kind, 'pung')
})

test('差一张', () => {
  const hand = h('s3 s4 p9 z2 z2')
  assert.deepEqual(M.partialWaits(hand, 0), ['s2', 's5'])
  assert.deepEqual(M.partialWaits(hand, 3), ['z2'])
  assert.deepEqual(M.partialWaits(hand, 2), [])
})

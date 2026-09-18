/**
 * 游戏数据：常量、植物、僵尸、强化、关卡特性
 */
// 舞台与草坪坐标（逻辑像素）
const W = 1000, H = 700           // 草坪区 0~600，底部 600~700 为手牌托盘
const TRAY_Y = 600
const BG_X = -110                 // 背景图绘制偏移
const LAWN_X = 140, CELL_W = 81   // 草坪左边界、格宽
const LAWN_Y = 78, CELL_H = 100   // 草坪上边界、格高
const COLS = 9, ROWS = 5
const HOUSE_X = 95                // 僵尸越过此线则失败
const SPAWN_X = 980              // 僵尸出生位置
const cellCx = c => LAWN_X + CELL_W * c + CELL_W / 2
const rowTop = r => LAWN_Y + CELL_H * r
const plantGround = r => rowTop(r) + 88
const zombieGround = r => rowTop(r) + 94

/**
 * 麻将系统参数（M1 初版数值，可随时调）
 */
const MJ = {
  handSize: 8,          // 手牌上限 = 胡牌张数（2 面子 + 1 雀头 / 4 对）
  startHand: 7,         // 每关起手张数
  drawInterval: 3.5,    // 自动摸牌间隔（秒）
  skyDrop: 4,           // 天降牌间隔（秒）
  luckyDrop: 0.5,       // 掉落的牌是"有效牌"（能直接凑成面子）的概率
  luckyDraw: 0.5,       // 自动摸牌是"有效牌"的概率
  seedSlots: 3,         // 待种植物槽
  huDamage: 300,        // 胡牌基础伤害 × 番数
  huBossCap: 0.3,       // 胡牌对僵尸王的伤害上限（最大生命比例）
  huRedraw: 5,          // 胡牌存入储备后重新摸几张
  huReserve: 1,         // 胡牌大招储备上限
  waveBonus: 1.5,       // "一大波僵尸"期间放大招的倍率
  drawBank: 2,          // 手牌满时最多攒几次摸牌
  startSeeds: ['sunflower', 'peashooter'],   // 每关开局赠送的待种植物
}

/**
 * 面子 → 植物
 * 条=攻击　饼=防御　万=功能　字=爆发
 * 返回 { plant, hpMul?, dmgMul?, label } 或 { effect, label }（不种植物的即时效果）
 */
function meldToSeed (meld) {
  const { kind, suit, n } = meld
  if (kind === 'chow') {
    if (suit === 's') return { plant: n <= 3 ? 'peashooter' : n <= 6 ? ((n + 1) % 2 ? 'snowpea' : 'repeater') : 'gatlingpea' }
    if (suit === 'p') return { plant: n <= 3 ? 'wallnut' : n <= 6 ? 'spikeweed' : 'potatomine' }
    if (suit === 'm') return { plant: n <= 3 ? 'sunflower' : n <= 6 ? 'chomper' : 'squash' }
  }
  if (kind === 'pung') {
    if (suit === 's') return { plant: 'threepeater' }
    if (suit === 'p') return { plant: 'wallnut', hpMul: 2, label: '强化坚果' }
    if (suit === 'm') return { effect: 'draw2', label: '招财：摸 2 张' }
    if (n === 1) return { plant: 'cherrybomb' }
    if (n === 2) return { plant: 'jalapeno' }
    return { effect: 'freeze', label: '白板：全场减速 5 秒' }
  }
  if (kind === 'pair' && suit === 'z') {
    if (n === 1) return { plant: 'cherrybomb', dmgMul: 0.5, label: '小樱桃' }
    if (n === 2) return { plant: 'jalapeno', dmgMul: 0.5, label: '小辣椒' }
    return { effect: 'freezeSmall', label: '白对：全场减速 2 秒' }
  }
  return null
}

/**
 * 植物定义
 * anim: 各动作使用的素材目录；fps: 动画帧率
 * ox/oy: 绘制偏移（以格子中心、地面为锚点）
 */
const PLANTS = {
  sunflower: {
    name: '向日葵', cost: 50, cd: 4, hp: 300,
    desc: '每 12 秒掉落 1 张麻将牌。',
    anim: { idle: 'plants/sunflower/idle' }, fps: 12,
  },
  peashooter: {
    name: '豌豆射手', cost: 100, cd: 4, hp: 300,
    desc: '每秒发射一颗豌豆（20 伤害）。',
    anim: { idle: 'plants/peashooter/idle', attack: 'plants/peashooter/attack' }, fps: 10,
    shooter: { shots: 1, interval: 1 },
  },
  snowpea: {
    name: '寒冰射手', cost: 175, cd: 4, hp: 300,
    desc: '发射寒冰豌豆，使僵尸减速 50%。',
    anim: { idle: 'p/snowpea/idle' }, fps: 12,
    shooter: { shots: 1, interval: 1, ice: true },
  },
  repeater: {
    name: '双发射手', cost: 200, cd: 4, hp: 300,
    desc: '每次连续发射两颗豌豆。',
    anim: { idle: 'plants/repeater/idle', attack: 'plants/repeater/attack' }, fps: 14,
    shooter: { shots: 2, interval: 1 },
  },
  threepeater: {
    name: '三线射手', cost: 325, cd: 4, hp: 300,
    desc: '同时向本行和上下相邻两行发射豌豆。',
    anim: { idle: 'p/threepeater/idle' }, fps: 12, oy: 4,
    shooter: { shots: 1, interval: 1, lanes: [-1, 0, 1] },
  },
  gatlingpea: {
    name: '机枪射手', cost: 400, cd: 8, hp: 300,
    desc: '每次连续发射四颗豌豆。',
    anim: { idle: 'plants/gatlingpea/idle', attack: 'plants/gatlingpea/attack' }, fps: 14, oy: 6,
    shooter: { shots: 4, interval: 1 },
  },
  wallnut: {
    name: '坚果墙', cost: 50, cd: 12, hp: 4000,
    desc: '坚硬的外壳，用来挡住僵尸。',
    anim: { idleH: 'plants/wallnut/idleH', idleM: 'plants/wallnut/idleM', idleL: 'plants/wallnut/idleL' }, fps: 10,
  },
  spikeweed: {
    name: '地刺', cost: 100, cd: 4, hp: 300,
    desc: '每秒对踩上来的僵尸造成 20 伤害，不会被啃食。',
    anim: { idle: 'p/spikeweed/idle' }, fps: 10, oy: 8, noEat: true,
  },
  potatomine: {
    name: '土豆地雷', cost: 25, cd: 12, hp: 300,
    desc: '6 秒后准备就绪，触碰即爆炸（1800 伤害）。',
    anim: { init: 'p/potatomine/init', idle: 'p/potatomine/idle', explode: 'p/potatomine/explode' }, fps: 8,
  },
  squash: {
    name: '窝瓜', cost: 50, cd: 12, hp: 300,
    desc: '压扁靠近的僵尸（1800 伤害）。',
    anim: { idle: 'p/squash/idle', aim: 'p/squash/aim', attack: 'p/squash/attack' }, fps: 12, oy: 6, instant: true,
  },
  chomper: {
    name: '大嘴花', cost: 150, cd: 4, hp: 300,
    desc: '一口吞掉面前的僵尸，之后需要 18 秒消化。',
    anim: { idle: 'plants/chomper/idle', attack: 'plants/chomper/attack', digest: 'plants/chomper/digest' }, fps: 12, ox: 22, oy: 4,
  },
  cherrybomb: {
    name: '樱桃炸弹', cost: 150, cd: 20, hp: 300,
    desc: '炸毁周围 3×3 范围内的僵尸（1800 伤害）。',
    anim: { idle: 'plants/cherrybomb/idle', attack: 'plants/cherrybomb/attack' }, fps: 8, instant: true,
  },
  jalapeno: {
    name: '火爆辣椒', cost: 125, cd: 20, hp: 300,
    desc: '烧毁整行僵尸（1800 伤害）。',
    anim: { idle: 'p/jalapeno/idle', explode: 'p/jalapeno/explode' }, fps: 8, instant: true,
  },
}
const PLANT_ORDER = ['sunflower', 'peashooter', 'snowpea', 'repeater', 'threepeater', 'gatlingpea', 'wallnut',
  'spikeweed', 'potatomine', 'squash', 'chomper', 'cherrybomb', 'jalapeno']
const EXPLOSIVES = ['cherrybomb', 'jalapeno', 'squash', 'potatomine']
const SHOOTERS = ['peashooter', 'snowpea', 'repeater', 'threepeater', 'gatlingpea']

/**
 * 僵尸定义
 * armor: 护具血量（路障、铁桶、报纸）；hp: 本体血量
 * ax/ay: 精灵图中身体前沿、脚底的坐标
 * cost: 生成预算消耗
 */
const ZOMBIES = {
  normal: { name: '普通僵尸', hp: 270, armor: 0, speed: 30, cost: 1, ax: 65, ay: 142,
    anim: { walk: 'z/normal/walk', attack: 'z/normal/attack' } },
  flag: { name: '旗帜僵尸', hp: 270, armor: 0, speed: 34, cost: 1, ax: 65, ay: 142,
    anim: { walk: 'z/flag/walk', attack: 'z/flag/attack', lostwalk: 'z/flag/lostwalk', lostattack: 'z/flag/lostattack' } },
  cone: { name: '路障僵尸', hp: 270, armor: 370, speed: 30, cost: 2, ax: 65, ay: 142,
    anim: { walk: 'z/cone/walk', attack: 'z/cone/attack' } },
  paper: { name: '读报僵尸', hp: 270, armor: 150, speed: 30, cost: 2.5, ax: 50, ay: 158, angrySpeed: 60,
    anim: { walk: 'z/paper/walk', attack: 'z/paper/attack', nopaperwalk: 'z/paper/nopaperwalk', nopaperattack: 'z/paper/nopaperattack',
      lostwalk: 'z/paper/lostwalk', lostattack: 'z/paper/lostattack', die: 'z/paper/die' } },
  bucket: { name: '铁桶僵尸', hp: 270, armor: 1100, speed: 30, cost: 4, ax: 65, ay: 142,
    anim: { walk: 'z/bucket/walk', attack: 'z/bucket/attack' } },
  boss: { name: '铁桶僵尸王', hp: 3600, armor: 0, speed: 16, cost: 0, ax: 65, ay: 142, scale: 1.7, boss: true,
    anim: { walk: 'z/bucket/walk', attack: 'z/bucket/attack' } },
}
// 普通僵尸系共用的失去护具/头部/死亡动画
const ZOMBIE_COMMON = {
  walk: 'z/normal/walk', attack: 'z/normal/attack', lostwalk: 'z/normal/lostwalk', lostattack: 'z/normal/lostattack',
  die: 'z/normal/die', boom: 'z/normal/boom', head: 'z/normal/head',
}

/**
 * 关卡配置
 * budget: 本关僵尸预算；pool: 可出现的僵尸及权重；spawnTime: 零散刷怪持续时间（秒）
 */
const STAGES = [
  { budget: 5, spawnTime: 14, pool: { normal: 1 }, suits: ['p', 's', 'z'] },   // 第 1 关不放萬，更容易凑面子
  { budget: 16, spawnTime: 17, pool: { normal: 5, cone: 3, paper: 2 } },
  { budget: 38, spawnTime: 26, pool: { normal: 4, cone: 3, paper: 2, bucket: 1 } },
  { budget: 28, spawnTime: 24, pool: { normal: 3, cone: 3, paper: 2, bucket: 2 }, boss: true },
]

/**
 * 关卡特性（第 2~3 关随机抽取）
 */
const MODIFIERS = [
  { id: 'calm', name: '风平浪静', desc: '没有特殊效果。', icon: '🌤️' },
  { id: 'fast', name: '狂奔之夜', desc: '僵尸移动速度 +30%。', icon: '💨', apply: s => { s.zombieSpeed *= 1.3 } },
  { id: 'armored', name: '铁甲军团', desc: '路障与铁桶僵尸大量出现。', icon: '🛡️', apply: s => { s.poolBoost = { cone: 4, bucket: 3 } } },
  { id: 'cloudy', name: '阴天', desc: '没有天降牌，但起手多摸 1 张。', icon: '☁️', apply: s => { s.noSkySun = true; s.bonusDraw = 1 } },
  { id: 'horde', name: '尸潮', desc: '僵尸数量 +50%，但摸牌速度 +25%。', icon: '🧟', apply: s => { s.budgetMul *= 1.5; s.drawRate = 1.25 } },
  { id: 'news', name: '号外号外', desc: '读报僵尸大量出现。', icon: '📰', apply: s => { s.poolBoost = { paper: 8 } } },
]

/**
 * 强化（三选一奖励）
 * rarity: common 普通 / rare 稀有 / legendary 传说
 * max: 最多叠加次数（缺省为 1）
 * apply(m, game): m 为强化数值表 game.mods
 */
const UPGRADES = [
  // —— 经济 ——
  { id: 'fast_draw', name: '手气正旺', icon: '🀄', rarity: 'common', max: 3, desc: '自动摸牌速度 +20%。',
    apply: m => { m.drawRate *= 1.2 } },
  { id: 'photosynth', name: '光合作用', icon: '🌻', rarity: 'common', max: 2, desc: '向日葵掉牌速度 +40%。',
    apply: m => { m.sunflowerRate *= 1.4 } },
  { id: 'sky_rain', name: '天降好牌', icon: '🌦️', rarity: 'common', max: 2, desc: '天降牌频率 +40%。',
    apply: m => { m.skySunRate *= 1.4 } },
  { id: 'twin_sun', name: '双子向日葵', icon: '🌞', rarity: 'rare', desc: '向日葵每次掉落 2 张牌。',
    apply: m => { m.sunflowerAmt = 2 } },
  { id: 'auto_collect', name: '顺手牵羊', icon: '🧲', rarity: 'common', desc: '掉落的牌会被自动收进手牌。',
    apply: m => { m.autoCollect = true } },
  { id: 'start_hand', name: '起手好牌', icon: '🎴', rarity: 'rare', max: 2, desc: '每关起手额外多摸 1 张（不超过手牌上限）。',
    apply: m => { m.startBonus += 1 } },
  { id: 'big_hu', name: '大胡', icon: '🀅', rarity: 'rare', max: 2, desc: '胡牌伤害 +50%。',
    apply: m => { m.huDmg *= 1.5 } },
  { id: 'bounty', name: '赏金猎人', icon: '🎯', rarity: 'rare', desc: '每消灭 4 只僵尸摸 1 张牌。',
    apply: m => { m.killDraw = true } },
  // —— 射手 ——
  { id: 'hard_pea', name: '硬化豌豆', icon: '🟢', rarity: 'common', max: 3, desc: '豌豆伤害 +25%。',
    apply: m => { m.peaDmg *= 1.25 } },
  { id: 'rapid', name: '急速射击', icon: '⚡', rarity: 'common', max: 3, desc: '射手攻击速度 +20%。',
    apply: m => { m.fireRate *= 1.2 } },
  { id: 'pierce', name: '穿甲豌豆', icon: '🗡️', rarity: 'rare', max: 2, desc: '豌豆可额外穿透 1 只僵尸。',
    apply: m => { m.pierce += 1 } },
  { id: 'extra_pea', name: '多重射击', icon: '➕', rarity: 'rare', desc: '所有射手每次多发射 1 颗豌豆。',
    apply: m => { m.extraShots += 1 } },
  { id: 'frost_spread', name: '寒意蔓延', icon: '❄️', rarity: 'rare', desc: '所有豌豆有 30% 几率变为寒冰豌豆。',
    apply: m => { m.iceChance = 0.3 } },
  { id: 'deep_freeze', name: '深度冻结', icon: '🧊', rarity: 'common', desc: '减速效果提升至 70%，寒冰豌豆伤害 +50%。',
    apply: m => { m.slow = 0.3; m.iceDmg *= 1.5 } },
  { id: 'fire_pea', name: '火焰豌豆', icon: '🔥', rarity: 'legendary', desc: '普通豌豆变为火焰豌豆：伤害翻倍，并溅射周围僵尸。',
    apply: m => { m.firePea = true } },
  // —— 防御 ——
  { id: 'hard_nut', name: '坚不可摧', icon: '🥜', rarity: 'common', max: 2, desc: '坚果墙生命值 +100%。',
    apply: m => { m.wallnutHp *= 2 } },
  { id: 'thorn_nut', name: '荆棘坚果', icon: '🌵', rarity: 'rare', desc: '啃食坚果墙的僵尸每秒受到 40 伤害。',
    apply: m => { m.thorns = 40 } },
  { id: 'thick_skin', name: '厚皮', icon: '🛡️', rarity: 'common', max: 2, desc: '所有植物生命值 +50%。',
    apply: m => { m.plantHp *= 1.5 } },
  { id: 'spike_up', name: '钢刺', icon: '📌', rarity: 'common', desc: '地刺伤害 ×2，并无视护具。',
    apply: m => { m.spikeDmg *= 2; m.spikePierceArmor = true } },
  { id: 'regen', name: '生生不息', icon: '💚', rarity: 'rare', desc: '植物每秒恢复 2% 最大生命值。',
    apply: m => { m.regen = 0.02 } },
  { id: 'mower_fix', name: '除草车维修', icon: '🔧', rarity: 'common', max: 9, desc: '修复所有已使用的除草车。',
    apply: (m, g) => { g.repairMowers() } },
  { id: 'mower_return', name: '回旋除草车', icon: '🔁', rarity: 'legendary', desc: '除草车清场后会开回来，可再次使用。',
    apply: m => { m.mowerReturn = true } },
  // —— 爆炸与特殊 ——
  { id: 'tenpai_rage', name: '听牌气势', icon: '🔥', rarity: 'rare', desc: '听牌时所有射手攻速 +30%。',
    apply: m => { m.tenpaiRage = true } },
  { id: 'fast_mine', name: '速成地雷', icon: '🥔', rarity: 'common', desc: '土豆地雷只需 2 秒即可就绪。',
    apply: m => { m.mineArm = 2 } },
  { id: 'big_cherry', name: '巨型樱桃', icon: '🍒', rarity: 'rare', desc: '樱桃炸弹范围扩大到 5×5。',
    apply: m => { m.cherryRange = 2 } },
  { id: 'hungry', name: '饥肠辘辘', icon: '👄', rarity: 'common', desc: '大嘴花消化时间 -70%。',
    apply: m => { m.digest *= 0.3 } },
  { id: 'reserve_plus', name: '蓄势待发', icon: '🀄', rarity: 'rare', desc: '胡牌大招可以多储备 1 个。',
    apply: m => { m.reserveBonus += 1 } },
  { id: 'insurance', name: '末日保险', icon: '📜', rarity: 'legendary', desc: '僵尸首次闯入房子时不会失败，改为消灭全场僵尸。',
    apply: m => { m.insurance += 1 } },
  { id: 'sky_fire', name: '天火', icon: '☄️', rarity: 'legendary', desc: '每当“一大波僵尸”来袭，自动焚烧僵尸最多的两行。',
    apply: m => { m.skyFire = true } },
  // —— 双刃剑 ——
  { id: 'frenzy', name: '狂热', icon: '😈', rarity: 'rare', desc: '所有射手攻速 +40%，但僵尸移速 +15%。',
    apply: m => { m.fireRate *= 1.4; m.zombieSpeed *= 1.15 } },
  { id: 'glass', name: '玻璃大炮', icon: '💥', rarity: 'rare', desc: '豌豆伤害 +60%，但植物生命值 -40%。',
    apply: m => { m.peaDmg *= 1.6; m.plantHp *= 0.6 } },
]

// 强化数值初始值
const baseMods = () => ({
  peaDmg: 1, iceDmg: 1, fireRate: 1, pierce: 0, extraShots: 0, iceChance: 0, slow: 0.5, firePea: false,
  wallnutHp: 1, plantHp: 1, thorns: 0, spikeDmg: 1, spikePierceArmor: false, regen: 0, mowerReturn: false,
  mineArm: 6, cherryRange: 1, digest: 1,
  sunflowerRate: 1, sunflowerAmt: 1, skySunRate: 1, autoCollect: false,
  drawRate: 1, startBonus: 0, huDmg: 1, killDraw: false, tenpaiRage: false, reserveBonus: 0,
  insurance: 0, skyFire: false, zombieSpeed: 1,
})

const RARITY = {
  common: { name: '普通', color: '#9fd18b' },
  rare: { name: '稀有', color: '#6fb6ff' },
  legendary: { name: '传说', color: '#ffb640' },
}

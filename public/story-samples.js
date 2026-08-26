// 参考样品：只转录现有编辑器能播的表（角色/关卡/羁绊/遗物/场景对白）。
// 不搬 GitHub 引擎、不拷立绘。画面/配音请在积木上「添加画面」「添加配音」。
import { ROGUE_KIND, CARD_MODES, normalizeRogue } from '/story-rogue.js';

function uid() { return 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

export const EDITOR_SAMPLES = [
  {
    id: 'road',
    kind: 'story',
    title: '样品·路边（无图）',
    blurb: '互动小说：场景 + 对白 + 选项分支。结构像 Twine 过场。立绘空着，加上画面就能当视觉小说。',
  },
  {
    id: 'dungeon',
    kind: 'gacha_rogue',
    title: '样品·地牢挂机',
    blurb: '女神挂机。职业+层层怪，参考 MIT：github.com/Hnichm/idle-game-eb（未搬代码与 png）。',
  },
  {
    id: 'bonds',
    kind: 'gacha_rogue',
    title: '样品·四人羁绊',
    blurb: '修仙自动战。四人门派 + 两条羁绊。表结构像自动战斗「编队加成」，不是某款商业游戏。',
  },
  {
    id: 'picks',
    kind: 'gacha_rogue',
    title: '样品·战后三选一',
    blurb: '每局不同。打完抽技能/遗物，参考 MIT：github.com/noahsug/card-auto-battler（只学流程）。',
  },
];

export function buildSampleWork(id) {
  if (id === 'road') return sampleRoad();
  if (id === 'dungeon') return sampleDungeon();
  if (id === 'bonds') return sampleBonds();
  if (id === 'picks') return samplePicks();
  return sampleDungeon();
}

function sampleRoad() {
  const goHome = 'b_home';
  const mid = 'b_mid';
  const leave = 'b_leave';
  const station = 'b_station';
  const choice2 = 'b_choice2';
  return {
    kind: 'story',
    orientation: 'portrait',
    imgQuality: 'standard',
    title: '样品·路边（无图）',
    cast: {},
    logic: { state: { courage: 0, bond: 0 }, rules: {} },
    chapters: [{
      id: 'ch_road',
      title: '路灯',
      blocks: [
        { id: uid(), type: 'scene', content: '【样品】剧情变量 courage/bond；去过的积木自动有 v_<id>=1。选项条件/效果程序落账，AI 不选分支。点「分支图」可看跳转。' },
        { id: uid(), type: 'dialogue', speaker: '过路人', content: '这么晚还在改稿？' },
        { id: uid(), type: 'dialogue', speaker: '你', content: '先把字写完。图以后再贴。' },
        {
          id: uid(),
          type: 'choice',
          content: '路灯下，你要？',
          choices: [
            { id: uid(), label: '先回家', jump: goHome, require: [], effect: [] },
            { id: uid(), label: '再写一会儿（勇气+1）', jump: mid, require: [], effect: [{ var: 'courage', op: '+', val: 1 }] },
          ],
        },
        { id: mid, type: 'scene', content: '你又坐下。夜风有点凉，字多了两行。顶栏应显示 courage:1。' },
        {
          id: choice2,
          type: 'choice',
          content: '要不要去废弃车站？',
          choices: [
            { id: uid(), label: '算了，离开', jump: leave, require: [], effect: [] },
            { id: uid(), label: '调查车站', jump: station, require: [{ var: 'courage', op: '>=', val: 1 }], effect: [{ var: 'bond', op: '+', val: 1 }] },
            { id: uid(), label: '强闯（需勇气≥5，应隐藏）', jump: station, require: [{ var: 'courage', op: '>=', val: 5 }], effect: [] },
          ],
        },
        { id: goHome, type: 'scene', content: '你收起稿纸。路灯嗡了一声。', terminal: true },
        { id: leave, type: 'scene', content: '你转身离开。车站的灯在背后闪了一下。', terminal: true },
        { id: station, type: 'scene', content: '废弃车站。夜风从铁轨间穿过。' },
        {
          id: uid(),
          type: 'perf',
          speaker: '林月',
          content: '这里……有人来过。',
          require: [{ var: 'bond', op: '>=', val: 1 }],
          live: false,
          hint: '刚调查车站，气氛不对',
        },
        {
          id: uid(),
          type: 'perf',
          speaker: '沈烬',
          content: '怕了？',
          require: [{ var: 'bond', op: '>=', val: 1 }],
          live: false,
          hint: '',
        },
        {
          id: uid(),
          type: 'perf',
          speaker: '林月',
          content: '我只是觉得不对劲。',
          require: [{ var: 'bond', op: '>=', val: 1 }],
          live: true,
          hint: '危险感；对沈烬略防备',
        },
        { id: uid(), type: 'scene', content: '沈烬笑了一声。到此为止。（bond<1 时上面三句演出会被跳过）', terminal: true },
      ],
    }],
  };
}

function cardShell(mode, title, pack, intro) {
  const m = CARD_MODES[mode] ? mode : 'idle';
  return {
    kind: ROGUE_KIND,
    orientation: 'landscape',
    imgQuality: 'standard',
    title,
    cast: {},
    rogue: normalizeRogue({ mode: m, teamSize: 4, floors: 3, ...pack }),
    chapters: [{
      id: 'ch_card',
      title: CARD_MODES[m].label,
      blocks: [
        { id: 'b_in', type: 'scene', content: intro },
        { id: 'b_run', type: 'rogue', content: CARD_MODES[m].need, winContent: '样品打完了。去工作室改名字，或给角色加画面。', loseContent: '把敌人体力调低再试。' },
      ],
    }],
  };
}

function sampleDungeon() {
  return cardShell('idle', '样品·地牢挂机', {
    roster: [
      { id: 'c_jehu', name: '耶户', elem: 'light', faction: 'light', star: 3, hp: 125, atk: 18, spd: 16, skillIds: ['sk_slash'] },
      { id: 'c_balaam', name: '巴兰', elem: 'dark', faction: 'dark', star: 3, hp: 110, atk: 21, spd: 14, skillIds: ['sk_fire'] },
      { id: 'c_doeg', name: '多益', elem: 'light', faction: 'light', star: 2, hp: 100, atk: 16, spd: 20, skillIds: ['sk_stab'] },
      { id: 'c_urijah', name: '乌利亚', elem: 'light', faction: 'light', star: 3, hp: 140, atk: 14, spd: 14, skillIds: ['sk_smite'] },
    ],
    skills: [
      { id: 'sk_slash', name: 'Slash', kind: 'atk', power: 115, elem: 'light', ownerId: 'c_jehu' },
      { id: 'sk_fire', name: 'Fire', kind: 'atk', power: 125, elem: 'dark', ownerId: 'c_balaam' },
      { id: 'sk_stab', name: 'Backstab', kind: 'atk', power: 118, elem: 'light', ownerId: 'c_doeg' },
      { id: 'sk_smite', name: 'Smite', kind: 'heal', power: 95, elem: 'light', ownerId: 'c_urijah' },
    ],
    enemies: [
      { id: 'e1', name: '亡骨', elem: 'dark', hp: 50, atk: 8, spd: 12 },
      { id: 'e2', name: '影卫', elem: 'dark', hp: 75, atk: 10, spd: 12 },
      { id: 'e3', name: '甲卫', elem: 'wood', hp: 100, atk: 12, spd: 11 },
      { id: 'e4', name: '层主', elem: 'dark', hp: 160, atk: 14, spd: 12, isBoss: true },
    ],
    stages: [
      { id: 'st1', title: '第1层 亡骨', enemyIds: ['e1'] },
      { id: 'st2', title: '第2层 影卫', enemyIds: ['e2'] },
      { id: 'st3', title: '第3层 甲卫', enemyIds: ['e3'] },
      { id: 'st4', title: '第4层 层主', enemyIds: ['e4'] },
    ],
    bonds: [], relics: [], events: [],
  }, '【样品】职业名来自 MIT 开源 idle-game-eb（耶户/巴兰/多益/乌利亚），怪物体力按它前几层缩小到本编辑器能打完。立绘没有拷过来，点播放就能打。');
}

function sampleBonds() {
  return cardShell('queue', '样品·四人羁绊', {
    roster: [
      { id: 'c_ren', name: '陈行', elem: 'fire', faction: 'ren', star: 3, hp: 125, atk: 19, spd: 16, skillIds: ['sk_ren'] },
      { id: 'c_dao', name: '青玄', elem: 'water', faction: 'dao', star: 3, hp: 120, atk: 17, spd: 18, skillIds: ['sk_dao'] },
      { id: 'c_fo', name: '了尘', elem: 'light', faction: 'fo', star: 2, hp: 140, atk: 15, spd: 14, skillIds: ['sk_fo'] },
      { id: 'c_yao', name: '狐九', elem: 'wood', faction: 'yao', star: 3, hp: 115, atk: 21, spd: 17, skillIds: ['sk_yao'] },
    ],
    skills: [
      { id: 'sk_ren', name: '剑气', kind: 'atk', power: 118, elem: 'fire', ownerId: 'c_ren' },
      { id: 'sk_dao', name: '符水', kind: 'atk', power: 110, elem: 'water', ownerId: 'c_dao' },
      { id: 'sk_fo', name: '诵经', kind: 'heal', power: 95, elem: 'light', ownerId: 'c_fo' },
      { id: 'sk_yao', name: '妖火', kind: 'atk', power: 122, elem: 'wood', ownerId: 'c_yao' },
    ],
    enemies: [
      { id: 'e1', name: '山魈', elem: 'wood', hp: 55, atk: 9, spd: 12 },
      { id: 'e2', name: '散修', elem: 'fire', hp: 80, atk: 12, spd: 14 },
      { id: 'e3', name: '门卫', elem: 'dark', hp: 180, atk: 16, spd: 13, isBoss: true },
    ],
    stages: [
      { id: 'st1', title: '山道', enemyIds: ['e1'] },
      { id: 'st2', title: '坊市', enemyIds: ['e2'] },
      { id: 'st3', title: '宗门', enemyIds: ['e3'] },
    ],
    bonds: [
      { id: 'bd1', name: '人道路遇', unitIds: ['c_ren', 'c_dao'], atkPct: 18 },
      { id: 'bd2', name: '佛妖因果', unitIds: ['c_fo', 'c_yao'], atkPct: 15 },
    ],
    relics: [], events: [],
  }, '【样品】选陈行+青玄，或了尘+狐九一起上场，羁绊会加攻击。立绘空着。不能做商业游戏的抽卡运营，只能做这场自动战。');
}

function samplePicks() {
  return cardShell('rogue', '样品·战后三选一', {
    roster: [
      { id: 'c_yan', name: '炎', elem: 'fire', faction: 'fire', star: 2, hp: 130, atk: 22, spd: 15, skillIds: ['sk_ball'] },
      { id: 'c_lan', name: '澜', elem: 'water', faction: 'water', star: 2, hp: 140, atk: 18, spd: 17, skillIds: ['sk_tide'] },
      { id: 'c_qing', name: '青', elem: 'wood', faction: 'wood', star: 2, hp: 150, atk: 16, spd: 14, skillIds: ['sk_heal'] },
      { id: 'c_yao', name: '曜', elem: 'light', faction: 'light', star: 2, hp: 120, atk: 20, spd: 18, skillIds: ['sk_ray'] },
    ],
    skills: [
      { id: 'sk_ball', name: '火球', kind: 'atk', power: 120, elem: 'fire', ownerId: 'c_yan' },
      { id: 'sk_tide', name: '潮涌', kind: 'atk', power: 110, elem: 'water', ownerId: 'c_lan' },
      { id: 'sk_heal', name: '回春', kind: 'heal', power: 100, elem: 'wood', ownerId: 'c_qing' },
      { id: 'sk_ray', name: '辉光', kind: 'atk', power: 125, elem: 'light', ownerId: 'c_yao' },
    ],
    enemies: [
      { id: 'e1', name: '木桩精', elem: 'wood', hp: 50, atk: 8, spd: 12 },
      { id: 'e2', name: '大木桩', elem: 'wood', hp: 90, atk: 12, spd: 11 },
      { id: 'eb', name: '深坑', elem: 'dark', hp: 200, atk: 16, spd: 12, isBoss: true },
    ],
    stages: [
      { id: 'st1', title: '第1层', enemyIds: ['e1'] },
      { id: 'st2', title: '第2层', enemyIds: ['e2'] },
      { id: 'st3', title: '最深处', enemyIds: ['eb'] },
    ],
    relics: [{ id: 'rl1', name: '小刀', desc: '大家打得重一点', effect: { type: 'atk_pct', val: 10 } }],
    events: [{ id: 'ev1', title: '泉水', text: '要喝吗？', choices: [{ label: '喝（回血）', kind: 'heal' }, { label: '不喝', kind: 'none' }] }],
    bonds: [],
  }, '【样品】打完三选一技能或遗物，流程参考 MIT card-auto-battler。对局里仍然自动出手，不用点牌。立绘空着。');
}

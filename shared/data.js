// Dữ liệu tĩnh của game: vật phẩm, công thức, thông số các component kiến trúc.
// File này là "hợp đồng" chung giữa sim (server/worker), renderer và UI.

export const TILE = 48;
export const MAP_W = 80;
export const MAP_H = 80;
export const TICK_RATE = 20;
export const DT = 1 / TICK_RATE;
export const FLOW_DT = 0.5; // bước mô phỏng luồng request (2 Hz)
export const INV_SLOTS = 12;
export const REACH = 70; // tầm với (px) để thu thập / đánh
export const BUILD_RANGE = 480; // khoảng cách tối đa từ người chơi tới vị trí đặt công trình
export const STATION_R = 230; // phải đứng gần bàn chế tạo trong bán kính này
export const HANDS_ON_R = 300; // thao tác trực tiếp (nạp nhiên liệu, reboot, nâng cấp...) cần đứng gần
export const PWR_R = 460; // bán kính phủ sóng của máy phát điện

// ---------- Thời gian ----------
export const DAY_LEN = 150;
export const PHASES = { day: 80, dusk: 35, night: 35 };
export const SEASONS = ['autumn', 'winter', 'spring', 'summer'];
export const SEASON_VI = { autumn: 'Thu', winter: 'Đông', spring: 'Xuân', summer: 'Hè' };
export const SEASON_THEME = {
  autumn: 'Tăng trưởng đều',
  winter: 'Mùa tấn công (DDoS)',
  spring: 'Mùa ra mắt (viral)',
  summer: 'Mùa cao điểm (Black Friday)',
};
export const DAYS_PER_SEASON = 4;

export function clockAt(time) {
  const dayIdx = Math.floor(time / DAY_LEN);
  const t = time - dayIdx * DAY_LEN;
  let phase, dark;
  if (t < PHASES.day) {
    phase = 'day';
    dark = 0;
  } else if (t < PHASES.day + PHASES.dusk) {
    phase = 'dusk';
    const p = (t - PHASES.day) / PHASES.dusk;
    dark = p * p * (3 - 2 * p) * 0.92;
  } else {
    phase = 'night';
    const left = DAY_LEN - t;
    dark = left < 8 ? 0.95 * (left / 8) : 0.95;
  }
  const season = SEASONS[Math.floor(dayIdx / DAYS_PER_SEASON) % 4];
  return { dayIdx, day: dayIdx + 1, t, phase, dark, season, year: Math.floor(dayIdx / (DAYS_PER_SEASON * 4)) + 1 };
}

// ---------- Vật phẩm ----------
// type: res | food | tool | weapon | armor | light | fuel | module | misc
export const ITEMS = {
  cable: { name: 'Cáp mạng', stack: 40, type: 'res', desc: 'Dùng để nối các component và chế tạo.' },
  scrap: { name: 'Linh kiện', stack: 40, type: 'res', desc: 'Mảnh linh kiện nhặt được.' },
  silicon: { name: 'Silicon', stack: 40, type: 'res', desc: 'Tinh thể silicon — nguyên liệu CPU.' },
  wood: { name: 'Khung rack', stack: 40, type: 'res', fuel: 40, desc: 'Khung rack tháo từ cây; cũng đốt được cho máy phát điện.' },
  copper: { name: 'Đồng', stack: 40, type: 'res', desc: 'Dây dẫn & tản nhiệt.' },
  fiber: { name: 'Sợi quang', stack: 20, type: 'res', desc: 'Hiếm. Dành cho hạ tầng mạng cao cấp.' },
  coal: { name: 'Than', stack: 40, type: 'res', fuel: 100, desc: 'Nhiên liệu đậm đặc cho máy phát điện.' },
  bean: { name: 'Hạt cà phê', stack: 20, type: 'food', food: { hunger: 10, sanity: 0 }, desc: 'Ăn sống cũng tỉnh người.' },
  mushroom: { name: 'Nấm server', stack: 20, type: 'food', food: { hunger: 12, sanity: -8 }, desc: 'Ăn sống làm đầu óc quay cuồng.' },
  coffee: { name: 'Cà phê pha', stack: 10, type: 'food', food: { hunger: 30, sanity: 6 }, desc: '3 hạt cà phê, pha ở bếp.' },
  stew: { name: 'Mì hầm nấm', stack: 10, type: 'food', food: { hunger: 48, sanity: 12 }, desc: 'Ăn xong là muốn on-call thêm đêm nữa.' },
  axe: { name: 'Tua vít điện', stack: 1, type: 'tool', tool: 'chop', dur: 80, slot: 'hand', desc: 'Tháo khung rack (cây) lấy vật liệu.' },
  pickaxe: { name: 'Máy khoan wafer', stack: 1, type: 'tool', tool: 'mine', dur: 80, slot: 'hand', desc: 'Khoan mỏ silicon, đồng, sợi quang, than.' },
  spear: { name: 'Giáo Debugger', stack: 1, type: 'weapon', dmg: 30, dur: 100, slot: 'hand', desc: 'Diệt bug bằng một nhát.' },
  torch: { name: 'Đèn pin', stack: 1, type: 'light', light: 200, dur: 300, slot: 'hand', desc: 'Ánh sáng cá nhân. Cháy hết sau 300 giây.' },
  vest: { name: 'Áo Runbook', stack: 1, type: 'armor', absorb: 0.6, dur: 150, slot: 'body', desc: 'Có runbook trên người thì sự cố nào cũng bớt đau.' },
  duck: { name: 'Vịt cao su', stack: 1, type: 'misc', sanityAura: 0.12, desc: 'Rubber-duck debugging: giữ trong túi để hồi tỉnh táo.' },
  waf_module: { name: 'Module WAF', stack: 5, type: 'module', desc: 'Lắp vào API Gateway để chặn request độc hại.' },
  asg_module: { name: 'Module Autoscaler', stack: 5, type: 'module', desc: 'Lắp vào Load Balancer để tự động thêm/bớt instance.' },
};

// ---------- Công trình (không phải component hệ thống) ----------
// Mọi công trình đặt được: kind -> thông số.
export const STRUCTS = {
  gateway: { name: 'API Gateway', w: 2, h: 2, hp: 200, comp: true },
  cdn: { name: 'CDN', w: 1, h: 1, hp: 100, comp: true },
  lb: { name: 'Load Balancer', w: 1, h: 1, hp: 120, comp: true },
  app: { name: 'App Server', w: 1, h: 1, hp: 120, comp: true },
  cache: { name: 'Cache (Redis)', w: 1, h: 1, hp: 100, comp: true },
  queue: { name: 'Message Queue', w: 1, h: 1, hp: 100, comp: true },
  db: { name: 'Database', w: 1, h: 1, hp: 160, comp: true },
  replica: { name: 'Read Replica', w: 1, h: 1, hp: 140, comp: true },
  generator: { name: 'Máy phát điện', w: 1, h: 1, hp: 150, power: true, light: 150 },
  lantern: { name: 'Đèn giám sát (Monitoring)', w: 1, h: 1, hp: 80, watts: 1, light: 300, monitor: 300 },
  turret: { name: 'Tháp tường lửa', w: 1, h: 1, hp: 120, watts: 2, light: 110 },
  whiteboard: { name: 'Bảng trắng thiết kế', w: 1, h: 1, hp: 100, station: 1 },
  archlab: { name: 'Phòng lab kiến trúc', w: 2, h: 1, hp: 140, station: 2 },
  chaoslab: { name: 'Chaos Lab', w: 2, h: 1, hp: 140, station: 3 },
  stove: { name: 'Bếp ramen', w: 1, h: 1, hp: 80, light: 90 },
  chest: { name: 'Rương', w: 1, h: 1, hp: 80 },
  runbook: { name: 'Giá Runbook', w: 1, h: 1, hp: 80, aura: 0.25 },
};

// Thông số component hệ thống. Mảng theo tier (index 0 = tier 1).
export const COMP = {
  gateway: { layer: 0, watts: [1], cap: [1500], base: [3], out: ['cdn', 'lb', 'app'] },
  cdn: { layer: 1, watts: [1], cap: [4000], base: [8], out: ['lb', 'app'] },
  lb: { layer: 2, watts: [1], cap: [1200], base: [2], out: ['app'] },
  app: {
    layer: 3, watts: [2, 3, 5], cap: [150, 320, 700], base: [25, 22, 20], out: ['cache', 'db', 'queue'],
    upgrade: [null, { copper: 6, silicon: 4, fiber: 1 }, { copper: 12, silicon: 8, fiber: 3 }],
  },
  cache: {
    layer: 4, watts: [1, 2, 3], cap: [2000, 3000, 4500], base: [1, 1, 1], hit: [0.55, 0.75, 0.88], out: ['db'],
    upgrade: [null, { copper: 4, silicon: 3, fiber: 1 }, { copper: 8, silicon: 6, fiber: 2 }],
  },
  queue: {
    layer: 4, watts: [1, 2], cap: [3000, 5000], buffer: [4000, 12000], base: [4, 4], out: ['db'],
    upgrade: [null, { copper: 5, silicon: 4, fiber: 1 }],
  },
  db: {
    layer: 5, watts: [2, 3, 5], cap: [220, 480, 1000], base: [15, 13, 12], disk: [60, 150, 400], out: ['replica'],
    upgrade: [null, { copper: 8, silicon: 6, fiber: 2 }, { copper: 14, silicon: 10, fiber: 4 }],
    shardCost: { copper: 6, silicon: 4, fiber: 1 },
  },
  replica: {
    layer: 6, watts: [2, 3, 5], cap: [220, 480, 1000], base: [15, 13, 12], out: [],
    upgrade: [null, { copper: 8, silicon: 6, fiber: 2 }, { copper: 14, silicon: 10, fiber: 4 }],
  },
};
export const MAX_SHARDS = 4;

// Chi phí xử lý (đơn vị công việc) cho mỗi request theo lớp: [static, read, write, bad]
export const CLS = ['s', 'r', 'w', 'b'];
export const CLS_VI = { s: 'Tĩnh', r: 'Đọc', w: 'Ghi', b: 'Độc hại' };
export const COST = {
  gateway: [0.2, 0.2, 0.2, 0.2],
  cdn: [0.1, 0.1, 0.1, 0.1],
  lb: [0.3, 0.3, 0.3, 0.3],
  app: [1, 2, 3, 2],
  cache: [0.3, 0.3, 0.3, 0.3],
  queue: [0, 0, 0.2, 0],
  db: [0, 2, 5, 2],
  replica: [0, 2, 5, 2],
};
export const TRAFFIC_MIX = [0.3, 0.5, 0.2]; // static, read, write trong traffic hợp lệ
export const RPS_PER_USER = 1.2;

// Cạnh nối hợp lệ: from kind -> mảng kind đích
export function canLink(fromKind, toKind) {
  const c = COMP[fromKind];
  return !!c && c.out.includes(toKind);
}

export const SLO = { success: 0.985, p99: 1500 };

// ---------- Công thức chế tạo ----------
// station: 0 (tự do) | 1 whiteboard | 2 archlab | 3 chaoslab
// out: {item,n} -> vào túi ; place: kind -> vào chế độ đặt công trình
export const RECIPES = [
  { id: 'axe', cat: 'tool', name: 'Tua vít điện', station: 0, ing: { scrap: 1, silicon: 1 }, out: { item: 'axe', n: 1 } },
  { id: 'pickaxe', cat: 'tool', name: 'Máy khoan wafer', station: 0, ing: { scrap: 2, silicon: 1 }, out: { item: 'pickaxe', n: 1 } },
  { id: 'spear', cat: 'tool', name: 'Giáo Debugger', station: 0, ing: { scrap: 2, cable: 2, silicon: 2 }, out: { item: 'spear', n: 1 } },
  { id: 'torch', cat: 'tool', name: 'Đèn pin', station: 0, ing: { wood: 1, cable: 2 }, out: { item: 'torch', n: 1 } },
  { id: 'vest', cat: 'tool', name: 'Áo Runbook', station: 1, ing: { cable: 8, scrap: 3 }, out: { item: 'vest', n: 1 } },
  { id: 'duck', cat: 'survive', name: 'Vịt cao su', station: 0, ing: { scrap: 2, cable: 1 }, out: { item: 'duck', n: 1 } },
  { id: 'whiteboard', cat: 'survive', name: 'Bảng trắng thiết kế', station: 0, ing: { wood: 4, scrap: 3, cable: 2 }, place: 'whiteboard' },
  { id: 'chest', cat: 'survive', name: 'Rương', station: 0, ing: { wood: 4, scrap: 2 }, place: 'chest' },
  { id: 'generator', cat: 'survive', name: 'Máy phát điện', station: 1, ing: { wood: 5, silicon: 3, scrap: 2 }, place: 'generator' },
  { id: 'stove', cat: 'survive', name: 'Bếp ramen', station: 1, ing: { wood: 4, silicon: 3, scrap: 2 }, place: 'stove' },
  { id: 'lantern', cat: 'survive', name: 'Đèn giám sát', station: 1, ing: { scrap: 3, silicon: 2, copper: 2 }, place: 'lantern' },
  { id: 'runbook', cat: 'survive', name: 'Giá Runbook', station: 1, ing: { wood: 3, scrap: 4, cable: 3 }, place: 'runbook' },
  { id: 'app', cat: 'infra', name: 'App Server', station: 1, ing: { wood: 4, silicon: 3, copper: 3, cable: 2 }, place: 'app' },
  { id: 'lb', cat: 'infra', name: 'Load Balancer', station: 1, ing: { wood: 3, silicon: 2, copper: 3, cable: 4 }, place: 'lb' },
  { id: 'db', cat: 'infra', name: 'Database', station: 1, ing: { wood: 4, silicon: 4, copper: 4, scrap: 3 }, place: 'db' },
  { id: 'archlab', cat: 'infra', name: 'Phòng lab kiến trúc', station: 1, ing: { wood: 6, silicon: 4, copper: 4, fiber: 1 }, place: 'archlab' },
  { id: 'cache', cat: 'adv', name: 'Cache (Redis)', station: 2, ing: { silicon: 3, copper: 4, scrap: 2 }, place: 'cache' },
  { id: 'queue', cat: 'adv', name: 'Message Queue', station: 2, ing: { wood: 3, silicon: 3, copper: 3, scrap: 2 }, place: 'queue' },
  { id: 'cdn', cat: 'adv', name: 'CDN', station: 2, ing: { silicon: 3, copper: 4, fiber: 2 }, place: 'cdn' },
  { id: 'replica', cat: 'adv', name: 'Read Replica', station: 2, ing: { wood: 4, silicon: 4, copper: 4, scrap: 3, fiber: 1 }, place: 'replica' },
  { id: 'turret', cat: 'adv', name: 'Tháp tường lửa', station: 2, ing: { silicon: 4, copper: 4, scrap: 3, coal: 1 }, place: 'turret' },
  { id: 'waf_module', cat: 'adv', name: 'Module WAF', station: 2, ing: { fiber: 2, silicon: 3, scrap: 2 }, out: { item: 'waf_module', n: 1 } },
  { id: 'chaoslab', cat: 'adv', name: 'Chaos Lab', station: 2, ing: { wood: 6, silicon: 6, copper: 6, fiber: 3, coal: 2 }, place: 'chaoslab' },
  { id: 'asg_module', cat: 'adv', name: 'Module Autoscaler', station: 3, ing: { fiber: 3, copper: 6, silicon: 6, scrap: 4 }, out: { item: 'asg_module', n: 1 } },
];
export const RECIPE_CATS = [
  { id: 'tool', name: 'Dụng cụ' },
  { id: 'survive', name: 'Sinh tồn' },
  { id: 'infra', name: 'Hạ tầng' },
  { id: 'adv', name: 'Nâng cao' },
];
export const STATION_NAME = { 0: 'Tự do', 1: 'Bảng trắng', 2: 'Phòng lab kiến trúc', 3: 'Chaos Lab' };

// Nấu ăn ở bếp: ing -> out
export const COOK = [
  { id: 'coffee', ing: { bean: 3 }, out: 'coffee', time: 8 },
  { id: 'stew', ing: { mushroom: 2, bean: 1 }, out: 'stew', time: 12 },
];

// ---------- Tài nguyên trong thế giới ----------
// kind -> { name, solid, tool, work (số nhát), drops: [[item, min, max, chance]], regrow (giây) }
export const RESOURCES = {
  tree: { name: 'Cây khung rack', solid: true, tool: 'chop', work: 4, drops: [['wood', 2, 3, 1], ['scrap', 1, 1, 0.25]], regrow: 420 },
  rock: { name: 'Mỏ silicon', solid: true, tool: 'mine', work: 3, drops: [['silicon', 1, 3, 1], ['copper', 1, 2, 0.8]], regrow: 600 },
  vein: { name: 'Mạch sợi quang', solid: true, tool: 'mine', work: 5, drops: [['fiber', 1, 2, 1], ['copper', 1, 1, 0.5]], regrow: 900 },
  coalseam: { name: 'Mạch than', solid: true, tool: 'mine', work: 3, drops: [['coal', 2, 3, 1]], regrow: 600 },
  bush: { name: 'Bụi cà phê', solid: false, tool: null, work: 1, drops: [['bean', 2, 3, 1]], regrow: 120 },
  tuft: { name: 'Búi cáp', solid: false, tool: null, work: 1, drops: [['cable', 1, 2, 1]], regrow: 60 },
  sapling: { name: 'Cây linh kiện', solid: false, tool: null, work: 1, drops: [['scrap', 1, 1, 1]], regrow: 90 },
  mush: { name: 'Nấm server', solid: false, tool: null, work: 1, drops: [['mushroom', 1, 2, 1]], regrow: 150 },
  shard: { name: 'Mảnh silicon', solid: false, tool: null, work: 1, drops: [['silicon', 1, 1, 1]], regrow: 400 },
};

export const MOBS = {
  gremlin: { name: 'Gremlin (bug)', hp: 45, speed: 78, dmg: 12, atkCd: 1.2, r: 14 },
  bot: { name: 'Bot độc hại', hp: 18, speed: 85, dmg: 8, atkCd: 1.0, r: 11 },
  phantom: { name: 'Cảnh báo giả', hp: 25, speed: 70, dmg: 10, atkCd: 1.4, r: 12 },
};

export const PLAYER = {
  speed: 150, r: 14, hp: 100, hunger: 100, sanity: 100,
  hungerRate: 0.13, // /giây
  fistDmg: 6, atkCd: 0.6, respawn: 12,
};

// ---------- Hợp đồng thực thể (replicate server -> client) ----------
// Mọi entity: { id, k, x, y, ... } — thuộc tính bắt đầu bằng "_" là riêng tư của server.
//  player:  name, hue, hp, mhp, hunger, sanity, inv[INV_SLOTS]({i,n,d?}|null), eq{hand,body}({i,d}|null),
//           ghost, act('idle'|'walk'|'work'|'attack'|'eat'), fx(-1|1 hướng nhìn), lit(bool đang cầm đèn)
//  resources (RESOURCES keys): ready(bool), + big (tree: 0|1|2 kích cỡ)
//  item:    item, n
//  structures (STRUCTS keys): tx, ty, w, h, hp, mhp, on(bool có điện/hoạt động), crashed, tier, rb(đang reboot)
//    generator: fuel, mf (nhiên liệu tối đa)
//    app: bad (bản deploy lỗi), virt (số instance ảo từ autoscaler), ver
//    lb: algo('rr'|'lc'|'hash'), asg(bool)
//    db: shards, leader(bool = đang là leader), disk(0..1)
//    gateway: waf(bool)
//    turret: fire(bool đang bắn)
//    stove: cooking(item id|null), done(bool)
//    chest: inv[]
//    mọi component có links:[id,...] (cáp nối đi ra)
//  mobs: gremlin | bot | phantom: hp, mhp, fx
export const MOB_KINDS = Object.keys(MOBS);
export const RES_KINDS = Object.keys(RESOURCES);
export const STRUCT_KINDS = Object.keys(STRUCTS);

// ---------- Vai trò (nhân vật) ----------
// Mỗi vai trò là một chuyên môn kỹ sư với kỹ năng bị động riêng (xem world.js: role perks).
export const ROLES = {
  sre: { name: 'SRE', tag: 'Người trực đêm', color: 28,
    desc: 'Quen cháy nhà. Sửa & reboot nhanh gấp đôi và không tốn linh kiện; ít bị stress khi có sự cố.',
    perks: ['Reboot/restart nhanh gấp đôi, miễn phí linh kiện', 'Sự cố ít làm giảm tỉnh táo (−60%)'] },
  backend: { name: 'Backend Dev', tag: 'Người ship code', color: 200,
    desc: 'Deploy cẩn thận: bản lỗi chỉ 12% thay vì 30%, rollback gần như tức thì, nâng tier rẻ hơn 25%.',
    perks: ['Deploy lỗi 12% (thường 30%)', 'Rollback tức thì', 'Nâng tier rẻ hơn 25%'] },
  dba: { name: 'DBA', tag: 'Người giữ dữ liệu', color: 120,
    desc: 'Archive miễn phí và dọn được 50% đĩa; thêm shard chỉ nửa giá.',
    perks: ['Archive miễn phí, dọn 50% đĩa', 'Thêm shard nửa giá'] },
  netops: { name: 'Network Eng.', tag: 'Người kéo cáp', color: 300,
    desc: 'Nối cáp tốn nửa số cáp, chạy nhanh hơn 12%, tầm xây xa hơn.',
    perks: ['Nối cáp tốn một nửa', 'Tốc độ +12%', 'Tầm xây +40%'] },
  secops: { name: 'SecOps', tag: 'Người gác cổng', color: 55,
    desc: 'Bị bot/bug/cảnh báo giả gây ít sát thương hơn 30%, đánh mạnh hơn 50% và nhiều máu hơn.',
    perks: ['Nhận sát thương −30%', 'Gây sát thương +50%', 'Máu tối đa 130'] },
  chef: { name: 'Kỹ sư pha chế', tag: 'Người nuôi đội', color: 170,
    desc: 'Đồ ăn thức uống hiệu quả hơn 50%, đói chậm hơn 20%.',
    perks: ['Đồ ăn +50% hiệu quả', 'Đói chậm hơn 20%'] },
};

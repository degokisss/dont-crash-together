// "Cố vấn": gợi ý theo ngữ cảnh, mỗi gợi ý chỉ bắn một lần mỗi thế giới.
import { COMP, STRUCTS, ITEMS } from './data.js';

const TIPS = [
  {
    id: 'start', when: (w) => w.time > 4,
    msg: 'Bạn là kỹ sư on-call. Mục tiêu: giữ SLO (≥98.5% thành công, p99 ≤ 1.5s) để người dùng tăng. Chế tạo Tua vít điện & Máy khoan wafer (bấm C), đừng để máy phát hết điện. Bấm M mở sơ đồ hệ thống (có công cụ theo dõi một request). Công thức nâng cao phải học bằng Điểm kiến thức (KP) kiếm từ sổ tay và post-mortem.',
    codex: ['concept-slo'],
  },
  {
    id: 'fuel', when: (w) => [...w.structs].some((s) => s.k === 'generator' && s.fuel < 45),
    msg: 'Máy phát điện sắp hết nhiên liệu! Mất điện là mọi component tắt. Tháo cây lấy Khung rack hoặc khai thác Than, bấm vào máy phát để nạp.',
    codex: ['comp-generator', 'concept-capacity-cost'], kind: 'warn',
  },
  {
    id: 'dusk', when: (w) => w.clock.phase === 'dusk' && w.clock.day >= 1,
    msg: 'Hoàng hôn: bóng tối sắp buông. Gremlin chỉ gặm thứ nằm ngoài vùng sáng. Đừng đứng ngoài tối, và mở rộng Đèn giám sát cho mọi component.',
    codex: ['concept-observability', 'comp-lantern'], kind: 'warn',
  },
  {
    id: 'util', when: (w) => { const v = w.flow.view; return v && Object.entries(v.n).some(([id, m]) => { const e = w.ents.get(+id); return e && e.k === 'app' && m.u > 0.8; }); },
    msg: 'Một App dùng >80% công suất: độ trễ tăng phi tuyến khi tiến gần 100%. Nâng tier (vertical, có reboot) hoặc thêm App + Load Balancer (horizontal).',
    codex: ['concept-utilization', 'concept-scaling', 'comp-app'], kind: 'warn',
  },
  {
    id: 'nolb', when: (w) => { const a = [...w.structs].filter((s) => s.k === 'app').length; return a >= 2 && ![...w.structs].some((s) => s.k === 'lb'); },
    msg: 'Bạn có nhiều App nhưng Gateway chỉ gửi vào App đầu tiên trong danh sách cáp. Cần Load Balancer để chia tải.',
    codex: ['comp-lb', 'concept-lb-algos'],
  },
  {
    id: 'lbnolinks', when: (w) => [...w.structs].some((s) => s.k === 'lb' && s.links.length === 0),
    msg: 'Load Balancer chưa có cáp tới App nào. Chọn LB trong sơ đồ → "Nối cáp" → chọn App.',
    codex: [],
  },
  {
    id: 'cdnorigin', when: (w) => [...w.structs].some((s) => s.k === 'cdn' && s.links.length === 0),
    msg: 'CDN chưa có origin: các request tĩnh bị miss sẽ thất bại. Nối cáp từ CDN tới Load Balancer/App.',
    codex: ['comp-cdn'], kind: 'warn',
  },
  {
    id: 'tail', when: (w) => { const g = w.flow.g; return g && w.flow.view && w.flow.view.g.detail && g.p99 > 600 && g.p99 > 3 * g.p50 && g.ok > 0.5; },
    msg: 'p99 cao hơn nhiều so với p50: một số ít request rất chậm. Trung bình không kể hết câu chuyện — hãy theo dõi p99.',
    codex: ['concept-tail-latency', 'concept-slo'],
  },
  {
    id: 'retry', when: (w) => w.flow.g && w.flow.g.amp > 1.3,
    msg: 'Tải thực tế cao hơn nhiều so với nhu cầu: người dùng/App đang retry khi thất bại, làm hệ thống quá tải nặng hơn (retry storm). Circuit breaker + backoff giúp.',
    codex: ['concept-retry-storm', 'concept-circuit-breaker'], kind: 'warn',
  },
  {
    id: 'dbutil', when: (w) => { const v = w.flow.view; return v && Object.entries(v.n).some(([id, m]) => { const e = w.ents.get(+id); return e && (e.k === 'db' || e.k === 'replica') && m.u > 0.8; }); },
    msg: 'Database sắp quá tải. DB khó scale ngang: giảm tải bằng Cache (Phòng lab kiến trúc), Read Replica, Queue đệm ghi, hoặc nâng tier.',
    codex: ['comp-db', 'comp-cache', 'comp-replica'], kind: 'warn',
  },
  {
    id: 'disk', when: (w) => { const v = w.flow.view; return v && Object.values(v.n).some((m) => m.disk > 0.75); },
    msg: 'Đĩa DB đã đầy hơn 75%. Bật Retention trong cấu hình DB hoặc Archive dữ liệu cũ trước khi chạm 100%.',
    codex: ['comp-db', 'concept-capacity-cost'], kind: 'warn',
  },
  {
    id: 'queuelag', when: (w) => { const v = w.flow.view; return v && Object.values(v.n).some((m) => m.lag > 10 && m.q > 200); },
    msg: 'Hàng đợi tích backlog: producer nhanh hơn consumer. Đây là backpressure — dữ liệu ghi bị trễ (eventual consistency) và có thể tràn buffer.',
    codex: ['comp-queue', 'concept-backpressure'],
  },
  {
    id: 'unmon', when: (w) => w.clock.phase !== 'day' && [...w.structs].some((s) => COMP[s.k] && !w.isMonitored(s.x, s.y)),
    msg: 'Có component nằm ngoài vùng giám sát: bạn không thấy metrics của chúng và Gremlin sẽ gặm chúng ban đêm. Đặt thêm Đèn giám sát.',
    codex: ['concept-observability', 'comp-lantern'], kind: 'warn',
  },
  {
    id: 'complex', when: (w) => w.complexity > 16 * Math.max(1, w.players.size),
    msg: 'Độ phức tạp hệ thống vượt sức chứa của đội: tỉnh táo sẽ tụt dần. Giá Runbook giảm tải nhận thức; thêm đồng đội cũng chia sẻ gánh nặng. Mỗi component đều có giá.',
    codex: ['concept-complexity'], kind: 'warn',
  },
  {
    id: 'lowsan', when: (w) => [...w.players.values()].some((p) => !p.ghost && p.sanity < 35),
    msg: 'Tỉnh táo thấp: "cảnh báo giả" sẽ xuất hiện. Ăn đồ ngon, giữ Vịt cao su trong túi, đứng gần Giá Runbook hoặc nơi sáng đèn.',
    codex: ['concept-complexity', 'concept-observability'], kind: 'warn',
  },
  {
    id: 'archlab', when: (w) => w.codex.size > 0 && [...w.players.values()].some((p) => w.invCount(p.inv, 'fiber') >= 1 && w.invCount(p.inv, 'copper') >= 4) && ![...w.structs].some((s) => s.k === 'archlab'),
    msg: 'Bạn có đủ nguyên liệu cho Phòng lab kiến trúc — cho phép chế Cache, Queue, CDN, Replica và Tháp tường lửa (cần học công thức bằng KP).',
    codex: [],
  },
  {
    id: 'leakhint', when: (w) => { const v = w.flow.view; return v && Object.values(v.n).some((m) => m.mem > 60); },
    msg: 'Bộ nhớ của một App tăng đều và đã vượt 60%: dấu hiệu rò rỉ. Restart trước khi OOM (tốt nhất khi có ≥2 App sau LB), rồi deploy bản vá.',
    codex: ['inc-leak'], kind: 'warn',
  },
];

export function stepTips(w) {
  if (w.time < 3) return;
  // gợi ý đói theo từng người
  for (const p of w.players.values()) {
    if (p.ghost) continue;
    if (p.hunger < 25 && w.time - (p._hungryTip || -999) > 120) {
      p._hungryTip = w.time;
      w.say('Bạn đói rồi. Hái Bụi cà phê, hoặc nấu Cà phê pha / Mì hầm ở Bếp ramen.', 'warn', p.pid);
    }
  }
  if (w.time - (w._lastTip || -999) < 25) return;
  for (const t of TIPS) {
    if (w.tipsSeen.has(t.id)) continue;
    let ok = false;
    try { ok = t.when(w); } catch { ok = false; }
    if (!ok) continue;
    w.tipsSeen.add(t.id);
    w._lastTip = w.time;
    w.emit({ t: 'tip', msg: t.msg, kind: t.kind || 'tip', codex: t.codex });
    for (const c of t.codex || []) w.unlock(c);
    return;
  }
}

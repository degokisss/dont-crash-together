// Sơ đồ hệ thống sống + biểu đồ + nhật ký post-mortem (phím M / Tab).
import { G, $, $$, esc, hooks, cmd } from './state.js';
import { iconURL } from './art.js';
import { COMP, STRUCTS, SLO } from '/shared/data.js';
import { Inspector } from './inspector.js';

let root, open = false, sig = '', lastTk = -2, lastHist = -1, lastLog = -1, nodes = new Map();
const W = 900, H = 430, NW = 122, NH = 74;
const SHORT = { gateway: 'Gateway', cdn: 'CDN', lb: 'LB', app: 'App', cache: 'Cache', queue: 'Queue', db: 'DB', replica: 'Replica' };
const LAYER_NAME = ['Cổng vào', 'Edge (CDN)', 'Cân bằng tải', 'Ứng dụng', 'Cache / Queue', 'Dữ liệu', 'Replica'];

export const Dashboard = {
  init() {
    root = $('#dash');
    hooks.closeDash = () => { if (!open) return false; Dashboard.toggle(); return true; };
    root.onclick = (ev) => {
      if (ev.target.closest('[data-close]')) return Dashboard.toggle();
      const tr = ev.target.closest('[data-tr]');
      if (tr) { G.lastTraceCls = tr.dataset.tr; return cmd('trace', { cls: tr.dataset.tr }); }
      const cx = ev.target.closest('[data-codex]');
      if (cx) return hooks.openCodex(cx.dataset.codex);
      const n = ev.target.closest('.dnode');
      if (n) return Inspector.open(+n.dataset.id);
      const pm = ev.target.closest('[data-pm]');
      if (pm) { const p = G.log.find((x) => x.uid === +pm.dataset.pm); if (p) hooks.showPostmortem(p); }
    };
  },

  toggle() {
    open = !open;
    root.hidden = !open;
    sig = ''; lastTk = -2; lastHist = -1; lastLog = -1;
    if (open) { Dashboard.build(); Dashboard.update(true); }
  },

  build() {
    root.innerHTML = `<div class="dashwin">
      <div class="dh"><h2>Sơ đồ hệ thống sống</h2><div class="dsum" id="dsum"></div><button class="xbtn" data-close>×</button></div>
      <div class="dbody">
        <div class="dleft">
          <div class="diagram" id="diagram" style="width:${W}px;height:${H}px"><svg id="dsvg" width="${W}" height="${H}"></svg><div id="dnodes"></div></div>
          <p class="legend"><i class="g"></i>khỏe <i class="w"></i>&gt;80% tải <i class="b"></i>quá tải/lỗi <i class="u"></i>không được giám sát (???) — đặt Đèn giám sát để thấy số liệu. Nhấp vào node để mở bảng điều khiển.</p>
        </div>
        <div class="dright">
          <div class="charts">
            <div class="chart"><h4>Người dùng &amp; tải (rps)</h4><canvas id="c1" width="330" height="100"></canvas></div>
            <div class="chart"><h4>Thành công % <small>(SLO ${SLO.success * 100}%)</small></h4><canvas id="c2" width="330" height="100"></canvas></div>
            <div class="chart"><h4>p99 latency ms <small>(SLO ${SLO.p99})</small></h4><canvas id="c3" width="330" height="100"></canvas></div>
          </div>
          <h4>Theo dõi một request</h4>
          <div class="tracebar"><button data-tr="s">Tĩnh</button><button data-tr="r">Đọc</button><button data-tr="w">Ghi</button><small>Gửi một request mẫu và xem nó đi đâu, mất bao lâu, chết ở đâu.</small></div>
          <div id="trace" class="trace"></div>
          <h4>Nhật ký sự cố &amp; post-mortem</h4>
          <div id="dlog" class="dlog"></div>
        </div>
      </div></div>`;
    nodes.clear();
    lastRender = '';
    const wrap = $('#diagram', root);
    const avail = root.querySelector('.dbody').clientWidth - 350;
    const s = Math.max(0.5, Math.min(1, avail / W));
    wrap.style.transform = `scale(${s})`;
    wrap.style.transformOrigin = '0 0';
    wrap.parentElement.style.width = W * s + 'px';
    wrap.parentElement.style.height = H * s + 30 + 'px';
  },

  frame() {
    if (!open) return;
    const tk = G.sys ? G.sys.tk : -1;
    traceFrame();
    if (tk !== lastTk || G.history.length !== lastHist || G.log.length !== lastLog) { lastTk = tk; lastHist = G.history.length; lastLog = G.log.length; Dashboard.update(false); }
  },

  update(force) {
    const comps = [...G.ents.values()].filter((e) => COMP[e.k]).sort((a, b) => a.id - b.id);
    const s = JSON.stringify(comps.map((c) => [c.id, c.links]));
    if (s !== sig || force) { sig = s; layout(comps); }
    paint(comps);
    renderTrace();
    summary();
    charts();
    log();
  },
};

function layout(comps) {
  const nodesEl = $('#dnodes', root), svg = $('#dsvg', root);
  nodesEl.innerHTML = '';
  nodes.clear();
  const layers = new Map();
  for (const c of comps) {
    const l = COMP[c.k].layer;
    if (!layers.has(l)) layers.set(l, []);
    layers.get(l).push(c);
  }
  const keys = [...layers.keys()].sort((a, b) => a - b);
  const colW = keys.length > 1 ? (W - NW - 20) / (keys.length - 1) : 0;
  keys.forEach((l, ci) => {
    const list = layers.get(l).sort((a, b) => a.y - b.y);
    const gap = Math.min(NH + 18, (H - 40 - NH) / Math.max(1, list.length - 1 || 1));
    const total = (list.length - 1) * gap + NH;
    list.forEach((c, i) => {
      const x = 10 + ci * colW, y = (H - total) / 2 + i * gap + 10;
      nodes.set(c.id, { x, y, ent: c });
    });
  });
  keys.forEach((l, ci) => {
    const lab = document.createElement('div');
    lab.className = 'layer-label';
    lab.style.left = 10 + ci * colW + 'px';
    lab.textContent = LAYER_NAME[l];
    nodesEl.appendChild(lab);
  });
  for (const [id, n] of nodes) {
    const c = n.ent;
    const d = document.createElement('div');
    d.className = 'dnode';
    d.dataset.id = id;
    d.style.cssText = `left:${n.x}px;top:${n.y + 12}px;width:${NW}px;height:${NH}px`;
    d.innerHTML = `<div class="dn-h"><img width="26" height="26" src="${iconURL(c.k, 52)}" alt=""><b>${SHORT[c.k]}</b><small>#${id}${c.tier > 1 ? ' · T' + c.tier : ''}</small></div><div class="dn-u"><i></i></div><div class="dn-m"></div>`;
    nodesEl.appendChild(d);
    n.el = d;
  }
  // cạnh
  let paths = '<defs><marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#8fb7c4"/></marker></defs>';
  for (const [id, n] of nodes) {
    for (const t of n.ent.links) {
      const m = nodes.get(t);
      if (!m) continue;
      const x1 = n.x + NW, y1 = n.y + 12 + NH / 2, x2 = m.x, y2 = m.y + 12 + NH / 2;
      const mx = (x1 + x2) / 2;
      paths += `<path data-e="${id}>${t}" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2 - 2},${y2}" fill="none" stroke="#6f95a3" stroke-width="2" marker-end="url(#arr)"/><text data-t="${id}>${t}" x="${mx}" y="${(y1 + y2) / 2 - 5}" text-anchor="middle"></text>`;
    }
  }
  svg.innerHTML = paths;
}

function paint(comps) {
  const sys = G.sys;
  for (const [id, n] of nodes) {
    const c = G.ents.get(id);
    if (!c || !n.el) continue;
    const m = sys && sys.n[id];
    const el = n.el;
    let cls = 'dnode';
    let u = 0, txt = '';
    if (c.crashed) { cls += ' crashed'; txt = 'CRASH'; }
    else if (c.rb) { cls += ' rb'; txt = 'đang khởi động…'; }
    else if (!c.on) { cls += ' off'; txt = 'mất điện'; }
    else if (!m) { cls += ' unknown'; txt = '???'; }
    else {
      u = m.u;
      cls += m.u > 1 || m.err > 0.1 ? ' bad' : m.u > 0.8 ? ' warn' : ' good';
      txt = `${Math.round(m.u * 100)}% · ${m.rps}/s · ${m.lat}ms${m.err > 0.005 ? ` · <em>${(m.err * 100).toFixed(0)}% lỗi</em>` : ''}`;
      if (c.k === 'cache') txt += ` · hit ${Math.round(m.hit * 100)}%`;
      if (c.k === 'queue') txt = `${m.q} msg · lag ${m.lag}s`;
      if (c.k === 'db') txt += ` · đĩa ${Math.round(m.disk * 100)}%`;
    }
    if (G.selected === id) cls += ' sel';
    el.className = cls;
    el.querySelector('.dn-u i').style.width = Math.min(100, u * 100) + '%';
    el.querySelector('.dn-m').innerHTML = txt;
  }
  const svg = $('#dsvg', root);
  const cut = new Set(sys ? sys.cut : []);
  $$('path[data-e]', svg).forEach((p) => {
    const k = p.dataset.e;
    const r = sys && sys.e[k];
    const isCut = cut.has(k);
    p.setAttribute('stroke', isCut ? '#c4473b' : r === undefined ? '#4d5a62' : '#6fc3de');
    p.setAttribute('stroke-width', r === undefined ? 2 : Math.min(9, 2 + Math.log2(1 + r) * 0.6));
    p.setAttribute('stroke-dasharray', isCut ? '4 8' : r > 0 ? '10 8' : '');
    p.classList.toggle('flow', !isCut && r > 0);
  });
  $$('text[data-t]', svg).forEach((tx) => { const r = sys && sys.e[tx.dataset.t]; tx.textContent = r ? r + '/s' : cut.has(tx.dataset.t) ? 'ĐỨT' : ''; });
  markTrace();
}

function summary() {
  const g = G.sys && G.sys.g;
  const el = $('#dsum', root);
  if (!g) return (el.innerHTML = '');
  const cx = G.sys.cx;
  el.innerHTML = `<span><b>${Math.round(G.users)}</b> người dùng</span>` +
    (g.detail ? `<span class="${g.ok < SLO.success ? 'bad' : 'good'}">thành công <b>${(g.ok * 100).toFixed(2)}%</b></span><span class="${g.p99 > SLO.p99 ? 'bad' : 'good'}">p50 <b>${Math.round(g.p50)}</b> · p99 <b>${Math.round(g.p99)}</b> ms</span><span>tải <b>${g.demand}</b> rps${g.amp > 1.1 ? ` <em class="warn">(×${g.amp.toFixed(2)} do retry)</em>` : ''}</span>` : '<span class="bad">số liệu chi tiết bị che (Gateway ngoài vùng giám sát)</span>') +
    `<span>độ phức tạp <b>${cx}</b></span>`;
}

function charts() {
  const h = G.history;
  line($('#c1', root), [{ d: h.map((x) => x.users), c: '#f0c36b' }, { d: h.map((x) => x.demand ?? null), c: '#7fe0ff' }], { min: 0 });
  line($('#c2', root), [{ d: h.map((x) => (x.ok === undefined ? null : x.ok * 100)), c: '#8fe083' }, { d: h.map((x) => x.sat), c: '#c7a0ff' }], { min: 0, max: 100, ref: SLO.success * 100 });
  line($('#c3', root), [{ d: h.map((x) => x.p99 ?? null), c: '#ff9e7a' }], { min: 0, ref: SLO.p99 });
}

function line(cv, series, o) {
  const c = cv.getContext('2d');
  const w = cv.width, hh = cv.height;
  c.clearRect(0, 0, w, hh);
  c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(0, 0, w, hh);
  let max = o.max ?? Math.max(1, ...series.flatMap((s) => s.d.filter((v) => v !== null && v !== undefined)));
  if (o.ref && o.max === undefined) max = Math.max(max, o.ref * 1.15);
  const min = o.min ?? 0;
  const n = Math.max(2, ...series.map((s) => s.d.length));
  const X = (i) => 4 + (i / (n - 1)) * (w - 8), Y = (v) => hh - 4 - ((v - min) / (max - min || 1)) * (hh - 10);
  if (o.ref) { c.strokeStyle = 'rgba(255,120,100,0.6)'; c.setLineDash([4, 4]); c.beginPath(); c.moveTo(0, Y(o.ref)); c.lineTo(w, Y(o.ref)); c.stroke(); c.setLineDash([]); }
  for (const s of series) {
    c.strokeStyle = s.c; c.lineWidth = 1.6; c.beginPath();
    let started = false;
    s.d.forEach((v, i) => {
      if (v === null || v === undefined) { started = false; return; }
      if (!started) { c.moveTo(X(i), Y(v)); started = true; } else c.lineTo(X(i), Y(v));
    });
    c.stroke();
  }
  c.fillStyle = '#cbbf9e'; c.font = '10px ui-monospace, monospace';
  c.fillText(Math.round(max), 4, 11);
}

function log() {
  const el = $('#dlog', root);
  const inc = [...G.incidents.values()];
  const items = G.log.slice().reverse();
  el.innerHTML = (inc.length ? inc.map((i) => `<div class="li live"><b>● Đang diễn ra:</b> ${esc(i.name)}${i.drill ? ' (game day)' : ''}</div>`).join('') : '') +
    (items.length ? items.map((p) => `<button class="li" data-pm="${p.uid}"><span>Ngày ${p.day}</span><b>${esc(p.name)}${p.drill ? ' · game day' : ''}</b><em>${p.checks.filter((c) => c.ok).length}/${p.checks.length} ✓ · lỗi ${p.impact.peakErr}%</em></button>`).join('') : '<p class="help">Chưa có sự cố nào kết thúc. Sau mỗi sự cố, game phân tích kiến trúc thật của bạn.</p>');
}

// ---------------------------------------------------------------- theo dõi request
const CLS_NAME = { s: 'tĩnh', r: 'đọc', w: 'ghi' };
const ST_LABEL = { ok: '', hit: 'HIT', drop: 'LỖI', dead: 'CHẾT', retry: 'RETRY', cut: 'ĐỨT' };
let lastRender = '';

function traceFrame() {
  const t = G.trace;
  if (!t || G.traceShown > t.steps.length) return;
  if (performance.now() - G.traceAt > 420) { G.traceAt = performance.now(); G.traceShown++; renderTrace(); markTrace(); }
}

function markTrace() {
  const t = G.trace;
  const shown = t ? t.steps.slice(0, G.traceShown) : [];
  const last = shown[shown.length - 1];
  for (const [id, n] of nodes) {
    if (!n.el) continue;
    const steps = shown.filter((s) => s.id === id);
    n.el.classList.toggle('traced', steps.length > 0);
    n.el.classList.toggle('tfail', steps.some((s) => ['drop', 'dead', 'cut'].includes(s.st)));
    n.el.classList.toggle('tcur', !!last && last.id === id);
  }
}

function renderTrace() {
  const el = $('#trace', root);
  if (!el) return;
  const t = G.trace;
  if (!t) { if (lastRender !== 'none') { lastRender = 'none'; el.innerHTML = '<p class="help">Chọn loại request ở trên. Ngoài vùng Đèn giám sát, bước đi chỉ hiện "???".</p>'; } markTrace(); return; }
  const done = G.traceShown >= t.steps.length;
  const shown = t.steps.slice(0, G.traceShown);
  const key = t.steps.length + '|' + shown.length + '|' + t.ms + '|' + t.outcome;
  if (key === lastRender) return;
  lastRender = key;
  const head = done
    ? `<div class="tr-head ${t.outcome}">Request ${CLS_NAME[t.cls]}: ${t.outcome === 'ok' ? 'THÀNH CÔNG' : t.outcome === 'timeout' ? 'QUÁ 3 s — client bỏ cuộc' : 'THẤT BẠI'}${t.steps.every((s) => s.t === null) ? '' : ` · ${t.ms} ms`}</div>`
    : `<div class="tr-head run">Request ${CLS_NAME[t.cls]} đang đi…</div>`;
  const rows = shown.map((s) => `<li class="${s.st}"><span class="tn">${SHORT[s.k]} #${s.id}</span><b>${s.t === null ? '???' : s.t + ' ms'}</b>${ST_LABEL[s.st] ? `<i>${ST_LABEL[s.st]}</i>` : ''}<em>${s.note === null ? '(ngoài vùng giám sát)' : esc(s.note)}${s.u !== null && s.u > 80 ? ` · util ${s.u}%` : ''}</em></li>`).join('');
  let tail = '';
  if (done) {
    if (t.agg) tail += `<div class="tr-agg">Mẫu ${t.agg.n} request: <b>${Math.round((t.agg.ok / t.agg.n) * 100)}%</b> thành công · p50 <b>${t.agg.p50}</b> ms · p99 <b>${t.agg.p99}</b> ms${t.agg.top ? ` · lỗi hay gặp nhất: <b>${SHORT[t.agg.top.node] || t.agg.top.node}</b> (${t.agg.top.why})` : ''}</div>`;
    else tail += '<div class="tr-agg">Thống kê nhiều request bị che: Gateway ngoài vùng giám sát.</div>';
    if (t.hint) tail += `<div class="tr-hint">${esc(t.hint.text)} <button class="chip" data-codex="${t.hint.codex}">Sổ tay</button></div>`;
  }
  el.innerHTML = head + `<ol class="tr-steps">${rows}</ol>` + tail;
}

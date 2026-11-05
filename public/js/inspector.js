// Bảng điều khiển công trình: metrics (chỉ khi được giám sát), cấu hình, cáp, hành động.
import { G, $, $$, esc, cmd, enterLink, cancelMode, hooks } from './state.js';
import { iconURL } from './art.js';
import { ITEMS, COMP, STRUCTS, HANDS_ON_R, TILE, COOK, RECIPES, BACKUP, DATALOSS, ALERT, ONCALL, DEPLOY, DEPLOY_CHOICES } from '/shared/data.js';
import { entryTitle } from './codexui.js';

let root, metricsEl, lastSig = '', lastTk = -1, t = 0;
const img = (k, s = 20) => `<img class="ic" width="${s}" height="${s}" src="${iconURL(k, s * 2)}" alt="">`;

const INC_NAMES = {
  spike: 'Traffic spike', stampede: 'Cache stampede', crash: 'Node crash', leak: 'Rò rỉ bộ nhớ', ddos: 'DDoS / botnet', partition: 'Network partition',
  hotkey: 'Hot key', diskfull: 'Disk full', baddeploy: 'Deploy lỗi', outage: 'Mất điện lưới', analytics: 'Truy vấn báo cáo nặng', dataloss: 'Xóa nhầm dữ liệu',
};

// Mô tả từng mức theo đúng ngưỡng trong ALERT, để người chơi thấy cái giá của việc chỉnh nhạy hay chặt.
function alertHelp() {
  const rows = Object.entries(ALERT).filter(([, a]) => a.for).map(([, a]) => `<b>${a.name}</b>: lỗi ≥ ${a.err * 100}%, p99 ≥ ${a.p99} ms, util ≥ ${a.util * 100}%, đĩa ≥ ${a.disk * 100}%, kéo dài ≥ ${a.for} s`);
  return `Đèn page người on-call khi một component trong vùng của nó vi phạm ngưỡng liên tục. Nhạy báo sớm nhưng hay báo động giả (mất tỉnh táo, mọi người quen phớt lờ); Chặt yên tĩnh nhưng báo muộn, khi người dùng đã lỗi. Ngoài vùng đèn thì không có alert nào cả. Ack trong ${ONCALL.ack} s (phím V) hoặc cả đội bị page.<br>${rows.join('<br>')}`;
}

// Mô tả từng chiến lược theo đúng số trong DEPLOY, kèm thứ tự ưu tiên với Kubernetes.
function deployHelp() {
  const items = (c) => Object.entries(c).map(([k, n]) => `${n} ${ITEMS[k].name}`).join(' + ') || 'miễn phí';
  const rows = DEPLOY_CHOICES.map((k) => {
    const d = DEPLOY[k];
    const win = d.window ? `bản mới nhận ${d.share * 100}% request trong ${d.window} s rồi tự lên 100% (nút Promote lên sớm)` : `bản mới nhận 100% request ngay`;
    return `<b>${d.name}</b>: ${d.reboot ? `down ${d.reboot} s` : 'không downtime'}, ${win}, rollback ${d.rollback ? `reboot ${d.rollback} s` : 'tức thì (không reboot)'}${d.window ? ' khi còn trong cửa sổ' : ''}, ${items(d.cost)}${d.watts ? `, +${d.watts * 100}% điện và +${d.cx} độ phức tạp trong cửa sổ` : ''}`;
  });
  return `Cách phát hành bản mới. Canary giới hạn blast radius nhưng chỉ có tác dụng khi bạn nhìn số liệu và Rollback kịp (không ai làm gì thì hết cửa sổ bản lỗi vẫn lên 100%); blue/green rollback tức thì nhưng bản mới nhận toàn bộ traffic.<br>${rows.join('<br>')}<br><b>Ưu tiên</b>: App đã container hoá (Module Docker) và nằm sau Kubernetes luôn dùng <b>rolling update của Kubernetes</b> (down ~1 s, tự rollback ~10 s), cấu hình này bị bỏ qua; chiến lược chỉ áp dụng cho App không do Kubernetes quản lý.`;
}

// App container hoá và nằm sau một Kubernetes còn chạy: đúng điều kiện World.orchestrator.
function k8sManaged(e) {
  return e.k === 'app' && !!e.cont && [...G.ents.values()].some((s) => s.k === 'k8s' && s.on && !s.crashed && !s.rb && s.links.includes(e.id));
}

const CFG = {
  gateway: [
    { k: 'rl', label: 'Rate limit', codex: 'concept-load-shedding', opts: [[0, 'Tắt'], [60, '60'], [120, '120'], [250, '250'], [500, '500'], [1000, '1000']], unit: 'req/s',
      help: 'Từ chối sớm khi vượt ngưỡng để bảo vệ backend. Đổi lại: người dùng thật cũng bị từ chối khi tải cao (load shedding).' },
  ],
  lb: [
    { k: 'algo', label: 'Thuật toán', codex: 'concept-lb-algos', opts: [['rr', 'Round-robin'], ['lc', 'Least-conn'], ['hash', 'Hash (sticky)']],
      help: 'Round-robin chia đều số request kể cả khi App mạnh yếu khác nhau. Least-conn theo công suất còn trống. Hash giữ phiên nhưng key nóng làm lệch tải.' },
  ],
  app: [
    { k: 'retries', label: 'Retry xuống downstream', codex: 'concept-retry-storm', opts: [[0, '0'], [1, '1'], [2, '2'], [3, '3']],
      help: 'Thử lại cứu lỗi thoáng qua nhưng nhân tải lên downstream đang yếu (retry storm).' },
    { k: 'backoff', label: 'Backoff + jitter', bool: true, codex: 'concept-retry-storm', help: 'Giãn và rải các lần thử lại để không dồn cục. Giảm khuếch đại tải.' },
    { k: 'breaker', label: 'Circuit breaker', bool: true, codex: 'concept-circuit-breaker', help: 'Mở khi >50% lỗi: fail fast, để downstream hồi phục. Đổi lại: có lúc từ chối dù downstream đã khỏe.' },
    { k: 'deploy', label: 'Chiến lược deploy', codex: 'concept-deploy-strategies', opts: DEPLOY_CHOICES.map((k) => [k, DEPLOY[k].name]), help: deployHelp(),
      note: (e) => (k8sManaged(e) ? '<p class="help"><b>Đang do Kubernetes quản lý:</b> rolling update của Kubernetes thay chiến lược này.</p>' : '') },
  ],
  cache: [
    { k: 'ttl', label: 'TTL', codex: 'concept-cache-ttl', opts: [[10, '10 s'], [30, '30 s'], [60, '60 s']], help: 'TTL dài → hit ratio cao nhưng dữ liệu cũ hơn. TTL ngắn → tươi hơn, tải lên DB cao hơn.' },
    { k: 'jitter', label: 'TTL jitter', bool: true, codex: 'inc-stampede', help: 'Rải thời điểm hết hạn của key để tránh cùng lúc (chống stampede).' },
    { k: 'coalesce', label: 'Request coalescing', bool: true, codex: 'inc-stampede', help: 'Chỉ một request tái tạo key, phần còn lại chờ. Giảm đỉnh tải DB khi cache miss hàng loạt.' },
  ],
  db: [
    { k: 'repl', label: 'Replication', codex: 'concept-replication', opts: [['async', 'Async'], ['sync', 'Sync']],
      help: 'Async: nhanh, nhưng failover có thể mất bản ghi chưa sao chép. Sync: không mất dữ liệu nhưng ghi thất bại nếu replica không với tới.' },
    { k: 'failover', label: 'Failover', codex: 'concept-cap', opts: [['off', 'Tắt'], ['auto', 'Tự động'], ['quorum', 'Quorum']],
      help: 'Tự động: thăng cấp replica ngay khi primary im lặng (nguy cơ split-brain khi partition). Quorum: cần đa số node đồng ý (cần ≥3 node).' },
    { k: 'retention', label: 'Retention policy', bool: true, codex: 'concept-capacity-cost', help: 'Tự dọn dữ liệu cũ: đĩa đầy chậm hơn nhiều.' },
    { k: 'salt', label: 'Key salting', bool: true, codex: 'concept-sharding', help: 'Rải key nóng ra nhiều shard: giảm skew khi sharding.' },
    { k: 'backup', label: 'Backup (snapshot)', codex: 'concept-backup', opts: Object.entries(BACKUP).map(([k, b]) => [k, b.name]),
      help: `Snapshot định kỳ để quay về khi dữ liệu bị xoá hay hỏng; replica không thay được vì nó sao chép cả lỗi. Hằng giờ: mỗi ${BACKUP.hourly.every} s, hằng ngày: mỗi ${BACKUP.daily.every} s. Mỗi snapshot tốn IO và đĩa; tắt Backup sẽ xoá mọi snapshot.` },
  ],
  lantern: [
    { k: 'alert', label: 'Mức cảnh báo', codex: 'concept-alerting', opts: Object.entries(ALERT).map(([k, a]) => [k, a.name]), help: alertHelp() },
  ],
};

const SEMANTIC = {
  gateway: 'Gateway gửi tới <b>một</b> đích còn sống đầu tiên trong danh sách (failover theo thứ tự). Request tĩnh đi qua CDN, hoặc thẳng tới Object Storage nếu không có CDN.',
  cdn: 'CDN miss sẽ về <b>origin</b> (đích còn sống đầu tiên: S3, Kubernetes, LB hoặc App).',
  lb: 'LB chia tải cho mọi App còn sống theo thuật toán. Phát hiện node chết sau ~4 s.',
  k8s: 'Chia tải theo công suất còn trống, phát hiện pod chết sau ~1 s. Với App <b>đã đóng container</b> (Module Docker): tự khởi động lại pod chết (~6 s), HPA khi tải &gt;70%, và tự rollback khi deploy lỗi (~10 s); deploy là rolling update và <b>thay</b> chiến lược deploy (canary / blue-green) chọn ở App. App chưa đóng container chỉ được chia tải và vẫn dùng chiến lược của riêng nó.',
  s3: 'Phục vụ request <b>tĩnh</b> rất rẻ cho compute (chậm hơn CDN). DB nối tới S3 sẽ có <b>backup</b> mỗi 30 s và đĩa đầy chậm hơn.',
  app: 'Đọc → Cache (nếu có) rồi DB; ghi → Queue (nếu có) hoặc DB. Dùng đích đầu tiên còn sống. Chiến lược deploy (thẳng / canary / blue-green) chọn ở Cấu hình; App container hoá sau Kubernetes dùng rolling update của Kubernetes thay cho nó.',
  cache: 'Cache miss đi xuống DB.',
  queue: 'Queue xả dần vào DB theo công suất DB còn trống.',
  db: 'Replica nhận một phần đọc của DB. Nối DB → S3 để có backup định kỳ (replica không thay được backup).',
};

export const Inspector = {
  init() {
    root = $('#inspector');
    hooks.closeInspector = () => Inspector.close();
    root.onclick = (ev) => handle(ev);
  },

  open(id) {
    G.selected = id;
    G.chestOpen = null;
    root.hidden = false;
    document.body.classList.add('insp');
    lastSig = '';
    Inspector.render();
  },

  close() {
    G.selected = null;
    G.chestOpen = null;
    if (root) root.hidden = true;
    document.body.classList.remove('insp');
  },

  frame() {
    if (!G.selected || root.hidden) return;
    const e = G.ents.get(G.selected);
    if (!e) return Inspector.close();
    const tk = G.sys ? G.sys.tk : -1;
    const sig = signature(e) + actionSig(e);
    if (sig !== lastSig) { lastSig = sig; Inspector.render(); }
    else if (tk !== lastTk) { lastTk = tk; if (metricsEl) metricsEl.innerHTML = metricsHTML(e); }
  },

  render() {
    const e = G.ents.get(G.selected);
    if (!e) return;
    const S = STRUCTS[e.k];
    const me = G.me();
    const near = me && Math.hypot(me.x - e.x, me.y - e.y) <= HANDS_ON_R + (e.w || 1) * TILE / 2;
    const codexId = 'comp-' + e.k;
    const status = e.crashed ? '<span class="badge bad">Crash</span>' : e.rb ? '<span class="badge warn">Đang khởi động lại…</span>' : COMP[e.k] || S.watts || e.k === 'generator' ? (e.on ? '<span class="badge good">Đang chạy</span>' : '<span class="badge bad">Mất điện</span>') : '';
    let h = `<div class="ph">${img(e.k, 30)}<div class="pt"><b>${S.name}</b><small>${e.tier > 1 || COMP[e.k] && COMP[e.k].cap.length > 1 ? 'Tier ' + e.tier : ''}${e.ver ? ' · v' + e.ver : ''}${e.cont ? ' · container' : ''}${e.shards > 1 ? ' · ' + e.shards + ' shard' : ''}</small></div>${status}<button data-x title="Đóng">×</button></div>`;
    h += `<div class="hpbar" title="Độ bền"><i style="width:${(e.hp / e.mhp) * 100}%"></i></div>`;
    if (!near && (COMP[e.k] || e.k === 'generator' || e.k === 'stove' || e.k === 'chest')) h += `<div class="farhint">Đứng gần hơn để thao tác trực tiếp (sửa, nâng cấp, nạp nhiên liệu…). Cấu hình từ xa vẫn được.</div>`;
    h += `<div id="metrics" class="metrics">${metricsHTML(e)}</div>`;
    if (SEMANTIC[e.k]) h += `<div class="sem">${SEMANTIC[e.k]}</div>`;
    // cấu hình
    if (CFG[e.k]) {
      h += '<section><h4>Cấu hình</h4>';
      for (const c of CFG[e.k]) {
        const val = e.cfg[c.k];
        h += `<div class="cfg"><div class="cl"><span>${c.label}${c.unit ? ` <small>(${c.unit})</small>` : ''}</span>${c.codex && G.codex.has(c.codex) ? `<button class="q" data-codex="${c.codex}" title="Xem trong Sổ tay">?</button>` : ''}</div>`;
        if (c.bool) h += `<button class="tog ${val ? 'on' : ''}" data-cfg="${c.k}" data-v="${!val}"><i></i><span>${val ? 'Bật' : 'Tắt'}</span></button>`;
        else h += `<div class="segs">${c.opts.map(([v, l]) => `<button class="seg ${val === v ? 'on' : ''}" data-cfg="${c.k}" data-v='${JSON.stringify(v)}'>${l}</button>`).join('')}</div>`;
        h += `<p class="help">${c.help}</p>${c.note ? c.note(e) : ''}</div>`;
      }
      h += '</section>';
    }
    // cáp
    if (COMP[e.k] && COMP[e.k].out.length) {
      h += `<section><h4>Cáp đi ra</h4>`;
      if (e.links.length) {
        h += `<ul class="links">${e.links.map((id, i) => {
          const t = G.ents.get(id);
          if (!t) return '';
          return `<li>${img(t.k, 22)}<span>${STRUCTS[t.k].name}</span><em>${i === 0 && ['gateway', 'app', 'cdn'].includes(e.k) ? 'ưu tiên' : ''}</em>
            <button data-up="${id}" title="Ưu tiên cao hơn">↑</button><button data-down="${id}" title="Ưu tiên thấp hơn">↓</button><button data-unlink="${id}" title="Gỡ cáp">×</button></li>`;
        }).join('')}</ul>`;
      } else h += `<p class="help">Chưa có cáp. Có thể nối tới: ${COMP[e.k].out.map((k) => STRUCTS[k].name).join(', ')}.</p>`;
      h += `<button class="btn small" data-link>${img('cable', 18)} Nối cáp mới</button></section>`;
    }
    // hành động
    h += '<section class="acts"><h4>Hành động</h4><div class="arow">' + actions(e, near) + '</div></section>';
    if (e.k === 'chest') h += chestHTML(e);
    if (e.k === 'stove') h += stoveHTML(e, near);
    if (e.k === 'chaoslab') h += chaosHTML(e);
    h += `<div class="foot">${G.codex.has(codexId) ? `<button class="chip" data-codex="${codexId}">Sổ tay: ${esc(entryTitle(codexId) || S.name)}</button>` : ''}${S.hp ? '<button class="chip danger" data-dismantle>Tháo dỡ (hoàn 50%)</button>' : ''}</div>`;
    root.innerHTML = h;
    metricsEl = $('#metrics', root);
  },
};

function signature(e) {
  const me = G.me();
  const near = me ? Math.hypot(me.x - e.x, me.y - e.y) <= HANDS_ON_R + (e.w || 1) * TILE / 2 : false;
  const inv = me ? ['wood', 'coal', 'scrap', 'copper', 'silicon', 'fiber', 'waf_module', 'asg_module', 'docker_module', 'bean', 'mushroom'].map((k) => me.inv.reduce((a, s) => a + (s && s.i === k ? s.n : 0), 0)).join(',') : '';
  return JSON.stringify([e.id, e.tier, e.cfg, e.links, e.crashed, e.rb, e.on, e.waf, e.asg, e.cont, e.shards, e.ver, e.cooking, e.done, e.inv, near, inv, G.codex.size, Math.round(e.fuel / 10), e.rollout, k8sManaged(e)]);
}

function bar(v, cls = '') {
  const p = Math.max(0, Math.min(100, v * 100));
  const c = cls || (v > 1 ? 'bad' : v > 0.8 ? 'warn' : 'good');
  return `<div class="mbar ${c}"><i style="width:${p}%"></i></div>`;
}

// Trạng thái cửa sổ canary / blue-green của App. Số lỗi của bản mới chỉ có khi node được giám sát (m).
function rolloutHTML(e, m) {
  if (!e.rollout) return '';
  const ro = e.rollout, D = DEPLOY[ro.phase];
  const row = (l, v, cls = '') => `<div class="mrow"><span>${l}</span><b class="${cls}">${v}</b></div>`;
  let h = row(`${D.name}: ${Math.round(ro.share * 100)}% request chạy bản mới`, `còn ${Math.max(0, Math.ceil(ro.until - G.time))} s`, 'warn');
  if (m && m.ro) h += row(ro.phase === 'canary' ? 'Canary lỗi' : 'Bản mới (green) lỗi', Math.round(m.ro.err * 100) + '%', m.ro.err > 0 ? 'bad' : 'good');
  return h;
}

function metricsHTML(e) {
  if (e.k === 'generator') {
    const pct = e.fuel / e.mf;
    const burn = e.burn || 0.02;
    return `<div class="mrow"><span>Nhiên liệu</span><b>${Math.round(e.fuel)}/${e.mf}</b></div>${bar(pct, pct < 0.2 ? 'bad' : pct < 0.4 ? 'warn' : 'good')}
      <div class="mrow"><span>Công suất tải</span><b>${e.load || 0} W</b></div><div class="mrow"><span>Đốt</span><b>${burn.toFixed(2)}/s → còn ~${burn ? Math.round(e.fuel / burn) : '∞'} s</b></div>
      <p class="help">Mỗi component tiêu thụ điện. Thêm component = đốt nhiên liệu nhanh hơn (chi phí vận hành).</p>`;
  }
  if (!COMP[e.k]) return '';
  const m = G.sys && G.sys.n[e.id];
  if (!m) return `<div class="blind">${img('lantern', 20)} Ngoài vùng giám sát — bạn không thấy metrics của component này (và Gremlin sẽ gặm nó ban đêm). Đặt <b>Đèn giám sát</b> gần đây và đảm bảo có điện.</div>${e.k === 'app' ? rolloutHTML(e, null) : ''}`;
  let h = `<div class="mrow"><span>Utilization</span><b class="${m.u > 1 ? 'bad' : m.u > 0.8 ? 'warn' : ''}">${Math.round(m.u * 100)}%</b></div>${bar(m.u)}
    <div class="mrow"><span>Request vào</span><b>${m.rps}/s</b></div>
    <div class="mrow"><span>Độ trễ node</span><b>${m.lat} ms</b></div>
    <div class="mrow"><span>Tỉ lệ lỗi (node)</span><b class="${m.err > 0.02 ? 'bad' : ''}">${(m.err * 100).toFixed(1)}%</b></div>`;
  const r = (l, v, cls = '') => `<div class="mrow"><span>${l}</span><b class="${cls}">${v}</b></div>`;
  switch (e.k) {
    case 'app': h += r('Bộ nhớ', m.mem + '%', m.mem > 70 ? 'warn' : '') + bar(m.mem / 100, m.mem > 85 ? 'bad' : m.mem > 60 ? 'warn' : 'good') + r('Hệ số khuếch đại retry', '×' + m.amp, m.amp > 1.3 ? 'warn' : '') + r('Breaker', { closed: 'đóng', open: 'MỞ', half: 'nửa mở' }[m.br] || '—', m.br === 'open' ? 'bad' : '') + (e.virt ? r('Instance ảo (autoscale)', '+' + e.virt) : '') + r('Container', e.cont ? 'có' : 'không') + rolloutHTML(e, m); break;
    case 'cache': h += r('Hit ratio', Math.round(m.hit * 100) + '%') + r('Độ ấm (warm-up)', Math.round(m.warm * 100) + '%') + (m.crush ? '<div class="alert">STAMPEDE: key hết hạn cùng lúc!</div>' : ''); break;
    case 'cdn': h += r('Hit ratio', Math.round(m.hit * 100) + '%'); break;
    case 'queue': h += r('Backlog', m.q + ' msg') + bar(m.full, m.full > 0.8 ? 'bad' : m.full > 0.4 ? 'warn' : 'good') + r('Lag', m.lag + ' s', m.lag > 10 ? 'warn' : ''); break;
    case 'db': h += r('Đĩa', Math.round(m.disk * 100) + '%', m.disk > 0.8 ? 'bad' : '') + bar(m.disk, m.disk > 0.9 ? 'bad' : m.disk > 0.7 ? 'warn' : 'good') + r('Replication lag', m.lag + ' s', m.lag > 3 ? 'warn' : '') + (m.bkOn || m.bk >= 0 ? r('Snapshot S3', m.bk >= 0 ? m.bk + ' s trước' : 'đang chờ snapshot đầu') : '') + (m.why ? `<div class="alert">Ghi bị chặn: ${esc(m.why)}</div>` : '') + (m.split ? '<div class="alert">SPLIT-BRAIN: hai leader!</div>' : '') + r('Vai trò', e.leader ? 'leader' : 'follower'); break;
    case 'replica': h += r('Replication lag', m.lag + ' s', m.lag > 3 ? 'warn' : '') + r('Vai trò', e.leader ? 'leader (được thăng cấp)' : 'follower'); break;
    case 'lb': if (m.shares) h += Object.entries(m.shares).map(([id, s]) => { const t = G.ents.get(+id); return r('→ ' + (t ? STRUCTS[t.k].name + ' #' + id : id), Math.round(s * 100) + '%'); }).join(''); if (m.asg !== undefined) h += r('Autoscaler: util nhóm', Math.round(m.asg * 100) + '%'); break;
    case 'k8s': h += r('Pod đã đóng container', m.pods) + r('Tự chữa / rollback', m.heals + ' / ' + m.rollbacks) + (m.shares ? Object.entries(m.shares).map(([id, s]) => { const t = G.ents.get(+id); return r('→ ' + (t ? STRUCTS[t.k].name + ' #' + id + (t.cont ? '' : ' (chưa container)') : id), Math.round(s * 100) + '%'); }).join('') : '') + (m.asg !== undefined ? r('HPA: util nhóm', Math.round(m.asg * 100) + '%') : ''); break;
    case 'gateway': h += r('Bị rate limit', m.limited + '/s') + r('Bị WAF chặn', m.blocked + '/s'); break;
  }
  if (e.k === 'db') h += backupHTML(e, m, r);
  return h;
}

function backupHTML(e, m, r) {
  const off = e.cfg.backup === 'off' && !m.bkOn && m.bk < 0;
  const age = m.snapAge === null ? 'chưa có' : `${m.snapAge} giây trước`;
  return (m.corrupt ? '<div class="alert">DỮ LIỆU HỎNG: một phần đọc/ghi thất bại, replica cũng sao chép lỗi và failover không chữa được. Hãy khôi phục từ backup.</div>' : '')
    + r('Backup gần nhất', off ? 'đang tắt' : m.snap ? `${age} · đang snapshot…` : age, off ? 'warn' : '')
    + r('Chưa được bảo vệ', `~${m.rpo} bản ghi`, m.rpo > 20 ? 'warn' : '');
}

// Chỉ DB ngoài vùng giám sát mới luôn hiện nút khôi phục: trong vùng giám sát, nút chỉ có nghĩa khi dữ liệu đang hỏng.
function restoreHTML(e, me, near) {
  const m = G.sys && G.sys.n[e.id];
  if (m && !m.corrupt) return '';
  const off = e.cfg.backup === 'off' && !(m ? m.bkOn || m.bk >= 0 : e.links.some((id) => { const t = G.ents.get(id); return t && t.k === 's3'; }));
  if (off || (m && m.snapAge === null)) return `<button class="btn small" disabled>Khôi phục từ backup <small>(${off ? 'Backup đang tắt' : 'chưa có snapshot'})</small></button>`;
  const secs = DATALOSS.restore / (me && me.role === 'dba' ? 2 : 1);
  return `<button class="btn small ${m ? 'primary' : ''}" data-act="restore" ${near ? '' : 'disabled'}>Khôi phục từ backup <small>(DB reboot ~${secs} s)</small></button>`;
}

// Nút khôi phục phụ thuộc số liệu sống (dữ liệu hỏng, đã có snapshot) nên phải kích hoạt vẽ lại bảng.
function actionSig(e) {
  const m = e.k === 'db' && G.sys && G.sys.n[e.id];
  return m ? `${m.corrupt}${m.snapAge === null}` : '';
}

function haveCount(me, id) { return me ? me.inv.reduce((a, s) => a + (s && s.i === id ? s.n : 0), 0) : 0; }
function costChips(cost, me) {
  return Object.entries(cost).map(([k, n]) => `<span class="ing ${haveCount(me, k) >= n ? '' : 'miss'}">${img(k, 16)}<b>${n}</b></span>`).join('');
}

function actions(e, near) {
  const me = G.me();
  const dis = near ? '' : 'disabled';
  const b = (a, label, extra = '', cls = '') => `<button class="btn small ${cls}" data-act="${a}" ${dis}>${label}${extra}</button>`;
  let h = '';
  if (e.k === 'generator') {
    const w = haveCount(me, 'wood'), c = haveCount(me, 'coal');
    h += `<button class="btn small" data-refuel="wood" ${near && w ? '' : 'disabled'}>${img('wood', 16)} Nạp Khung rack (${w})</button><button class="btn small" data-refuel="coal" ${near && c ? '' : 'disabled'}>${img('coal', 16)} Nạp Than (${c})</button>`;
    return h;
  }
  if (!COMP[e.k]) return e.k === 'lantern' || e.k === 'turret' ? b('reboot', 'Reboot') : '';
  h += e.crashed ? b('reboot', 'Sửa & reboot', ' <small>(1 linh kiện)</small>', 'primary') : b('restart', 'Restart');
  const C = COMP[e.k];
  if (C.upgrade && C.upgrade[e.tier]) h += `<div class="upg"><button class="btn small" data-act="upgrade" ${dis}>Nâng tier ${e.tier + 1} <small>(reboot ~10s)</small></button><div class="ings">${costChips(C.upgrade[e.tier], me)}</div></div>`;
  if (e.k === 'app') {
    const D = DEPLOY[k8sManaged(e) ? 'k8s' : e.cfg.deploy] || DEPLOY.direct;
    const dep = `<button class="btn small" data-act="deploy" ${dis}>Deploy v${e.ver + 1} <small>(${D.name})</small></button>`;
    h += Object.keys(D.cost).length ? `<div class="upg">${dep}<div class="ings">${costChips(D.cost, me)}</div></div>` : dep;
    if (e.rollout) h += b('promote', 'Promote lên 100%');
    if (e.ver > 1) h += b('rollback', 'Rollback', e.rollout && !DEPLOY[e.rollout.phase].rollback ? ' <small>(không reboot)</small>' : '');
  }
  if (e.k === 'db') {
    if (e.shards < 4) h += `<div class="upg"><button class="btn small" data-act="shard" ${dis}>Thêm shard (${e.shards}→${e.shards + 1})</button><div class="ings">${costChips(C.shardCost, me)}</div></div>`;
    h += b('archive', 'Archive dữ liệu cũ', ' <small>(2 linh kiện)</small>');
    h += restoreHTML(e, me, near);
  }
  if (e.k === 'gateway') h += e.waf ? '<span class="badge good">WAF đã lắp</span>' : `<button class="btn small" data-act="install" ${near && haveCount(me, 'waf_module') ? '' : 'disabled'}>Lắp module WAF (${haveCount(me, 'waf_module')})</button>`;
  if (e.k === 'lb') h += e.asg ? '<span class="badge good">Autoscaler đã lắp</span>' : `<button class="btn small" data-act="install" ${near && haveCount(me, 'asg_module') ? '' : 'disabled'}>Lắp Autoscaler (${haveCount(me, 'asg_module')})</button>`;
  if (e.k === 'app') h += e.cont ? '<span class="badge good">Container (Docker)</span>' : `<button class="btn small" data-act="install" ${near && haveCount(me, 'docker_module') ? '' : 'disabled'}>Đóng container — Module Docker (${haveCount(me, 'docker_module')})</button>`;
  return h;
}

function chestHTML(e) {
  G.chestOpen = e.id;
  return `<section><h4>Rương <small>(chọn ô trong túi để cất)</small></h4><div class="grid chest">${e.inv.map((s, i) => `<button class="slot ${s ? '' : 'empty'}" data-wd="${i}">${s ? `<span class="c">${img(s.i, 30)}</span><span class="n">${s.n > 1 ? s.n : ''}</span>` : ''}</button>`).join('')}</div></section>`;
}

function stoveHTML(e, near) {
  const me = G.me();
  if (e.cooking) return `<section><h4>Bếp</h4><p>${e.done ? `Món <b>${ITEMS[e.cooking].name}</b> đã xong!` : `Đang nấu <b>${ITEMS[e.cooking].name}</b>…`}</p>${e.done ? `<button class="btn small primary" data-act="collect" ${near ? '' : 'disabled'}>Lấy ${ITEMS[e.cooking].name}</button>` : ''}</section>`;
  return `<section><h4>Nấu ăn</h4>${COOK.map((c) => {
    const ok = Object.entries(c.ing).every(([k, n]) => haveCount(me, k) >= n);
    return `<div class="upg"><button class="btn small" data-cook="${c.id}" ${near && ok ? '' : 'disabled'}>${img(c.out, 18)} ${ITEMS[c.out].name}</button><div class="ings">${costChips(c.ing, me)}</div></div>`;
  }).join('')}</section>`;
}

function chaosHTML(e) {
  const known = Object.keys(INC_NAMES).filter((k) => G.codex.has('inc-' + k));
  return `<section><h4>Game day (diễn tập sự cố)</h4><p class="help">Gây một sự cố đã từng gặp, không tính vào SLO. Đứng gần Chaos Lab. Hãy dự đoán trước khi bấm.</p>
    <div class="arow">${known.length ? known.map((k) => `<button class="btn small" data-gameday="${k}">${INC_NAMES[k]}</button>`).join('') : '<p class="help">Chưa gặp sự cố nào — hãy sống sót qua vài ngày đã.</p>'}</div></section>`;
}

function handle(ev) {
  const e = G.ents.get(G.selected);
  if (!e) return;
  const t = ev.target.closest('button');
  if (!t) return;
  if (t.hasAttribute('data-x')) return Inspector.close();
  if (t.dataset.codex) return hooks.openCodex(t.dataset.codex);
  if (t.dataset.cfg) return cmd('config', { id: e.id, key: t.dataset.cfg, val: JSON.parse(t.dataset.v) });
  if (t.hasAttribute('data-link')) return enterLink(e.id);
  if (t.dataset.unlink) return cmd('unlink', { from: e.id, to: +t.dataset.unlink });
  if (t.dataset.up) return cmd('moveLink', { id: e.id, to: +t.dataset.up, dir: -1 });
  if (t.dataset.down) return cmd('moveLink', { id: e.id, to: +t.dataset.down, dir: 1 });
  if (t.dataset.refuel) return cmd('refuel', { id: e.id, item: t.dataset.refuel, n: 10 });
  if (t.dataset.cook) return cmd('cook', { id: e.id, recipe: t.dataset.cook });
  if (t.dataset.wd !== undefined) return cmd('withdraw', { id: e.id, slot: +t.dataset.wd });
  if (t.dataset.gameday) return cmd('gameday', { inc: t.dataset.gameday });
  if (t.hasAttribute('data-dismantle')) { if (confirm('Tháo dỡ công trình này? (hoàn 50% nguyên liệu)')) { cmd('dismantle', { id: e.id }); Inspector.close(); } return; }
  const a = t.dataset.act;
  if (a) cmd(a, { id: e.id });
}

// Pager: ai đang on-call, các alert đang kêu và nút Ack. Dữ liệu lấy từ flow.view.al (G.sys.al) nên người vào sau cũng thấy.
import { G, $, esc, cmd } from './state.js';
import { STRUCTS, ALERT_RULES } from '/shared/data.js';
import { Inspector } from './inspector.js';

let root, lastKey = '';

export const Pager = {
  init() {
    root = $('#pager');
    root.onclick = (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      if (b.dataset.ack !== undefined) cmd('ack', b.dataset.ack === '' ? {} : { node: +b.dataset.ack });
      else if (b.dataset.take !== undefined) cmd('oncall');
      else if (b.dataset.node) Inspector.open(+b.dataset.node);
    };
  },

  // Ack nhanh bằng phím: ack mọi alert chưa nhận
  ack() { cmd('ack'); },

  frame() {
    const al = G.sys && G.sys.al;
    const anyAlertOn = [...G.ents.values()].some((e) => e.k === 'lantern' && e.cfg && e.cfg.alert !== 'off');
    if (!al || (!anyAlertOn && !al.list.length)) { if (!root.hidden) root.hidden = true; return; }
    const left = (a) => Math.max(0, Math.ceil(a.escAt - G.time));
    const key = JSON.stringify([al.oc, G.pid, al.list.map((a) => [a.node, a.st, a.esc, a.rules, a.st === 'firing' && !a.esc ? left(a) : 0])]);
    if (key === lastKey) return;
    lastKey = key;
    root.hidden = false;
    const oc = [...G.ents.values()].find((e) => e.k === 'player' && e.pid === al.oc);
    const mine = al.oc === G.pid;
    const open = al.list.filter((a) => a.st === 'firing');
    root.className = open.length ? (open.some((a) => a.esc) ? 'esc' : 'paging') : '';
    const rows = al.list.map((a) => {
      const e = G.ents.get(a.node);
      const name = e ? `${STRUCTS[e.k].name} #${a.node}` : `#${a.node}`;
      const rules = a.rules.map(([r, v]) => `<span class="pr">${ALERT_RULES[r].name} <b>${ALERT_RULES[r].fmt(v)}</b></span>`).join('');
      const can = mine || a.esc;
      const state = a.st === 'acked' ? '<em class="ok">đã ack</em>' : a.esc ? '<em class="bad">ESCALATED: cả đội bị page</em>' : `<em>ack trong <b>${left(a)}</b> s</em>`;
      return `<div class="prow ${a.sev} ${a.st} ${a.esc ? 'esc' : ''}"><div class="pn"><button class="lnk" data-node="${a.node}" title="Mở bảng điều khiển">${esc(name)}</button>${state}</div><div class="pw">${rules}</div>${a.st === 'firing' ? `<button class="btn small ${can ? 'primary' : ''}" data-ack="${a.node}" ${can ? '' : 'disabled'} title="${can ? 'Ack alert này' : 'Chỉ người on-call ack được cho tới khi escalate'}">Ack</button>` : ''}</div>`;
    }).join('');
    root.innerHTML = `<div class="ph2"><b>Pager</b><span>On-call: <i style="color:${oc ? `hsl(${oc.hue} 70% 70%)` : 'inherit'}">${oc ? esc(oc.name) : '—'}${mine ? ' (bạn)' : ''}</i></span>${mine ? '' : '<button class="btn small" data-take title="Nhận ca on-call">Nhận ca</button>'}</div>` +
      (rows || `<div class="pempty">Không có alert nào đang kêu.</div>`) +
      (open.length > 1 ? '<button class="btn small primary pall" data-ack="">Ack tất cả (V)</button>' : '');
  },
};

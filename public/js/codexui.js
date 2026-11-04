// Sổ tay Field Guide: nội dung mở khoá dần khi gặp / xây các thứ trong game.
import { G, $, $$, esc, hooks } from './state.js';
import { CODEX_COMPONENTS } from '/shared/codex_components.js';
import { CODEX_INCIDENTS } from '/shared/codex_incidents.js';

const ALL = [...CODEX_COMPONENTS, ...CODEX_INCIDENTS];
const BY_ID = new Map(ALL.map((e) => [e.id, e]));
const CATS = [
  { id: 'component', name: 'Component' },
  { id: 'incident', name: 'Sự cố' },
  { id: 'concept', name: 'Khái niệm' },
];

let root, open = false, cat = 'component', cur = null;

export const entryTitle = (id) => (BY_ID.get(id) ? BY_ID.get(id).title : null);

export const CodexUI = {
  init() {
    root = $('#codex');
    hooks.toggleCodex = () => CodexUI.toggle();
    hooks.openCodex = (id) => CodexUI.open(id);
    hooks.closeCodex = () => { if (!open) return false; CodexUI.toggle(); return true; };
    root.onclick = (ev) => {
      if (ev.target === root || ev.target.closest('[data-close]')) return CodexUI.toggle();
      const c = ev.target.closest('[data-cat]');
      if (c) { cat = c.dataset.cat; cur = null; return render(); }
      const e = ev.target.closest('[data-id]');
      if (e) { select(e.dataset.id); }
    };
  },
  toggle() {
    open = !open;
    root.hidden = !open;
    if (open) render();
  },
  open(id) {
    const e = BY_ID.get(id);
    if (!open) { open = true; root.hidden = false; }
    if (e) { cat = e.cat; select(id, true); } else render();
  },
};

function select(id, force) {
  const e = BY_ID.get(id);
  if (!e) return;
  if (!G.codex.has(id) && !force) { cur = id; return render(); }
  cat = e.cat;
  cur = id;
  G.newCodex.delete(id);
  render();
  const badge = document.querySelector('#toolbar u');
  if (badge) { badge.hidden = G.newCodex.size === 0; badge.textContent = G.newCodex.size; }
}

function render() {
  const list = ALL.filter((e) => e.cat === cat);
  const unlocked = ALL.filter((e) => G.codex.has(e.id)).length;
  if (!cur || !list.find((e) => e.id === cur)) cur = (list.find((e) => G.codex.has(e.id)) || list[0]).id;
  const e = BY_ID.get(cur);
  const has = G.codex.has(cur);
  root.innerHTML = `<div class="codexwin">
    <div class="cx-l">
      <div class="cx-h"><h2>Sổ tay</h2><small>${unlocked}/${ALL.length} mục đã mở khoá</small></div>
      <div class="cx-tabs">${CATS.map((c) => `<button class="${c.id === cat ? 'on' : ''}" data-cat="${c.id}">${c.name}</button>`).join('')}</div>
      <div class="cx-list">${list.map((x) => {
        const k = G.codex.has(x.id);
        return `<button class="${x.id === cur ? 'on' : ''} ${k ? '' : 'locked'}" data-id="${x.id}">${k ? esc(x.title) : '???'}${G.newCodex.has(x.id) ? '<u>mới</u>' : ''}</button>`;
      }).join('')}</div>
    </div>
    <div class="cx-r"><button class="xbtn" data-close>×</button>${has ? detail(e) : locked(e)}</div></div>`;
  const scroller = root.querySelector('.cx-r');
  if (scroller) scroller.scrollTop = 0;
}

function locked(e) {
  const how = e.cat === 'component' ? 'Xây hoặc chế tạo thứ này trong game để mở khoá.' : e.cat === 'incident' ? 'Sống sót qua sự cố này để mở khoá (hoặc diễn tập ở Chaos Lab sau khi đã gặp).' : 'Khái niệm này mở khoá khi bạn gặp tình huống liên quan, hoặc khi chỉnh cấu hình liên quan.';
  return `<div class="lockedbox"><h2>Chưa mở khoá</h2><p>${how}</p></div>`;
}

function detail(e) {
  const link = (id) => {
    const t = BY_ID.get(id);
    if (!t) return '';
    const k = G.codex.has(id);
    return `<button class="chip ${k ? '' : 'locked'}" data-id="${id}">${k ? esc(t.title) : '???'}</button>`;
  };
  let h = `<small class="cat">${CATS.find((c) => c.id === e.cat).name}</small><h2>${esc(e.title)}</h2><p class="lead">${esc(e.summary)}</p><div class="body">${e.body}</div>`;
  if (e.symptoms && e.symptoms.length) h += `<h4>Triệu chứng bạn sẽ thấy</h4><ul>${e.symptoms.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`;
  if (e.mitigations && e.mitigations.length) h += `<h4>Biện pháp &amp; đánh đổi</h4><table class="mit"><tbody>${e.mitigations.map((m) => `<tr><td><b>${esc(m.name)}</b></td><td>${esc(m.how)}</td><td class="tr">${esc(m.tradeoff)}</td></tr>`).join('')}</tbody></table>`;
  if ((e.pros && e.pros.length) || (e.cons && e.cons.length)) h += `<div class="pc"><div><h4>Ưu điểm</h4><ul>${(e.pros || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div><div><h4>Đánh đổi</h4><ul>${(e.cons || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div></div>`;
  if (e.real) h += `<div class="real"><b>Ngoài đời thật</b><p>${esc(e.real)}</p></div>`;
  if (e.tryIt) h += `<div class="tryit"><b>Thử trong game</b><p>${esc(e.tryIt)}</p></div>`;
  if (e.see && e.see.length) h += `<h4>Xem thêm</h4><div class="chips">${e.see.map(link).join('')}</div>`;
  return h;
}

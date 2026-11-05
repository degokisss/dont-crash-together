// HUD: chỉ số sinh tồn, đồng hồ, túi đồ, chế tạo, toast, chat, post-mortem, menu tạm dừng.
import { G, $, $$, esc, cmd, send, cancelMode, enterBuild, hooks } from './state.js';
import { iconURL } from './art.js';
import {
  ROLES, ITEMS, RECIPES, RECIPE_CATS, STRUCTS, RESOURCES, MOBS, STATION_NAME, STATION_R, SEASON_VI, SEASON_THEME,
  clockAt, INV_SLOTS, MAP_W, MAP_H, DAY_LEN, TILE, COMP,
} from '/shared/data.js';
import { entryTitle } from './codexui.js';

const el = {};
let lastInv = '', lastEq = '', lastPlayers = '', craftCat = 'tool', craftOpen = false, craftT = 0, miniT = 0, miniCache = null, miniSeason = '';
let pmQueue = [];

const iconImg = (key, size = 36, cls = '') => `<img class="ic ${cls}" width="${size}" height="${size}" src="${iconURL(key, size * 2)}" alt="">`;

export const HUD = {
  init() {
    for (const id of ['meters', 'players', 'clock', 'banner', 'usercard', 'cards', 'toasts', 'chatlog', 'chat-in', 'hotbar', 'equip', 'toolbar', 'craft', 'minimap', 'modebar', 'tip', 'modal', 'pause', 'goals']) el[id] = document.getElementById(id);
    el.meters.innerHTML = ['heart:hp:Máu', 'cup:hun:Năng lượng', 'brain:san:Tỉnh táo'].map((s) => {
      const [ic, k, label] = s.split(':');
      return `<div class="meter" data-k="${k}" title="${label}">${iconImg(ic, 26)}<div class="bar"><i></i></div><b>100</b></div>`;
    }).join('');
    el.toolbar.innerHTML = `
      <button data-a="craft" title="Chế tạo & xây (C)">${iconImg('hammer', 28)}<span>Xây</span></button>
      <button data-a="dash" title="Sơ đồ hệ thống & dashboard (M)">${iconImg('chart', 28)}<span>Sơ đồ</span></button>
      <button data-a="codex" title="Sổ tay Field Guide (K)">${iconImg('book', 28)}<span>Sổ tay</span><u hidden>0</u></button>`;
    el.toolbar.onclick = (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      if (b.dataset.a === 'craft') HUD.toggleCraft();
      else if (b.dataset.a === 'dash') hooks.toggleDash();
      else if (b.dataset.a === 'codex') hooks.toggleCodex();
    };
    // hotbar
    el.hotbar.innerHTML = Array.from({ length: INV_SLOTS }, (_, i) => `<button class="slot" data-i="${i}"><span class="k">${'1234567890-='[i]}</span><span class="c"></span><span class="n"></span><span class="dur"><i></i></span></button>`).join('');
    el.hotbar.onclick = (ev) => { const b = ev.target.closest('.slot'); if (b) HUD.useSlot(+b.dataset.i); };
    el.hotbar.oncontextmenu = (ev) => { ev.preventDefault(); const b = ev.target.closest('.slot'); if (b) cmd('drop', { slot: +b.dataset.i }); };
    el.hotbar.onmousemove = (ev) => {
      const b = ev.target.closest('.slot');
      const s = b && G.me() && G.me().inv[+b.dataset.i];
      if (s) HUD.itemTip(s, ev.clientX, ev.clientY); else HUD.tooltip(null);
    };
    el.hotbar.onmouseleave = () => HUD.tooltip(null);
    el.equip.onclick = (ev) => { const b = ev.target.closest('.eq'); if (b) cmd('unequip', { slot: b.dataset.s }); };
    el['chat-in'].onblur = () => el['chat-in'].classList.remove('open');
    // minimap
    el.minimap.onclick = () => { };
    hooks.modeChanged = () => HUD.modeChanged();
    hooks.showPostmortem = (pm) => HUD.showPostmortem(pm);
    el.modal.onclick = (ev) => { if (ev.target === el.modal || ev.target.closest('[data-close]')) HUD.closeModal(); const l = ev.target.closest('[data-codex]'); if (l) { HUD.closeModal(); hooks.openCodex(l.dataset.codex); } };
    el.cards.onclick = (ev) => {
      const c = ev.target.closest('.card');
      if (!c) return;
      if (ev.target.closest('[data-pm]')) { const pm = G.log.find((p) => p.uid === +ev.target.closest('[data-pm]').dataset.pm); if (pm) HUD.showPostmortem(pm); }
      if (ev.target.closest('[data-codex]')) hooks.openCodex(ev.target.closest('[data-codex]').dataset.codex);
      if (ev.target.closest('[data-x]') || ev.target.closest('[data-pm]')) c.remove();
    };
  },

  reset() {
    lastInv = lastEq = lastPlayers = '';
    el.toasts.innerHTML = ''; el.cards.innerHTML = ''; el.chatlog.innerHTML = ''; el.modal.hidden = true; el.pause.hidden = true;
    el.craft.hidden = true; craftOpen = false; el.banner.innerHTML = '';
  },

  onWelcome() {
    lastInv = lastEq = lastPlayers = '';
    el.modal.hidden = true;
    HUD.buildCraft();
    HUD.refreshCodexBadge();
    if (G.over) HUD.gameOver({ day: G.users });
  },

  disconnected() {
    el.modal.hidden = false;
    el.modal.innerHTML = `<div class="modal small"><h2>Mất kết nối</h2><p>Kết nối tới server đã bị ngắt. Thế giới vẫn được server lưu lại.</p><div class="row"><button class="btn primary" onclick="location.reload()">Kết nối lại</button><button class="btn" onclick="quitToMenuGlobal()">Về menu</button></div></div>`;
    window.quitToMenuGlobal = () => hooks.quit();
  },

  // ---------------------------------------------------------------- mỗi frame
  frame(dt) {
    const me = G.me();
    const clock = clockAt(G.time);
    if (me) {
      const set = (k, v) => { const m = el.meters.querySelector(`[data-k=${k}]`); m.querySelector('i').style.width = Math.max(0, v) + '%'; m.querySelector('b').textContent = Math.round(v); m.classList.toggle('low', v < 25); };
      set('hp', (me.hp / me.mhp) * 100);
      set('hun', me.hunger);
      set('san', me.sanity);
    }
    HUD.clock(clock);
    HUD.userCard();
    HUD.fakeAlerts(me, dt);
    HUD.inventory();
    HUD.playersList();
    craftT += dt; miniT += dt; HUD._gT = (HUD._gT || 0) + dt;
    if (HUD._gT > 1) { HUD._gT = 0; HUD.goals(); }
    if (craftOpen && craftT > 0.4) { craftT = 0; HUD.updateCraft(); }
    if (miniT > 0.4) { miniT = 0; HUD.minimap(clock); }
    document.body.classList.toggle('night', clock.dark > 0.5);
  },

  clock(clock) {
    const icon = clock.phase === 'day' ? 'sun' : clock.phase === 'dusk' ? 'dusk' : 'moon';
    const pct = (clock.t / DAY_LEN) * 100;
    let fuel = 0, gens = 0, comps = 0, mon = 0;
    for (const e of G.ents.values()) {
      if (e.k === 'generator') { fuel += e.fuel / e.mf; gens++; }
    }
    const fuelPct = gens ? Math.round((fuel / gens) * 100) : 0;
    const cx = G.sys ? G.sys.cx : 0;
    const key = `${clock.day}|${clock.season}|${clock.phase}|${Math.round(pct)}|${fuelPct}|${cx}|${gens}|${G.kp}`;
    if (key === HUD._clockKey) return;
    HUD._clockKey = key;
    const phaseVi = { day: 'Ban ngày — traffic bình thường', dusk: 'Hoàng hôn — giờ cao điểm, sắp tối', night: 'Ban đêm — Gremlin ra ngoài' }[clock.phase];
    el.clock.innerHTML = `
      <div class="ck-top">${iconImg(icon, 30)}<div><b>Ngày ${clock.day}</b> · ${SEASON_VI[clock.season]}<small>${SEASON_THEME[clock.season]}</small></div></div>
      <div class="daybar"><i style="width:${pct}%"></i><s style="left:${(80 / DAY_LEN) * 100}%"></s><s style="left:${(115 / DAY_LEN) * 100}%"></s></div>
      <div class="ck-sub"><span>${phaseVi}</span></div>
      <div class="ck-meta"><span class="${fuelPct < 30 ? 'bad' : ''}" title="Nhiên liệu trung bình của các máy phát điện">${iconImg('fire', 16)} ${fuelPct}%</span><span title="Độ phức tạp của hệ thống (ảnh hưởng tỉnh táo)">${iconImg('brain', 16)} ${cx}</span><span class="kpm" title="Điểm kiến thức: kiếm từ sổ tay và post-mortem, dùng để học công thức nâng cao (phím C)">${iconImg('book', 16)} ${G.kp} KP</span></div>`;
  },

  userCard() {
    const g = G.sys && G.sys.g;
    const me = G.me();
    const insane = !!(me && me.sanity < 30);
    const users = Math.round(G.users);
    const sat = g ? Math.round(g.sat) : 100;
    let detail;
    if (g && g.detail) {
      const nz = insane ? Math.sin(Math.floor(G.time) * 12.9898) * 43758.5453 % 1 * 0.18 : 0; // tỉnh táo thấp → số liệu "nhiễu"
      const okp = (Math.min(1, Math.max(0, g.ok + nz * 0.15)) * 100).toFixed(1);
      const p99 = g.p99 * (1 + nz), demand = Math.round(g.demand * (1 - nz));
      const bad = g.ok < 0.985 || g.p99 > 1500;
      detail = `<div class="kv ${g.ok < 0.985 ? 'bad' : 'good'}"><span>Thành công</span><b>${okp}%</b></div>
        <div class="kv ${g.p99 > 1500 ? 'bad' : 'good'}"><span>p99</span><b>${Math.round(p99)} ms</b></div>
        <div class="kv"><span>Tải</span><b>${demand} rps</b></div>
        <div class="slo ${bad ? 'bad' : 'good'}">${bad ? 'SLO đang vi phạm' : 'SLO đạt'}</div>`;
    } else {
      detail = `<div class="blind">Số liệu chi tiết bị che: Gateway nằm ngoài vùng Đèn giám sát (hoặc mất điện). Bạn chỉ thấy mức hài lòng của khách.</div>`;
    }
    const key = users + '|' + sat + '|' + (g ? (g.detail ? g.demand + '' + Math.round(g.p99) + g.ok.toFixed(3) : 'blind') : 'x') + '|' + (insane ? Math.floor(G.time) : 0);
    if (key === HUD._ucKey) return;
    HUD._ucKey = key;
    el.usercard.innerHTML = `
      <div class="uc-top">${iconImg('users', 22)}<b>${users}</b><span>người dùng</span></div>
      <div class="sat ${sat < 50 ? 'bad' : sat < 80 ? 'warn' : 'good'}"><span>Hài lòng</span><div class="bar"><i style="width:${sat}%"></i></div><b>${sat}%</b></div>
      ${detail}`;
  },

  inventory() {
    const me = G.me();
    if (!me) return;
    const inv = JSON.stringify(me.inv);
    if (inv !== lastInv) {
      lastInv = inv;
      $$('.slot', el.hotbar).forEach((b, i) => {
        const s = me.inv[i];
        b.classList.toggle('empty', !s);
        const c = b.querySelector('.c');
        if (!s) { c.innerHTML = ''; b.querySelector('.n').textContent = ''; b.querySelector('.dur').style.display = 'none'; return; }
        c.innerHTML = iconImg(s.i, 34);
        b.querySelector('.n').textContent = s.n > 1 ? s.n : '';
        const def = ITEMS[s.i];
        const d = b.querySelector('.dur');
        if (s.d !== undefined && def.dur) { d.style.display = 'block'; d.firstChild.style.width = Math.max(0, (s.d / def.dur) * 100) + '%'; } else d.style.display = 'none';
      });
    }
    const eq = JSON.stringify(me.eq);
    if (eq !== lastEq) {
      lastEq = eq;
      el.equip.innerHTML = ['hand:Tay', 'body:Áo'].map((x) => {
        const [k, label] = x.split(':');
        const s = me.eq[k];
        const def = s && ITEMS[s.i];
        return `<button class="eq ${s ? '' : 'empty'}" data-s="${k}" title="${label}${s ? ' — ' + def.name + ' (nhấp để cất)' : ''}"><span class="lbl">${label}</span>${s ? iconImg(s.i, 30) : ''}${s && def.dur ? `<span class="dur"><i style="width:${Math.max(0, (s.d / def.dur) * 100)}%"></i></span>` : ''}</button>`;
      }).join('');
    } else if (me.eq.hand || me.eq.body) {
      // cập nhật thanh độ bền liên tục (đèn pin cạn dần)
      $$('.eq', el.equip).forEach((b) => { const s = me.eq[b.dataset.s]; if (s && ITEMS[s.i].dur) { const i = b.querySelector('.dur i'); if (i) i.style.width = Math.max(0, (s.d / ITEMS[s.i].dur) * 100) + '%'; } });
    }
  },

  playersList() {
    const ps = [...G.ents.values()].filter((e) => e.k === 'player');
    const key = JSON.stringify(ps.map((p) => [p.id, p.name, Math.round(p.hp), p.ghost, p.role]));
    if (key === lastPlayers) return;
    lastPlayers = key;
    el.players.innerHTML = ps.length ? ps.map((p) => `<div class="pl ${p.id === G.meId ? 'me' : ''} ${p.ghost ? 'ghost' : ''}"><i style="background:hsl(${p.hue} 60% 55%)"></i>${esc(p.name)} <small title="${ROLES[p.role] ? esc(ROLES[p.role].desc) : ''}">${ROLES[p.role] ? ROLES[p.role].name : ''}</small><div class="bar"><u style="width:${(p.hp / p.mhp) * 100}%"></u></div></div>`).join('') : '';
  },

  // ---------------------------------------------------------------- túi đồ
  useSlot(i) {
    const me = G.me();
    if (!me || me.ghost) return;
    if (G.chestOpen) { cmd('deposit', { id: G.chestOpen, slot: i }); return; }
    cmd('use', { slot: i });
  },

  itemTip(s, x, y) {
    const def = ITEMS[s.i];
    let extra = '';
    if (def.food) extra = `<div>Đói +${def.food.hunger}${def.food.sanity ? ` · Tỉnh táo ${def.food.sanity > 0 ? '+' : ''}${def.food.sanity}` : ''}</div><div class="hint">Nhấp để ăn</div>`;
    else if (def.slot) extra = `<div class="hint">Nhấp để trang bị${def.dur ? ` · độ bền ${Math.round(s.d ?? def.dur)}/${def.dur}` : ''}</div>`;
    else if (def.fuel) extra = `<div>Nhiên liệu +${def.fuel}</div><div class="hint">Nạp vào máy phát điện</div>`;
    HUD.showTip(`<b>${def.name}</b><div>${def.desc}</div>${extra}`, x, y);
  },

  tooltip(e, x, y) {
    if (!e) { el.tip.hidden = true; return; }
    let html = '';
    if (RESOURCES[e.k]) {
      const R = RESOURCES[e.k];
      html = `<b>${R.name}</b>${!e.ready ? '<div class="hint">Đang mọc lại…</div>' : R.tool ? `<div class="hint">Cần ${R.tool === 'chop' ? 'Tua vít điện' : 'Máy khoan wafer'}</div>` : '<div class="hint">Nhấp để thu thập</div>'}`;
    } else if (STRUCTS[e.k]) {
      html = `<b>${STRUCTS[e.k].name}</b><div class="hint">Nhấp để mở bảng điều khiển</div>`;
    } else if (MOBS[e.k]) {
      html = `<b>${MOBS[e.k].name}</b><div>HP ${Math.max(0, Math.round(e.hp))}/${e.mhp}</div><div class="hint">Nhấp / Space để tấn công</div>`;
    } else if (e.k === 'item') {
      html = `<b>${ITEMS[e.item].name}</b> ×${e.n}<div class="hint">Nhấp để nhặt</div>`;
    } else { el.tip.hidden = true; return; }
    HUD.showTip(html, x, y);
  },

  showTip(html, x, y) {
    el.tip.innerHTML = html;
    el.tip.hidden = false;
    el.tip.style.left = Math.min(window.innerWidth - 240, x + 16) + 'px';
    el.tip.style.top = Math.min(window.innerHeight - 90, y + 16) + 'px';
  },

  // ---------------------------------------------------------------- chế tạo
  toggleCraft() {
    craftOpen = !craftOpen;
    el.craft.hidden = !craftOpen;
    if (craftOpen) { HUD.buildCraft(); HUD.updateCraft(); }
  },

  buildCraft() {
    const tabs = RECIPE_CATS.map((c) => `<button class="tab ${c.id === craftCat ? 'on' : ''}" data-c="${c.id}">${c.name}</button>`).join('');
    const rows = RECIPES.filter((r) => r.cat === craftCat).map((r) => {
      const key = r.place || r.out.item;
      const ing = Object.entries(r.ing).map(([k, n]) => `<span class="ing" data-i="${k}" data-n="${n}">${iconImg(k, 18)}<b>${n}</b></span>`).join('');
      const un = r.kp && !G.learned.has(r.id);
      return `<div class="rec ${un ? 'unlearned' : ''}" data-id="${r.id}"><div class="rc-ic">${iconImg(key, 40)}</div><div class="rc-b"><div class="rc-n">${r.name}${un ? `<span class="kpb">Học: ${r.kp} KP</span>` : ''}<span class="stn" data-s="${r.station}">${r.station ? STATION_NAME[r.station] : ''}</span></div><div class="ings">${ing}</div></div></div>`;
    }).join('');
    el.craft.innerHTML = `<div class="ph"><b>Chế tạo & xây dựng</b><span class="kphead" title="Điểm kiến thức">${G.kp} KP</span><button data-x>×</button></div><div class="tabs">${tabs}</div><div class="rlist">${rows}</div><div class="rfoot">Đứng gần <b>Bảng trắng</b> / <b>Phòng lab</b> để mở công thức. Giữ Shift để đặt liên tiếp.</div>`;
    el.craft.onclick = (ev) => {
      if (ev.target.closest('[data-x]')) return HUD.toggleCraft();
      const t = ev.target.closest('.tab');
      if (t) { craftCat = t.dataset.c; HUD.buildCraft(); HUD.updateCraft(); return; }
      const r = ev.target.closest('.rec');
      if (!r) return;
      const rec = RECIPES.find((x) => x.id === r.dataset.id);
      if (r.classList.contains('unlearned')) {
        if (G.kp >= rec.kp) cmd('learn', { id: rec.id });
        else HUD.toast(`Cần ${rec.kp} Điểm kiến thức (bạn có ${G.kp}). Kiếm thêm từ post-mortem và sổ tay.`, 'warn');
        return;
      }
      if (r.classList.contains('locked')) return HUD.toast(r.classList.contains('nostation') ? `Cần đứng gần ${STATION_NAME[rec.station]}.` : 'Thiếu nguyên liệu.', 'warn');
      if (rec.place) { enterBuild(rec); el.craft.hidden = true; craftOpen = false; }
      else cmd('craft', { id: rec.id });
    };
    el.craft.onmousemove = (ev) => {
      const r = ev.target.closest('.rec');
      if (!r) return HUD.tooltip(null);
      const rec = RECIPES.find((x) => x.id === r.dataset.id);
      const S = rec.place ? STRUCTS[rec.place] : null;
      const def = rec.out ? ITEMS[rec.out.item] : null;
      const cid = rec.place && (COMP[rec.place] || ['generator', 'lantern', 'turret'].includes(rec.place)) ? 'comp-' + rec.place : null;
      HUD.showTip(`<b>${rec.name}</b><div>${def ? def.desc : S ? (cid && G.codex.has(cid) ? 'Xem chi tiết trong Sổ tay.' : 'Công trình — đặt bằng chuột.') : ''}</div>`, ev.clientX - 260, ev.clientY);
    };
    el.craft.onmouseleave = () => HUD.tooltip(null);
  },

  updateCraft() {
    const me = G.me();
    if (!me) return;
    const have = {};
    for (const s of me.inv) if (s) have[s.i] = (have[s.i] || 0) + s.n;
    $$('.rec', el.craft).forEach((r) => {
      const rec = RECIPES.find((x) => x.id === r.dataset.id);
      const stn = window.hasStationNear(rec.station);
      let ok = true;
      $$('.ing', r).forEach((g) => { const e = (have[g.dataset.i] || 0) >= +g.dataset.n; g.classList.toggle('miss', !e); if (!e) ok = false; });
      r.classList.toggle('nostation', !stn);
      r.classList.toggle('locked', !r.classList.contains('unlearned') && (!stn || !ok));
      const s = r.querySelector('.stn');
      if (s) s.classList.toggle('ok', stn);
    });
  },

  // ---------------------------------------------------------------- chế độ con trỏ
  modeChanged() {
    if (G.mode === 'build') { el.modebar.hidden = false; el.modebar.innerHTML = `Đặt <b>${G.build.name}</b> — chuột trái để đặt (Shift: đặt liên tiếp) · chuột phải / Esc để hủy`; }
    else if (G.mode === 'link') { el.modebar.hidden = false; el.modebar.innerHTML = `Nối cáp: chọn component <b>đích</b> — mỗi 2 ô cần 1 Cáp mạng · Esc để dừng`; }
    else el.modebar.hidden = true;
    document.body.classList.toggle('mode-build', G.mode === 'build');
    document.body.classList.toggle('mode-link', G.mode === 'link');
  },

  // ---------------------------------------------------------------- thông báo
  toast(msg, kind = 'info') {
    const d = document.createElement('div');
    d.className = 'toast ' + kind;
    d.textContent = msg;
    el.toasts.appendChild(d);
    while (el.toasts.children.length > 5) el.toasts.firstChild.remove();
    setTimeout(() => d.classList.add('out'), 5500);
    setTimeout(() => d.remove(), 6200);
  },

  tip(msg, codex = [], kind = 'tip') {
    const d = document.createElement('div');
    d.className = 'card tipcard';
    const links = (codex || []).filter((c) => entryTitle(c)).slice(0, 3).map((c) => `<button class="chip" data-codex="${c}">${esc(entryTitle(c))}</button>`).join('');
    d.innerHTML = `<div class="ct">Gợi ý của cố vấn</div><p>${esc(msg)}</p><div class="chips">${links}</div><button class="x" data-x>×</button>`;
    el.cards.appendChild(d);
    setTimeout(() => d.remove(), 40000);
  },

  codexNew(id) {
    HUD.refreshCodexBadge();
    const t = entryTitle(id);
    if (t) HUD.toast(`Sổ tay: mở khoá "${t}"`, 'codex');
  },

  refreshCodexBadge() {
    const u = el.toolbar.querySelector('u');
    if (!u) return;
    u.hidden = G.newCodex.size === 0;
    u.textContent = G.newCodex.size;
  },

  chat(ev) {
    const d = document.createElement('div');
    d.innerHTML = `<b style="color:hsl(${ev.hue} 70% 70%)">${esc(ev.from)}:</b> ${esc(ev.text)}`;
    el.chatlog.appendChild(d);
    while (el.chatlog.children.length > 6) el.chatlog.firstChild.remove();
    setTimeout(() => d.remove(), 20000);
  },
  focusChat() { el['chat-in'].classList.add('open'); el['chat-in'].focus(); },
  sendChat() { const v = el['chat-in'].value.trim(); if (v) cmd('chat', { text: v }); el['chat-in'].value = ''; el['chat-in'].blur(); },

  incident(ev) {
    if (ev.phase === 'start') {
      G.incidents.set(ev.id, ev);
      HUD.toast(`${ev.drill ? 'Game day' : 'Sự cố'}: ${ev.name}`, ev.drill ? 'info' : 'bad');
    } else G.incidents.delete(ev.id);
    el.banner.innerHTML = [...G.incidents.values()].map((i) => `<div class="inc ${i.drill ? 'drill' : ''}">${i.drill ? 'GAME DAY' : 'SỰ CỐ'} · ${esc(i.name)}</div>`).join('');
  },

  dayReport(r) {
    const d = document.createElement('div');
    d.className = 'card daycard ' + r.verdict;
    const diff = r.users - r.users0;
    d.innerHTML = `<div class="ct">Báo cáo ngày ${r.day}</div>
      <div class="dr"><div><span>SLO đạt</span><b>${r.slo}%</b></div><div><span>Người dùng</span><b>${r.users0} → ${r.users} <i class="${diff >= 0 ? 'good' : 'bad'}">${diff >= 0 ? '+' : ''}${diff}</i></b></div></div>
      <p>${r.verdict === 'good' ? 'Hệ thống ổn định: người dùng tăng trưởng.' : r.verdict === 'ok' ? 'SLO tạm ổn. Người dùng không tăng.' : 'SLO bị vi phạm nhiều: người dùng bỏ đi.'}</p>
      ${r.incidents.length ? `<div class="mini">Sự cố: ${r.incidents.map(esc).join(', ')}</div>` : ''}<button class="x" data-x>×</button>`;
    el.cards.appendChild(d);
    setTimeout(() => d.remove(), 16000);
  },

  postmortem(pm) {
    const d = document.createElement('div');
    d.className = 'card pmcard';
    d.innerHTML = `<div class="ct">Post-mortem sẵn sàng</div><p><b>${esc(pm.name)}</b> — ${pm.checks.filter((c) => c.ok).length}/${pm.checks.length} biện pháp phòng thủ đã có.</p><div class="chips"><button class="chip primary" data-pm="${pm.uid}">Xem phân tích</button></div><button class="x" data-x>×</button>`;
    el.cards.appendChild(d);
    setTimeout(() => d.remove(), 60000);
  },

  showPostmortem(pm) {
    const good = pm.checks.filter((c) => c.ok).length;
    el.modal.hidden = false;
    el.modal.innerHTML = `<div class="modal pm">
      <div class="mh"><div><small>${pm.drill ? 'Game day' : 'Post-mortem'} · Ngày ${pm.day}</small><h2>${esc(pm.name)}</h2></div><button data-close class="xbtn">×</button></div>
      <div class="impact">
        <div><span>Thời gian</span><b>${pm.dur}s</b></div>
        <div><span>Lỗi đỉnh</span><b class="${pm.impact.peakErr > 15 ? 'bad' : ''}">${pm.impact.peakErr}%</b></div>
        <div><span>p99 đỉnh</span><b class="${pm.impact.peakP99 > 1500 ? 'bad' : ''}">${pm.impact.peakP99} ms</b></div>
        <div><span>Vi phạm SLO</span><b>${pm.impact.badSec}s</b></div>
        <div><span>Hài lòng thấp nhất</span><b>${pm.impact.minSat}%</b></div>
        ${pm.impact.mttd === undefined ? '' : `<div><span>Phát hiện (MTTD)</span><b class="${pm.impact.mttd == null ? 'bad' : ''}">${pm.impact.mttd == null ? 'không alert' : pm.impact.mttd + 's'}</b></div><div><span>Nhận alert (MTTA)</span><b class="${pm.impact.mtta == null ? 'bad' : ''}">${pm.impact.mtta == null ? '—' : pm.impact.mtta + 's'}</b></div>`}
        <div><span>Người dùng</span><b class="${pm.impact.users < 0 ? 'bad' : ''}">${pm.impact.users >= 0 ? '+' : ''}${pm.impact.users}</b></div>
      </div>
      <h3>Kiến trúc của bạn lúc đó (${good}/${pm.checks.length} đạt)</h3>
      <ul class="checks">${pm.checks.map((c) => `<li class="${c.ok ? 'ok' : 'no'}"><i>${c.ok ? '✓' : '✗'}</i><div><b>${esc(c.t)}</b><p>${esc(c.d)}</p></div></li>`).join('')}</ul>
      <div class="lesson"><b>Bài học:</b> ${esc(pm.lesson)}</div>
      ${pm.kp ? `<div class="kpgain">+${pm.kp} Điểm kiến thức${pm.drill ? ' (game day: chỉ thưởng lần đầu mỗi loại)' : ''}</div>` : ''}
      <div class="chips">${pm.codex.map((c) => entryTitle(c) ? `<button class="chip" data-codex="${c}">${esc(entryTitle(c))}</button>` : '').join('')}</div>
      <div class="row"><button class="btn" data-close>Đóng</button></div></div>`;
  },

  gameOver(ev) {
    el.modal.hidden = false;
    el.modal.innerHTML = `<div class="modal small over"><h2>Công ty phá sản</h2>
      <p>Người dùng đã bỏ đi hết. Bạn đã sống sót tới <b>ngày ${ev.day}</b>${ev.peak ? `, đỉnh <b>${ev.peak}</b> người dùng` : ''}.</p>
      <p>Xem lại <b>Nhật ký post-mortem</b> trong Sơ đồ (M) để biết điều gì đã làm bạn sập — rồi thử lại với kiến trúc tốt hơn.</p>
      <div class="row"><button class="btn primary" id="newgame">Thế giới mới</button><button class="btn" data-close>Xem lại hệ thống</button><button class="btn" id="tomenu">Về menu</button></div></div>`;
    $('#newgame').onclick = () => { cmd('newgame'); HUD.closeModal(); };
    $('#tomenu').onclick = () => hooks.quit();
  },

  victory(ev) {
    el.modal.hidden = false;
    el.modal.innerHTML = `<div class="modal small win"><h2>Bạn đã sống sót một năm!</h2>
      <p>Bốn mùa trôi qua, hệ thống vẫn đứng vững với <b>${ev.users}</b> người dùng. Game tiếp tục chế độ vô tận — tải sẽ còn tăng.</p>
      <div class="row"><button class="btn primary" data-close>Tiếp tục</button></div></div>`;
  },

  kpChanged(ev) {
    HUD._clockKey = '';
    if (el.craft) { HUD.buildCraft(); if (craftOpen) HUD.updateCraft(); }
    if (ev.gain && ev.why === 'pm') HUD.toast(`+${ev.gain} Điểm kiến thức từ post-mortem`, 'codex');
  },

  closeModal() { el.modal.hidden = true; el.modal.innerHTML = ''; },

  // Tỉnh táo thấp → "cảnh báo giả" (alert fatigue): báo động rồi tự nhận là báo sai
  fakeAlerts(me, dt) {
    if (!me || me.ghost || me.sanity >= 22) return;
    HUD._fakeT = (HUD._fakeT || 12) - dt;
    if (HUD._fakeT > 0) return;
    HUD._fakeT = 20 + Math.random() * 15;
    const msgs = ['CẢNH BÁO: p99 vượt ngưỡng trên mọi node!', 'CẢNH BÁO: DB replication lag = 48 s!', 'CẢNH BÁO: nhiều node mất kết nối!', 'CẢNH BÁO: tỉ lệ lỗi 40%!'];
    HUD.toast(msgs[Math.floor(Math.random() * msgs.length)], 'bad');
    setTimeout(() => HUD.toast('…bạn kiểm tra lại: báo động giả. Quá tải nhận thức làm bạn thấy những thứ không có (alert fatigue).', 'warn'), 4500);
  },

  // ---------------------------------------------------------------- mục tiêu hướng dẫn
  goals() {
    const me = G.me();
    if (!me) return;
    const ents = [...G.ents.values()];
    const of = (k) => ents.filter((e) => e.k === k);
    const has = (id) => me.inv.some((s) => s && s.i === id) || (me.eq.hand && me.eq.hand.i === id);
    for (const g of of('generator')) G._maxFuel = Math.max(G._maxFuel || 0, g.fuel);
    const apps = of('app'), lbs = of('lb'), gw = of('gateway')[0];
    const clock = clockAt(G.time);
    const comps = ents.filter((e) => COMP[e.k]);
    const GOALS = [
      ['Chế tạo Tua vít điện và Máy khoan wafer (phím C) rồi thu thập tài nguyên', () => has('axe') && has('pickaxe')],
      ['Nạp nhiên liệu cho máy phát điện (nhấp vào máy phát)', () => (G._maxFuel || 0) > 175],
      ['Dựng App thứ hai + Load Balancer, nối Gateway → LB → các App', () => apps.length >= 2 && lbs.some((l) => l.links.length >= 2) && gw && lbs.some((l) => gw.links.includes(l.id))],
      ['Dựng Phòng lab kiến trúc (để chế Cache, Queue, CDN, Replica)', () => of('archlab').length > 0],
      ['Học công thức đầu tiên bằng Điểm kiến thức (bảng Xây, phím C)', () => G.learned.size > 0],
      ['Thêm Cache giữa App và Database', () => of('cache').some((c) => apps.some((a) => a.links.includes(c.id)))],
      ['Phủ Đèn giám sát lên mọi component (hết dấu "?")', () => comps.length > 0 && G.sys && comps.every((c) => G.sys.n[c.id])],
      ['Sống sót qua sự cố đầu tiên và đọc post-mortem', () => G.log.length >= 1],
      ['Thêm Read Replica và bật Failover cho DB', () => of('replica').length > 0 && of('db').some((d) => d.cfg.failover !== 'off')],
      ['Đạt 100 người dùng', () => G.users >= 100],
      ['Mở Sơ đồ (M) và theo dõi một request đi qua hệ thống', () => !!G.trace],
      ['Sống sót một năm (16 ngày)', () => clock.day > 16],
    ];
    const done = GOALS.filter(([, f]) => f()).length;
    const next = GOALS.filter(([, f]) => !f()).slice(0, 3);
    const key = done + '|' + next.map((n) => n[0]).join('|');
    if (key === HUD._goalKey) return;
    HUD._goalKey = key;
    el.goals.innerHTML = `<div class="gh"><b>Mục tiêu</b><span>${done}/${GOALS.length}</span></div>` + (next.length ? next.map(([t]) => `<div class="g"><i></i>${t}</div>`).join('') : '<div class="g done">Bạn đã hoàn thành mọi mục tiêu!</div>');
  },

  // ---------------------------------------------------------------- menu tạm dừng
  toggleMenu() {
    if (!el.pause.hidden) { el.pause.hidden = true; return; }
    el.pause.hidden = false;
    el.pause.innerHTML = `<div class="modal small"><h2>Tạm dừng</h2>
      <p class="mini">${G.solo ? 'Chế độ solo (chạy trong Web Worker trên trình duyệt).' : `Phòng <b>${esc(G.room)}</b> · ping ${G.ping}ms · server authoritative.`}</p>
      <div class="row col"><button class="btn primary" id="p-resume">Tiếp tục</button><button class="btn" id="p-save">Lưu thế giới</button><button class="btn" id="p-menu">Về menu</button></div>
      <p class="mini">WASD di chuyển · Space đánh · E nhặt · C xây · M sơ đồ · K sổ tay</p></div>`;
    $('#p-resume').onclick = () => { el.pause.hidden = true; };
    $('#p-save').onclick = () => { if (G.net && G.net.save) G.net.save(); HUD.toast('Đã lưu.', 'good'); };
    $('#p-menu').onclick = () => { el.pause.hidden = true; hooks.quit(); };
  },

  closeTop() {
    if (!el.modal.hidden) { HUD.closeModal(); return true; }
    if (!el.pause.hidden) { el.pause.hidden = true; return true; }
    if (hooks.closeCodex && hooks.closeCodex()) return true;
    if (hooks.closeDash && hooks.closeDash()) return true;
    if (G.selected) { hooks.closeInspector(); return true; }
    if (craftOpen) { HUD.toggleCraft(); return true; }
    if (G.mode !== 'none') { cancelMode(); return true; }
    return false;
  },

  // ---------------------------------------------------------------- minimap
  minimap(clock) {
    const cv = el.minimap.querySelector('canvas');
    const c = cv.getContext('2d');
    const S = cv.width / MAP_W;
    if (!G.tiles) return;
    if (!miniCache || miniSeason !== clock.season || miniCache.seed !== G.seed) {
      miniSeason = clock.season;
      const oc = document.createElement('canvas');
      oc.width = cv.width; oc.height = cv.height;
      const o = oc.getContext('2d');
      const col = { 0: '#0c0a12', 1: '#5d7a3a', 2: '#34552d', 3: '#6d675d', 4: '#3b4a3b' };
      if (clock.season === 'winter') Object.assign(col, { 1: '#b7c5cd', 2: '#8da2a8', 3: '#9ba2a8', 4: '#76878a' });
      for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) { o.fillStyle = col[G.tiles[y * MAP_W + x]]; o.fillRect(x * S, y * S, S + 0.5, S + 0.5); }
      miniCache = oc; miniCache.seed = G.seed;
    }
    c.clearRect(0, 0, cv.width, cv.height);
    c.drawImage(miniCache, 0, 0);
    for (const e of G.ents.values()) {
      let col = null, r = 2;
      if (e.k === 'player') { col = `hsl(${e.hue} 80% 65%)`; r = e.id === G.meId ? 3.5 : 2.5; }
      else if (STRUCTS[e.k]) { col = COMP[e.k] ? (e.crashed ? '#ff5a4a' : '#7fe0ff') : e.k === 'generator' ? '#ffb347' : '#e8dcc0'; r = 2.2; }
      else if (e.k === 'bot' || e.k === 'gremlin') { col = '#ff4a4a'; r = 1.8; }
      if (!col) continue;
      c.fillStyle = col;
      c.beginPath(); c.arc((e.x / TILE) * S, (e.y / TILE) * S, r, 0, 7); c.fill();
    }
  },
};

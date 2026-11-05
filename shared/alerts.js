// Cảnh báo & on-call: Đèn giám sát đánh giá số liệu node nằm trong vùng của nó theo ngưỡng của mức alert đang chọn.
// Mỗi cặp (quy tắc, node) là một máy trạng thái ok -> pending -> firing -> acked, giữ trong một registry duy nhất.
// Chỉ node trong vùng giám sát mới có số liệu (flow.view.n), nên node ngoài vùng không bao giờ page được.
import { ALERT, ALERT_RULES, ONCALL, STRUCTS } from './data.js';
import { clamp, round1 } from './util.js';

const LEVELS = Object.keys(ALERT); // off, rồi từ nhạy tới chặt: chỉ số nhỏ = nhạy hơn

const blank = (key, rule, node) => ({
  key, rule, node, state: 'ok', since: 0, val: 0, firedAt: null, escAt: null, esc: false,
  ackedAt: null, by: null, clearSince: null, quiet: false, fake: false, inc: null,
});

export class Alerts {
  constructor(w) {
    this.w = w;
    this.reg = new Map(); // `${rule}:${nodeId}` -> alert
    this.oncall = null; // pid; pid không bền qua lần tải nên lưu kèm token
    this.oncallToken = null;
    this.stats = { pages: 0, falsePages: 0, acked: 0, ackSecs: 0, escalations: 0 };
    this.falseSince = 0; // báo động giả kể từ lúc sự cố gần nhất kết thúc (đưa vào post-mortem)
  }

  toSave() {
    return {
      oncallToken: this.oncallToken, stats: this.stats, falseSince: this.falseSince,
      reg: [...this.reg.values()].filter((a) => a.state !== 'ok'),
    };
  }

  load(s) {
    if (!s) return;
    this.oncallToken = s.oncallToken ?? null;
    this.stats = { ...this.stats, ...s.stats };
    this.falseSince = s.falseSince || 0;
    for (const a of s.reg || []) this.reg.set(a.key, { ...blank(a.key, a.rule, a.node), ...a });
  }

  // ---------- mức alert hiệu lực tại một vị trí ----------
  // Node nằm trong nhiều vùng: lấy đèn nhạy nhất đang bật alert. null = không đèn nào phủ hoặc đều Tắt.
  levelAt(x, y) {
    let best = -1;
    for (const l of this.w.monitors) {
      const i = LEVELS.indexOf(l.alert);
      if (i > 0 && (best < 0 || i < best) && (x - l.x) ** 2 + (y - l.y) ** 2 < l.r * l.r) best = i;
    }
    return best < 0 ? null : LEVELS[best];
  }

  // Ảnh chụp lúc sự cố bắt đầu để post-mortem giải thích vì sao có/không có alert (node null = sự cố không nhắm node nào)
  snapshot(node) {
    const w = this.w;
    if (node) return { level: this.levelAt(node.x, node.y), covered: w.isMonitored(node.x, node.y) };
    let best = null, covered = false;
    for (const s of w.structs) {
      if (!STRUCTS[s.k].comp || !w.isMonitored(s.x, s.y)) continue;
      covered = true;
      const lv = this.levelAt(s.x, s.y);
      if (lv && (!best || LEVELS.indexOf(lv) < LEVELS.indexOf(best))) best = lv;
    }
    return { level: best, covered };
  }

  // ---------- đánh giá (gọi sau mỗi bước flow, tức mỗi 0.5 s) ----------
  step() {
    const w = this.w, v = w.flow.view;
    if (!v) return;
    if (!w.players.has(this.oncall)) this.pickOncall();
    const seen = new Set();
    for (const id in v.n) {
      const node = w.ents.get(+id);
      const lv = node && this.levelAt(node.x, node.y);
      if (!lv) continue;
      const L = ALERT[lv];
      for (const rule in ALERT_RULES) {
        const val = ALERT_RULES[rule].metric(v.n[id]);
        if (val === undefined) continue;
        const key = rule + ':' + id;
        seen.add(key);
        let a = this.reg.get(key);
        if (!a) this.reg.set(key, a = blank(key, rule, node.id));
        a.val = val;
        this.advance(a, !node.rb && val >= L[rule], L); // đang reboot là bảo trì, không phải sự cố
      }
    }
    // node biến mất khỏi tầm nhìn (đèn tắt/mất điện/đổi mức Tắt/bị tháo): alert đóng vì mù, không phải vì sự cố đã hết
    for (const [key, a] of this.reg) {
      if (seen.has(key)) continue;
      this.reg.delete(key);
      if ((a.state === 'firing' || a.state === 'acked') && !this.active(a.node)) this.tell(`Alert ở ${this.nodeName(a.node)} đóng vì node ra khỏi tầm giám sát: bạn không còn thấy nó, không phải vì nó đã hết lỗi.`, 'warn');
    }
    this.escalate();
    v.al = this.view();
  }

  advance(a, breached, L) {
    const now = this.w.time;
    switch (a.state) {
      case 'ok':
        if (breached) { a.state = 'pending'; a.since = now; }
        break;
      case 'pending':
        if (!breached) a.state = 'ok';
        else if (now - a.since >= L.for) this.fire(a);
        break;
      default: // firing | acked
        if (breached) a.clearSince = null;
        else if (a.clearSince === null) a.clearSince = now;
        else if (now - a.clearSince >= ONCALL.clear) this.resolve(a);
    }
  }

  fire(a) {
    const w = this.w, now = w.time;
    const crit = ALERT_RULES[a.rule].sev === 'crit';
    // alert nặng hơn mức đã page ở node này (warn -> crit) phải page lại; còn lại gộp vào page cũ
    const sib = [...this.reg.values()].find((o) => o !== a && o.node === a.node && (o.state === 'firing' || o.state === 'acked') && (!crit || ALERT_RULES[o.rule].sev === 'crit'));
    const inc = this.incidentFor(a.node);
    a.firedAt = now;
    a.clearSince = null;
    a.inc = inc ? inc.uid : null;
    if (inc && inc.detectedAt === undefined) { inc.detectedAt = now; inc.alertRule = a.rule; }
    w.unlock('concept-alerting');
    if (sib) { // cùng node đã page rồi: gộp vào, dùng chung trạng thái ack/escalate, không page thêm
      Object.assign(a, { state: sib.state, quiet: true, escAt: sib.escAt, esc: sib.esc, ackedAt: sib.ackedAt, by: sib.by, fake: sib.fake });
      return;
    }
    a.state = 'firing';
    a.escAt = now + ONCALL.ack;
    a.esc = false;
    a.ackedAt = null;
    a.quiet = false;
    a.fake = !inc && !!w.flow.g && w.flow.g.slo; // không sự cố nào và SLO vẫn đạt: page vô ích
    this.stats.pages++;
    if (a.fake) {
      this.stats.falsePages++;
      this.falseSince++;
      this.drain(this.oncall, ONCALL.falseSanity);
    }
    this.page(a, false);
  }

  resolve(a) {
    const { node, fake, quiet } = a;
    Object.assign(a, blank(a.key, a.rule, a.node));
    if (this.active(node)) return;
    if (!quiet && fake) this.tell(`Alert ở ${this.nodeName(node)} tự hết mà không có sự cố nào: đó là báo động giả (mất ${ONCALL.falseSanity} tỉnh táo của người trực). Ngưỡng quá nhạy.`, 'warn');
    else this.tell(`Alert ở ${this.nodeName(node)} đã hết.`, 'good');
  }

  incidentFor(nodeId) {
    const act = this.w.director.active;
    return act.find((i) => i.target === nodeId) || act[0] || null;
  }

  // ---------- nhóm theo node: một node chỉ page một lần dù nhiều quy tắc cùng vi phạm ----------
  active(node) { for (const a of this.reg.values()) if (a.node === node && (a.state === 'firing' || a.state === 'acked')) return true; return false; }

  groups() {
    const by = new Map();
    for (const a of this.reg.values()) {
      if (a.state !== 'firing' && a.state !== 'acked') continue;
      let g = by.get(a.node);
      if (!g) by.set(a.node, g = { node: a.node, alerts: [] });
      g.alerts.push(a);
    }
    const out = [...by.values()];
    for (const g of out) {
      g.alerts.sort((x, y) => x.firedAt - y.firedAt);
      g.lead = g.alerts.find((a) => a.state === 'firing') || g.alerts[0]; // page chưa ack mới nhất quyết định đồng hồ escalate
      g.state = g.alerts.some((a) => a.state === 'firing') ? 'firing' : 'acked';
    }
    return out.sort((x, y) => x.lead.firedAt - y.lead.firedAt);
  }

  nodeName(id) {
    const n = this.w.ents.get(id);
    return n ? `${STRUCTS[n.k].name} #${id}` : `node #${id}`;
  }

  text(g) {
    return g.alerts.map((a) => `${ALERT_RULES[a.rule].name} ${ALERT_RULES[a.rule].fmt(a.val)}`).join(', ') + ' ở ' + this.nodeName(g.node);
  }

  // ---------- on-call ----------
  onlineSorted() { return [...this.w.players.values()].filter((p) => !p.ghost).sort((a, b) => a.pid - b.pid); }
  oncallName() { const p = this.w.players.get(this.oncall); return p ? p.name : '(chưa ai)'; }

  pickOncall() {
    const ps = this.onlineSorted();
    const p = ps.find((q) => this.oncallToken && q._token === this.oncallToken) || ps[0] || [...this.w.players.values()][0];
    const changed = this.oncall !== null && p;
    this.oncall = p ? p.pid : null;
    this.oncallToken = p ? p._token ?? null : null;
    if (changed) this.w.say(`${p.name} giờ là người on-call.`, 'info');
  }

  // Giao ca: người mới nhận các alert chưa ack với một cửa sổ ack mới, và bị page lại.
  handover(p) {
    const now = this.w.time;
    this.oncall = p.pid;
    this.oncallToken = p._token ?? null;
    for (const g of this.groups()) {
      if (g.state !== 'firing' || g.lead.esc) continue;
      for (const a of g.alerts) a.escAt = now + ONCALL.ack;
      this.page(g.lead, true, g);
    }
  }

  rotate() {
    const ps = this.onlineSorted();
    if (ps.length < 2) return;
    const next = ps[(ps.findIndex((p) => p.pid === this.oncall) + 1) % ps.length];
    this.handover(next);
    this.w.say(`Ngày mới, ca trực mới: ${next.name} là người on-call.`, 'info');
  }

  take(p) {
    if (p.pid === this.oncall) return this.w.say('Bạn đang là người on-call rồi.', 'info', p.pid);
    this.handover(p);
    this.w.say(`${p.name} nhận ca on-call.`, 'info');
  }

  // ---------- page / ack / escalate ----------
  page(a, again, g = this.groups().find((x) => x.node === a.node)) {
    const w = this.w;
    const sev = g.alerts.some((x) => ALERT_RULES[x.rule].sev === 'crit') ? 'CRIT' : 'WARN';
    for (const p of w.players.values()) {
      if (p.pid === this.oncall) w.say(`PAGE ${sev}${again ? ' (giao ca)' : ''}: ${this.text(g)}. Ack trong ${ONCALL.ack} s (phím V)!`, 'bad', p.pid);
      else w.say(`${this.oncallName()} đang bị page: ${this.text(g)}.`, 'warn', p.pid);
    }
  }

  ack(p, node) {
    const w = this.w, now = w.time;
    const open = this.groups().filter((g) => g.state === 'firing' && (node === undefined || g.node === +node));
    if (!open.length) return w.say('Không có alert nào cần ack.', 'info', p.pid);
    const mine = open.filter((g) => p.pid === this.oncall || g.lead.esc);
    if (!mine.length) return w.say(`Chỉ ${this.oncallName()} (người on-call) mới ack được, trừ khi alert đã escalate. Nhận ca nếu cần.`, 'warn', p.pid);
    for (const g of mine) {
      for (const a of g.alerts) if (a.state === 'firing') { a.state = 'acked'; a.ackedAt = now; a.by = p.name; }
      const secs = now - g.lead.firedAt;
      this.stats.acked++;
      this.stats.ackSecs += secs;
      const inc = w.director.active.find((i) => i.uid === g.lead.inc);
      if (inc && inc.ackedAt === undefined) inc.ackedAt = now;
      w.say(`${p.name} đã ack alert ở ${this.nodeName(g.node)} sau ${Math.round(secs)} s.`, 'good');
    }
  }

  // Quá cửa sổ ack mà chưa ai nhận: page cả đội, người on-call mất tỉnh táo.
  escalate() {
    const w = this.w, now = w.time;
    if (this.oncall === null) return;
    for (const g of this.groups()) {
      if (g.state !== 'firing' || g.lead.esc || now < g.lead.escAt) continue;
      for (const a of g.alerts) a.esc = true;
      this.stats.escalations++;
      this.drain(this.oncall, ONCALL.escSanity);
      for (const p of w.players.values()) w.say(`ESCALATE: ${this.text(g)} không ai ack trong ${ONCALL.ack} s. Cả đội bị page, ${this.oncallName()} mất ${ONCALL.escSanity} tỉnh táo. Ack ngay (phím V)!`, 'bad', p.pid);
    }
  }

  drain(pid, n) {
    const p = this.w.players.get(pid);
    if (p) p.sanity = clamp(p.sanity - n, 0, 100);
  }

  tell(msg, kind) { if (this.oncall !== null) this.w.say(msg, kind, this.oncall); }

  // ---------- gửi tới client (nằm trong flow.view nên welcome cho người vào sau cũng có) ----------
  view() {
    return {
      oc: this.oncall,
      list: this.groups().map((g) => ({
        node: g.node, st: g.state, esc: g.lead.esc, escAt: round1(g.lead.escAt), fired: round1(g.lead.firedAt),
        sev: g.alerts.some((a) => ALERT_RULES[a.rule].sev === 'crit') ? 'crit' : 'warn',
        rules: g.alerts.map((a) => [a.rule, Math.round(a.val * 1000) / 1000]),
      })),
    };
  }

  // ---------- post-mortem ----------
  // Các dòng chẩn đoán chung cho mọi sự cố; gọi đúng một lần lúc sự cố kết thúc.
  postmortem(inc) {
    const rows = [];
    const A = inc.alert || { level: null, covered: false };
    const t0 = inc.t0;
    const badAt = inc.stats.badAt;
    if (inc.detectedAt === undefined) {
      const why = !A.covered ? 'Node ngoài mọi vùng Đèn giám sát: không có số liệu thì không alert nào kêu được.'
        : !A.level ? 'Đèn giám sát đang để alert Tắt: bạn chỉ biết khi khách phàn nàn.'
          : `Mức "${ALERT[A.level].name}" (kéo dài ≥ ${ALERT[A.level].for} s) không bị vượt trong sự cố này${A.level === 'strict' ? ': ngưỡng quá chặt nên chỉ kêu khi người dùng đã lỗi nặng' : ''}.`;
      rows.push({ ok: false, t: 'Alert phát hiện trước khi SLO vỡ', d: 'Không alert nào kêu trong sự cố. ' + why });
    } else {
      const mttd = inc.detectedAt - t0;
      const before = badAt === undefined || inc.detectedAt <= badAt;
      rows.push({
        ok: before, t: 'Alert phát hiện trước khi SLO vỡ',
        d: badAt === undefined ? `Alert (${ALERT_RULES[inc.alertRule].name}) kêu sau ${Math.round(mttd)} s và SLO không vỡ.`
          : before ? `Alert (${ALERT_RULES[inc.alertRule].name}) kêu sau ${Math.round(mttd)} s, trước khi SLO vỡ (${Math.round(badAt - t0)} s): bạn có thời gian xử lý trước khi người dùng thấy lỗi.`
            : `SLO đã vỡ từ ${Math.round(badAt - t0)} s nhưng alert chỉ kêu sau ${Math.round(mttd)} s: người dùng đã lỗi trước khi bạn được báo. Hạ ngưỡng hoặc giảm "for", đổi lại nhiều báo động giả hơn.`,
      });
      rows.push({
        ok: mttd <= ONCALL.mttd, t: `MTTD ${Math.round(mttd)}s`,
        d: mttd <= ONCALL.mttd ? 'Phát hiện nhanh (MTTD: thời gian từ lúc sự cố bắt đầu tới lúc có alert).' : `Phát hiện chậm: ${Math.round(mttd)} s trôi qua trước khi có alert. MTTD dài là thời gian người dùng chịu lỗi mà bạn không biết.`,
      });
      if (inc.ackedAt === undefined) rows.push({ ok: false, t: 'MTTA: chưa có ai ack', d: 'Alert kêu nhưng không ai nhận trước khi sự cố kết thúc: alert không có chủ thì chỉ là tiếng ồn. Người on-call phải ack trong cửa sổ cho phép.' });
      else {
        const mtta = inc.ackedAt - inc.detectedAt;
        rows.push({ ok: mtta <= ONCALL.ack, t: `MTTA ${Math.round(mtta)}s`, d: mtta <= ONCALL.ack ? 'Người on-call nhận alert kịp thời, không phải escalate.' : `Ack sau ${Math.round(mtta)} s, quá cửa sổ ${ONCALL.ack} s nên cả đội đã bị page. MTTA là thời gian từ alert tới lúc có người nhận.` });
      }
    }
    const n = this.falseSince;
    rows.push({
      ok: n <= 1, t: `Báo động giả: ${n}`,
      d: n === 0 ? 'Từ sự cố trước, không page nào kêu vô ích: tín hiệu đáng tin.' : `${n} page kêu khi không có sự cố nào kể từ sự cố trước. Mỗi page giả làm người trực mất ${ONCALL.falseSanity} tỉnh táo và dạy cả đội phớt lờ pager (alert fatigue). Nâng ngưỡng hoặc tăng "for".`,
    });
    this.falseSince = 0;
    return rows;
  }
}

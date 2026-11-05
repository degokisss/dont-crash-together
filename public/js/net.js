// Hai transport cho cùng một giao thức: WebSocket (co-op) và Web Worker (solo).
export class WsNet {
  constructor(room, onMsg, onClose, join, onRetry) {
    this.url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?room=${encodeURIComponent(room)}`;
    this.onMsg = onMsg; this.onClose = onClose; this.join = join; this.onRetry = onRetry;
    this.tries = 0;
    this.closed = false;
    this.connect();
  }
  connect() {
    const ws = this.ws = new WebSocket(this.url);
    this.open = false;
    ws.onopen = () => {
      this.open = true; this.tries = 0;
      ws.send(JSON.stringify(this.join));
    };
    ws.onmessage = (ev) => {
      if (this.closed || ws !== this.ws) return;
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      this.onMsg(m);
    };
    ws.onclose = () => {
      if (this.closed || ws !== this.ws) return;
      this.open = false;
      if (this.tries >= 6) { this.onClose && this.onClose(); return; }
      const delay = Math.min(8000, 500 * 2 ** this.tries++);
      this.onRetry && this.onRetry(this.tries);
      this.timer = setTimeout(() => { if (!this.closed) this.connect(); }, delay);
    };
    ws.onerror = () => {};
  }
  send(obj) {
    if (this.open) this.ws.send(JSON.stringify(obj));
  }
  close() { this.closed = true; clearTimeout(this.timer); this.ws.close(); }
}

export class LocalNet {
  constructor(init, onMsg, onSave) {
    this.w = new Worker('/js/localserver.js', { type: 'module' });
    this.w.onmessage = (ev) => {
      const d = ev.data;
      if (typeof d === 'string') onMsg(JSON.parse(d));
      else if (d.type === 'save') onSave(d.data);
    };
    this.w.postMessage({ type: 'init', ...init });
  }
  send(obj) { this.w.postMessage({ type: 'msg', m: obj }); }
  pause(v) { this.w.postMessage({ type: 'pause', v }); }
  save() { this.w.postMessage({ type: 'save' }); }
  close() { this.w.postMessage({ type: 'stop' }); setTimeout(() => this.w.terminate(), 300); }
}

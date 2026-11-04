// Hai transport cho cùng một giao thức: WebSocket (co-op) và Web Worker (solo).
export class WsNet {
  constructor(room, onMsg, onClose) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws?room=${encodeURIComponent(room)}`);
    this.q = [];
    this.ws.onopen = () => { this.open = true; for (const s of this.q) this.ws.send(s); this.q = []; };
    this.ws.onmessage = (ev) => onMsg(JSON.parse(ev.data));
    this.ws.onclose = () => onClose && onClose();
    this.ws.onerror = () => {};
  }
  send(obj) {
    const s = JSON.stringify(obj);
    if (this.open) this.ws.send(s); else this.q.push(s);
  }
  close() { this.ws.close(); }
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

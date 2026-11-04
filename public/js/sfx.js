// Âm thanh tổng hợp bằng WebAudio (không cần file). Bật sau cử chỉ đầu tiên của người dùng.
let ac = null, muted = localStorage.getItem('dct.mute') === '1';
const ctx = () => {
  if (muted) return null;
  if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
  if (ac.state === 'suspended') ac.resume();
  return ac;
};

function tone(freq, dur, type = 'sine', vol = 0.06, slide = 0, delay = 0) {
  const a = ctx();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, vol = 0.05, delay = 0) {
  const a = ctx();
  if (!a) return;
  const n = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, n, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = a.createBufferSource(), g = a.createGain();
  s.buffer = buf;
  g.gain.value = vol;
  s.connect(g).connect(a.destination);
  s.start(a.currentTime + delay);
}

export const SFX = {
  fx(kind) {
    if (kind === 'hit') { noise(0.08, 0.05); tone(180, 0.08, 'square', 0.03, -60); }
    else if (kind === 'poof') { noise(0.25, 0.05); }
    else if (kind === 'boom') { noise(0.3, 0.07); tone(90, 0.3, 'sawtooth', 0.05, -50); }
    else if (kind === 'heal') { tone(520, 0.12, 'sine', 0.04); tone(780, 0.16, 'sine', 0.04, 0, 0.08); }
    else if (kind === 'lightning') { noise(0.5, 0.09); tone(70, 0.5, 'sawtooth', 0.06, -30); }
  },
  toast(kind) {
    if (kind === 'bad') { tone(220, 0.18, 'square', 0.04); tone(165, 0.24, 'square', 0.04, 0, 0.16); }
    else if (kind === 'good') { tone(520, 0.1, 'triangle', 0.04); tone(660, 0.14, 'triangle', 0.04, 0, 0.09); }
    else if (kind === 'codex') { tone(880, 0.12, 'sine', 0.035); tone(1320, 0.2, 'sine', 0.03, 0, 0.1); }
    else if (kind === 'warn') tone(330, 0.14, 'triangle', 0.035);
  },
  incident() { for (let i = 0; i < 3; i++) tone(i % 2 ? 440 : 330, 0.18, 'square', 0.04, 0, i * 0.2); },
  click() { tone(600, 0.04, 'square', 0.02); },
  toggle() { muted = !muted; localStorage.setItem('dct.mute', muted ? '1' : '0'); return muted; },
  get muted() { return muted; },
};

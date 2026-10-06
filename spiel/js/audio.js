'use strict';
// Einfache, synthetisch erzeugte Geraeusche (WebAudio).

class Sound {
  constructor() { this.ctx = null; this.volume = 0.5; }
  init() {
    if (this.ctx) return;
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; }
    if (!this.ctx) return;
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  noiseBurst(dur, freq, q, vol, type) {
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol * this.volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(c.destination);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }
  tone(freq, dur, vol, type, slide) {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol * this.volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.05);
  }
  play(name, mat) {
    if (!this.ctx || this.volume <= 0) return;
    const m = { stone: 2400, wood: 900, dirt: 500, sand: 1600, glass: 4000, cloth: 700, plant: 1200 }[mat] || 900;
    switch (name) {
      case 'dig': this.noiseBurst(0.12, m, 1.2, 0.35); break;
      case 'break': this.noiseBurst(0.22, m, 0.8, 0.6); if (mat === 'glass') this.noiseBurst(0.3, 5000, 2, 0.4); break;
      case 'place': this.noiseBurst(0.12, m * 0.8, 1, 0.5); break;
      case 'step': this.noiseBurst(0.08, m * 0.7, 1, 0.15); break;
      case 'hurt': this.tone(220, 0.18, 0.4, 'square', 120); break;
      case 'hurt_mob': this.tone(320, 0.15, 0.25, 'sawtooth', 160); break;
      case 'pop': this.tone(900 + Math.random() * 500, 0.08, 0.2, 'sine', 1600); break;
      case 'click': this.tone(1200, 0.04, 0.15, 'square'); break;
      case 'explode': this.noiseBurst(1.2, 300, 0.4, 1.0, 'lowpass'); this.tone(60, 0.8, 0.6, 'sine', 30); break;
      case 'fuse': this.noiseBurst(1.4, 3000, 0.6, 0.25, 'highpass'); break;
      case 'eat': this.noiseBurst(0.1, 1800, 2, 0.3); break;
      case 'burp': this.tone(160, 0.25, 0.3, 'sawtooth', 90); break;
      case 'bow': this.noiseBurst(0.25, 2500, 0.5, 0.35, 'highpass'); break;
      case 'arrow_hit': this.noiseBurst(0.08, 1500, 3, 0.3); break;
      case 'break_tool': this.tone(800, 0.25, 0.3, 'square', 200); break;
      case 'equip': this.noiseBurst(0.15, 2000, 1, 0.3); break;
      case 'fizz': this.noiseBurst(0.5, 4000, 0.4, 0.3, 'highpass'); break;
      case 'splash': this.noiseBurst(0.4, 900, 0.5, 0.4, 'lowpass'); break;
      case 'door': this.noiseBurst(0.18, 600, 2, 0.5); break;
      case 'xp': this.tone(1400, 0.1, 0.15); break;
    }
  }
}

function blockSoundMat(id) {
  const b = BLOCKS[id];
  if (!b) return 'stone';
  if (b.name.includes('glass') || b.name === 'ice') return 'glass';
  if (b.name.includes('wool') || b.name === 'bed') return 'cloth';
  if (b.shape === 'cross' || b.name.includes('leaves')) return 'plant';
  if (b.name === 'sand' || b.name === 'gravel' || b.name === 'snow_block') return 'sand';
  if (b.tool === 'axe') return 'wood';
  if (b.tool === 'shovel' || b.tool === 'hoe') return 'dirt';
  return 'stone';
}

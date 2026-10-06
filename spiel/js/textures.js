'use strict';
// Alle Texturen werden hier Pixel fuer Pixel selbst gezeichnet (16x16 wie im Original-Stil).

const TILE = 16;
const ATLAS_TILES = 32;
const atlasCanvas = document.createElement('canvas');
atlasCanvas.width = atlasCanvas.height = TILE * ATLAS_TILES;
const atlasCtx = atlasCanvas.getContext('2d');
const TEX = {};
const TILE_CANVAS = {};
let texCount = 0;

function strHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

class Painter {
  constructor(name) {
    this.d = new Uint8ClampedArray(16 * 16 * 4);
    this.r = mulberry32(strHash(name));
  }
  set(x, y, c, a) {
    if (x < 0 || y < 0 || x > 15 || y > 15) return;
    const i = (y * 16 + x) * 4;
    this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2];
    this.d[i + 3] = a === undefined ? (c[3] === undefined ? 255 : c[3]) : a;
  }
  get(x, y) {
    const i = (((y + 16) % 16) * 16 + ((x + 16) % 16)) * 4;
    return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]];
  }
  alpha(x, y) { return x < 0 || y < 0 || x > 15 || y > 15 ? 0 : this.d[(y * 16 + x) * 4 + 3]; }
  vary(c, amt) { const f = 1 + (this.r() - 0.5) * 2 * amt; return [c[0] * f, c[1] * f, c[2] * f, c[3]]; }
  fill(c, amt) { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) this.set(x, y, this.vary(c, amt || 0)); }
  rect(x0, y0, w, h, c, amt) { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, this.vary(c, amt || 0)); }
  copy(name) { this.d.set(TILE_CANVAS[name].getContext('2d').getImageData(0, 0, 16, 16).data); }
  shadePx(x, y, f) { const c = this.get(x, y); this.set(x, y, [c[0] * f, c[1] * f, c[2] * f], c[3]); }
  specks(n, c, amt) { for (let i = 0; i < n; i++) this.set(this.r() * 16 | 0, this.r() * 16 | 0, this.vary(c, amt || 0.05)); }
  outline(f) {
    // Dunkler Rand um alle sichtbaren Pixel (fuer Item-Sprites)
    const add = [];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (this.alpha(x, y)) continue;
      const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => this.alpha(x + dx, y + dy) > 0);
      if (n) { const c = this.get(x + n[0], y + n[1]); add.push([x, y, [c[0] * (f || 0.35), c[1] * (f || 0.35), c[2] * (f || 0.35)]]); }
    }
    for (const [x, y, c] of add) this.set(x, y, c);
  }
  pattern(rows, pal) {
    for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      if (ch !== '.' && pal[ch]) this.set(x, y, this.vary(pal[ch], 0.04));
    }
  }
  ellipse(cx, cy, rx, ry, c, amt) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      const d = dx * dx + dy * dy;
      if (d <= 1) {
        const light = 1.15 - 0.35 * ((dx + dy) * 0.5 + 0.5);
        this.set(x, y, this.vary([c[0] * light, c[1] * light, c[2] * light], amt || 0.05));
      }
    }
  }
  line(x0, y0, x1, y1, c, amt) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1;
    for (let i = 0; i <= n; i++) this.set(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), this.vary(c, amt || 0));
  }
}

function tile(name, fn) {
  const P = new Painter(name);
  fn(P);
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(16, 16);
  img.data.set(P.d);
  ctx.putImageData(img, 0, 0);
  const idx = texCount++;
  atlasCtx.drawImage(c, (idx % ATLAS_TILES) * TILE, Math.floor(idx / ATLAS_TILES) * TILE);
  TEX[name] = idx;
  TILE_CANVAS[name] = c;
  return idx;
}

function voronoi(P, n, colorFn, edge, edgeW) {
  const pts = [];
  for (let i = 0; i < n; i++) pts.push([P.r() * 16, P.r() * 16, colorFn(i)]);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    let d1 = 1e9, d2 = 1e9, best = null;
    for (const p of pts) for (let ox = -16; ox <= 16; ox += 16) for (let oy = -16; oy <= 16; oy += 16) {
      const dx = x + 0.5 - p[0] - ox, dy = y + 0.5 - p[1] - oy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < d1) { d2 = d1; d1 = d; best = p; } else if (d < d2) d2 = d;
    }
    if (d2 - d1 < (edgeW || 1)) P.set(x, y, P.vary(edge, 0.08));
    else P.set(x, y, P.vary(best[2], 0.06));
  }
}

const rgb = (r, g, b) => [r, g, b];

function oreTile(name, c, dark) {
  tile(name, P => {
    P.copy('stone');
    const n = 4 + (P.r() * 3 | 0);
    for (let i = 0; i < n; i++) {
      const x = 1 + (P.r() * 12 | 0), y = 1 + (P.r() * 12 | 0);
      const shape = [[0, 0], [1, 0], [0, 1], [1, 1], [2, 0], [0, 2]].slice(0, 2 + (P.r() * 4 | 0));
      for (const [dx, dy] of shape) {
        P.set(x + dx, y + dy, P.vary(c, 0.1));
        if (P.r() < 0.4) P.set(x + dx + 1, y + dy + 1, dark);
      }
    }
  });
}

function logSide(name, bark, dark) {
  tile(name, P => {
    for (let x = 0; x < 16; x++) {
      const col = P.vary(bark, 0.12);
      for (let y = 0; y < 16; y++) P.set(x, y, P.vary(col, 0.05));
    }
    for (let i = 0; i < 14; i++) {
      const x = P.r() * 16 | 0, y = P.r() * 16 | 0, l = 2 + (P.r() * 5 | 0);
      for (let k = 0; k < l; k++) P.set(x, (y + k) % 16, P.vary(dark, 0.08));
    }
  });
}

function logTop(name, inner, ring, bark) {
  tile(name, P => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (d > 6.6) P.set(x, y, P.vary(bark, 0.1));
      else P.set(x, y, P.vary(Math.floor(d) % 2 ? ring : inner, 0.06));
    }
  });
}

function planks(name, base) {
  tile(name, P => {
    for (let y = 0; y < 16; y++) {
      const board = y >> 2;
      const seam = (board * 7 + 3) % 16;
      for (let x = 0; x < 16; x++) {
        let c = P.vary(base, 0.05);
        if (y % 4 === 3) c = [base[0] * 0.68, base[1] * 0.68, base[2] * 0.68];
        else if (x === seam) c = [base[0] * 0.75, base[1] * 0.75, base[2] * 0.75];
        else if (P.r() < 0.12) c = [base[0] * 0.88, base[1] * 0.88, base[2] * 0.88];
        P.set(x, y, c);
      }
    }
  });
}

function leaves(name, base) {
  tile(name, P => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (P.r() < 0.17) P.set(x, y, [0, 0, 0], 0);
      else P.set(x, y, P.vary(base, 0.22));
    }
  });
}

function metalBlock(name, base, amt) {
  tile(name, P => {
    P.fill(base, amt || 0.05);
    const hi = [Math.min(255, base[0] * 1.25 + 20), Math.min(255, base[1] * 1.25 + 20), Math.min(255, base[2] * 1.25 + 20)];
    const lo = [base[0] * 0.65, base[1] * 0.65, base[2] * 0.65];
    for (let i = 0; i < 16; i++) { P.set(i, 0, hi); P.set(0, i, hi); P.set(i, 15, lo); P.set(15, i, lo); }
    for (let i = 3; i < 13; i++) { P.set(i, 3, lo); P.set(3, i, lo); P.set(i, 12, hi); P.set(12, i, hi); }
  });
}

function stoneVariant(name, base, speckA, speckB, polished) {
  tile(name, P => {
    P.fill(base, polished ? 0.03 : 0.08);
    P.specks(polished ? 14 : 40, speckA, 0.1);
    P.specks(polished ? 10 : 30, speckB, 0.1);
    if (polished) {
      const lo = [base[0] * 0.75, base[1] * 0.75, base[2] * 0.75];
      for (let i = 0; i < 16; i++) { P.set(i, 15, lo); P.set(15, i, lo); }
    }
  });
}

function crossPlant(name, fn) { tile(name, P => { P.fill([0, 0, 0, 0]); for (let i = 0; i < 256 * 4; i += 4) P.d[i + 3] = 0; fn(P); }); }

function clear(P) { for (let i = 0; i < 256 * 4; i++) P.d[i] = 0; }

// ---------------------------------------------------------------- Bloecke
function buildBlockTextures() {
  tile('stone', P => {
    P.fill(rgb(125, 125, 125), 0.07);
    for (let i = 0; i < 18; i++) {
      const x = P.r() * 16 | 0, y = P.r() * 16 | 0, l = 1 + (P.r() * 3 | 0);
      const f = P.r() < 0.5 ? 0.82 : 1.12;
      for (let k = 0; k < l; k++) P.shadePx((x + k) % 16, y, f);
    }
  });
  tile('cobblestone', P => voronoi(P, 11, () => P.vary(rgb(125, 125, 125), 0.18), rgb(78, 78, 78), 1.1));
  tile('mossy_cobblestone', P => {
    P.copy('cobblestone');
    for (let i = 0; i < 7; i++) {
      const cx = P.r() * 16, cy = P.r() * 16, r = 1.5 + P.r() * 2.5;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 < r * r && P.r() < 0.8) P.set(x, y, P.vary(rgb(84, 112, 54), 0.15));
    }
  });
  tile('dirt', P => {
    P.fill(rgb(134, 96, 67), 0.1);
    P.specks(28, rgb(100, 70, 48));
    P.specks(18, rgb(165, 122, 88));
  });
  tile('grass_top', P => { P.fill(rgb(108, 168, 64), 0.13); P.specks(30, rgb(85, 140, 48)); });
  tile('grass_side', P => {
    P.copy('dirt');
    for (let x = 0; x < 16; x++) {
      const depth = 3 + (P.r() < 0.45 ? 1 : 0) + (P.r() < 0.15 ? 1 : 0);
      for (let y = 0; y < depth; y++) P.set(x, y, P.vary(rgb(108, 168, 64), 0.13));
    }
  });
  tile('snow', P => { P.fill(rgb(242, 250, 250), 0.03); P.specks(12, rgb(220, 232, 240)); });
  tile('grass_side_snow', P => {
    P.copy('dirt');
    for (let x = 0; x < 16; x++) {
      const depth = 3 + (P.r() < 0.5 ? 1 : 0);
      for (let y = 0; y < depth; y++) P.set(x, y, P.vary(rgb(240, 248, 250), 0.03));
    }
  });
  tile('sand', P => { P.fill(rgb(219, 207, 163), 0.05); P.specks(25, rgb(196, 181, 135)); P.specks(10, rgb(232, 224, 186)); });
  tile('gravel', P => voronoi(P, 16, i => P.vary([rgb(130, 124, 122), rgb(150, 143, 140), rgb(105, 100, 98), rgb(160, 150, 135)][i % 4], 0.08), rgb(88, 84, 82), 0.7));
  tile('bedrock', P => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) P.set(x, y, P.vary([rgb(45, 45, 45), rgb(85, 85, 85), rgb(130, 130, 130)][P.r() * 3 | 0], 0.1));
  });
  logSide('oak_log', rgb(104, 83, 50), rgb(72, 56, 32));
  logTop('oak_log_top', rgb(176, 141, 86), rgb(150, 116, 66), rgb(104, 83, 50));
  logSide('spruce_log', rgb(62, 43, 24), rgb(42, 29, 14));
  logTop('spruce_log_top', rgb(128, 96, 56), rgb(104, 76, 42), rgb(62, 43, 24));
  tile('birch_log', P => {
    P.fill(rgb(216, 215, 205), 0.04);
    for (let i = 0; i < 11; i++) {
      const x = P.r() * 14 | 0, y = P.r() * 16 | 0, l = 2 + (P.r() * 3 | 0);
      for (let k = 0; k < l; k++) P.set(x + k, y, P.vary(rgb(45, 42, 38), 0.1));
    }
  });
  logTop('birch_log_top', rgb(205, 186, 130), rgb(182, 160, 106), rgb(216, 215, 205));
  planks('oak_planks', rgb(162, 130, 78));
  planks('birch_planks', rgb(196, 179, 123));
  planks('spruce_planks', rgb(114, 84, 48));
  leaves('oak_leaves', rgb(58, 128, 32));
  leaves('birch_leaves', rgb(100, 145, 62));
  leaves('spruce_leaves', rgb(46, 88, 52));
  tile('glass', P => {
    clear(P);
    const edge = rgb(218, 238, 242);
    for (let i = 0; i < 16; i++) { P.set(i, 0, edge); P.set(0, i, edge); P.set(i, 15, rgb(170, 200, 210)); P.set(15, i, rgb(170, 200, 210)); }
    for (let i = 0; i < 3; i++) { P.set(3 + i, 4 - i, edge, 200); P.set(4 + i, 5 - i, edge, 160); }
    P.set(11, 11, edge, 180); P.set(12, 10, edge, 180);
  });
  oreTile('coal_ore', rgb(40, 40, 40), rgb(20, 20, 20));
  oreTile('iron_ore', rgb(216, 175, 147), rgb(150, 110, 85));
  oreTile('gold_ore', rgb(250, 220, 60), rgb(190, 150, 20));
  oreTile('diamond_ore', rgb(95, 235, 225), rgb(30, 160, 150));
  oreTile('redstone_ore', rgb(220, 20, 10), rgb(140, 10, 5));
  oreTile('lapis_ore', rgb(30, 70, 190), rgb(15, 35, 120));
  tile('water', P => {
    P.fill([48, 90, 215, 175], 0.06);
    for (let i = 0; i < 6; i++) {
      const x = P.r() * 12 | 0, y = P.r() * 16 | 0;
      for (let k = 0; k < 4; k++) P.set(x + k, y, [90, 135, 240, 185]);
    }
  });
  tile('lava', P => {
    P.fill(rgb(215, 88, 14), 0.08);
    for (let i = 0; i < 8; i++) P.ellipse(P.r() * 16, P.r() * 16, 1 + P.r() * 2, 1 + P.r() * 1.5, rgb(250, 175, 40), 0.06);
    P.specks(14, rgb(170, 40, 10));
  });
  tile('crafting_table_top', P => {
    P.copy('oak_planks');
    const dark = rgb(90, 64, 35);
    for (let i = 0; i < 16; i++) { P.set(i, 0, dark); P.set(0, i, dark); P.set(i, 15, dark); P.set(15, i, dark); }
    for (let i = 2; i < 14; i++) { P.set(i, 5, rgb(120, 92, 54)); P.set(i, 10, rgb(120, 92, 54)); P.set(5, i, rgb(120, 92, 54)); P.set(10, i, rgb(120, 92, 54)); }
  });
  const tableSide = (name, front) => tile(name, P => {
    P.copy('oak_planks');
    P.rect(0, 0, 16, 3, rgb(105, 76, 42), 0.05);
    for (let i = 0; i < 16; i++) { P.set(0, i, rgb(90, 64, 35)); P.set(15, i, rgb(90, 64, 35)); }
    if (front) {
      P.rect(3, 5, 10, 2, rgb(170, 170, 170), 0.05); // Saege
      for (let x = 3; x < 13; x += 2) P.set(x, 7, rgb(120, 120, 120));
      P.rect(11, 4, 3, 3, rgb(110, 80, 45));
      P.rect(4, 10, 2, 5, rgb(110, 80, 45)); P.rect(2, 9, 6, 2, rgb(150, 150, 150)); // Hammer
    } else {
      P.rect(6, 5, 2, 9, rgb(110, 80, 45)); P.rect(4, 4, 6, 2, rgb(150, 150, 150));
      P.rect(10, 6, 3, 7, rgb(170, 170, 170));
    }
  });
  tableSide('crafting_table_side', false);
  tableSide('crafting_table_front', true);
  tile('furnace_side', P => {
    P.fill(rgb(118, 118, 118), 0.07);
    for (let i = 0; i < 16; i++) { P.set(i, 0, rgb(90, 90, 90)); P.set(i, 15, rgb(80, 80, 80)); P.set(0, i, rgb(90, 90, 90)); P.set(15, i, rgb(80, 80, 80)); }
  });
  tile('furnace_top', P => { P.fill(rgb(132, 132, 132), 0.05); P.specks(20, rgb(110, 110, 110)); });
  const furnaceFront = (name, lit) => tile(name, P => {
    P.copy('furnace_side');
    P.rect(2, 2, 12, 2, rgb(95, 95, 95));
    P.rect(3, 8, 10, 6, lit ? rgb(60, 30, 10) : rgb(28, 28, 28));
    P.rect(3, 7, 10, 1, rgb(80, 80, 80));
    if (lit) {
      for (let x = 3; x < 13; x++) {
        const h = 2 + (P.r() * 4 | 0);
        for (let k = 0; k < h; k++) P.set(x, 13 - k, k < 1 ? rgb(255, 230, 120) : k < 3 ? rgb(250, 160, 30) : rgb(210, 80, 10));
      }
    }
  });
  furnaceFront('furnace_front', false);
  furnaceFront('furnace_front_on', true);
  const chestTex = (name, front, top) => tile(name, P => {
    P.fill(rgb(160, 108, 42), 0.07);
    const dark = rgb(84, 56, 22);
    for (let i = 0; i < 16; i++) { P.set(i, 0, dark); P.set(0, i, dark); P.set(i, 15, dark); P.set(15, i, dark); }
    if (!top) for (let i = 0; i < 16; i++) P.set(i, 5, dark);
    if (front) { P.rect(7, 3, 2, 4, rgb(190, 190, 190)); P.set(7, 6, rgb(80, 80, 80)); P.set(8, 6, rgb(80, 80, 80)); }
  });
  chestTex('chest_top', false, true);
  chestTex('chest_side', false, false);
  chestTex('chest_front', true, false);
  tile('torch', P => {
    clear(P);
    for (let y = 8; y < 16; y++) { P.set(7, y, rgb(125, 95, 52)); P.set(8, y, rgb(96, 70, 38)); }
    P.set(7, 6, rgb(255, 240, 150)); P.set(8, 6, rgb(255, 210, 90));
    P.set(7, 7, rgb(255, 200, 60)); P.set(8, 7, rgb(230, 140, 30));
  });
  tile('sandstone', P => {
    P.fill(rgb(216, 203, 155), 0.04);
    P.rect(0, 0, 16, 3, rgb(226, 214, 168), 0.03);
    P.rect(0, 12, 16, 4, rgb(196, 182, 134), 0.04);
    for (let x = 0; x < 16; x++) if (P.r() < 0.6) P.set(x, 7, rgb(205, 191, 143));
  });
  tile('sandstone_top', P => { P.fill(rgb(222, 210, 166), 0.03); P.specks(10, rgb(205, 191, 143)); });
  tile('sandstone_bottom', P => { P.fill(rgb(212, 198, 150), 0.05); P.specks(20, rgb(192, 178, 130)); });
  tile('cactus_side', P => {
    P.fill(rgb(88, 130, 44), 0.06);
    for (let y = 0; y < 16; y++) for (const x of [0, 4, 11, 15]) P.set(x, y, rgb(62, 98, 30));
    for (let i = 0; i < 10; i++) P.set(1 + (P.r() * 14 | 0), P.r() * 16 | 0, rgb(30, 40, 20));
  });
  tile('cactus_top', P => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      P.set(x, y, P.vary(d > 6.5 ? rgb(62, 98, 30) : Math.floor(d) % 3 === 0 ? rgb(100, 145, 55) : rgb(88, 130, 44), 0.05));
    }
  });
  tile('ice', P => {
    P.fill([150, 188, 252, 200], 0.04);
    for (let i = 0; i < 5; i++) { const x = P.r() * 12 | 0, y = P.r() * 12 | 0; for (let k = 0; k < 4; k++) P.set(x + k, y + k, [210, 228, 255, 220]); }
  });
  tile('clay', P => { P.fill(rgb(160, 166, 179), 0.04); P.specks(16, rgb(145, 150, 162)); });
  tile('bricks', P => {
    P.fill(rgb(176, 168, 158), 0.05);
    for (let row = 0; row < 4; row++) {
      const off = row % 2 ? 4 : 0;
      for (let b = -1; b < 2; b++) {
        const c = P.vary(rgb(150, 72, 56), 0.1);
        P.rect(b * 8 + off, row * 4, 7, 3, c, 0.06);
      }
    }
  });
  tile('bookshelf', P => {
    P.copy('oak_planks');
    const cols = [rgb(150, 40, 35), rgb(40, 70, 140), rgb(60, 120, 50), rgb(170, 140, 60), rgb(110, 50, 110), rgb(140, 90, 50)];
    for (const y0 of [1, 9]) {
      let x = 1;
      while (x < 15) {
        const w = 1 + (P.r() * 2 | 0), h = 4 + (P.r() * 3 | 0), c = cols[P.r() * cols.length | 0];
        for (let k = 0; k < w && x < 15; k++, x++) for (let y = y0 + 6 - h; y < y0 + 6; y++) P.set(x, y, P.vary(c, 0.06));
        if (P.r() < 0.3) x++;
      }
    }
  });
  tile('tnt_side', P => {
    P.fill(rgb(204, 62, 45), 0.05);
    for (let x = 0; x < 16; x += 4) for (let y = 0; y < 16; y++) P.set(x, y, rgb(160, 40, 30));
    P.rect(0, 5, 16, 6, rgb(225, 225, 225), 0.03);
    const T = ['###', '.#.', '.#.', '.#.'];
    const N = ['#..#', '##.#', '#.##', '#..#'];
    const draw = (pat, x0) => pat.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === '#') P.set(x0 + x, 6 + y, rgb(30, 30, 30)); }));
    draw(T, 2); draw(N, 6); draw(T, 11);
  });
  tile('tnt_top', P => {
    P.fill(rgb(204, 62, 45), 0.05);
    P.rect(4, 4, 8, 8, rgb(200, 200, 200), 0.05);
    P.rect(7, 7, 2, 2, rgb(60, 60, 60));
  });
  tile('tnt_bottom', P => { P.fill(rgb(204, 62, 45), 0.05); P.rect(4, 4, 8, 8, rgb(180, 180, 180), 0.05); });
  tile('white_wool', P => {
    P.fill(rgb(233, 236, 236), 0.04);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if ((x + y * 3) % 7 === 0) P.shadePx(x, y, 0.92);
  });
  tile('red_wool', P => {
    P.fill(rgb(160, 39, 34), 0.05);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if ((x + y * 3) % 7 === 0) P.shadePx(x, y, 0.88);
  });
  metalBlock('iron_block', rgb(220, 220, 220));
  metalBlock('gold_block', rgb(246, 208, 61));
  metalBlock('diamond_block', rgb(98, 237, 228));
  metalBlock('redstone_block', rgb(175, 24, 5), 0.1);
  metalBlock('lapis_block', rgb(31, 64, 141), 0.1);
  tile('coal_block', P => { P.fill(rgb(22, 22, 22), 0.15); P.specks(20, rgb(50, 50, 50)); });
  tile('stone_bricks', P => {
    P.fill(rgb(122, 122, 122), 0.06);
    const m = rgb(80, 80, 80), hi = rgb(150, 150, 150);
    for (let x = 0; x < 16; x++) { P.set(x, 7, m); P.set(x, 15, m); P.set(x, 0, hi); P.set(x, 8, hi); }
    for (let y = 0; y < 8; y++) { P.set(15, y, m); P.set(7, y + 8, m); }
  });
  tile('obsidian', P => {
    P.fill(rgb(20, 17, 30), 0.15);
    P.specks(20, rgb(60, 40, 92));
    P.specks(10, rgb(40, 30, 60));
  });
  crossPlant('short_grass', P => {
    for (let i = 0; i < 11; i++) {
      let x = 1 + P.r() * 14, h = 5 + (P.r() * 10 | 0), lean = (P.r() - 0.5) * 0.4;
      const c = P.vary(rgb(98, 160, 58), 0.15);
      for (let k = 0; k < h; k++) { P.set(Math.round(x), 15 - k, P.vary(c, 0.08)); x += lean; }
    }
  });
  crossPlant('dead_bush', P => {
    const c = rgb(120, 82, 40);
    P.line(8, 15, 8, 9, c); P.line(8, 11, 4, 6, c); P.line(8, 10, 12, 5, c);
    P.line(4, 6, 3, 3, c); P.line(12, 5, 13, 2, c); P.line(8, 9, 9, 4, c);
  });
  crossPlant('dandelion', P => {
    P.line(8, 15, 8, 8, rgb(70, 130, 40)); P.set(7, 13, rgb(70, 130, 40)); P.set(9, 12, rgb(70, 130, 40));
    P.rect(6, 5, 4, 3, rgb(250, 220, 30)); P.rect(7, 4, 2, 5, rgb(250, 220, 30)); P.set(7, 6, rgb(255, 245, 120));
  });
  crossPlant('poppy', P => {
    P.line(8, 15, 8, 8, rgb(70, 130, 40)); P.set(9, 12, rgb(70, 130, 40)); P.set(10, 11, rgb(70, 130, 40));
    P.rect(6, 4, 5, 4, rgb(210, 25, 20)); P.rect(7, 3, 3, 6, rgb(210, 25, 20)); P.set(8, 5, rgb(30, 20, 10)); P.set(8, 6, rgb(30, 20, 10));
  });
  crossPlant('sugar_cane', P => {
    for (const x of [2, 8, 12]) for (let y = 0; y < 16; y++) {
      const seg = y % 5 === 0;
      P.set(x, y, seg ? rgb(120, 170, 80) : rgb(170, 220, 118)); P.set(x + 1, y, seg ? rgb(100, 150, 64) : rgb(146, 196, 98));
    }
    P.set(4, 4, rgb(120, 170, 80)); P.set(5, 3, rgb(120, 170, 80)); P.set(10, 9, rgb(120, 170, 80)); P.set(11, 10, rgb(120, 170, 80));
  });
  tile('pumpkin_side', P => {
    P.fill(rgb(222, 132, 22), 0.05);
    for (let y = 0; y < 16; y++) for (const x of [0, 5, 10, 15]) P.set(x, y, rgb(184, 100, 12));
  });
  tile('pumpkin_top', P => {
    P.fill(rgb(222, 132, 22), 0.05);
    for (let i = 0; i < 16; i++) { P.set(i, 7, rgb(190, 108, 14)); P.set(7, i, rgb(190, 108, 14)); }
    P.rect(6, 6, 4, 4, rgb(96, 74, 30));
  });
  const face = (name, glow) => tile(name, P => {
    P.copy('pumpkin_side');
    const c = glow ? rgb(255, 214, 70) : rgb(56, 30, 8);
    P.rect(3, 4, 3, 3, c); P.rect(10, 4, 3, 3, c);
    P.rect(3, 10, 10, 2, c); P.rect(4, 12, 2, 1, c); P.rect(10, 12, 2, 1, c); P.rect(7, 9, 2, 1, c);
  });
  face('pumpkin_face', false);
  face('jack_o_lantern', true);
  tile('smooth_stone', P => {
    P.fill(rgb(160, 160, 160), 0.03);
    for (let i = 0; i < 16; i++) { P.set(i, 0, rgb(130, 130, 130)); P.set(i, 15, rgb(130, 130, 130)); P.set(0, i, rgb(130, 130, 130)); P.set(15, i, rgb(130, 130, 130)); }
  });
  tile('farmland', P => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) P.set(x, y, P.vary(y % 4 < 2 ? rgb(92, 62, 37) : rgb(72, 46, 26), 0.08));
  });
  tile('farmland_wet', P => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) P.set(x, y, P.vary(y % 4 < 2 ? rgb(66, 42, 24) : rgb(50, 30, 16), 0.08));
  });
  for (let s = 0; s < 4; s++) crossPlant('wheat' + s, P => {
    const h = [3, 7, 11, 14][s];
    for (const x of [1, 4, 7, 10, 13]) {
      const hh = h - (P.r() * 2 | 0);
      for (let k = 0; k < hh; k++) {
        const top = k > hh - 4 && s === 3;
        P.set(x + (k > hh / 2 ? 1 : 0), 15 - k, top ? P.vary(rgb(200, 170, 70), 0.1) : s === 3 ? rgb(170, 160, 60) : P.vary(rgb(80, 160, 40), 0.1));
      }
    }
  });
  const sapling = (name, leaf, trunk, cone) => crossPlant(name, P => {
    P.line(8, 15, 8, 8, trunk);
    if (cone) for (let y = 2; y < 12; y++) { const w = Math.floor((y - 1) / 2); for (let x = 8 - w; x <= 8 + w; x++) if (P.r() < 0.85) P.set(x, y, P.vary(leaf, 0.15)); }
    else { P.ellipse(8, 6, 5, 4.5, leaf, 0.2); P.ellipse(5, 9, 2.5, 2, leaf, 0.2); P.ellipse(11, 9, 2.5, 2, leaf, 0.2); }
  });
  sapling('oak_sapling', rgb(60, 130, 34), rgb(104, 83, 50));
  sapling('birch_sapling', rgb(110, 155, 70), rgb(216, 215, 205));
  sapling('spruce_sapling', rgb(46, 88, 52), rgb(62, 43, 24), true);
  stoneVariant('granite', rgb(154, 106, 89), rgb(180, 130, 112), rgb(110, 70, 58));
  stoneVariant('diorite', rgb(190, 190, 192), rgb(240, 240, 240), rgb(120, 120, 122));
  stoneVariant('andesite', rgb(136, 136, 137), rgb(160, 160, 160), rgb(100, 100, 102));
  stoneVariant('polished_granite', rgb(154, 106, 89), rgb(172, 122, 104), rgb(130, 88, 72), true);
  stoneVariant('polished_diorite', rgb(194, 194, 196), rgb(225, 225, 225), rgb(160, 160, 162), true);
  stoneVariant('polished_andesite', rgb(132, 134, 134), rgb(150, 152, 152), rgb(110, 112, 112), true);
  const doorTex = (name, top) => tile(name, P => {
    const base = rgb(170, 132, 80), dark = rgb(110, 82, 45);
    P.fill(base, 0.06);
    for (let i = 0; i < 16; i++) { P.set(0, i, dark); P.set(15, i, dark); P.set(1, i, dark); P.set(14, i, dark); }
    if (top) {
      for (let i = 0; i < 16; i++) P.set(i, 0, dark);
      for (const x0 of [3, 9]) for (let y = 2; y < 8; y++) for (let x = x0; x < x0 + 4; x++) P.set(x, y, [0, 0, 0], 0);
      for (let i = 2; i < 14; i++) P.set(i, 9, dark);
    } else {
      for (let i = 0; i < 16; i++) P.set(i, 15, dark);
      P.rect(3, 2, 10, 5, rgb(150, 115, 66), 0.04); P.rect(3, 9, 10, 5, rgb(150, 115, 66), 0.04);
      P.set(12, 1, rgb(60, 60, 60));
    }
  });
  doorTex('oak_door_top', true);
  doorTex('oak_door_bottom', false);
  tile('ladder', P => {
    clear(P);
    const c = rgb(130, 100, 56), d = rgb(92, 68, 36);
    for (let y = 0; y < 16; y++) { P.set(2, y, c); P.set(3, y, d); P.set(12, y, c); P.set(13, y, d); }
    for (const y of [1, 5, 9, 13]) for (let x = 2; x < 14; x++) { P.set(x, y, c); P.set(x, y + 1, d); }
  });
  tile('bed_head', P => {
    P.copy('red_wool');
    P.rect(2, 2, 12, 6, rgb(235, 235, 235), 0.03);
  });
  tile('bed_foot', P => { P.copy('red_wool'); });
  tile('bed_side', P => {
    clear(P);
    P.rect(0, 7, 16, 3, rgb(160, 39, 34), 0.05);
    P.rect(0, 10, 16, 3, rgb(150, 115, 66), 0.05);
    P.rect(0, 13, 3, 3, rgb(130, 100, 56)); P.rect(13, 13, 3, 3, rgb(130, 100, 56));
  });
  tile('bed_end', P => {
    clear(P);
    P.rect(0, 7, 16, 3, rgb(160, 39, 34), 0.05);
    P.rect(0, 10, 16, 3, rgb(150, 115, 66), 0.05);
    P.rect(0, 13, 3, 3, rgb(130, 100, 56)); P.rect(13, 13, 3, 3, rgb(130, 100, 56));
  });
  tile('oak_trapdoor', P => {
    P.copy('oak_door_bottom');
    for (const [x0, y0] of [[3, 3], [9, 3], [3, 9], [9, 9]]) for (let y = y0; y < y0 + 4; y++) for (let x = x0; x < x0 + 4; x++) P.set(x, y, [0, 0, 0], 0);
  });
  tile('cake_top', P => { P.fill(rgb(248, 248, 244), 0.03); for (let i = 0; i < 8; i++) P.set(2 + (P.r() * 12 | 0), 2 + (P.r() * 12 | 0), rgb(220, 40, 40)); });
  tile('cake_side', P => { P.fill(rgb(230, 190, 140), 0.05); P.rect(0, 0, 16, 4, rgb(248, 248, 244), 0.03); for (let x = 0; x < 16; x += 3) P.set(x, 4, rgb(248, 248, 244)); P.rect(0, 9, 16, 1, rgb(200, 150, 100)); });
  tile('cake_bottom', P => { P.fill(rgb(200, 150, 100), 0.05); });
  tile('iron_bars', P => {
    clear(P);
    for (const x of [1, 5, 9, 13]) for (let y = 0; y < 16; y++) { P.set(x, y, rgb(140, 140, 140)); P.set(x + 1, y, rgb(100, 100, 100)); }
    for (const y of [1, 14]) for (let x = 0; x < 16; x++) P.set(x, y, rgb(120, 120, 120));
  });
  tile('fence_item', P => {
    clear(P);
    const c = rgb(162, 130, 78), d = rgb(110, 85, 48);
    for (const x of [2, 12]) for (let y = 1; y < 16; y++) { P.set(x, y, c); P.set(x + 1, y, d); }
    for (const y of [4, 10]) for (let x = 0; x < 16; x++) { if (P.alpha(x, y)) continue; P.set(x, y, c); P.set(x, y + 1, d); }
  });
  tile('gate_item', P => {
    clear(P);
    const c = rgb(162, 130, 78), d = rgb(110, 85, 48);
    for (const x of [0, 14]) for (let y = 2; y < 15; y++) { P.set(x, y, c); P.set(x + 1, y, d); }
    for (const y of [4, 10]) for (let x = 2; x < 14; x++) { P.set(x, y, c); P.set(x, y + 1, d); }
    for (const x of [6, 9]) for (let y = 4; y < 12; y++) { P.set(x, y, c); }
  });
  tile('pane_item', P => { P.copy('glass'); });
  tile('cake_item', P => {
    clear(P);
    P.rect(2, 7, 12, 6, rgb(230, 190, 140), 0.04); P.rect(2, 5, 12, 3, rgb(248, 248, 244), 0.02);
    for (const x of [4, 8, 11]) P.set(x, 5, rgb(220, 40, 40));
    P.outline(0.5);
  });
  for (let s = 0; s < 10; s++) tile('destroy' + s, P => {
    clear(P);
    const r = mulberry32(777);
    const n = (s + 1) * 5;
    for (let i = 0; i < n; i++) {
      let x = 7 + (r() * 3 | 0) - 1, y = 7 + (r() * 3 | 0) - 1;
      const dx = r() < 0.5 ? -1 : 1, dy = r() < 0.5 ? -1 : 1;
      for (let k = 0; k < 2 + i / 4; k++) {
        P.set(x, y, [20, 20, 20], 190);
        if (r() < 0.5) x += dx; else y += dy;
      }
    }
  });
}

// ---------------------------------------------------------------- Items
const TOOL_COLORS = {
  wooden: [rgb(150, 116, 64), rgb(110, 84, 44)],
  stone: [rgb(130, 130, 130), rgb(96, 96, 96)],
  iron: [rgb(225, 225, 225), rgb(170, 170, 170)],
  golden: [rgb(250, 220, 70), rgb(210, 160, 30)],
  diamond: [rgb(90, 235, 225), rgb(40, 170, 160)],
};
const ARMOR_COLORS = {
  leather: [rgb(160, 101, 64), rgb(120, 72, 42)],
  iron: [rgb(220, 220, 220), rgb(165, 165, 165)],
  golden: [rgb(250, 220, 70), rgb(210, 160, 30)],
  diamond: [rgb(90, 235, 225), rgb(40, 170, 160)],
};
const STICK = rgb(137, 103, 57), STICK_D = rgb(96, 70, 36);

function drawStick(P, x0, y0, len) {
  for (let i = 0; i < len; i++) { P.set(x0 + i, y0 - i, STICK); P.set(x0 + i + 1, y0 - i, STICK_D); }
}

function toolTile(name, kind, mat) {
  const [h, hd] = TOOL_COLORS[mat];
  const hl = [Math.min(255, h[0] + 30), Math.min(255, h[1] + 30), Math.min(255, h[2] + 30)];
  tile(name, P => {
    clear(P);
    if (kind === 'sword') {
      for (let i = 0; i < 10; i++) { const cx = 5 + i, cy = 10 - i; P.set(cx, cy, hl); P.set(cx + 1, cy, h); P.set(cx, cy - 1, hd); }
      for (let i = 0; i < 5; i++) P.set(2 + i, 9 + i, mat === 'wooden' ? STICK_D : hd);
      P.set(3, 12, STICK); P.set(2, 13, STICK_D); P.set(1, 14, STICK);
    } else {
      drawStick(P, 2, 13, 9);
      if (kind === 'pickaxe') {
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
          const d = Math.hypot(x + 0.5 - 3, y + 0.5 - 13);
          const ang = Math.atan2(y + 0.5 - 13, x + 0.5 - 3);
          if (d > 10.3 && d < 12.4 && ang > -1.75 && ang < 0.12) P.set(x, y, d < 11.2 ? hd : (d > 11.8 ? hl : h));
        }
      } else if (kind === 'axe') {
        for (let y = 1; y < 9; y++) for (let x = 5; x < 13; x++) {
          const s = x + y;
          if (s <= 15 && s >= 9 && x - y > -2) P.set(x, y, s <= 10 ? hl : s >= 14 ? hd : h);
        }
      } else if (kind === 'shovel') {
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
          const da = ((x - 11) - (y - 4)) / Math.SQRT2, db = ((x - 11) + (y - 4)) / Math.SQRT2;
          if (da > -2.6 && da < 3.2 && Math.abs(db) < 2.3) P.set(x, y, Math.abs(db) < 0.8 ? hl : db > 0 ? hd : h);
        }
      } else if (kind === 'hoe') {
        for (let x = 6; x < 13; x++) { P.set(x, 2, hl); P.set(x, 3, x < 9 ? h : hd); }
        P.set(12, 4, hd);
      }
    }
    P.outline(0.3);
  });
}

function armorTile(name, kind, mat) {
  const [h, hd] = ARMOR_COLORS[mat];
  const pats = {
    helmet: ['................', '................', '................', '....kkkkkkkk....', '...khhhhhhhhk...', '...khlllllldk...',
      '...khkkkkkkdk...', '...khk....kdk...', '...kkk....kkk...'],
    chestplate: ['................', '..kkk......kkk..', '.khhkkkkkkkkdhk.', '.khlhhhhhhhhhdk.', '.kkkhlhhhhhhkkk.', '...khlhhhhhdk...',
      '...khhhhhhhdk...', '...khlhhhhhdk...', '...khhhhhhhdk...', '...khhhhhhhdk...', '...kkkkkkkkkk...'],
    leggings: ['................', '................', '...kkkkkkkkkk...', '...khlhhhhhdk...', '...khhhhhhhdk...', '...khhhkkhhdk...',
      '...khhk..khdk...', '...khhk..khdk...', '...khhk..khdk...', '...khhk..khdk...', '...khhk..khdk...', '...kkkk..kkkk...'],
    boots: ['................', '................', '................', '................', '................', '................',
      '....kkk..kkk....', '....khk..khk....', '....khk..khk....', '...kllk..kllk...', '..khhhk..khhhk..', '..kkkkk..kkkkk..'],
  };
  tile(name, P => {
    clear(P);
    P.pattern(pats[kind], { k: [hd[0] * 0.5, hd[1] * 0.5, hd[2] * 0.5], h, d: hd, l: [Math.min(255, h[0] + 30), Math.min(255, h[1] + 30), Math.min(255, h[2] + 30)] });
  });
}

function itemTile(name, fn) { tile(name, P => { clear(P); fn(P); }); }

function pile(P, c) {
  for (let y = 7; y < 15; y++) for (let x = 2; x < 14; x++) {
    const w = (y - 6) * 0.9;
    if (Math.abs(x + 0.5 - 8) < w && P.r() < 0.8) P.set(x, y, P.vary(c, 0.15));
  }
}

function buildItemTextures() {
  itemTile('stick', P => { drawStick(P, 3, 12, 9); P.outline(0.4); });
  itemTile('coal', P => { P.ellipse(8, 9, 5, 4.2, rgb(40, 40, 40), 0.2); P.specks(6, rgb(75, 75, 75)); clipToShape(P); P.outline(0.3); });
  itemTile('charcoal', P => { P.ellipse(8, 9, 5, 4.2, rgb(52, 42, 34), 0.2); P.outline(0.3); });
  const ingot = (c) => P => {
    for (let y = 6; y < 12; y++) for (let x = 2; x < 15; x++) {
      const l = 2 + (11 - y), r = 14 - (y - 6) * 0.3;
      if (x >= l && x <= r + (y - 6)) P.set(x, y, y === 6 ? [Math.min(255, c[0] + 35), Math.min(255, c[1] + 35), Math.min(255, c[2] + 35)] : P.vary(c, 0.04));
    }
    P.outline(0.45);
  };
  itemTile('iron_ingot', ingot(rgb(215, 215, 215)));
  itemTile('gold_ingot', ingot(rgb(250, 210, 60)));
  itemTile('brick', ingot(rgb(170, 80, 58)));
  itemTile('diamond', P => {
    P.pattern(['................', '................', '................', '.....kkkkkk.....', '....kllllllk....', '...klhhhhhhhk...', '..khhhhhhhhhhk..',
      '...khhhhhhhhk...', '....khhhhhhk....', '.....khhhhk.....', '......khhk......', '.......kk.......'],
    { k: rgb(20, 110, 100), h: rgb(80, 225, 215), l: rgb(200, 255, 250) });
  });
  itemTile('redstone', P => { for (let i = 0; i < 26; i++) { const a = P.r() * 6.28, r = P.r() * 5; P.set(8 + Math.cos(a) * r | 0, 9 + Math.sin(a) * r | 0, P.vary(rgb(200, 20, 10), 0.15)); } P.outline(0.4); });
  itemTile('lapis_lazuli', P => { P.ellipse(8, 8.5, 5, 5, rgb(35, 70, 175), 0.1); P.specks(5, rgb(70, 110, 220)); clipToShape(P); P.outline(0.4); });
  itemTile('raw_iron', P => { P.ellipse(8, 9, 5.5, 4.5, rgb(198, 160, 130), 0.1); P.ellipse(6, 7, 2.5, 2, rgb(216, 182, 150), 0.05); P.outline(0.4); });
  itemTile('raw_gold', P => { P.ellipse(8, 9, 5.5, 4.5, rgb(225, 175, 40), 0.1); P.ellipse(6, 7, 2.5, 2, rgb(250, 215, 80), 0.05); P.outline(0.4); });
  itemTile('flint', P => {
    P.pattern(['................', '................', '.......hh.......', '......hhhh......', '.....hlhhhh.....', '.....lhhhhhh....', '....hhhhhhhh....',
      '....hhhhhhhhh...', '...hhhhhhhhhh...', '....hhhhhhhh....', '.....hhhhhh.....', '.......hh.......'], { h: rgb(70, 70, 70), l: rgb(120, 120, 120) });
    P.outline(0.4);
  });
  itemTile('wheat', P => {
    for (let i = 0; i < 5; i++) { P.line(4 + i * 2, 14, 6 + i, 3, rgb(195, 165, 70)); P.set(6 + i, 3, rgb(150, 120, 40)); P.set(6 + i, 4, rgb(220, 190, 90)); }
    P.rect(6, 10, 5, 1, rgb(110, 90, 40));
    P.outline(0.4);
  });
  itemTile('wheat_seeds', P => { for (let i = 0; i < 7; i++) { const x = 4 + (P.r() * 8 | 0), y = 5 + (P.r() * 8 | 0); P.set(x, y, rgb(80, 150, 40)); P.set(x + 1, y, rgb(60, 120, 30)); } P.outline(0.4); });
  itemTile('bread', P => { P.ellipse(8, 9, 6.5, 3.5, rgb(190, 130, 60), 0.05); for (const x of [5, 8, 11]) P.line(x, 7, x - 1, 10, rgb(230, 180, 100)); P.outline(0.35); });
  const apple = (c, hl) => P => {
    P.ellipse(8, 9.5, 5.5, 5, c, 0.06); P.set(6, 7, hl); P.set(5, 8, hl);
    P.line(8, 4, 8, 3, rgb(90, 60, 30)); P.set(9, 3, rgb(60, 140, 40)); P.set(10, 3, rgb(60, 140, 40)); P.set(10, 2, rgb(60, 140, 40));
    P.outline(0.35);
  };
  itemTile('apple', apple(rgb(215, 30, 30), rgb(255, 160, 150)));
  itemTile('golden_apple', apple(rgb(240, 200, 40), rgb(255, 250, 190)));
  const meat = (c, fat) => P => { P.ellipse(8, 8.5, 6, 4.5, c, 0.08); P.ellipse(10, 7, 2, 1.5, fat, 0.03); P.outline(0.35); };
  itemTile('porkchop', meat(rgb(240, 140, 140), rgb(255, 225, 225)));
  itemTile('cooked_porkchop', meat(rgb(190, 120, 70), rgb(230, 200, 160)));
  itemTile('beef', meat(rgb(200, 45, 40), rgb(240, 200, 200)));
  itemTile('cooked_beef', meat(rgb(120, 70, 40), rgb(160, 110, 70)));
  itemTile('mutton', meat(rgb(210, 70, 60), rgb(245, 230, 220)));
  itemTile('cooked_mutton', meat(rgb(140, 80, 45), rgb(200, 160, 120)));
  const drum = (c, b) => P => { P.ellipse(9, 7, 4.5, 4, c, 0.06); P.line(6, 10, 3, 13, b); P.line(5, 10, 3, 12, b); P.set(2, 14, rgb(240, 240, 230)); P.set(3, 14, rgb(240, 240, 230)); P.outline(0.35); };
  itemTile('chicken', drum(rgb(245, 200, 190), rgb(235, 190, 180)));
  itemTile('cooked_chicken', drum(rgb(200, 140, 70), rgb(180, 120, 60)));
  itemTile('rotten_flesh', P => { P.ellipse(8, 8.5, 6, 5, rgb(130, 90, 60), 0.1); P.specks(12, rgb(90, 120, 50)); clipToShape(P); P.outline(0.35); });
  itemTile('leather', P => {
    P.pattern(['................', '................', '...hhhhhhhhhh...', '..hhhhhhhhhhhh..', '..hlhhhhhhhhhh..', '..hhhhhhhhhhhh..', '...hhhhhhhhhhh..', '...hhhhhhhhhh...',
      '..hhhhhhhhhhh...', '..hhhhhhhhhhhh..', '..hhhhhhhhhhhh..', '...hhhh..hhhh...'], { h: rgb(150, 85, 50), l: rgb(190, 120, 80) });
    P.outline(0.4);
  });
  itemTile('feather', P => { P.line(3, 13, 12, 3, rgb(200, 200, 200)); for (let i = 0; i < 8; i++) { P.line(5 + i, 10 - i, 7 + i, 12 - i, rgb(245, 245, 245)); } P.outline(0.5); });
  itemTile('string', P => { for (let i = 0; i < 12; i++) P.set(2 + i, 8 + Math.round(Math.sin(i * 0.9) * 3), rgb(230, 230, 230)); P.outline(0.5); });
  itemTile('bone', P => { P.line(4, 12, 11, 5, rgb(235, 232, 215)); P.line(5, 12, 12, 5, rgb(215, 210, 190)); for (const [x, y] of [[3, 11], [3, 13], [5, 13], [11, 3], [13, 5], [13, 3]]) P.set(x, y, rgb(240, 238, 225)); P.outline(0.45); });
  itemTile('bone_meal', P => { pile(P, rgb(240, 240, 235)); P.outline(0.6); });
  itemTile('gunpowder', P => { pile(P, rgb(90, 90, 90)); P.outline(0.5); });
  itemTile('sugar', P => { pile(P, rgb(250, 250, 250)); P.outline(0.7); });
  itemTile('clay_ball', P => { P.ellipse(8, 9, 5, 4.5, rgb(165, 170, 185), 0.04); P.outline(0.5); });
  itemTile('snowball', P => { P.ellipse(8, 8.5, 5, 5, rgb(245, 250, 255), 0.02); P.outline(0.7); });
  itemTile('paper', P => { P.rect(3, 2, 10, 12, rgb(240, 240, 235), 0.02); for (const y of [5, 8, 11]) P.line(5, y, 11, y, rgb(200, 200, 200)); P.outline(0.6); });
  itemTile('book', P => { P.rect(3, 2, 10, 12, rgb(120, 60, 30), 0.04); P.rect(4, 3, 8, 1, rgb(230, 225, 210)); P.rect(11, 3, 2, 10, rgb(235, 230, 215)); P.rect(6, 6, 3, 2, rgb(200, 170, 70)); P.outline(0.45); });
  itemTile('bowl', P => { for (let y = 8; y < 13; y++) { const w = 6 - (y - 8) * 0.9; P.line(Math.round(8 - w), y, Math.round(7 + w), y, y === 8 ? rgb(80, 55, 30) : rgb(140, 100, 55)); } P.outline(0.4); });
  itemTile('egg', P => { P.ellipse(8, 9, 4, 5, rgb(225, 205, 170), 0.04); P.outline(0.5); });
  const bucket = (fill) => P => {
    for (let y = 4; y < 14; y++) { const w = 5.5 - (y - 4) * 0.25; for (let x = Math.round(8 - w); x < Math.round(8 + w); x++) P.set(x, y, P.vary(rgb(170, 170, 170), 0.05)); }
    for (let x = 2; x < 14; x++) P.set(x, 4, rgb(120, 120, 120));
    if (fill) P.rect(3, 5, 10, 2, fill, 0.05);
    P.outline(0.4);
  };
  itemTile('bucket', bucket(null));
  itemTile('water_bucket', bucket(rgb(50, 90, 220)));
  itemTile('lava_bucket', bucket(rgb(235, 110, 20)));
  itemTile('milk_bucket', bucket(rgb(250, 250, 250)));
  itemTile('flint_and_steel', P => {
    for (let a = 0; a < 6.28; a += 0.2) P.set(Math.round(5 + Math.cos(a) * 3), Math.round(10 + Math.sin(a) * 3), rgb(160, 160, 160));
    P.rect(9, 3, 4, 5, rgb(70, 70, 70)); P.set(9, 3, rgb(120, 120, 120));
    P.outline(0.4);
  });
  itemTile('shears', P => {
    P.line(3, 12, 11, 4, rgb(210, 210, 210)); P.line(4, 4, 12, 12, rgb(190, 190, 190));
    P.rect(2, 11, 3, 3, rgb(150, 60, 50)); P.rect(11, 11, 3, 3, rgb(150, 60, 50));
    P.outline(0.4);
  });
  itemTile('arrow', P => {
    P.line(3, 12, 11, 4, STICK);
    P.set(12, 3, rgb(90, 90, 90)); P.set(11, 3, rgb(120, 120, 120)); P.set(12, 4, rgb(120, 120, 120)); P.set(13, 2, rgb(70, 70, 70));
    P.set(2, 12, rgb(240, 240, 240)); P.set(3, 13, rgb(240, 240, 240)); P.set(2, 14, rgb(220, 220, 220)); P.set(1, 13, rgb(220, 220, 220));
    P.outline(0.45);
  });
  itemTile('bow', P => {
    for (let t = 0; t <= 1; t += 0.05) { const a = -0.3 + t * 2.17; P.set(Math.round(2 + Math.cos(a) * 11), Math.round(13 - Math.sin(a) * 11), STICK); }
    P.line(3, 13, 13, 3, rgb(220, 220, 220));
    P.outline(0.4);
  });
  itemTile('red_dye', P => { P.ellipse(8, 9, 4.5, 5, rgb(200, 30, 30), 0.06); P.rect(7, 2, 2, 3, rgb(200, 200, 200)); P.outline(0.4); });
  itemTile('green_dye', P => { P.ellipse(8, 9, 4.5, 5, rgb(70, 110, 30), 0.06); P.rect(7, 2, 2, 3, rgb(200, 200, 200)); P.outline(0.4); });
  itemTile('pumpkin_seeds', P => { for (let i = 0; i < 6; i++) { const x = 4 + (P.r() * 8 | 0), y = 5 + (P.r() * 8 | 0); P.set(x, y, rgb(230, 220, 170)); P.set(x, y + 1, rgb(210, 195, 140)); } P.outline(0.45); });
  itemTile('pumpkin_pie', P => { P.ellipse(8, 9, 6.5, 4, rgb(220, 140, 60), 0.05); P.ellipse(8, 8, 5, 2.5, rgb(240, 170, 80), 0.05); P.outline(0.4); });
  itemTile('oak_door_item', P => { P.rect(4, 1, 8, 14, rgb(170, 132, 80), 0.05); P.rect(5, 2, 2, 3, rgb(110, 82, 45)); P.rect(9, 2, 2, 3, rgb(110, 82, 45)); P.set(10, 8, rgb(60, 60, 60)); P.outline(0.45); });
  itemTile('bed_item', P => { P.rect(1, 6, 14, 4, rgb(160, 39, 34), 0.05); P.rect(1, 6, 4, 2, rgb(235, 235, 235)); P.rect(1, 10, 14, 2, rgb(150, 115, 66)); P.rect(1, 12, 2, 2, rgb(130, 100, 56)); P.rect(13, 12, 2, 2, rgb(130, 100, 56)); P.outline(0.45); });
  for (const mat of Object.keys(TOOL_COLORS)) for (const kind of ['sword', 'shovel', 'pickaxe', 'axe', 'hoe']) toolTile(mat + '_' + kind, kind, mat);
  for (const mat of Object.keys(ARMOR_COLORS)) for (const kind of ['helmet', 'chestplate', 'leggings', 'boots']) armorTile(mat + '_' + kind, kind, mat);
}

function clipToShape() { /* Platzhalter: Ellipsen sind bereits begrenzt */ }

// ---------------------------------------------------------------- Himmel, Wolken
function makeSunCanvas(moon) {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d');
  if (moon) {
    g.fillStyle = '#d8dce8'; g.fillRect(8, 8, 16, 16);
    g.fillStyle = '#b4b8c6'; g.fillRect(11, 11, 4, 4); g.fillRect(18, 16, 3, 3); g.fillRect(13, 19, 2, 2);
  } else {
    g.fillStyle = 'rgba(255,250,200,0.35)'; g.fillRect(2, 2, 28, 28);
    g.fillStyle = '#fff6b0'; g.fillRect(6, 6, 20, 20);
    g.fillStyle = '#ffffe6'; g.fillRect(9, 9, 14, 14);
  }
  return c;
}

function makeCloudCanvas(seed) {
  const n = 64;
  const c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d');
  const r = mulberry32(seed + 99);
  // Kachelbares Werte-Rauschen, damit die Wolken nahtlos wiederholt werden koennen
  const layer = (cells) => {
    const grid = [];
    for (let i = 0; i < cells * cells; i++) grid.push(r());
    return (x, y) => {
      const fx = x / n * cells, fy = y / n * cells;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const at = (a, b) => grid[((b % cells) * cells) + (a % cells)];
      const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
      const bot = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
      return top * (1 - ty) + bot * ty;
    };
  };
  const a = layer(8), b = layer(16);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = a(x, y) * 0.7 + b(x, y) * 0.3;
    if (v > 0.58) { g.fillStyle = '#ffffff'; g.fillRect(x, y, 1, 1); }
  }
  return c;
}

buildBlockTextures();
buildItemTextures();

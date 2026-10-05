'use strict';
// Welt: Chunks, Generierung, Licht und Mesh-Erzeugung.

const CS = 16, WH = 128, SEA = 62;
const BIOME = { OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, BIRCH: 4, DESERT: 5, TAIGA: 6, SNOWY: 7, MOUNTAINS: 8, FROZEN_OCEAN: 9 };
const BIOME_DE = ['Ozean', 'Strand', 'Ebene', 'Wald', 'Birkenwald', 'Wueste', 'Taiga', 'Verschneite Ebene', 'Berge', 'Vereister Ozean'];

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const smooth = (a, b, v) => { const x = clamp((v - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };

class Chunk {
  constructor(cx, cz) {
    this.cx = cx; this.cz = cz;
    this.blocks = new Uint8Array(CS * CS * WH);
    this.meta = new Uint8Array(CS * CS * WH);
    this.light = new Uint8Array(CS * CS * WH); // Himmelslicht << 4 | Blocklicht
    this.biome = new Uint8Array(256);
    this.nb = [null, null, null, null]; // +x, -x, +z, -z
    this.dirty = true;
    this.meshes = null;
    this.maxY = 0;
  }
}

// ---------------------------------------------------------------- Formen
const EMPTY = [];
const BOX_CACHE = new Map();
function edgeBox(d, th) {
  const [dx, , dz] = FACING[d];
  if (dx === 1) return [1 - th, 0, 0, 1, 1, 1];
  if (dx === -1) return [0, 0, 0, th, 1, 1];
  if (dz === 1) return [0, 0, 1 - th, 1, 1, 1];
  return [0, 0, 0, 1, 1, th];
}
function computeBoxes(id, meta) {
  const b = BLOCKS[id];
  switch (b.shape) {
    case 'none': case 'fluid': return EMPTY;
    case 'cube': return [[0, 0, 0, 1, 1, 1]];
    case 'cross': return [[0.15, 0, 0.15, 0.85, b.crop !== undefined ? 0.2 + 0.2 * b.crop : 0.8, 0.85]];
    case 'torch': {
      if (!meta) return [[7 / 16, 0, 7 / 16, 9 / 16, 10 / 16, 9 / 16]];
      const [dx, , dz] = FACING[meta - 1]; const o = 6 / 16;
      return [[7 / 16 + dx * o, 3 / 16, 7 / 16 + dz * o, 9 / 16 + dx * o, 13 / 16, 9 / 16 + dz * o]];
    }
    case 'slab': return meta === 2 ? [[0, 0, 0, 1, 1, 1]] : meta === 1 ? [[0, 0.5, 0, 1, 1, 1]] : [[0, 0, 0, 1, 0.5, 1]];
    case 'stairs': {
      const up = meta & 4, [dx, , dz] = FACING[meta & 3];
      const base = up ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1];
      const y0 = up ? 0 : 0.5, y1 = up ? 0.5 : 1;
      let x0 = 0, x1 = 1, z0 = 0, z1 = 1;
      if (dx === 1) x0 = 0.5; if (dx === -1) x1 = 0.5; if (dz === 1) z0 = 0.5; if (dz === -1) z1 = 0.5;
      return [base, [x0, y0, z0, x1, y1, z1]];
    }
    case 'door': { const f = meta & 3; return [edgeBox(meta & 4 ? (f + 1) % 4 : (f + 2) % 4, 3 / 16)]; }
    case 'ladder': return [edgeBox(meta & 3, 2 / 16)];
    case 'bed': return [[0, 0, 0, 1, 9 / 16, 1]];
    case 'farmland': return [[0, 0, 0, 1, 15 / 16, 1]];
    case 'cactus': return [[1 / 16, 0, 1 / 16, 15 / 16, 1, 15 / 16]];
    case 'carpet': return [[0, 0, 0, 1, 1 / 16, 1]];
    case 'cake': return [[(1 + 2 * meta) / 16, 0, 1 / 16, 15 / 16, 0.5, 15 / 16]];
    case 'trapdoor': {
      if (meta & 4) return [edgeBox(meta & 3, 3 / 16)];
      return meta & 8 ? [[0, 13 / 16, 0, 1, 1, 1]] : [[0, 0, 0, 1, 3 / 16, 1]];
    }
    case 'fence': case 'pane': {
      const f = b.shape === 'fence';
      const a = f ? 6 / 16 : 7 / 16, c = f ? 10 / 16 : 9 / 16, r0 = 7 / 16, r1 = 9 / 16;
      const out = [[a, 0, a, c, 1, c]];
      const ys = f ? [[6 / 16, 9 / 16], [12 / 16, 15 / 16]] : [[0, 1]];
      for (const [y0, y1] of ys) {
        if (meta & 1) out.push([r0, y0, c, r1, y1, 1]);
        if (meta & 2) out.push([0, y0, r0, a, y1, r1]);
        if (meta & 4) out.push([r0, y0, 0, r1, y1, a]);
        if (meta & 8) out.push([c, y0, r0, 1, y1, r1]);
      }
      return out;
    }
    case 'gate': {
      const ew = (meta & 3) === 1 || (meta & 3) === 3;
      const rot = (bx) => ew ? [bx[2], bx[1], bx[0], bx[5], bx[4], bx[3]] : bx;
      const posts = [[0, 5 / 16, 7 / 16, 2 / 16, 1, 9 / 16], [14 / 16, 5 / 16, 7 / 16, 1, 1, 9 / 16]];
      const rails = meta & 4
        ? [[0, 6 / 16, 9 / 16, 2 / 16, 15 / 16, 1], [14 / 16, 6 / 16, 9 / 16, 1, 15 / 16, 1]]
        : [[2 / 16, 6 / 16, 7 / 16, 14 / 16, 9 / 16, 9 / 16], [2 / 16, 12 / 16, 7 / 16, 14 / 16, 15 / 16, 9 / 16]];
      return posts.concat(rails).map(rot);
    }
  }
  return [[0, 0, 0, 1, 1, 1]];
}
const COLL_CACHE = new Map();
function computeCollision(id, meta) {
  const b = BLOCKS[id];
  if (b.shape === 'fence') {
    const out = [[6 / 16, 0, 6 / 16, 10 / 16, 1.5, 10 / 16]];
    if (meta & 1) out.push([6 / 16, 0, 10 / 16, 10 / 16, 1.5, 1]);
    if (meta & 2) out.push([0, 0, 6 / 16, 6 / 16, 1.5, 10 / 16]);
    if (meta & 4) out.push([6 / 16, 0, 0, 10 / 16, 1.5, 6 / 16]);
    if (meta & 8) out.push([10 / 16, 0, 6 / 16, 1, 1.5, 10 / 16]);
    return out;
  }
  if (b.shape === 'gate') {
    if (meta & 4) return EMPTY;
    const ew = (meta & 3) === 1 || (meta & 3) === 3;
    return [ew ? [7 / 16, 0, 0, 9 / 16, 1.5, 1] : [0, 0, 7 / 16, 1, 1.5, 9 / 16]];
  }
  return blockBoxes(id, meta);
}
function blockBoxes(id, meta) {
  const k = id * 256 + meta;
  let r = BOX_CACHE.get(k);
  if (!r) { r = computeBoxes(id, meta); BOX_CACHE.set(k, r); }
  return r;
}
function collisionBoxes(id, meta) {
  if (!BLOCKS[id].solid) return EMPTY;
  const k = id * 256 + meta;
  let r = COLL_CACHE.get(k);
  if (!r) { r = computeCollision(id, meta); COLL_CACHE.set(k, r); }
  return r;
}

// ---------------------------------------------------------------- Generator
class Generator {
  constructor(seed) {
    this.seed = seed;
    this.cont = new Simplex(seed); this.ero = new Simplex(seed + 1); this.det = new Simplex(seed + 2);
    this.temp = new Simplex(seed + 3); this.hum = new Simplex(seed + 4);
    this.c1 = new Simplex(seed + 5); this.c2 = new Simplex(seed + 6); this.c3 = new Simplex(seed + 7);
  }

  column(wx, wz) {
    const c = this.cont.fbm2(wx / 700, wz / 700, 4) * 1.4 + 0.12;
    const e = this.ero.fbm2(wx / 520, wz / 520, 3) * 1.4;
    const d = this.det.fbm2(wx / 90, wz / 90, 4);
    let h = c < 0 ? SEA + 3 + c * 55 : SEA + 3 + c * 18;
    h += d * (5 + 6 * Math.max(0, c));
    const m = smooth(0.12, 0.55, e) * smooth(0, 0.2, c);
    h += m * 46 + m * d * 10;
    h = Math.floor(clamp(h, 6, 118));
    const tp = this.temp.fbm2(wx / 650, wz / 650, 2) * 1.5, hu = this.hum.fbm2(wx / 550, wz / 550, 2) * 1.5;
    let biome;
    if (h < SEA) biome = tp < -0.5 ? BIOME.FROZEN_OCEAN : BIOME.OCEAN;
    else if (h <= SEA + 1 && c < 0.1) biome = tp < -0.35 ? BIOME.SNOWY : BIOME.BEACH;
    else if (m > 0.45 || h > 95) biome = BIOME.MOUNTAINS;
    else if (tp > 0.3 && hu < 0.15) biome = BIOME.DESERT;
    else if (tp < -0.3) biome = BIOME.SNOWY;
    else if (tp < -0.1) biome = BIOME.TAIGA;
    else if (hu > 0.35) biome = BIOME.BIRCH;
    else if (hu > 0.08) biome = BIOME.FOREST;
    else biome = BIOME.PLAINS;
    return { h, biome };
  }

  generate(chunk) {
    const { cx, cz } = chunk;
    const bl = chunk.blocks;
    const rand = mulberry32(hash3(this.seed, cx, 7, cz));
    const cols = [];
    let maxY = 0;
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const wx = cx * 16 + x, wz = cz * 16 + z;
      const col = this.column(wx, wz);
      cols.push(col);
      const { h, biome } = col;
      chunk.biome[z * 16 + x] = biome;
      let top = B.grass_block, fill = B.dirt, deep = 0;
      if (biome === BIOME.DESERT) { top = B.sand; fill = B.sand; deep = B.sandstone; }
      else if (biome === BIOME.BEACH) { top = B.sand; fill = B.sand; deep = B.sandstone; }
      else if (biome === BIOME.OCEAN || biome === BIOME.FROZEN_OCEAN) {
        const g = this.det.noise2(wx / 12, wz / 12);
        top = h >= SEA - 4 ? B.sand : g > 0.25 ? B.gravel : g < -0.4 ? B.clay : B.sand; fill = top === B.clay ? B.clay : B.sand;
      } else if (biome === BIOME.MOUNTAINS) {
        if (h >= 100) { top = B.snow_block; fill = B.stone; }
        else if (h > 84) { top = B.stone; fill = B.stone; }
      } else if (biome === BIOME.SNOWY) top = B.snowy_grass;
      for (let y = 0; y <= h; y++) {
        let id;
        if (y === 0) id = B.bedrock;
        else if (y <= 4 && rand() < (5 - y) / 5) id = B.bedrock;
        else if (y === h) id = top;
        else if (y >= h - 3) id = fill;
        else if (deep && y >= h - 7) id = deep;
        else id = B.stone;
        bl[(y << 8) | (z << 4) | x] = id;
      }
      for (let y = h + 1; y <= SEA; y++) {
        bl[(y << 8) | (z << 4) | x] = (y === SEA && (biome === BIOME.FROZEN_OCEAN || biome === BIOME.SNOWY)) ? B.ice : B.water;
      }
      maxY = Math.max(maxY, h, SEA);
    }
    this.carveCaves(chunk, cols);
    this.ores(chunk, rand);
    this.decorate(chunk, cols, rand);
    chunk.maxY = Math.min(WH - 1, maxY + 12);
    return this.animals(chunk, cols, rand);
  }

  carveCaves(chunk, cols) {
    const bl = chunk.blocks;
    const { cx, cz } = chunk;
    // Gitter neu berechnen und Werte interpolieren
    const N = 5, NY = WH / 4 + 1;
    const sp = new Float32Array(N * N * NY), ch = new Float32Array(N * N * NY);
    for (let gx = 0; gx < N; gx++) for (let gz = 0; gz < N; gz++) for (let gy = 0; gy < NY; gy++) {
      const wx = cx * 16 + gx * 4, wz = cz * 16 + gz * 4, y = gy * 4;
      const a = this.c1.noise3(wx / 34, y / 22, wz / 34), b = this.c2.noise3(wx / 34, y / 22, wz / 34);
      const i = (gy * N + gz) * N + gx;
      sp[i] = a * a + b * b;
      ch[i] = this.c3.noise3(wx / 70, y / 34, wz / 70);
    }
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const { h } = cols[z * 16 + x];
      const wet = h < SEA + 1;
      for (let y = 1; y <= h; y++) {
        if (wet && y > h - 6) break;
        const i = (y << 8) | (z << 4) | x;
        const id = bl[i];
        if (id === B.bedrock || id === B.water) continue;
        const fx = x / 4, fy = y / 4, fz = z / 4;
        const x0 = Math.min(fx | 0, N - 2), y0 = Math.min(fy | 0, NY - 2), z0 = Math.min(fz | 0, N - 2);
        const tx = fx - x0, ty = fy - y0, tz = fz - z0;
        const tri = (arr) => {
          const g = (a, b, c) => arr[((y0 + b) * N + z0 + c) * N + x0 + a];
          const l = (a, b, s) => a + (b - a) * s;
          return l(l(l(g(0, 0, 0), g(1, 0, 0), tx), l(g(0, 0, 1), g(1, 0, 1), tx), tz),
            l(l(g(0, 1, 0), g(1, 1, 0), tx), l(g(0, 1, 1), g(1, 1, 1), tx), tz), ty);
        };
        const s = tri(sp);
        let carve = s < (y > h - 7 ? 0.0025 : 0.0065 + (y < 30 ? 0.003 : 0));
        if (!carve && y < 52) carve = tri(ch) > 0.62 - (52 - y) * 0.002;
        if (carve) {
          // Wasser darf nicht direkt ueber der Hoehle liegen
          if (y + 1 <= WH - 1 && bl[i + 256] === B.water) continue;
          bl[i] = y < 11 ? B.lava : 0;
          if (y === h - 1 || y === h) { /* Hoehleneingang an der Oberflaeche */ }
        }
      }
      // Gras, das auf Luft liegt, wird zu Erde unten nicht noetig; Erde unter neuem Loch wird Gras
      for (let y = h - 1; y > 1; y--) {
        const i = (y << 8) | (z << 4) | x;
        if (bl[i] === B.dirt && bl[i + 256] === 0 && y >= h - 4) { bl[i] = B.grass_block; break; }
        if (bl[i] !== 0) break;
      }
    }
  }

  ores(chunk, rand) {
    const bl = chunk.blocks;
    const vein = (id, count, size, minY, maxY, replace) => {
      for (let n = 0; n < count; n++) {
        let x = rand() * 16 | 0, z = rand() * 16 | 0, y = minY + (rand() * (maxY - minY) | 0);
        const s = Math.max(1, Math.round(size * (0.5 + rand() * 0.7)));
        for (let k = 0; k < s; k++) {
          if (x >= 0 && x < 16 && z >= 0 && z < 16 && y > 0 && y < WH) {
            const i = (y << 8) | (z << 4) | x;
            if (replace ? replace.includes(bl[i]) : bl[i] === B.stone) bl[i] = id;
          }
          const a = rand() * 3 | 0, d = rand() < 0.5 ? -1 : 1;
          if (a === 0) x += d; else if (a === 1) y += d; else z += d;
        }
      }
    };
    vein(B.dirt, 5, 28, 5, 100);
    vein(B.gravel, 4, 28, 5, 100);
    vein(B.granite, 4, 34, 5, 90);
    vein(B.diorite, 4, 34, 5, 90);
    vein(B.andesite, 4, 34, 5, 90);
    vein(B.coal_ore, 20, 14, 5, 115);
    vein(B.iron_ore, 18, 9, 5, 70);
    vein(B.gold_ore, 3, 9, 5, 32);
    vein(B.redstone_ore, 7, 8, 5, 16);
    vein(B.diamond_ore, 1, 8, 5, 16);
    vein(B.lapis_ore, 2, 7, 5, 32);
  }

  placeTree(chunk, wx, baseY, wz, type, r) {
    const cx0 = chunk.cx * 16, cz0 = chunk.cz * 16;
    const bl = chunk.blocks;
    const put = (x, y, z, id, force) => {
      const lx = x - cx0, lz = z - cz0;
      if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y < 1 || y >= WH) return;
      const i = (y << 8) | (lz << 4) | lx;
      const cur = bl[i];
      if (cur === 0 || BLOCKS[cur].replaceable && cur !== B.water || (force && BLOCKS[cur].pass === 'cutout')) bl[i] = id;
      if (y > chunk.maxY) chunk.maxY = Math.min(WH - 1, y);
    };
    if (type === 'spruce') {
      const th = 6 + (r() * 4 | 0);
      for (let k = 0; k < th; k++) put(wx, baseY + k, wz, B.spruce_log, true);
      put(wx, baseY + th, wz, B.spruce_leaves);
      for (let dy = th - 1; dy >= 2; dy--) {
        const k = th - 1 - dy;
        const rad = k % 2 === 0 ? 1 : Math.min(3, 1 + (k >> 1));
        for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
          if (Math.abs(dx) + Math.abs(dz) > rad + (rad > 1 ? 1 : 0)) continue;
          if (dx === 0 && dz === 0) continue;
          put(wx + dx, baseY + dy, wz + dz, B.spruce_leaves);
        }
      }
      return;
    }
    const log = type === 'birch' ? B.birch_log : B.oak_log;
    const leaf = type === 'birch' ? B.birch_leaves : B.oak_leaves;
    const th = (type === 'birch' ? 5 : 4) + (r() * 3 | 0);
    for (let dy = th - 3; dy <= th; dy++) {
      const rad = dy >= th - 1 ? 1 : 2;
      for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
        const corner = Math.abs(dx) === rad && Math.abs(dz) === rad;
        if (corner && (dy === th || r() < 0.5)) continue;
        put(wx + dx, baseY + dy, wz + dz, leaf);
      }
    }
    for (let k = 0; k < th; k++) put(wx, baseY + k, wz, log, true);
  }

  decorate(chunk, cols, rand) {
    const { cx, cz } = chunk;
    const bl = chunk.blocks;
    // Pflanzen in diesem Chunk
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const { h, biome } = cols[z * 16 + x];
      if (h + 1 >= WH) continue;
      const topI = (h << 8) | (z << 4) | x, upI = topI + 256;
      const top = bl[topI];
      if (bl[upI] !== 0) continue;
      const r = rand();
      if (top === B.grass_block) {
        if (biome === BIOME.PLAINS) {
          if (r < 0.22) bl[upI] = B.short_grass;
          else if (r < 0.235) bl[upI] = B.dandelion;
          else if (r < 0.25) bl[upI] = B.poppy;
          else if (r < 0.2505) bl[upI] = B.pumpkin;
        } else if (r < 0.1) bl[upI] = B.short_grass;
        else if (r < 0.105) bl[upI] = rand() < 0.5 ? B.dandelion : B.poppy;
      } else if (top === B.sand && biome === BIOME.DESERT) {
        if (r < 0.006 && x > 0 && x < 15 && z > 0 && z < 15) {
          const ht = 1 + (rand() * 3 | 0);
          for (let k = 1; k <= ht; k++) bl[topI + 256 * k] = B.cactus;
        } else if (r < 0.014) bl[upI] = B.dead_bush;
      }
      // Zuckerrohr am Wasser
      if ((top === B.sand || top === B.grass_block || top === B.dirt) && h === SEA && r > 0.85) {
        let water = false;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, nz = z + dz;
          if (nx >= 0 && nx < 16 && nz >= 0 && nz < 16 && bl[(SEA << 8) | (nz << 4) | nx] === B.water) water = true;
        }
        if (water) { const ht = 1 + (rand() * 3 | 0); for (let k = 1; k <= ht; k++) bl[topI + 256 * k] = B.sugar_cane; }
      }
    }
    // Baeume (auch aus Nachbar-Chunks, damit Kronen ueber die Grenze ragen)
    for (let ncx = cx - 1; ncx <= cx + 1; ncx++) for (let ncz = cz - 1; ncz <= cz + 1; ncz++) {
      const tr = mulberry32(hash3(this.seed ^ 0x51ed27, ncx, 3, ncz));
      const mid = this.column(ncx * 16 + 8, ncz * 16 + 8).biome;
      const count = { 2: tr() < 0.35 ? 1 : 0, 3: 7, 4: 7, 6: 6, 7: 2, 8: 1 }[mid] || 0;
      for (let n = 0; n < count; n++) {
        const lx = 2 + (tr() * 12 | 0), lz = 2 + (tr() * 12 | 0);
        const wx = ncx * 16 + lx, wz = ncz * 16 + lz;
        if (Math.abs(wx - cx * 16 - 8) > 12 || Math.abs(wz - cz * 16 - 8) > 12) { tr(); continue; }
        const { h, biome } = this.column(wx, wz);
        const ok = h >= SEA && h < WH - 14 && [BIOME.PLAINS, BIOME.FOREST, BIOME.BIRCH, BIOME.TAIGA, BIOME.SNOWY, BIOME.MOUNTAINS].includes(biome) && h < 92;
        const r = mulberry32(hash3(this.seed, wx, h, wz));
        if (!ok) continue;
        // Untergrund pruefen, falls im eigenen Chunk
        const lx2 = wx - cx * 16, lz2 = wz - cz * 16;
        if (lx2 >= 0 && lx2 < 16 && lz2 >= 0 && lz2 < 16) {
          const g = bl[(h << 8) | (lz2 << 4) | lx2];
          if (g !== B.grass_block && g !== B.snowy_grass && g !== B.dirt) continue;
          bl[(h << 8) | (lz2 << 4) | lx2] = B.dirt;
        }
        let type = 'oak';
        if (biome === BIOME.TAIGA || biome === BIOME.SNOWY) type = 'spruce';
        else if (biome === BIOME.BIRCH) type = r() < 0.85 ? 'birch' : 'oak';
        else if (biome === BIOME.FOREST) type = r() < 0.2 ? 'birch' : 'oak';
        else if (biome === BIOME.MOUNTAINS) type = r() < 0.6 ? 'spruce' : 'oak';
        this.placeTree(chunk, wx, h + 1, wz, type, r);
      }
    }
  }

  animals(chunk, cols, rand) {
    const out = [];
    if (rand() > 0.1) return out;
    const types = ['pig', 'cow', 'chicken', 'sheep'];
    const type = types[rand() * 4 | 0];
    const n = 2 + (rand() * 3 | 0);
    for (let k = 0; k < n; k++) {
      const x = rand() * 16 | 0, z = rand() * 16 | 0;
      const { h } = cols[z * 16 + x];
      const id = chunk.blocks[(h << 8) | (z << 4) | x];
      if (id === B.grass_block || id === B.snowy_grass) out.push({ type, x: chunk.cx * 16 + x + 0.5, y: h + 1, z: chunk.cz * 16 + z + 0.5 });
    }
    return out;
  }

  findSpawn() {
    for (let r = 0; r < 600; r += 8) {
      for (let a = 0; a < 16; a++) {
        const x = Math.round(Math.cos(a / 16 * Math.PI * 2) * r), z = Math.round(Math.sin(a / 16 * Math.PI * 2) * r);
        const c = this.column(x, z);
        if (c.h > SEA && c.biome !== BIOME.OCEAN && c.biome !== BIOME.MOUNTAINS) return { x: x + 0.5, y: c.h + 1, z: z + 0.5 };
      }
    }
    return { x: 0.5, y: 90, z: 0.5 };
  }
}

// ---------------------------------------------------------------- Welt
class World {
  constructor(seed, mods) {
    this.seed = seed;
    this.gen = new Generator(seed);
    this.chunks = new Map();
    this.mods = mods || {};          // Aenderungen gegenueber der generierten Welt
    this.updates = [];               // Positionen fuer Nachbar-Updates (Wasser, Sand ...)
    this.lightQ = { c: [], i: [] };
  }

  key(cx, cz) { return cx * 65536 + cz; }
  getChunk(cx, cz) { return this.chunks.get(cx * 65536 + cz); }
  chunkAt(x, z) { return this.chunks.get((x >> 4) * 65536 + (z >> 4)); }

  getBlock(x, y, z) {
    if (y < 0 || y >= WH) return 0;
    const c = this.chunks.get((x >> 4) * 65536 + (z >> 4));
    return c ? c.blocks[(y << 8) | ((z & 15) << 4) | (x & 15)] : 0;
  }
  getMeta(x, y, z) {
    if (y < 0 || y >= WH) return 0;
    const c = this.chunks.get((x >> 4) * 65536 + (z >> 4));
    return c ? c.meta[(y << 8) | ((z & 15) << 4) | (x & 15)] : 0;
  }
  getLight(x, y, z) {
    if (y >= WH) return 0xF0;
    if (y < 0) return 0;
    const c = this.chunks.get((x >> 4) * 65536 + (z >> 4));
    return c ? c.light[(y << 8) | ((z & 15) << 4) | (x & 15)] : 0xF0;
  }
  isLoaded(x, z) { return this.chunks.has((x >> 4) * 65536 + (z >> 4)); }

  loadChunk(cx, cz) {
    const c = new Chunk(cx, cz);
    const spawns = this.gen.generate(c);
    const m = this.mods[this.key(cx, cz)];
    if (m) for (const k in m) {
      const v = m[k];
      c.blocks[k] = v & 255; c.meta[k] = v >> 8;
      const y = k >> 8;
      if ((v & 255) && y > c.maxY) c.maxY = Math.min(WH - 1, y + 1);
    }
    this.chunks.set(this.key(cx, cz), c);
    const n = [this.getChunk(cx + 1, cz), this.getChunk(cx - 1, cz), this.getChunk(cx, cz + 1), this.getChunk(cx, cz - 1)];
    c.nb = n;
    if (n[0]) { n[0].nb[1] = c; n[0].dirty = true; }
    if (n[1]) { n[1].nb[0] = c; n[1].dirty = true; }
    if (n[2]) { n[2].nb[3] = c; n[2].dirty = true; }
    if (n[3]) { n[3].nb[2] = c; n[3].dirty = true; }
    this.initLight(c);
    return spawns;
  }

  unloadChunk(c) {
    this.chunks.delete(this.key(c.cx, c.cz));
    if (c.nb[0]) c.nb[0].nb[1] = null;
    if (c.nb[1]) c.nb[1].nb[0] = null;
    if (c.nb[2]) c.nb[2].nb[3] = null;
    if (c.nb[3]) c.nb[3].nb[2] = null;
  }

  neighborsReady(c) {
    const n = c.nb;
    return n[0] && n[1] && n[2] && n[3] && n[0].nb[2] && n[0].nb[3] && n[1].nb[2] && n[1].nb[3];
  }

  // ------------------------------------------------ Licht
  initLight(c) {
    const L = c.light, bl = c.blocks;
    const h15 = new Int16Array(256);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      let lvl = 15, top = 0;
      for (let y = WH - 1; y >= 0; y--) {
        const i = (y << 8) | (z << 4) | x;
        const f = BLOCKS[bl[i]].filter;
        if (lvl > 0) {
          if (f >= 15) lvl = 0;
          else if (!(lvl === 15 && f === 0)) lvl = Math.max(0, lvl - Math.max(1, f));
        }
        if (lvl < 15 && !top) top = y + 1;
        L[i] = (lvl << 4) | BLOCKS[bl[i]].light;
      }
      h15[z * 16 + x] = top;
    }
    const skyQ = { c: [], i: [] }, blkQ = { c: [], i: [] };
    const nbH = (x, z) => {
      if (x >= 0 && x < 16 && z >= 0 && z < 16) return h15[z * 16 + x];
      return WH;
    };
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const m = Math.max(nbH(x + 1, z), nbH(x - 1, z), nbH(x, z + 1), nbH(x, z - 1));
      const lim = Math.min(WH, m === WH ? c.maxY + 2 : m);
      for (let y = 0; y < lim; y++) {
        const i = (y << 8) | (z << 4) | x;
        if ((L[i] >> 4) > 1) { skyQ.c.push(c); skyQ.i.push(i); }
        if ((L[i] & 15) > 1) { blkQ.c.push(c); blkQ.i.push(i); }
      }
    }
    // Licht der Nachbarn hereinlassen
    const border = (n, side) => {
      if (!n) return;
      for (let y = 0; y < WH; y++) for (let k = 0; k < 16; k++) {
        let x, z;
        if (side === 0) { x = 0; z = k; } else if (side === 1) { x = 15; z = k; } else if (side === 2) { x = k; z = 0; } else { x = k; z = 15; }
        const i = (y << 8) | (z << 4) | x;
        const l = n.light[i];
        if ((l >> 4) > 1) { skyQ.c.push(n); skyQ.i.push(i); }
        if ((l & 15) > 1) { blkQ.c.push(n); blkQ.i.push(i); }
      }
    };
    border(c.nb[0], 0); border(c.nb[1], 1); border(c.nb[2], 2); border(c.nb[3], 3);
    this.spread(skyQ, true);
    this.spread(blkQ, false);
  }

  spread(q, sky) {
    const qc = q.c, qi = q.i;
    for (let h = 0; h < qc.length; h++) {
      const c = qc[h], i = qi[h];
      const l = sky ? c.light[i] >> 4 : c.light[i] & 15;
      if (l <= 1) continue;
      const x = i & 15, z = (i >> 4) & 15, y = i >> 8;
      for (let d = 0; d < 6; d++) {
        let nc = c, nx = x, ny = y, nz = z;
        if (d === 0) { nx++; if (nx > 15) { nc = c.nb[0]; nx = 0; } }
        else if (d === 1) { nx--; if (nx < 0) { nc = c.nb[1]; nx = 15; } }
        else if (d === 2) { nz++; if (nz > 15) { nc = c.nb[2]; nz = 0; } }
        else if (d === 3) { nz--; if (nz < 0) { nc = c.nb[3]; nz = 15; } }
        else if (d === 4) { ny++; if (ny >= WH) continue; }
        else { ny--; if (ny < 0) continue; }
        if (!nc) continue;
        const ni = (ny << 8) | (nz << 4) | nx;
        const f = BLOCKS[nc.blocks[ni]].filter;
        if (f >= 15) continue;
        const nl = (sky && d === 5 && l === 15 && f === 0) ? 15 : l - Math.max(1, f);
        const cur = sky ? nc.light[ni] >> 4 : nc.light[ni] & 15;
        if (nl > cur) {
          nc.light[ni] = sky ? (nl << 4) | (nc.light[ni] & 15) : (nc.light[ni] & 0xF0) | nl;
          nc.dirty = true;
          qc.push(nc); qi.push(ni);
        }
      }
    }
  }

  relight(c, i) {
    for (const sky of [true, false]) {
      const rem = { c: [c], i: [i], l: [] };
      const add = { c: [], i: [] };
      const get = (cc, ii) => sky ? cc.light[ii] >> 4 : cc.light[ii] & 15;
      const set = (cc, ii, v) => { cc.light[ii] = sky ? (v << 4) | (cc.light[ii] & 15) : (cc.light[ii] & 0xF0) | v; cc.dirty = true; };
      rem.l.push(get(c, i));
      set(c, i, 0);
      for (let h = 0; h < rem.c.length; h++) {
        const cc = rem.c[h], ii = rem.i[h], lvl = rem.l[h];
        const x = ii & 15, z = (ii >> 4) & 15, y = ii >> 8;
        for (let d = 0; d < 6; d++) {
          let nc = cc, nx = x, ny = y, nz = z;
          if (d === 0) { nx++; if (nx > 15) { nc = cc.nb[0]; nx = 0; } }
          else if (d === 1) { nx--; if (nx < 0) { nc = cc.nb[1]; nx = 15; } }
          else if (d === 2) { nz++; if (nz > 15) { nc = cc.nb[2]; nz = 0; } }
          else if (d === 3) { nz--; if (nz < 0) { nc = cc.nb[3]; nz = 15; } }
          else if (d === 4) { ny++; if (ny >= WH) continue; }
          else { ny--; if (ny < 0) continue; }
          if (!nc) continue;
          const ni = (ny << 8) | (nz << 4) | nx;
          const nl = get(nc, ni);
          if (nl === 0) continue;
          const emit = sky ? 0 : BLOCKS[nc.blocks[ni]].light;
          if ((nl < lvl || (sky && d === 5 && lvl === 15 && nl === 15)) && nl > emit) {
            set(nc, ni, 0);
            rem.c.push(nc); rem.i.push(ni); rem.l.push(nl);
            if (emit) { set(nc, ni, emit); add.c.push(nc); add.i.push(ni); }
          } else { add.c.push(nc); add.i.push(ni); }
        }
      }
      if (!sky) {
        const e = BLOCKS[c.blocks[i]].light;
        if (e) { set(c, i, e); add.c.push(c); add.i.push(i); }
      } else {
        // Ganz oben in der Welt gibt es immer Himmelslicht
        const y = i >> 8;
        if (y === WH - 1 && BLOCKS[c.blocks[i]].filter < 15) { set(c, i, 15); add.c.push(c); add.i.push(i); }
      }
      this.spread(add, sky);
    }
  }

  // ------------------------------------------------ Bloecke setzen
  setBlock(x, y, z, id, meta, noRecord) {
    if (y < 0 || y >= WH) return false;
    const c = this.chunkAt(x, z);
    if (!c) return false;
    const lx = x & 15, lz = z & 15;
    const i = (y << 8) | (lz << 4) | lx;
    const old = c.blocks[i];
    meta = meta || 0;
    if (old === id && c.meta[i] === meta) return false;
    c.blocks[i] = id;
    c.meta[i] = meta;
    if (id && y >= c.maxY) c.maxY = Math.min(WH - 1, y + 1);
    if (!noRecord) {
      const k = this.key(c.cx, c.cz);
      (this.mods[k] || (this.mods[k] = {}))[i] = id | (meta << 8);
    }
    const ob = BLOCKS[old], nb = BLOCKS[id];
    if (ob.filter !== nb.filter || ob.light !== nb.light) this.relight(c, i);
    c.dirty = true;
    if (lx === 0 && c.nb[1]) c.nb[1].dirty = true;
    if (lx === 15 && c.nb[0]) c.nb[0].dirty = true;
    if (lz === 0 && c.nb[3]) c.nb[3].dirty = true;
    if (lz === 15 && c.nb[2]) c.nb[2].dirty = true;
    this.updates.push(x, y, z);
    return true;
  }

  setMeta(x, y, z, meta) { return this.setBlock(x, y, z, this.getBlock(x, y, z), meta); }

  highestSolid(x, z) {
    for (let y = WH - 1; y > 0; y--) {
      const id = this.getBlock(x, y, z);
      if (id && BLOCKS[id].solid) return y;
    }
    return 0;
  }
}

// ---------------------------------------------------------------- Mesh-Erzeugung
// Richtungen: 0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z
const DIRS = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], shade: 0.6 },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], shade: 0.6 },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], shade: 1.0 },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], shade: 0.5 },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], shade: 0.8 },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], shade: 0.8 },
];
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const AO_CURVE = [0.45, 0.65, 0.82, 1.0];
// Welche Seite ist "vorne" fuer FACING-Werte (0 +Z, 1 -X, 2 -Z, 3 +X)
const FACING_TO_DIR = [4, 1, 5, 0];

const PW = 18, PH = WH + 2;
const pBlocks = new Uint8Array(PW * PW * PH);
const pMeta = new Uint8Array(PW * PW * PH);
const pLight = new Uint8Array(PW * PW * PH);
const pIdx = (x, y, z) => ((y + 1) * PW + (z + 1)) * PW + (x + 1);

class MeshBuf {
  constructor() { this.pos = []; this.uv = []; this.light = []; this.idx = []; this.n = 0; }
}

function tileUV(t, s, tt) {
  const e = 0.0005;
  s = s < e ? e : s > 1 - e ? 1 - e : s;
  tt = tt < e ? e : tt > 1 - e ? 1 - e : tt;
  const tx = t % ATLAS_TILES, ty = Math.floor(t / ATLAS_TILES);
  return [(tx + s) / ATLAS_TILES, 1 - (ty + 1 - tt) / ATLAS_TILES];
}

function buildChunkMesh(world, c) {
  // Gepolsterte Kopie inklusive Rand der Nachbarn
  const get = (cx, cz) => world.getChunk(cx, cz);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const n = (dx || dz) ? get(c.cx + dx, c.cz + dz) : c;
    const x0 = dx < 0 ? 15 : 0, x1 = dx > 0 ? 0 : 15, z0 = dz < 0 ? 15 : 0, z1 = dz > 0 ? 0 : 15;
    for (let y = 0; y < WH; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const pi = pIdx(x + dx * 16, y, z + dz * 16);
      if (!n) { pBlocks[pi] = B.stone; pMeta[pi] = 0; pLight[pi] = 0; continue; }
      const i = (y << 8) | (z << 4) | x;
      pBlocks[pi] = n.blocks[i]; pMeta[pi] = n.meta[i]; pLight[pi] = n.light[i];
    }
  }
  for (let z = -1; z <= 16; z++) for (let x = -1; x <= 16; x++) {
    const lo = pIdx(x, -1, z), hi = pIdx(x, WH, z);
    pBlocks[lo] = B.bedrock; pLight[lo] = 0; pBlocks[hi] = 0; pLight[hi] = 0xF0;
  }

  const solid = new MeshBuf(), trans = new MeshBuf();
  const yMax = Math.min(WH - 1, c.maxY + 1);

  const opaqueAt = (x, y, z) => BLOCKS[pBlocks[pIdx(x, y, z)]].opaque;

  function quad(buf, verts, uvs, lights, flip) {
    const n = buf.n;
    for (let k = 0; k < 4; k++) {
      buf.pos.push(verts[k][0], verts[k][1], verts[k][2]);
      buf.uv.push(uvs[k][0], uvs[k][1]);
      buf.light.push(lights[k][0], lights[k][1], lights[k][2]);
    }
    if (flip) buf.idx.push(n + 1, n + 2, n + 3, n + 1, n + 3, n);
    else buf.idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
    buf.n += 4;
  }

  function boxFace(buf, x, y, z, box, d, tex, lightPI, ao) {
    const D = DIRS[d];
    const verts = [], uvs = [], lights = [];
    const aos = [];
    for (let k = 0; k < 4; k++) {
      const [su, sv] = CORNERS[k];
      const p = [0, 0, 0];
      for (let a = 0; a < 3; a++) {
        let v;
        if (D.n[a] !== 0) v = D.n[a] > 0 ? box[a + 3] : box[a];
        else if (D.u[a] !== 0) v = (D.u[a] * su > 0) ? box[a + 3] : box[a];
        else v = (D.v[a] * sv > 0) ? box[a + 3] : box[a];
        p[a] = v;
      }
      // Texturkoordinaten aus der Position
      let s = 0, tt = 0;
      for (let a = 0; a < 3; a++) {
        if (D.u[a]) s = D.u[a] > 0 ? p[a] : 1 - p[a];
        if (D.v[a]) tt = D.v[a] > 0 ? p[a] : 1 - p[a];
      }
      verts.push([x + p[0], y + p[1], z + p[2]]);
      uvs.push(tileUV(tex, s, tt));
      if (ao) {
        // Weiches Licht + Umgebungsverdeckung
        const nx = x + D.n[0], ny = y + D.n[1], nz = z + D.n[2];
        const ux = D.u[0] * su, uy = D.u[1] * su, uz = D.u[2] * su;
        const vx = D.v[0] * sv, vy = D.v[1] * sv, vz = D.v[2] * sv;
        const s1 = opaqueAt(nx + ux, ny + uy, nz + uz), s2 = opaqueAt(nx + vx, ny + vy, nz + vz);
        const cc = opaqueAt(nx + ux + vx, ny + uy + vy, nz + uz + vz);
        const lv = s1 && s2 ? 0 : 3 - (s1 + s2 + cc);
        let sk = 0, bk = 0, cnt = 0;
        const add = (px, py, pz) => { const l = pLight[pIdx(px, py, pz)]; sk += l >> 4; bk += l & 15; cnt++; };
        add(nx, ny, nz);
        if (!s1) add(nx + ux, ny + uy, nz + uz);
        if (!s2) add(nx + vx, ny + vy, nz + vz);
        if (!cc && !(s1 && s2)) add(nx + ux + vx, ny + uy + vy, nz + uz + vz);
        aos.push(lv);
        lights.push([sk / cnt / 15, bk / cnt / 15, D.shade * AO_CURVE[lv]]);
      } else {
        const l = lightPI;
        lights.push([(l >> 4) / 15, (l & 15) / 15, D.shade]);
      }
    }
    const flip = ao && (aos[0] + aos[2] < aos[1] + aos[3]);
    quad(buf, verts, uvs, lights, flip);
  }

  for (let y = 0; y <= yMax; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    const pi = pIdx(x, y, z);
    const id = pBlocks[pi];
    if (!id) continue;
    const b = BLOCKS[id];
    const meta = pMeta[pi];
    const buf = b.pass === 'translucent' ? trans : solid;

    if (b.shape === 'cube') {
      const front = b.facing ? FACING_TO_DIR[meta & 3] : -1;
      for (let d = 0; d < 6; d++) {
        const D = DIRS[d];
        const npi = pIdx(x + D.n[0], y + D.n[1], z + D.n[2]);
        const nid = pBlocks[npi];
        const nb = BLOCKS[nid];
        if (nb.opaque) continue;
        if (!b.opaque && nid === id && b.pass !== 'cutout') continue;
        if (b.name === 'glass' && nid === id) continue;
        if (id === B.ice && nb.fluid === 'water') continue;
        const tex = d === 2 ? b.faces.top : d === 3 ? b.faces.bottom : d === front ? b.faces.front : b.faces.side;
        boxFace(buf, x, y, z, [0, 0, 0, 1, 1, 1], d, tex, pLight[npi], b.opaque);
      }
    } else if (b.shape === 'cross') {
      const l = pLight[pi];
      const lt = [(l >> 4) / 15, (l & 15) / 15, 0.9];
      const t = b.faces.side;
      const o = 0.1464, p = 0.8536; // 0.5 -+ 0.5/sqrt(2)
      const sets = [[[o, o], [p, p]], [[o, p], [p, o]]];
      for (const [[ax, az], [bx, bz]] of sets) {
        const v = [[x + ax, y, z + az], [x + bx, y, z + bz], [x + bx, y + 1, z + bz], [x + ax, y + 1, z + az]];
        const uv = [tileUV(t, 0, 0), tileUV(t, 1, 0), tileUV(t, 1, 1), tileUV(t, 0, 1)];
        quad(solid, v, uv, [lt, lt, lt, lt]);
        quad(solid, [v[1], v[0], v[3], v[2]], [uv[1], uv[0], uv[3], uv[2]], [lt, lt, lt, lt]);
      }
    } else if (b.shape === 'fluid') {
      const lvl = meta & 7;
      const aboveSame = BLOCKS[pBlocks[pIdx(x, y + 1, z)]].fluid === b.fluid;
      const h = aboveSame || (meta & 8) ? 1 : lvl === 0 ? 0.89 : Math.max(0.12, (8 - lvl) / 9);
      const own = pLight[pi];
      const fb = b.fluid === 'lava' ? solid : trans;
      for (let d = 0; d < 6; d++) {
        const D = DIRS[d];
        const npi = pIdx(x + D.n[0], y + D.n[1], z + D.n[2]);
        const nid = pBlocks[npi];
        const nb = BLOCKS[nid];
        if (nb.fluid === b.fluid) continue;
        if (nb.opaque && d !== 2) continue;
        if (nid === B.ice) continue;
        if (d === 2 && nb.opaque) continue;
        const l = Math.max(pLight[npi] >> 4, own >> 4) << 4 | Math.max(pLight[npi] & 15, own & 15);
        boxFace(fb, x, y, z, [0, 0, 0, 1, h, 1], d, b.faces.side, nb.opaque ? own : l, false);
        if (d === 2) {
          // Oberflaeche auch von unten sichtbar
          const D2 = 3;
          boxFace(fb, x, y + h - 1, z, [0, 1, 0, 1, 1, 1], D2, b.faces.side, own, false);
        }
      }
    } else {
      const boxes = blockBoxes(id, meta);
      const upL = pLight[pIdx(x, y + 1, z)];
      for (const box of boxes) {
        for (let d = 0; d < 6; d++) {
          const D = DIRS[d];
          const axis = D.n[0] ? 0 : D.n[1] ? 1 : 2;
          const onEdge = D.n[axis] > 0 ? box[axis + 3] >= 1 : box[axis] <= 0;
          const npi = pIdx(x + D.n[0], y + D.n[1], z + D.n[2]);
          if (onEdge && BLOCKS[pBlocks[npi]].opaque) continue;
          let tex;
          if (b.shape === 'door') tex = meta & 8 ? b.faces.top : b.faces.side;
          else if (b.shape === 'bed') tex = d === 2 ? (meta & 4 ? b.faces.top : b.faces.front) : d === 3 ? b.faces.bottom : b.faces.side;
          else tex = d === 2 ? b.faces.top : d === 3 ? b.faces.bottom : b.faces.side;
          const nl = pLight[npi];
          const l = Math.max(nl >> 4, upL >> 4, pLight[pi] >> 4) << 4 | Math.max(nl & 15, upL & 15, pLight[pi] & 15);
          boxFace(buf, x, y, z, box, d, tex, onEdge ? nl : l, false);
        }
      }
    }
  }
  return { solid, trans };
}

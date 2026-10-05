'use strict';
// Kollision (AABB gegen Block-Boxen) und Strahlen fuer das Anvisieren von Bloecken.

const GRAVITY = 32;

function collectBoxes(world, x0, y0, z0, x1, y1, z1, out) {
  out.length = 0;
  const fx0 = Math.floor(x0), fy0 = Math.floor(y0) - 1, fz0 = Math.floor(z0);
  const fx1 = Math.floor(x1), fy1 = Math.floor(y1), fz1 = Math.floor(z1);
  for (let x = fx0; x <= fx1; x++) for (let z = fz0; z <= fz1; z++) {
    if (!world.isLoaded(x, z)) { out.push([x, -64, z, x + 1, 256, z + 1]); continue; }
    for (let y = fy0; y <= fy1; y++) {
      if (y < 0) { out.push([x, y, z, x + 1, y + 1, z + 1]); continue; }
      const id = world.getBlock(x, y, z);
      if (!id) continue;
      const bx = collisionBoxes(id, world.getMeta(x, y, z));
      for (const b of bx) out.push([x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]]);
    }
  }
  return out;
}

const _boxes = [];
// Bewegt einen Koerper (pos = Mitte unten, w = halbe Breite, h = Hoehe). Gibt Kollisionsinfos zurueck.
function moveBody(world, b, dx, dy, dz) {
  const w = b.w, h = b.h;
  const p = b.pos;
  const ex = 0.0001;
  collectBoxes(world, Math.min(p.x - w, p.x - w + dx) - 1, Math.min(p.y, p.y + dy) - 1, Math.min(p.z - w, p.z - w + dz) - 1,
    Math.max(p.x + w, p.x + w + dx) + 1, Math.max(p.y + h, p.y + h + dy) + 1, Math.max(p.z + w, p.z + w + dz) + 1, _boxes);
  const odx = dx, ody = dy, odz = dz;
  // Y
  for (const bx of _boxes) {
    if (p.x + w <= bx[0] + ex || p.x - w >= bx[3] - ex || p.z + w <= bx[2] + ex || p.z - w >= bx[5] - ex) continue;
    if (dy > 0 && bx[1] >= p.y + h - ex) dy = Math.min(dy, bx[1] - (p.y + h));
    else if (dy < 0 && bx[4] <= p.y + ex) dy = Math.max(dy, bx[4] - p.y);
  }
  p.y += dy;
  // X
  for (const bx of _boxes) {
    if (p.y + h <= bx[1] + ex || p.y >= bx[4] - ex || p.z + w <= bx[2] + ex || p.z - w >= bx[5] - ex) continue;
    if (dx > 0 && bx[0] >= p.x + w - ex) dx = Math.min(dx, bx[0] - (p.x + w));
    else if (dx < 0 && bx[3] <= p.x - w + ex) dx = Math.max(dx, bx[3] - (p.x - w));
  }
  p.x += dx;
  // Z
  for (const bx of _boxes) {
    if (p.y + h <= bx[1] + ex || p.y >= bx[4] - ex || p.x + w <= bx[0] + ex || p.x - w >= bx[3] - ex) continue;
    if (dz > 0 && bx[2] >= p.z + w - ex) dz = Math.min(dz, bx[2] - (p.z + w));
    else if (dz < 0 && bx[5] <= p.z - w + ex) dz = Math.max(dz, bx[5] - (p.z - w));
  }
  p.z += dz;
  return { hitX: dx !== odx, hitY: dy !== ody, hitZ: dz !== odz, ground: ody < 0 && dy !== ody };
}

function boxFree(world, x0, y0, z0, x1, y1, z1) {
  collectBoxes(world, x0, y0, z0, x1, y1, z1, _boxes);
  for (const bx of _boxes) if (x1 > bx[0] && x0 < bx[3] && y1 > bx[1] && y0 < bx[4] && z1 > bx[2] && z0 < bx[5]) return false;
  return true;
}

// Bewegung mit Stufen (Treppen/Stufen hochlaufen) und Schleichen (nicht von Kanten fallen)
function moveWithStep(world, b, dx, dy, dz, stepH, sneak) {
  const p = b.pos;
  if (sneak && b.onGround) {
    const w = b.w;
    const supported = (ox, oz) => !boxFree(world, p.x - w + ox, p.y - 0.6, p.z - w + oz, p.x + w + ox, p.y - 0.01, p.z + w + oz);
    const st = 0.05;
    while (dx !== 0 && !supported(dx, 0)) dx = Math.abs(dx) < st ? 0 : dx - Math.sign(dx) * st;
    while (dz !== 0 && !supported(0, dz)) dz = Math.abs(dz) < st ? 0 : dz - Math.sign(dz) * st;
    while (dx !== 0 && dz !== 0 && !supported(dx, dz)) {
      dx = Math.abs(dx) < st ? 0 : dx - Math.sign(dx) * st;
      dz = Math.abs(dz) < st ? 0 : dz - Math.sign(dz) * st;
    }
  }
  const sx = p.x, sy = p.y, sz = p.z;
  const r = moveBody(world, b, dx, dy, dz);
  if (stepH > 0 && (r.hitX || r.hitZ) && (b.onGround || r.ground)) {
    const ax = p.x, ay = p.y, az = p.z;
    p.x = sx; p.y = sy; p.z = sz;
    const up = moveBody(world, b, 0, stepH, 0);
    const r2 = moveBody(world, b, dx, 0, dz);
    const down = moveBody(world, b, 0, -(stepH + 0.01) + Math.min(0, dy), 0);
    const d1 = (ax - sx) ** 2 + (az - sz) ** 2, d2 = (p.x - sx) ** 2 + (p.z - sz) ** 2;
    if (d2 > d1 + 1e-6) return { hitX: r2.hitX, hitZ: r2.hitZ, hitY: true, ground: true };
    p.x = ax; p.y = ay; p.z = az;
  }
  return r;
}

// Strahl durch die Bloecke (DDA). Gibt getroffenen Block und Seite zurueck.
function raycast(world, ox, oy, oz, dx, dy, dz, maxDist, opts) {
  opts = opts || {};
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const tdx = Math.abs(1 / dx), tdy = Math.abs(1 / dy), tdz = Math.abs(1 / dz);
  let tmx = dx > 0 ? (x + 1 - ox) * tdx : (ox - x) * tdx;
  let tmy = dy > 0 ? (y + 1 - oy) * tdy : (oy - y) * tdy;
  let tmz = dz > 0 ? (z + 1 - oz) * tdz : (oz - z) * tdz;
  if (!isFinite(tmx)) tmx = Infinity; if (!isFinite(tmy)) tmy = Infinity; if (!isFinite(tmz)) tmz = Infinity;
  let t = 0;
  for (let n = 0; n < 200 && t <= maxDist; n++) {
    const id = world.getBlock(x, y, z);
    if (id) {
      const b = BLOCKS[id];
      const fluidHit = opts.fluids && b.fluid && (opts.fluids === 'any' || world.getMeta(x, y, z) === 0);
      if (b.selectable || fluidHit) {
        const meta = world.getMeta(x, y, z);
        const boxes = fluidHit ? [[0, 0, 0, 1, 1, 1]] : blockBoxes(id, meta);
        let best = null;
        for (const bx of boxes) {
          const r = rayBox(ox, oy, oz, dx, dy, dz, x + bx[0], y + bx[1], z + bx[2], x + bx[3], y + bx[4], z + bx[5]);
          if (r && r.t <= maxDist && (!best || r.t < best.t)) best = r;
        }
        if (best) return { x, y, z, id, meta, t: best.t, nx: best.n[0], ny: best.n[1], nz: best.n[2], px: ox + dx * best.t, py: oy + dy * best.t, pz: oz + dz * best.t };
      }
    }
    if (tmx < tmy && tmx < tmz) { x += stepX; t = tmx; tmx += tdx; }
    else if (tmy < tmz) { y += stepY; t = tmy; tmy += tdy; }
    else { z += stepZ; t = tmz; tmz += tdz; }
  }
  return null;
}

function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let tmin = -Infinity, tmax = Infinity, n = null;
  const o = [ox, oy, oz], d = [dx, dy, dz], mn = [x0, y0, z0], mx = [x1, y1, z1];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) { if (o[a] < mn[a] || o[a] > mx[a]) return null; continue; }
    let t1 = (mn[a] - o[a]) / d[a], t2 = (mx[a] - o[a]) / d[a];
    let s = -1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
    if (t1 > tmin) { tmin = t1; n = [0, 0, 0]; n[a] = d[a] > 0 ? -1 : 1; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  if (tmin < 0) return { t: 0, n: n || [0, 1, 0] };
  return { t: tmin, n };
}

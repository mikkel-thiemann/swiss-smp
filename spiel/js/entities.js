'use strict';
// Tiere, Monster, fallengelassene Items, Pfeile, TNT und Partikel.

const MOB_DEFS = {
  zombie: { de: 'Zombie', hp: 20, w: 0.6, h: 1.95, speed: 2.3, hostile: true, dmg: 3, burns: true,
    drops: (r) => [[I.rotten_flesh, r() * 3 | 0]].concat(r() < 0.025 ? [[I.iron_ingot, 1]] : []) },
  skeleton: { de: 'Skelett', hp: 20, w: 0.6, h: 1.99, speed: 2.5, hostile: true, ranged: true, burns: true,
    drops: (r) => [[I.bone, r() * 3 | 0], [I.arrow, r() * 3 | 0]] },
  creeper: { de: 'Creeper', hp: 20, w: 0.6, h: 1.7, speed: 2.4, hostile: true, creeper: true, drops: (r) => [[I.gunpowder, r() * 3 | 0]] },
  spider: { de: 'Spinne', hp: 16, w: 1.4, h: 0.9, speed: 3.0, hostile: true, dmg: 2, spider: true, drops: (r) => [[I.string, r() * 3 | 0]] },
  pig: { de: 'Schwein', hp: 10, w: 0.9, h: 0.9, speed: 1.6, drops: (r) => [[I.porkchop, 1 + (r() * 3 | 0)]] },
  cow: { de: 'Kuh', hp: 10, w: 0.9, h: 1.4, speed: 1.4, drops: (r) => [[I.beef, 1 + (r() * 3 | 0)], [I.leather, r() * 3 | 0]] },
  sheep: { de: 'Schaf', hp: 8, w: 0.9, h: 1.3, speed: 1.5, drops: (r, m) => [[I.mutton, 1 + (r() * 2 | 0)]].concat(m.sheared ? [] : [[B.white_wool, 1]]) },
  chicken: { de: 'Huhn', hp: 4, w: 0.4, h: 0.7, speed: 1.5, chicken: true, drops: (r) => [[I.chicken, 1], [I.feather, r() * 3 | 0]] },
};

function colorCanvas(c, noise, faceFn) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 8;
  const g = cv.getContext('2d');
  const r = mulberry32(c[0] * 7 + c[1] * 13 + c[2]);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const f = 1 + (r() - 0.5) * (noise || 0.12);
    g.fillStyle = `rgb(${c[0] * f | 0},${c[1] * f | 0},${c[2] * f | 0})`;
    g.fillRect(x, y, 1, 1);
  }
  if (faceFn) faceFn(g);
  const t = new THREE.CanvasTexture(cv); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  return t;
}
const px = (g, col, pts) => { g.fillStyle = col; for (const [x, y, w, h] of pts) g.fillRect(x, y, w || 1, h || 1); };

const FACES = {
  zombie: g => px(g, '#1b2e17', [[1, 3, 2, 1], [5, 3, 2, 1]]),
  skeleton: g => { px(g, '#3a3a3a', [[1, 3, 2, 2], [5, 3, 2, 2], [3, 5, 2, 1], [2, 6, 4, 1]]); },
  creeper: g => px(g, '#101010', [[1, 2, 2, 2], [5, 2, 2, 2], [3, 4, 2, 2], [2, 5, 1, 3], [5, 5, 1, 3]]),
  spider: g => { px(g, '#d01010', [[1, 2, 2, 1], [5, 2, 2, 1], [2, 4, 1, 1], [5, 4, 1, 1]]); },
  pig: g => { px(g, '#ffffff', [[1, 2, 1, 1], [6, 2, 1, 1]]); px(g, '#202020', [[2, 2, 1, 1], [5, 2, 1, 1]]); px(g, '#e88f97', [[2, 4, 4, 3]]); px(g, '#9a4a50', [[3, 5, 1, 1], [4, 5, 1, 1]]); },
  cow: g => { px(g, '#ffffff', [[1, 3, 2, 1], [5, 3, 2, 1]]); px(g, '#101010', [[1, 3, 1, 1], [6, 3, 1, 1]]); px(g, '#c8b4a0', [[2, 5, 4, 3]]); },
  sheep: g => { px(g, '#ffffff', [[1, 3, 2, 1], [5, 3, 2, 1]]); px(g, '#101010', [[2, 3, 1, 1], [5, 3, 1, 1]]); px(g, '#d0a0a0', [[3, 5, 2, 1]]); },
  chicken: g => { px(g, '#101010', [[1, 2, 1, 1], [6, 2, 1, 1]]); px(g, '#f0a020', [[2, 3, 4, 2]]); px(g, '#d02020', [[3, 5, 2, 2]]); },
};

function buildMobModel(type, mats) {
  const root = new THREE.Group();
  const S = 1 / 16;
  const part = (w, h, d, x, y, z, color, opts) => {
    opts = opts || {};
    const g = new THREE.BoxGeometry(w * S, h * S, d * S);
    const base = new THREE.MeshLambertMaterial({ map: colorCanvas(color, opts.noise) });
    mats.push(base);
    let mat = base;
    if (opts.face) {
      const fm = new THREE.MeshLambertMaterial({ map: colorCanvas(color, opts.noise, FACES[opts.face]) });
      mats.push(fm);
      mat = [base, base, base, base, fm, base];
    }
    const m = new THREE.Mesh(g, mat);
    if (opts.pivot) {
      // Drehpunkt oben (Beine, Arme)
      const piv = new THREE.Group();
      piv.position.set(x * S, (y + h / 2) * S, z * S);
      m.position.set(0, -h / 2 * S, 0);
      piv.add(m);
      (opts.parent || root).add(piv);
      return piv;
    }
    m.position.set(x * S, y * S, z * S);
    (opts.parent || root).add(m);
    return m;
  };
  const P = {};
  if (type === 'zombie' || type === 'skeleton') {
    const sk = type === 'skeleton';
    const skin = sk ? [200, 200, 196] : [82, 140, 64];
    const shirt = sk ? [190, 190, 186] : [36, 150, 160];
    const pants = sk ? [190, 190, 186] : [60, 58, 150];
    const limb = sk ? 2 : 4;
    P.head = part(8, 8, 8, 0, 28, 0, skin, { face: type });
    part(8, 12, sk ? 2 : 4, 0, 18, 0, shirt);
    P.armR = part(limb, 12, limb, -4 - limb / 2, 18, 0, sk ? skin : shirt, { pivot: true });
    P.armL = part(limb, 12, limb, 4 + limb / 2, 18, 0, sk ? skin : shirt, { pivot: true });
    P.armR.rotation.x = P.armL.rotation.x = -Math.PI / 2;
    P.legR = part(limb, 12, limb, -2, 6, 0, pants, { pivot: true });
    P.legL = part(limb, 12, limb, 2, 6, 0, pants, { pivot: true });
    P.legs = [P.legR, P.legL]; P.legPhase = [0, Math.PI];
  } else if (type === 'creeper') {
    const c = [94, 176, 72];
    P.head = part(8, 8, 8, 0, 22, 0, c, { face: 'creeper', noise: 0.35 });
    part(8, 12, 4, 0, 12, 0, c, { noise: 0.35 });
    P.legs = [part(4, 6, 4, -2, 3, 4, c, { pivot: true, noise: 0.35 }), part(4, 6, 4, 2, 3, 4, c, { pivot: true, noise: 0.35 }),
      part(4, 6, 4, -2, 3, -4, c, { pivot: true, noise: 0.35 }), part(4, 6, 4, 2, 3, -4, c, { pivot: true, noise: 0.35 })];
    P.legPhase = [0, Math.PI, Math.PI, 0];
  } else if (type === 'spider') {
    const c = [52, 42, 36];
    P.head = part(8, 8, 8, 0, 9, 7, c, { face: 'spider' });
    part(6, 6, 6, 0, 9, 1, c);
    part(10, 8, 12, 0, 10, -8, c);
    P.legs = [];
    P.legPhase = [];
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) {
      const leg = part(16, 2, 2, s * 9, 9, 3 - i * 2.2, [40, 32, 28], { pivot: false });
      leg.rotation.z = s * 0.5; leg.rotation.y = (i - 1.5) * 0.35 * s;
      P.legs.push(leg); P.legPhase.push(i * 1.3 + (s > 0 ? Math.PI : 0));
    }
    P.spiderLegs = true;
  } else if (type === 'pig' || type === 'cow' || type === 'sheep') {
    const body = type === 'pig' ? [236, 158, 160] : type === 'cow' ? [78, 54, 38] : [232, 232, 230];
    const headC = type === 'pig' ? [236, 158, 160] : type === 'cow' ? [78, 54, 38] : [214, 186, 168];
    const legH = type === 'pig' ? 6 : 12;
    const bodyY = legH + (type === 'cow' ? 5 : 4);
    P.body = part(type === 'cow' ? 12 : 10, type === 'cow' ? 10 : 8, type === 'cow' ? 18 : 16, 0, bodyY, 0, body, { noise: type === 'cow' ? 0.5 : 0.1 });
    if (type === 'sheep') P.wool = P.body;
    P.head = part(8, 8, type === 'pig' ? 8 : 6, 0, bodyY + 4, (type === 'cow' ? 9 : 8) + 3, headC, { face: type });
    if (type === 'cow') { part(1, 3, 1, -4.5, bodyY + 9, 12, [220, 210, 190], { parent: P.head.parent }); part(1, 3, 1, 4.5, bodyY + 9, 12, [220, 210, 190]); }
    const lc = type === 'sheep' ? [214, 186, 168] : body;
    P.legs = [part(4, legH, 4, -3, legH / 2, 6, lc, { pivot: true }), part(4, legH, 4, 3, legH / 2, 6, lc, { pivot: true }),
      part(4, legH, 4, -3, legH / 2, -6, lc, { pivot: true }), part(4, legH, 4, 3, legH / 2, -6, lc, { pivot: true })];
    P.legPhase = [0, Math.PI, Math.PI, 0];
  } else if (type === 'chicken') {
    const w = [240, 240, 238];
    part(6, 6, 8, 0, 7, 0, w);
    P.head = part(4, 6, 3, 0, 12, 4.5, w, { face: 'chicken' });
    part(1, 6, 6, -3.5, 8, 0, w); part(1, 6, 6, 3.5, 8, 0, w);
    P.legs = [part(1, 4, 1, -1.5, 2, 0, [240, 170, 40], { pivot: true }), part(1, 4, 1, 1.5, 2, 0, [240, 170, 40], { pivot: true })];
    P.legPhase = [0, Math.PI];
  }
  root.userData.parts = P;
  return root;
}

let entityIdSeq = 1;

class Mob {
  constructor(type, x, y, z) {
    this.eid = entityIdSeq++;
    this.type = type;
    this.def = MOB_DEFS[type];
    this.pos = { x, y, z };
    this.vel = { x: 0, y: 0, z: 0 };
    this.w = this.def.w / 2; this.h = this.def.h;
    this.health = this.def.hp;
    this.yaw = Math.random() * Math.PI * 2;
    this.onGround = false;
    this.hurt = 0; this.invuln = 0;
    this.dead = false; this.deathTime = 0;
    this.walk = 0; this.wanderT = 0; this.moveDir = null; this.panic = 0;
    this.attackCd = 0; this.fuse = 0; this.fire = 0; this.shootCd = 2;
    this.sheared = false;
    this.eggTimer = 300 + Math.random() * 300;
    this.persistent = !this.def.hostile;
    this.mats = [];
    this.model = buildMobModel(type, this.mats);
    this.fallDist = 0;
  }

  get eyeY() { return this.pos.y + this.h * 0.85; }

  damage(amount, src, game, knock) {
    if (this.dead || this.invuln > 0) return false;
    this.health -= amount;
    this.hurt = 0.4; this.invuln = 0.5;
    game.sound('hurt_mob');
    if (src) {
      const dx = this.pos.x - src.x, dz = this.pos.z - src.z, l = Math.hypot(dx, dz) || 1;
      const k = knock === undefined ? 1 : knock;
      this.vel.x = dx / l * 7 * k; this.vel.z = dz / l * 7 * k; this.vel.y = 5.5 * Math.min(1, k + 0.3);
    }
    if (!this.def.hostile) { this.panic = 5; }
    if (this.type === 'spider') this.provoked = true;
    if (this.health <= 0) {
      this.dead = true;
      this.deathTime = 0;
      const r = Math.random;
      for (const [id, n] of this.def.drops(r, this)) if (n > 0) game.dropItem(this.pos.x, this.pos.y + 0.5, this.pos.z, { id: this.fire > 0 && SMELTING[id] && ITEMS[SMELTING[id]].food ? SMELTING[id] : id, count: n });
    }
    return true;
  }

  update(dt, game) {
    const world = game.world, pl = game.player;
    if (this.dead) {
      this.deathTime += dt;
      this.model.rotation.z = Math.min(Math.PI / 2, this.deathTime * 4);
      this.setBrightness(game, true);
      return this.deathTime < 1;
    }
    this.hurt = Math.max(0, this.hurt - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.attackCd = Math.max(0, this.attackCd - dt);
    const dxp = pl.pos.x - this.pos.x, dzp = pl.pos.z - this.pos.z, dyp = pl.pos.y - this.pos.y;
    const distP = Math.hypot(dxp, dzp, dyp);
    let want = null, speed = this.def.speed;
    let jump = false;

    // Umgebung
    const headId = world.getBlock(Math.floor(this.pos.x), Math.floor(this.eyeY), Math.floor(this.pos.z));
    const feetId = world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.1), Math.floor(this.pos.z));
    const inWater = BLOCKS[feetId].fluid === 'water' || BLOCKS[headId].fluid === 'water';
    const inLava = BLOCKS[feetId].fluid === 'lava';
    const light = world.getLight(Math.floor(this.pos.x), Math.floor(this.eyeY), Math.floor(this.pos.z));
    const isDay = game.isDay();

    const targetable = pl.mode === 'survival' && !pl.dead;
    let hostileNow = this.def.hostile;
    if (this.def.spider && isDay && !this.provoked) hostileNow = false;

    if (hostileNow && targetable && distP < 16) {
      // Spieler verfolgen
      if (this.def.ranged) {
        const see = game.lineOfSight(this.pos.x, this.eyeY, this.pos.z, pl.pos.x, pl.pos.y + 1.5, pl.pos.z);
        if (distP > 10 || !see) want = Math.atan2(dxp, dzp);
        else if (distP < 5) want = Math.atan2(-dxp, -dzp);
        this.yawLook = Math.atan2(dxp, dzp);
        this.shootCd -= dt;
        if (see && this.shootCd <= 0 && distP < 15) {
          this.shootCd = 2 + Math.random();
          const tx = pl.pos.x - this.pos.x, ty = pl.pos.y + 1.2 - this.eyeY, tz = pl.pos.z - this.pos.z;
          const hd = Math.hypot(tx, tz);
          const sp = 20;
          const ay = ty + hd * 0.08 * (hd / sp) * 3;
          const l = Math.hypot(tx, ay, tz);
          game.spawnArrow(this.pos.x, this.eyeY, this.pos.z, tx / l * sp, ay / l * sp, tz / l * sp, 'mob', 2 + Math.random() * 2, this);
          game.sound('bow');
        }
      } else if (this.def.creeper) {
        want = distP > 2.5 ? Math.atan2(dxp, dzp) : null;
        if (distP < 3 || (this.fuse > 0 && distP < 7)) {
          if (this.fuse === 0) game.sound('fuse');
          this.fuse += dt;
          if (this.fuse >= 1.5) {
            this.dead = true; this.deathTime = 2;
            game.explode(this.pos.x, this.pos.y + 0.8, this.pos.z, 3);
            return false;
          }
        } else this.fuse = Math.max(0, this.fuse - dt);
      } else {
        want = Math.atan2(dxp, dzp);
        if (distP < 1.3 + this.w && Math.abs(dyp) < 1.5 && this.attackCd <= 0) {
          this.attackCd = 1;
          pl.damage(this.def.dmg, game, this);
        }
      }
    } else if (this.panic > 0) {
      this.panic -= dt;
      speed *= 1.6;
      if (!this.moveDir || Math.random() < dt) this.moveDir = Math.random() * Math.PI * 2;
      want = this.moveDir;
    } else {
      this.fuse = Math.max(0, this.fuse - dt);
      this.wanderT -= dt;
      if (this.wanderT <= 0) {
        this.wanderT = 2 + Math.random() * 5;
        this.moveDir = Math.random() < 0.55 ? Math.random() * Math.PI * 2 : null;
      }
      want = this.moveDir;
      // Tiere folgen Weizen in der Hand
      const held = pl.held();
      if (!this.def.hostile && held && held.id === I.wheat && (this.type === 'cow' || this.type === 'sheep') && distP < 8 && distP > 2) want = Math.atan2(dxp, dzp);
      if (!this.def.hostile && held && held.id === I.wheat_seeds && this.type === 'chicken' && distP < 8 && distP > 2) want = Math.atan2(dxp, dzp);
      speed *= 0.6;
    }

    // Bewegung
    let tx = 0, tz = 0;
    if (want !== null && want !== undefined) {
      let d = want - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += clamp(d, -dt * 8, dt * 8);
      tx = Math.sin(this.yaw) * speed; tz = Math.cos(this.yaw) * speed;
      // Klippen und Lava meiden (nur ohne Ziel)
      if (!hostileNow && this.onGround) {
        const ax = Math.floor(this.pos.x + Math.sin(this.yaw) * (this.w + 0.6)), az = Math.floor(this.pos.z + Math.cos(this.yaw) * (this.w + 0.6));
        let drop = 0;
        for (let k = 0; k < 4; k++) { const id = world.getBlock(ax, Math.floor(this.pos.y) - 1 - k, az); if (BLOCKS[id].solid) break; drop++; }
        const ahead = world.getBlock(ax, Math.floor(this.pos.y) - 1, az);
        if (drop >= 3 || BLOCKS[ahead].fluid === 'lava') { tx = tz = 0; this.wanderT = 0; }
      }
    }
    const k = this.onGround ? 10 : inWater ? 3 : 2;
    const a = 1 - Math.exp(-dt * k);
    this.vel.x += (tx - this.vel.x) * a;
    this.vel.z += (tz - this.vel.z) * a;
    if (inWater || inLava) {
      this.vel.y -= 8 * dt;
      this.vel.y *= Math.pow(0.4, dt);
      if (this.vel.y < 2 && world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.6), Math.floor(this.pos.z)) && BLOCKS[world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.6), Math.floor(this.pos.z))].fluid) this.vel.y += 20 * dt;
      this.fallDist = 0;
    } else {
      this.vel.y -= GRAVITY * dt;
      if (this.def.chicken && this.vel.y < -2.5) this.vel.y = -2.5;
      this.vel.y *= Math.pow(0.98, dt * 20);
    }
    const r = moveWithStep(world, this, this.vel.x * dt, this.vel.y * dt, this.vel.z * dt, this.def.spider ? 0 : 0.6, false);
    if (r.hitY) { if (this.vel.y < 0) { if (this.fallDist > 3 && !this.def.chicken) this.damage(Math.ceil(this.fallDist - 3), null, game); this.fallDist = 0; } this.vel.y = 0; }
    else if (this.vel.y < 0) this.fallDist += -this.vel.y * dt;
    this.onGround = r.ground || (r.hitY && this.vel.y === 0 && this.onGround && false) || r.ground;
    if (r.ground) this.onGround = true; else if (!r.hitY) this.onGround = false;
    if ((r.hitX || r.hitZ) && (tx || tz)) {
      if (this.def.spider) this.vel.y = 3.5;
      else if (this.onGround) jump = true;
    }
    if (jump) this.vel.y = 8.4;
    if (r.hitX) this.vel.x = 0;
    if (r.hitZ) this.vel.z = 0;

    // Schaden durch Umgebung
    if (inLava) { this.fire = 8; if (this.invuln <= 0) this.damage(4, null, game); }
    if (this.def.burns && isDay && !inWater && (light >> 4) >= 15 && game.dayLight > 0.8) this.fire = Math.max(this.fire, 1);
    if (inWater) this.fire = 0;
    if (this.fire > 0) {
      this.fire -= dt;
      this.fireTick = (this.fireTick || 0) + dt;
      if (this.fireTick >= 1) { this.fireTick = 0; this.invuln = 0; this.damage(1, null, game); }
    }
    if (feetId === B.cactus || world.getBlock(Math.floor(this.pos.x + this.w + 0.05), Math.floor(this.pos.y), Math.floor(this.pos.z)) === B.cactus) this.damage(1, null, game);

    // Huehner legen Eier
    if (this.def.chicken) { this.eggTimer -= dt; if (this.eggTimer <= 0) { this.eggTimer = 300 + Math.random() * 300; game.dropItem(this.pos.x, this.pos.y + 0.3, this.pos.z, { id: I.egg, count: 1 }); game.sound('pop'); } }
    // Schafe fressen Gras -> Wolle waechst nach
    if (this.type === 'sheep' && this.sheared && Math.random() < dt / 60) {
      const bx = Math.floor(this.pos.x), by = Math.floor(this.pos.y) - 1, bz = Math.floor(this.pos.z);
      if (world.getBlock(bx, by, bz) === B.grass_block) { world.setBlock(bx, by, bz, B.dirt); this.sheared = false; }
    }

    // Animation
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.walk += sp * dt * 2.2;
    const P = this.model.userData.parts;
    if (P.legs) P.legs.forEach((l, i) => {
      if (P.spiderLegs) l.rotation.x = Math.sin(this.walk * 2 + P.legPhase[i]) * 0.4 * Math.min(1, sp);
      else l.rotation.x = Math.sin(this.walk + P.legPhase[i]) * 0.8 * Math.min(1, sp / 2);
    });
    if (P.head) {
      const look = hostileNow && targetable && distP < 16 ? Math.atan2(dxp, dzp) - this.yaw : 0;
      P.head.rotation.y = clamp(Math.atan2(Math.sin(look), Math.cos(look)), -1, 1);
    }
    if (P.wool) P.wool.scale.set(this.sheared ? 0.85 : 1, this.sheared ? 0.85 : 1, 1);
    this.model.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.model.rotation.y = this.yaw;
    const sw = this.def.creeper && this.fuse > 0 ? 1 + this.fuse * 0.12 * (1 + Math.sin(this.fuse * 20) * 0.2) : 1;
    this.model.scale.set(sw, 1 + (sw - 1) * 0.5, sw);
    this.setBrightness(game, false);

    // Entfernen von Monstern weit weg
    if (!this.persistent) {
      if (distP > 128) return false;
      if (distP > 40 && Math.random() < dt / 30) return false;
    }
    if (this.pos.y < -20) return false;
    return true;
  }

  setBrightness(game, dead) {
    const l = game.world.getLight(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.5), Math.floor(this.pos.z));
    let b = game.lightFactor(l);
    const red = this.hurt > 0 || dead;
    const flash = this.def.creeper && this.fuse > 0 && Math.floor(this.fuse * 8) % 2 === 0;
    for (const m of this.mats) {
      if (flash) m.color.setRGB(2, 2, 2);
      else if (red) m.color.setRGB(b * 1.3, b * 0.45, b * 0.45);
      else m.color.setRGB(b, b, b);
    }
  }

  dispose(scene) {
    scene.remove(this.model);
    this.model.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    for (const m of this.mats) { if (m.map) m.map.dispose(); m.dispose(); }
  }
}

class ItemEntity {
  constructor(stack, x, y, z, renderer) {
    this.stack = stack;
    this.pos = { x, y, z };
    this.vel = { x: (Math.random() - 0.5) * 2, y: 4, z: (Math.random() - 0.5) * 2 };
    this.w = 0.125; this.h = 0.25;
    this.age = 0; this.pickupDelay = 0.5;
    this.mesh = renderer.makeItemMesh(stack.id, renderer.isCubeItem(stack.id) ? 0.25 : 0.4);
    this.spin = Math.random() * 6;
  }
  update(dt, game) {
    this.age += dt;
    this.pickupDelay -= dt;
    const w = game.world;
    const id = w.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.1), Math.floor(this.pos.z));
    if (BLOCKS[id].fluid === 'water') { this.vel.y += (3 - this.vel.y) * Math.min(1, dt * 3); this.vel.x *= 0.95; this.vel.z *= 0.95; }
    else if (BLOCKS[id].fluid === 'lava') { game.sound('fizz'); return false; }
    else this.vel.y -= 20 * dt;
    if (!boxFree(w, this.pos.x - this.w, this.pos.y, this.pos.z - this.w, this.pos.x + this.w, this.pos.y + this.h, this.pos.z + this.w)) {
      this.pos.y += 3 * dt; // aus Bloecken herausschieben
    } else {
      const r = moveBody(w, this, this.vel.x * dt, this.vel.y * dt, this.vel.z * dt);
      if (r.hitY) { this.vel.y = 0; this.vel.x *= Math.pow(0.02, dt); this.vel.z *= Math.pow(0.02, dt); }
      if (r.hitX) this.vel.x = 0; if (r.hitZ) this.vel.z = 0;
    }
    this.spin += dt * 1.5;
    this.mesh.position.set(this.pos.x, this.pos.y + 0.15 + Math.sin(this.age * 2.5) * 0.05, this.pos.z);
    if (this.mesh.userData.isBlock) this.mesh.rotation.y = this.spin;
    else this.mesh.quaternion.copy(game.renderer.camera.quaternion);
    const l = w.getLight(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.2), Math.floor(this.pos.z));
    this.mesh.material.color.setScalar(game.lightFactor(l));
    return this.age < 300 && this.pos.y > -20;
  }
}

class Projectile {
  constructor(kind, x, y, z, vx, vy, vz, owner, dmg, renderer) {
    this.kind = kind; this.owner = owner; this.dmg = dmg || 0;
    this.pos = { x, y, z }; this.vel = { x: vx, y: vy, z: vz };
    this.age = 0; this.stuck = false;
    if (kind === 'arrow') {
      const g = new THREE.BoxGeometry(0.06, 0.06, 0.6);
      this.mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x8a6a3a }));
    } else this.mesh = renderer.makeItemMesh(I[kind], 0.3);
  }
  update(dt, game) {
    this.age += dt;
    if (this.stuck) {
      this.stuckT = (this.stuckT || 0) + dt;
      const p = game.player;
      if (this.owner === 'player' && Math.hypot(p.pos.x - this.pos.x, p.pos.y + 0.9 - this.pos.y, p.pos.z - this.pos.z) < 1.4 && this.stuckT > 0.3) {
        if (p.mode === 'creative' || p.addItem({ id: I.arrow, count: 1 }) === 0) { game.sound('pop'); return false; }
      }
      return this.stuckT < 60;
    }
    const steps = 4;
    for (let s = 0; s < steps; s++) {
      const sdt = dt / steps;
      this.vel.y -= (this.kind === 'arrow' ? 20 : 12) * sdt;
      const len = Math.hypot(this.vel.x, this.vel.y, this.vel.z);
      const nx = this.vel.x / len, ny = this.vel.y / len, nz = this.vel.z / len;
      const dist = len * sdt;
      const hit = raycast(game.world, this.pos.x, this.pos.y, this.pos.z, nx, ny, nz, dist);
      // Treffer bei Wesen
      const ent = game.entityRaycast(this.pos.x, this.pos.y, this.pos.z, nx, ny, nz, hit ? hit.t : dist, this.owner, this.shooter);
      if (ent) {
        if (ent.target === game.player) game.player.damage(this.dmg || 0, game, { x: this.pos.x - nx, z: this.pos.z - nz });
        else ent.target.damage(this.kind === 'arrow' ? Math.ceil(this.dmg) : 0, { x: this.pos.x - nx, z: this.pos.z - nz }, game, 0.6);
        if (this.kind === 'egg' && Math.random() < 0.125) game.spawnMob('chicken', this.pos.x, this.pos.y, this.pos.z);
        return false;
      }
      if (hit) {
        if (this.kind !== 'arrow') {
          if (this.kind === 'egg' && Math.random() < 0.125) game.spawnMob('chicken', hit.px, hit.py, hit.pz);
          game.particles(hit.px, hit.py, hit.pz, [240, 240, 240], 6);
          return false;
        }
        this.pos.x = hit.px - nx * 0.15; this.pos.y = hit.py - ny * 0.15; this.pos.z = hit.pz - nz * 0.15;
        this.stuck = true;
        game.sound('arrow_hit');
        if (hit.id === B.tnt) game.primeTnt(hit.x, hit.y, hit.z);
        break;
      }
      this.pos.x += this.vel.x * sdt; this.pos.y += this.vel.y * sdt; this.pos.z += this.vel.z * sdt;
    }
    this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);
    if (this.kind === 'arrow' && !this.stuck) this.mesh.lookAt(this.pos.x + this.vel.x, this.pos.y + this.vel.y, this.pos.z + this.vel.z);
    else if (this.kind !== 'arrow') this.mesh.quaternion.copy(game.renderer.camera.quaternion);
    return this.age < 30 && this.pos.y > -20;
  }
}

class TntEntity {
  constructor(x, y, z, fuse, renderer) {
    this.pos = { x: x + 0.5, y, z: z + 0.5 };
    this.vel = { x: (Math.random() - 0.5) * 0.4, y: 4, z: (Math.random() - 0.5) * 0.4 };
    this.w = 0.49; this.h = 0.98;
    this.fuse = fuse;
    this.mesh = renderer.makeItemMesh(B.tnt, 1);
  }
  update(dt, game) {
    this.fuse -= dt;
    this.vel.y -= GRAVITY * dt;
    const r = moveBody(game.world, this, this.vel.x * dt, this.vel.y * dt, this.vel.z * dt);
    if (r.hitY) { this.vel.y = 0; this.vel.x *= 0.7; this.vel.z *= 0.7; }
    this.mesh.position.set(this.pos.x, this.pos.y + 0.5, this.pos.z);
    const flash = Math.floor(this.fuse * 5) % 2 === 0;
    this.mesh.material.color.setScalar(flash ? 2.2 : 1);
    if (this.fuse <= 0.5) this.mesh.scale.setScalar(1 + (0.5 - this.fuse) * 0.3);
    if (this.fuse <= 0) { game.explode(this.pos.x, this.pos.y + 0.5, this.pos.z, 4); return false; }
    return true;
  }
}

class Particles {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.geo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
  }
  spawn(x, y, z, color, n, speed, life, size) {
    for (let i = 0; i < n; i++) {
      const c = new THREE.Color(color[0] / 255, color[1] / 255, color[2] / 255).multiplyScalar(0.8 + Math.random() * 0.4);
      const m = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ color: c }));
      m.scale.setScalar((size || 1) * (0.6 + Math.random() * 0.8));
      m.position.set(x + (Math.random() - 0.5) * 0.6, y + (Math.random() - 0.5) * 0.6, z + (Math.random() - 0.5) * 0.6);
      const s = speed || 3;
      this.list.push({ m, vx: (Math.random() - 0.5) * s, vy: Math.random() * s, vz: (Math.random() - 0.5) * s, life: (life || 0.7) * (0.6 + Math.random() * 0.6) });
      this.scene.add(m);
    }
    while (this.list.length > 400) { const p = this.list.shift(); this.scene.remove(p.m); p.m.material.dispose(); }
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      if (p.life <= 0) { this.scene.remove(p.m); p.m.material.dispose(); this.list.splice(i, 1); continue; }
      p.vy -= 12 * dt;
      p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
    }
  }
}

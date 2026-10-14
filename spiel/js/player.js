'use strict';
// Spieler: Bewegung, Leben, Hunger, Inventar.

class Player {
  constructor() {
    this.pos = { x: 0, y: 80, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.w = 0.3; this.h = 1.8;
    this.yaw = 0; this.pitch = 0;
    this.onGround = false;
    this.mode = 'survival';
    this.flying = false;
    this.health = 20; this.food = 20; this.saturation = 5; this.exhaustion = 0;
    this.air = 300;
    this.inv = new Array(36).fill(null);
    this.armor = new Array(4).fill(null);
    this.selected = 0;
    this.fallDist = 0;
    this.invuln = 0;
    this.regenT = 0; this.starveT = 0; this.drownT = 0; this.fireT = 0; this.fire = 0;
    this.dead = false;
    this.spawn = null;
    this.sneaking = false; this.sprinting = false;
    this.hurtFlash = 0;
    this.attackCharge = 1;
    this.stepDist = 0;
  }

  get eyeHeight() { return this.sneaking ? 1.27 : 1.62; }
  eye() { return { x: this.pos.x, y: this.pos.y + this.eyeHeight, z: this.pos.z }; }
  lookDir() {
    const cp = Math.cos(this.pitch);
    return { x: -Math.sin(this.yaw) * cp, y: Math.sin(this.pitch), z: -Math.cos(this.yaw) * cp };
  }
  held() { return this.inv[this.selected]; }

  armorPoints() { return this.armor.reduce((s, a) => s + (a ? ITEMS[a.id].armor.points : 0), 0); }
  armorToughness() { return this.armor.reduce((s, a) => s + (a ? ITEMS[a.id].armor.toughness : 0), 0); }

  // ------------------------------------------------ Inventar
  addItem(stack) {
    // Gibt die Anzahl zurueck, die nicht mehr hineinpasst
    let n = stack.count;
    const max = itemMaxStack(stack.id);
    const order = [...Array(9).keys(), ...Array.from({ length: 27 }, (_, i) => i + 9)];
    if (max > 1) for (const i of order) {
      const s = this.inv[i];
      if (s && s.id === stack.id && s.count < max && !s.dmg) {
        const k = Math.min(n, max - s.count); s.count += k; n -= k;
        if (!n) return 0;
      }
    }
    for (const i of order) {
      if (!this.inv[i]) {
        const k = Math.min(n, max);
        this.inv[i] = { id: stack.id, count: k, dmg: stack.dmg || 0 };
        n -= k;
        if (!n) return 0;
      }
    }
    return n;
  }

  countItem(id) { return this.inv.reduce((s, x) => s + (x && x.id === id ? x.count : 0), 0); }
  removeItem(id, n) {
    for (let i = 0; i < 36 && n > 0; i++) {
      const s = this.inv[i];
      if (s && s.id === id) { const k = Math.min(n, s.count); s.count -= k; n -= k; if (!s.count) this.inv[i] = null; }
    }
  }

  consumeHeld(n) {
    if (this.mode === 'creative') return;
    const s = this.inv[this.selected];
    if (!s) return;
    s.count -= n || 1;
    if (s.count <= 0) this.inv[this.selected] = null;
  }

  damageHeld(amount, game) {
    if (this.mode === 'creative') return;
    const s = this.inv[this.selected];
    if (!s || !itemDurability(s.id)) return;
    s.dmg = (s.dmg || 0) + amount;
    if (s.dmg >= itemDurability(s.id)) { this.inv[this.selected] = null; game.sound('break_tool'); game.ui.toast(itemName(s.id) + ' ist kaputt gegangen'); }
  }

  // ------------------------------------------------ Schaden & Nahrung
  damage(amount, game, src, kind) {
    if (this.mode === 'creative' || this.dead) return false;
    if (this.invuln > 0) return false;
    if (kind !== 'starve' && kind !== 'drown' && kind !== 'fall' && kind !== 'fire') {
      // Ruestung (wie Java Edition)
      const a = this.armorPoints(), t = this.armorToughness();
      const red = Math.min(20, Math.max(a / 5, a - amount / (2 + t / 4))) / 25;
      amount = amount * (1 - red);
      if (a > 0) for (let i = 0; i < 4; i++) {
        const s = this.armor[i];
        if (!s) continue;
        s.dmg = (s.dmg || 0) + Math.max(1, Math.floor(amount / 4));
        if (s.dmg >= itemDurability(s.id)) { this.armor[i] = null; game.sound('break_tool'); }
      }
    }
    if (amount <= 0) return false;
    this.health -= amount;
    this.invuln = 0.5;
    this.hurtFlash = 0.35;
    this.exhaustion += 0.1;
    game.sound('hurt');
    if (src && src.pos !== undefined || (src && src.x !== undefined)) {
      const sx = src.pos ? src.pos.x : src.x, sz = src.pos ? src.pos.z : src.z;
      const dx = this.pos.x - sx, dz = this.pos.z - sz, l = Math.hypot(dx, dz) || 1;
      this.vel.x += dx / l * 6; this.vel.z += dz / l * 6; this.vel.y = Math.max(this.vel.y, 5);
    }
    if (this.health <= 0) { this.health = 0; game.onDeath(kind, src); }
    return true;
  }

  eat(id) {
    const f = ITEMS[id].food;
    this.food = Math.min(20, this.food + f[0]);
    this.saturation = Math.min(this.food, this.saturation + f[1]);
    if (ITEMS[id].regen) this.regenBoost = 5;
  }

  tickStats(dt, game) {
    if (this.mode === 'creative' || this.dead) { this.air = 300; return; }
    this.invuln = Math.max(0, this.invuln - dt);
    while (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.food = Math.max(0, this.food - 1);
    }
    if (this.regenBoost > 0) { this.regenBoost -= dt; this.regenT2 = (this.regenT2 || 0) + dt; if (this.regenT2 > 1.25) { this.regenT2 = 0; this.health = Math.min(20, this.health + 1); } }
    this.regenT += dt;
    if (this.food >= 20 && this.saturation > 0 && this.health < 20) {
      if (this.regenT >= 0.5) { this.regenT = 0; const s = Math.min(this.saturation, 6); this.health = Math.min(20, this.health + s / 6); this.exhaustion += s; }
    } else if (this.food >= 18 && this.health < 20) {
      if (this.regenT >= 4) { this.regenT = 0; this.health = Math.min(20, this.health + 1); this.exhaustion += 6; }
    } else if (this.food <= 0) {
      if (this.regenT >= 4) { this.regenT = 0; if (this.health > 1) this.damage(1, game, null, 'starve'); }
    } else this.regenT = Math.min(this.regenT, 4);
  }
}

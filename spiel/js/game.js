'use strict';
// Hauptspiel: Schleife, Steuerung, Interaktion, Spiellogik, Speichern.

const SAVE_PREFIX = 'swisscraft_world_';
const TICK = 1 / 20;
const DIR_KEYS = { KeyW: 'f', KeyS: 'b', KeyA: 'l', KeyD: 'r' };

function facingFromVec(dx, dz) {
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 3 : 1;
  return dz > 0 ? 0 : 2;
}
function connMeta(w, x, y, z, id) {
  const kind = BLOCKS[id].connects;
  let m = 0;
  for (let d = 0; d < 4; d++) {
    const [dx, , dz] = FACING[d];
    const nid = w.getBlock(x + dx, y, z + dz), nb = BLOCKS[nid];
    if (nb.opaque || (nb.connects && nb.connects === kind) || (kind === 'fence' && nb.shape === 'gate') || (kind === 'pane' && nid === B.glass)) m |= 1 << d;
  }
  return m;
}
function isSturdy(id) { const b = BLOCKS[id]; return b.opaque || b.shape === 'slab' || b.shape === 'stairs' || b.shape === 'farmland'; }
const SOIL = () => [B.grass_block, B.dirt, B.farmland, B.snowy_grass];

class Game {
  constructor() {
    this.canvas = $('#game');
    this.renderer = new Renderer(this.canvas);
    this.audio = new Sound();
    this.ui = new UI(this);
    this.player = new Player();
    this.particleSys = new Particles(this.renderer.scene);
    this.opts = Object.assign({ dist: 6, fov: 70, sens: 1, volume: 0.5, bob: true }, this.loadOpts());
    this.keys = {};
    this.mouse = { left: false, right: false };
    this.running = false;
    this.paused = true;
    this.stats = {};
    this.bindInput();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    requestAnimationFrame(t => this.frame(t));
  }

  loadOpts() { try { return JSON.parse(localStorage.getItem('swisscraft_opts')) || {}; } catch (e) { return {}; } }
  saveOpts() { try { localStorage.setItem('swisscraft_opts', JSON.stringify(this.opts)); } catch (e) { /* egal */ } }

  resize() { this.renderer.resize(window.innerWidth, window.innerHeight); }
  sound(n, mat) { this.audio.play(n, mat); }

  // ------------------------------------------------ Welt starten
  startWorld(meta, save) {
    this.meta = meta;
    this.world = new World(meta.seed, save ? save.mods : null);
    this.blockEntities = new Map(save && save.be ? Object.entries(save.be) : []);
    this.mobs = []; this.items = []; this.projectiles = []; this.tnts = [];
    this.storedMobs = save && save.storedMobs ? save.storedMobs : {};
    this.spawnedChunks = new Set(save && save.spawned ? save.spawned : []);
    this.fluidQueue = new Map();
    this.decay = [];
    this.time = save ? save.time : 1000;
    this.tickCount = 0;
    this.stats = {};
    const p = this.player = new Player();
    this.renderer.clearChunks();
    if (save && save.player) {
      Object.assign(p, save.player);
      p.vel = { x: 0, y: 0, z: 0 };
    } else {
      p.mode = meta.mode;
      const sp = this.world.gen.findSpawn();
      p.pos = { x: sp.x, y: sp.y + 1, z: sp.z };
      p.spawnSearch = true;
      p.needsGround = true;
    }
    if (save && save.mobs) for (const m of save.mobs) this.spawnMob(m.type, m.x, m.y, m.z, m);
    this.renderer.setRenderDistance(this.opts.dist);
    this.renderer.camera.fov = this.opts.fov; this.renderer.camera.updateProjectionMatrix();
    this.loading = true;
    this.running = true;
    this.lastChunk = null;
    this.breaking = null;
    this.ui.close();
    showMenu('loading');
    this.audio.volume = this.opts.volume;
  }

  serialize() {
    const p = this.player;
    const mobs = this.mobs.filter(m => !m.dead && m.persistent).map(m => ({ type: m.type, x: m.pos.x, y: m.pos.y, z: m.pos.z, sheared: m.sheared }));
    return {
      v: 1, time: this.time, mods: this.world.mods, be: Object.fromEntries(this.blockEntities),
      storedMobs: this.storedMobs, spawned: [...this.spawnedChunks], mobs,
      player: { pos: p.pos, yaw: p.yaw, pitch: p.pitch, mode: p.mode, health: p.health, food: p.food, saturation: p.saturation,
        inv: p.inv, armor: p.armor, selected: p.selected, spawn: p.spawn, flying: p.flying, air: p.air },
    };
  }

  save() {
    if (!this.world || !this.meta) return true;
    try {
      localStorage.setItem(SAVE_PREFIX + this.meta.id, JSON.stringify(this.serialize()));
      const list = worldList();
      const e = list.find(w => w.id === this.meta.id);
      if (e) { e.last = Date.now(); e.mode = this.player.mode; }
      localStorage.setItem('swisscraft_worlds', JSON.stringify(list));
      return true;
    } catch (e) {
      this.ui.toast('Speichern fehlgeschlagen (Speicher voll?)');
      return false;
    }
  }

  quitToTitle() {
    this.save();
    this.running = false;
    this.unlock();
    for (const m of this.mobs) m.dispose(this.renderer.scene);
    for (const it of this.items) this.renderer.scene.remove(it.mesh);
    for (const pr of this.projectiles) this.renderer.scene.remove(pr.mesh);
    for (const t of this.tnts) this.renderer.scene.remove(t.mesh);
    this.renderer.clearChunks();
    this.world = null;
    showMenu('title');
  }

  // ------------------------------------------------ Eingabe
  bindInput() {
    document.addEventListener('keydown', e => this.onKey(e, true));
    document.addEventListener('keyup', e => this.onKey(e, false));
    this.canvas.addEventListener('mousedown', e => {
      this.audio.init();
      if (!this.running) return;
      if (document.pointerLockElement !== this.canvas) { if (!this.ui.isOpen && !this.chatOpen && !this.dead()) this.lock(); return; }
      if (e.button === 0) { this.mouse.left = true; this.onLeftDown(); }
      if (e.button === 2) { this.mouse.right = true; this.onRightDown(); }
      if (e.button === 1) this.pickBlock();
    });
    document.addEventListener('mouseup', e => {
      if (e.button === 0) { this.mouse.left = false; this.breaking = null; }
      if (e.button === 2) { this.mouse.right = false; this.onRightUp(); }
    });
    document.addEventListener('contextmenu', e => { if (this.running) e.preventDefault(); });
    document.addEventListener('mousemove', e => {
      if (document.pointerLockElement !== this.canvas) return;
      const s = 0.0022 * this.opts.sens;
      const p = this.player;
      p.yaw -= e.movementX * s;
      p.pitch = clamp(p.pitch - e.movementY * s, -Math.PI / 2 + 0.001, Math.PI / 2 - 0.001);
    });
    document.addEventListener('wheel', e => {
      if (!this.running || document.pointerLockElement !== this.canvas) return;
      const p = this.player;
      p.selected = (p.selected + (e.deltaY > 0 ? 1 : -1) + 9) % 9;
      this.ui.showItemName(p.held());
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      if (!this.running) return;
      if (document.pointerLockElement !== this.canvas && !this.ui.isOpen && !this.chatOpen && !this.dead() && !this.sleeping) this.pause();
    });
    const chat = $('#chatinput');
    chat.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { const v = chat.value.trim(); this.closeChat(); if (v) this.handleChat(v); }
      if (e.key === 'Escape') this.closeChat();
    });
  }

  lock() { this.audio.init(); try { const r = this.canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* egal */ } this.paused = false; hideMenus(); }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  pause() { if (!this.running || this.loading) return; this.paused = true; this.mouse.left = this.mouse.right = false; this.keys = {}; this.save(); showMenu('pause'); }
  resume() { hideMenus(); this.lock(); }
  dead() { return this.player && this.player.dead; }

  onKey(e, down) {
    if (!this.running) return;
    if (this.chatOpen) return;
    const code = e.code;
    if (down && ['Space', 'ArrowUp', 'ArrowDown', 'Tab', 'F3', 'F1', 'F5', 'Slash'].includes(code)) e.preventDefault();
    if (this.ui.isOpen) {
      if (down && (code === 'KeyE' || code === 'Escape')) { this.ui.close(); this.lock(); }
      if (down && code.startsWith('Digit') && this.ui.mouseX !== undefined) {
        // Zahlentaste ueber Slot: in Schnellleiste tauschen
        const el = document.elementFromPoint(this.ui.mouseX, this.ui.mouseY);
        const slot = el && el.closest('.slot');
        const n = +code.slice(5) - 1;
        if (slot && n >= 0 && n < 9 && slot.dataset.c !== 'result' && slot.dataset.c !== 'creative') {
          const arr = this.ui.container(slot.dataset.c), i = +slot.dataset.i;
          const t = arr[i]; arr[i] = this.player.inv[n]; this.player.inv[n] = t; this.ui.refresh();
        }
      }
      return;
    }
    if (this.paused || this.dead()) return;
    const wasDown = this.keys[code];
    this.keys[code] = down;
    if (!down) return;
    const p = this.player;
    if (code.startsWith('Digit')) { const n = +code.slice(5); if (n >= 1 && n <= 9) { p.selected = n - 1; this.ui.showItemName(p.held()); } }
    if (code === 'KeyE') { this.unlock(); this.ui.open(p.mode === 'creative' ? 'creative' : 'inventory'); this.keys = {}; }
    if (code === 'KeyQ') this.dropHeld(e.ctrlKey);
    if (code === 'KeyT') { e.preventDefault(); this.openChat(''); }
    if (code === 'Slash') { e.preventDefault(); this.openChat('/'); }
    if (code === 'F3') $('#debug').style.display = $('#debug').style.display === 'block' ? 'none' : 'block';
    if (code === 'F1') this.hideHud = !this.hideHud;
    if (code === 'F5') this.thirdPerson = ((this.thirdPerson || 0) + 1) % 2;
    if (code === 'Space' && !wasDown) {
      const now = performance.now();
      if (p.mode === 'creative' && now - (this.lastSpace || 0) < 300) { p.flying = !p.flying; p.vel.y = 0; this.lastSpace = 0; }
      else this.lastSpace = now;
    }
    if (code === 'KeyW' && !wasDown) {
      const now = performance.now();
      if (now - (this.lastW || 0) < 300) this.sprintToggle = true;
      this.lastW = now;
    }
  }

  openChat(prefix) { this.chatOpen = true; this.unlock(); this.keys = {}; this.ui.openChat(prefix); }
  closeChat() { this.chatOpen = false; this.ui.closeChat(); setTimeout(() => this.lock(), 50); }

  // ------------------------------------------------ Befehle
  handleChat(msg) {
    if (!msg.startsWith('/')) { this.ui.chat('<Spieler> ' + msg); return; }
    const [cmd, ...a] = msg.slice(1).split(/\s+/);
    const p = this.player;
    const say = (t) => this.ui.chat(t, '#aaa');
    switch (cmd.toLowerCase()) {
      case 'help': say('Befehle: /gamemode <survival|creative>, /time set <day|night|noon|midnight|zahl>, /give <item> [anzahl], /tp <x> <y> <z>, /kill, /seed, /spawnpoint, /clear, /summon <mob>, /locate'); break;
      case 'gamemode': case 'gm': {
        const m = (a[0] || '').toLowerCase();
        if (['creative', 'c', '1', 'kreativ'].includes(m)) { p.mode = 'creative'; say('Spielmodus: Kreativ'); }
        else if (['survival', 's', '0', 'ueberleben'].includes(m)) { p.mode = 'survival'; p.flying = false; say('Spielmodus: Ueberleben'); }
        else say('Benutzung: /gamemode <survival|creative>');
        break;
      }
      case 'time': {
        const v = (a[1] || '').toLowerCase();
        const map = { day: 1000, noon: 6000, night: 13000, midnight: 18000, sunrise: 23000, sunset: 12000 };
        const t = map[v] !== undefined ? map[v] : parseInt(v, 10);
        if (a[0] === 'set' && !isNaN(t)) { this.time = Math.floor(this.time / 24000) * 24000 + t; say('Zeit gesetzt auf ' + t); }
        else if (a[0] === 'add' && !isNaN(t)) { this.time += t; }
        else say('Benutzung: /time set <day|night|zahl>');
        break;
      }
      case 'give': {
        const q = (a[0] || '').toLowerCase().replace('minecraft:', '');
        let id = I[q];
        if (id === undefined) { const it = ITEMS.find(x => x && x.de.toLowerCase() === q.replace(/_/g, ' ')); if (it) id = it.id; }
        if (id === undefined || id === 0) { say('Unbekanntes Item: ' + q); break; }
        const n = parseInt(a[1] || '1', 10) || 1;
        const left = p.addItem({ id, count: n });
        if (left) this.dropFromPlayer({ id, count: left });
        say(`${n} x ${itemName(id)} gegeben`);
        break;
      }
      case 'tp': {
        const v = a.map(Number);
        if (v.length >= 3 && v.every(x => !isNaN(x))) { p.pos = { x: v[0], y: v[1], z: v[2] }; p.vel = { x: 0, y: 0, z: 0 }; say('Teleportiert'); }
        else say('Benutzung: /tp <x> <y> <z>');
        break;
      }
      case 'kill': if (p.mode === 'creative') { say('Im Kreativmodus nicht moeglich'); } else { p.invuln = 0; p.damage(1000, this, null, 'kill'); } break;
      case 'seed': say('Seed: ' + this.meta.seed); break;
      case 'spawnpoint': p.spawn = { x: p.pos.x, y: p.pos.y, z: p.pos.z }; say('Spawnpunkt gesetzt'); break;
      case 'clear': p.inv.fill(null); p.armor.fill(null); say('Inventar geleert'); break;
      case 'summon': {
        const t = (a[0] || '').toLowerCase();
        if (!MOB_DEFS[t]) { say('Unbekannt. Moeglich: ' + Object.keys(MOB_DEFS).join(', ')); break; }
        const d = p.lookDir();
        this.spawnMob(t, p.pos.x + d.x * 3, p.pos.y + 0.5, p.pos.z + d.z * 3);
        break;
      }
      case 'heal': p.health = 20; p.food = 20; break;
      default: say('Unbekannter Befehl. /help fuer Hilfe');
    }
  }

  // ------------------------------------------------ Hauptschleife
  frame(t) {
    requestAnimationFrame(tt => this.frame(tt));
    const now = t / 1000;
    let dt = this.lastT ? now - this.lastT : 0.016;
    this.lastT = now;
    if (dt > 0.1) dt = 0.1;
    if (!this.running || !this.world) return;
    this.fps = this.fps ? this.fps * 0.95 + (1 / Math.max(dt, 0.001)) * 0.05 : 60;

    this.updateChunks();
    if (this.loading) {
      const p = this.player;
      const c = this.world.chunkAt(Math.floor(p.pos.x), Math.floor(p.pos.z));
      const ready = c && this.world.neighborsReady(c) && !c.dirty;
      $('#loadinfo').textContent = `Chunks: ${this.world.chunks.size}`;
      if (ready) {
        if (p.needsGround) {
          // Trockenen Platz mit Gras/Sand obendrauf in der Naehe suchen
          const w = this.world;
          const top = (x, z) => { let y = WH - 2; while (y > 1 && !BLOCKS[w.getBlock(x, y - 1, z)].solid && !BLOCKS[w.getBlock(x, y - 1, z)].fluid) y--; return y; };
          let bx = Math.floor(p.pos.x), bz = Math.floor(p.pos.z), by = top(bx, bz);
          const isNew = !p.spawn || p.spawnSearch;
          search: for (let r = 0; r < 24 && isNew; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const x = bx + dx, z = bz + dz;
            if (!w.isLoaded(x, z)) continue;
            const y = top(x, z);
            const g = w.getBlock(x, y - 1, z);
            if ((g === B.grass_block || g === B.sand || g === B.snowy_grass) && y > SEA && w.getBlock(x, y, z) === 0 && w.getBlock(x, y + 1, z) === 0) { bx = x; bz = z; by = y; break search; }
          }
          p.pos = { x: bx + 0.5, y: by, z: bz + 0.5 };
          p.needsGround = false;
          if (isNew) p.spawn = { x: bx + 0.5, y: by, z: bz + 0.5 };
          p.spawnSearch = false;
        }
        this.loading = false;
        hideMenus();
        showMenu('clicktoplay');
        this.paused = true;
      }
      this.renderFrame(0);
      return;
    }

    if (!this.paused || this.ui.isOpen || this.chatOpen || this.sleeping) {
      this.acc = (this.acc || 0) + dt;
      let n = 0;
      while (this.acc >= TICK && n < 5) { this.tick(); this.acc -= TICK; n++; }
      if (n === 5) this.acc = 0;
      if (!this.dead()) this.updatePlayer(dt);
      this.updateEntities(dt);
      this.updateInteraction(dt);
    }
    this.renderFrame(dt);
  }

  renderFrame(dt) {
    const p = this.player, r = this.renderer;
    const cam = r.camera;
    const eye = p.eye();
    let bobY = 0, bobX = 0;
    if (this.opts.bob && p.onGround && !p.flying) {
      const sp = Math.hypot(p.vel.x, p.vel.z);
      this.bobPhase = (this.bobPhase || 0) + sp * dt * 1.6;
      const amt = Math.min(1, sp / 4.3);
      bobY = -Math.abs(Math.sin(this.bobPhase)) * 0.06 * amt;
      bobX = Math.cos(this.bobPhase) * 0.03 * amt;
    }
    cam.position.set(eye.x + Math.cos(p.yaw) * bobX, eye.y + bobY, eye.z - Math.sin(p.yaw) * bobX);
    cam.rotation.set(p.pitch, p.yaw, p.hurtFlash > 0 ? Math.sin(p.hurtFlash * 18) * 0.04 : 0);
    if (this.thirdPerson) {
      const d = p.lookDir();
      const hit = raycast(this.world, eye.x, eye.y, eye.z, -d.x, -d.y, -d.z, 4);
      const dist = hit ? Math.max(0.3, hit.t - 0.2) : 4;
      cam.position.set(eye.x - d.x * dist, eye.y - d.y * dist, eye.z - d.z * dist);
    }
    this.updatePlayerModel();
    // Sichtfeld beim Sprinten
    const targetFov = this.opts.fov * (p.sprinting ? 1.12 : 1) * (p.flying && p.sprinting ? 1.05 : 1) * (1 - Math.min(1, this.bowCharge || 0) * 0.15);
    cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 10);
    cam.updateProjectionMatrix();
    const headId = this.world.getBlock(Math.floor(cam.position.x), Math.floor(cam.position.y), Math.floor(cam.position.z));
    const under = BLOCKS[headId].fluid || null;
    this.dayLight = r.updateSky(this.time % 24000, cam.position, under);
    const l = this.world.getLight(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z));
    r.updateHand(p.held(), dt, Math.hypot(p.vel.x, p.vel.z) > 0.5 && p.onGround, this.lightFactor(l), this.bowCharge || 0, this.eating > 0);
    r.render(!this.thirdPerson && !this.hideHud && !this.dead());
    $('#hud').style.display = this.hideHud ? 'none' : '';
    $('#crosshair').style.display = this.thirdPerson ? 'none' : '';
    $('#hurt').style.opacity = Math.max(0, p.hurtFlash * 2);
    $('#waterov').style.display = under === 'water' ? 'block' : 'none';
    p.hurtFlash = Math.max(0, p.hurtFlash - dt);
    if (this.uiTimer === undefined || (this.uiTimer -= dt) <= 0) {
      this.uiTimer = 0.1;
      this.ui.updateHUD();
      if (this.ui.isOpen && this.ui.screen.type === 'furnace') this.ui.updateFurnace();
      this.updateDebug();
    }
  }

  updatePlayerModel() {
    if (!this.playerModel) {
      this.playerMats = [];
      this.playerModel = buildMobModel('zombie', this.playerMats);
      const skins = [[198, 150, 120], [60, 168, 184], [59, 59, 158]];
      this.playerMats.forEach((m, i) => { m.map = colorCanvas(i < 2 ? skins[0] : i < 3 ? skins[1] : i < 5 ? skins[1] : skins[2]); });
      this.renderer.scene.add(this.playerModel);
    }
    const p = this.player;
    this.playerModel.visible = !!this.thirdPerson;
    if (!this.thirdPerson) return;
    this.playerModel.position.set(p.pos.x, p.pos.y, p.pos.z);
    this.playerModel.rotation.y = p.yaw + Math.PI;
    const P = this.playerModel.userData.parts;
    const sp = Math.hypot(p.vel.x, p.vel.z);
    this.pWalk = (this.pWalk || 0) + sp * 0.03;
    P.legs.forEach((l, i) => l.rotation.x = Math.sin(this.pWalk + P.legPhase[i]) * 0.7 * Math.min(1, sp / 3));
    P.armR.rotation.x = Math.sin(this.pWalk) * 0.6 * Math.min(1, sp / 3) - this.renderer.swing;
    P.armL.rotation.x = -Math.sin(this.pWalk) * 0.6 * Math.min(1, sp / 3);
    P.head.rotation.x = -p.pitch;
    const l = this.lightFactor(this.world.getLight(Math.floor(p.pos.x), Math.floor(p.pos.y + 1), Math.floor(p.pos.z)));
    for (const m of this.playerMats) m.color.setScalar(l);
  }

  updateDebug() {
    const el = $('#debug');
    if (el.style.display !== 'block') return;
    const p = this.player;
    const x = Math.floor(p.pos.x), y = Math.floor(p.pos.y), z = Math.floor(p.pos.z);
    const c = this.world.chunkAt(x, z);
    const l = this.world.getLight(x, y, z);
    const biome = c ? BIOME_DE[c.biome[((z & 15) << 4) | (x & 15)]] : '?';
    const dir = ['Sueden (+Z)', 'Westen (-X)', 'Norden (-Z)', 'Osten (+X)'][facingFromVec(-Math.sin(p.yaw), -Math.cos(p.yaw))];
    el.innerHTML = `SwissCraft (${Math.round(this.fps)} FPS)<br>XYZ: ${p.pos.x.toFixed(2)} / ${p.pos.y.toFixed(2)} / ${p.pos.z.toFixed(2)}<br>
      Chunk: ${x >> 4} ${z >> 4} (${this.world.chunks.size} geladen)<br>Blickrichtung: ${dir}<br>Biom: ${biome}<br>
      Licht: Himmel ${l >> 4}, Block ${l & 15}<br>Zeit: Tag ${Math.floor(this.time / 24000) + 1}, ${(Math.floor((this.time % 24000) / 1000 + 6) % 24)}:00<br>
      Wesen: ${this.mobs.length}, Items: ${this.items.length}<br>Seed: ${this.meta.seed}`;
  }

  lightFactor(l) {
    const sky = (l >> 4) / 15 * (this.dayLight || 1), bl = (l & 15) / 15;
    const lv = Math.max(sky, bl), f1 = 1 - lv;
    const br = Math.pow((1 - f1) / (f1 * 3 + 1), 0.75);
    return 0.08 + 0.92 * br;
  }

  isDay() { const t = this.time % 24000; return t < 12300 || t > 23700; }

  // ------------------------------------------------ Chunks laden
  updateChunks() {
    const w = this.world, p = this.player;
    const pcx = Math.floor(p.pos.x) >> 4, pcz = Math.floor(p.pos.z) >> 4;
    const R = this.opts.dist, LR = R + 1;
    const key = pcx + ',' + pcz + ',' + R;
    if (key !== this.lastChunk || !this.loadList) {
      this.lastChunk = key;
      const list = [];
      for (let dx = -LR; dx <= LR; dx++) for (let dz = -LR; dz <= LR; dz++) {
        if (dx * dx + dz * dz > (LR + 0.5) * (LR + 0.5)) continue;
        if (!w.getChunk(pcx + dx, pcz + dz)) list.push([pcx + dx, pcz + dz, dx * dx + dz * dz]);
      }
      list.sort((a, b) => a[2] - b[2]);
      this.loadList = list;
      // Entladen
      for (const c of [...w.chunks.values()]) {
        const dx = c.cx - pcx, dz = c.cz - pcz;
        if (dx * dx + dz * dz > (LR + 2.5) * (LR + 2.5)) {
          this.storeMobsOfChunk(c);
          this.renderer.removeChunkMesh(c);
          w.unloadChunk(c);
        }
      }
    }
    const t0 = performance.now();
    const budget = this.loading ? 40 : 6;
    while (this.loadList.length && performance.now() - t0 < budget) {
      const [cx, cz] = this.loadList.shift();
      if (w.getChunk(cx, cz)) continue;
      const spawns = w.loadChunk(cx, cz);
      const k = w.key(cx, cz);
      if (!this.spawnedChunks.has(k)) {
        this.spawnedChunks.add(k);
        for (const s of spawns) this.spawnMob(s.type, s.x, s.y, s.z);
      }
      if (this.storedMobs[k]) { for (const m of this.storedMobs[k]) this.spawnMob(m.type, m.x, m.y, m.z, m); delete this.storedMobs[k]; }
    }
    // Meshes bauen (naechste zuerst)
    const t1 = performance.now();
    const mb = this.loading ? 40 : 7;
    const dirty = [];
    for (const c of w.chunks.values()) {
      if (!c.dirty) continue;
      const dx = c.cx - pcx, dz = c.cz - pcz;
      if (dx * dx + dz * dz > (R + 0.5) * (R + 0.5)) continue;
      if (!w.neighborsReady(c)) continue;
      dirty.push([c, dx * dx + dz * dz]);
    }
    dirty.sort((a, b) => a[1] - b[1]);
    for (const [c] of dirty) {
      if (performance.now() - t1 > mb) break;
      c.dirty = false;
      this.renderer.updateChunkMesh(c, buildChunkMesh(w, c));
    }
  }

  storeMobsOfChunk(c) {
    const k = this.world.key(c.cx, c.cz);
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i];
      if ((Math.floor(m.pos.x) >> 4) === c.cx && (Math.floor(m.pos.z) >> 4) === c.cz) {
        if (m.persistent && !m.dead) (this.storedMobs[k] || (this.storedMobs[k] = [])).push({ type: m.type, x: m.pos.x, y: m.pos.y, z: m.pos.z, sheared: m.sheared });
        m.dispose(this.renderer.scene);
        this.mobs.splice(i, 1);
      }
    }
  }

  // ------------------------------------------------ Spieler-Bewegung
  updatePlayer(dt) {
    const p = this.player, w = this.world;
    const k = this.keys;
    const active = !this.ui.isOpen && !this.chatOpen && !this.paused;
    const fwd = active ? (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0) : 0;
    const str = active ? (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0) : 0;
    const jump = active && k.Space;
    const shift = active && (k.ShiftLeft || k.ShiftRight);
    p.sneaking = shift && !p.flying;
    p.h = p.sneaking ? 1.5 : 1.8;
    const fx = Math.floor(p.pos.x), fz = Math.floor(p.pos.z);
    const feet = w.getBlock(fx, Math.floor(p.pos.y + 0.1), fz), body = w.getBlock(fx, Math.floor(p.pos.y + 0.9), fz);
    const head = w.getBlock(fx, Math.floor(p.pos.y + p.eyeHeight), fz);
    const inWater = BLOCKS[feet].fluid === 'water' || BLOCKS[body].fluid === 'water';
    const inLava = BLOCKS[feet].fluid === 'lava' || BLOCKS[body].fluid === 'lava';
    const onLadder = BLOCKS[feet].climbable || BLOCKS[body].climbable;
    const ice = p.onGround && BLOCKS[w.getBlock(fx, Math.floor(p.pos.y - 0.05), fz)].slippery;

    if (active && (k.ControlLeft || k.ControlRight || this.sprintToggle) && fwd > 0 && !p.sneaking && (p.food > 6 || p.mode === 'creative') && !this.eating) p.sprinting = true;
    if (fwd <= 0 || p.sneaking || (p.food <= 6 && p.mode !== 'creative') || this.eating > 0 || this.bowCharge > 0) { p.sprinting = false; this.sprintToggle = false; }

    let speed = p.sprinting ? 5.612 : 4.317;
    if (p.sneaking) speed = 1.295;
    if (this.eating > 0 || this.bowCharge > 0) speed *= 0.3;
    if (p.flying) speed = p.sprinting ? 21.6 : 10.9;
    else if (inWater) speed *= 0.45;
    else if (inLava) speed *= 0.3;
    let wx = 0, wz = 0;
    if (fwd || str) {
      const l = Math.hypot(fwd, str);
      const sf = fwd / l, ss = str / l;
      wx = (-Math.sin(p.yaw) * sf + Math.cos(p.yaw) * ss) * speed;
      wz = (-Math.cos(p.yaw) * sf - Math.sin(p.yaw) * ss) * speed;
    }
    const accel = p.flying ? 6 : p.onGround ? (ice ? 1.5 : 16) : (inWater ? 6 : 3.2);
    const a = 1 - Math.exp(-dt * accel);
    p.vel.x += (wx - p.vel.x) * a;
    p.vel.z += (wz - p.vel.z) * a;

    if (p.flying) {
      const vy = (jump ? 1 : 0) - (shift ? 1 : 0);
      p.vel.y += (vy * 7.5 - p.vel.y) * (1 - Math.exp(-dt * 10));
      p.fallDist = 0;
    } else if (inWater || inLava) {
      p.vel.y -= (inLava ? 4 : 6) * dt;
      p.vel.y *= Math.pow(inLava ? 0.2 : 0.35, dt);
      if (jump) p.vel.y = Math.min(p.vel.y + 22 * dt, inLava ? 1.5 : 2.6);
      if (shift) p.vel.y -= 8 * dt;
      p.fallDist = 0;
    } else if (onLadder) {
      p.vel.y -= GRAVITY * dt;
      p.vel.y = Math.max(p.vel.y, -2.35);
      if (p.sneaking) p.vel.y = Math.max(p.vel.y, 0);
      if (jump || (this.hitWall && fwd > 0)) p.vel.y = 2.35;
      p.fallDist = 0;
    } else {
      p.vel.y -= GRAVITY * dt;
      p.vel.y *= Math.pow(0.98, dt * 20);
      if (jump && p.onGround && (this.jumpCd || 0) <= 0) {
        p.vel.y = 9.0;
        this.jumpCd = 0.05;
        if (p.sprinting) { p.vel.x += -Math.sin(p.yaw) * 2.5; p.vel.z += -Math.cos(p.yaw) * 2.5; p.exhaustion += 0.2; }
        else p.exhaustion += 0.05;
      }
    }
    this.jumpCd = (this.jumpCd || 0) - dt;
    // Aus dem Wasser an eine Kante springen
    if ((inWater || inLava) && this.hitWall && jump) p.vel.y = 6;

    const ox = p.pos.x, oz = p.pos.z;
    const r = moveWithStep(w, p, p.vel.x * dt, p.vel.y * dt, p.vel.z * dt, p.onGround && !p.flying ? 0.6 : 0, p.sneaking);
    this.hitWall = r.hitX || r.hitZ;
    if (r.hitX) { p.vel.x = 0; if (p.sprinting) p.sprinting = false; }
    if (r.hitZ) { p.vel.z = 0; }
    if (r.hitY) {
      if (p.vel.y < 0) {
        p.onGround = true;
        if (p.fallDist > 3 && p.mode === 'survival' && !inWater) {
          const dmg = Math.ceil(p.fallDist - 3);
          p.invuln = 0;
          p.damage(dmg, this, null, 'fall');
        }
        if (p.fallDist > 1.5) this.sound('step', blockSoundMat(w.getBlock(Math.floor(p.pos.x), Math.floor(p.pos.y - 0.1), Math.floor(p.pos.z))));
        p.fallDist = 0;
        if (p.flying && p.mode === 'creative') p.flying = false;
      }
      p.vel.y = 0;
    } else {
      p.onGround = r.ground;
      if (p.vel.y < 0 && !p.flying) p.fallDist += -p.vel.y * dt;
    }
    if (p.mode !== 'creative') p.flying = false;
    // Schritte und Erschoepfung
    const moved = Math.hypot(p.pos.x - ox, p.pos.z - oz);
    if (p.onGround && !p.flying) {
      p.stepDist += moved;
      if (p.stepDist > 1.8) { p.stepDist = 0; this.sound('step', blockSoundMat(w.getBlock(Math.floor(p.pos.x), Math.floor(p.pos.y - 0.1), Math.floor(p.pos.z)))); }
    }
    if (p.sprinting) p.exhaustion += moved * 0.1;
    else if (inWater) p.exhaustion += moved * 0.01;

    // Umgebungsschaden
    if (p.mode === 'survival') {
      if (BLOCKS[head].fluid === 'water') {
        p.air -= dt * 20;
        if (p.air <= -20) { p.air = 0; p.invuln = 0; p.damage(2, this, null, 'drown'); }
      } else p.air = Math.min(300, p.air + dt * 100);
      if (inLava) { p.fire = 15; if (p.invuln <= 0) p.damage(4, this, null, 'lava'); }
      if (inWater) p.fire = 0;
      if (p.fire > 0) {
        p.fire -= dt;
        p.fireT += dt;
        if (p.fireT >= 1) { p.fireT = 0; p.invuln = 0; p.damage(1, this, null, 'fire'); }
      }
      // Kaktus
      if (!boxFree2(w, p, B.cactus)) p.damage(1, this, null, 'cactus');
      if (p.pos.y < -40) { p.invuln = 0; p.damage(4, this, null, 'void'); }
      p.tickStats(dt, this);
    }
  }

  // ------------------------------------------------ Entities
  spawnMob(type, x, y, z, data) {
    const m = new Mob(type, x, y, z);
    if (data && data.sheared) m.sheared = true;
    this.mobs.push(m);
    this.renderer.scene.add(m.model);
    return m;
  }

  dropItem(x, y, z, stack, vel) {
    if (!stack || !stack.count) return;
    // Mit gleichem Item in der Naehe zusammenfassen
    for (const it of this.items) {
      if (it.stack.id === stack.id && !it.stack.dmg && !stack.dmg && it.stack.count + stack.count <= itemMaxStack(stack.id) && Math.hypot(it.pos.x - x, it.pos.y - y, it.pos.z - z) < 1.2) {
        it.stack.count += stack.count; return it;
      }
    }
    const e = new ItemEntity({ id: stack.id, count: stack.count, dmg: stack.dmg || 0 }, x, y, z, this.renderer);
    if (vel) e.vel = vel;
    this.items.push(e);
    this.renderer.scene.add(e.mesh);
    return e;
  }

  dropFromPlayer(stack) {
    const p = this.player, d = p.lookDir(), e = p.eye();
    const it = this.dropItem(e.x + d.x * 0.3, e.y - 0.3, e.z + d.z * 0.3, stack, { x: d.x * 5, y: d.y * 5 + 1.5, z: d.z * 5 });
    if (it) it.pickupDelay = 2;
  }

  dropHeld(all) {
    const p = this.player, s = p.held();
    if (!s) return;
    const n = all ? s.count : 1;
    this.dropFromPlayer({ id: s.id, count: n, dmg: s.dmg });
    s.count -= n;
    if (s.count <= 0) p.inv[p.selected] = null;
  }

  spawnArrow(x, y, z, vx, vy, vz, owner, dmg, shooter) {
    const a = new Projectile('arrow', x, y, z, vx, vy, vz, owner, dmg, this.renderer);
    a.shooter = shooter || null;
    this.projectiles.push(a);
    this.renderer.scene.add(a.mesh);
  }

  particles(x, y, z, col, n) { this.particleSys.spawn(x, y, z, col, n); }

  blockParticles(x, y, z, id) {
    const b = BLOCKS[id];
    const t = b.faces.side;
    const tx = t % ATLAS_TILES, ty = Math.floor(t / ATLAS_TILES);
    const d = atlasCtx.getImageData(tx * 16 + 6, ty * 16 + 6, 4, 4).data;
    let r = 0, g = 0, bb = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) { r += d[i]; g += d[i + 1]; bb += d[i + 2]; n++; }
    if (!n) return;
    this.particleSys.spawn(x + 0.5, y + 0.5, z + 0.5, [r / n, g / n, bb / n], 10, 3, 0.6);
  }

  entityRaycast(ox, oy, oz, dx, dy, dz, maxD, owner, ignore) {
    let best = null;
    const test = (target, x0, y0, z0, x1, y1, z1) => {
      const r = rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1);
      if (r && r.t <= maxD && (!best || r.t < best.t)) best = { target, t: r.t };
    };
    for (const m of this.mobs) {
      if (m.dead || m === ignore) continue;
      test(m, m.pos.x - m.w - 0.1, m.pos.y, m.pos.z - m.w - 0.1, m.pos.x + m.w + 0.1, m.pos.y + m.h, m.pos.z + m.w + 0.1);
    }
    if (owner === 'mob') {
      const p = this.player;
      test(p, p.pos.x - 0.35, p.pos.y, p.pos.z - 0.35, p.pos.x + 0.35, p.pos.y + p.h, p.pos.z + 0.35);
    }
    return best;
  }

  lineOfSight(x0, y0, z0, x1, y1, z1) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, l = Math.hypot(dx, dy, dz);
    const hit = raycast(this.world, x0, y0, z0, dx / l, dy / l, dz / l, l);
    return !hit || !BLOCKS[hit.id].opaque;
  }

  updateEntities(dt) {
    const p = this.player;
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i];
      if (!this.world.isLoaded(Math.floor(m.pos.x), Math.floor(m.pos.z))) continue;
      if (!m.update(dt, this)) { m.dispose(this.renderer.scene); this.mobs.splice(i, 1); }
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      let keep = it.update(dt, this);
      if (keep && !p.dead && it.pickupDelay <= 0) {
        const d = Math.hypot(p.pos.x - it.pos.x, p.pos.y + 0.6 - it.pos.y, p.pos.z - it.pos.z);
        if (d < 1.6) {
          const left = p.addItem(it.stack);
          if (left < it.stack.count) { this.sound('pop'); }
          if (left === 0) keep = false; else it.stack.count = left;
        }
      }
      if (!keep) { this.renderer.scene.remove(it.mesh); it.mesh.geometry.dispose(); this.items.splice(i, 1); }
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      if (!this.projectiles[i].update(dt, this)) { this.renderer.scene.remove(this.projectiles[i].mesh); this.projectiles.splice(i, 1); }
    }
    for (let i = this.tnts.length - 1; i >= 0; i--) {
      if (!this.tnts[i].update(dt, this)) { this.renderer.scene.remove(this.tnts[i].mesh); this.tnts.splice(i, 1); }
    }
    this.particleSys.update(dt);
  }

  // ------------------------------------------------ Interaktion
  target() {
    const p = this.player, e = p.eye(), d = p.lookDir();
    const reach = p.mode === 'creative' ? 5 : 4.5;
    const hit = raycast(this.world, e.x, e.y, e.z, d.x, d.y, d.z, reach);
    const ent = this.entityRaycast(e.x, e.y, e.z, d.x, d.y, d.z, Math.min(hit ? hit.t : 99, p.mode === 'creative' ? 5 : 3));
    return { hit, ent };
  }

  updateInteraction(dt) {
    const p = this.player;
    this.attackTimer = (this.attackTimer || 0) + dt;
    if (this.paused || this.ui.isOpen || this.chatOpen || p.dead) { this.renderer.showSelection(null); this.eating = 0; this.bowCharge = 0; return; }
    const { hit, ent } = this.target();
    this.curTarget = hit;
    // Abbauen
    let stage = -1;
    if (this.mouse.left && hit && !ent) {
      if (p.mode === 'creative') {
        this.creativeCd = (this.creativeCd || 0) - dt;
        if (this.creativeCd <= 0 && this.breakHeldNew) { this.breakBlock(hit); this.creativeCd = 0.25; }
        this.breakHeldNew = true;
      } else {
        const b = this.breaking;
        if (!b || b.x !== hit.x || b.y !== hit.y || b.z !== hit.z || b.id !== hit.id) {
          const inW = BLOCKS[this.world.getBlock(Math.floor(p.pos.x), Math.floor(p.pos.y + p.eyeHeight), Math.floor(p.pos.z))].fluid === 'water';
          const held = p.held();
          this.breaking = { x: hit.x, y: hit.y, z: hit.z, id: hit.id, t: 0, total: blockBreakTime(hit.id, held ? held.id : 0, inW, p.onGround || p.flying), snd: 0 };
        }
        const br = this.breaking;
        br.t += dt;
        br.snd -= dt;
        if (br.snd <= 0) { br.snd = 0.22; this.sound('dig', blockSoundMat(hit.id)); this.renderer.swing = 1; }
        if (br.total === Infinity) stage = -1;
        else if (br.t >= br.total) { this.breakBlock(hit); this.breaking = null; }
        else stage = Math.floor(br.t / br.total * 10);
      }
    } else if (!this.mouse.left) { this.breaking = null; this.breakHeldNew = false; this.creativeCd = 0; }
    this.renderer.showSelection(hit, stage);

    // Rechtsklick gehalten: essen, Bogen spannen, wiederholt setzen
    const held = p.held();
    if (this.mouse.right) {
      if (this.eating > 0 && held && (ITEMS[held.id].food || ITEMS[held.id].drink)) {
        this.eating += dt;
        if (Math.floor(this.eating * 5) !== Math.floor((this.eating - dt) * 5)) this.sound('eat');
        if (this.eating >= 1.61) {
          if (ITEMS[held.id].drink) { if (p.mode === 'survival') p.inv[p.selected] = { id: I.bucket, count: 1 }; }
          else { p.eat(held.id); p.consumeHeld(1); }
          this.sound('burp');
          this.eating = 0;
          this.useCd = 0.3;
        }
      } else if (this.bowCharge > 0 && held && held.id === I.bow) {
        this.bowCharge += dt;
      } else {
        this.useCd = (this.useCd || 0) - dt;
        if (this.useCd <= 0) { this.useItem(true); this.useCd = 0.2; }
      }
    } else { this.eating = 0; }
  }

  onLeftDown() {
    const p = this.player;
    this.renderer.swing = 1;
    const { hit, ent } = this.target();
    if (ent) { this.attack(ent.target); return; }
    if (p.mode === 'creative' && hit) {
      const held = p.held();
      if (held && ITEMS[held.id].tool && ITEMS[held.id].tool.type === 'sword') return;
      this.breakBlock(hit); this.creativeCd = 0.3; this.breakHeldNew = true;
    }
  }

  attack(m) {
    const p = this.player, held = p.held();
    const tool = held && ITEMS[held.id].tool;
    const atkSpeed = tool && tool.attackSpeed ? tool.attackSpeed : 4;
    const charge = Math.min(1, this.attackTimer * atkSpeed);
    this.attackTimer = 0;
    let dmg = (tool ? tool.damage : 1) * (0.2 + charge * charge * 0.8);
    const crit = charge > 0.9 && p.vel.y < 0 && !p.onGround && !p.flying;
    if (crit) { dmg *= 1.5; this.particles(m.pos.x, m.pos.y + m.h * 0.7, m.pos.z, [240, 240, 200], 8); }
    const kb = p.sprinting && charge > 0.9 ? 1.6 : 1;
    if (m.damage(dmg, p.pos, this, kb)) {
      p.exhaustion += 0.1;
      if (tool) p.damageHeld(tool.type === 'sword' ? 1 : 2, this);
      if (p.sprinting) p.sprinting = false;
    }
  }

  onRightDown() {
    this.useCd = 0.25;
    this.useItem(false);
  }

  onRightUp() {
    const p = this.player;
    if (this.bowCharge > 0) {
      const held = p.held();
      const t = this.bowCharge;
      this.bowCharge = 0;
      if (held && held.id === I.bow && t > 0.1) {
        let f = t / 1; f = (f * f + f * 2) / 3; f = Math.min(1, f);
        if (f >= 0.1) {
          const hasArrow = p.mode === 'creative' || p.countItem(I.arrow) > 0;
          if (hasArrow) {
            if (p.mode !== 'creative') p.removeItem(I.arrow, 1);
            const e = p.eye(), d = p.lookDir();
            this.spawnArrow(e.x + d.x * 0.5, e.y - 0.1 + d.y * 0.5, e.z + d.z * 0.5, d.x * 60 * f, d.y * 60 * f, d.z * 60 * f, 'player', Math.ceil(f * 9 * (f >= 1 && Math.random() < 0.25 ? 1.5 : 1)));
            this.sound('bow');
            p.damageHeld(1, this);
          }
        }
      }
    }
    this.eating = 0;
  }

  pickBlock() {
    const { hit } = this.target();
    if (!hit) return;
    const p = this.player;
    let id = hit.id;
    const map = { [B.grass_block]: B.grass_block, [B.furnace_lit]: B.furnace, [B.oak_door]: I.oak_door, [B.bed]: I.white_bed, [B.snowy_grass]: B.grass_block, [B.farmland]: B.dirt };
    if (map[id] !== undefined) id = map[id];
    if (BLOCKS[id] && BLOCKS[id].crop !== undefined) id = I.wheat_seeds;
    if (!ITEMS[id]) return;
    const idx = p.inv.findIndex((s, i) => i < 9 && s && s.id === id);
    if (idx >= 0) { p.selected = idx; return; }
    if (p.mode === 'creative') p.inv[p.selected] = { id, count: itemMaxStack(id) };
  }

  useItem(repeat) {
    const p = this.player, w = this.world;
    const held = p.held();
    const { hit, ent } = this.target();
    this.renderer.swing = 0;
    // 1. Wesen
    if (ent && !repeat) {
      const m = ent.target;
      if (held && held.id === I.shears && m.type === 'sheep' && !m.sheared) {
        m.sheared = true;
        this.dropItem(m.pos.x, m.pos.y + 1, m.pos.z, { id: B.white_wool, count: 1 + (Math.random() * 3 | 0) });
        p.damageHeld(1, this); this.sound('equip'); this.renderer.swing = 1; return;
      }
      if (held && held.id === I.bucket && m.type === 'cow') {
        p.consumeHeld(1);
        if (p.mode === 'survival') { const left = p.addItem({ id: I.milk_bucket, count: 1 }); if (left) this.dropFromPlayer({ id: I.milk_bucket, count: 1 }); }
        this.sound('splash'); return;
      }
    }
    // 2. Bloecke mit Funktion
    if (hit && !p.sneaking && !repeat) {
      const id = hit.id;
      if (id === B.crafting_table) { this.unlock(); this.keys = {}; this.ui.open('table'); return; }
      if (id === B.furnace || id === B.furnace_lit) { this.unlock(); this.keys = {}; this.ui.open('furnace', this.getBE(hit.x, hit.y, hit.z, 'furnace')); return; }
      if (id === B.chest) { this.unlock(); this.keys = {}; this.ui.open('chest', this.getBE(hit.x, hit.y, hit.z, 'chest')); this.sound('door'); return; }
      if (id === B.oak_door) { this.toggleDoor(hit.x, hit.y, hit.z); this.renderer.swing = 1; return; }
      if (id === B.bed) { this.sleep(hit); return; }
      if (id === B.oak_fence_gate || id === B.oak_trapdoor) {
        let m = w.getMeta(hit.x, hit.y, hit.z) ^ 4;
        if (id === B.oak_fence_gate && (m & 4)) m = (m & ~3) | facingFromVec(p.lookDir().x, p.lookDir().z);
        w.setBlock(hit.x, hit.y, hit.z, id, m); this.sound('door'); this.renderer.swing = 1; return;
      }
      if (id === B.cake && (p.food < 20 || p.mode === 'creative')) {
        const m = w.getMeta(hit.x, hit.y, hit.z);
        p.food = Math.min(20, p.food + 2); p.saturation = Math.min(p.food, p.saturation + 0.4);
        if (m >= 6) w.setBlock(hit.x, hit.y, hit.z, 0); else w.setBlock(hit.x, hit.y, hit.z, B.cake, m + 1);
        this.sound('eat'); return;
      }
      if (id === B.tnt && held && held.id === I.flint_and_steel) { this.primeTnt(hit.x, hit.y, hit.z); p.damageHeld(1, this); return; }
      if (id === B.pumpkin && held && held.id === I.shears) {
        w.setBlock(hit.x, hit.y, hit.z, B.carved_pumpkin, facingFromVec(-p.lookDir().x, -p.lookDir().z));
        this.dropItem(hit.x + 0.5 + hit.nx * 0.6, hit.y + 0.5, hit.z + 0.5 + hit.nz * 0.6, { id: I.pumpkin_seeds, count: 4 });
        p.damageHeld(1, this); return;
      }
    }
    if (!held) return;
    const it = ITEMS[held.id];
    // 3. Essen / Trinken
    if ((it.food && (p.food < 20 || p.mode === 'creative' || held.id === I.golden_apple)) || it.drink) { if (!this.eating) this.eating = 0.001; return; }
    if (held.id === I.bow) { if (p.mode === 'creative' || p.countItem(I.arrow) > 0) this.bowCharge = 0.001; return; }
    if (it.throwable) {
      const e = p.eye(), d = p.lookDir();
      const pr = new Projectile(it.name, e.x + d.x * 0.4, e.y + d.y * 0.4 - 0.1, e.z + d.z * 0.4, d.x * 25, d.y * 25 + 2, d.z * 25, 'player', 0, this.renderer);
      this.projectiles.push(pr); this.renderer.scene.add(pr.mesh);
      p.consumeHeld(1); this.sound('bow'); this.renderer.swing = 1;
      return;
    }
    // 4. Eimer
    if (held.id === I.bucket) {
      const e = p.eye(), d = p.lookDir();
      const fh = raycast(w, e.x, e.y, e.z, d.x, d.y, d.z, 5, { fluids: true });
      if (fh && BLOCKS[fh.id].fluid && fh.meta === 0) {
        const nid = BLOCKS[fh.id].fluid === 'water' ? I.water_bucket : I.lava_bucket;
        w.setBlock(fh.x, fh.y, fh.z, 0);
        this.sound('splash');
        if (p.mode === 'survival') {
          if (held.count === 1) p.inv[p.selected] = { id: nid, count: 1 };
          else { held.count--; if (p.addItem({ id: nid, count: 1 })) this.dropFromPlayer({ id: nid, count: 1 }); }
        }
      }
      return;
    }
    if (!hit) return;
    if (held.id === I.water_bucket || held.id === I.lava_bucket) {
      const tgt = BLOCKS[hit.id].replaceable ? hit : { x: hit.x + hit.nx, y: hit.y + hit.ny, z: hit.z + hit.nz };
      const cur = w.getBlock(tgt.x, tgt.y, tgt.z);
      if (cur && !BLOCKS[cur].replaceable && !(BLOCKS[cur].fluid)) return;
      if (cur && !BLOCKS[cur].fluid) this.breakNatural(tgt.x, tgt.y, tgt.z);
      w.setBlock(tgt.x, tgt.y, tgt.z, held.id === I.water_bucket ? B.water : B.lava, 0);
      this.scheduleFluid(tgt.x, tgt.y, tgt.z);
      this.sound('splash');
      if (p.mode === 'survival') p.inv[p.selected] = { id: I.bucket, count: 1 };
      this.renderer.swing = 1;
      return;
    }
    // 5. Werkzeuge auf Bloecken
    if (it.tool && it.tool.type === 'hoe' && (hit.id === B.grass_block || hit.id === B.dirt) && hit.ny >= 0 && !w.getBlock(hit.x, hit.y + 1, hit.z)) {
      w.setBlock(hit.x, hit.y, hit.z, B.farmland);
      this.sound('step', 'dirt'); p.damageHeld(1, this); this.renderer.swing = 1;
      return;
    }
    if (held.id === I.bone_meal) {
      const b = BLOCKS[hit.id];
      let used = false;
      if (b.crop !== undefined && b.crop < 3) { w.setBlock(hit.x, hit.y, hit.z, B.wheat0 + Math.min(3, b.crop + 1 + (Math.random() * 2 | 0))); used = true; }
      else if (b.sapling) { if (Math.random() < 0.45) this.growTree(hit.x, hit.y, hit.z, b.sapling); used = true; }
      else if (hit.id === B.grass_block) {
        for (let k = 0; k < 20; k++) {
          const x = hit.x + Math.round((Math.random() - 0.5) * 6), z = hit.z + Math.round((Math.random() - 0.5) * 6);
          if (w.getBlock(x, hit.y, z) === B.grass_block && !w.getBlock(x, hit.y + 1, z)) w.setBlock(x, hit.y + 1, z, Math.random() < 0.85 ? B.short_grass : Math.random() < 0.5 ? B.dandelion : B.poppy);
        }
        used = true;
      }
      if (used) { p.consumeHeld(1); this.particles(hit.x + 0.5, hit.y + 0.7, hit.z + 0.5, [120, 220, 120], 8); this.renderer.swing = 1; }
      return;
    }
    // 6. Bloecke setzen
    const placeId = it.block !== null && it.block !== undefined ? it.block : (it.places ? B[it.places] : null);
    if (placeId === null || placeId === undefined) return;
    if (this.placeBlock(hit, placeId)) {
      p.consumeHeld(1);
      this.renderer.swing = 1;
      this.sound('place', blockSoundMat(placeId));
    }
  }

  placeBlock(hit, id) {
    const w = this.world, p = this.player, b = BLOCKS[id];
    // Stufen zusammensetzen
    if (b.shape === 'slab' && hit.id === id && hit.meta !== 2 && ((hit.meta === 0 && hit.ny === 1) || (hit.meta === 1 && hit.ny === -1))) {
      w.setBlock(hit.x, hit.y, hit.z, id, 2); return true;
    }
    let x = hit.x, y = hit.y, z = hit.z;
    if (!BLOCKS[hit.id].replaceable) { x += hit.nx; y += hit.ny; z += hit.nz; }
    if (y < 0 || y >= WH) return false;
    const cur = w.getBlock(x, y, z);
    if (b.shape === 'slab' && cur === id && w.getMeta(x, y, z) !== 2) { w.setBlock(x, y, z, id, 2); return true; }
    if (!BLOCKS[cur].replaceable) return false;
    const look = p.lookDir();
    const lf = facingFromVec(look.x, look.z);
    let meta = 0;
    const fracY = hit.py - Math.floor(hit.py);
    const below = w.getBlock(x, y - 1, z);
    if (b.facing) meta = facingFromVec(-look.x, -look.z);
    if (b.shape === 'stairs') meta = lf | ((hit.ny === -1 || (hit.ny === 0 && fracY > 0.5)) ? 4 : 0);
    if (b.shape === 'slab') meta = (hit.ny === -1 || (hit.ny === 0 && fracY > 0.5)) ? 1 : 0;
    if (b.name.endsWith('leaves')) meta = 1;
    if (b.shape === 'torch') {
      if (hit.ny === 1 && isSturdy(w.getBlock(x, y - 1, z))) meta = 0;
      else if (hit.ny === 0) { meta = 1 + facingFromVec(-hit.nx, -hit.nz); if (!isSturdy(hit.id)) return false; }
      else return false;
    }
    if (b.shape === 'ladder') {
      if (hit.ny !== 0 || !isSturdy(hit.id)) return false;
      meta = facingFromVec(-hit.nx, -hit.nz);
    }
    if (b.needsSoil && !SOIL().includes(below)) return false;
    if (b.crop !== undefined && below !== B.farmland) return false;
    if (id === B.sugar_cane) {
      if (below !== B.sugar_cane) {
        if (![B.grass_block, B.dirt, B.sand].includes(below)) return false;
        let water = false;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (BLOCKS[w.getBlock(x + dx, y - 1, z + dz)].fluid === 'water' || w.getBlock(x + dx, y - 1, z + dz) === B.ice) water = true;
        if (!water) return false;
      }
    }
    if (id === B.cactus && below !== B.sand && below !== B.cactus) return false;
    if ((b.shape === 'carpet' && !below) || (b.shape === 'cake' && !isSturdy(below))) return false;
    if (b.shape === 'gate') meta = lf;
    if (b.shape === 'trapdoor') {
      if (hit.ny === 0) meta = facingFromVec(-hit.nx, -hit.nz) | (fracY > 0.5 ? 8 : 0);
      else meta = facingFromVec(-look.x, -look.z) | (hit.ny === -1 ? 8 : 0);
    }
    if (b.connects) meta = connMeta(w, x, y, z, id);
    if (id === B.dead_bush && ![B.sand, B.dirt, B.grass_block].includes(below)) return false;
    // Kollision mit Spieler/Wesen
    const boxes = collisionBoxes(id, meta);
    for (const bx of boxes) {
      const x0 = x + bx[0], y0 = y + bx[1], z0 = z + bx[2], x1 = x + bx[3], y1 = y + bx[4], z1 = z + bx[5];
      const ov = (e) => e.pos.x + e.w > x0 && e.pos.x - e.w < x1 && e.pos.y + e.h > y0 && e.pos.y < y1 && e.pos.z + e.w > z0 && e.pos.z - e.w < z1;
      if (ov(p)) return false;
      for (const m of this.mobs) if (!m.dead && ov(m)) return false;
    }
    if (b.shape === 'door') {
      if (!isSturdy(below) || !BLOCKS[w.getBlock(x, y + 1, z)].replaceable || y + 1 >= WH) return false;
      if (cur) this.breakNatural(x, y, z);
      w.setBlock(x, y, z, id, lf);
      w.setBlock(x, y + 1, z, id, lf | 8);
      return true;
    }
    if (b.shape === 'bed') {
      const [dx, , dz] = FACING[lf];
      const hx = x + dx, hz = z + dz;
      if (!BLOCKS[w.getBlock(hx, y, hz)].replaceable || !isSturdy(below) || !isSturdy(w.getBlock(hx, y - 1, hz))) return false;
      w.setBlock(x, y, z, id, lf);
      w.setBlock(hx, y, hz, id, lf | 4);
      return true;
    }
    if (cur && BLOCKS[cur].shape === 'cross') this.breakNatural(x, y, z);
    w.setBlock(x, y, z, id, meta);
    if (id === B.sand || id === B.gravel) this.checkBlock(x, y, z);
    return true;
  }

  getBE(x, y, z, type) {
    const k = x + ',' + y + ',' + z;
    let be = this.blockEntities.get(k);
    if (!be || be.type !== type) {
      be = type === 'chest' ? { type, items: new Array(27).fill(null) } : { type, items: [null, null, null], burn: 0, burnMax: 0, cook: 0 };
      this.blockEntities.set(k, be);
    }
    return be;
  }

  toggleDoor(x, y, z) {
    const w = this.world;
    let m = w.getMeta(x, y, z);
    const by = m & 8 ? y - 1 : y;
    const lower = w.getMeta(x, by, z);
    const nm = lower ^ 4;
    w.setBlock(x, by, z, B.oak_door, nm);
    if (w.getBlock(x, by + 1, z) === B.oak_door) w.setBlock(x, by + 1, z, B.oak_door, nm | 8);
    this.sound('door');
  }

  sleep(hit) {
    const p = this.player;
    const t = this.time % 24000;
    if (t < 12542 || t > 23460) { this.ui.toast('Du kannst nur nachts schlafen'); return; }
    for (const m of this.mobs) if (m.def.hostile && !m.dead && Math.hypot(m.pos.x - hit.x, m.pos.y - hit.y, m.pos.z - hit.z) < 8) { this.ui.toast('Du kannst jetzt nicht schlafen, es sind Monster in der Naehe'); return; }
    p.spawn = { x: hit.x + 0.5, y: hit.y + 1, z: hit.z + 0.5 };
    this.ui.toast('Einstiegspunkt gesetzt');
    this.sleeping = true;
    const ov = $('#sleep');
    ov.style.display = 'block';
    requestAnimationFrame(() => ov.style.opacity = 1);
    setTimeout(() => {
      this.time = (Math.floor(this.time / 24000) + 1) * 24000;
      ov.style.opacity = 0;
      setTimeout(() => { ov.style.display = 'none'; this.sleeping = false; }, 800);
    }, 2200);
  }

  // Bloecke abbauen
  breakBlock(hit) {
    const w = this.world, p = this.player;
    const id = w.getBlock(hit.x, hit.y, hit.z);
    if (!id) return;
    const b = BLOCKS[id];
    if (b.hardness < 0 && p.mode !== 'creative') return;
    const held = p.held();
    const meta = w.getMeta(hit.x, hit.y, hit.z);
    this.blockParticles(hit.x, hit.y, hit.z, id);
    this.sound('break', blockSoundMat(id));
    if (p.mode === 'survival') {
      const tool = held && ITEMS[held.id].tool;
      if (canHarvest(id, held ? held.id : 0)) {
        let drops;
        if (tool && tool.type === 'shears' && (b.shearable)) drops = [[id === B.short_grass ? B.short_grass : id, 1]];
        else drops = this.dropsOf(id, meta);
        for (const [did, n] of drops) if (n > 0 && ITEMS[did]) this.dropItem(hit.x + 0.5, hit.y + 0.3, hit.z + 0.5, { id: did, count: n });
      }
      if (tool && b.hardness > 0) p.damageHeld(tool.type === 'sword' ? 2 : 1, this);
      p.exhaustion += 0.005;
    }
    this.removeBlock(hit.x, hit.y, hit.z, id, meta, p.mode === 'survival');
  }

  dropsOf(id, meta) {
    const b = BLOCKS[id];
    if (b.shape === 'slab' && meta === 2) return [[id, 2]];
    if (b.drops) return b.drops(Math.random);
    return b.item ? [[id, 1]] : [];
  }

  // Entfernt einen Block inkl. Partner (Tuer/Bett) und Inhalt (Truhe/Ofen)
  removeBlock(x, y, z, id, meta, dropContents) {
    const w = this.world;
    const k = x + ',' + y + ',' + z;
    const be = this.blockEntities.get(k);
    if (be) {
      if (dropContents !== false) for (const s of be.items) if (s) this.dropItem(x + 0.5, y + 0.5, z + 0.5, s);
      this.blockEntities.delete(k);
    }
    let newId = 0;
    if (id === B.ice && this.player.mode === 'survival') {
      const below = w.getBlock(x, y - 1, z);
      if (below && !BLOCKS[below].fluid) newId = B.water;
    }
    w.setBlock(x, y, z, newId);
    if (newId === B.water) this.scheduleFluid(x, y, z);
    if (id === B.oak_log || id === B.birch_log || id === B.spruce_log) {
      // Laub ohne Stamm zerfaellt nach und nach
      for (let dx = -4; dx <= 4; dx++) for (let dy = -4; dy <= 4; dy++) for (let dz = -4; dz <= 4; dz++) {
        const nid = w.getBlock(x + dx, y + dy, z + dz);
        if (BLOCKS[nid].name.endsWith('leaves') && !(w.getMeta(x + dx, y + dy, z + dz) & 1)) this.decay.push([x + dx, y + dy, z + dz, this.tickCount + 20 + (Math.random() * 300 | 0)]);
      }
    }
    if (id === B.oak_door) {
      const oy = meta & 8 ? y - 1 : y + 1;
      if (w.getBlock(x, oy, z) === B.oak_door) w.setBlock(x, oy, z, 0);
    }
    if (id === B.bed) {
      const [dx, , dz] = FACING[meta & 3];
      const s = meta & 4 ? -1 : 1;
      if (w.getBlock(x + dx * s, y, z + dz * s) === B.bed) w.setBlock(x + dx * s, y, z + dz * s, 0);
    }
  }

  breakNatural(x, y, z) {
    const w = this.world;
    const id = w.getBlock(x, y, z);
    if (!id) return;
    const meta = w.getMeta(x, y, z);
    for (const [did, n] of this.dropsOf(id, meta)) if (n > 0 && ITEMS[did]) this.dropItem(x + 0.5, y + 0.3, z + 0.5, { id: did, count: n });
    this.removeBlock(x, y, z, id, meta);
  }

  primeTnt(x, y, z, fuse) {
    this.world.setBlock(x, y, z, 0);
    const t = new TntEntity(x, y, z, fuse || 4, this.renderer);
    this.tnts.push(t);
    this.renderer.scene.add(t.mesh);
    this.sound('fuse');
  }

  explode(x, y, z, power) {
    const w = this.world;
    this.sound('explode');
    this.particleSys.spawn(x, y, z, [200, 200, 200], 30, 8, 1, 3);
    const hit = new Map();
    for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) for (let k = 0; k < 16; k++) {
      if (i && i !== 15 && j && j !== 15 && k && k !== 15) continue;
      let dx = i / 15 * 2 - 1, dy = j / 15 * 2 - 1, dz = k / 15 * 2 - 1;
      const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
      let it = power * (0.7 + Math.random() * 0.6);
      let px = x, py = y, pz = z;
      while (it > 0) {
        const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz);
        const id = w.getBlock(bx, by, bz);
        if (id) {
          const b = BLOCKS[id];
          const res = id === B.bedrock ? 1e9 : id === B.obsidian ? 1200 : b.fluid ? 100 : (b.tool === 'pickaxe' && b.hardness >= 1.5 ? 6 : b.hardness);
          it -= (res + 0.3) * 0.3;
          if (it > 0 && !b.fluid) hit.set(bx + ',' + by + ',' + bz, [bx, by, bz]);
        }
        px += dx * 0.3; py += dy * 0.3; pz += dz * 0.3;
        it -= 0.225;
      }
    }
    for (const [bx, by, bz] of hit.values()) {
      const id = w.getBlock(bx, by, bz);
      if (!id) continue;
      if (id === B.tnt) { this.primeTnt(bx, by, bz, 0.5 + Math.random()); continue; }
      const meta = w.getMeta(bx, by, bz);
      if (Math.random() < (power >= 4 ? 1 : 1 / power)) for (const [did, n] of this.dropsOf(id, meta)) if (n > 0 && ITEMS[did]) this.dropItem(bx + 0.5, by + 0.5, bz + 0.5, { id: did, count: n });
      this.removeBlock(bx, by, bz, id, meta);
    }
    // Schaden an Wesen und Spieler
    const R = power * 2;
    const hurt = (e, isPlayer) => {
      const ex = e.pos.x, ey = e.pos.y + (e.h || 1) / 2, ez = e.pos.z;
      const d = Math.hypot(ex - x, ey - y, ez - z);
      if (d >= R) return;
      const imp = 1 - d / R;
      const dmg = Math.floor((imp * imp + imp) / 2 * 7 * R + 1);
      const l = d || 1;
      if (isPlayer) { e.invuln = 0; e.damage(dmg, this, null, 'explosion'); }
      else { e.invuln = 0; e.damage(dmg, null, this); }
      e.vel.x += (ex - x) / l * imp * 12; e.vel.y += (ey - y) / l * imp * 12 + 3; e.vel.z += (ez - z) / l * imp * 12;
    };
    hurt(this.player, true);
    for (const m of this.mobs) if (!m.dead) hurt(m, false);
    for (const it of this.items) { const d = Math.hypot(it.pos.x - x, it.pos.y - y, it.pos.z - z); if (d < R) { it.vel.y += 4; } }
  }

  growTree(x, y, z, type) {
    const w = this.world;
    const h = type === 'spruce' ? 7 : 6;
    for (let k = 1; k < h; k++) { const id = w.getBlock(x, y + k, z); if (id && !BLOCKS[id].replaceable && !BLOCKS[id].name.endsWith('leaves')) return false; }
    w.setBlock(x, y, z, 0);
    if (w.getBlock(x, y - 1, z) === B.grass_block) w.setBlock(x, y - 1, z, B.dirt);
    const put = [];
    const g = this.world.gen;
    const seed = (Math.random() * 1e9) | 0;
    // Baum in temporaeren Chunks (3x3) bauen und uebertragen
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const c = new Chunk((x >> 4) + dx, (z >> 4) + dz);
      g.placeTree(c, x, y, z, type, mulberry32(seed));
      for (let i = 0; i < c.blocks.length; i++) if (c.blocks[i]) {
        const lx = i & 15, lz = (i >> 4) & 15, ly = i >> 8;
        put.push([c.cx * 16 + lx, ly, c.cz * 16 + lz, c.blocks[i]]);
      }
    }
    for (const [bx, by, bz, id] of put) {
      const cur = w.getBlock(bx, by, bz);
      if (!cur || BLOCKS[cur].replaceable || (BLOCKS[id].name.endsWith('_log') && BLOCKS[cur].sapling)) w.setBlock(bx, by, bz, id);
    }
    return true;
  }

  // ------------------------------------------------ Ticks (20 pro Sekunde)
  tick() {
    this.tickCount++;
    if (!this.sleeping) this.time++;
    else this.time += 0;
    this.processUpdates();
    this.processFluids();
    this.randomTicks();
    this.tickFurnaces();
    this.tickDecay();
    if (this.tickCount % 20 === 0) this.spawnHostiles();
    if (this.tickCount % (20 * 60) === 0) this.save();
  }

  processUpdates() {
    const u = this.world.updates;
    if (!u.length) return;
    const list = u.splice(0, Math.min(u.length, 3 * 600));
    const seen = new Set();
    for (let i = 0; i < list.length; i += 3) {
      const x = list[i], y = list[i + 1], z = list[i + 2];
      for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const k = (x + dx) + ',' + (y + dy) + ',' + (z + dz);
        if (seen.has(k)) continue;
        seen.add(k);
        this.checkBlock(x + dx, y + dy, z + dz);
      }
    }
  }

  checkBlock(x, y, z) {
    const w = this.world;
    if (y < 0 || y >= WH || !w.isLoaded(x, z)) return;
    const id = w.getBlock(x, y, z);
    const b = BLOCKS[id];
    if (!id) return;
    if (b.fluid) { this.scheduleFluid(x, y, z); return; }
    const meta = w.getMeta(x, y, z);
    const below = w.getBlock(x, y - 1, z);
    let ok = true;
    if (b.gravity) {
      let ny = y;
      while (ny > 0) { const bid = w.getBlock(x, ny - 1, z); if (bid === 0 || BLOCKS[bid].fluid || (BLOCKS[bid].replaceable && !BLOCKS[bid].solid)) ny--; else break; }
      if (ny !== y) {
        const tgt = w.getBlock(x, ny, z);
        if (tgt && !BLOCKS[tgt].fluid) this.breakNatural(x, ny, z);
        w.setBlock(x, y, z, 0);
        w.setBlock(x, ny, z, id);
      }
      return;
    }
    if (b.needsSoil) ok = SOIL().includes(below);
    if (id === B.dead_bush) ok = [B.sand, B.dirt, B.grass_block].includes(below);
    if (b.crop !== undefined) ok = below === B.farmland;
    if (id === B.sugar_cane) ok = below === B.sugar_cane || [B.grass_block, B.dirt, B.sand].includes(below);
    if (id === B.cactus) {
      ok = below === B.sand || below === B.cactus;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (BLOCKS[w.getBlock(x + dx, y, z + dz)].solid) ok = false;
    }
    if (b.shape === 'torch') {
      if (meta === 0) ok = isSturdy(below);
      else { const [dx, , dz] = FACING[meta - 1]; ok = isSturdy(w.getBlock(x + dx, y, z + dz)); }
    }
    if (b.shape === 'ladder') { const [dx, , dz] = FACING[meta & 3]; ok = isSturdy(w.getBlock(x + dx, y, z + dz)); }
    if (id === B.oak_door) ok = meta & 8 ? below === B.oak_door : (w.getBlock(x, y + 1, z) === B.oak_door && isSturdy(below));
    if (id === B.bed) { const [dx, , dz] = FACING[meta & 3]; const s = meta & 4 ? -1 : 1; ok = w.getBlock(x + dx * s, y, z + dz * s) === B.bed; }
    if (id === B.farmland) { const a = w.getBlock(x, y + 1, z); if (a && BLOCKS[a].opaque) { w.setBlock(x, y, z, B.dirt); return; } }
    if (b.shape === 'carpet') ok = below !== 0 && !BLOCKS[below].fluid;
    if (b.shape === 'cake') ok = isSturdy(below);
    if (b.connects) { const m = connMeta(w, x, y, z, id); if (m !== meta) w.setBlock(x, y, z, id, m); }
    if (!ok) this.breakNatural(x, y, z);
  }

  scheduleFluid(x, y, z) {
    const id = this.world.getBlock(x, y, z);
    const f = BLOCKS[id].fluid;
    if (!f) return;
    const k = x + ',' + y + ',' + z;
    if (!this.fluidQueue.has(k)) this.fluidQueue.set(k, this.tickCount + (f === 'water' ? 5 : 30));
  }

  processFluids() {
    if (!this.fluidQueue.size) return;
    const due = [];
    for (const [k, t] of this.fluidQueue) { if (t <= this.tickCount) due.push(k); if (due.length > 300) break; }
    for (const k of due) {
      this.fluidQueue.delete(k);
      const [x, y, z] = k.split(',').map(Number);
      this.fluidTick(x, y, z);
    }
  }

  fluidTick(x, y, z) {
    const w = this.world;
    if (!w.isLoaded(x, z)) return;
    const id = w.getBlock(x, y, z);
    const f = BLOCKS[id].fluid;
    if (!f) return;
    const drop = f === 'water' ? 1 : 2;
    let meta = w.getMeta(x, y, z);
    const H = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    // Lava + Wasser
    if (f === 'lava') {
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
        if (BLOCKS[w.getBlock(x + dx, y + dy, z + dz)].fluid === 'water') {
          w.setBlock(x, y, z, meta === 0 ? B.obsidian : B.cobblestone);
          this.sound('fizz');
          return;
        }
      }
    }
    if (meta !== 0) {
      let nm;
      if (BLOCKS[w.getBlock(x, y + 1, z)].fluid === f) nm = 8;
      else {
        let minL = 99, sources = 0;
        for (const [dx, dz] of H) {
          const nid = w.getBlock(x + dx, y, z + dz);
          if (BLOCKS[nid].fluid !== f) continue;
          const m = w.getMeta(x + dx, y, z + dz);
          if (m === 0) sources++;
          minL = Math.min(minL, m & 8 ? 0 : m & 7);
        }
        const bel = w.getBlock(x, y - 1, z);
        if (f === 'water' && sources >= 2 && (BLOCKS[bel].solid || (BLOCKS[bel].fluid === 'water' && w.getMeta(x, y - 1, z) === 0))) nm = 0;
        else if (minL === 99 || minL + drop > 7) { w.setBlock(x, y, z, 0); return; }
        else nm = minL + drop;
      }
      if (nm !== meta) { w.setBlock(x, y, z, id, nm); meta = nm; }
    }
    const canFlow = (nid) => nid === 0 || (!BLOCKS[nid].solid && !BLOCKS[nid].fluid && BLOCKS[nid].shape !== 'ladder');
    const bel = w.getBlock(x, y - 1, z);
    if (y > 0 && (canFlow(bel) || (BLOCKS[bel].fluid === f && w.getMeta(x, y - 1, z) !== 0 && !(w.getMeta(x, y - 1, z) & 8)))) {
      if (BLOCKS[bel].fluid === 'water' && f === 'lava') return;
      if (bel && !BLOCKS[bel].fluid) this.breakNatural(x, y - 1, z);
      if (BLOCKS[bel].fluid === 'lava' && f === 'water') { w.setBlock(x, y - 1, z, w.getMeta(x, y - 1, z) === 0 ? B.obsidian : B.cobblestone); return; }
      w.setBlock(x, y - 1, z, id, 8);
      return;
    }
    if (BLOCKS[bel].fluid === f && meta !== 0 && !(meta & 8)) return;
    const lvl = (meta & 8 ? 0 : meta & 7) + drop;
    if (lvl > 7) return;
    for (const [dx, dz] of H) {
      const nx = x + dx, nz = z + dz;
      if (!w.isLoaded(nx, nz)) continue;
      const nid = w.getBlock(nx, y, nz);
      if (canFlow(nid)) {
        if (nid) this.breakNatural(nx, y, nz);
        w.setBlock(nx, y, nz, id, lvl);
      } else if (BLOCKS[nid].fluid === f) {
        const m = w.getMeta(nx, y, nz);
        if (m !== 0 && !(m & 8) && (m & 7) > lvl) w.setBlock(nx, y, nz, id, lvl);
      } else if (BLOCKS[nid].fluid && BLOCKS[nid].fluid !== f) this.scheduleFluid(nx, y, nz);
    }
  }

  randomTicks() {
    const w = this.world, p = this.player;
    const pcx = Math.floor(p.pos.x) >> 4, pcz = Math.floor(p.pos.z) >> 4;
    for (const c of w.chunks.values()) {
      if (Math.abs(c.cx - pcx) > 6 || Math.abs(c.cz - pcz) > 6) continue;
      const maxY = c.maxY;
      for (let n = 0; n < 24; n++) {
        const lx = Math.random() * 16 | 0, lz = Math.random() * 16 | 0, y = Math.random() * (maxY + 1) | 0;
        const i = (y << 8) | (lz << 4) | lx;
        const id = c.blocks[i];
        if (!id) continue;
        const x = c.cx * 16 + lx, z = c.cz * 16 + lz;
        const b = BLOCKS[id];
        if (id === B.grass_block) {
          const a = w.getBlock(x, y + 1, z);
          if (a && (BLOCKS[a].opaque || BLOCKS[a].fluid)) { w.setBlock(x, y, z, B.dirt); continue; }
          const tx = x + (Math.random() * 3 | 0) - 1, ty = y + (Math.random() * 5 | 0) - 3, tz = z + (Math.random() * 3 | 0) - 1;
          if (w.getBlock(tx, ty, tz) === B.dirt) {
            const ab = w.getBlock(tx, ty + 1, tz);
            if ((!ab || !BLOCKS[ab].opaque && !BLOCKS[ab].fluid) && (w.getLight(tx, ty + 1, tz) >> 4) >= 9) w.setBlock(tx, ty, tz, B.grass_block);
          }
        } else if (b.crop !== undefined && b.crop < 3) {
          const l = w.getLight(x, y, z);
          if (Math.max(l >> 4, l & 15) >= 9 && Math.random() < 0.35) w.setBlock(x, y, z, id + 1);
        } else if (b.sapling) {
          const l = w.getLight(x, y, z);
          if (Math.max(l >> 4, l & 15) >= 9 && Math.random() < 0.12) this.growTree(x, y, z, b.sapling);
        } else if (id === B.sugar_cane || id === B.cactus) {
          if (!w.getBlock(x, y + 1, z) && Math.random() < 0.15) {
            let h = 1; while (w.getBlock(x, y - h, z) === id) h++;
            if (h < 3) w.setBlock(x, y + 1, z, id);
          }
        } else if (id === B.farmland) {
          let water = false;
          for (let dx = -4; dx <= 4 && !water; dx++) for (let dz = -4; dz <= 4 && !water; dz++) for (let dy = 0; dy <= 1; dy++) if (BLOCKS[w.getBlock(x + dx, y + dy, z + dz)].fluid === 'water') water = true;
          if (!water && BLOCKS[w.getBlock(x, y + 1, z)].crop === undefined && Math.random() < 0.3) w.setBlock(x, y, z, B.dirt);
        }
      }
    }
  }

  tickDecay() {
    const w = this.world;
    for (let i = this.decay.length - 1; i >= 0; i--) {
      const [x, y, z, t] = this.decay[i];
      if (t > this.tickCount) continue;
      this.decay.splice(i, 1);
      const id = w.getBlock(x, y, z);
      if (!BLOCKS[id].name.endsWith('leaves')) continue;
      let found = false;
      for (let dx = -4; dx <= 4 && !found; dx++) for (let dy = -4; dy <= 4 && !found; dy++) for (let dz = -4; dz <= 4 && !found; dz++) {
        const nid = w.getBlock(x + dx, y + dy, z + dz);
        if (nid === B.oak_log || nid === B.birch_log || nid === B.spruce_log) found = true;
      }
      if (!found) { this.blockParticles(x, y, z, id); this.breakNatural(x, y, z); }
    }
  }

  tickFurnaces() {
    for (const [k, be] of this.blockEntities) {
      if (be.type !== 'furnace') continue;
      const [x, y, z] = k.split(',').map(Number);
      if (!this.world.isLoaded(x, z)) continue;
      const it = be.items;
      const wasBurning = be.burn > 0;
      if (be.burn > 0) be.burn--;
      const inp = it[0];
      const out = inp ? SMELTING[inp.id] : undefined;
      const can = out !== undefined && (!it[2] || (it[2].id === out && it[2].count < itemMaxStack(out)));
      if (can) {
        if (be.burn <= 0 && it[1] && fuelValue(it[1].id)) {
          be.burn = be.burnMax = fuelValue(it[1].id);
          const fid = it[1].id;
          it[1].count--;
          if (!it[1].count) it[1] = fid === I.lava_bucket ? { id: I.bucket, count: 1 } : null;
        }
        if (be.burn > 0) {
          be.cook++;
          if (be.cook >= 200) {
            be.cook = 0;
            inp.count--; if (!inp.count) it[0] = null;
            if (it[2]) it[2].count++; else it[2] = { id: out, count: 1 };
          }
        } else be.cook = Math.max(0, be.cook - 2);
      } else be.cook = 0;
      const burning = be.burn > 0;
      if (burning !== wasBurning) {
        const id = this.world.getBlock(x, y, z);
        if (id === B.furnace || id === B.furnace_lit) this.world.setBlock(x, y, z, burning ? B.furnace_lit : B.furnace, this.world.getMeta(x, y, z));
      }
    }
  }

  spawnHostiles() {
    const w = this.world, p = this.player;
    const hostile = this.mobs.filter(m => m.def.hostile).length;
    if (hostile >= 24 || p.mode === 'creative' && hostile >= 10) return;
    for (let a = 0; a < 4; a++) {
      const ang = Math.random() * Math.PI * 2, d = 24 + Math.random() * 40;
      const x = Math.floor(p.pos.x + Math.cos(ang) * d), z = Math.floor(p.pos.z + Math.sin(ang) * d);
      if (!w.isLoaded(x, z)) continue;
      let y;
      if (Math.random() < 0.5) y = w.highestSolid(x, z) + 1;
      else {
        y = 5 + (Math.random() * 60 | 0);
        while (y > 1 && !BLOCKS[w.getBlock(x, y - 1, z)].solid) y--;
      }
      const ground = w.getBlock(x, y - 1, z);
      if (!BLOCKS[ground].opaque || ground === B.bedrock) continue;
      const a1 = w.getBlock(x, y, z), a2 = w.getBlock(x, y + 1, z);
      if ((a1 && (BLOCKS[a1].solid || BLOCKS[a1].fluid)) || (a2 && (BLOCKS[a2].solid || BLOCKS[a2].fluid))) continue;
      const l = w.getLight(x, y, z);
      if ((l & 15) > 0) continue;
      const sky = l >> 4;
      if (sky > 7 && this.isDay()) continue;
      if (sky > 0 && this.isDay()) continue;
      const r = Math.random();
      const type = r < 0.3 ? 'zombie' : r < 0.55 ? 'skeleton' : r < 0.8 ? 'creeper' : 'spider';
      if (type === 'spider' && (!BLOCKS[w.getBlock(x + 1, y, z)] || BLOCKS[w.getBlock(x + 1, y, z)].solid)) continue;
      this.spawnMob(type, x + 0.5, y, z + 0.5);
    }
  }

  // ------------------------------------------------ Tod
  onDeath(kind, src) {
    const p = this.player;
    p.dead = true;
    this.unlock();
    this.mouse.left = this.mouse.right = false;
    const msgs = { fall: 'ist zu tief gefallen', lava: 'hat versucht, in Lava zu schwimmen', drown: 'ist ertrunken', starve: 'ist verhungert',
      explosion: 'wurde in die Luft gesprengt', cactus: 'wurde zu Tode gestochen', fire: 'ist verbrannt', void: 'ist aus der Welt gefallen', kill: 'ist gestorben' };
    let msg = msgs[kind] || 'ist gestorben';
    if (src && src.def) msg = 'wurde von ' + src.def.de + ' getoetet';
    if (src && kind === undefined && !src.def) msg = 'wurde erschossen';
    this.ui.chat('Spieler ' + msg, '#f66');
    $('#deathmsg').textContent = 'Spieler ' + msg;
    // Inventar fallen lassen
    for (let i = 0; i < 36; i++) if (p.inv[i]) { const e = this.dropItem(p.pos.x, p.pos.y + 1, p.pos.z, p.inv[i], { x: (Math.random() - 0.5) * 6, y: 4, z: (Math.random() - 0.5) * 6 }); p.inv[i] = null; }
    for (let i = 0; i < 4; i++) if (p.armor[i]) { this.dropItem(p.pos.x, p.pos.y + 1, p.pos.z, p.armor[i]); p.armor[i] = null; }
    this.ui.close();
    showMenu('death');
  }

  respawn() {
    const p = this.player;
    p.dead = false; p.health = 20; p.food = 20; p.saturation = 5; p.air = 300; p.fire = 0; p.fallDist = 0;
    p.vel = { x: 0, y: 0, z: 0 };
    const s = p.spawn || this.world.gen.findSpawn();
    p.pos = { x: s.x, y: s.y, z: s.z };
    // Bett noch da?
    const bx = Math.floor(s.x), by = Math.floor(s.y) - 1, bz = Math.floor(s.z);
    if (this.world.isLoaded(bx, bz) && this.world.getBlock(bx, by, bz) === B.bed) p.pos.y = by + 0.6;
    p.needsGround = !this.world.isLoaded(bx, bz);
    hideMenus();
    if (p.needsGround) { this.loading = true; showMenu('loading'); return; }
    this.lock();
  }
}

function boxFree2(world, p, id) {
  const x0 = Math.floor(p.pos.x - p.w - 0.05), x1 = Math.floor(p.pos.x + p.w + 0.05);
  const z0 = Math.floor(p.pos.z - p.w - 0.05), z1 = Math.floor(p.pos.z + p.w + 0.05);
  const y0 = Math.floor(p.pos.y), y1 = Math.floor(p.pos.y + p.h);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) if (world.getBlock(x, y, z) === id) return false;
  return true;
}

// ------------------------------------------------ Menues
function worldList() { try { return JSON.parse(localStorage.getItem('swisscraft_worlds')) || []; } catch (e) { return []; } }

function showMenu(id) {
  for (const m of document.querySelectorAll('.menu')) m.style.display = 'none';
  const el = $('#menu-' + id);
  if (el) el.style.display = 'flex';
  if (id === 'worlds') renderWorldList();
  if (id === 'options') syncOptions();
}
function hideMenus() { for (const m of document.querySelectorAll('.menu')) m.style.display = 'none'; }

function renderWorldList() {
  const list = worldList().sort((a, b) => (b.last || 0) - (a.last || 0));
  const el = $('#worldlist');
  if (!list.length) { el.innerHTML = '<div class="empty">Noch keine Welten. Erstelle eine neue!</div>'; return; }
  el.innerHTML = list.map(w => `<div class="wentry" data-id="${w.id}">
    <div><b>${escapeHtml(w.name)}</b><br><small>${w.mode === 'creative' ? 'Kreativ' : 'Ueberleben'} &middot; ${new Date(w.last || w.created).toLocaleString('de-CH')}</small></div>
    <div><button class="mcbtn small" data-act="play">Spielen</button><button class="mcbtn small red" data-act="del">Loeschen</button></div></div>`).join('');
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function syncOptions() {
  const o = game.opts;
  $('#opt-dist').value = o.dist; $('#opt-dist-v').textContent = o.dist;
  $('#opt-fov').value = o.fov; $('#opt-fov-v').textContent = o.fov;
  $('#opt-sens').value = Math.round(o.sens * 100); $('#opt-sens-v').textContent = Math.round(o.sens * 100) + '%';
  $('#opt-vol').value = Math.round(o.volume * 100); $('#opt-vol-v').textContent = Math.round(o.volume * 100) + '%';
  $('#opt-bob').textContent = 'Kamerawackeln: ' + (o.bob ? 'An' : 'Aus');
}

let game;
window.addEventListener('load', () => {
  game = new Game();
  showMenu('title');
  let optsBack = 'title';
  document.body.addEventListener('click', e => {
    const b = e.target.closest('[data-go]');
    if (!b) return;
    game.audio.init(); game.sound('click');
    const go = b.dataset.go;
    if (go === 'options') { optsBack = game.running ? 'pause' : 'title'; }
    if (go === 'back-options') { game.saveOpts(); if (game.running) { game.renderer.setRenderDistance(game.opts.dist); game.lastChunk = null; game.renderer.camera.fov = game.opts.fov; game.audio.volume = game.opts.volume; } showMenu(optsBack); return; }
    if (go === 'resume') { game.resume(); return; }
    if (go === 'quit') { game.quitToTitle(); return; }
    if (go === 'respawn') { game.respawn(); return; }
    if (go === 'deathtitle') { game.respawn(); game.quitToTitle(); return; }
    if (go === 'play') { game.resume(); return; }
    if (go === 'docreate') {
      const name = $('#nw-name').value.trim() || 'Neue Welt';
      const seedStr = $('#nw-seed').value.trim();
      const seed = seedStr ? seedFromString(seedStr) : (Math.random() * 2147483647) | 0;
      const mode = $('#nw-mode').dataset.mode;
      const meta = { id: Date.now().toString(36), name, seed, mode, created: Date.now(), last: Date.now() };
      const list = worldList(); list.push(meta);
      try { localStorage.setItem('swisscraft_worlds', JSON.stringify(list)); } catch (err) { /* egal */ }
      game.startWorld(meta, null);
      return;
    }
    showMenu(go);
  });
  $('#nw-mode').addEventListener('click', e => {
    const b = e.currentTarget;
    b.dataset.mode = b.dataset.mode === 'survival' ? 'creative' : 'survival';
    b.textContent = 'Spielmodus: ' + (b.dataset.mode === 'survival' ? 'Ueberleben' : 'Kreativ');
  });
  $('#worldlist').addEventListener('click', e => {
    const btn = e.target.closest('button'); if (!btn) return;
    const id = btn.closest('.wentry').dataset.id;
    const meta = worldList().find(w => w.id === id);
    game.audio.init();
    if (btn.dataset.act === 'play') {
      let save = null;
      try { save = JSON.parse(localStorage.getItem(SAVE_PREFIX + id)); } catch (err) { save = null; }
      game.startWorld(meta, save);
    } else if (btn.dataset.act === 'del' && confirm('Welt "' + meta.name + '" wirklich loeschen?')) {
      localStorage.removeItem(SAVE_PREFIX + id);
      localStorage.setItem('swisscraft_worlds', JSON.stringify(worldList().filter(w => w.id !== id)));
      renderWorldList();
    }
  });
  const bindRange = (id, fn) => $(id).addEventListener('input', e => { fn(+e.target.value); syncOptions(); });
  bindRange('#opt-dist', v => game.opts.dist = v);
  bindRange('#opt-fov', v => game.opts.fov = v);
  bindRange('#opt-sens', v => game.opts.sens = v / 100);
  bindRange('#opt-vol', v => game.opts.volume = v / 100);
  $('#opt-bob').addEventListener('click', () => { game.opts.bob = !game.opts.bob; syncOptions(); });
  $('#menu-clicktoplay').addEventListener('click', () => game.resume());
  window.addEventListener('beforeunload', () => { if (game.running) game.save(); });
  document.addEventListener('keydown', e => {
    if (e.code === 'Escape' && game.running && $('#menu-pause').style.display === 'flex') { e.preventDefault(); }
  });
});

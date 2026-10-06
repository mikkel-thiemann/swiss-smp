'use strict';
// Benutzeroberflaeche: HUD, Inventar, Werkbank, Ofen, Truhe, Kreativ-Inventar, Chat.

const $ = (s, el) => (el || document).querySelector(s);
const ICON_CACHE = {};

function isoIcon(b) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  const tile = (t) => { const tx = t % ATLAS_TILES, ty = Math.floor(t / ATLAS_TILES); return [tx * 16, ty * 16]; };
  const slab = b.shape === 'slab' || b.shape === 'carpet';
  const hh = slab ? 0.5 : 1;
  const yoff = slab ? 16 : 0;
  const face = (t, tr, shade, srcY, srcH) => {
    const tmp = document.createElement('canvas'); tmp.width = tmp.height = 16;
    const tg = tmp.getContext('2d');
    const [sx, sy] = tile(t);
    tg.drawImage(atlasCanvas, sx, sy + srcY, 16, srcH, 0, srcY, 16, srcH);
    if (shade < 1) { tg.globalCompositeOperation = 'source-atop'; tg.fillStyle = `rgba(0,0,0,${1 - shade})`; tg.fillRect(0, 0, 16, 16); }
    g.setTransform(...tr);
    g.drawImage(tmp, 0, 0);
  };
  const front = b.facing ? b.faces.front : b.faces.side;
  face(b.faces.top, [1.75, -0.875, 1.75, 0.875, 4, 16 + yoff], 1, 0, 16);
  if (slab) {
    face(b.faces.side, [1.75, 0.875, 0, 2, 4, 16 + yoff - 16], 0.8, 8, 8);
    face(front, [1.75, -0.875, 0, 2, 32, 30 + yoff - 16], 0.6, 8, 8);
  } else {
    face(b.faces.side, [1.75, 0.875, 0, 2 * hh, 4, 16], 0.8, 0, 16);
    face(front, [1.75, -0.875, 0, 2 * hh, 32, 30], 0.6, 0, 16);
  }
  return c.toDataURL();
}

function iconURL(id) {
  if (ICON_CACHE[id]) return ICON_CACHE[id];
  const it = ITEMS[id];
  let url;
  const b = it.block !== null && it.block !== undefined ? BLOCKS[it.block] : null;
  if (b && !b.icon && ['cube', 'slab', 'stairs', 'farmland', 'cactus', 'carpet'].includes(b.shape)) url = isoIcon(b);
  else {
    const name = b ? (b.icon || Object.keys(TEX).find(k => TEX[k] === b.faces.side)) : it.icon;
    url = TILE_CANVAS[name].toDataURL();
  }
  ICON_CACHE[id] = url;
  return url;
}

function hudIcon(rows, pal) {
  const c = document.createElement('canvas'); c.width = 9; c.height = 9;
  const g = c.getContext('2d');
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (pal[ch]) { g.fillStyle = pal[ch]; g.fillRect(x, y, 1, 1); } }));
  return c.toDataURL();
}
const HEART = ['.KK...KK.', 'KRRK.KRRK', 'KRWRKRRRK', 'KRRRRRRRK', 'KRRRRRRRK', '.KRRRRRK.', '..KRRRK..', '...KRK...', '....K....'];
const HEART_HALF = ['.KK...KK.', 'KRRK.KDDK', 'KRWRKDDDK', 'KRRRRDDDK', 'KRRRRDDDK', '.KRRRDDK.', '..KRRDK..', '...KRK...', '....K....'];
const HEART_EMPTY = HEART.map(r => r.replace(/[RW]/g, 'D'));
const FOOD = ['.....KK..', '....KMMK.', '...KMMMMK', '...KMMMMK', '..KMMMMK.', '.KWKMMK..', 'KWWKKK...', 'KWWK.....', '.KK......'];
const FOOD_HALF = ['.....KK..', '....KDDK.', '...KDDDDK', '...KMDDDK', '..KMMDDK.', '.KWKMDK..', 'KWWKKK...', 'KWWK.....', '.KK......'];
const FOOD_EMPTY = FOOD.map(r => r.replace(/[MW]/g, 'D'));
const ARMOR_ICON = ['.KKK.KKK.', 'KAAAKAAAK', 'KAAAAAAAK', '.KAAAAAK.', '.KAAAAAK.', '.KAAAAAK.', '.KAAAAAK.', '.KKKKKKK.', '.........'];
const ARMOR_HALF = ['.KKK.KKK.', 'KAAAKDDDK', 'KAAAADDDK', '.KAAADDK.', '.KAAADDK.', '.KAAADDK.', '.KAAADDK.', '.KKKKKKK.', '.........'];
const ARMOR_EMPTY = ARMOR_ICON.map(r => r.replace(/A/g, 'D'));
const BUBBLE = ['..KKKKK..', '.KBBBBBK.', 'KBWBBBBBK', 'KBWBBBBBK', 'KBBBBBBBK', 'KBBBBBBBK', '.KBBBBBK.', '..KKKKK..', '.........'];
const PAL = { K: '#1a1a1a', R: '#d81e1e', W: '#ffd0d0', D: '#3b2b2b', M: '#b5651d', A: '#d6d6d6', B: '#3a7fe0' };
const HUD_IMG = {};

class UI {
  constructor(game) {
    this.game = game;
    this.cursor = null;
    this.screen = null;
    this.craft = new Array(9).fill(null);
    this.craftW = 2;
    this.chatLines = [];
    HUD_IMG.heart = hudIcon(HEART, PAL); HUD_IMG.heartHalf = hudIcon(HEART_HALF, PAL); HUD_IMG.heartEmpty = hudIcon(HEART_EMPTY, PAL);
    HUD_IMG.food = hudIcon(FOOD, PAL); HUD_IMG.foodHalf = hudIcon(FOOD_HALF, PAL); HUD_IMG.foodEmpty = hudIcon(FOOD_EMPTY, PAL);
    HUD_IMG.armor = hudIcon(ARMOR_ICON, PAL); HUD_IMG.armorHalf = hudIcon(ARMOR_HALF, PAL); HUD_IMG.armorEmpty = hudIcon(ARMOR_EMPTY, PAL);
    HUD_IMG.bubble = hudIcon(BUBBLE, PAL);
    this.buildHUD();
    this.cursorEl = $('#cursor-item');
    this.tooltip = $('#tooltip');
    document.addEventListener('mouseup', e => this.onRelease(e));
    document.addEventListener('mousemove', e => {
      this.mouseX = e.clientX; this.mouseY = e.clientY;
      this.cursorEl.style.left = e.clientX + 'px'; this.cursorEl.style.top = e.clientY + 'px';
      this.tooltip.style.left = (e.clientX + 14) + 'px'; this.tooltip.style.top = (e.clientY - 28) + 'px';
    });
  }

  // ------------------------------------------------ HUD
  buildHUD() {
    const hb = $('#hotbar');
    hb.innerHTML = '';
    for (let i = 0; i < 9; i++) { const s = document.createElement('div'); s.className = 'hslot'; hb.appendChild(s); }
    const mk = (id, n) => { const el = $(id); el.innerHTML = ''; for (let i = 0; i < n; i++) el.appendChild(document.createElement('img')); };
    mk('#hearts', 10); mk('#food', 10); mk('#armorbar', 10); mk('#bubbles', 10);
  }

  stackHTML(s, big) {
    if (!s) return '';
    let h = `<img src="${iconURL(s.id)}" draggable="false">`;
    if (s.count > 1) h += `<span class="cnt">${s.count}</span>`;
    const dur = itemDurability(s.id);
    if (dur && s.dmg > 0) {
      const f = 1 - s.dmg / dur;
      const col = `hsl(${Math.round(f * 120)},100%,45%)`;
      h += `<span class="dur"><i style="width:${Math.max(1, f * 100)}%;background:${col}"></i></span>`;
    }
    return h;
  }

  updateHUD() {
    const p = this.game.player;
    const hs = $('#hotbar').children;
    for (let i = 0; i < 9; i++) {
      const key = JSON.stringify(p.inv[i]) + (i === p.selected);
      if (hs[i]._k !== key) { hs[i].innerHTML = this.stackHTML(p.inv[i]); hs[i].classList.toggle('sel', i === p.selected); hs[i]._k = key; }
    }
    const surv = p.mode === 'survival';
    $('#stats').style.display = surv ? '' : 'none';
    if (!surv) return;
    const setRow = (sel, val, full, half, empty, rev) => {
      const imgs = $(sel).children;
      for (let i = 0; i < 10; i++) {
        const v = val - i * 2;
        const src = v >= 2 ? full : v >= 1 ? half : empty;
        const img = imgs[rev ? 9 - i : i];
        if (img._s !== src) { img.src = src; img._s = src; }
      }
    };
    const hp = Math.ceil(p.health);
    setRow('#hearts', hp, HUD_IMG.heart, HUD_IMG.heartHalf, HUD_IMG.heartEmpty);
    $('#hearts').classList.toggle('low', hp <= 4);
    setRow('#food', p.food, HUD_IMG.food, HUD_IMG.foodHalf, HUD_IMG.foodEmpty, true);
    const ap = p.armorPoints();
    $('#armorbar').style.visibility = ap > 0 ? 'visible' : 'hidden';
    setRow('#armorbar', ap, HUD_IMG.armor, HUD_IMG.armorHalf, HUD_IMG.armorEmpty);
    const bub = $('#bubbles');
    bub.style.display = p.air < 300 ? '' : 'none';
    const nb = Math.ceil(p.air / 30);
    for (let i = 0; i < 10; i++) { const img = bub.children[9 - i]; img.style.visibility = i < nb ? 'visible' : 'hidden'; if (!img._s) { img.src = HUD_IMG.bubble; img._s = 1; } }
  }

  showItemName(stack) {
    const el = $('#itemname');
    if (!stack) { el.style.opacity = 0; return; }
    el.textContent = itemName(stack.id);
    el.style.opacity = 1;
    clearTimeout(this._inT);
    this._inT = setTimeout(() => el.style.opacity = 0, 1800);
  }

  toast(msg) { this.chat(msg, '#ffff7a'); }

  showHint(msg) {
    // Kurzer Hinweis ueber der Schnellleiste (wie die Item-Namen)
    const el = $('#itemname');
    el.textContent = msg;
    el.style.opacity = 1;
    clearTimeout(this._inT);
    this._inT = setTimeout(() => el.style.opacity = 0, 2500);
  }

  chat(msg, color) {
    const el = document.createElement('div');
    el.className = 'chatline';
    el.textContent = msg;
    if (color) el.style.color = color;
    $('#chatlog').appendChild(el);
    setTimeout(() => el.classList.add('fade'), 9000);
    while ($('#chatlog').children.length > 60) $('#chatlog').firstChild.remove();
  }

  // ------------------------------------------------ Bildschirme
  get isOpen() { return !!this.screen; }

  open(type, data) {
    this.screen = { type, data };
    this.craft.fill(null);
    this.craftW = type === 'table' ? 3 : 2;
    const el = $('#screen');
    el.className = 'gui gui-' + type;
    let h = '';
    const title = (t) => `<div class="gtitle">${t}</div>`;
    const grid = (name, from, n, cols) => {
      let s = `<div class="grid" style="grid-template-columns:repeat(${cols},36px)">`;
      for (let i = from; i < from + n; i++) s += `<div class="slot" data-c="${name}" data-i="${i}"></div>`;
      return s + '</div>';
    };
    const playerInv = () => `<div class="ghint">Item anklicken (oder ziehen) und auf ein Feld legen &middot; Rechtsklick: halbieren / einzeln ablegen &middot; Shift+Klick: schnell verschieben &middot; Ergebnis anklicken = craften</div><div class="gtitle">Inventar</div>${grid('inv', 9, 27, 9)}<div style="height:8px"></div>${grid('inv', 0, 9, 9)}`;
    if (type === 'inventory') {
      h += `<div class="row top">
        <div class="col">${['Helm', 'Brust', 'Hose', 'Schuhe'].map((n, i) => `<div class="slot armor" data-c="armor" data-i="${i}" data-ph="${n}"></div>`).join('')}</div>
        <div class="player-preview"><canvas id="preview" width="90" height="150"></canvas></div>
        <div class="craftbox">${title('Handwerk')}<div class="row">${grid('craft', 0, 4, 2)}<div class="arrow">&#10140;</div><div class="slot result" data-c="result" data-i="0"></div></div></div>
      </div>` + playerInv();
    } else if (type === 'table') {
      h += title('Handwerk') + `<div class="row center">${grid('craft', 0, 9, 3)}<div class="arrow big">&#10140;</div><div class="slot result big" data-c="result" data-i="0"></div></div>` + playerInv();
    } else if (type === 'furnace') {
      h += title('Ofen') + `<div class="row center furnace">
        <div class="col"><div class="slot" data-c="furnace" data-i="0"></div><div class="flame"><i id="flame"></i></div><div class="slot" data-c="furnace" data-i="1"></div></div>
        <div class="progress"><i id="cookbar"></i></div>
        <div class="slot result big" data-c="furnace" data-i="2"></div></div>` + playerInv();
    } else if (type === 'chest') {
      h += title('Truhe') + grid('chest', 0, 27, 9) + playerInv();
    } else if (type === 'creative') {
      h += `<div class="row"><div class="gtitle">Kreativ-Inventar</div><input id="csearch" placeholder="Suchen..." autocomplete="off"></div>
        <div class="cgrid" id="cgrid"></div><div class="gtitle">Schnellleiste (Item auf Raster ziehen = loeschen)</div>${grid('inv', 0, 9, 9)}`;
    }
    if (type === 'inventory' || type === 'table') {
      h += `<div class="rbook"><div class="gtitle">Rezeptbuch</div><div class="ghint">Klick = 1x craften, Shift+Klick = so viel wie moeglich</div><div class="rgrid" id="rgrid"></div></div>`;
    }
    el.innerHTML = h;
    el.style.display = 'block';
    $('#overlay').style.display = 'block';
    if (type === 'creative') this.fillCreative('');
    el.onmousedown = (e) => this.onClick(e);
    el.oncontextmenu = (e) => e.preventDefault();
    el.onmouseover = (e) => this.onHover(e);
    el.onmouseout = () => { this.tooltip.style.display = 'none'; };
    if (type === 'creative') {
      const inp = $('#csearch');
      inp.oninput = () => this.fillCreative(inp.value.toLowerCase());
      inp.onkeydown = (e) => e.stopPropagation();
    }
    this.refresh();
  }

  fillCreative(q) {
    const g = $('#cgrid');
    let h = '';
    for (const it of ITEMS) {
      if (!it || it.id === 0) continue;
      if (q && !it.de.toLowerCase().includes(q) && !it.name.includes(q)) continue;
      h += `<div class="slot" data-c="creative" data-i="${it.id}">${this.stackHTML({ id: it.id, count: 1 })}</div>`;
    }
    g.innerHTML = h;
  }

  close() {
    if (!this.screen) return;
    // Werkbank leeren
    for (let i = 0; i < 9; i++) if (this.craft[i]) { this.giveOrDrop(this.craft[i]); this.craft[i] = null; }
    if (this.cursor) { this.giveOrDrop(this.cursor); this.cursor = null; }
    this.screen = null;
    $('#screen').style.display = 'none';
    $('#overlay').style.display = 'none';
    this.tooltip.style.display = 'none';
    this.cursorEl.innerHTML = '';
    this.game.sound('click');
  }

  giveOrDrop(s) {
    const left = this.game.player.addItem(s);
    if (left > 0) this.game.dropFromPlayer({ id: s.id, count: left, dmg: s.dmg });
  }

  container(name) {
    const p = this.game.player;
    if (name === 'inv') return p.inv;
    if (name === 'armor') return p.armor;
    if (name === 'craft') return this.craft;
    if (name === 'furnace' || name === 'chest') return this.screen.data.items;
    return null;
  }

  craftResult() {
    const n = this.craftW * this.craftW;
    const ids = [];
    for (let i = 0; i < n; i++) ids.push(this.craft[i] ? this.craft[i].id : 0);
    const r = matchRecipe(ids, this.craftW);
    return r ? { id: r.out, count: r.count } : null;
  }

  takeCraft(shift) {
    let made = 0;
    do {
      const res = this.craftResult();
      if (!res) break;
      if (shift) {
        if (this.game.player.addItem(res) > 0) break;
      } else {
        if (!this.cursor) this.cursor = res;
        else if (this.cursor.id === res.id && this.cursor.count + res.count <= itemMaxStack(res.id) && !this.cursor.dmg) this.cursor.count += res.count;
        else break;
      }
      for (let i = 0; i < 9; i++) if (this.craft[i]) {
        const id = this.craft[i].id;
        this.craft[i].count--;
        if (this.craft[i].count <= 0) this.craft[i] = null;
        if (id === I.water_bucket || id === I.lava_bucket || id === I.milk_bucket) this.craft[i] = { id: I.bucket, count: 1 };
      }
      made++;
      if (made === 1) this.game.sound('click');
    } while (shift && made < 64);
    if (made) this.game.stats.crafted = (this.game.stats.crafted || 0) + made;
  }

  onClick(e) {
    const hadCursor = !!this.cursor;
    this.handleClick(e);
    // Ziehen & Loslassen: wer ein Item aufnimmt und ueber einem anderen Feld loslaesst, legt es dort ab
    const slot = e.target.closest && e.target.closest('.slot');
    this.dragFrom = (!hadCursor && this.cursor && slot && e.button === 0) ? slot : null;
  }

  onRelease(e) {
    const from = this.dragFrom;
    this.dragFrom = null;
    if (!this.screen || !from || !this.cursor || e.button !== 0) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const slot = el && el.closest('.slot');
    if (!slot || slot === from || slot.dataset.c === 'result' || slot.dataset.c === 'creative' || slot.dataset.c === 'recipe') return;
    this.handleClick({ target: slot, button: 0, shiftKey: false, preventDefault() {} });
  }

  handleClick(e) {
    const slot = e.target.closest('.slot');
    e.preventDefault();
    if (!slot) {
      // Klick ausserhalb: Item fallen lassen
      if (!e.target.closest('.gui') && this.cursor) {
        if (e.button === 2) { this.game.dropFromPlayer({ id: this.cursor.id, count: 1, dmg: this.cursor.dmg }); this.cursor.count--; if (!this.cursor.count) this.cursor = null; }
        else { this.game.dropFromPlayer(this.cursor); this.cursor = null; }
        this.refresh();
      }
      return;
    }
    const name = slot.dataset.c, i = +slot.dataset.i, btn = e.button, shift = e.shiftKey;
    const p = this.game.player;
    if (name === 'creative') {
      if (this.cursor) this.cursor = null;
      else this.cursor = { id: i, count: btn === 2 ? 1 : itemMaxStack(i), dmg: 0 };
      if (shift && this.cursor) { p.addItem(this.cursor); this.cursor = null; }
      this.refresh();
      return;
    }
    if (name === 'result') { this.takeCraft(shift); this.refresh(); return; }
    if (name === 'recipe') { this.bookCraft(i, shift); this.refresh(); return; }
    const arr = this.container(name);
    if (name === 'furnace' && i === 2) {
      const out = arr[2];
      if (out) {
        if (shift) { const left = p.addItem(out); arr[2] = left ? { id: out.id, count: left } : null; }
        else if (!this.cursor) { this.cursor = out; arr[2] = null; }
        else if (this.cursor.id === out.id && this.cursor.count + out.count <= itemMaxStack(out.id)) { this.cursor.count += out.count; arr[2] = null; }
      }
      this.refresh(); return;
    }
    if (shift && arr[i]) { this.quickMove(name, i); this.refresh(); return; }
    const cur = this.cursor, s = arr[i];
    if (name === 'armor' && cur && !(ITEMS[cur.id].armor && ITEMS[cur.id].armor.slot === i) && !(i === 0 && cur.id === B.carved_pumpkin)) return;
    if (btn === 0) {
      if (!cur) { this.cursor = s; arr[i] = null; }
      else if (!s) { arr[i] = cur; this.cursor = null; if (name === 'armor') this.game.sound('equip'); }
      else if (s.id === cur.id && !s.dmg && !cur.dmg && itemMaxStack(s.id) > 1) {
        const k = Math.min(cur.count, itemMaxStack(s.id) - s.count);
        s.count += k; cur.count -= k;
        if (!cur.count) this.cursor = null;
      } else { arr[i] = cur; this.cursor = s; }
    } else if (btn === 2) {
      if (!cur && s) {
        const half = Math.ceil(s.count / 2);
        this.cursor = { id: s.id, count: half, dmg: s.dmg };
        s.count -= half;
        if (!s.count) arr[i] = null;
      } else if (cur && !s) {
        arr[i] = { id: cur.id, count: 1, dmg: cur.dmg };
        cur.count--; if (!cur.count) this.cursor = null;
      } else if (cur && s && s.id === cur.id && s.count < itemMaxStack(s.id) && !s.dmg) {
        s.count++; cur.count--; if (!cur.count) this.cursor = null;
      } else if (cur && s) { arr[i] = cur; this.cursor = s; }
    }
    this.refresh();
  }

  moveInto(stack, arr, indices) {
    const max = itemMaxStack(stack.id);
    if (max > 1) for (const i of indices) {
      const s = arr[i];
      if (s && s.id === stack.id && s.count < max && !s.dmg) {
        const k = Math.min(stack.count, max - s.count); s.count += k; stack.count -= k;
        if (!stack.count) return 0;
      }
    }
    for (const i of indices) if (!arr[i]) { arr[i] = { id: stack.id, count: stack.count, dmg: stack.dmg }; stack.count = 0; return 0; }
    return stack.count;
  }

  quickMove(name, i) {
    const p = this.game.player;
    const arr = this.container(name);
    const s = arr[i];
    const range = (a, b) => Array.from({ length: b - a }, (_, k) => a + k);
    const type = this.screen.type;
    if (name === 'inv') {
      const it = ITEMS[s.id];
      let moved = false;
      if (type === 'chest') { this.moveInto(s, this.screen.data.items, range(0, 27)); moved = true; }
      else if (type === 'furnace') {
        const f = this.screen.data.items;
        if (SMELTING[s.id] !== undefined) { this.moveInto(s, f, [0]); moved = true; }
        else if (fuelValue(s.id)) { this.moveInto(s, f, [1]); moved = true; }
      } else if (it.armor && !p.armor[it.armor.slot] && type === 'inventory') { p.armor[it.armor.slot] = s; arr[i] = null; this.game.sound('equip'); return; }
      if (!moved) {
        if (i < 9) this.moveInto(s, p.inv, range(9, 36)); else this.moveInto(s, p.inv, range(0, 9));
      }
      if (!s.count) arr[i] = null;
    } else {
      this.moveInto(s, p.inv, range(9, 36).concat(range(0, 9)));
      if (!s.count) arr[i] = null;
    }
  }

  onHover(e) {
    const slot = e.target.closest('.slot');
    if (!slot) { this.tooltip.style.display = 'none'; return; }
    let s = null;
    if (slot.dataset.c === 'recipe') {
      const rc = RECIPES[+slot.dataset.i];
      const names = {};
      for (const opts of recipeNeeds(rc)) { const n = opts.length > 1 ? itemName(opts[0]).replace(/^(Eichen|Birken|Fichten)/, '') + ' (beliebig)' : itemName(opts[0]); names[n] = (names[n] || 0) + 1; }
      this.tooltip.innerHTML = `${itemName(rc.out)}${rc.count > 1 ? ' x' + rc.count : ''}<br><small>braucht: ${Object.entries(names).map(([n, c]) => c + 'x ' + n).join(', ')}</small>`;
      this.tooltip.style.display = 'block';
      return;
    }
    if (slot.dataset.c === 'creative') s = { id: +slot.dataset.i };
    else if (slot.dataset.c === 'result') s = this.craftResult();
    else { const arr = this.container(slot.dataset.c); s = arr && arr[+slot.dataset.i]; }
    if (!s) { this.tooltip.style.display = 'none'; return; }
    let t = itemName(s.id);
    const dur = itemDurability(s.id);
    if (dur) t += `<br><small>Haltbarkeit: ${dur - (s.dmg || 0)} / ${dur}</small>`;
    const it = ITEMS[s.id];
    if (it.tool && it.tool.damage) t += `<br><small style="color:#5f5">${it.tool.damage} Angriffsschaden</small>`;
    if (it.armor) t += `<br><small style="color:#88f">+${it.armor.points} Ruestung</small>`;
    if (it.food) t += `<br><small style="color:#fa5">+${it.food[0]} Hunger</small>`;
    this.tooltip.innerHTML = t;
    this.tooltip.style.display = 'block';
  }

  refresh() {
    if (!this.screen) return;
    const el = $('#screen');
    for (const s of el.querySelectorAll('.slot')) {
      const name = s.dataset.c;
      if (name === 'creative' || name === 'recipe') continue;
      let st;
      if (name === 'result') st = this.craftResult();
      else st = this.container(name)[+s.dataset.i];
      const key = JSON.stringify(st);
      if (s._k !== key) { s.innerHTML = this.stackHTML(st); s._k = key; }
      if (name === 'armor' && !st) s.classList.add('empty'); else s.classList.remove('empty');
    }
    this.cursorEl.innerHTML = this.cursor ? this.stackHTML(this.cursor) : '';
    if (this.screen.type === 'furnace') this.updateFurnace();
    if (this.screen.type === 'inventory') this.drawPreview();
    this.updateBook();
    this.updateHUD();
  }

  // Rezepte, die man mit dem aktuellen Inventar herstellen kann
  updateBook() {
    const g = $('#rgrid');
    if (!g) return;
    const inv = this.game.player.inv;
    const seen = new Set();
    let h = '', key = '';
    RECIPES.forEach((r, i) => {
      if (!recipeFits(r, this.craftW) || seen.has(r.out)) return;
      if (!pickIngredients(r, inv)) return;
      seen.add(r.out);
      key += i + ',';
      h += `<div class="slot" data-c="recipe" data-i="${i}">${this.stackHTML({ id: r.out, count: r.count })}</div>`;
    });
    if (g._k === key) return;
    g._k = key;
    g.innerHTML = h || '<div class="ghint">Sammle zuerst Materialien, z.B. Holz von einem Baum.</div>';
  }

  bookCraft(i, shift) {
    const p = this.game.player;
    const r = RECIPES[i];
    let made = 0;
    do {
      const picks = pickIngredients(r, p.inv);
      if (!picks) break;
      for (const id of picks) {
        p.removeItem(id, 1);
        if (id === I.water_bucket || id === I.lava_bucket || id === I.milk_bucket) this.giveOrDrop({ id: I.bucket, count: 1 });
      }
      this.giveOrDrop({ id: r.out, count: r.count });
      made++;
    } while (shift && made < 64);
    if (made) { this.game.sound('click'); this.game.ui.showHint(itemName(r.out) + ' hergestellt!'); }
  }

  updateFurnace() {
    const f = this.screen.data;
    const fl = $('#flame'), cb = $('#cookbar');
    if (fl) fl.style.height = (f.burnMax ? f.burn / f.burnMax * 100 : 0) + '%';
    if (cb) cb.style.width = (f.cook / 200 * 100) + '%';
    for (const s of $('#screen').querySelectorAll('.slot[data-c="furnace"]')) {
      const st = f.items[+s.dataset.i]; const key = JSON.stringify(st);
      if (s._k !== key) { s.innerHTML = this.stackHTML(st); s._k = key; }
    }
  }

  drawPreview() {
    const c = $('#preview'); if (!c) return;
    const g = c.getContext('2d');
    const p = this.game.player;
    g.clearRect(0, 0, 90, 150);
    g.fillStyle = '#000'; g.fillRect(0, 0, 90, 150);
    const skin = '#c69c78', shirt = '#3aa8b8', pants = '#3b3b9e', hair = '#4a2e1a';
    const col = (slot, def) => p.armor[slot] ? { leather: '#8a5a3a', iron: '#d8d8d8', golden: '#f2d24a', diamond: '#5de8de' }[ITEMS[p.armor[slot].id].name.split('_')[0]] : def;
    g.fillStyle = skin; g.fillRect(29, 10, 32, 32);
    g.fillStyle = hair; g.fillRect(29, 10, 32, 8);
    g.fillStyle = '#fff'; g.fillRect(34, 24, 6, 4); g.fillRect(50, 24, 6, 4);
    g.fillStyle = '#3b2bb0'; g.fillRect(37, 24, 3, 4); g.fillRect(50, 24, 3, 4);
    if (p.armor[0]) { g.fillStyle = col(0); g.fillRect(27, 8, 36, 10); g.fillRect(27, 8, 4, 22); g.fillRect(59, 8, 4, 22); }
    g.fillStyle = col(1, shirt); g.fillRect(29, 42, 32, 46); g.fillRect(13, 42, 16, 46); g.fillRect(61, 42, 16, 46);
    g.fillStyle = skin; g.fillRect(13, 76, 16, 12); g.fillRect(61, 76, 16, 12);
    g.fillStyle = col(2, pants); g.fillRect(29, 88, 32, 40);
    g.fillStyle = col(3, '#555'); g.fillRect(29, 128, 32, 12);
  }

  // ------------------------------------------------ Chat
  openChat(prefix) {
    const box = $('#chatinput');
    box.style.display = 'block';
    box.value = prefix || '';
    box.focus();
    $('#chatlog').classList.add('open');
  }
  closeChat() {
    const box = $('#chatinput');
    box.style.display = 'none';
    box.blur();
    $('#chatlog').classList.remove('open');
  }
}

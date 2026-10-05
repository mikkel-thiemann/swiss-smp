'use strict';
// Crafting-Rezepte wie im Original (Java Edition). Formen werden auch gespiegelt erkannt.

const TAGS = {
  planks: ['oak_planks', 'birch_planks', 'spruce_planks'],
  logs: ['oak_log', 'birch_log', 'spruce_log'],
  coals: ['coal', 'charcoal'],
  stone_tool: ['cobblestone'],
  wool: ['white_wool', 'red_wool'],
};

const RECIPES = [];

function resolveKey(k) {
  if (k.startsWith('#')) return TAGS[k.slice(1)].map(n => I[n]);
  return [I[k]];
}

function shaped(rows, key, out, count) {
  const k = {};
  for (const c in key) k[c] = resolveKey(key[c]);
  RECIPES.push({ type: 'shaped', rows, key: k, out: I[out], count: count || 1 });
}

function shapeless(ings, out, count) {
  RECIPES.push({ type: 'shapeless', ings: ings.map(resolveKey), out: I[out], count: count || 1 });
}

// Holz
shapeless(['oak_log'], 'oak_planks', 4);
shapeless(['birch_log'], 'birch_planks', 4);
shapeless(['spruce_log'], 'spruce_planks', 4);
shaped(['#', '#'], { '#': '#planks' }, 'stick', 4);
shaped(['##', '##'], { '#': '#planks' }, 'crafting_table');
shaped(['###', '# #', '###'], { '#': '#planks' }, 'chest');
shaped(['# #', ' # '], { '#': '#planks' }, 'bowl', 4);
shaped(['###'], { '#': 'oak_planks' }, 'oak_slab', 6);
shaped(['#  ', '## ', '###'], { '#': 'oak_planks' }, 'oak_stairs', 4);
shaped(['##', '##', '##'], { '#': 'oak_planks' }, 'oak_door', 3);
shaped(['# #', '###', '# #'], { '#': 'stick' }, 'ladder', 3);
shaped(['###', 'XXX', '###'], { '#': '#planks', X: 'book' }, 'bookshelf');
shaped(['WWW', 'PPP'], { W: 'white_wool', P: '#planks' }, 'white_bed');

// Stein
shaped(['###', '# #', '###'], { '#': 'cobblestone' }, 'furnace');
shaped(['###'], { '#': 'cobblestone' }, 'cobblestone_slab', 6);
shaped(['###'], { '#': 'stone' }, 'stone_slab', 6);
shaped(['###'], { '#': 'stone_bricks' }, 'stone_brick_slab', 6);
shaped(['#  ', '## ', '###'], { '#': 'cobblestone' }, 'cobblestone_stairs', 4);
shaped(['#  ', '## ', '###'], { '#': 'stone_bricks' }, 'stone_brick_stairs', 4);
shaped(['##', '##'], { '#': 'stone' }, 'stone_bricks', 4);
shaped(['##', '##'], { '#': 'sand' }, 'sandstone');
shaped(['##', '##'], { '#': 'brick' }, 'bricks');
shaped(['##', '##'], { '#': 'clay_ball' }, 'clay');
shaped(['##', '##'], { '#': 'snowball' }, 'snow_block');
shaped(['##', '##'], { '#': 'granite' }, 'polished_granite', 4);
shaped(['##', '##'], { '#': 'diorite' }, 'polished_diorite', 4);
shaped(['##', '##'], { '#': 'andesite' }, 'polished_andesite', 4);
shapeless(['diorite', 'cobblestone'], 'andesite', 2);

shaped(['###'], { '#': 'birch_planks' }, 'birch_slab', 6);
shaped(['###'], { '#': 'spruce_planks' }, 'spruce_slab', 6);
shaped(['###'], { '#': 'sandstone' }, 'sandstone_slab', 6);
shaped(['###'], { '#': 'bricks' }, 'brick_slab', 6);
shaped(['#  ', '## ', '###'], { '#': 'birch_planks' }, 'birch_stairs', 4);
shaped(['#  ', '## ', '###'], { '#': 'spruce_planks' }, 'spruce_stairs', 4);
shaped(['#  ', '## ', '###'], { '#': 'sandstone' }, 'sandstone_stairs', 4);
shaped(['#  ', '## ', '###'], { '#': 'bricks' }, 'brick_stairs', 4);
shaped(['#  ', '## ', '###'], { '#': 'stone' }, 'stone_stairs', 4);
shaped(['W#W', 'W#W'], { W: 'oak_planks', '#': 'stick' }, 'oak_fence', 3);
shaped(['#W#', '#W#'], { W: 'oak_planks', '#': 'stick' }, 'oak_fence_gate');
shaped(['###', '###'], { '#': 'oak_planks' }, 'oak_trapdoor', 2);
shaped(['###', '###'], { '#': 'glass' }, 'glass_pane', 16);
shaped(['###', '###'], { '#': 'iron_ingot' }, 'iron_bars', 16);
shaped(['##'], { '#': 'white_wool' }, 'white_carpet', 3);
shaped(['##'], { '#': 'red_wool' }, 'red_carpet', 3);
shaped(['MMM', 'SES', 'WWW'], { M: 'milk_bucket', S: 'sugar', E: 'egg', W: 'wheat' }, 'cake');

// Licht und Sonstiges
shaped(['C', 'S'], { C: '#coals', S: 'stick' }, 'torch', 4);
shaped(['A', 'B'], { A: 'carved_pumpkin', B: 'torch' }, 'jack_o_lantern');
shaped(['GSG', 'SGS', 'GSG'], { G: 'gunpowder', S: 'sand' }, 'tnt');
shaped(['##', '##'], { '#': 'string' }, 'white_wool');
shapeless(['poppy'], 'red_dye');
shapeless(['white_wool', 'red_dye'], 'red_wool');

// Erz-Bloecke und zurueck
for (const [item, block] of [['coal', 'coal_block'], ['iron_ingot', 'iron_block'], ['gold_ingot', 'gold_block'],
  ['diamond', 'diamond_block'], ['redstone', 'redstone_block'], ['lapis_lazuli', 'lapis_block']]) {
  shaped(['###', '###', '###'], { '#': item }, block);
  shapeless([block], item, 9);
}

// Werkzeuge
const TOOL_MATS = { wooden: '#planks', stone: '#stone_tool', iron: 'iron_ingot', golden: 'gold_ingot', diamond: 'diamond' };
for (const m in TOOL_MATS) {
  const k = { X: TOOL_MATS[m], S: 'stick' };
  shaped(['XXX', ' S ', ' S '], k, m + '_pickaxe');
  shaped(['XX', 'XS', ' S'], k, m + '_axe');
  shaped(['X', 'S', 'S'], k, m + '_shovel');
  shaped(['XX', ' S', ' S'], k, m + '_hoe');
  shaped(['X', 'X', 'S'], k, m + '_sword');
}

// Ruestung
const ARMOR_MATS = { leather: 'leather', iron: 'iron_ingot', golden: 'gold_ingot', diamond: 'diamond' };
for (const m in ARMOR_MATS) {
  const k = { X: ARMOR_MATS[m] };
  shaped(['XXX', 'X X'], k, m + '_helmet');
  shaped(['X X', 'XXX', 'XXX'], k, m + '_chestplate');
  shaped(['XXX', 'X X', 'X X'], k, m + '_leggings');
  shaped(['X X', 'X X'], k, m + '_boots');
}

// Eisen-Sachen
shaped(['X X', ' X '], { X: 'iron_ingot' }, 'bucket');
shaped([' X', 'X '], { X: 'iron_ingot' }, 'shears');
shapeless(['iron_ingot', 'flint'], 'flint_and_steel');

// Kampf
shaped(['F', 'S', 'E'], { F: 'flint', S: 'stick', E: 'feather' }, 'arrow', 4);
shaped([' SX', 'S X', ' SX'], { S: 'stick', X: 'string' }, 'bow');

// Essen und Papier
shaped(['###'], { '#': 'wheat' }, 'bread');
shaped(['###', '#A#', '###'], { '#': 'gold_ingot', A: 'apple' }, 'golden_apple');
shapeless(['pumpkin', 'sugar', 'egg'], 'pumpkin_pie');
shaped(['###'], { '#': 'sugar_cane' }, 'paper', 3);
shapeless(['sugar_cane'], 'sugar');
shapeless(['paper', 'paper', 'paper', 'leather'], 'book');
shapeless(['bone'], 'bone_meal', 3);
shapeless(['pumpkin'], 'pumpkin_seeds', 4);

// ---------------------------------------------------------------- Abgleich
function matchRecipe(grid, w) {
  // grid: Array von Item-IDs (0 = leer), w = Breite (2 oder 3)
  const h = grid.length / w;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  const items = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = grid[y * w + x];
    if (v) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); items.push(v); }
  }
  if (!items.length) return null;
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  for (const r of RECIPES) {
    if (r.type === 'shapeless') {
      if (r.ings.length !== items.length) continue;
      const left = items.slice();
      let ok = true;
      for (const ing of r.ings) {
        const i = left.findIndex(v => ing.includes(v));
        if (i < 0) { ok = false; break; }
        left.splice(i, 1);
      }
      if (ok) return r;
    } else {
      const rw = Math.max(...r.rows.map(s => s.length)), rh = r.rows.length;
      if (rw !== bw || rh !== bh) continue;
      for (const mirror of [false, true]) {
        let ok = true;
        for (let y = 0; y < rh && ok; y++) for (let x = 0; x < rw && ok; x++) {
          const ch = (r.rows[y][mirror ? rw - 1 - x : x] || ' ');
          const v = grid[(minY + y) * w + minX + x];
          if (ch === ' ') { if (v) ok = false; }
          else if (!v || !r.key[ch].includes(v)) ok = false;
        }
        if (ok) return r;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------- Ofen
const SMELTING = {};
function smelt(a, b) { SMELTING[I[a]] = I[b]; }
smelt('raw_iron', 'iron_ingot');
smelt('raw_gold', 'gold_ingot');
smelt('iron_ore', 'iron_ingot');
smelt('gold_ore', 'gold_ingot');
smelt('diamond_ore', 'diamond');
smelt('coal_ore', 'coal');
smelt('redstone_ore', 'redstone');
smelt('lapis_ore', 'lapis_lazuli');
smelt('sand', 'glass');
smelt('cobblestone', 'stone');
smelt('stone', 'smooth_stone');
smelt('clay_ball', 'brick');
smelt('oak_log', 'charcoal');
smelt('birch_log', 'charcoal');
smelt('spruce_log', 'charcoal');
smelt('porkchop', 'cooked_porkchop');
smelt('beef', 'cooked_beef');
smelt('chicken', 'cooked_chicken');
smelt('mutton', 'cooked_mutton');
smelt('cactus', 'green_dye');

function fuelValue(id) { return ITEMS[id] ? ITEMS[id].fuel || 0 : 0; }

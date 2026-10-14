'use strict';
// Alle Bloecke und Items. IDs 0-255 sind Bloecke, ab 256 reine Items.

const BLOCKS = [];
const ITEMS = [];
const B = {};   // Name -> Block-ID
const I = {};   // Name -> Item-ID (Bloecke inklusive)

const FACING = [[0, 0, 1], [-1, 0, 0], [0, 0, -1], [1, 0, 0]]; // 0=Sueden, 1=Westen, 2=Norden, 3=Osten

function t(name) { return TEX[name]; }

function defBlock(id, name, de, p) {
  const tex = p.tex || name;
  const faces = typeof tex === 'string'
    ? { top: t(tex), bottom: t(tex), side: t(tex), front: t(tex) }
    : { top: t(tex.top || tex.side), bottom: t(tex.bottom || tex.top || tex.side), side: t(tex.side), front: t(tex.front || tex.side) };
  const b = Object.assign({
    id, name, de,
    shape: 'cube',
    opaque: true,      // voller, undurchsichtiger Wuerfel
    solid: true,       // Kollision
    pass: 'opaque',    // opaque | cutout | translucent
    hardness: 1, tool: null, level: 0, needsTool: false,
    light: 0, filter: 15, // filter 15 = blockiert Licht komplett
    drops: null, gravity: false, replaceable: false, fluid: null,
    selectable: true, item: true,
  }, p);
  b.faces = faces;
  if (!b.opaque && p.filter === undefined) b.filter = 0;
  BLOCKS[id] = b;
  B[name] = id;
  if (b.item) defItem(id, name, de, { block: id, stack: p.stack || 64, fuel: p.fuel, icon: p.icon });
  return b;
}

function defItem(id, name, de, p) {
  const it = Object.assign({ id, name, de, stack: 64, block: null, tool: null, food: null, armor: null, fuel: 0 }, p);
  ITEMS[id] = it;
  I[name] = id;
  return it;
}

const plant = (extra) => Object.assign({ shape: 'cross', opaque: false, solid: false, pass: 'cutout', hardness: 0, replaceable: false }, extra);
const one = (id) => () => [[id, 1]];

// ---------------------------------------------------------------- Bloecke
defBlock(0, 'air', 'Luft', { tex: 'stone', opaque: false, solid: false, selectable: false, replaceable: true, item: false, shape: 'none' });
defBlock(1, 'stone', 'Stein', { hardness: 1.5, tool: 'pickaxe', needsTool: true, drops: () => [[B.cobblestone, 1]] });
defBlock(2, 'grass_block', 'Grasblock', { tex: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' }, hardness: 0.6, tool: 'shovel', drops: () => [[B.dirt, 1]] });
defBlock(3, 'dirt', 'Erde', { hardness: 0.5, tool: 'shovel' });
defBlock(4, 'cobblestone', 'Bruchstein', { hardness: 2, tool: 'pickaxe', needsTool: true });
defBlock(5, 'oak_planks', 'Eichenholzbretter', { hardness: 2, tool: 'axe', fuel: 300 });
defBlock(6, 'bedrock', 'Grundgestein', { hardness: -1 });
defBlock(7, 'sand', 'Sand', { hardness: 0.5, tool: 'shovel', gravity: true });
defBlock(8, 'gravel', 'Kies', { hardness: 0.6, tool: 'shovel', gravity: true, drops: (r) => [[r() < 0.1 ? I.flint : B.gravel, 1]] });
defBlock(9, 'oak_log', 'Eichenstamm', { tex: { top: 'oak_log_top', side: 'oak_log' }, hardness: 2, tool: 'axe', fuel: 300 });
defBlock(10, 'oak_leaves', 'Eichenlaub', { opaque: false, pass: 'cutout', filter: 1, hardness: 0.2, tool: 'hoe', shearable: true,
  drops: (r) => { const d = []; if (r() < 0.05) d.push([B.oak_sapling, 1]); if (r() < 0.02) d.push([I.stick, 1 + (r() * 2 | 0)]); if (r() < 0.005) d.push([I.apple, 1]); return d; } });
defBlock(11, 'glass', 'Glas', { opaque: false, pass: 'cutout', hardness: 0.3, drops: () => [] });
defBlock(12, 'coal_ore', 'Steinkohle', { hardness: 3, tool: 'pickaxe', needsTool: true, drops: () => [[I.coal, 1]] });
defBlock(13, 'iron_ore', 'Eisenerz', { hardness: 3, tool: 'pickaxe', level: 1, needsTool: true, drops: () => [[I.raw_iron, 1]] });
defBlock(14, 'gold_ore', 'Golderz', { hardness: 3, tool: 'pickaxe', level: 2, needsTool: true, drops: () => [[I.raw_gold, 1]] });
defBlock(15, 'diamond_ore', 'Diamanterz', { hardness: 3, tool: 'pickaxe', level: 2, needsTool: true, drops: () => [[I.diamond, 1]] });
defBlock(16, 'redstone_ore', 'Redstone-Erz', { hardness: 3, tool: 'pickaxe', level: 2, needsTool: true, drops: (r) => [[I.redstone, 4 + (r() * 2 | 0)]] });
defBlock(17, 'lapis_ore', 'Lapislazulierz', { hardness: 3, tool: 'pickaxe', level: 1, needsTool: true, drops: (r) => [[I.lapis_lazuli, 4 + (r() * 6 | 0)]] });
defBlock(18, 'water', 'Wasser', { shape: 'fluid', fluid: 'water', opaque: false, solid: false, pass: 'translucent', filter: 1, hardness: 100, selectable: false, replaceable: true, item: false });
defBlock(19, 'lava', 'Lava', { shape: 'fluid', fluid: 'lava', opaque: false, solid: false, pass: 'opaque', filter: 15, light: 15, hardness: 100, selectable: false, replaceable: true, item: false });
defBlock(20, 'crafting_table', 'Werkbank', { tex: { top: 'crafting_table_top', bottom: 'oak_planks', side: 'crafting_table_side', front: 'crafting_table_front' }, hardness: 2.5, tool: 'axe', fuel: 300, facing: true });
defBlock(21, 'furnace', 'Ofen', { tex: { top: 'furnace_top', side: 'furnace_side', front: 'furnace_front' }, hardness: 3.5, tool: 'pickaxe', needsTool: true, facing: true });
defBlock(22, 'furnace_lit', 'Ofen', { tex: { top: 'furnace_top', side: 'furnace_side', front: 'furnace_front_on' }, hardness: 3.5, tool: 'pickaxe', needsTool: true, facing: true, light: 13, item: false, drops: () => [[B.furnace, 1]] });
defBlock(23, 'chest', 'Truhe', { tex: { top: 'chest_top', side: 'chest_side', front: 'chest_front' }, hardness: 2.5, tool: 'axe', fuel: 300, facing: true });
defBlock(24, 'torch', 'Fackel', { shape: 'torch', opaque: false, solid: false, pass: 'cutout', hardness: 0, light: 14 });
defBlock(25, 'sandstone', 'Sandstein', { tex: { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone' }, hardness: 0.8, tool: 'pickaxe', needsTool: true });
defBlock(26, 'cactus', 'Kaktus', { shape: 'cactus', tex: { top: 'cactus_top', side: 'cactus_side' }, opaque: false, pass: 'cutout', hardness: 0.4 });
defBlock(27, 'snow_block', 'Schneeblock', { tex: 'snow', hardness: 0.2, tool: 'shovel', needsTool: true, drops: () => [[I.snowball, 4]] });
defBlock(28, 'ice', 'Eis', { opaque: false, pass: 'translucent', filter: 1, hardness: 0.5, tool: 'pickaxe', drops: () => [], slippery: true });
defBlock(29, 'clay', 'Ton', { hardness: 0.6, tool: 'shovel', drops: () => [[I.clay_ball, 4]] });
defBlock(30, 'bricks', 'Ziegelsteine', { hardness: 2, tool: 'pickaxe', needsTool: true });
defBlock(31, 'bookshelf', 'Buecherregal', { tex: { top: 'oak_planks', side: 'bookshelf' }, hardness: 1.5, tool: 'axe', fuel: 300, drops: () => [[I.book, 3]] });
defBlock(32, 'tnt', 'TNT', { tex: { top: 'tnt_top', bottom: 'tnt_bottom', side: 'tnt_side' }, hardness: 0 });
defBlock(33, 'white_wool', 'Weisse Wolle', { hardness: 0.8, tool: 'shears', fuel: 100 });
defBlock(34, 'birch_log', 'Birkenstamm', { tex: { top: 'birch_log_top', side: 'birch_log' }, hardness: 2, tool: 'axe', fuel: 300 });
defBlock(35, 'birch_leaves', 'Birkenlaub', { opaque: false, pass: 'cutout', filter: 1, hardness: 0.2, tool: 'hoe', shearable: true,
  drops: (r) => { const d = []; if (r() < 0.05) d.push([B.birch_sapling, 1]); if (r() < 0.02) d.push([I.stick, 1]); return d; } });
defBlock(36, 'birch_planks', 'Birkenholzbretter', { hardness: 2, tool: 'axe', fuel: 300 });
defBlock(37, 'spruce_log', 'Fichtenstamm', { tex: { top: 'spruce_log_top', side: 'spruce_log' }, hardness: 2, tool: 'axe', fuel: 300 });
defBlock(38, 'spruce_leaves', 'Fichtennadeln', { opaque: false, pass: 'cutout', filter: 1, hardness: 0.2, tool: 'hoe', shearable: true,
  drops: (r) => { const d = []; if (r() < 0.05) d.push([B.spruce_sapling, 1]); if (r() < 0.02) d.push([I.stick, 1]); return d; } });
defBlock(39, 'spruce_planks', 'Fichtenholzbretter', { hardness: 2, tool: 'axe', fuel: 300 });
defBlock(40, 'coal_block', 'Kohleblock', { hardness: 5, tool: 'pickaxe', needsTool: true, fuel: 16000 });
defBlock(41, 'iron_block', 'Eisenblock', { hardness: 5, tool: 'pickaxe', level: 1, needsTool: true });
defBlock(42, 'gold_block', 'Goldblock', { hardness: 3, tool: 'pickaxe', level: 2, needsTool: true });
defBlock(43, 'diamond_block', 'Diamantblock', { hardness: 5, tool: 'pickaxe', level: 2, needsTool: true });
defBlock(44, 'redstone_block', 'Redstone-Block', { hardness: 5, tool: 'pickaxe', needsTool: true });
defBlock(45, 'lapis_block', 'Lapislazuliblock', { hardness: 3, tool: 'pickaxe', level: 1, needsTool: true });
defBlock(46, 'stone_bricks', 'Steinziegel', { hardness: 1.5, tool: 'pickaxe', needsTool: true });
defBlock(47, 'obsidian', 'Obsidian', { hardness: 50, tool: 'pickaxe', level: 3, needsTool: true });
defBlock(48, 'short_grass', 'Gras', plant({ replaceable: true, drops: (r) => r() < 0.125 ? [[I.wheat_seeds, 1]] : [], shearable: true, needsSoil: true }));
defBlock(49, 'dandelion', 'Loewenzahn', plant({ needsSoil: true }));
defBlock(50, 'poppy', 'Mohn', plant({ needsSoil: true }));
defBlock(51, 'sugar_cane', 'Zuckerrohr', plant({}));
defBlock(52, 'pumpkin', 'Kuerbis', { tex: { top: 'pumpkin_top', side: 'pumpkin_side' }, hardness: 1, tool: 'axe' });
defBlock(53, 'jack_o_lantern', 'Kuerbislaterne', { tex: { top: 'pumpkin_top', side: 'pumpkin_side', front: 'jack_o_lantern' }, hardness: 1, tool: 'axe', facing: true, light: 15 });
defBlock(54, 'smooth_stone', 'Glatter Stein', { hardness: 2, tool: 'pickaxe', needsTool: true });
defBlock(55, 'farmland', 'Ackerboden', { shape: 'farmland', tex: { top: 'farmland', bottom: 'dirt', side: 'dirt' }, opaque: false, filter: 15, hardness: 0.6, tool: 'shovel', drops: () => [[B.dirt, 1]] });
for (let s = 0; s < 4; s++) {
  defBlock(56 + s, 'wheat' + s, 'Weizen', plant({ tex: 'wheat' + s, item: false, crop: s,
    drops: (r) => s < 3 ? [[I.wheat_seeds, 1]] : [[I.wheat, 1], [I.wheat_seeds, 1 + (r() * 3 | 0)]] }));
}
defBlock(60, 'oak_sapling', 'Eichensetzling', plant({ sapling: 'oak', needsSoil: true, fuel: 100 }));
defBlock(61, 'birch_sapling', 'Birkensetzling', plant({ sapling: 'birch', needsSoil: true, fuel: 100 }));
defBlock(62, 'spruce_sapling', 'Fichtensetzling', plant({ sapling: 'spruce', needsSoil: true, fuel: 100 }));
defBlock(63, 'snowy_grass', 'Verschneiter Grasblock', { tex: { top: 'snow', bottom: 'dirt', side: 'grass_side_snow' }, hardness: 0.6, tool: 'shovel', item: false, drops: () => [[B.dirt, 1]] });
defBlock(64, 'granite', 'Granit', { hardness: 1.5, tool: 'pickaxe', needsTool: true });
defBlock(65, 'diorite', 'Diorit', { hardness: 1.5, tool: 'pickaxe', needsTool: true });
defBlock(66, 'andesite', 'Andesit', { hardness: 1.5, tool: 'pickaxe', needsTool: true });
defBlock(67, 'polished_granite', 'Polierter Granit', { hardness: 1.5, tool: 'pickaxe', needsTool: true });
defBlock(68, 'polished_diorite', 'Polierter Diorit', { hardness: 1.5, tool: 'pickaxe', needsTool: true });
defBlock(69, 'polished_andesite', 'Polierter Andesit', { hardness: 1.5, tool: 'pickaxe', needsTool: true });
defBlock(70, 'mossy_cobblestone', 'Bemooster Bruchstein', { hardness: 2, tool: 'pickaxe', needsTool: true });
const slab = (tex, de, tool, extra) => Object.assign({ shape: 'slab', tex, opaque: false, filter: 15, hardness: 2, tool, needsTool: tool === 'pickaxe' }, extra);
defBlock(71, 'oak_slab', 'Eichenholzstufe', slab('oak_planks', '', 'axe', { fuel: 150 }));
defBlock(72, 'cobblestone_slab', 'Bruchsteinstufe', slab('cobblestone', '', 'pickaxe'));
defBlock(73, 'stone_slab', 'Steinstufe', slab('stone', '', 'pickaxe'));
defBlock(74, 'stone_brick_slab', 'Steinziegelstufe', slab('stone_bricks', '', 'pickaxe'));
const stairs = (tex, tool, extra) => Object.assign({ shape: 'stairs', tex, opaque: false, filter: 15, hardness: 2, tool, needsTool: tool === 'pickaxe' }, extra);
defBlock(75, 'oak_stairs', 'Eichenholztreppe', stairs('oak_planks', 'axe', { fuel: 300 }));
defBlock(76, 'cobblestone_stairs', 'Bruchsteintreppe', stairs('cobblestone', 'pickaxe'));
defBlock(77, 'stone_brick_stairs', 'Steinziegeltreppe', stairs('stone_bricks', 'pickaxe'));
defBlock(78, 'oak_door', 'Eichenholztuer', { shape: 'door', tex: { top: 'oak_door_top', side: 'oak_door_bottom' }, opaque: false, pass: 'cutout', filter: 0, hardness: 3, tool: 'axe', item: false, drops: () => [[I.oak_door, 1]] });
defBlock(79, 'ladder', 'Leiter', { shape: 'ladder', opaque: false, solid: false, pass: 'cutout', hardness: 0.4, tool: 'axe', climbable: true, fuel: 300 });
defBlock(80, 'bed', 'Weisses Bett', { shape: 'bed', tex: { top: 'bed_head', bottom: 'oak_planks', side: 'bed_side', front: 'bed_foot' }, opaque: false, pass: 'cutout', filter: 0, hardness: 0.2, item: false, drops: () => [[I.white_bed, 1]] });
defBlock(81, 'dead_bush', 'Toter Busch', plant({ replaceable: true, drops: (r) => [[I.stick, r() * 3 | 0]], fuel: 100 }));
defBlock(82, 'red_wool', 'Rote Wolle', { hardness: 0.8, tool: 'shears', fuel: 100 });
defBlock(84, 'birch_slab', 'Birkenholzstufe', slab('birch_planks', '', 'axe', { fuel: 150 }));
defBlock(85, 'spruce_slab', 'Fichtenholzstufe', slab('spruce_planks', '', 'axe', { fuel: 150 }));
defBlock(86, 'sandstone_slab', 'Sandsteinstufe', slab({ top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone' }, '', 'pickaxe'));
defBlock(87, 'brick_slab', 'Ziegelstufe', slab('bricks', '', 'pickaxe'));
defBlock(88, 'birch_stairs', 'Birkenholztreppe', stairs('birch_planks', 'axe', { fuel: 300 }));
defBlock(89, 'spruce_stairs', 'Fichtenholztreppe', stairs('spruce_planks', 'axe', { fuel: 300 }));
defBlock(90, 'sandstone_stairs', 'Sandsteintreppe', stairs({ top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone' }, 'pickaxe'));
defBlock(91, 'brick_stairs', 'Ziegeltreppe', stairs('bricks', 'pickaxe'));
defBlock(92, 'stone_stairs', 'Steintreppe', stairs('stone', 'pickaxe'));
defBlock(93, 'oak_fence', 'Eichenholzzaun', { shape: 'fence', tex: 'oak_planks', icon: 'fence_item', opaque: false, filter: 0, hardness: 2, tool: 'axe', fuel: 300, connects: 'fence' });
defBlock(94, 'oak_fence_gate', 'Eichenholzzauntor', { shape: 'gate', tex: 'oak_planks', icon: 'gate_item', opaque: false, filter: 0, hardness: 2, tool: 'axe', fuel: 300 });
defBlock(95, 'glass_pane', 'Glasscheibe', { shape: 'pane', tex: 'glass', icon: 'pane_item', opaque: false, pass: 'cutout', filter: 0, hardness: 0.3, drops: () => [], connects: 'pane' });
defBlock(96, 'iron_bars', 'Eisengitter', { shape: 'pane', tex: 'iron_bars', icon: 'iron_bars', opaque: false, pass: 'cutout', filter: 0, hardness: 5, tool: 'pickaxe', needsTool: true, connects: 'pane' });
defBlock(97, 'oak_trapdoor', 'Eichenholzfalltuer', { shape: 'trapdoor', tex: 'oak_trapdoor', icon: 'oak_trapdoor', opaque: false, pass: 'cutout', filter: 0, hardness: 3, tool: 'axe', fuel: 300 });
defBlock(98, 'cake', 'Kuchen', { shape: 'cake', tex: { top: 'cake_top', bottom: 'cake_bottom', side: 'cake_side' }, icon: 'cake_item', opaque: false, filter: 0, hardness: 0.5, drops: () => [], stack: 1 });
defBlock(99, 'white_carpet', 'Weisser Teppich', { shape: 'carpet', tex: 'white_wool', opaque: false, filter: 0, hardness: 0.1, fuel: 67 });
defBlock(100, 'red_carpet', 'Roter Teppich', { shape: 'carpet', tex: 'red_wool', opaque: false, filter: 0, hardness: 0.1, fuel: 67 });
defBlock(83, 'carved_pumpkin', 'Geschnitzter Kuerbis', { tex: { top: 'pumpkin_top', side: 'pumpkin_side', front: 'pumpkin_face' }, hardness: 1, tool: 'axe', facing: true });

// ---------------------------------------------------------------- Items
let nextItem = 256;
const it = (name, de, p) => defItem(nextItem++, name, de, Object.assign({ icon: name }, p || {}));
it('stick', 'Stock', { fuel: 100 });
it('coal', 'Kohle', { fuel: 1600 });
it('charcoal', 'Holzkohle', { fuel: 1600 });
it('iron_ingot', 'Eisenbarren');
it('gold_ingot', 'Goldbarren');
it('diamond', 'Diamant');
it('redstone', 'Redstone-Staub');
it('lapis_lazuli', 'Lapislazuli');
it('raw_iron', 'Roheisen');
it('raw_gold', 'Rohgold');
it('flint', 'Feuerstein');
it('wheat', 'Weizen');
it('wheat_seeds', 'Weizenkoerner', { places: 'wheat0' });
it('bread', 'Brot', { food: [5, 6] });
it('apple', 'Apfel', { food: [4, 2.4] });
it('golden_apple', 'Goldener Apfel', { food: [4, 9.6], regen: true });
it('porkchop', 'Rohes Schweinefleisch', { food: [3, 1.8] });
it('cooked_porkchop', 'Gebratenes Schweinefleisch', { food: [8, 12.8] });
it('beef', 'Rohes Rindfleisch', { food: [3, 1.8] });
it('cooked_beef', 'Steak', { food: [8, 12.8] });
it('chicken', 'Rohes Huehnchen', { food: [2, 1.2] });
it('cooked_chicken', 'Gebratenes Huehnchen', { food: [6, 7.2] });
it('mutton', 'Rohes Hammelfleisch', { food: [2, 1.2] });
it('cooked_mutton', 'Gebratenes Hammelfleisch', { food: [6, 9.6] });
it('rotten_flesh', 'Verrottetes Fleisch', { food: [4, 0.8] });
it('leather', 'Leder');
it('feather', 'Feder');
it('string', 'Faden');
it('bone', 'Knochen');
it('bone_meal', 'Knochenmehl');
it('gunpowder', 'Schwarzpulver');
it('clay_ball', 'Tonklumpen');
it('brick', 'Ziegel');
it('paper', 'Papier');
it('book', 'Buch');
it('sugar', 'Zucker');
it('bowl', 'Schuessel', { fuel: 100 });
it('egg', 'Ei', { stack: 16, throwable: true });
it('bucket', 'Eimer', { stack: 16 });
it('water_bucket', 'Wassereimer', { stack: 1 });
it('lava_bucket', 'Lavaeimer', { stack: 1, fuel: 20000 });
it('milk_bucket', 'Milcheimer', { stack: 1, drink: true });
it('flint_and_steel', 'Feuerzeug', { stack: 1, durability: 64 });
it('shears', 'Schere', { stack: 1, durability: 238, tool: { type: 'shears', tier: 0, speed: 1, damage: 1 } });
it('arrow', 'Pfeil');
it('bow', 'Bogen', { stack: 1, durability: 384, fuel: 300 });
it('pumpkin_pie', 'Kuerbiskuchen', { food: [8, 4.8] });
it('snowball', 'Schneeball', { stack: 16, throwable: true });
it('oak_door', 'Eichenholztuer', { icon: 'oak_door_item', places: 'oak_door', fuel: 200 });
it('white_bed', 'Weisses Bett', { icon: 'bed_item', places: 'bed', stack: 1 });
it('red_dye', 'Roter Farbstoff');
it('green_dye', 'Gruener Farbstoff');
it('pumpkin_seeds', 'Kuerbiskerne');

// Werkzeuge: Haltbarkeit, Abbau-Geschwindigkeit und Schaden wie im Original (Java Edition)
const MATS = {
  wooden: { de: 'Holz', tier: 0, speed: 2, dur: 59, dmg: 0, axe: [7, 0.8] },
  stone: { de: 'Stein', tier: 1, speed: 4, dur: 131, dmg: 1, axe: [9, 0.8] },
  iron: { de: 'Eisen', tier: 2, speed: 6, dur: 250, dmg: 2, axe: [9, 0.9] },
  golden: { de: 'Gold', tier: 0, speed: 12, dur: 32, dmg: 0, axe: [7, 1.0] },
  diamond: { de: 'Diamant', tier: 3, speed: 8, dur: 1561, dmg: 3, axe: [9, 1.0] },
};
const TOOL_DE = { sword: 'schwert', shovel: 'schaufel', pickaxe: 'spitzhacke', axe: 'axt', hoe: 'hacke' };
for (const m of Object.keys(MATS)) {
  const M = MATS[m];
  for (const k of ['sword', 'shovel', 'pickaxe', 'axe', 'hoe']) {
    let damage, speed;
    if (k === 'sword') { damage = 4 + M.dmg; speed = 1.6; }
    else if (k === 'axe') { damage = M.axe[0]; speed = M.axe[1]; }
    else if (k === 'pickaxe') { damage = 2 + M.dmg; speed = 1.2; }
    else if (k === 'shovel') { damage = 2.5 + M.dmg; speed = 1; }
    else { damage = 1; speed = [1, 2, 3, 1, 4][Object.keys(MATS).indexOf(m)]; }
    it(m + '_' + k, M.de + TOOL_DE[k], { stack: 1, durability: M.dur, tool: { type: k, tier: M.tier, speed: M.speed, damage, attackSpeed: speed }, fuel: m === 'wooden' ? 200 : 0 });
  }
}
const ARMOR = {
  leather: { de: ['Lederkappe', 'Lederjacke', 'Lederhose', 'Lederstiefel'], pts: [1, 3, 2, 1], mul: 5 },
  iron: { de: ['Eisenhelm', 'Eisenharnisch', 'Eisenbeinschutz', 'Eisenstiefel'], pts: [2, 6, 5, 2], mul: 15 },
  golden: { de: ['Goldhelm', 'Goldharnisch', 'Goldbeinschutz', 'Goldstiefel'], pts: [2, 5, 3, 1], mul: 7 },
  diamond: { de: ['Diamanthelm', 'Diamantharnisch', 'Diamantbeinschutz', 'Diamantstiefel'], pts: [3, 8, 6, 3], mul: 33 },
};
['helmet', 'chestplate', 'leggings', 'boots'].forEach((k, slot) => {
  for (const m of Object.keys(ARMOR)) {
    const A = ARMOR[m];
    it(m + '_' + k, A.de[slot], { stack: 1, durability: [11, 16, 15, 13][slot] * A.mul, armor: { slot, points: A.pts[slot], toughness: m === 'diamond' ? 2 : 0 } });
  }
});

// Block-Items, die einen anderen Block setzen
I.wheat_seeds_block = B.wheat0;

function itemMaxStack(id) { return ITEMS[id] ? ITEMS[id].stack : 64; }
function itemDurability(id) { return ITEMS[id] && ITEMS[id].durability || 0; }
function itemName(id) { return ITEMS[id] ? ITEMS[id].de : '?'; }

function blockBreakTime(blockId, toolItemId, inWater, onGround) {
  const b = BLOCKS[blockId];
  if (b.hardness < 0) return Infinity;
  if (b.hardness === 0) return 0;
  const tool = toolItemId && ITEMS[toolItemId] ? ITEMS[toolItemId].tool : null;
  let speed = 1;
  const matches = tool && b.tool && (tool.type === b.tool || (tool.type === 'shears' && (b.shearable || b.name.endsWith('wool'))));
  if (matches) speed = tool.type === 'shears' ? (b.name.endsWith('wool') ? 5 : 15) : tool.speed;
  if (tool && tool.type === 'sword' && b.shearable) speed = 1.5;
  const canHarvest = !b.needsTool || (matches && tool.tier >= b.level);
  if (inWater) speed /= 5;
  if (!onGround) speed /= 5;
  const dmg = speed / b.hardness / (canHarvest ? 30 : 100);
  if (dmg >= 1) return 0;
  return Math.ceil(1 / dmg) / 20;
}

function canHarvest(blockId, toolItemId) {
  const b = BLOCKS[blockId];
  if (!b.needsTool) return true;
  const tool = toolItemId && ITEMS[toolItemId] ? ITEMS[toolItemId].tool : null;
  return !!(tool && tool.type === b.tool && tool.tier >= b.level) || !!(tool && tool.type === 'shears' && b.name.endsWith('wool'));
}

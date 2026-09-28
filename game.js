(() => {
  'use strict';

  const COLS = 24;
  const ROWS = 16;
  const TILE = 32;
  const SAVE_KEY = 'windglass-keep-save-v1';
  const FLOOR_NAMES = ['The Root Cellars', 'The Brine Gallery', 'The Hollow Archive', 'The Eye of the Gale'];
  const $ = (selector) => document.querySelector(selector);
  const canvas = $('#dungeon');
  const ctx = canvas.getContext('2d');
  const dialog = $('#game-dialog');
  const dialogContent = $('#dialog-content');
  const scrim = $('#intro-scrim');
  let game = null;
  let visible = new Set();
  let autoPath = [];
  let autoTimer = 0;
  let itemCounter = 0;

  const CLASS_DATA = {
    sentinel: { name: 'Sentinel', hp: 40, mp: 10, force: 4, insight: 1, note: 'A shield against the storm.' },
    arcanist: { name: 'Arcanist', hp: 29, mp: 19, force: 1, insight: 4, note: 'A mind tuned to old magic.' },
    wayfarer: { name: 'Wayfarer', hp: 34, mp: 14, force: 3, insight: 2, note: 'A little ready for anything.' }
  };

  const ENEMIES = {
    rat: { name: 'Cave rat', glyph: 'r', hp: 7, attack: 2, xp: 4, color: '#b28b72' },
    draugr: { name: 'Draugr', glyph: 'd', hp: 12, attack: 4, xp: 8, color: '#92aa94' },
    wisp: { name: 'Blue wisp', glyph: 'w', hp: 9, attack: 4, xp: 9, color: '#82bad0', ranged: true },
    sentinel: { name: 'Stone sentinel', glyph: 's', hp: 19, attack: 6, xp: 15, color: '#c08f70' },
    boss: { name: 'The Gale Warden', glyph: 'W', hp: 64, attack: 9, xp: 90, color: '#d5bb79', boss: true, ranged: true }
  };

  const ITEM_DATA = {
    tonic: { name: 'Redleaf tonic', type: 'potion', weight: 0.4, icon: '✚', detail: 'Restores 15 vitality', effect: 'heal', amount: 15 },
    ether: { name: 'Blueglass draught', type: 'potion', weight: 0.4, icon: '◉', detail: 'Restores 9 focus', effect: 'mana', amount: 9 },
    sword: { name: 'Ironbound blade', type: 'weapon', weight: 3.2, icon: '†', detail: '+3 force', attack: 3 },
    staff: { name: 'Ashwood wand', type: 'weapon', weight: 1.3, icon: 'ϟ', detail: '+2 force · +1 insight', attack: 2, insight: 1 },
    coat: { name: 'Northglass coat', type: 'armor', weight: 3.6, icon: '◇', detail: '+3 guard', defense: 3 },
    jerkin: { name: 'Harehide jerkin', type: 'armor', weight: 1.8, icon: '⬟', detail: '+1 guard', defense: 1 }
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const rand = (max) => Math.floor(Math.random() * max);
  const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const keyOf = (x, y) => `${x},${y}`;
  const tileAt = (x, y) => game?.map?.[y]?.[x] ?? 'wall';
  const isPassable = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS && tileAt(x, y) === 'floor';
  const uid = () => `item-${Date.now().toString(36)}-${(++itemCounter).toString(36)}`;

  function makeItem(kind) {
    return { id: uid(), kind, ...ITEM_DATA[kind] };
  }

  function addLog(message) {
    if (!game) return;
    game.log.unshift({ turn: game.turns, floor: game.floor, message });
    game.log = game.log.slice(0, 40);
    const status = $('#sr-status');
    if (status) status.textContent = message;
  }

  function newGame(classId) {
    const chosen = CLASS_DATA[classId] || CLASS_DATA.wayfarer;
    game = {
      version: 1,
      classId,
      className: chosen.name,
      turns: 0,
      floor: 1,
      level: 1,
      xp: 0,
      nextXp: 16,
      force: chosen.force,
      insight: chosen.insight,
      hp: chosen.hp,
      maxHp: chosen.hp,
      mp: chosen.mp,
      maxMp: chosen.mp,
      ward: 0,
      map: [],
      seen: [],
      player: { x: 0, y: 0 },
      stairs: null,
      traps: [],
      enemies: [],
      ground: [],
      inventory: [],
      equipment: { weapon: null, armor: null },
      log: [],
      ended: false
    };
    makeFloor(1);
    addLog(`${chosen.note} You follow the storm beneath the keep.`);
    addLog('The old road ends at a stair cut into black stone.');
    scrim.hidden = true;
    saveGame();
    renderAll();
  }

  function carveRoom(map, room) {
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) map[y][x] = 'floor';
    }
  }

  function carveCorridor(map, a, b) {
    const horizontalFirst = Math.random() < 0.5;
    const carveX = () => {
      const step = a.x <= b.x ? 1 : -1;
      for (let x = a.x; x !== b.x + step; x += step) map[a.y][x] = 'floor';
    };
    const carveY = () => {
      const step = a.y <= b.y ? 1 : -1;
      for (let y = a.y; y !== b.y + step; y += step) map[y][a.x] = 'floor';
    };
    if (horizontalFirst) { carveX(); carveY(); }
    else { carveY(); carveX(); }
  }

  function makeFloor(floor) {
    game.floor = floor;
    const map = Array.from({ length: ROWS }, () => Array(COLS).fill('wall'));
    const rooms = [];
    for (let tries = 0; tries < 110 && rooms.length < 8; tries++) {
      const room = { x: 1 + rand(COLS - 8), y: 1 + rand(ROWS - 6), w: 4 + rand(4), h: 3 + rand(3) };
      const overlaps = rooms.some((other) => room.x < other.x + other.w + 1 && room.x + room.w + 1 > other.x && room.y < other.y + other.h + 1 && room.y + room.h + 1 > other.y);
      if (overlaps) continue;
      carveRoom(map, room);
      const center = { x: Math.floor(room.x + room.w / 2), y: Math.floor(room.y + room.h / 2) };
      if (rooms.length) carveCorridor(map, rooms[rooms.length - 1].center, center);
      room.center = center;
      rooms.push(room);
    }
    if (rooms.length < 3) {
      const fallback = [
        { x: 2, y: 2, w: 6, h: 5 }, { x: 15, y: 2, w: 6, h: 5 }, { x: 8, y: 9, w: 7, h: 5 }
      ];
      fallback.forEach((room, i) => {
        carveRoom(map, room);
        room.center = { x: room.x + Math.floor(room.w / 2), y: room.y + Math.floor(room.h / 2) };
        if (i) carveCorridor(map, fallback[i - 1].center, room.center);
        rooms.push(room);
      });
    }

    game.map = map;
    game.seen = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
    game.player = { ...rooms[0].center };
    const finalFloor = floor === 4;
    game.stairs = finalFloor ? null : { ...rooms[rooms.length - 1].center };
    game.traps = [];
    game.ground = [];
    game.enemies = [];

    const taken = new Set([keyOf(game.player.x, game.player.y)]);
    if (game.stairs) taken.add(keyOf(game.stairs.x, game.stairs.y));
    const randomRoomSpot = (room, minDistance = 0) => {
      for (let tries = 0; tries < 80; tries++) {
        const spot = { x: room.x + rand(room.w), y: room.y + rand(room.h) };
        if (taken.has(keyOf(spot.x, spot.y)) || distance(spot, game.player) < minDistance) continue;
        taken.add(keyOf(spot.x, spot.y));
        return spot;
      }
      return null;
    };

    if (finalFloor) {
      const lair = rooms[rooms.length - 1];
      const bossSpot = randomRoomSpot(lair, 3) || { ...lair.center };
      game.enemies.push(makeEnemy('boss', bossSpot, floor));
    }
    const count = 4 + floor * 2;
    for (let i = 0; i < count; i++) {
      const room = rooms[1 + rand(Math.max(1, rooms.length - 1))] || rooms[0];
      const spot = randomRoomSpot(room, 2);
      if (!spot) continue;
      const kind = enemyKind(floor);
      game.enemies.push(makeEnemy(kind, spot, floor));
    }

    const trapCount = 1 + floor;
    for (let i = 0; i < trapCount; i++) {
      const room = rooms[1 + rand(Math.max(1, rooms.length - 1))] || rooms[0];
      const spot = randomRoomSpot(room, 2);
      if (spot) game.traps.push({ ...spot, revealed: false, damage: 3 + floor });
    }

    const lootCount = 5 + Math.floor(floor / 2);
    const available = Object.keys(ITEM_DATA);
    for (let i = 0; i < lootCount; i++) {
      const room = rooms[rand(rooms.length)];
      const spot = randomRoomSpot(room, 1);
      if (spot) game.ground.push({ ...spot, item: makeItem(available[rand(available.length)]) });
    }

    updateVisibility();
    if (floor > 1) addLog(`You reach ${FLOOR_NAMES[floor - 1]}. The air grows thin and sharp.`);
    if (finalFloor) addLog('A shape of wind and iron waits in the heart of the keep.');
  }

  function enemyKind(floor) {
    const pools = [
      ['rat', 'rat', 'draugr'],
      ['rat', 'draugr', 'draugr', 'wisp'],
      ['draugr', 'wisp', 'wisp', 'sentinel']
    ];
    return pools[Math.min(2, floor - 1)][rand(pools[Math.min(2, floor - 1)].length)];
  }

  function makeEnemy(kind, pos, floor) {
    const base = ENEMIES[kind];
    const scale = kind === 'boss' ? floor - 1 : Math.max(0, floor - 1);
    return { id: uid(), kind, name: base.name, glyph: base.glyph, hp: base.hp + scale * (kind === 'boss' ? 0 : 2), maxHp: base.hp + scale * (kind === 'boss' ? 0 : 2), attack: base.attack + (kind === 'boss' ? 0 : scale), xp: base.xp, color: base.color, ranged: !!base.ranged, boss: !!base.boss, x: pos.x, y: pos.y };
  }

  function lineOfSight(x0, y0, x1, y1) {
    let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    let dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    while (true) {
      if (x0 === x1 && y0 === y1) return true;
      const twice = 2 * error;
      if (twice >= dy) { error += dy; x0 += sx; }
      if (twice <= dx) { error += dx; y0 += sy; }
      if (x0 === x1 && y0 === y1) return true;
      if (tileAt(x0, y0) === 'wall') return false;
    }
  }

  function updateVisibility() {
    if (!game) return;
    visible = new Set();
    const radius = 7;
    for (let y = Math.max(0, game.player.y - radius); y <= Math.min(ROWS - 1, game.player.y + radius); y++) {
      for (let x = Math.max(0, game.player.x - radius); x <= Math.min(COLS - 1, game.player.x + radius); x++) {
        const dx = x - game.player.x, dy = y - game.player.y;
        if (dx * dx + dy * dy > radius * radius || !lineOfSight(game.player.x, game.player.y, x, y)) continue;
        visible.add(keyOf(x, y));
        game.seen[y][x] = true;
      }
    }
  }

  function getWeapon() { return game?.inventory.find((item) => item.id === game.equipment.weapon) || null; }
  function getArmor() { return game?.inventory.find((item) => item.id === game.equipment.armor) || null; }
  function totalWeight() { return game?.inventory.reduce((sum, item) => sum + item.weight, 0) || 0; }
  function carryLimit() { return 18 + (game?.force || 0) * 2; }
  function enemiesAt(x, y) { return game?.enemies.find((enemy) => enemy.x === x && enemy.y === y) || null; }
  function groundAtPlayer() { return game?.ground.filter((drop) => drop.x === game.player.x && drop.y === game.player.y) || []; }

  function drawTitleArt() {
    ctx.fillStyle = '#111713';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const n = (x * 17 + y * 29 + x * y * 3) % 7;
        const shade = 20 + n * 2;
        ctx.fillStyle = `rgb(${shade},${shade + 4},${shade + 1})`;
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
        ctx.strokeStyle = '#30382e';
        ctx.strokeRect(x * TILE + .5, y * TILE + .5, TILE - 1, TILE - 1);
      }
    }
    ctx.fillStyle = '#252c25';
    for (let x = 7; x <= 16; x++) ctx.fillRect(x * TILE, 3 * TILE, TILE, 9 * TILE);
    ctx.fillRect(6 * TILE, 4 * TILE, 12 * TILE, 7 * TILE);
    ctx.fillStyle = '#33382b';
    for (let x = 7; x <= 16; x++) ctx.fillRect(x * TILE, 2 * TILE, TILE, TILE);
    ctx.fillRect(6 * TILE, 3 * TILE, TILE, TILE);
    ctx.fillRect(17 * TILE, 3 * TILE, TILE, TILE);
    ctx.fillStyle = '#101613';
    ctx.fillRect(10 * TILE, 8 * TILE, 4 * TILE, 3 * TILE);
    ctx.fillStyle = '#ae9862';
    ctx.fillRect(11 * TILE, 9 * TILE, 2 * TILE, 2);
    ctx.fillStyle = '#d6c28f';
    ctx.font = '500 14px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('THE KEEP IS WAITING', canvas.width / 2, canvas.height - 35);
  }

  function drawMap() {
    if (!game) { drawTitleArt(); return; }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const posKey = keyOf(x, y);
        const known = game.seen[y][x];
        const lit = visible.has(posKey);
        const px = x * TILE, py = y * TILE;
        if (!known) {
          ctx.fillStyle = '#101411';
          ctx.fillRect(px, py, TILE, TILE);
          continue;
        }
        const wall = tileAt(x, y) === 'wall';
        const tint = lit ? 1 : 0.49;
        const noise = (x * 13 + y * 19 + (x * y) % 11) % 8;
        if (wall) {
          ctx.fillStyle = `rgb(${Math.floor((37 + noise) * tint)},${Math.floor((43 + noise) * tint)},${Math.floor((37 + noise / 2) * tint)})`;
          ctx.fillRect(px, py, TILE, TILE);
          ctx.fillStyle = `rgba(175,180,143,${lit ? 0.09 : 0.035})`;
          ctx.fillRect(px + 3, py + 4 + noise % 3, TILE - 6, 2);
          ctx.fillStyle = '#0b100d';
          ctx.fillRect(px, py + TILE - 2, TILE, 2);
          ctx.fillRect(px + TILE - 2, py, 2, TILE);
        } else {
          ctx.fillStyle = `rgb(${Math.floor((33 + noise) * tint)},${Math.floor((42 + noise) * tint)},${Math.floor((34 + noise / 2) * tint)})`;
          ctx.fillRect(px, py, TILE, TILE);
          ctx.fillStyle = `rgba(156,174,137,${lit ? 0.13 : 0.055})`;
          ctx.fillRect(px + 7 + noise % 12, py + 8 + noise % 13, 2, 2);
          ctx.strokeStyle = lit ? '#52604b' : '#384139';
          ctx.strokeRect(px + .5, py + .5, TILE - 1, TILE - 1);
        }
        if (lit) {
          const trap = game.traps.find((t) => t.x === x && t.y === y);
          if (trap && (trap.revealed || distance({ x, y }, game.player) <= 1)) drawTrap(px, py);
          if (game.stairs && game.stairs.x === x && game.stairs.y === y) drawStairs(px, py);
          const drop = game.ground.find((item) => item.x === x && item.y === y);
          if (drop) drawLoot(px, py);
          const enemy = enemiesAt(x, y);
          if (enemy) drawEnemy(px, py, enemy);
        }
      }
    }
    drawPlayer(game.player.x * TILE, game.player.y * TILE);
    if (game.ward > 0) {
      ctx.strokeStyle = '#c3a6dc';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(game.player.x * TILE + TILE / 2, game.player.y * TILE + TILE / 2, 14 + (3 - game.ward), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawPlayer(px, py) {
    ctx.fillStyle = '#121714';
    ctx.beginPath(); ctx.ellipse(px + 16, py + 25, 10, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ac9160';
    ctx.fillRect(px + 12, py + 7, 9, 8);
    ctx.fillStyle = '#d9c88f';
    ctx.fillRect(px + 10, py + 5, 12, 3);
    ctx.fillStyle = '#657c68';
    ctx.fillRect(px + 9, py + 15, 14, 12);
    ctx.fillStyle = '#d0bd83';
    ctx.fillRect(px + 13, py + 16, 6, 8);
    ctx.fillStyle = '#81927a';
    ctx.fillRect(px + 7, py + 18, 3, 8);
    ctx.fillStyle = '#e8d99e';
    ctx.fillRect(px + 15, py + 10, 2, 2);
  }

  function drawEnemy(px, py, enemy) {
    const centerX = px + 16, centerY = py + 16;
    ctx.fillStyle = '#111613';
    ctx.beginPath(); ctx.ellipse(centerX, py + 26, 10, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = enemy.color;
    if (enemy.boss) {
      ctx.beginPath(); ctx.moveTo(centerX, py + 3); ctx.lineTo(px + 28, py + 12); ctx.lineTo(px + 25, py + 27); ctx.lineTo(px + 16, py + 31); ctx.lineTo(px + 7, py + 27); ctx.lineTo(px + 4, py + 12); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#463c27'; ctx.fillRect(px + 10, py + 9, 12, 13);
    } else {
      ctx.beginPath(); ctx.arc(centerX, centerY, 10, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#f0dfaa';
    ctx.font = enemy.boss ? 'bold 15px Georgia,serif' : 'bold 12px Georgia,serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(enemy.glyph, centerX, centerY + 1);
    ctx.textBaseline = 'alphabetic';
    if (enemy.hp < enemy.maxHp) {
      ctx.fillStyle = '#111'; ctx.fillRect(px + 5, py + 2, 22, 3);
      ctx.fillStyle = '#c5776b'; ctx.fillRect(px + 5, py + 2, 22 * enemy.hp / enemy.maxHp, 3);
    }
  }

  function drawStairs(px, py) {
    ctx.fillStyle = '#8a7952'; ctx.fillRect(px + 7, py + 8, 18, 17);
    ctx.fillStyle = '#141914'; ctx.fillRect(px + 10, py + 10, 12, 12);
    ctx.fillStyle = '#d6c58d';
    for (let i = 0; i < 4; i++) ctx.fillRect(px + 11 + i, py + 12 + i * 2, 9 - i, 2);
    ctx.fillStyle = '#f0dfa6'; ctx.fillRect(px + 14, py + 5, 4, 2);
  }

  function drawLoot(px, py) {
    ctx.fillStyle = '#9dc0aa';
    ctx.fillRect(px + 12, py + 11, 8, 10);
    ctx.fillStyle = '#d6c88e';
    ctx.fillRect(px + 14, py + 8, 4, 3);
    ctx.fillStyle = '#dfdfb1';
    ctx.fillRect(px + 14, py + 13, 4, 4);
  }

  function drawTrap(px, py) {
    ctx.strokeStyle = '#ca8171'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(px + 10, py + 10); ctx.lineTo(px + 22, py + 22); ctx.moveTo(px + 22, py + 10); ctx.lineTo(px + 10, py + 22); ctx.stroke();
  }

  function renderLog() {
    const list = $('#journal');
    list.replaceChildren();
    if (!game) return;
    for (const entry of game.log.slice(0, 7)) {
      const li = document.createElement('li');
      const time = document.createElement('span');
      time.className = 'journal-time';
      time.textContent = `D${entry.floor}·${String(entry.turn).padStart(2, '0')}`;
      const text = document.createElement('span');
      text.textContent = entry.message;
      li.append(time, text);
      list.append(li);
    }
  }

  function renderInventory() {
    const list = $('#inventory-list');
    list.replaceChildren();
    $('#weight-label').textContent = `${totalWeight().toFixed(1)} / ${carryLimit()} kg`;
    if (!game || game.inventory.length === 0) {
      const empty = document.createElement('p'); empty.className = 'empty-note'; empty.textContent = 'Nothing carried yet.'; list.append(empty);
    } else {
      game.inventory.forEach((item) => {
        const row = document.createElement('div'); row.className = 'item-row';
        const icon = document.createElement('span'); icon.className = 'item-icon'; icon.textContent = item.icon;
        const copy = document.createElement('span'); copy.className = 'item-copy';
        const name = document.createElement('strong'); name.textContent = item.name;
        const detail = document.createElement('small'); detail.textContent = `${item.detail} · ${item.weight.toFixed(1)} kg`;
        copy.append(name, detail);
        const actions = document.createElement('span'); actions.className = 'item-actions';
        const action = document.createElement('button'); action.type = 'button'; action.className = 'item-action'; action.dataset.itemId = item.id;
        if (item.type === 'weapon' || item.type === 'armor') {
          const slot = item.type === 'weapon' ? 'weapon' : 'armor';
          const equipped = game.equipment[slot] === item.id;
          action.dataset.itemAction = 'equip'; action.textContent = equipped ? 'Worn' : 'Wear'; action.disabled = equipped;
        } else {
          action.dataset.itemAction = 'use'; action.textContent = 'Use';
        }
        const drop = document.createElement('button'); drop.type = 'button'; drop.className = 'item-action'; drop.textContent = 'Drop'; drop.dataset.itemId = item.id; drop.dataset.itemAction = 'drop';
        actions.append(action, drop);
        row.append(icon, copy, actions); list.append(row);
      });
    }

    const equipment = $('#equipment-list');
    equipment.replaceChildren();
    if (!game) {
      const empty = document.createElement('p'); empty.className = 'empty-note'; empty.textContent = 'Your hands are empty.'; equipment.append(empty);
    } else {
      for (const [slot, label] of [['weapon', 'Weapon'], ['armor', 'Armor']]) {
        const item = game.inventory.find((candidate) => candidate.id === game.equipment[slot]);
        const block = document.createElement('div'); block.className = 'equipment-slot';
        const slotLabel = document.createElement('span'); slotLabel.textContent = label;
        const itemName = document.createElement('strong'); itemName.textContent = item?.name || 'None';
        block.append(slotLabel, itemName); equipment.append(block);
      }
    }

    const ground = $('#ground-pickup');
    const nearby = game ? groundAtPlayer() : [];
    ground.hidden = nearby.length === 0;
    ground.replaceChildren();
    if (nearby.length) {
      const note = document.createElement('p'); note.textContent = `At your feet: ${nearby.map((entry) => entry.item.name).join(', ')}`;
      const button = document.createElement('button'); button.type = 'button'; button.textContent = `Gather ${nearby.length > 1 ? 'all' : 'item'} · G`;
      button.addEventListener('click', gatherItems);
      ground.append(note, button);
    }
  }

  function renderUI() {
    const active = !!game;
    $('#class-label').textContent = active ? game.className : 'Awaiting a traveler';
    $('#character-name').textContent = active ? game.className : 'The Wayfarer';
    $('#level-badge').textContent = active ? `LV ${game.level}` : '—';
    $('#health-label').textContent = active ? `${game.hp} / ${game.maxHp}` : '— / —';
    $('#mana-label').textContent = active ? `${game.mp} / ${game.maxMp}` : '— / —';
    $('#xp-label').textContent = active ? `${game.xp} / ${game.nextXp}` : '—';
    $('#health-meter').style.width = active ? `${clamp(game.hp / game.maxHp * 100, 0, 100)}%` : '0%';
    $('#mana-meter').style.width = active ? `${clamp(game.mp / game.maxMp * 100, 0, 100)}%` : '0%';
    $('#xp-meter').style.width = active ? `${clamp(game.xp / game.nextXp * 100, 0, 100)}%` : '0%';
    $('#strength-stat').textContent = active ? `${game.force + (getWeapon()?.attack || 0)}` : '—';
    $('#int-stat').textContent = active ? `${game.insight + (getWeapon()?.insight || 0)}` : '—';
    $('#guard-stat').textContent = active ? `${1 + (getArmor()?.defense || 0) + (game.ward > 0 ? 3 : 0)}` : '—';
    $('#floor-label').textContent = active ? FLOOR_NAMES[game.floor - 1] : 'The road to the keep';
    $('#turn-label').textContent = active ? `DAY ${game.floor} · TURN ${String(game.turns).padStart(3, '0')}` : 'A new tale awaits';
    $('#objective-text').textContent = active ? (game.floor === 4 ? 'Defeat the Gale Warden and still the wind at its heart.' : 'Find the stairway and descend farther into the keep.') : 'Choose a calling and follow the storm to the keep.';
    document.querySelectorAll('.floor-progress i').forEach((bar, index) => bar.classList.toggle('active', active && index < game.floor));
    $('#descend-button').disabled = !active || !game.stairs || game.player.x !== game.stairs.x || game.player.y !== game.stairs.y;
    $('#descend-button').innerHTML = game?.floor === 3 && !$('#descend-button').disabled ? 'Face the heart of the keep <span>↓</span>' : 'Descend to the next floor <span>↓</span>';
    const spells = { frost: true, mend: true, storm: active && game.level >= 2, ward: active && game.level >= 3 };
    document.querySelectorAll('.spell-button').forEach((button) => {
      const available = spells[button.dataset.spell];
      button.classList.toggle('locked', !available);
      button.disabled = !active || !available || game.ended;
      const small = button.querySelector('small');
      if (small) small.textContent = available ? ({ frost: '4 mana', mend: '5 mana', storm: '8 mana', ward: '6 mana' })[button.dataset.spell] : ({ storm: 'Learn at level 2', ward: 'Learn at level 3' })[button.dataset.spell];
    });
    $('#spell-hint').textContent = active ? `${game.mp} focus · +1 restored each turn` : 'Magic returns with each turn';
    renderInventory();
    renderLog();
  }

  function renderAll() {
    drawMap();
    renderUI();
  }

  function saveGame() {
    if (!game || game.ended) return;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(game)); } catch (_) { /* Storage may be disabled; the current run remains playable. */ }
  }

  function loadGame() {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (!saved || saved.version !== 1 || !Array.isArray(saved.map) || saved.map.length !== ROWS || !saved.player) return null;
      return saved;
    } catch (_) { return null; }
  }

  function openDialog(title, description, actions) {
    dialogContent.replaceChildren();
    const wrap = document.createElement('div'); wrap.className = 'dialog-content';
    const eyebrow = document.createElement('p'); eyebrow.className = 'eyebrow'; eyebrow.textContent = 'The Windglass Keep';
    const heading = document.createElement('h2'); heading.textContent = title;
    const paragraph = document.createElement('p'); paragraph.textContent = description;
    const actionRow = document.createElement('div'); actionRow.className = 'dialog-actions';
    wrap.append(eyebrow, heading, paragraph, actionRow);
    actions.forEach(({ label, callback, secondary }) => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      if (secondary) button.className = 'secondary';
      button.addEventListener('click', () => { dialog.close(); callback?.(); });
      actionRow.append(button);
    });
    dialogContent.append(wrap);
    if (!dialog.open) dialog.showModal();
  }

  function setTitle() {
    clearAutoWalk();
    game = null;
    scrim.hidden = false;
    $('#continue-button').hidden = !loadGame();
    renderAll();
  }

  function clearAutoWalk() {
    autoPath = [];
    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = 0;
  }

  function playerAttack(enemy) {
    const weapon = getWeapon();
    const damage = Math.max(1, game.force + (weapon?.attack || 0) + rand(3));
    enemy.hp -= damage;
    addLog(`You strike the ${enemy.name.toLowerCase()} for ${damage}.`);
    if (enemy.hp <= 0) killEnemy(enemy);
  }

  function killEnemy(enemy) {
    game.enemies = game.enemies.filter((candidate) => candidate.id !== enemy.id);
    addLog(`${enemy.name} falls. You gain ${enemy.xp} experience.`);
    gainXp(enemy.xp);
    if (Math.random() < 0.22) {
      const kind = Math.random() < 0.6 ? 'tonic' : 'ether';
      game.ground.push({ x: enemy.x, y: enemy.y, item: makeItem(kind) });
      addLog('Something useful tumbles from the fallen foe.');
    }
    if (enemy.boss) finishGame(true);
  }

  function gainXp(amount) {
    game.xp += amount;
    while (game.xp >= game.nextXp && !game.ended) {
      game.xp -= game.nextXp;
      game.level += 1;
      game.nextXp = 16 + (game.level - 1) * 12;
      game.maxHp += 5;
      game.maxMp += 3;
      game.hp = Math.min(game.maxHp, game.hp + 7);
      game.mp = Math.min(game.maxMp, game.mp + 5);
      if (game.level % 2 === 0) game.force += 1;
      else game.insight += 1;
      addLog(`Level ${game.level}! Your strength and magic deepen.`);
      if (game.level === 2) addLog('You learn Storm Lash.');
      if (game.level === 3) addLog('You learn Wind Ward.');
    }
  }

  function movePlayer(dx, dy) {
    if (!game || game.ended) return 'blocked';
    const nx = game.player.x + dx, ny = game.player.y + dy;
    const enemy = enemiesAt(nx, ny);
    if (enemy) {
      playerAttack(enemy);
      finishPlayerTurn();
      return 'combat';
    }
    if (!isPassable(nx, ny)) return 'blocked';
    game.player = { x: nx, y: ny };
    game.turns += 1;
    const trap = game.traps.find((candidate) => candidate.x === nx && candidate.y === ny && !candidate.revealed);
    if (trap) {
      trap.revealed = true;
      game.hp -= trap.damage;
      addLog(`A hidden rune-trap flares. You take ${trap.damage} damage.`);
      if (game.hp <= 0) { finishGame(false); renderAll(); return 'moved'; }
    }
    updateVisibility();
    finishEnemyTurn();
    renderAll();
    return 'moved';
  }

  function finishPlayerTurn() {
    game.turns += 1;
    updateVisibility();
    finishEnemyTurn();
    renderAll();
  }

  function finishEnemyTurn() {
    if (!game || game.ended) return;
    for (const enemy of [...game.enemies]) {
      if (game.ended || enemy.hp <= 0) break;
      const d = distance(enemy, game.player);
      const dx = Math.abs(enemy.x - game.player.x), dy = Math.abs(enemy.y - game.player.y);
      if (enemy.ranged && d <= 5 && (dx === 0 || dy === 0 || d <= 2)) {
        hitPlayer(enemy, true);
        continue;
      }
      if (d === 1) {
        hitPlayer(enemy, false);
        continue;
      }
      if (d > 8) continue;
      const steps = [
        { x: enemy.x + Math.sign(game.player.x - enemy.x), y: enemy.y },
        { x: enemy.x, y: enemy.y + Math.sign(game.player.y - enemy.y) },
        { x: enemy.x + (Math.random() < .5 ? -1 : 1), y: enemy.y },
        { x: enemy.x, y: enemy.y + (Math.random() < .5 ? -1 : 1) }
      ];
      const next = steps.filter((spot) => isPassable(spot.x, spot.y) && !enemiesAt(spot.x, spot.y) && !(spot.x === game.player.x && spot.y === game.player.y))
        .sort((a, b) => distance(a, game.player) - distance(b, game.player))[0];
      if (next) { enemy.x = next.x; enemy.y = next.y; }
    }
    if (!game.ended) {
      if (game.mp < game.maxMp) game.mp += 1;
      if (game.ward > 0) game.ward -= 1;
      if (game.hp <= 0) finishGame(false);
    }
    updateVisibility();
    saveGame();
  }

  function hitPlayer(enemy, ranged) {
    const armor = getArmor();
    const defense = 1 + (armor?.defense || 0) + (game.ward > 0 ? 3 : 0);
    const damage = Math.max(1, enemy.attack + rand(2) - defense);
    game.hp -= damage;
    addLog(`${enemy.name} ${ranged ? 'casts into' : 'strikes'} you for ${damage}.`);
    if (game.hp <= 0) finishGame(false);
  }

  function castSpell(spell) {
    if (!game || game.ended) return;
    const costs = { frost: 4, mend: 5, storm: 8, ward: 6 };
    if ((spell === 'storm' && game.level < 2) || (spell === 'ward' && game.level < 3)) {
      addLog('That spell is not yet in your book.'); renderAll(); return;
    }
    const cost = costs[spell];
    if (game.mp < cost) { addLog('Your focus is too low.'); renderAll(); return; }
    if (spell === 'mend' && game.hp === game.maxHp) { addLog('You are already at full vitality.'); renderAll(); return; }
    const targets = game.enemies.filter((enemy) => visible.has(keyOf(enemy.x, enemy.y)) && distance(enemy, game.player) <= 7).sort((a, b) => distance(a, game.player) - distance(b, game.player));
    if ((spell === 'frost' || spell === 'storm') && !targets.length) { addLog('No visible foe answers the spell.'); renderAll(); return; }
    game.mp -= cost;
    if (spell === 'frost') {
      const target = targets[0];
      const damage = 6 + game.insight * 2 + rand(4);
      target.hp -= damage;
      addLog(`Frost Dart strikes ${target.name.toLowerCase()} for ${damage}.`);
      if (target.hp <= 0) killEnemy(target);
    } else if (spell === 'mend') {
      const restored = Math.min(game.maxHp - game.hp, 13 + game.insight * 2);
      game.hp += restored;
      addLog(`Mending light restores ${restored} vitality.`);
    } else if (spell === 'storm') {
      const target = targets[0];
      const nearby = targets.filter((enemy) => distance(enemy, target) <= 2);
      for (const enemy of nearby) {
        const damage = enemy === target ? 8 + game.insight * 2 + rand(4) : 4 + game.insight + rand(3);
        enemy.hp -= damage;
        addLog(`Storm Lash catches ${enemy.name.toLowerCase()} for ${damage}.`);
        if (enemy.hp <= 0) killEnemy(enemy);
        if (game.ended) break;
      }
    } else if (spell === 'ward') {
      game.ward = 3;
      addLog('Wind Ward circles you. The next three turns will be safer.');
    }
    if (!game.ended) finishPlayerTurn();
  }

  function gatherItems() {
    if (!game || game.ended) return;
    const drops = groundAtPlayer();
    if (!drops.length) { addLog('There is nothing at your feet.'); renderAll(); return; }
    let took = 0;
    for (const drop of drops) {
      if (totalWeight() + drop.item.weight > carryLimit()) {
        addLog('Your satchel is too heavy to carry more.');
        break;
      }
      game.inventory.push(drop.item);
      game.ground = game.ground.filter((entry) => entry !== drop);
      addLog(`You gather ${drop.item.name}.`);
      took++;
    }
    if (took) finishPlayerTurn();
    else renderAll();
  }

  function useItem(itemId, action) {
    if (!game || game.ended) return;
    const item = game.inventory.find((candidate) => candidate.id === itemId);
    if (!item) return;
    if (action === 'equip') {
      const slot = item.type === 'weapon' ? 'weapon' : 'armor';
      if (game.equipment[slot] === item.id) return;
      game.equipment[slot] = item.id;
      addLog(`You ready the ${item.name}.`);
      finishPlayerTurn();
      return;
    }
    if (action === 'drop') {
      game.inventory = game.inventory.filter((candidate) => candidate.id !== item.id);
      if (game.equipment.weapon === item.id) game.equipment.weapon = null;
      if (game.equipment.armor === item.id) game.equipment.armor = null;
      game.ground.push({ x: game.player.x, y: game.player.y, item });
      addLog(`You leave the ${item.name} on the floor.`);
      finishPlayerTurn();
      return;
    }
    if (action === 'use' && item.type === 'potion') {
      if (item.effect === 'heal' && game.hp === game.maxHp) { addLog('You are already at full vitality.'); renderAll(); return; }
      if (item.effect === 'mana' && game.mp === game.maxMp) { addLog('Your focus is already full.'); renderAll(); return; }
      if (item.effect === 'heal') {
        const restored = Math.min(game.maxHp - game.hp, item.amount);
        game.hp += restored; addLog(`${item.name} restores ${restored} vitality.`);
      } else {
        const restored = Math.min(game.maxMp - game.mp, item.amount);
        game.mp += restored; addLog(`${item.name} restores ${restored} focus.`);
      }
      game.inventory = game.inventory.filter((candidate) => candidate.id !== item.id);
      finishPlayerTurn();
    }
  }

  function descend() {
    if (!game || !game.stairs || game.player.x !== game.stairs.x || game.player.y !== game.stairs.y) return;
    if (game.floor >= 4) return;
    makeFloor(game.floor + 1);
    saveGame();
    renderAll();
  }

  function pathTo(targetX, targetY) {
    if (!game || targetX < 0 || targetY < 0 || targetX >= COLS || targetY >= ROWS) return [];
    const targetEnemy = enemiesAt(targetX, targetY);
    let destinations = [{ x: targetX, y: targetY }];
    if (targetEnemy) destinations = [{ x: targetX - 1, y: targetY }, { x: targetX + 1, y: targetY }, { x: targetX, y: targetY - 1 }, { x: targetX, y: targetY + 1 }].filter((spot) => isPassable(spot.x, spot.y));
    const destKeys = new Set(destinations.map((spot) => keyOf(spot.x, spot.y)));
    const startKey = keyOf(game.player.x, game.player.y);
    const queue = [{ x: game.player.x, y: game.player.y }];
    const parents = new Map([[startKey, null]]);
    let found = null;
    while (queue.length) {
      const current = queue.shift();
      const currentKey = keyOf(current.x, current.y);
      if (destKeys.has(currentKey)) { found = currentKey; break; }
      for (const next of [{ x: current.x + 1, y: current.y }, { x: current.x - 1, y: current.y }, { x: current.x, y: current.y + 1 }, { x: current.x, y: current.y - 1 }]) {
        const nextKey = keyOf(next.x, next.y);
        if (parents.has(nextKey) || !isPassable(next.x, next.y) || (enemiesAt(next.x, next.y) && nextKey !== keyOf(targetX, targetY))) continue;
        parents.set(nextKey, currentKey);
        queue.push(next);
      }
    }
    if (!found) return [];
    const path = [];
    while (found && found !== startKey) {
      const [x, y] = found.split(',').map(Number);
      path.unshift({ x, y });
      found = parents.get(found);
    }
    return path;
  }

  function clickMove(event) {
    if (!game || game.ended || dialog.open) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / rect.width * COLS);
    const y = Math.floor((event.clientY - rect.top) / rect.height * ROWS);
    if (!game.seen[y]?.[x]) return;
    clearAutoWalk();
    if (distance(game.player, { x, y }) === 1) { movePlayer(x - game.player.x, y - game.player.y); return; }
    autoPath = pathTo(x, y);
    autoStep();
  }

  function autoStep() {
    if (!autoPath.length || !game || game.ended || dialog.open) { clearAutoWalk(); return; }
    const next = autoPath.shift();
    const result = movePlayer(next.x - game.player.x, next.y - game.player.y);
    if (result !== 'moved' || (game.stairs && game.player.x === game.stairs.x && game.player.y === game.stairs.y) || groundAtPlayer().length) {
      clearAutoWalk(); return;
    }
    autoTimer = setTimeout(autoStep, 115);
  }

  function finishGame(won) {
    if (!game || game.ended) return;
    game.ended = true;
    try { localStorage.removeItem(SAVE_KEY); } catch (_) { /* Storage may be disabled. */ }
    clearAutoWalk();
    if (won) {
      addLog('The gale breaks. For the first time in a century, the keep is still.');
      openDialog('The wind falls silent', 'The Gale Warden dissolves into pale sparks. Dawn reaches the valley, and the road home opens beneath a clear sky.', [
        { label: 'Begin another journey', callback: setTitle }
      ]);
    } else {
      addLog('The keep claims another traveler.');
      openDialog('The storm takes you', 'The old stones close over your trail. Start a new journey when you are ready to brave the keep again.', [
        { label: 'Try again', callback: setTitle }
      ]);
    }
  }

  document.querySelectorAll('.class-choice').forEach((button) => button.addEventListener('click', () => newGame(button.dataset.class)));
  $('#continue-button').addEventListener('click', () => {
    const saved = loadGame();
    if (!saved) { $('#continue-button').hidden = true; return; }
    game = saved;
    itemCounter = game.inventory.length + game.ground.length + 1;
    scrim.hidden = true;
    updateVisibility();
    addLog('You return to the trail where you left it.');
    renderAll();
    saveGame();
  });
  $('#descend-button').addEventListener('click', descend);
  $('#menu-button').addEventListener('click', () => {
    if (!game) { $('#continue-button').hidden = !loadGame(); scrim.hidden = false; return; }
    openDialog('Take a breath', 'Your progress is saved after every action. The keep will wait here.', [
      { label: 'Return to the keep', callback: () => {} },
      { label: 'Save & return to title', secondary: true, callback: setTitle }
    ]);
  });
  document.querySelectorAll('.spell-button').forEach((button) => button.addEventListener('click', () => castSpell(button.dataset.spell)));
  $('#inventory-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-item-action]');
    if (button) useItem(button.dataset.itemId, button.dataset.itemAction);
  });
  canvas.addEventListener('click', clickMove);
  document.addEventListener('keydown', (event) => {
    if (dialog.open) { if (event.key === 'Escape') dialog.close(); return; }
    if (!game || game.ended || scrim.hidden === false) return;
    const key = event.key.toLowerCase();
    const movement = {
      arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1],
      arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0]
    }[key];
    if (movement) { event.preventDefault(); clearAutoWalk(); movePlayer(...movement); return; }
    if (key === 'g') { clearAutoWalk(); gatherItems(); return; }
    if (key === 'e') { clearAutoWalk(); descend(); return; }
    if (key === '1') { clearAutoWalk(); castSpell('frost'); return; }
    if (key === '2') { clearAutoWalk(); castSpell('mend'); return; }
    if (key === '3') { clearAutoWalk(); castSpell('storm'); return; }
    if (key === '4') { clearAutoWalk(); castSpell('ward'); return; }
    if (key === 'i') { $('.inventory-card').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    if (key === 'escape') { $('#menu-button').click(); }
  });

  $('#continue-button').hidden = !loadGame();
  renderAll();
})();

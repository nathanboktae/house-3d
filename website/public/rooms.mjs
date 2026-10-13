import {confirmedRooms} from './room-map.mjs?v=hallway-garage1';

export const MAX_ROOMS = 32;
export const MAX_VERTICES = 16;
export const ROOM_STORAGE_KEY = 'house-live-rooms-v2';
export const LEGACY_STORAGE_KEY = 'house-live-rooms-v1';
export const defaults = confirmedRooms;

export function footprintOf(room) {
  return room.footprint || [
    [room.min[0], room.min[2]], [room.max[0], room.min[2]],
    [room.max[0], room.max[2]], [room.min[0], room.max[2]],
  ];
}

export function pointInFootprint(point, footprint) {
  let inside = false;
  for (let i = 0, j = footprint.length - 1; i < footprint.length; j = i++) {
    const [xi, zi] = footprint[i], [xj, zj] = footprint[j];
    if ((zi > point[1]) !== (zj > point[1]) && point[0] < (xj - xi) * (point[1] - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function floorOf(room) {
  return room.floor || (room.max[1] <= -.15 ? 'lower' : room.min[1] >= -.15 ? 'upper' : 'both');
}

export function visibleOnFloor(room, view, labels = false) {
  const floor = floorOf(room);
  // All-floors view shows upper labels, avoiding labels for rooms obscured underneath.
  return view === 'all' ? (!labels || floor !== 'lower') : floor === view || floor === 'both';
}

export function validateRooms(rooms) {
  if (!Array.isArray(rooms) || rooms.length > MAX_ROOMS) throw Error(`Use at most ${MAX_ROOMS} rooms.`);
  const ids = new Set();
  for (const r of rooms) {
    if (typeof r.id !== 'string' || !r.id || ids.has(r.id) || typeof r.name !== 'string' || !r.name.trim() || r.name.length > 60) throw Error('Each room needs a unique ID and a name.');
    ids.add(r.id);
    if (![r.min, r.max].every(v => Array.isArray(v) && v.length === 3 && v.every(n => Number.isFinite(n) && Math.abs(n) < 1000)) || r.min.some((n, i) => n >= r.max[i])) throw Error('Every minimum must be smaller than its maximum.');
    if (!Array.isArray(r.entities) || !r.entities.every(e => typeof e === 'string' && /^(light|switch)\.[a-z0-9_]+$/.test(e))) throw Error('Map only light or switch entity IDs.');
    if (!Number.isFinite(r.demo) || r.demo < 0 || r.demo > 1) throw Error('Invalid demo brightness.');
    if (r.floor !== undefined && !['upper', 'lower', 'both'].includes(r.floor)) throw Error('Invalid floor.');
    if (r.references !== undefined && (!Array.isArray(r.references) || !r.references.every(s => typeof s === 'string' && s.length < 30))) throw Error('Invalid room references.');
    if (r.labelPosition !== undefined && (!Array.isArray(r.labelPosition) || r.labelPosition.length !== 3 || !r.labelPosition.every(Number.isFinite))) throw Error('Invalid label position.');
    if (r.footprint !== undefined) {
      const p = r.footprint;
      if (!Array.isArray(p) || p.length < 3 || p.length > MAX_VERTICES || !p.every(v => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite))) throw Error(`Footprints need 3–${MAX_VERTICES} valid points.`);
      if (!p.every(([x, z]) => x >= r.min[0] - 1e-5 && x <= r.max[0] + 1e-5 && z >= r.min[2] - 1e-5 && z <= r.max[2] + 1e-5)) throw Error('Footprint must stay within room bounds.');
      const area = p.reduce((sum, [x, z], i) => { const next = p[(i + 1) % p.length]; return sum + x * next[1] - next[0] * z; }, 0);
      if (Math.abs(area) < 1e-6) throw Error('Footprint has no area.');
    }
  }
  return rooms;
}

export function resizeRoom(room, min, max) {
  const next = structuredClone(room);
  const scale = (value, axis) => min[axis] + (value - room.min[axis]) * (max[axis] - min[axis]) / (room.max[axis] - room.min[axis]);
  if (room.footprint) next.footprint = room.footprint.map(([x, z]) => [scale(x, 0), scale(z, 2)]);
  if (room.labelPosition) next.labelPosition = room.labelPosition.map((v, axis) => scale(v, axis));
  next.min = [...min]; next.max = [...max];
  validateRooms([next]);
  return next;
}

export function loadRoomMap(storage) {
  const current = storage.getItem(ROOM_STORAGE_KEY);
  if (current !== null) return {rooms: validateRooms(JSON.parse(current)), migrated: false, preserved: false};
  const legacy = storage.getItem(LEGACY_STORAGE_KEY);
  if (legacy !== null) {
    const rooms = validateRooms(JSON.parse(legacy));
    const originals = [
      ['kitchen', 'Kitchen · draft', [7, -.15, -7.5], [12.2, 5.8, -3]],
      ['living', 'Living room · draft', [3.5, -.15, -7.5], [7, 5.8, -2.4]],
      ['bedrooms', 'Bedrooms · draft', [-3.4, -.15, -2.4], [7.5, 5.8, 2.7]],
    ];
    const isDraft = rooms.length === 3 && originals.every(([id, name, min, max]) => rooms.some(r => r.id === id && r.name === name && r.entities.length === 0 && !r.footprint && JSON.stringify(r.min) === JSON.stringify(min) && JSON.stringify(r.max) === JSON.stringify(max)));
    if (!isDraft) return {rooms, migrated: false, preserved: true};
  }
  return {rooms: structuredClone(defaults), migrated: true, preserved: false};
}

export function roomState(room, mode, snapshot) {
  if (mode === 'demo') return {level: room.demo, label: room.demo > 0 ? 'Demo · on' : 'Demo · off'};
  if (!room.entities.length) return {level: null, label: 'No smart lights mapped'};
  if (snapshot.status !== 'connected') return {level: null, label: 'Connection unavailable'};
  const entities = new Map(snapshot.entities.map(e => [e.id, e]));
  let level = 0, unknown = false;
  for (const id of room.entities) {
    const e = entities.get(id);
    if (!e || !['on', 'off'].includes(e.state)) { unknown = true; continue; }
    if (e.state === 'on') level = Math.max(level, typeof e.brightness === 'number' ? Math.max(.01, Math.min(1, e.brightness / 255)) : 1);
  }
  return level > 0 ? {level, label: unknown ? 'On · some states unknown' : 'On'} : unknown ? {level: null, label: 'State unavailable'} : {level: 0, label: 'Off'};
}

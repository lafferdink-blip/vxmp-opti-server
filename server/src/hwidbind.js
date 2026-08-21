import db, { dbKind } from './db.js';

// Liaison compte Discord ↔ HWID (anti-partage de l'app).
// Postgres/SQLite : table hwid_binds. Fallback JSON : mémoire (non persistant).
const memoryBinds = new Map();
let tableReady = false;

async function ensureTable() {
  if (tableReady || dbKind === 'json') return;
  if (dbKind === 'postgres') {
    await db.exec(`CREATE TABLE IF NOT EXISTS hwid_binds (
      id SERIAL PRIMARY KEY,
      discord_id TEXT UNIQUE NOT NULL,
      hwid TEXT NOT NULL,
      device_name TEXT,
      bound_at BIGINT NOT NULL,
      last_seen BIGINT
    )`);
  } else {
    db.exec(`CREATE TABLE IF NOT EXISTS hwid_binds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT UNIQUE NOT NULL,
      hwid TEXT NOT NULL,
      device_name TEXT,
      bound_at INTEGER NOT NULL,
      last_seen INTEGER
    )`);
  }
  tableReady = true;
}

export async function getBind(discordId) {
  const id = String(discordId);
  if (dbKind === 'json') return memoryBinds.get(id);
  await ensureTable();
  return await db.prepare('SELECT * FROM hwid_binds WHERE discord_id = ?').get(id);
}

// Lie le compte à un HWID. Refuse si déjà lié à une autre machine.
export async function bindHwid(discordId, hwid, deviceName) {
  const id = String(discordId);
  const fp = String(hwid).toUpperCase();
  const now = Date.now();
  const existing = await getBind(id);
  if (!existing) {
    if (dbKind === 'json') {
      memoryBinds.set(id, { discord_id: id, hwid: fp, device_name: deviceName || null, bound_at: now, last_seen: now });
    } else {
      await db.prepare('INSERT INTO hwid_binds (discord_id, hwid, device_name, bound_at, last_seen) VALUES (?, ?, ?, ?, ?)')
        .run(id, fp, deviceName || null, now, now);
    }
    return { ok: true, bound: true };
  }
  if (String(existing.hwid).toUpperCase() !== fp) {
    return { ok: false, error: 'hwid_mismatch', detail: 'App déjà liée à un autre PC.' };
  }
  await touch(id, now);
  return { ok: true, bound: true };
}

// Vérifie que le HWID correspond. unbound=true si pas encore lié.
export async function checkHwid(discordId, hwid) {
  const id = String(discordId);
  const fp = String(hwid).toUpperCase();
  const existing = await getBind(id);
  if (!existing) return { ok: true, unbound: true };
  if (String(existing.hwid).toUpperCase() !== fp) {
    return { ok: false, error: 'hwid_mismatch', detail: 'App liée à un autre PC.' };
  }
  await touch(id, Date.now());
  return { ok: true };
}

// Délie le compte (changement de PC autorisé au prochain lancement).
export async function unbindHwid(discordId) {
  const id = String(discordId);
  if (dbKind === 'json') return memoryBinds.delete(id) ? 1 : 0;
  await ensureTable();
  const r = await db.prepare('DELETE FROM hwid_binds WHERE discord_id = ?').run(id);
  return r.changes || 0;
}

async function touch(id, now) {
  if (dbKind === 'json') {
    const b = memoryBinds.get(id);
    if (b) b.last_seen = now;
    return;
  }
  await db.prepare('UPDATE hwid_binds SET last_seen = ? WHERE discord_id = ?').run(now, id);
}

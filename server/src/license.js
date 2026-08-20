import crypto from 'node:crypto';
import db from './db.js';

const KEY_PREFIX = process.env.KEY_PREFIX || 'BOOST';
const MAX_DEVICES = parseInt(process.env.MAX_DEVICES || '2', 10);
const ALLOWED_REBINDS = parseInt(process.env.ALLOWED_REBINDS || '3', 10);
const MONTHLY_DAYS = parseInt(process.env.MONTHLY_DAYS || '30', 10);

export function generateKey() {
  const group = () => crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${KEY_PREFIX}-${group()}-${group()}-${group()}-${group()}`;
}

export async function createLicense({ email, plan = 'monthly', months = 1, stripeSessionId, stripeCustomerId, discordId, status = 'active' }) {
  const key = generateKey();
  const now = Date.now();
  const expiresAt = plan === 'lifetime' ? null : now + MONTHLY_DAYS * months * 24 * 60 * 60 * 1000;
  const info = await db.prepare(
    `INSERT INTO licenses (key, email, plan, status, created_at, expires_at, stripe_session_id, stripe_customer_id, discord_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(key, email, plan, status, now, expiresAt, stripeSessionId || null, stripeCustomerId || null, discordId || null);
  return { key, email, plan, status, expiresAt, discordId, id: info.lastInsertRowid };
}

export async function findLicense(key) {
  return db.prepare('SELECT * FROM licenses WHERE key = ?').get(key);
}

export async function findLicenseByDiscord(discordId) {
  if (!discordId) return null;
  return db.prepare('SELECT * FROM licenses WHERE discord_id = ?').get(String(discordId));
}

// Crée ou renvoie la licence propriétaire (gratuite, à vie) pour le compte Discord du propriétaire.
export async function getOwnerLicense(discordId) {
  const owner = process.env.OWNER_DISCORD_ID;
  if (!owner || String(discordId) !== String(owner)) return null;
  const existing = await findLicenseByDiscord(discordId);
  if (existing) {
    if (existing.plan === 'owner') return existing;
    await db.prepare('UPDATE licenses SET plan = ?, status = ?, expires_at = NULL WHERE id = ?').run('owner', 'active', existing.id);
    return db.prepare('SELECT * FROM licenses WHERE id = ?').get(existing.id);
  }
  return createLicense({ email: 'owner@vxmp.opti', plan: 'owner', discordId });
}

export function isOwner(license) {
  return license && license.plan === 'owner';
}

// Révoque une clé : le statut passe à 'revoked', plus aucune activation/vérification n'est acceptée.
export async function revokeLicense(key) {
  const license = await findLicense(String(key).trim().toUpperCase());
  if (!license) return { ok: false, detail: 'Clé introuvable' };
  if (license.status !== 'active') return { ok: false, detail: `Clé déjà ${license.status}` };
  await db.prepare('UPDATE licenses SET status = ? WHERE id = ?').run('revoked', license.id);
  return { ok: true, license: await publicLicenseView({ ...license, status: 'revoked' }) };
}

// Révoque toutes les licences liées à un compte Discord.
export async function revokeByDiscord(discordId) {
  const rows = await db.prepare('SELECT * FROM licenses WHERE discord_id = ?').all(String(discordId));
  if (rows.length === 0) return { ok: false, detail: 'Aucune licence liée à ce compte Discord' };
  const info = await db.prepare("UPDATE licenses SET status = 'revoked' WHERE discord_id = ?").run(String(discordId));
  return { ok: true, count: info.changes, keys: rows.map(r => r.key) };
}

export async function linkDiscord(key, discordId) {
  const license = await findLicense(key);
  if (!license) return null;
  await db.prepare('UPDATE licenses SET discord_id = ? WHERE id = ?').run(String(discordId), license.id);
  return db.prepare('SELECT * FROM licenses WHERE id = ?').get(license.id);
}

export async function activationsFor(licenseId) {
  return db.prepare('SELECT * FROM activations WHERE license_id = ? ORDER BY activated_at DESC').all(licenseId);
}

export function isExpired(license) {
  return license.plan !== 'lifetime' && license.plan !== 'owner' && license.expires_at != null && Date.now() > license.expires_at;
}

export async function canActivate(license, hwid) {
  const acts = await activationsFor(license.id);
  const same = acts.find(a => a.hwid === hwid);
  if (same) return { ok: true, reason: 'already' };
  const activeDevices = acts.filter(a => a.hwid !== hwid).length;
  if (activeDevices < MAX_DEVICES) return { ok: true, reason: 'new' };
  return { ok: false, reason: 'max_devices' };
}

export async function activate(license, hwid, deviceName) {
  const now = Date.now();
  const info = await db.prepare(
    'INSERT INTO activations (license_id, hwid, device_name, activated_at, last_seen) VALUES (?, ?, ?, ?, ?)'
  ).run(license.id, hwid, deviceName || 'Inconnu', now, now);
  return { ok: true, activationId: info.lastInsertRowid, maxDevices: MAX_DEVICES };
}

export async function rebind(license, oldHwid, newHwid, deviceName) {
  const acts = await activationsFor(license.id);
  const previous = acts.filter(a => a.hwid === oldHwid && a.hwid !== newHwid);
  const rebindsUsed = acts.filter(a => a.hwid === newHwid).length; // devices currently bound to new hwid
  const totalRebindCount = acts.length > MAX_DEVICES ? acts.length - MAX_DEVICES : 0;

  // Compter les ré-associations effectives = nombre d'appareils uniques - 1 (le premier)
  const uniqueHwids = new Set(acts.map(a => a.hwid)).size;
  const rebindUsed = Math.max(0, uniqueHwids - 1);

  if (rebindUsed >= ALLOWED_REBINDS) {
    return { ok: false, reason: 'rebind_limit' };
  }
  if (previous.length === 0) {
    return { ok: false, reason: 'old_hwid_not_found' };
  }
  for (const a of previous) {
    await db.prepare('UPDATE activations SET hwid = ?, device_name = ?, activated_at = ? WHERE id = ?')
      .run(newHwid, deviceName || a.device_name, Date.now(), a.id);
  }
  return { ok: true, rebindsLeft: ALLOWED_REBINDS - rebindUsed - 1 };
}

export async function publicLicenseView(license) {
  const acts = await activationsFor(license.id);
  return {
    key: license.key,
    email: license.email,
    plan: license.plan,
    status: license.status,
    owner: isOwner(license),
    createdAt: license.created_at,
    expiresAt: license.expires_at,
    expired: isExpired(license),
    devices: acts.map(a => ({ hwid: a.hwid, deviceName: a.device_name, lastSeen: a.last_seen })),
    maxDevices: MAX_DEVICES,
    rebindsLeft: Math.max(0, ALLOWED_REBINDS - Math.max(0, new Set(acts.map(a => a.hwid)).size - 1))
  };
}

export { MAX_DEVICES, ALLOWED_REBINDS };
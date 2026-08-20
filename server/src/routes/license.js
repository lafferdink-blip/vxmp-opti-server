import { Router } from 'express';
import {
  findLicense, canActivate, activate, rebind, isExpired, publicLicenseView
} from '../license.js';
import db from '../db.js';

const router = Router();

router.post('/activate', async (req, res) => {
  const { key, hwid, deviceName } = req.body || {};
  if (!key || !hwid) return res.status(400).json({ error: 'key et hwid sont requis' });

  const license = await findLicense(String(key).trim().toUpperCase());
  if (!license) return res.status(404).json({ error: 'Clé introuvable' });
  if (license.status !== 'active') return res.status(403).json({ error: `Clé ${license.status}` });
  if (isExpired(license)) return res.status(410).json({ error: 'Clé expirée' });

  const check = await canActivate(license, hwid);
  if (!check.ok) {
    return res.status(409).json({
      error: 'Nombre maximal d\'appareils atteint pour cette clé.',
      code: check.reason
    });
  }
  if (check.reason === 'already') {
    const act = await db.prepare('SELECT * FROM activations WHERE license_id = ? AND hwid = ?').get(license.id, hwid);
    if (act) await db.prepare('UPDATE activations SET last_seen = ? WHERE id = ?').run(Date.now(), act.id);
    return res.json({ ok: true, alreadyBound: true, license: await publicLicenseView(license) });
  }

  await activate(license, hwid, deviceName);
  return res.json({ ok: true, alreadyBound: false, license: await publicLicenseView(license) });
});

router.post('/verify', async (req, res) => {
  const { key, hwid } = req.body || {};
  if (!key || !hwid) return res.status(400).json({ error: 'key et hwid sont requis' });

  const license = await findLicense(String(key).trim().toUpperCase());
  if (!license) return res.status(404).json({ error: 'Clé introuvable' });
  if (license.status !== 'active') return res.status(403).json({ error: `Clé ${license.status}` });
  if (isExpired(license)) return res.status(410).json({ error: 'Clé expirée' });

  const act = await db.prepare('SELECT * FROM activations WHERE license_id = ? AND hwid = ?').get(license.id, hwid);
  if (!act) {
    const check = await canActivate(license, hwid);
    if (check.ok) await activate(license, hwid);
    else return res.status(409).json({ error: 'Cet appareil n\'est pas lié à la clé.', code: 'not_bound' });
    return res.json({ ok: true, bound: true, license: await publicLicenseView(license) });
  }
  await db.prepare('UPDATE activations SET last_seen = ? WHERE id = ?').run(Date.now(), act.id);
  return res.json({ ok: true, bound: true, license: await publicLicenseView(license) });
});

router.post('/rebind', async (req, res) => {
  const { key, oldHwid, newHwid, deviceName } = req.body || {};
  if (!key || !oldHwid || !newHwid) return res.status(400).json({ error: 'key, oldHwid et newHwid sont requis' });

  const license = await findLicense(String(key).trim().toUpperCase());
  if (!license) return res.status(404).json({ error: 'Clé introuvable' });
  if (license.status !== 'active') return res.status(403).json({ error: `Clé ${license.status}` });
  if (isExpired(license)) return res.status(410).json({ error: 'Clé expirée' });

  const result = await rebind(license, oldHwid, newHwid, deviceName);
  if (!result.ok) {
    return res.status(409).json({
      error: result.reason === 'rebind_limit'
        ? 'Limite de ré-associations atteinte. Contactez le support.'
        : 'Ancien appareil introuvable sur cette clé.',
      code: result.reason
    });
  }
  return res.json({ ok: true, rebindsLeft: result.rebindsLeft });
});

router.get('/status', async (req, res) => {
  const key = (req.query.key || '').trim().toUpperCase();
  if (!key) return res.status(400).json({ error: 'key est requis' });
  const license = await findLicense(key);
  if (!license) return res.status(404).json({ error: 'Clé introuvable' });
  return res.json(await publicLicenseView(license));
});

export default router;
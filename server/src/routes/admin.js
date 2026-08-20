import { Router } from 'express';
import { createLicense, linkDiscord, findLicense, publicLicenseView } from '../license.js';
import db from '../db.js';

const router = Router();

router.use((req, res, next) => {
  const token = req.headers['x-admin-token'];
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Token admin invalide' });
  }
  next();
});

// Crée une clé (liée au Discord de l'acheteur si fourni)
router.post('/create-key', async (req, res) => {
  const { email, plan = 'monthly', months = 1, discordId } = req.body || {};
  const mail = (email || '').trim();
  if (!mail && !discordId) {
    return res.status(400).json({ error: 'email ou discordId requis' });
  }
  if (!['monthly', 'lifetime'].includes(plan)) {
    return res.status(400).json({ error: 'Plan inconnu' });
  }
  const license = await createLicense({ email: mail || `discord-${discordId}@vxmp.opti`, plan, months, discordId });
  console.log(`[admin] Clé générée pour ${mail || 'discord:' + discordId} (${plan}): ${license.key}`);
  return res.json(await publicLicenseView(license));
});

// Lie une clé existante au Discord d'un acheteur (après paiement dans le ticket)
router.post('/link-discord', async (req, res) => {
  const { key, discordId } = req.body || {};
  if (!key || !discordId) return res.status(400).json({ error: 'key et discordId requis' });
  const license = await linkDiscord(String(key).trim().toUpperCase(), String(discordId).trim());
  if (!license) return res.status(404).json({ error: 'Clé introuvable' });
  console.log(`[admin] Clé ${license.key} liée au Discord ${discordId}`);
  return res.json(await publicLicenseView(license));
});

router.get('/licenses', async (req, res) => {
  const rows = await db.prepare('SELECT * FROM licenses ORDER BY created_at DESC').all();
  const out = [];
  for (const r of rows) out.push(await publicLicenseView(r));
  return res.json(out);
});

export default router;
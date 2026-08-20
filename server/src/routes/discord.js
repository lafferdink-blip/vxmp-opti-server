import { Router } from 'express';
import { findLicenseByDiscord, getOwnerLicense, linkDiscord, isExpired, isOwner } from '../license.js';

const router = Router();
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const BASE = process.env.API_BASE_URL || 'http://localhost:4000';
const REDIRECT_URI = `${BASE}/api/discord/callback`;
const hasOAuth = Boolean(CLIENT_ID && CLIENT_SECRET);

// Résultats de connexion stockés en mémoire (interrogés par l'app desktop via /result)
const pending = new Map(); // state -> { ok, discord, license, error, ts }

function page(title, msg, ok) {
  const color = ok ? '#22c55e' : '#ef4444';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
  <title>${title}</title>
  <style>body{margin:0;font-family:Segoe UI,Arial,sans-serif;background:#0b0b10;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh}
  .card{background:#16161f;border:1px solid #2a2a3a;border-radius:16px;padding:32px;max-width:420px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5)}
  .logo{font-size:44px;font-weight:900;letter-spacing:2px;background:linear-gradient(90deg,#ff2d55,#ff8a00);-webkit-background-clip:text;background-clip:text;color:transparent}
  .icon{font-size:40px} .ok{color:${color};font-weight:700;margin-top:10px}.sub{color:#9a9aab;font-size:13px;margin-top:6px}</style></head>
  <body><div class="card"><div class="logo">VXMP</div><div class="icon">${ok ? '✅' : '❌'}</div>
  <div class="ok">${msg}</div><div class="sub">Tu peux fermer cette fenêtre.</div></div></body></html>`;
}

router.get('/auth-url', (req, res) => {
  const state = req.query.state || cryptoRandom();
  if (!hasOAuth) {
    return res.json({ ok: true, mode: 'test', url: `${BASE}/api/discord/login?state=${state}`, state });
  }
  const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify&state=${state}`;
  res.json({ ok: true, mode: 'oauth', url, state });
});

router.get('/login', (req, res) => {
  const state = req.query.state || cryptoRandom();
  if (hasOAuth) {
    const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify&state=${state}`;
    return res.redirect(url);
  }
  // Mode test : pas d'app Discord configurée → page qui simule la connexion.
  res.send(`<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>VXMP · Connexion Discord</title>
  <style>body{margin:0;font-family:Segoe UI,Arial,sans-serif;background:#0b0b10;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh}
  .card{background:#16161f;border:1px solid #2a2a3a;border-radius:16px;padding:28px;width:320px;text-align:center}
  .logo{font-size:30px;font-weight:900;background:linear-gradient(90deg,#ff2d55,#ff8a00);-webkit-background-clip:text;background-clip:text;color:transparent}
  label{display:block;text-align:left;font-size:13px;color:#9a9aab;margin:14px 0 6px}
  input{width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #333;background:#0f0f15;color:#eee}
  button{margin-top:16px;width:100%;padding:11px;border:0;border-radius:8px;background:linear-gradient(90deg,#ff2d55,#ff8a00);color:#fff;font-weight:700;cursor:pointer}
  .sub{color:#9a9aab;font-size:12px;margin-top:10px}</style></head>
  <body><div class="card"><div class="logo">VXMP</div>
  <p>Connexion Discord (mode test)<br><span class="sub">Saisis l'identifiant Discord utilisé lors de l'achat.</span></p>
  <form action="${BASE}/api/discord/callback" method="get">
    <input type="hidden" name="state" value="${state}">
    <label>Identifiant Discord</label>
    <input name="discord_id" placeholder="Ex : 512345678901234567" required>
    <button type="submit">Vérifier ma licence</button>
  </form></div></body></html>`);
});

router.get('/callback', async (req, res) => {
  const { code, discord_id: testId, state } = req.query;
  if (!state) return res.status(400).send('state manquant');

  try {
    let discordId;
    let username = 'Utilisateur Discord';

    if (code && hasOAuth) {
      const token = await exchangeCode(code);
      const user = await fetchDiscordUser(token);
      discordId = user.id;
      username = user.username;
    } else if (testId) {
      discordId = String(testId).trim();
    } else {
      return res.status(400).send('code ou discord_id manquant');
    }
    if (!discordId) return res.status(400).send('identifiant Discord introuvable');

    // Propriétaire : accès gratuit automatique, sans achat.
    const ownerLicense = await getOwnerLicense(discordId);
    if (ownerLicense) {
      pending.set(state, {
        ok: true,
        owner: true,
        discord: { id: discordId, username },
        license: { key: ownerLicense.key, plan: 'owner', expiresAt: null, owner: true }
      });
      return res.send(page('VXMP · Propriétaire', `Bienvenue propriétaire ${username} ! Licence gratuite à vie.`, true));
    }

    const license = await findLicenseByDiscord(discordId);
    if (!license) {
      pending.set(state, { ok: false, notPurchased: true, discord: { id: discordId, username }, ts: Date.now() });
      return res.send(page('VXMP · Non acheté', 'Aucun achat détecté pour ce compte Discord.', false));
    }
    if (license.status !== 'active' || isExpired(license)) {
      pending.set(state, { ok: false, error: 'La licence de ce compte est inactive ou expirée.', discord: { id: discordId, username }, ts: Date.now() });
      return res.send(page('VXMP · Licence invalide', 'Licence inactive ou expirée pour ce compte Discord.', false));
    }

    pending.set(state, {
      ok: true,
      owner: false,
      discord: { id: discordId, username },
      license: { key: license.key, plan: license.plan, expiresAt: license.expires_at, owner: false }
    });
    res.send(page('VXMP · Licence vérifiée', `Licence vérifiée pour ${username}.`, true));
  } catch (err) {
    console.error('[discord] callback:', err.message);
    pending.set(state, { ok: false, error: err.message, ts: Date.now() });
    res.send(page('VXMP · Erreur', 'Échec de la vérification Discord.', false));
  }
});

router.get('/result', (req, res) => {
  const { state } = req.query;
  if (!state) return res.status(400).json({ error: 'state manquant' });
  const r = pending.get(state);
  if (!r) return res.json({ ok: null });
  if (Date.now() - r.ts > 5 * 60 * 1000) { pending.delete(state); return res.json({ ok: null }); }
  pending.delete(state);
  res.json(r);
});

router.post('/link', async (req, res) => {
  const { key, discordId } = req.body || {};
  if (!key || !discordId) return res.status(400).json({ error: 'key et discordId sont requis' });
  const license = await linkDiscord(String(key).trim().toUpperCase(), discordId);
  if (!license) return res.status(404).json({ error: 'Clé introuvable' });
  res.json({ ok: true, discordId: license.discord_id });
});

function cryptoRandom() {
  return require('node:crypto').randomBytes(12).toString('hex');
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI
  });
  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error_description || 'Échec de l\'échange du code Discord');
  return json.access_token;
}

async function fetchDiscordUser(token) {
  const res = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const json = await res.json();
  if (!res.ok) throw new Error('Impossible de récupérer le profil Discord');
  return json;
}

export default router;
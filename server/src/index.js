import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import licenseRoutes from './routes/license.js';
import billingRoutes from './routes/billing.js';
import adminRoutes from './routes/admin.js';
import discordRoutes from './routes/discord.js';
import db, { dbKind } from './db.js';
import { startBot } from './bot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4000;
const WEB_DIR = path.join(__dirname, '..', '..', 'web');

// Corps brut requis par le webhook Stripe (vérification de signature)
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));
app.use('/api', express.json());
app.use(cors());

app.get('/api/health', (req, res) => res.json({ ok: true, name: 'VXMP Opti API' }));

app.use('/api/license', licenseRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/discord', discordRoutes);

app.use('/web', express.static(WEB_DIR));
app.get('/', (req, res) => res.redirect('/web/index.html'));

app.use((err, req, res, next) => {
  console.error('[server] Erreur:', err.message);
  res.status(500).json({ error: 'Erreur serveur interne' });
});

await db.ready;
console.log(`[db] Stockage: ${dbKind}`);

app.listen(PORT, () => {
  console.log(`VXMP Opti API démarrée sur http://localhost:${PORT}`);
  console.log(`Web : http://localhost:${PORT}/web/index.html`);
});

startBot();
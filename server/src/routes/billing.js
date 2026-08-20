import { Router } from 'express';
import Stripe from 'stripe';
import { createLicense, findLicense } from '../license.js';
import db from '../db.js';

const router = Router();
const secretKey = process.env.STRIPE_SECRET_KEY;
const stripeEnabled = Boolean(secretKey);
const stripe = stripeEnabled ? new Stripe(secretKey) : null;

const PRICES = {
  monthly: process.env.STRIPE_PRICE_MONTHLY,
  lifetime: process.env.STRIPE_PRICE_LIFETIME
};

async function testModeCheckout(email, plan, discordId) {
  // Mode test : génère la clé immédiatement, sans passer par Stripe.
  const license = await createLicense({ email, plan, discordId });
  console.log(`[billing:test] Clé générée pour ${email} (${plan}): ${license.key}`);
  return {
    mode: 'test',
    key: license.key,
    checkoutUrl: null,
    note: 'Mode test (STRIPE_SECRET_KEY non configuré). Clé générée directement.'
  };
}

router.post('/checkout', async (req, res) => {
  const { email, plan = 'monthly', discordId } = req.body || {};
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'Adresse email invalide' });
  }
  if (!['monthly', 'lifetime'].includes(plan)) return res.status(400).json({ error: 'Plan inconnu' });

  if (!stripeEnabled) {
    return res.json(await testModeCheckout(email, plan, discordId));
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: PRICES[plan], quantity: 1 }],
      customer_email: email,
      metadata: { plan, discord_id: discordId || '' },
      success_url: `${process.env.API_BASE_URL || 'http://localhost:4000'}/web/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.API_BASE_URL || 'http://localhost:4000'}/web/index.html#pricing`
    });
    return res.json({ mode: 'stripe', checkoutUrl: session.url, sessionId: session.id });
  } catch (err) {
    console.error('[billing] Erreur Stripe:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la création de la session de paiement' });
  }
});

router.post('/webhook', async (req, res) => {
  if (!stripeEnabled) return res.status(200).json({ ok: true, mode: 'test' });
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_details?.email || session.customer_email;
    const plan = session.metadata?.plan || 'monthly';
    const discordId = session.metadata?.discord_id || null;
    if (email) {
      const existing = await findLicenseByStripe(session.id);
      if (!existing) {
        const license = await createLicense({
          email,
          plan,
          stripeSessionId: session.id,
          stripeCustomerId: session.customer,
          discordId
        });
        console.log(`[billing] Paiement confirmé → clé ${license.key} pour ${email} (${plan})`);
      }
    }
  }
  return res.json({ received: true });
});

async function findLicenseByStripe(sessionId) {
  return db.prepare('SELECT * FROM licenses WHERE stripe_session_id = ?').get(sessionId);
}

export default router;
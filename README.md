# ⚡ BoostStream

Application d'optimisation pour le streaming (Windows) avec **clé personnelle payante**,
**vérification matérielle (HWID)** et **serveur de licence en ligne**.

## Architecture

```
├── server/     API licence + paiement Stripe + génération de clés (Node.js / Express / SQLite)
├── desktop/    Application de bureau Electron (détection matérielle, HWID, optimisations, presets OBS)
└── web/        Landing page + tableau de bord (servie par le serveur)
```

## Démarrage rapide

1. Installer Node.js LTS (18+).
2. Installer les dépendances :
   ```
   npm run setup
   ```
3. Lancer le serveur (API + web) :
   ```
   npm run server        → http://localhost:4000
   ```
4. Lancer l'application desktop :
   ```
   npm run desktop
   ```

> Sous PowerShell, si `npm` est bloqué par la politique d'exécution, utiliser `npm.cmd`.

## Fonctionnement de la licence

1. L'utilisateur achète sur la landing page (`/web/index.html`) → Stripe (ou mode test).
2. Stripe confirme le paiement (webhook) → le serveur génère une clé `BOOST-XXXX-XXXX-XXXX-XXXX`
   associée à l'email de l'acheteur.
3. Dans l'app desktop, l'utilisateur entre sa clé → l'app calcule une **empreinte matérielle
   (HWID)** unique (CPU + carte mère + BIOS + disques + MAC) et l'envoie au serveur.
4. Le serveur vérifie la clé et la **lie à l'empreinte matérielle**. Une clé partagée ne
   fonctionnera pas sur une autre machine (max 2 appareils par clé, ré-associations limitées).

### Endpoints API

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/api/billing/checkout` | Crée une session Stripe (ou clé directe en mode test) |
| POST | `/api/billing/webhook` | Reçoit la confirmation de paiement Stripe |
| POST | `/api/license/activate` | Active une clé et lie le HWID de la machine |
| POST | `/api/license/verify` | Vérifie que la clé est valide pour ce HWID |
| POST | `/api/license/rebind` | Ré-associe la clé à un nouveau PC (limité) |
| GET  | `/api/license/status?key=…` | Statut public d'une clé |
| POST | `/api/admin/create-key` | Génère une clé manuellement (token admin) |

## Configuration

Copier `server/.env.example` → `server/.env` :

```env
PORT=4000
STRIPE_SECRET_KEY=            # vide = mode test (clé générée immédiatement sans Stripe)
STRIPE_WEBHOOK_SECRET=        # secret du webhook Stripe
STRIPE_PRICE_MONTHLY=price_…  # IDs des produits Stripe
STRIPE_PRICE_LIFETIME=price_…
MAX_DEVICES=2                 # appareils max par clé
ALLOWED_REBINDS=3             # ré-associations matérielles autorisées
MONTHLY_DAYS=30
ADMIN_TOKEN=change-me         # token pour l'API admin
```

### Mise en place de Stripe (production)

1. Créer un compte Stripe → deux **Price** (mensuel + à vie).
2. Renseigner `STRIPE_SECRET_KEY` et les IDs de prix dans `.env`.
3. Configurer le webhook Stripe vers `https://votre-domaine/api/billing/webhook`
   avec l'événement `checkout.session.completed` → copier `STRIPE_WEBHOOK_SECRET`.

## Optimisations de l'app desktop

- **Système** : plan d'alimentation haute performance, Game DVR désactivé, GPU scheduling,
  Game Mode, effets visuels, délai de démarrage.
- **Réseau** : autotuning TCP, désactivation de Nagle, DNS Cloudflare (1.1.1.1).
- **Services** : désactivation sûre (SysMain, DiagTrack, dmwappushservice, MapsBroker…).
- **GPU** : mode persistance NVIDIA.
- **OBS** : preset calculé selon le matériel détecté et un test de débit réel.

Chaque réglage est **réversible** (bouton "Rétablir les valeurs d'origine"). Les optimisations
système/services nécessitent une élévation administrateur (invite UAC automatique).

## Générer une clé manuellement (test)

```
curl -X POST http://localhost:4000/api/admin/create-key ^
  -H "Content-Type: application/json" ^
  -H "x-admin-token: change-me" ^
  -d "{\"email\":\"client@example.com\",\"plan\":\"monthly\"}"
```

## Notes sécurité

- Ne jamais committer `server/.env` (secrets Stripe / token admin).
- En production : HTTPS obligatoire (webhook + activation), protection contre le brute-force
  sur `/api/license/activate`.
- Le HWID est envoyé hashé (SHA-256) — jamais d'identifiants matériels bruts côté serveur.
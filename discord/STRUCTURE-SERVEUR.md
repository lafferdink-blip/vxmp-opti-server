# 🎮 Structure du serveur Discord — BoostStream

Guide pour créer le serveur Discord dédié à la vente de tes optimisations
(gaming + PC/matériel). À créer manuellement dans l'app Discord (bouton `+` → « Créer un serveur »).

---

## 1. Catégorie : `📢 INFO`

| Salon | Nom | Rôle |
|---|---|---|
| #welcome | `👋-bienvenue` | Message d'accueil avec bouton « Ouvrir un ticket » |
| #annonces | `📣-annonces` | Sorties, soldes, mises à jour (seul le staff écrit) |
| #reglement | `📜-reglement` | Règles + conditions de vente (non-résiliation, délais) |

## 2. Catégorie : `🛒 COMMANDER`

| Salon | Nom | Rôle |
|---|---|---|
| #services | `🛍️-services` | Catalogue des services avec prix (voir ci-dessous) |
| #tickets | `🎫-ouvrir-un-ticket` | Bouton / menu « Ouvrir un ticket » → crée un salon privé |
| #paiement | `💳-paiement` | Explication du paiement (PayPal, virement, crypto) |

### Catalogue de services à adapter

| Service | Description | Prix indicatif |
|---|---|---|
| Optimisation Windows gaming | Réglages système + réseau + services | 15 € |
| Optimisation PC complet | Windows + drivers + BIOS + benchmark avant/après | 35 € |
| Config FPS / ping | Jeu ciblé (Warzone, Fortnite, Valorant…) | 10 € |
| Installation BoostStream | Clé licence + mise en place app | 25 € |
| Diagnostic matériel | Test de stabilité, températures, throttling | 5 € |

## 3. Catégorie : `👥 COMMUNAUTÉ`

| Salon | Nom | Rôle |
|---|---|---|
| #chat | `💬-chat` | Discussion libre |
| #avis | `⭐-avis` | Les clients postent leur retour (seul le client écrit) |
| #resultats | `📈-resultats` | Avant/après (screenshots de FPS, benchs) |

## 4. Catégorie : `🔧 SUPPORT`

| Salon | Nom | Rôle |
|---|---|---|
| #faq | `❓-faq` | Questions fréquentes (réponses épinglées) |
| #commandes | `💻-commandes` | Liste des commandes du bot |

---

## Rôles

| Rôle | Couleur | Permissions clés |
|---|---|---|
| `@Owner` | Rouge | Tout |
| `@Staff` | Orange | Gérer les tickets, modérer, envoyer annonces |
| `@Client` | Vert | Donné après achat → accès à un salon privé clients |
| `@VIP` | Or | Clients récurrents → accès salon + avantages |
| `@everyone` | — | Lecture seul, écrire dans #chat, créer des tickets |

> **Conseil** : garder les salons de vente en lecture seule pour `@everyone`.
> Tout passe par les tickets → ça évite les négociations en public et ça structure le travail.

---

## Parcours client type

1. Le client lit #reglement puis le catalogue #services.
2. Il clique sur « Ouvrir un ticket » → le bot crée un salon privé `ticket-nom-du-client`.
3. Le staff discute, précise le besoin (jeu, matos, budget), envoie la demande de paiement.
4. Le client paie (PayPal/virement), envoie la preuve dans le ticket.
5. Le staff livre l'optimisation (fichier de config, ou via l'app BoostStream + clé).
6. Le ticket est clôturé ; le client reçoit le rôle `@Client` et peut laisser un avis dans #avis.

---

## Puis créer le bot

Voir le dossier `bot/` : configurer le token dans `.env`, installer les dépendances,
puis inviter le bot avec les permissions suivantes :

- `Manage Channels` (créer/supprimer les salons de ticket)
- `Manage Roles` (attribuer `@Client` / `@VIP`)
- `Send Messages`, `Embed Links`, `Attach Files`
- `Read Message History`
- `Use Slash Commands`
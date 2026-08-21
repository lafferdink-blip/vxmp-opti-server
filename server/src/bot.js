import { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createLicense, revokeLicense, revokeByDiscord, publicLicenseView } from './license.js';
import { unbindHwid } from './hwidbind.js';

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const DOWNLOAD_URL = process.env.DOWNLOAD_URL || '';
let client = null;

export function startBot() {
  if (!TOKEN) {
    console.log('[bot] DISCORD_BOT_TOKEN non configuré, bot désactivé. Ajoute-le dans .env pour activer les ventes automatiques.');
    return null;
  }
  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  });

  client.once('ready', () => {
    console.log(`[bot] Connecté en tant que ${client.user.tag} — commande !confirm, !setticket prêtes.`);
  });

  client.on('messageCreate', handleMessage);
  client.on('interactionCreate', handleInteraction);
  client.on('error', (err) => console.error('[bot] Erreur:', err.message));

  client.login(TOKEN).catch((err) => {
    console.error('[bot] Échec de connexion:', err.message);
  });
  return client;
}

function isAdmin(msg) {
  return Boolean(
    (msg.member && msg.member.permissions.has(PermissionFlagsBits.ManageGuild)) ||
    (msg.guild && msg.author.id === msg.guild.ownerId)
  );
}

function slug(name) {
  return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

// ---------- SALON DE TICKETS ----------
function ticketCategory(guild) {
  return guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name.toLowerCase().includes('ticket'));
}

async function getTicketCategory(guild) {
  let cat = ticketCategory(guild);
  if (!cat) {
    cat = await guild.channels.create({
      name: '🎫 TICKETS',
      type: ChannelType.GuildCategory,
      permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }]
    });
  }
  return cat;
}

const TICKET_TYPES = {
  achat: {
    prefix: 'ticket-achat',
    title: '🛒 Achat de licence VXMP Opti',
    desc: [
      '**Bonjour et bienvenue ! 👋**',
      'Merci d\'avoir ouvert un ticket d\'achat. Voici nos **3 plans** :',
      '',
      '▸ **Plan 1 — Débloat · 30 €**',
      '  Débloat Windows, services + télémétrie, latence réseau, Windows ISO modifié',
      '',
      '▸ **Plan 2 — Performance · 50 €**',
      '  Tout le Plan 1 + optimisation BIOS, overclock, boost FPS, 0 latence',
      '',
      '▸ **Plan 3 — Prestige · 120 €**',
      '  Tout le Plan 2 + optimisation personnalisée complète',
      '',
      '**Moyens de paiement acceptés :**',
      '▸ 💳 **PayPal**',
      '▸ 🎫 **Paysafecard (PCS)**',
      '▸ 🏦 **Virement instantané**',
      '',
      '📌 **Quelle que soit la formule choisie, tu bénéficies d\'un suivi à vie.**',
      '⚠️ En cas de non-respect des règles, ce suivi sera retiré.',
      '',
      '💻 Pour accélérer la prise en charge, génère un rapport de ton PC sur **UserDiag** (https://userdiag.com) et colle le lien ici.',
      '',
      'Indique le **plan** choisi et ton **moyen de paiement**, puis attends la confirmation du staff. 👍'
    ].join('\n')
  },
  bug: { prefix: 'ticket-bug', title: '🐛 Signalement de bug', desc: 'Décris le bug rencontré : ce que tu faisais, ce qui s\'est passé, et si possible une capture d\'écran. Merci !' },
  support: { prefix: 'ticket-support', title: '❓ Question / Support', desc: 'Décris ta demande. Un membre du staff va te répondre.' }
};

async function openTicket(interaction) {
  const guild = interaction.guild;
  const user = interaction.user;
  await interaction.deferReply({ ephemeral: true });

  const type = interaction.isStringSelectMenu()
    ? TICKET_TYPES[interaction.values[0]] || TICKET_TYPES.support
    : TICKET_TYPES.support;

  const baseName = `${type.prefix}-${slug(user.username)}`;
  const existing = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === baseName);
  if (existing) return interaction.editReply(`Tu as déjà un ticket ouvert : ${existing.toString()}`);

  const cat = await getTicketCategory(guild);
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] }
  ];
  const staffRole = guild.roles.cache.find(r => /staff|support|modo|admin/i.test(r.name));
  if (staffRole) overwrites.push({ id: staffRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });

  const channel = await guild.channels.create({
    name: baseName,
    type: ChannelType.GuildText,
    parent: cat,
    permissionOverwrites: overwrites
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('close_ticket').setLabel('Fermer le ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒')
  );
  const embed = new EmbedBuilder()
    .setTitle(type.title)
    .setDescription(`${type.desc}\n\nBienvenue <@${user.id}> ! Un membre du staff va te répondre ici.`)
    .setColor('#ff2d55');

  await channel.send({ content: `<@${user.id}>`, embeds: [embed], components: [row] });
  await interaction.editReply(`✅ Ton ticket est ouvert : ${channel.toString()}`);
}

async function closeTicket(interaction) {
  const channel = interaction.channel;
  await interaction.deferReply({ ephemeral: true });
  if (!channel || channel.type !== ChannelType.GuildText || !channel.name.startsWith('ticket-')) {
    return interaction.editReply('Ceci n\'est pas un ticket.');
  }
  await interaction.editReply('🔒 Ticket fermé, suppression dans 2 secondes…');
  setTimeout(() => channel.delete().catch(() => {}), 2000);
}

async function handleInteraction(interaction) {
  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_choice') {
    try { await openTicket(interaction); } catch (err) { console.error('[bot] select:', err.message); }
    return;
  }
  if (!interaction.isButton()) return;
  try {
    if (interaction.customId === 'close_ticket') await closeTicket(interaction);
  } catch (err) {
    console.error('[bot] interaction:', err.message);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Une erreur est survenue.', ephemeral: true }).catch(() => {});
    }
  }
}

// ---------- COMMANDES ----------
async function handleMessage(msg) {
  if (msg.author.bot) return;
  const content = msg.content.trim().toLowerCase();

  // Ticket d'achat : détection du choix de plan par le client
  if (msg.channel.type === ChannelType.GuildText && msg.channel.name.startsWith('ticket-achat')) {
    const planMatch = content.match(/\bplan\s*[:\-\s]*([123])\b/) || content.match(/\b([123])\b/);
    if (planMatch) {
      const num = planMatch[1];
      const plans = { 1: 'Débloat (30 €)', 2: 'Performance (50 €)', 3: 'Prestige (120 €)' };
      if (plans[num]) {
        await msg.reply([
          `✅ **Plan ${num} — ${plans[num]}** bien reçu !`,
          '',
          `📋 Un membre du staff va **prendre en charge ta demande**, merci de **patienter** un instant.`,
          '',
          `💻 En attendant, génère un rapport de ton PC sur **UserDiag** : https://userdiag.com`,
          `Puis colle le lien du rapport **ici** pour accélérer la prise en charge.`,
          '',
          `N\'oublie pas d\'indiquer ton **moyen de paiement** (PayPal, Paysafecard ou virement instantané). 👍`
        ].join('\n'));
        return;
      }
    }
  }

  // !setticket → crée/actualise le salon d'ouverture de tickets
  if (content === '!setticket') {
    if (!isAdmin(msg)) return msg.reply('❌ Réservé au staff.');
    let ch = msg.guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name.includes('ouvrir-un-ticket'));
    if (!ch) ch = await msg.guild.channels.create({ name: 'ouvrir-un-ticket', type: ChannelType.GuildText });
    const menu = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('ticket_choice')
        .setPlaceholder('Choisis le sujet de ton ticket…')
        .addOptions(
          new StringSelectMenuOptionBuilder().setLabel('Achat de licence').setValue('achat').setDescription('Acheter une licence VXMP Opti').setEmoji('🛒'),
          new StringSelectMenuOptionBuilder().setLabel('Signaler un bug').setValue('bug').setDescription('Un problème dans l\'application').setEmoji('🐛'),
          new StringSelectMenuOptionBuilder().setLabel('Question / Support').setValue('support').setDescription('Autre demande').setEmoji('❓')
        )
    );
    const embed = new EmbedBuilder()
      .setTitle('🎫 Ouvrir un ticket')
      .setDescription('Choisis le sujet ci-dessous pour ouvrir un **ticket privé**. Un membre du staff te répondra.')
      .setColor('#ff2d55');
    await ch.send({ embeds: [embed], components: [menu] });
    return msg.reply('✅ Salon de tickets prêt : ' + ch.toString());
  }

  // !confirm <monthly|lifetime> @user  → confirme le paiement et délivre la clé
  if (content.startsWith('!confirm')) {
    const parts = content.split(/\s+/);
    const plan = parts[1];
    const mention = msg.mentions.users.first();
    if (!['monthly', 'lifetime'].includes(plan) || !mention) {
      return msg.reply('Usage : `!confirm <monthly|lifetime> @utilisateur`\nEx : `!confirm lifetime @Jean`');
    }
    const license = await createLicense({
      email: `discord-${mention.id}@vxmp.opti`,
      plan,
      discordId: mention.id
    });
    const planLabel = plan === 'lifetime' ? 'À vie' : 'Mensuel';
    const dl = DOWNLOAD_URL
      ? `> 📥 **Télécharge l'app ici :** ${DOWNLOAD_URL}`
      : '> 📥 Le lien de téléchargement te sera envoyé par le staff.';
        await msg.reply([
      `✅ **Paiement confirmé** pour <@${mention.id}> !`,
      `> **Plan :** ${planLabel}`,
      `> Ton compte Discord est maintenant lié.`,
      dl,
      '',
      `Ouvre **VXMP Opti** → **Se connecter avec Discord** → c'est débloqué !`
    ].join('\n'));

    try {
      await mention.send(
        `🎉 **VXMP Opti** — Paiement confirmé !\n\n` +
        `**Plan :** ${planLabel}\n` +
        `Ton compte Discord est maintenant lié.\n` +
        (DOWNLOAD_URL ? `**Télécharge l'app :** ${DOWNLOAD_URL}\n` : 'Le lien de téléchargement te sera envoyé par le staff.\n') +
        `\nOuvre l'application, clique sur **Se connecter avec Discord** et c'est bon !`
      );
    } catch {
      // MP fermés
    }
    return;
  }

  // !revoke <clé> ou !revoke @user → révoque l'accès
  if (content.startsWith('!revoke')) {
    const parts = content.split(/\s+/);
    const target = parts[1];
    const mention = msg.mentions.users.first();
    if (!target) {
      return msg.reply('Usage : `!revoke <clé>` ou `!revoke @utilisateur`');
    }
    if (mention) {
      const r = await revokeByDiscord(mention.id);
      if (!r.ok) return msg.reply(`❌ ${r.detail}`);
      return msg.reply(`🔒 Accès révoqué pour <@${mention.id}> (${r.count} licence(s)).\n> ${r.keys.map(k => `\`${k}\``).join(' · ')}`);
    }
    const r = await revokeLicense(target);
    if (!r.ok) return msg.reply(`❌ ${r.detail}`);
    return msg.reply(`🔒 Clé révoquée : \`${r.license.key}\`\nL'utilisateur ne peut plus accéder à VXMP Opti.`);
  }

  // !unbind @user → délie le HWID (autorise un changement de PC)
  if (content.startsWith('!unbind')) {
    if (!isAdmin(msg)) return msg.reply('❌ Réservé au staff.');
    const mention = msg.mentions.users.first();
    if (!mention) return msg.reply('Usage : `!unbind @utilisateur`');
    const n = await unbindHwid(mention.id);
    if (!n) return msg.reply(`ℹ️ Aucun PC lié pour <@${mention.id}>.`);
    return msg.reply(`🔓 PC délié pour <@${mention.id}> ! L'app pourra être activée sur une nouvelle machine au prochain lancement.`);
  }

  // !licences → liste des clés (admin)
  if (content === '!licences' || content === '!keys') {
    try {
      const { default: db } = await import('./db.js');
      const rows = await db.prepare('SELECT * FROM licenses ORDER BY created_at DESC LIMIT 20').all();
      const lines = [];
      for (const l of rows) {
        const act = await db.prepare('SELECT COUNT(*) AS n FROM activations WHERE license_id = ?').get(l.id);
        const n = Number(act?.n ?? 0);
        lines.push(`\`${l.key}\` · ${l.plan === 'owner' ? '👑 owner' : l.plan} · ${l.discord_id ? 'liée Discord' : 'non liée'} · ${n} appareil(s)`);
      }
      await msg.reply(`**Licences récentes :**\n${lines.join('\n') || 'Aucune licence.'}`);
    } catch (err) {
      await msg.reply('Erreur lors de la lecture des licences.');
    }
    return;
  }
}

export { client };

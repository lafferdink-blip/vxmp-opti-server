"""
BoostStream — Bot Discord de vente d'optimisations (gaming + PC matériel).

Fonctionnalités :
- Panneau de tickets (sélection du service via menu déroulant)
- Salons de ticket privés avec transcript + clôture
- Confirmation de paiement manuelle par le staff
- Attribution automatique des rôles Client / VIP
- Base SQLite pour retrouver les tickets

Dépendances : discord.py 2.x  ->  pip install -r requirements.txt
"""
import asyncio
import json
import os
import sqlite3
from datetime import datetime

import discord
from discord import app_commands
from discord.ext import commands
from dotenv import load_dotenv

load_dotenv()

TOKEN = os.getenv("DISCORD_TOKEN", "")
GUILD_ID = int(os.getenv("GUILD_ID", "0") or "0")
STAFF_ROLE_ID = int(os.getenv("STAFF_ROLE_ID", "0") or "0")
CLIENT_ROLE_ID = int(os.getenv("CLIENT_ROLE_ID", "0") or "0")
VIP_ROLE_ID = int(os.getenv("VIP_ROLE_ID", "0") or "0")
CATEGORY_ID = int(os.getenv("CATEGORY_ID", "0") or "0")
TRANSCRIPT_CHANNEL_ID = int(os.getenv("TRANSCRIPT_CHANNEL_ID", "0") or "0")

DB_PATH = os.getenv("DB_PATH", "tickets.db")

# Services proposés (menu déroulant du panneau). Adapte les prix à ton catalogue.
SERVICES = {
    "optim_win": {"label": "Optimisation Windows gaming", "emoji": "🖥️", "price": "15 €"},
    "optim_pc": {"label": "Optimisation PC complet (bench avant/après)", "emoji": "⚙️", "price": "35 €"},
    "config_jeu": {"label": "Config FPS / ping (jeu ciblé)", "emoji": "🎮", "price": "10 €"},
    "install_bs": {"label": "Installation BoostStream (clé + app)", "emoji": "⚡", "price": "25 €"},
    "diagnostic": {"label": "Diagnostic matériel (stabilité, throttling)", "emoji": "🔧", "price": "5 €"},
    "autre": {"label": "Autre demande", "emoji": "❓", "price": "—"},
}

intents = discord.Intents.default()
intents.message_content = True
intents.members = True

bot = commands.Bot(command_prefix="!", intents=intents)


# ---------------------------------------------------------------------------
# Base de données
# ---------------------------------------------------------------------------

def init_db():
    con = sqlite3.connect(DB_PATH)
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS tickets (
            channel_id INTEGER PRIMARY KEY,
            user_id INTEGER NOT NULL,
            service TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'open',
            created_at TEXT NOT NULL
        )
        """
    )
    con.commit()
    con.close()


def save_ticket(channel_id: int, user_id: int, service: str):
    con = sqlite3.connect(DB_PATH)
    con.execute(
        "INSERT OR REPLACE INTO tickets (channel_id, user_id, service, status, created_at) "
        "VALUES (?, ?, ?, 'open', ?)",
        (channel_id, user_id, service, datetime.utcnow().isoformat()),
    )
    con.commit()
    con.close()


def get_ticket(channel_id: int):
    con = sqlite3.connect(DB_PATH)
    cur = con.execute("SELECT * FROM tickets WHERE channel_id = ?", (channel_id,))
    row = cur.fetchone()
    con.close()
    return row


def set_status(channel_id: int, status: str):
    con = sqlite3.connect(DB_PATH)
    con.execute("UPDATE tickets SET status = ? WHERE channel_id = ?", (status, channel_id))
    con.commit()
    con.close()


def close_ticket(channel_id: int):
    set_status(channel_id, "closed")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def get_staff_role(guild: discord.Guild) -> discord.Role | None:
    return guild.get_role(STAFF_ROLE_ID) or discord.utils.get(guild.roles, name="Staff")


def user_display(member: discord.Member) -> str:
    return f"{member.display_name} ({member.name})"


def slugify(name: str) -> str:
    keep = "".join(c for c in name.lower() if c.isalnum() or c in "-_")
    return keep or "ticket"


async def transcript(channel: discord.TextChannel, user: discord.Member, service: str, reason: str = ""):
    """Enregistre le contenu du ticket dans le salon de transcription."""
    target = channel.guild.get_channel(TRANSCRIPT_CHANNEL_ID)
    if target is None:
        return

    lines = [
        f"**Ticket clôturé** — `#{channel.name}`",
        f"Client : {user.mention}",
        f"Service : **{service}**",
        f"Fermé par : {user.mention}",
    ]
    if reason:
        lines.append(f"Motif : {reason}")
    lines.append("")
    lines.append("**Historique :**")

    async for msg in channel.history(limit=200, oldest_first=True):
        if msg.author.bot and msg.content == "" and not msg.embeds:
            continue
        content = msg.content or "[embed/fichier]"
        files = ""
        if msg.attachments:
            files = " " + " ".join(a.url for a in msg.attachments)
        lines.append(f"[{msg.created_at:%d/%m %H:%M}] **{msg.author.display_name}** : {content}{files}")

    transcript_text = "\n".join(lines)[:3800]
    await target.send(transcript_text)


# ---------------------------------------------------------------------------
# Événements
# ---------------------------------------------------------------------------

@bot.event
async def on_ready():
    init_db()
    await bot.tree.sync(guild=discord.Object(id=GUILD_ID))
    print(f"Bot connecte : {bot.user} (serveur {GUILD_ID})")


# ---------------------------------------------------------------------------
# Vue : menu de choix du service
# ---------------------------------------------------------------------------

class ServiceSelect(discord.ui.Select):
    def __init__(self):
        options = [
            discord.SelectOption(label=svc["label"], value=key, emoji=svc["emoji"])
            for key, svc in SERVICES.items()
        ]
        super().__init__(placeholder="Choisis un service…", min_values=1, max_values=1, options=options)

    async def callback(self, interaction: discord.Interaction):
        service_key = self.values[0]
        svc = SERVICES[service_key]
        guild = interaction.guild
        member = interaction.user

        # Un ticket ouvert existe déjà pour cet utilisateur ?
        existing = discord.utils.get(guild.text_channels, topic=f"ticket:{member.id}")
        if existing:
            await interaction.response.send_message(
                f"Tu as déjà un ticket ouvert : {existing.mention}", ephemeral=True
            )
            return

        overwrites = {
            guild.default_role: discord.PermissionOverwrite(view_channel=False),
            member: discord.PermissionOverwrite(view_channel=True, send_messages=True),
            guild.me: discord.PermissionOverwrite(view_channel=True, send_messages=True),
        }
        staff = await get_staff_role(guild)
        if staff:
            overwrites[staff] = discord.PermissionOverwrite(view_channel=True, send_messages=True)

        category = guild.get_channel(CATEGORY_ID)
        channel = await guild.create_text_channel(
            f"ticket-{slugify(member.display_name)[:20]}",
            category=category,
            topic=f"ticket:{member.id}",
            overwrites=overwrites,
        )

        save_ticket(channel.id, member.id, svc["label"])

        embed = discord.Embed(
            title="🎫 Nouveau ticket",
            description=(
                f"Client : {member.mention}\n"
                f"Service : **{svc['label']}** ({svc['price']})\n\n"
                "Décris ton besoin (jeu, matériel, budget) puis attends un membre du staff.\n"
                "**Paiement** : le staff t'enverra le montant et la méthode (PayPal/virement).\n"
                "Envoie ensuite la preuve de paiement ici."
            ),
            color=discord.Color.blue(),
        )
        await channel.send(content=member.mention, embed=embed)
        await channel.send(view=TicketActions())

        await interaction.response.send_message(f"Ticket créé : {channel.mention}", ephemeral=True)


class TicketPanel(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
        self.add_item(ServiceSelect())


class TicketActions(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="✅ Paiement reçu", style=discord.ButtonStyle.success, emoji="✅")
    async def paid(self, interaction: discord.Interaction, button: discord.ui.Button):
        staff = await get_staff_role(interaction.guild)
        if staff and staff not in interaction.user.roles:
            await interaction.response.send_message("Réservé au staff.", ephemeral=True)
            return
        row = get_ticket(interaction.channel.id)
        if row is None:
            await interaction.response.send_message("Ticket introuvable.", ephemeral=True)
            return
        client = interaction.guild.get_member(row[1])
        set_status(interaction.channel.id, "paid")
        if client and CLIENT_ROLE_ID:
            role = interaction.guild.get_role(CLIENT_ROLE_ID)
            if role and role not in client.roles:
                await client.add_roles(role, reason="Paiement confirmé")
        embed = discord.Embed(
            title="✅ Paiement confirmé",
            description="Le staff a confirmé le paiement. La livraison va commencer !",
            color=discord.Color.green(),
        )
        await interaction.response.send_message(embed=embed)

    @discord.ui.button(label="🔒 Fermer le ticket", style=discord.ButtonStyle.danger, emoji="🔒")
    async def close(self, interaction: discord.Interaction, button: discord.ui.Button):
        row = get_ticket(interaction.channel.id)
        if row is None:
            await interaction.response.send_message("Ticket introuvable.", ephemeral=True)
            return

        client = interaction.guild.get_member(row[1])

        # Ticket payé → attribuer le rôle VIP (client récurrent potentiel) ?
        # Le rôle Client est déjà donné au paiement ; on ne met pas VIP automatiquement.

        embed = discord.Embed(
            title="🔒 Fermeture du ticket",
            description="Le ticket va être fermé dans **10 secondes** et archivé.",
            color=discord.Color.dark_gray(),
        )
        await interaction.response.send_message(embed=embed)
        await asyncio.sleep(10)

        close_ticket(interaction.channel.id)
        await transcript(interaction.channel, client or interaction.user, row[2])
        await interaction.channel.delete()


# ---------------------------------------------------------------------------
# Commandes
# ---------------------------------------------------------------------------

@bot.tree.command(name="setup", description="Crée le panneau de tickets (staff uniquement)")
@app_commands.checks.has_permissions(administrator=True)
async def setup(interaction: discord.Interaction):
    embed = discord.Embed(
        title="🛒 Commander une optimisation",
        description=(
            "Choisis ton service dans le menu ci-dessous pour ouvrir un ticket.\n"
            "Un membre du staff s'occupera de ta commande et du paiement."
        ),
        color=discord.Color.brand_green(),
    )
    await interaction.channel.send(embed=embed, view=TicketPanel())
    await interaction.response.send_message("Panneau de tickets créé.", ephemeral=True)


@bot.tree.command(name="pay", description="Marque le ticket comme payé (staff)")
async def pay(interaction: discord.Interaction):
    staff = await get_staff_role(interaction.guild)
    if staff and staff not in interaction.user.roles:
        await interaction.response.send_message("Réservé au staff.", ephemeral=True)
        return
    row = get_ticket(interaction.channel.id)
    if row is None:
        await interaction.response.send_message("Ce salon n'est pas un ticket.", ephemeral=True)
        return
    client = interaction.guild.get_member(row[1])
    set_status(interaction.channel.id, "paid")
    if client and CLIENT_ROLE_ID:
        role = interaction.guild.get_role(CLIENT_ROLE_ID)
        if role and role not in client.roles:
            await client.add_roles(role, reason="Paiement confirmé")
    embed = discord.Embed(
        title="✅ Paiement confirmé",
        description="Le staff a confirmé le paiement. La livraison va commencer !",
        color=discord.Color.green(),
    )
    await interaction.response.send_message(embed=embed)


@bot.tree.command(name="close", description="Ferme le ticket courant")
async def close(interaction: discord.Interaction):
    row = get_ticket(interaction.channel.id)
    if row is None:
        await interaction.response.send_message("Ce salon n'est pas un ticket.", ephemeral=True)
        return
    staff = await get_staff_role(interaction.guild)
    if staff and staff not in interaction.user.roles and row[1] != interaction.user.id:
        await interaction.response.send_message("Non autorisé.", ephemeral=True)
        return
    client = interaction.guild.get_member(row[1])
    close_ticket(interaction.channel.id)
    await transcript(interaction.channel, client or interaction.user, row[2])
    await interaction.channel.delete()


@bot.tree.command(name="add", description="Ajoute un membre au ticket (staff)")
@app_commands.describe(member="Membre à ajouter")
async def add(interaction: discord.Interaction, member: discord.Member):
    staff = await get_staff_role(interaction.guild)
    if staff and staff not in interaction.user.roles:
        await interaction.response.send_message("Réservé au staff.", ephemeral=True)
        return
    await interaction.channel.set_permissions(member, view_channel=True, send_messages=True)
    await interaction.response.send_message(f"{member.mention} peut désormais voir ce ticket.")


@bot.tree.command(name="remove", description="Retire un membre du ticket (staff)")
@app_commands.describe(member="Membre à retirer")
async def remove(interaction: discord.Interaction, member: discord.Member):
    staff = await get_staff_role(interaction.guild)
    if staff and staff not in interaction.user.roles:
        await interaction.response.send_message("Réservé au staff.", ephemeral=True)
        return
    await interaction.channel.set_permissions(member, view_channel=False)
    await interaction.response.send_message(f"{member.mention} a été retiré du ticket.")


@setup.error
async def setup_error(interaction: discord.Interaction, error: app_commands.AppCommandError):
    if isinstance(error, app_commands.MissingPermissions):
        await interaction.response.send_message("Tu n'as pas la permission.", ephemeral=True)


if __name__ == "__main__":
    if not TOKEN:
        raise SystemExit("❌ DISCORD_TOKEN manquant dans .env")
    bot.run(TOKEN)
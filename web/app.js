const API = '';
const $ = (sel) => document.querySelector(sel);

function showModal(title, text) {
  $('#modal-title').textContent = title;
  $('#modal-text').textContent = text;
  $('#modal').classList.remove('hidden');
}

const closeModal = () => $('#modal').classList.add('hidden');
$('#modal-close')?.addEventListener('click', closeModal);
$('#modal-action')?.addEventListener('click', closeModal);
$('#modal')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

// Animations d'apparition au scroll
const revealEls = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window && revealEls.length) {
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        io.unobserve(entry.target);
      }
    }
  }, { threshold: 0.12 });
  revealEls.forEach((el, i) => {
    el.style.transitionDelay = `${(i % 3) * 0.08}s`;
    io.observe(el);
  });
} else {
  revealEls.forEach(el => el.classList.add('visible'));
}

// Achat via ticket Discord : ouvre un ticket sur le serveur au lieu de payer sur le site
const DISCORD_INVITE = 'https://discord.gg/xT5TTyrmdR';
function checkout(plan) {
  const label = plan === 'lifetime' ? 'À vie (49,99 €)' : 'Mensuel (9,99 €)';
  $('#modal-text').innerHTML = `
    <p class="muted">Plan choisi : <strong>${label}</strong></p>
    <p class="muted" style="margin-top:10px">Les achats se font désormais <strong>uniquement via un ticket Discord</strong>.</p>
    <ol class="ticket-steps" style="text-align:left;margin:14px auto;max-width:320px;color:var(--muted);font-size:14px;line-height:1.7">
      <li>Rejoins notre serveur Discord</li>
      <li>Ouvre un ticket (bouton « 🎫 Ouvrir un ticket »)</li>
      <li>Indique le plan choisi, le staff te répond</li>
      <li>Après paiement, ta clé est liée à ton compte Discord</li>
      <li>Ouvre VXMP Opti → « Se connecter avec Discord » → c'est débloqué</li>
    </ol>`;
  $('#modal-title').textContent = '💬 Achat via Discord';
  $('#modal').classList.remove('hidden');
  $('#modal-action').textContent = 'Ouvrir un ticket sur Discord';
  $('#modal-action').onclick = () => { window.open(DISCORD_INVITE, '_blank'); closeModal(); };
}

document.querySelectorAll('[data-plan]').forEach((btn) => {
  btn.addEventListener('click', () => checkout(btn.dataset.plan));
});

const form = $('#status-form');
if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = $('#key-input').value.trim();
    const err = $('#error');
    const result = $('#result');
    err.classList.add('hidden');
    result.classList.add('hidden');
    if (!key) return;
    try {
      const res = await fetch(`${API}/api/license/status?key=${encodeURIComponent(key)}`);
      const data = await res.json();
      if (!res.ok) return showModal('Clé introuvable', data.error || 'Cette clé n\'existe pas.');
      $('#lic-key').textContent = data.key;
      $('#lic-status').textContent = `Statut : ${data.expired ? 'expirée' : data.status}`;
      $('#lic-plan').textContent = `Plan : ${data.plan === 'lifetime' ? 'À vie' : 'Mensuel'}`;
      $('#lic-expiry').textContent = data.plan !== 'lifetime'
        ? `Expire le : ${new Date(data.expiresAt).toLocaleDateString('fr-FR')}`
        : 'Expiration : jamais';
      const tbody = $('#devices');
      tbody.innerHTML = '';
      if (data.devices.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="muted">Aucun appareil lié pour l\'instant.</td></tr>';
      } else {
        for (const d of data.devices) {
          const tr = document.createElement('tr');
          tr.innerHTML = `<td>${d.deviceName}</td><td><code>${d.hwid}</code></td>
            <td>${new Date(d.lastSeen).toLocaleString('fr-FR')}</td>`;
          tbody.appendChild(tr);
        }
      }
      $('#rebinds').textContent = `Ré-associations matérielles restantes : ${data.rebindsLeft}`;
      result.classList.remove('hidden');
    } catch (err) {
      showModal('Erreur', 'Impossible de contacter le serveur.');
    }
  });
}
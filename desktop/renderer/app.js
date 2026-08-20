const api = window.booststream;
const $ = (s) => document.querySelector(s);

// ---- Gestion du thème ----
const THEMES = ['red', 'spiderman', 'classic'];
function applyTheme(theme) {
  document.body.dataset.theme = theme;
  document.querySelectorAll('.swatch').forEach(s => s.classList.toggle('active', s.dataset.theme === theme));
  try { localStorage.setItem('booststream-theme', theme); } catch {}
}
document.querySelectorAll('.swatch').forEach((sw) => {
  sw.addEventListener('click', () => applyTheme(sw.dataset.theme));
});
let savedTheme = 'red';
try { savedTheme = localStorage.getItem('booststream-theme') || 'red'; } catch {}
if (!THEMES.includes(savedTheme)) savedTheme = 'red';
applyTheme(savedTheme);

function setMsg(el, text, type = '') {
  el.textContent = text;
  el.className = 'msg' + (type ? ' ' + type : '');
}

function showLicPill(status) {
  const pill = $('#lic-status-pill');
  pill.textContent = `Licence : ${status}`;
  pill.style.color = status === 'actif' ? 'var(--ok)' : 'var(--muted)';
}

// ---- Onglets ----
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $(`#tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// ---- Accueil : matériel + diagnostic ----
async function loadHome() {
  const hw = await api.hardware();
  if (hw.error) {
    $('#hw-summary').innerHTML = `<div class="error">Erreur détection matérielle : ${hw.error}</div>`;
    return;
  }
  const items = [
    ['Processeur', hw.cpu?.name || '—'],
    ['Cœurs / Threads', `${hw.cpu?.cores} / ${hw.cpu?.threads}`],
    ['Mémoire', `${hw.ramGB} Go`],
    ['GPU', (hw.gpu || []).map(g => g.name).join(', ') || '—'],
    ['Système', hw.os ? `${hw.os.caption} (${hw.os.build})` : '—'],
    ['PC', hw.pcName || '—'],
    ['Réseau', (hw.net || []).map(n => `${n.name} — ${n.linkSpeedMbps || '?'} Mbps`).join('<br>') || '—'],
    ['Stockage', (hw.disk || []).map ? '' : (hw.disks || []).map(d => d.model).join(', ') || '—']
  ];
  $('#hw-summary').innerHTML = items
    .map(([k, v]) => `<div class="hw-item"><div class="k">${k}</div><div class="v">${v}</div></div>`)
    .join('');

  const diag = await api.diagnose();
  $('#diagnose-list').innerHTML = diag.info.map(i => `<li class="info">${i}</li>`).join('') +
    diag.warnings.map(w => `<li class="warn">⚠ ${w}</li>`).join('');
  await checkAdmin();
}
$('#btn-rescan')?.addEventListener('click', loadHome);

async function checkAdmin() {
  const isAdmin = await api.isAdmin();
  const banner = $('#admin-banner');
  if (!isAdmin) {
    banner.textContent = '⚠ Certaines optimisations (services, plan d\'alimentation) nécessitent les droits administrateur. Une invite UAC s\'affichera automatiquement lors de l\'application.';
    banner.className = 'banner warn';
  } else {
    banner.textContent = '✓ Lancez l\'app en administrateur pour appliquer toutes les optimisations.';
    banner.className = 'banner';
    banner.classList.remove('hidden');
  }
}

// ---- Licence ----
$('#btn-activate')?.addEventListener('click', async () => {
  const key = $('#lic-key').value.trim();
  const msg = $('#lic-msg');
  if (!key) return setMsg(msg, 'Entrez votre clé.', 'err');
  setMsg(msg, 'Activation en cours…');
  const r = await api.activate({ key, deviceName: await api.hardware().then(h => h.pcName || 'PC') });
  if (r.ok) {
    setMsg(msg, 'Licence activée et liée à ce PC.', 'ok');
    showLicPill('actif');
    renderLicense(r.data.license);
  } else {
    const err = r.data?.error || 'Erreur inconnue';
    setMsg(msg, err, 'err');
    if (r.data?.code === 'max_devices') $('#btn-rebind').classList.remove('hidden');
  }
});

async function renderLicense(lic) {
  $('#lic-details').classList.remove('hidden');
  const isOwner = lic.owner || lic.plan === 'owner';
  const expiry = lic.plan === 'lifetime' || lic.plan === 'owner' ? 'jamais' : new Date(lic.expiresAt).toLocaleDateString('fr-FR');
  const planLabel = isOwner ? '👑 Propriétaire (gratuit à vie)' : (lic.plan === 'lifetime' ? 'À vie' : 'Mensuel');
  const devs = lic.devices.map(d => `<tr><td>${d.deviceName}</td><td><code>${d.hwid}</code></td><td>${new Date(d.lastSeen).toLocaleString('fr-FR')}</td></tr>`).join('');
  $('#lic-details').innerHTML = `
    <div class="owner-banner ${isOwner ? '' : 'hidden'}">👑 Tu es le propriétaire de VXMP Opti — accès gratuit, merci pour ton logiciel !</div>
    <h3>${lic.key}</h3>
    <table class="kv-table">
      <tr><td>Statut</td><td>${isOwner ? 'Propriétaire' : (lic.expired ? 'expirée' : lic.status)}</td></tr>
      <tr><td>Plan</td><td>${planLabel}</td></tr>
      <tr><td>Expiration</td><td>${expiry}</td></tr>
      <tr><td>Ré-associations restantes</td><td>${lic.rebindsLeft}</td></tr>
    </table>
    <h4 style="margin-top:14px">Appareils liés (${lic.devices.length}/${lic.maxDevices})</h4>
    <table class="kv-table">
      <thead><tr><td>Appareil</td><td>HWID</td><td>Activité</td></tr></thead>
      <tbody>${devs || '<tr><td colspan="3" class="muted">Aucun appareil.</td></tr>'}</tbody>
    </table>`;
}

$('#btn-rebind')?.addEventListener('click', async () => {
  const msg = $('#lic-msg');
  setMsg(msg, 'Ré-association en cours…');
  const r = await api.rebind();
  if (r.ok) {
    setMsg(msg, 'Clé ré-associée à ce PC.', 'ok');
    $('#btn-rebind').classList.add('hidden');
    const v = await api.verify();
    if (v.ok) renderLicense(v.data.license);
  } else {
    setMsg(msg, r.data?.error || 'Erreur de ré-association.', 'err');
  }
});

$('#btn-discord-login')?.addEventListener('click', async () => {
  const msg = $('#lic-msg');
  setMsg(msg, 'Ouverture de la connexion Discord…');
  const r = await api.discordLogin();
  if (r.ok) {
    setMsg(msg, `Licence activée via Discord (${r.key}).`, 'ok');
    showLicPill('actif');
    const v = await api.verify();
    if (v.ok) renderLicense(v.data.license);
  } else {
    setMsg(msg, r.detail || 'Échec de la connexion Discord.', 'err');
  }
});

async function refreshLicense() {
  const local = await api.localLicense();
  if (!local) return;
  const r = await api.verify();
  if (r.ok) { showLicPill('actif'); renderLicense(r.data.license); }
  else showLicPill(r.data?.error || 'inactive');
}
refreshLicense();

// ---- Optimisation ----
async function loadTweaks() {
  const tweaks = await api.tweaks();
  const applied = await api.appliedTweaks();
  $('#tweak-list').innerHTML = tweaks.map(t => `
    <label class="tweak ${applied.includes(t.id) ? 'applied' : ''}">
      <input type="checkbox" value="${t.id}" ${applied.includes(t.id) ? 'checked' : ''}>
      <div>
        <div class="label">${t.label} ${applied.includes(t.id) ? '<span style="color:var(--ok)">✓ appliqué</span>' : ''}</div>
        <div class="desc">${t.description}</div>
      </div>
      <span class="cat">${t.category}</span>
    </label>`).join('');
}
loadTweaks();

$('#btn-apply')?.addEventListener('click', async () => {
  const msg = $('#opt-msg');
  const ids = [...document.querySelectorAll('#tweak-list input:checked')].map(i => i.value);
  if (!ids.length) return setMsg(msg, 'Sélectionnez au moins un réglage.', 'err');
  setMsg(msg, 'Application en cours (UAC possible)…');
  const r = await api.applyTweaks(ids);
  if (!r.ok && r.error === 'admin_required') {
    setMsg(msg, 'Élévation administrateur refusée. Relancez l\'app en administrateur.', 'err');
    return;
  }
  if (r.ok) {
    renderResults(r.results);
    setMsg(msg, 'Optimisations appliquées.', 'ok');
    loadTweaks();
  } else {
    setMsg(msg, 'Échec de l\'application.', 'err');
  }
});

$('#btn-revert')?.addEventListener('click', async () => {
  const msg = $('#opt-msg');
  setMsg(msg, 'Rétablissement des valeurs d\'origine…');
  const r = await api.revertTweaks();
  if (r.ok) {
    renderResults(r.results);
    setMsg(msg, 'Valeurs d\'origine restaurées.', 'ok');
    loadTweaks();
  } else {
    setMsg(msg, r.detail || 'Échec du rétablissement.', 'err');
  }
});

function renderResults(results) {
  const box = $('#opt-results');
  box.classList.remove('hidden');
  box.innerHTML = results.map(r => `
    <div class="result-item ${r.ok ? 'ok' : 'fail'}">
      <span class="mark">${r.ok ? '✓' : '✗'}</span>
      <span>${r.detail || r.id}</span>
    </div>`).join('');
}

// ---- OBS ----
$('#btn-generate')?.addEventListener('click', async () => {
  const el = $('#obs-preset');
  el.classList.remove('hidden');
  el.innerHTML = '<p class="muted">Génération (avec test de débit automatique)…</p>';
  const preset = await api.obsPreset();
  const fields = [
    ['Encodeur', preset.encoderLabel],
    ['Résolution de base / sortie', `${preset.baseResolution} à ${preset.fps} fps`],
    ['Bitrate vidéo', `${preset.videoBitrate} kbps (CBR)`],
    ['Bitrate audio', `${preset.audioBitrate} kbps`],
    ['Intervalle de keyframes', `${preset.keyint} (2 s)`],
    ['Présélection', preset.presetName]
  ];
  el.innerHTML = `
    <h3>Réglages OBS recommandés</h3>
    ${fields.map(([k, v]) => `<div class="obs-field"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')}
    <h4 style="margin-top:12px">Pourquoi ?</h4>
    <ul class="diagnose">${preset.rationale.map(r => `<li class="info">${r}</li>`).join('')}</ul>
    <p class="muted" style="margin-top:12px">💡 Dans OBS : Paramètres → Sortie → Mode "Avancé" puis reportez ces valeurs dans l'onglet "Streaming".</p>`;
});

$('#btn-test-speed')?.addEventListener('click', async () => {
  const el = $('#speed-result');
  el.classList.remove('hidden');
  el.innerHTML = '<p class="muted">Test en cours… (téléchargement de 10 Mo)</p>';
  const t = await api.speedTest();
  el.innerHTML = t.downloadMbps != null
    ? `<div class="obs-field"><div class="k">Débit descendant</div><div class="v">${t.downloadMbps} Mbps</div></div>
       <div class="obs-field"><div class="k">Ping</div><div class="v">${t.pingMs ?? '—'} ms</div></div>
       <p class="muted">⚠ Ce test mesure le débit descendant. Pour streamer, c'est le débit <strong>montant</strong> qui compte (environ 60-85% du descendant).</p>`
    : '<p class="error">Test impossible (serveur de test injoignable).</p>';
});

// ---- Réseau ----
$('#btn-speed-only')?.addEventListener('click', async () => {
  const el = $('#speed-only');
  el.classList.remove('hidden');
  el.innerHTML = '<p class="muted">Test en cours…</p>';
  const t = await api.speedTest();
  el.innerHTML = t.downloadMbps != null
    ? `<div class="obs-field"><div class="k">Débit descendant</div><div class="v">${t.downloadMbps} Mbps</div></div>
       <div class="obs-field"><div class="k">Ping</div><div class="v">${t.pingMs ?? '—'} ms</div></div>`
    : '<p class="error">Test impossible.</p>';
});

// ---- Carte graphique ----
async function loadGpu() {
  const info = await api.gpuInfo();
  const badges = $('#gpu-badges');
  const cards = $('#gpu-cards');
  if (!info.ok) {
    cards.innerHTML = `<div class="error">${info.detail || 'Erreur de détection GPU'}</div>`;
    return;
  }
  const brands = {
    nvidia: { label: 'NVIDIA', color: 'var(--ok)' },
    amd: { label: 'AMD', color: 'var(--danger)' },
    intel: { label: 'Intel', color: 'var(--blue, var(--accent))' },
    other: { label: 'Inconnu', color: 'var(--muted)' }
  };
  const b = brands[info.brand] || brands.other;
  badges.innerHTML = `<div class="gpu-badge" style="border-color:${b.color}">${b.label} détecté</div>`;
  cards.innerHTML = (info.gpu || []).map(g => `
    <div class="hw-item">
      <div class="k">GPU</div><div class="v">${g.name}</div>
      <div class="k" style="margin-top:10px">Pilote</div><div class="v">${g.driver || '—'}</div>
      <div class="k" style="margin-top:10px">VRAM</div><div class="v">${g.vramMB > 0 ? Math.round(g.vramMB) + ' Mo' : '—'}</div>
    </div>`).join('') || '<p class="muted">Aucun GPU détecté.</p>';
  renderGpuBest(info.brand);
}
loadGpu();

$('#btn-gpu-panel')?.addEventListener('click', async () => {
  const r = await api.gpuOpenPanel();
  setMsg($('#gpu-msg'), r.detail, r.ok ? 'ok' : 'err');
});

$('#btn-gpu-smi')?.addEventListener('click', async () => {
  const el = $('#gpu-smi');
  el.classList.remove('hidden');
  el.innerHTML = '<p class="muted">Lecture nvidia-smi…</p>';
  const r = await api.gpuNvidiaSmi();
  if (!r.ok) { el.innerHTML = `<p class="error">${r.detail}</p>`; return; }
  el.innerHTML = (r.gpus || []).map(g => `
    <div class="obs-field"><div class="k">${g.name} (${g.driver})</div></div>
    <div class="obs-field"><div class="k">Température</div><div class="v">${g.temp}</div></div>
    <div class="obs-field"><div class="k">Utilisation</div><div class="v">${g.util}</div></div>
    <div class="obs-field"><div class="k">Mémoire</div><div class="v">${g.vramUsed} / ${g.vramTotal}</div></div>
    <div class="obs-field"><div class="k">Puissance</div><div class="v">${g.power}</div></div>`).join('') || '<p class="muted">Aucune donnée.</p>';
});

// ---- Meilleures paramètres (Panneau NVIDIA / AMD Radeon) ----
const BEST_SETTINGS = {
  nvidia: {
    title: 'Meilleures paramètres NVIDIA Control Panel',
    note: 'Les réglages 3D se valident dans le panneau : Réglages 3D → Gérer les paramètres 3D → Appliquer. Vxamp Opti active déjà ce qui est applicable automatiquement ci-dessous.',
    list: [
      ['Mode gestion de l\'alimentation', 'Préférer les performances maximales'],
      ['Mode de faible latence', 'Ultra'],
      ['Synchronisation verticale', 'Désactivée'],
      ['Optimisation multithread', 'Activée'],
      ['Filtrage de textures – qualité', 'Haute performance'],
      ['Stockage du cache de shaders', 'Activé'],
      ['Fréquence de rafraîchissement préférée', 'La plus élevée disponible'],
      ['Texel / optimisation trilinéaire', 'Activée']
    ]
  },
  amd: {
    title: 'Meilleures paramètres AMD Radeon (Adrenalin)',
    note: 'Ouverture : AMD Software Adrenalin → Jeux → Réglages graphiques → Appliquer. Vxamp Opti active déjà ce qui est applicable automatiquement ci-dessous.',
    list: [
      ['Radeon Anti-Lag', 'Activé'],
      ['Radeon Boost', 'Activé'],
      ['Synchronisation verticale', 'Toujours désactivée'],
      ['Mode d\'économie d\'énergie', 'Désactivé (Performances)'],
      ['Image Sharpening', 'Activé (80%)'],
      ['Filtrage anisotropique', 'x16'],
      ['Limiteur FPS (FRTC)', 'Selon le refresh de ton écran'],
      ['Découpage des images', 'Activé']
    ]
  },
  intel: {
    title: 'Paramètres Intel Arc',
    note: 'Ouvre Intel Arc Control → Performances et applique le profil « Jeu » recommandé.',
    list: [
      ['Mode de performances', 'Profil « Jeu »'],
      ['Résolution', 'Native'],
      ['XeSS', 'Activé si pris en charge par le jeu']
    ]
  }
};

function renderGpuBest(brandKey) {
  const el = $('#gpu-best');
  const best = BEST_SETTINGS[brandKey] || BEST_SETTINGS.intel;
  el.innerHTML = `
    <div class="card">
      <h3>${best.title}</h3>
      <p class="muted">${best.note}</p>
      <table class="best-table">
        ${best.list.map(([k, v]) => `<tr><td>${k}</td><td class="val">${v}</td></tr>`).join('')}
      </table>
      <div class="actions">
        <button id="btn-gpu-best-apply" class="btn">🛠 Appliquer les réglages système compatibles</button>
        <button id="btn-gpu-panel-2" class="btn">🖥️ Ouvrir le panneau</button>
      </div>
      <div id="gpu-best-msg" class="msg"></div>
      <div id="gpu-best-results"></div>
    </div>`;
  $('#btn-gpu-best-apply')?.addEventListener('click', async () => {
    const msg = $('#gpu-best-msg');
    const res = $('#gpu-best-results');
    msg.textContent = 'Application des réglages système… (élévation requise)';
    const r = await api.gpuApplyBest();
    if (!r.ok) { msg.textContent = r.detail || 'Échec de l\'application.'; return; }
    msg.textContent = 'Réglages système appliqués.';
    res.innerHTML = r.results.map(x => `
      <div class="result-item ${x.ok ? 'ok' : 'fail'}">
        <span class="mark">${x.ok ? '✓' : '✗'}</span>
        <span>${x.detail}</span>
      </div>`).join('');
  });
  $('#btn-gpu-panel-2')?.addEventListener('click', async () => {
    const r = await api.gpuOpenPanel();
    setMsg($('#gpu-best-msg'), r.detail, r.ok ? 'ok' : 'err');
  });
}

// ---- BIOS ----
async function loadBios() {
  const info = await api.systemBios();
  const box = $('#bios-cards');
  const msg = $('#bios-msg');
  if (!info.ok) { box.innerHTML = `<div class="error">${info.detail}</div>`; return; }
  const fmtDate = (d) => d ? String(d).slice(0, 10) : '—';
  const items = [
    ['Carte mère', info.board ? `${info.board.manufacturer} ${info.board.product}` : '—'],
    ['Numéro de série', info.board?.serial || '—'],
    ['BIOS', info.bios ? `${info.bios.manufacturer} ${info.bios.smbiosVersion}` : '—'],
    ['Version BIOS', info.bios?.version || '—'],
    ['Date de sortie', fmtDate(info.bios?.releaseDate)],
    ['Type de firmware', info.firmware],
    ['Type d\'appareil', ['—', 'Bureau', 'Portable', 'Station de travail', 'Serveur'][info.systemType] || '—'],
    ['Système', info.os ? `${info.os.caption} (${info.os.build})` : '—']
  ];
  box.innerHTML = items.map(([k, v]) => `<div class="hw-item"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  msg.className = 'msg';
  msg.textContent = '💡 Une mise à jour BIOS se fait depuis le site du fabricant de la carte mère.';
}
loadBios();

$('#btn-msinfo')?.addEventListener('click', async () => {
  const r = await api.openMsInfo();
  const msg = $('#bios-msg');
  setMsg(msg, r.detail, r.ok ? 'ok' : 'err');
});
$('#btn-bios-refresh')?.addEventListener('click', loadBios);

// ---- Alimentation ----
async function loadPower() {
  const info = await api.powerInfo();
  const cur = $('#alim-current');
  const schemesBox = $('#alim-schemes');
  const msg = $('#alim-msg');
  if (!info.ok) { cur.innerHTML = `<div class="error">${info.detail}</div>`; return; }

  cur.innerHTML = `
    <div class="obs-field"><div class="k">Plan actif</div><div class="v">${info.active ? info.active.name : '—'}</div></div>
    ${info.battery ? `
      <div class="obs-field"><div class="k">Batterie</div><div class="v">${info.battery.chargePercent} %</div></div>
      <div class="obs-field"><div class="k">Autonomie estimée</div><div class="v">${info.battery.runtimeMin != null && info.battery.runtimeMin < 4294967295 ? info.battery.runtimeMin + ' min' : 'branchement secteur'}</div></div>` : ''}
    <div class="bar-track"><div class="bar-fill" style="width:${info.battery ? info.battery.chargePercent : 100}%"></div></div>`;

  schemesBox.innerHTML = (info.schemes || []).map(s => `
    <label class="scheme ${s.active ? 'active' : ''}">
      <input type="radio" name="scheme" value="${s.guid}" ${s.active ? 'checked' : ''}>
      <span class="scheme-name">${s.name}</span>
      ${s.active ? '<span class="scheme-tag">actif</span>' : ''}
    </label>`).join('') || '<p class="muted">Aucun plan trouvé.</p>';

  schemesBox.querySelectorAll('input[name="scheme"]').forEach(inp => {
    inp.addEventListener('change', async () => {
      setMsg(msg, 'Application du plan…');
      const r = await api.powerSet(inp.value);
      setMsg(msg, r.detail, r.ok ? 'ok' : 'err');
      if (r.ok) loadPower();
    });
  });
}
loadPower();

$('#btn-ultra')?.addEventListener('click', async () => {
  const msg = $('#alim-msg');
  setMsg(msg, 'Création et activation du plan Ultimate Performance…');
  const r = await api.powerUltra();
  setMsg(msg, r.detail, r.ok ? 'ok' : 'err');
  if (r.ok) loadPower();
});
$('#btn-no-sleep')?.addEventListener('click', async () => {
  const msg = $('#alim-msg');
  const r = await api.powerNoSleep();
  setMsg(msg, r.detail, r.ok ? 'ok' : 'err');
});
$('#btn-disk-off')?.addEventListener('click', async () => {
  const msg = $('#alim-msg');
  const r = await api.powerDiskOff();
  setMsg(msg, r.detail, r.ok ? 'ok' : 'err');
});
$('#btn-monitor-15')?.addEventListener('click', async () => {
  const msg = $('#alim-msg');
  const r = await api.powerMonitor(15);
  setMsg(msg, r.detail, r.ok ? 'ok' : 'err');
});
$('#btn-monitor-never')?.addEventListener('click', async () => {
  const msg = $('#alim-msg');
  const r = await api.powerMonitor(0);
  setMsg(msg, r.detail, r.ok ? 'ok' : 'err');
});

// ---- Post install (assistant) ----
const GAMES = [
  { name: 'Counter-Strike 2', tip: 'Pilote NVIDIA à jour + désactiver les optimisations plein écran pour éviter les micro-saccades.' },
  { name: 'Valorant', tip: 'Riot impose son anti-triche : garde Windows Update actif, applique le plan haute performance.' },
  { name: 'Fortnite', tip: 'Mode performance + pilote à jour = gros gain de FPS. Désactive le Game DVR.' },
  { name: 'Apex Legends', tip: 'Activateur : pilote récent + plan haute performance.' },
  { name: 'Call of Duty / Warzone', tip: 'Très demandeur : GPU scheduling activé + pilote le plus récent.' },
  { name: 'Minecraft', tip: 'CPU-bound : utilise un encodeur GPU pour le stream, désactive les services inutiles.' },
  { name: 'Rocket League', tip: 'Régulier : profite d\'un preset 1080p60 sans effort.' },
  { name: 'GTA V', tip: 'Réduis la distance d\'affichage si besoin, GPU scheduling recommandé.' },
  { name: 'League of Legends', tip: 'Très léger : baisse la limite de FPS pour garder des ressources pour OBS.' },
  { name: 'Rainbow Six Siege', tip: 'Vulkan + pilote à jour. Désactive la Game Bar.' },
  { name: 'Overwatch 2', tip: 'Stable 144 fps visé : plan haute performance + pilote NVIDIA.' },
  { name: 'Genshin Impact', tip: 'VRAM importante requise : vérifie les perfs GPU avant d\'encoder.' }
];
const chosenGames = new Set();
try { JSON.parse(localStorage.getItem('booststream-games') || '[]').forEach(g => chosenGames.add(g)); } catch {}

function buildGameGrid() {
  $('#pi-games').innerHTML = GAMES.map(g => `
    <button class="game-chip ${chosenGames.has(g.name) ? 'selected' : ''}" data-game="${g.name}">
      🎮 ${g.name}
    </button>`).join('');
  document.querySelectorAll('.game-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const name = chip.dataset.game;
      if (chosenGames.has(name)) chosenGames.delete(name);
      else chosenGames.add(name);
      chip.classList.toggle('selected', chosenGames.has(name));
    });
  });
}

let piSelected = new Set();
async function buildDisableList() {
  const [actions, applied] = await Promise.all([api.postinstallList(), api.postinstallApplied()]);
  actions.forEach(a => { if (applied.includes(a.id)) piSelected.add(a.id); });
  $('#pi-disable-list').innerHTML = actions.map(a => `
    <label class="tweak ${applied.includes(a.id) ? 'applied' : ''}">
      <input type="checkbox" value="${a.id}" ${applied.includes(a.id) ? 'checked' : ''}>
      <div>
        <div class="label">${a.label}</div>
        <div class="desc">${a.description}</div>
      </div>
      <span class="cat">${a.category}</span>
    </label>`).join('');
  $('#pi-disable-list').querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', () => {
      if (inp.checked) piSelected.add(inp.value); else piSelected.delete(inp.value);
    });
  });
}

async function loadDriverStep() {
  const info = await api.driverInfo();
  const el = $('#pi-driver');
  if (!info.ok) { el.innerHTML = `<div class="error">${info.detail}</div>`; return; }
  const installed = info.driverInstalled
    ? `<span class="ok-text">✓ Pilote installé : <strong>${info.currentDriver}</strong></span>`
    : `<span class="error-text">✗ Aucun pilote officiel détecté (périphérique de base)</span>`;
  el.innerHTML = `
    <div class="obs-field"><div class="k">Carte graphique</div><div class="v">${info.name}</div></div>
    <div class="obs-field"><div class="k">Pilote actuel</div><div class="v">${info.currentDriver || '—'}</div></div>
    <div class="obs-field"><div class="k">État</div><div class="v">${installed}</div></div>
    <div class="actions">
      <button id="drv-check" class="btn btn-primary">🔎 Vérifier le dernier pilote</button>
      <button id="drv-page" class="btn">🌐 Ouvrir la page officielle</button>
    </div>
    <div id="drv-latest" class="drv-latest"></div>`;

  $('#drv-page').addEventListener('click', async () => {
    const r = await api.driverOpenPage();
    $('#drv-latest').innerHTML = `<p class="${r.ok ? 'ok-text' : 'error-text'}">${r.detail}</p>`;
  });

  $('#drv-check').addEventListener('click', async () => {
    const box = $('#drv-latest');
    box.innerHTML = '<p class="muted">Recherche du dernier pilote…</p>';
    const r = await api.driverCheck();
    if (!r.ok) { box.innerHTML = `<p class="error-text">${r.detail}</p>`; return; }
    if (r.latest) {
      box.innerHTML = `
        <div class="obs-field"><div class="k">Dernier pilote disponible</div><div class="v">${r.latest.version} (${r.latest.branch})</div></div>
        <div class="obs-field"><div class="k">Taille</div><div class="v">${r.latest.size || '—'}</div></div>
        <button id="drv-download" class="btn btn-primary">⬇️ Télécharger ce pilote</button>
        <div id="drv-dl-status" class="msg"></div>`;
      $('#drv-download').addEventListener('click', async () => {
        const st = $('#drv-dl-status');
        st.textContent = 'Téléchargement en cours… (fichier volumineux, soyez patient)';
        st.className = 'msg';
        const dl = await api.driverDownload();
        if (!dl.ok) {
          st.textContent = dl.detail;
          st.className = 'msg err';
          return;
        }
        st.innerHTML = `✅ Téléchargé : <code>${dl.dest}</code>`;
        st.className = 'msg ok';
        const btn = document.createElement('button');
        btn.className = 'btn btn-primary';
        btn.textContent = '🚀 Lancer l\'installation du pilote';
        btn.style.marginTop = '10px';
        btn.addEventListener('click', async () => {
          const inst = await api.driverInstall(dl.dest);
          st.innerHTML = inst.detail;
          st.className = inst.ok ? 'msg ok' : 'msg err';
        });
        st.appendChild(btn);
      });
    } else {
      box.innerHTML = `<p class="muted">Pas d\'API NVIDIA accessible. ${r.page ? '<button id="drv-page2" class="btn" style="margin-top:8px">Ouvrir la page officielle</button>' : ''}</p>`;
      const p2 = $('#drv-page2');
      if (p2) p2.addEventListener('click', () => api.driverOpenPage());
    }
  });
}

function buildSummary() {
  const games = [...chosenGames];
  const disables = [...piSelected];
  const gameNames = GAMES.filter(g => games.includes(g.name));
  $('#pi-summary').innerHTML = `
    <div class="obs-field"><div class="k">🎮 Jeu(x) choisi(s)</div><div class="v">${games.length ? games.join(', ') : 'Aucun sélectionné'}</div></div>
    ${games.length ? gameNames.map(g => `<div class="obs-field"><div class="k">💡 Conseil ${g.name}</div><div class="v">${g.tip}</div></div>`).join('') : ''}
    <div class="obs-field"><div class="k">🪟 Désactivations Windows</div><div class="v">${disables.length ? disables.join(', ') : 'Aucune'}</div></div>`;
}

function wizardGo(step) {
  document.querySelectorAll('.wz-step-body').forEach(b => b.classList.toggle('hidden', Number(b.dataset.step) !== step));
  document.querySelectorAll('.wz-step').forEach((s, i) => s.classList.toggle('active', i + 1 === step));
}

function buildPostInstall() {
  buildGameGrid();
  buildDisableList();
  loadDriverStep();

  $('#pi-games-next').addEventListener('click', () => { wizardGo(2); });
  $('#pi-disable-next').addEventListener('click', () => { wizardGo(3); });
  $('#pi-driver-next').addEventListener('click', () => { buildSummary(); wizardGo(4); });
  document.querySelectorAll('[data-wz-prev]').forEach(b => b.addEventListener('click', () => {
    const cur = document.querySelector('.wz-step-body:not(.hidden)');
    wizardGo(Math.max(1, Number(cur.dataset.step) - 1));
  }));

  $('#pi-apply').addEventListener('click', async () => {
    const msg = $('#pi-msg');
    setMsg(msg, 'Application en cours (UAC possible)…');
    localStorage.setItem('booststream-games', JSON.stringify([...chosenGames]));
    const r = await api.postinstallApply([...piSelected]);
    if (!r.ok) { setMsg(msg, r.detail || 'Échec', 'err'); return; }
    renderResults(r.results);
    setMsg(msg, 'Optimisations post-install appliquées.', 'ok');
    buildDisableList();
  });

  $('#pi-revert').addEventListener('click', async () => {
    const msg = $('#pi-msg');
    setMsg(msg, 'Rétablissement…');
    const r = await api.postinstallRevert();
    if (r.ok) { renderResults(r.results); setMsg(msg, 'Désactivations annulées.', 'ok'); buildDisableList(); }
    else setMsg(msg, r.detail || 'Échec', 'err');
  });
}

buildPostInstall();

// ---- Jeux (application auto des meilleurs paramètres) ----
const chosenGamesForApply = new Set();

function gameCover(g) {
  if (g.steam) {
    return `<img class="game-cover" src="https://cdn.cloudflare.steamstatic.com/steam/apps/${g.steam}/header.jpg"
             alt="${g.name}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'">`;
  }
  return `<div class="game-cover emoji-cover">${g.emoji || '🎮'}</div>`;
}

async function buildGamesList() {
  const list = await api.gamesList();
  $('#games-list').innerHTML = list.map(g => `
    <label class="game-card ${chosenGamesForApply.has(g.name) ? 'selected' : ''}">
      <input type="checkbox" value="${g.name}" ${chosenGamesForApply.has(g.name) ? 'checked' : ''}>
      <div class="game-cover-wrap">${gameCover(g)}</div>
      <div class="game-body">
        <div class="game-name">${g.name} ${g.profile ? '<span class="game-badge">⚙ profil auto</span>' : ''}</div>
        <div class="game-exe"><code>${g.exe}</code></div>
        <div class="game-settings">${g.settings}</div>
      </div>
      <span class="game-check">✓</span>
    </label>`).join('');

  $('#games-list').querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', () => {
      if (inp.checked) chosenGamesForApply.add(inp.value);
      else chosenGamesForApply.delete(inp.value);
      inp.closest('.game-card').classList.toggle('selected', inp.checked);
    });
  });
}
buildGamesList();

$('#btn-games-apply')?.addEventListener('click', async () => {
  const msg = $('#games-msg');
  const names = [...chosenGamesForApply];
  if (!names.length) return setMsg(msg, 'Sélectionne au moins un jeu.', 'err');
  setMsg(msg, 'Application des meilleurs paramètres… (UAC possible)');
  const r = await api.gamesApply(names);
  if (!r.ok) return setMsg(msg, r.detail || 'Échec', 'err');
  renderResults(r.results);
  setMsg(msg, 'Paramètres appliqués aux jeux sélectionnés.', 'ok');
});

$('#btn-games-revert')?.addEventListener('click', async () => {
  const msg = $('#games-msg');
  const names = [...chosenGamesForApply];
  if (!names.length) return setMsg(msg, 'Sélectionne au moins un jeu.', 'err');
  setMsg(msg, 'Restauration…');
  const r = await api.gamesRevert(names);
  if (!r.ok) return setMsg(msg, r.detail || 'Échec', 'err');
  renderResults(r.results);
  setMsg(msg, 'Valeurs par défaut restaurées.', 'ok');
});

loadHome();
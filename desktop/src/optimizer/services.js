const { run } = require('./system');

const SERVICE_TWEAKS = [
  {
    id: 'svc_sysmain',
    category: 'services',
    label: 'Désactiver SysMain (Superfetch)',
    description: 'Réduit l\'activité disque en arrière-plan (recommandé sur SSD).',
    service: 'SysMain'
  },
  {
    id: 'svc_diagtrack',
    category: 'services',
    label: 'Désactiver DiagTrack (télémétrie)',
    description: 'Coupe la télémétrie Windows qui consomme des ressources.',
    service: 'DiagTrack'
  },
  {
    id: 'svc_dmwappush',
    category: 'services',
    label: 'Désactiver dmwappushservice',
    description: 'Coupe un service de push Windows inutile pour le streaming.',
    service: 'dmwappushservice'
  },
  {
    id: 'svc_mapsbroker',
    category: 'services',
    label: 'Désactiver MapsBroker',
    description: 'Désactive le téléchargement des cartes en arrière-plan.',
    service: 'MapsBroker'
  },
  {
    id: 'svc_retaildemo',
    category: 'services',
    label: 'Désactiver RetailDemo',
    description: 'Désactive le mode démo des magasins.',
    service: 'RetailDemo'
  }
];

async function queryService(service) {
  const r = await run('sc', ['qc', service]);
  if (!r.ok) return null;
  const m = r.stdout.match(/START_TYPE\s*:\s*(\d+)\s+(\S+)/i) || r.stdout.match(/START_TYPE\s+:\s+(\d+)/i);
  const s = r.stdout.match(/STATE\s+:\s+(\d+)\s+(\S+)/i);
  return {
    startType: m ? parseInt(m[1], 10) : null,
    startName: m ? m[2] : null,
    running: s ? parseInt(s[1], 10) === 4 : false
  };
}

async function applyServices(tweaks, state) {
  const results = [];
  state.applied = state.applied || {};
  for (const t of SERVICE_TWEAKS) {
    if (!tweaks.includes(t.id) || state.applied[t.id]) continue;
    const prev = await queryService(t.service);
    if (!prev) {
      results.push({ id: t.id, ok: false, detail: `Service ${t.service} introuvable` });
      continue;
    }
    state.applied[t.id] = { service: t.service, startType: prev.startType, running: prev.running };
    const r = await run('sc', ['config', t.service, 'start=', 'disabled']);
    const st = await run('sc', ['stop', t.service]);
    results.push({
      id: t.id,
      ok: r.ok,
      detail: r.ok ? `${t.service} désactivé` : r.stderr
    });
  }
  return results;
}

async function revertServices(state) {
  const results = [];
  const applied = state.applied || {};
  for (const id of Object.keys(applied)) {
    const item = applied[id];
    if (!item || !item.service) continue;
    const prevStart = item.startType ?? 3; // 3 = auto (défaut)
    const r = await run('sc', ['config', item.service, 'start=', String(prevStart)]);
    if (item.running) await run('sc', ['start', item.service]);
    results.push({ id, ok: r.ok, detail: r.ok ? `${item.service} restauré` : r.stderr });
    delete applied[id];
  }
  return results;
}

module.exports = { SERVICE_TWEAKS, applyServices, revertServices };
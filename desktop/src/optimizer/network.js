const { run, regQuery, regSet, regDelete, HKCU } = require('./system');

const NETWORK_TWEAKS = [
  {
    id: 'tcp_autotune',
    category: 'réseau',
    label: 'Réglage automatique TCP optimal',
    description: 'Ajuste l\'autotuning TCP pour un débit stable en streaming.'
  },
  {
    id: 'nagle_disable',
    category: 'réseau',
    label: 'Réduire la latence (désactiver Nagle)',
    description: 'Diminue le temps de latence pour OBS et les jeux.'
  },
  {
    id: 'dns_cloudflare',
    category: 'réseau',
    label: 'DNS rapide (1.1.1.1 Cloudflare)',
    description: 'Résolution DNS plus rapide et fiable.'
  }
];

async function applyNetwork(tweaks, state, hardwareInfo) {
  const results = [];
  state.applied = state.applied || {};

  if (tweaks.includes('tcp_autotune') && !state.applied.tcp_autotune) {
    const show = await run('netsh', ['int', 'tcp', 'show', 'global']);
    const m = show.stdout.match(/autotuninglevel\s*:\s*(\S+)/i) || show.stdout.match(/Receiving-Window\s+Auto-Tuning\s+Level\s*:\s*(\S+)/i);
    state.applied.tcp_autotune = { previous: m ? m[1] : 'normal' };
    const r = await run('netsh', ['int', 'tcp', 'set', 'global', 'autotuninglevel=normal']);
    results.push({ id: 'tcp_autotune', ok: r.ok, detail: r.ok ? 'Autotuning TCP configuré' : r.stderr });
  }

  if (tweaks.includes('nagle_disable') && !state.applied.nagle_disable) {
    const path = HKCU('Software\\Microsoft\\Windows\\CurrentVersion\\InternetSettings');
    const ack = await regQuery(path, 'TcpAckFrequency');
    state.applied.nagle_disable = { ack, delay: await regQuery(path, 'TCPNoDelay') };
    const r1 = await regSet(path, 'TcpAckFrequency', 1);
    const r2 = await regSet(path, 'TCPNoDelay', 1);
    results.push({ id: 'nagle_disable', ok: r1.ok && r2.ok, detail: (r1.ok && r2.ok) ? 'Nagle réduit (latence optimisée)' : (r1.stderr || r2.stderr) });
  }

  if (tweaks.includes('dns_cloudflare') && !state.applied.dns_cloudflare) {
    const iface = hardwareInfo?.net?.[0]?.name;
    if (!iface) {
      results.push({ id: 'dns_cloudflare', ok: false, detail: 'Aucune interface réseau active détectée' });
    } else {
      state.applied.dns_cloudflare = { iface };
      const r = await run('netsh', ['interface', 'ipv4', 'set', 'dnsservers', `name=${iface}`, 'static', '1.1.1.1', 'validate=no']);
      results.push({ id: 'dns_cloudflare', ok: r.ok, detail: r.ok ? `DNS Cloudflare appliqué sur "${iface}"` : r.stderr });
    }
  }

  return results;
}

async function revertNetwork(state) {
  const results = [];
  const applied = state.applied || {};

  if (applied.tcp_autotune) {
    const r = await run('netsh', ['int', 'tcp', 'set', 'global', `autotuninglevel=${applied.tcp_autotune.previous || 'normal'}`]);
    results.push({ id: 'tcp_autotune', ok: r.ok, detail: r.ok ? 'Autotuning TCP restauré' : r.stderr });
    delete applied.tcp_autotune;
  }

  if (applied.nagle_disable) {
    const path = HKCU('Software\\Microsoft\\Windows\\CurrentVersion\\InternetSettings');
    const r1 = await regDelete(path, 'TcpAckFrequency');
    const r2 = await regDelete(path, 'TCPNoDelay');
    results.push({ id: 'nagle_disable', ok: r1.ok && r2.ok, detail: 'Valeurs Nagle supprimées' });
    delete applied.nagle_disable;
  }

  if (applied.dns_cloudflare) {
    const r = await run('netsh', ['interface', 'ipv4', 'set', 'dnsservers', `name=${applied.dns_cloudflare.iface}`, 'source=dhcp']);
    results.push({ id: 'dns_cloudflare', ok: r.ok, detail: r.ok ? 'DNS restauré (DHCP)' : r.stderr });
    delete applied.dns_cloudflare;
  }

  return results;
}

module.exports = { NETWORK_TWEAKS, applyNetwork, revertNetwork };
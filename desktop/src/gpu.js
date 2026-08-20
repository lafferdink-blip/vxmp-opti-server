const { run } = require('./optimizer/system');

function brandOf(hardware) {
  const names = (hardware.gpu || []).map(g => (g.name || '').toLowerCase()).join(' ');
  if (/nvidia|geforce|quadro|rtx|gtx/.test(names)) return 'nvidia';
  if (/amd|radeon|rx\s|vega|firepro/.test(names)) return 'amd';
  if (/intel|uhd|iris|arc/.test(names)) return 'intel';
  return 'other';
}

async function nvidiaSmiInfo() {
  const r = await run('nvidia-smi', ['--query-gpu=name,driver_version,memory.total,memory.used,temperature.gpu,utilization.gpu,power.draw', '--format=csv,noheader']);
  if (!r.ok) return { ok: false, detail: 'nvidia-smi indisponible (pilotes NVIDIA non installés).' };
  const lines = r.stdout.split(/\r?\n/).filter(l => l.trim());
  return {
    ok: true,
    gpus: lines.map(l => {
      const parts = l.split(',').map(s => s.trim());
      return {
        name: parts[0] || '',
        driver: parts[1] || '',
        vramTotal: parts[2] || '',
        vramUsed: parts[3] || '',
        temp: parts[4] || '',
        util: parts[5] || '',
        power: parts[6] || ''
      };
    })
  };
}

async function openBrandPanel(hardware) {
  const brand = brandOf(hardware);
  if (brand === 'nvidia') {
    // Panneau de contrôle NVIDIA
    return run('cmd', ['/c', 'start', '', 'nvcplui.exe']);
  }
  if (brand === 'amd') {
    // Adrenalin (AMD Software)
    const candidates = [
      'C:\\Program Files\\AMD\\CNext\\CNext\\RadeonSoftware.exe',
      'C:\\Program Files\\AMD\\CNext\\CNext\\cncmd.exe',
      'C:\\Program Files\\AMD\\CNext\\CNext\\RadeonSoftware.exe'
    ];
    for (const exe of candidates) {
      const r = await run('cmd', ['/c', 'start', '', exe]);
      if (r.ok) return r;
    }
    return { ok: false, detail: 'AMD Software Adrenalin introuvable.' };
  }
  if (brand === 'intel') {
    // Intel Graphics Command Center
    return run('cmd', ['/c', 'start', '', 'ms-settings:display-advancedgraphics']);
  }
  return { ok: false, detail: 'Carte graphique inconnue : aucun panneau à ouvrir.' };
}

module.exports = { brandOf, nvidiaSmiInfo, openBrandPanel };
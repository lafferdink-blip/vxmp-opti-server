const { SYSTEM_TWEAKS, applySystem, revertSystem } = require('./system');
const { NETWORK_TWEAKS, applyNetwork, revertNetwork } = require('./network');
const { SERVICE_TWEAKS, applyServices, revertServices } = require('./services');
const { buildPreset, applyGpuTweak } = require('./obs');

const ALL_TWEAKS = [
  ...SYSTEM_TWEAKS,
  ...NETWORK_TWEAKS,
  ...SERVICE_TWEAKS,
  {
    id: 'gpu_persistence',
    category: 'gpu',
    label: 'Mode persistance NVIDIA (nvidia-smi)',
    description: 'Active le mode persistance NVIDIA pour des performances GPU stables.'
  }
];

function tweakById(id) {
  return ALL_TWEAKS.find(t => t.id === id);
}

async function apply(state, tweakIds, hardwareInfo) {
  const results = [];
  const sys = await applySystem(tweakIds, state);
  const net = await applyNetwork(tweakIds, state, hardwareInfo);
  const svc = await applyServices(tweakIds, state);
  results.push(...sys, ...net, ...svc);

  if (tweakIds.includes('gpu_persistence') && !state.applied.gpu_persistence) {
    const g = await applyGpuTweak(hardwareInfo);
    state.applied.gpu_persistence = { done: true };
    results.push({ id: 'gpu_persistence', ok: g.ok, detail: g.detail });
  }

  return results;
}

async function revert(state) {
  const results = [];
  results.push(...(await revertSystem(state)));
  results.push(...(await revertNetwork(state)));
  results.push(...(await revertServices(state)));
  delete state.applied.gpu_persistence;
  return results;
}

function appliedIds(state) {
  return Object.keys(state.applied || {}).filter(k => k !== 'gpu_persistence' || state.applied.gpu_persistence.done);
}

function diagnose(hardware) {
  const warnings = [];
  const info = [];
  const ramGB = hardware.ramGB || 0;
  const cores = hardware.cpu?.cores || 0;
  const gpuNames = (hardware.gpu || []).map(g => (g.name || '').toLowerCase()).join(' ');
  const isSsd = (hardware.disks || []).some(d => /ssd|nvme/.test((d.media || '').toLowerCase()) || /nvme|ssd/i.test(d.model || ''));

  info.push(`Processeur : ${hardware.cpu?.name || 'inconnu'} (${cores} cœurs / ${hardware.cpu?.threads} threads)`);
  info.push(`Mémoire : ${ramGB} Go`);
  info.push(`GPU : ${(hardware.gpu || []).map(g => g.name).join(', ') || 'inconnu'}`);
  info.push(`Stockage : ${(hardware.disks || []).map(d => `${d.model} (${d.sizeGB} Go)`).join(', ') || 'inconnu'}`);

  if (ramGB < 8) warnings.push('RAM < 8 Go : le streaming risque de manquer de mémoire.');
  if (cores < 4) warnings.push('Peu de cœurs CPU : privilégiez un encodeur GPU (NVENC/AMF).');
  if (/nvidia/.test(gpuNames)) info.push('Carte NVIDIA détectée : encodeur NVENC recommandé.');
  if (/amd/.test(gpuNames)) info.push('Carte AMD détectée : encodeur AMF recommandé.');
  if (isSsd) info.push('Disque SSD détecté : idéal pour l\'enregistrement local.');
  else if ((hardware.disks || []).length) warnings.push('Disque HDD détecté : préférez enregistrer sur un SSD.');

  return { info, warnings };
}

module.exports = { ALL_TWEAKS, tweakById, apply, revert, appliedIds, diagnose, buildPreset };
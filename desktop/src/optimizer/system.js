const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileP = promisify(execFile);

async function run(exe, args) {
  try {
    const { stdout } = await execFileP(exe, args, { windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
    return { ok: true, stdout: String(stdout || ''), stderr: '' };
  } catch (err) {
    return { ok: false, stdout: String(err.stdout || ''), stderr: String(err.stderr || err.message) };
  }
}

async function regQuery(path, name) {
  const r = await run('reg', ['query', path, '/v', name]);
  if (!r.ok) return null;
  const line = r.stdout.split(/\r?\n/)
    .map(l => l.trim())
    .find(l => l && !l.startsWith('HKEY'));
  if (!line) return null;
  const parts = line.split(/\s+/);
  return parts[parts.length - 1];
}

async function regSet(path, name, value, type = 'REG_DWORD') {
  return run('reg', ['add', path, '/v', name, '/t', type, '/d', String(value), '/f']);
}

async function regDelete(path, name) {
  return run('reg', ['delete', path, '/v', name, '/f']);
}

const HKCU = (tail) => `HKEY_CURRENT_USER\\${tail}`;

const SYSTEM_TWEAKS = [
  {
    id: 'power_high_perf',
    category: 'système',
    label: 'Plan d\'alimentation haute performance',
    description: 'Active le plan "Haute performance" (latence réduite).'
  },
  {
    id: 'disable_game_dvr',
    category: 'système',
    label: 'Désactiver l\'enregistrement Xbox (Game DVR)',
    description: 'Évite l\'enregistrement en arrière-plan qui vole des FPS.'
  },
  {
    id: 'hw_scheduling',
    category: 'système',
    label: 'Activer le GPU Scheduling matériel',
    description: 'Réduit la charge du processeur pendant le streaming.'
  },
  {
    id: 'disable_fullscreen_opt',
    category: 'système',
    label: 'Désactiver les optimisations plein écran',
    description: 'Évite les baisses de performances en jeu.'
  },
  {
    id: 'startup_delay',
    category: 'système',
    label: 'Supprimer le délai de démarrage des applis',
    description: 'Accélère le lancement des applications au boot.'
  },
  {
    id: 'game_mode',
    category: 'système',
    label: 'Activer le Game Mode Windows',
    description: 'Priorise les ressources vers les jeux et apps de streaming.'
  },
  {
    id: 'visual_effects',
    category: 'système',
    label: 'Performances visuelles maximales',
    description: 'Règle Windows sur "Meilleures performances" (animations réduites).'
  }
];

async function applySystem(tweaks, state) {
  const results = [];
  state.applied = state.applied || {};

  if (tweaks.includes('power_high_perf') && !state.applied.power_high_perf) {
    const current = await run('powercfg', ['-getactivescheme']);
    const m = current.stdout.match(/\(([0-9a-f\-]{36})\)/i);
    state.applied.power_high_perf = { previous: m ? m[1] : null };
    const r = await run('powercfg', ['-setactive', '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c']);
    results.push({ id: 'power_high_perf', ok: r.ok, detail: r.ok ? 'Plan haute performance activé' : r.stderr });
  }

  if (tweaks.includes('disable_game_dvr') && !state.applied.disable_game_dvr) {
    const path = HKCU('System\\GameConfigStore');
    const prev = await regQuery(path, 'GameDVR_Enabled');
    state.applied.disable_game_dvr = { previous: prev };
    const r = await regSet(path, 'GameDVR_Enabled', 0);
    results.push({ id: 'disable_game_dvr', ok: r.ok, detail: r.ok ? 'Game DVR désactivé' : r.stderr });
  }

  if (tweaks.includes('hw_scheduling') && !state.applied.hw_scheduling) {
    const path = HKCU('System\\GameConfigStore');
    const prev = await regQuery(path, 'HwSchMode');
    state.applied.hw_scheduling = { previous: prev };
    const r = await regSet(path, 'HwSchMode', 2);
    results.push({ id: 'hw_scheduling', ok: r.ok, detail: r.ok ? 'GPU Scheduling activé' : r.stderr });
  }

  if (tweaks.includes('disable_fullscreen_opt') && !state.applied.disable_fullscreen_opt) {
    const path = HKCU('System\\GameConfigStore');
    const prev = await regQuery(path, 'GameDVR_FSEBehaviorMode');
    state.applied.disable_fullscreen_opt = { previous: prev };
    const r = await regSet(path, 'GameDVR_FSEBehaviorMode', 2);
    results.push({ id: 'disable_fullscreen_opt', ok: r.ok, detail: r.ok ? 'Optimisations plein écran désactivées' : r.stderr });
  }

  if (tweaks.includes('startup_delay') && !state.applied.startup_delay) {
    const path = HKCU('Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Serialize');
    const prev = await regQuery(path, 'StartupDelayInMSec');
    state.applied.startup_delay = { previous: prev };
    const r = await regSet(path, 'StartupDelayInMSec', 0);
    results.push({ id: 'startup_delay', ok: r.ok, detail: r.ok ? 'Délai de démarrage supprimé' : r.stderr });
  }

  if (tweaks.includes('game_mode') && !state.applied.game_mode) {
    const path = HKCU('Software\\Microsoft\\GameBar');
    const prev = await regQuery(path, 'AutoGameModeEnabled');
    state.applied.game_mode = { previous: prev };
    const r = await regSet(path, 'AutoGameModeEnabled', 1);
    results.push({ id: 'game_mode', ok: r.ok, detail: r.ok ? 'Game Mode activé' : r.stderr });
  }

  if (tweaks.includes('visual_effects') && !state.applied.visual_effects) {
    const path = HKCU('Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects');
    const prev = await regQuery(path, 'VisualFXSetting');
    state.applied.visual_effects = { previous: prev };
    const r = await regSet(path, 'VisualFXSetting', 2);
    results.push({ id: 'visual_effects', ok: r.ok, detail: r.ok ? 'Effets visuels réduits (meilleures performances)' : r.stderr });
  }

  return results;
}

async function revertSystem(state) {
  const results = [];
  const applied = state.applied || {};

  if (applied.power_high_perf) {
    const r = await run('powercfg', ['-setactive', applied.power_high_perf.previous || '381b4222-f694-41f0-9685-ff5bb260df2e']);
    results.push({ id: 'power_high_perf', ok: r.ok, detail: r.ok ? 'Plan d\'alimentation restauré' : r.stderr });
    delete applied.power_high_perf;
  }

  const regReverts = [
    ['disable_game_dvr', HKCU('System\\GameConfigStore'), 'GameDVR_Enabled'],
    ['hw_scheduling', HKCU('System\\GameConfigStore'), 'HwSchMode'],
    ['disable_fullscreen_opt', HKCU('System\\GameConfigStore'), 'GameDVR_FSEBehaviorMode'],
    ['startup_delay', HKCU('Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Serialize'), 'StartupDelayInMSec'],
    ['game_mode', HKCU('Software\\Microsoft\\GameBar'), 'AutoGameModeEnabled'],
    ['visual_effects', HKCU('Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects'), 'VisualFXSetting']
  ];
  for (const [id, path, name] of regReverts) {
    if (!applied[id]) continue;
    let r;
    if (applied[id].previous !== null && applied[id].previous !== undefined) {
      r = await regSet(path, name, parseInt(applied[id].previous, 10) || applied[id].previous, isNaN(parseInt(applied[id].previous, 10)) ? 'REG_SZ' : 'REG_DWORD');
    } else {
      r = await regDelete(path, name);
    }
    results.push({ id, ok: r.ok, detail: r.ok ? 'Valeur restaurée' : r.stderr });
    delete applied[id];
  }

  return results;
}

module.exports = { SYSTEM_TWEAKS, applySystem, revertSystem, regQuery, run, regSet, regDelete };
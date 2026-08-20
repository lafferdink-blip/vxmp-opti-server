const fs = require('node:fs');
const path = require('node:path');

function expand(p) {
  return p.replace(/%([^%]+)%/g, (m, k) => process.env[k] || m);
}

// "Profil optimisé" par jeu : emplacement de la config + réglages à appliquer.
// Toujours sauvegardé (backup .booststream.bak) puis restaurable.
const PROFILES = {
  'Fortnite': {
    file: '%LOCALAPPDATA%\\FortniteGame\\Saved\\Config\\WindowsClient\\GameUserSettings.ini',
    format: 'ini',
    settings: [
      { section: 'ScalabilityGroups', key: 'sg.ResolutionQuality', value: '100' },
      { section: 'ScalabilityGroups', key: 'sg.ViewDistanceQuality', value: '1' },
      { section: 'ScalabilityGroups', key: 'sg.AntiAliasingQuality', value: '1' },
      { section: 'ScalabilityGroups', key: 'sg.ShadowQuality', value: '0' },
      { section: 'ScalabilityGroups', key: 'sg.PostProcessQuality', value: '1' },
      { section: 'ScalabilityGroups', key: 'sg.TextureQuality', value: '2' },
      { section: 'ScalabilityGroups', key: 'sg.EffectsQuality', value: '1' },
      { section: 'ScalabilityGroups', key: 'sg.FoliageQuality', value: '1' },
      { section: 'ScalabilityGroups', key: 'sg.ShadingQuality', value: '1' }
    ]
  },
  'Valorant': {
    file: '%LOCALAPPDATA%\\VALORANT\\Saved\\Config\\Windows\\GameUserSettings.ini',
    format: 'ini',
    settings: [
      { section: 'ScalabilityGroups', key: 'sg.ResolutionQuality', value: '100' },
      { section: 'ScalabilityGroups', key: 'sg.ViewDistanceQuality', value: '2' },
      { section: 'ScalabilityGroups', key: 'sg.AntiAliasingQuality', value: '0' },
      { section: 'ScalabilityGroups', key: 'sg.ShadowQuality', value: '0' },
      { section: 'ScalabilityGroups', key: 'sg.PostProcessQuality', value: '1' },
      { section: 'ScalabilityGroups', key: 'sg.TextureQuality', value: '2' },
      { section: 'ScalabilityGroups', key: 'sg.EffectsQuality', value: '1' },
      { section: 'ScalabilityGroups', key: 'sg.FoliageQuality', value: '1' },
      { section: 'ScalabilityGroups', key: 'sg.ShadingQuality', value: '1' }
    ]
  },
  'PUBG': {
    file: '%LOCALAPPDATA%\\TslGame\\Saved\\Config\\WindowsClient\\GameUserSettings.ini',
    format: 'ini',
    settings: [
      { section: 'ScalabilityGroups', key: 'sg.ResolutionQuality', value: '100' },
      { section: 'ScalabilityGroups', key: 'sg.ViewDistanceQuality', value: '1' },
      { section: 'ScalabilityGroups', key: 'sg.AntiAliasingQuality', value: '0' },
      { section: 'ScalabilityGroups', key: 'sg.ShadowQuality', value: '0' },
      { section: 'ScalabilityGroups', key: 'sg.PostProcessQuality', value: '1' },
      { section: 'ScalabilityGroups', key: 'sg.TextureQuality', value: '2' },
      { section: 'ScalabilityGroups', key: 'sg.EffectsQuality', value: '1' },
      { section: 'ScalabilityGroups', key: 'sg.FoliageQuality', value: '1' },
      { section: 'ScalabilityGroups', key: 'sg.ShadingQuality', value: '1' }
    ]
  },
  'Minecraft': {
    file: '%APPDATA%\\.minecraft\\options.txt',
    format: 'colon',
    settings: {
      'fov': '70', 'gamma': '0.5', 'renderDistance': '12',
      'maxFps': '144', 'particles': '0', 'clouds': 'false',
      'ao': 'false', 'enableVsync': 'false', 'mipmap_levels': '4'
    }
  },
  'Apex Legends': {
    file: '%LOCALAPPDATA%\\Apex Legends\\settings\\video.txt',
    format: 'tsv',
    settings: {
      'setting.r_lod_switch_scale': '0.6',
      'setting.mat_antialias_mode': '2',
      'setting.r_shadow_render': '0',
      'setting.mat_motion_blur_enabled': '0',
      'setting.r_dynamic_sun_shadows': '0'
    }
  }
};

// --- Appliqueur INI (Unreal Engine) ---
function applyIni(content, overrides) {
  const lines = content.split(/\r?\n/);
  const sections = [];
  const sectionMap = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*\[([^\]]+)\]\s*$/);
    if (m) {
      const sec = { name: m[1].trim(), start: i };
      sections.push(sec);
      sectionMap.set(sec.name, sec);
    }
  }
  for (let i = 0; i < sections.length; i++) {
    sections[i].end = i + 1 < sections.length ? sections[i + 1].start : lines.length;
  }

  const bySec = {};
  for (const o of overrides) (bySec[o.section] = bySec[o.section] || []).push(o);

  const applied = [];
  for (const secName of Object.keys(bySec)) {
    const over = bySec[secName];
    if (sectionMap.has(secName)) {
      const target = sectionMap.get(secName);
      const keys = new Set(over.map(o => o.key));
      for (let i = target.start + 1; i < target.end; i++) {
        const lm = lines[i].match(/^\s*([^=;\[]+?)\s*=\s*(.*)$/);
        if (lm && keys.has(lm[1].trim())) {
          const o = over.find(x => x.key === lm[1].trim());
          lines[i] = `${o.key}=${o.value}`;
          applied.push(o.key);
          keys.delete(o.key);
        }
      }
      for (const o of over) {
        if (keys.has(o.key)) {
          lines.splice(target.end, 0, `${o.key}=${o.value}`);
          target.end++;
          applied.push(o.key);
        }
      }
    } else {
      lines.push('', `[${secName}]`);
      for (const o of over) lines.push(`${o.key}=${o.value}`);
      applied.push(...over.map(o => o.key));
    }
  }
  return { content: lines.join('\r\n'), applied };
}

// --- Appliqueur clé:valeur (Minecraft options.txt) ---
function applyColon(content, settings) {
  const lines = content.split(/\r?\n/);
  const applied = [];
  for (const [key, value] of Object.entries(settings)) {
    let found = false;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^([^:]+):(.*)$/);
      if (m && m[1].trim() === key) { lines[i] = `${key}:${value}`; found = true; applied.push(key); break; }
    }
    if (!found) { lines.push(`${key}:${value}`); applied.push(key); }
  }
  return { content: lines.join('\r\n'), applied };
}

// --- Appliqueur "key" "value" (Source engine video.txt) ---
function applyTsv(content, settings) {
  const lines = content.split(/\r?\n/);
  const applied = [];
  for (const [key, value] of Object.entries(settings)) {
    let found = false;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^\s*"([^"]+)"\s*"([^"]*)"\s*$/);
      if (m && m[1] === key) { lines[i] = `"${key}"\t\t"${value}"`; found = true; applied.push(key); break; }
    }
    if (!found) { lines.push(`"${key}"\t\t"${value}"`); applied.push(key); }
  }
  return { content: lines.join('\r\n'), applied };
}

function hasProfile(game) {
  return Boolean(PROFILES[game.name]);
}

function profileFile(game) {
  const prof = PROFILES[game.name];
  return prof ? expand(prof.file) : null;
}

async function applyProfile(game, state) {
  const prof = PROFILES[game.name];
  if (!prof) {
    return { ok: false, reason: 'no_profile', detail: 'Aucun profil config automatique pour ce jeu.' };
  }
  const file = expand(prof.file);
  if (!fs.existsSync(file)) {
    return { ok: false, reason: 'not_found', detail: `Configuration introuvable : ${file}. Lance le jeu une fois puis réessaie.` };
  }
  const bak = file + '.booststream.bak';
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
  const content = fs.readFileSync(file, 'utf8');
  let result;
  if (prof.format === 'ini') result = applyIni(content, prof.settings);
  else if (prof.format === 'colon') result = applyColon(content, prof.settings);
  else result = applyTsv(content, prof.settings);
  fs.writeFileSync(file, result.content, 'utf8');

  state.gameProfiles = state.gameProfiles || {};
  state.gameProfiles[game.name] = { file, backup: bak, applied: result.applied };
  return {
    ok: true,
    file,
    applied: result.applied,
    detail: `${result.applied.length} paramètres optimisés appliqués sur ${path.basename(file)} (backup créé).`
  };
}

async function revertProfile(game, state) {
  const entry = state && state.gameProfiles && state.gameProfiles[game.name];
  if (!entry) return { ok: false, detail: 'Aucun backup trouvé pour ce jeu.' };
  if (fs.existsSync(entry.backup)) {
    fs.copyFileSync(entry.backup, entry.file);
    fs.unlinkSync(entry.backup);
  }
  delete state.gameProfiles[game.name];
  return { ok: true, detail: `Configuration de ${game.name} restaurée depuis le backup.` };
}

module.exports = { PROFILES, applyProfile, revertProfile, hasProfile, profileFile };
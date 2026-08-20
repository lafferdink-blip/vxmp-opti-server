const { run, regSet, regDelete } = require('./system');
const { execPs } = require('../hardware');
const gp = require('./gameprofiles');

const GAMES = [
  { name: 'Counter-Strike 2', exe: 'cs2.exe', steam: 730, settings: 'Shadow quality moyen, MSAA 2x, Texture high, cap FPS = refresh rate du moniteur.' },
  { name: 'Valorant', exe: 'VALORANT.exe', emoji: '🎯', settings: 'Textures high, FXAA off, Vsync off, limite FPS = double du refresh.' },
  { name: 'Fortnite', exe: 'FortniteClient-Win64-Shipping.exe', emoji: '🛸', profile: true, settings: 'Mode Performance, anti-aliasing off, distance 100%, 3D résolution 100%.' },
  { name: 'Apex Legends', exe: 'r5apex.exe', steam: 1172470, profile: true, settings: 'Modèle streamer : Textures high, ombres low, FPS cap à 144.' },
  { name: 'Call of Duty / Warzone', exe: 'cod.exe', steam: 1938090, settings: 'Rendu 90%, DLSS Performance (si RTX), ombres low.' },
  { name: 'Minecraft', exe: 'javaw.exe', steam: 432, profile: true, settings: 'Distance de rendu 12, simulation 4, allouer 6-8 Go de RAM via le launcher.' },
  { name: 'Rocket League', exe: 'RocketLeague.exe', steam: 252950, settings: 'World quality high, FPS cap 250, Vsync off.' },
  { name: 'GTA V', exe: 'GTA5.exe', steam: 271590, settings: 'DirectX 11, MSAA x2, distance d\'affichage 80%, ombres normales.' },
  { name: 'League of Legends', exe: 'League of Legends.exe', emoji: '⚔️', settings: 'Ombre off, FPS cap 144, effets moyenne qualité.' },
  { name: 'Rainbow Six Siege', exe: 'RainbowSix.exe', steam: 359550, settings: 'Vulkan, TAA, rendu 100%, ombres moyen.' },
  { name: 'Overwatch 2', exe: 'Overwatch.exe', steam: 2357570, settings: 'Rendu 100%, ombres moyen, FPS cap = refresh.' },
  { name: 'Genshin Impact', exe: 'GenshinImpact.exe', emoji: '🗡️', settings: 'Ombres moyen, FPS 60, effets medium.' },
  { name: 'Escape from Tarkov', exe: 'escapefromtarkov.exe', steam: 1610870, settings: 'Ombres low, Textures high, FSR/DLSS si dispo.' },
  { name: 'PUBG', exe: 'TslGame.exe', steam: 578080, profile: true, settings: 'Textures high, ombres très bas, rendu 100%.' }
];

function steamImg(appid) {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`;
}

function coverFor(game) {
  if (game.steam) return { kind: 'steam', url: steamImg(game.steam), alt: game.name };
  return { kind: 'emoji', emoji: game.emoji || '🎮' };
}

function gameByExe(exe) {
  return GAMES.find(g => g.exe.toLowerCase() === String(exe).toLowerCase());
}

function gameByName(name) {
  return GAMES.find(g => g.name === name);
}

const IFEO = 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options';
const DX_PREF = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences';
const LAYERS = 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers';

async function findExe(exeName) {
  const roots = [
    'C:\\Program Files\\Steam\\steamapps\\common',
    'C:\\Program Files (x86)\\Steam\\steamapps\\common',
    'C:\\Program Files\\Epic Games',
    'C:\\Program Files\\Riot Games',
    'C:\\Riot Games',
    'C:\\Program Files (x86)',
    'C:\\Program Files'
  ];
  const list = roots.map(r => `'${r.replace(/\\/g, '\\\\')}'`).join(',');
  const script = `$ErrorActionPreference='SilentlyContinue'
    $roots = @(${list})
    foreach ($r in $roots) {
      if (Test-Path $r) {
        Get-ChildItem -Path $r -Filter '${exeName}' -Recurse -Depth 4 -ErrorAction SilentlyContinue |
          Select-Object -First 1 -ExpandProperty FullName
      }
    }`;
  try {
    const out = await execPs(script);
    const line = out.split(/\r?\n/).map(l => l.trim()).find(l => l && l.toLowerCase().endsWith(exeName.toLowerCase()));
    return line || null;
  } catch {
    return null;
  }
}

async function applyForGame(game, state) {
  const results = [];
  const { exe } = game;
  const key = `${IFEO}\\${exe}\\PerfOptions`;

  // 1. Priorité CPU/IO/GPU élevée (Image File Execution Options)
  const r1 = await regSet(key, 'CpuPriorityClass', 3);
  const r2 = await regSet(key, 'IoPriority', 3);
  const r3 = await regSet(key, 'GpuPriority', 8);
  const prioOk = r1.ok && r2.ok && r3.ok;

  // 2. Préférence GPU haute performance (DirectX)
  const r4 = await regSet(DX_PREF, exe, 'GpuPreference=2;', 'REG_SZ');

  // 3. Désactivation des optimisations plein écran (si l'exe est trouvé)
  let fsOk = null;
  const exePath = await findExe(exe);
  if (exePath) {
    const r5 = await regSet(LAYERS, exePath, '~ DISABLEDXMAXIMIZEDWINDOWEDMODE', 'REG_SZ');
    fsOk = r5.ok;
  }

  results.push({
    id: exe,
    ok: prioOk && r4.ok,
    detail: `${game.name} → priorité CPU/GPU élevée ${prioOk ? '✓' : '✗'} · GPU haute perf ${r4.ok ? '✓' : '✗'}${fsOk === null ? '' : fsOk ? ' · plein écran ✓' : ' · plein écran ✗'}`
  });

  // 4. Profil optimisé (config du jeu : GameUserSettings etc., avec backup)
  if (game.profile) {
    const prof = await gp.applyProfile(game, state);
    if (prof.ok) {
      results.push({ id: exe + '-config', ok: true, detail: prof.detail });
    } else if (prof.reason !== 'no_profile') {
      results.push({ id: exe + '-config', ok: false, detail: `${game.name} → ${prof.detail}` });
    }
  }
  return results;
}

async function revertForGame(game, state) {
  const results = [];
  const { exe } = game;
  const key = `${IFEO}\\${exe}\\PerfOptions`;
  const del = await run('reg', ['delete', IFEO + '\\' + exe, '/f']);
  const dx = await regDelete(DX_PREF, exe);

  const exePath = await findExe(exe);
  let fs = null;
  if (exePath) fs = (await regDelete(LAYERS, exePath)).ok;

  results.push({
    id: exe,
    ok: del.ok && dx.ok,
    detail: `${game.name} → optimisations restaurées (valeurs par défaut).`
  });

  if (game.profile) {
    const prof = await gp.revertProfile(game, state);
    results.push({ id: exe + '-config', ok: prof.ok, detail: prof.detail });
  }
  return results;
}

module.exports = { GAMES, applyForGame, revertForGame, findExe, gameByExe, gameByName, coverFor };
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileP = promisify(execFile);

const { getHardwareInfo } = require('./src/hardware');
const { computeHwid } = require('./src/hwid');
const optimizer = require('./src/optimizer');
const { runSpeedTest } = require('./src/optimizer/speedtest');
const { run } = require('./src/optimizer/system');
const sysinfo = require('./src/systeminfo');
const gpuTools = require('./src/gpu');
const postinstall = require('./src/optimizer/postinstall');
const driver = require('./src/driver');
const games = require('./src/optimizer/games');

const API_URL = process.env.BOOSTSTREAM_API || 'http://localhost:4000';
let mainWindow = null;
let splashWindow = null;
let authWindow = null;
let authPollTimer = null;
let splashFinished = false;

function log(msg) {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'booststream.log'),
      `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

function stateFile() {
  return path.join(app.getPath('userData'), 'app-state.json');
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); }
  catch { return { license: null, applied: {} }; }
}

function saveState(state) {
  fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2));
}

async function isAdmin() {
  try {
    await execFileP('net', ['session'], { windowsHide: true });
    return true;
  } catch { return false; }
}

async function ensureAdmin() {
  if (await isAdmin()) return true;
  // Relance en administrateur (invite UAC)
  try {
    await execFileP('powershell.exe', ['-NoProfile', '-Command',
      `Start-Process -FilePath "${process.execPath}" -ArgumentList '"${app.getAppPath()}"','--relaunch-admin' -Verb RunAs`],
      { windowsHide: true });
    app.quit();
  } catch {
    return false;
  }
  return true;
}

function createWindow(show = true) {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 620,
    show,
    backgroundColor: '#0b0e14',
    title: 'Vxamp Opti',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.setMenuBarVisibility(false);

  mainWindow.webContents.on('did-fail-load', (e, code, desc, url) => {
    log(`did-fail-load code=${code} desc=${desc} url=${url}`);
  });
  mainWindow.webContents.on('render-process-gone', (e, details) => {
    log(`render-process-gone reason=${details.reason} code=${details.exitCode}`);
  });
  mainWindow.webContents.on('console-message', (e, level, message, line, sourceId) => {
    log(`console[${level}] ${sourceId}:${line} ${message}`);
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html')).then(() => {
    log('page loaded OK');
  }).catch((err) => {
    log('loadFile failed: ' + err.message);
  });
}

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 460,
    height: 330,
    resizable: false,
    frame: false,
    show: true,
    alwaysOnTop: true,
    backgroundColor: '#0b0e14',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  splashWindow.loadFile(path.join(__dirname, 'renderer', 'splash.html'));
  splashWindow.on('closed', () => {
    splashWindow = null;
    if (!splashFinished) app.quit();
  });
}

function splashStatus(status, detail) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('splash:status', { status, detail });
  }
}

async function checkStoredLicense() {
  const state = loadState();
  if (!state.license) return false;
  try {
    const { key, hwid } = state.license;
    const res = await fetch(`${API_URL}/api/license/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, hwid })
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function startVerification() {
  // Petite pause pour montrer le logo VXMP
  await new Promise(r => setTimeout(r, 1200));
  splashStatus('checking', 'Vérification de votre licence Discord…');

  const ok = await checkStoredLicense();
  if (ok) {
    await new Promise(r => setTimeout(r, 600));
    return finishSplash();
  }
  splashStatus('no_license', 'Aucune licence détectée sur cette machine.');
}

function finishSplash() {
  splashFinished = true;
  if (!mainWindow) createWindow(false);
  mainWindow.show();
  mainWindow.focus();
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy();
  log('authentifié, fenêtre principale affichée');
}

async function runDiscordLogin() {
  try {
    const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
    splashStatus('login', 'Connexion à Discord…');

    const authRes = await fetch(`${API_URL}/api/discord/auth-url?state=${state}`);
    const authData = await authRes.json().catch(() => ({}));
    if (!authData.url) throw new Error(authData.detail || 'Serveur d\'authentification indisponible');

    authWindow = new BrowserWindow({
      width: 520,
      height: 700,
      parent: splashWindow,
      modal: false,
      autoHideMenuBar: true,
      title: 'Connexion Discord'
    });
    authWindow.loadURL(authData.url);
    authWindow.on('closed', () => {
      if (authPollTimer) clearInterval(authPollTimer);
      authPollTimer = null;
    });

    return await new Promise((resolve) => {
      const started = Date.now();
      authPollTimer = setInterval(async () => {
        try {
          const r = await fetch(`${API_URL}/api/discord/result?state=${state}`);
          const data = await r.json();
          if (data.ok === null) {
            if (Date.now() - started > 5 * 60 * 1000) {
              clearInterval(authPollTimer);
              authPollTimer = null;
              resolve({ ok: false, detail: 'Connexion Discord expirée.' });
            }
            return;
          }
          clearInterval(authPollTimer);
          authPollTimer = null;
          if (authWindow && !authWindow.isDestroyed()) authWindow.destroy();
          resolve(data);
        } catch {
          if (Date.now() - started > 5 * 60 * 1000) {
            clearInterval(authPollTimer);
            authPollTimer = null;
            resolve({ ok: false, detail: 'Impossible de joindre le serveur de vérification.' });
          }
        }
      }, 1000);
    });
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

async function activateDiscordLicense(license) {
  const hwid = await computeHwid();
  const res = await fetch(`${API_URL}/api/license/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: license.key, hwid, deviceName: osHostname() })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'Activation de la licence échouée.');
  const state = loadState();
  state.license = { key: license.key.toUpperCase(), hwid, deviceName: osHostname() };
  saveState(state);
  return true;
}

function osHostname() {
  try { return require('node:os').hostname(); } catch { return 'PC'; }
}

app.whenReady().then(() => {
  createSplash();
  createWindow(false);
  startVerification();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && splashFinished) createWindow();
  });
});

process.on('uncaughtException', (err) => {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'booststream.log'),
      `[${new Date().toISOString()}] UNCAUGHT: ${err.stack || err.message}\n`);
  } catch {}
});

process.on('unhandledRejection', (reason) => {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'booststream.log'),
      `[${new Date().toISOString()}] UNHANDLED REJECTION: ${reason}\n`);
  } catch {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC ----

ipcMain.on('splash:login', () => {
  runDiscordLogin().then(async (result) => {
    if (!result.ok || !result.license) {
      splashStatus('no_license',
        result.notPurchased ? 'Aucun achat détecté pour ce compte Discord.' : (result.detail || 'Échec de la connexion Discord.'));
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.webContents.send('splash:result', { ok: false, detail: result.detail });
      }
      return;
    }
    splashStatus('checking', 'Licence trouvée, activation…');
    try {
      await activateDiscordLicense(result.license);
      splashWindow?.webContents.send('splash:result', { ok: true, owner: result.owner, license: result.license });
      await new Promise(r => setTimeout(r, 900));
      finishSplash();
    } catch (err) {
      splashStatus('no_license', err.message);
      splashWindow?.webContents.send('splash:result', { ok: false, detail: err.message });
    }
  });
});

ipcMain.on('splash:open-main', () => {
  splashFinished = true;
  finishSplash();
});

ipcMain.handle('discord:login', async () => {
  const result = await runDiscordLogin();
  if (!result.ok || !result.license) {
    return { ok: false, detail: result.notPurchased ? 'Aucun achat détecté pour ce compte Discord.' : (result.detail || 'Échec de la connexion.') };
  }
  try {
    await activateDiscordLicense(result.license);
    return { ok: true, key: result.license.key, plan: result.license.plan };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
});

ipcMain.handle('hardware:info', async () => {
  try { return await getHardwareInfo(); }
  catch (err) { return { error: err.message }; }
});

ipcMain.handle('hwid:get', async () => {
  try { return await computeHwid(); }
  catch (err) { return { error: err.message }; }
});

ipcMain.handle('diagnose:run', async () => {
  const info = await getHardwareInfo();
  return optimizer.diagnose(info);
});

ipcMain.handle('tweaks:list', () => optimizer.ALL_TWEAKS);

ipcMain.handle('license:activate', async (event, { key, deviceName }) => {
  try {
    const hwid = await computeHwid();
    const res = await fetch(`${API_URL}/api/license/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, hwid, deviceName })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      const state = loadState();
      state.license = { key: key.trim().toUpperCase(), hwid, deviceName };
      saveState(state);
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: { error: 'Impossible de joindre le serveur de licence : ' + err.message } };
  }
});

ipcMain.handle('license:verify', async () => {
  try {
    const state = loadState();
    if (!state.license) return { ok: false, status: 400, data: { error: 'Aucune licence activée sur cette machine.' } };
    const { key, hwid } = state.license;
    const res = await fetch(`${API_URL}/api/license/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, hwid })
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: { error: 'Impossible de joindre le serveur de licence : ' + err.message } };
  }
});

ipcMain.handle('license:rebind', async () => {
  try {
    const state = loadState();
    if (!state.license) return { ok: false, status: 400, data: { error: 'Aucune licence activée.' } };
    const newHwid = await computeHwid();
    const res = await fetch(`${API_URL}/api/license/rebind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.license.key, oldHwid: state.license.hwid, newHwid, deviceName: state.license.deviceName })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      state.license.hwid = newHwid;
      saveState(state);
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: { error: 'Impossible de joindre le serveur de licence : ' + err.message } };
  }
});

ipcMain.handle('license:local', () => {
  const state = loadState();
  return state.license;
});

ipcMain.handle('optimize:apply', async (event, tweakIds) => {
  try {
    if (!(await ensureAdmin())) {
      return { ok: false, error: 'admin_required', detail: 'L\'élévation administrateur a été refusée.' };
    }
    const state = loadState();
    const hardware = await getHardwareInfo();
    const results = await optimizer.apply(state, tweakIds, hardware);
    saveState(state);
    return { ok: true, results };
  } catch (err) {
    return { ok: false, error: err.message, detail: err.message };
  }
});

ipcMain.handle('optimize:revert', async () => {
  try {
    if (!(await ensureAdmin())) {
      return { ok: false, error: 'admin_required', detail: 'L\'élévation administrateur a été refusée.' };
    }
    const state = loadState();
    const results = await optimizer.revert(state);
    saveState(state);
    return { ok: true, results };
  } catch (err) {
    return { ok: false, error: err.message, detail: err.message };
  }
});

ipcMain.handle('optimize:applied', () => {
  const state = loadState();
  return optimizer.appliedIds(state);
});

ipcMain.handle('obs:preset', async (event, speedMbps) => {
  try {
    const hardware = await getHardwareInfo();
    let speed = speedMbps;
    if (!speed) {
      const test = await runSpeedTest();
      speed = test.downloadMbps || 50;
    }
    return optimizer.buildPreset(hardware, speed);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('speed:test', async () => {
  try { return await runSpeedTest(); }
  catch (err) { return { error: err.message }; }
});

ipcMain.handle('system:isAdmin', async () => isAdmin());

// ---- BIOS / Système ----
ipcMain.handle('system:bios', async () => {
  try {
    const hw = await getHardwareInfo();
    const firmware = await sysinfo.firmwareType();
    return {
      ok: true,
      firmware,
      bios: hw.bios,
      board: hw.board,
      systemType: hw.systemType,
      pcName: hw.pcName,
      os: hw.os
    };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
});

ipcMain.handle('system:open-msinfo', async () => {
  const r = await sysinfo.openMsInfo();
  return { ok: r.ok, detail: r.ok ? 'Informations système ouvertes' : r.stderr };
});

// ---- Alimentation ----
ipcMain.handle('power:info', async () => {
  try {
    const hw = await getHardwareInfo();
    const active = await sysinfo.getActiveScheme();
    const schemes = await sysinfo.listSchemes();
    return { ok: true, active, schemes, battery: hw.battery };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
});

ipcMain.handle('power:set', async (event, guid) => {
  try {
    if (!(await ensureAdmin())) {
      return { ok: false, error: 'admin_required', detail: 'L\'élévation administrateur est requise pour changer de plan.' };
    }
    const r = await sysinfo.setActiveScheme(guid);
    return { ok: r.ok, detail: r.ok ? 'Plan d\'alimentation appliqué' : r.stderr };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
});

ipcMain.handle('power:ultra', async () => {
  try {
    if (!(await ensureAdmin())) {
      return { ok: false, error: 'admin_required', detail: 'L\'élévation administrateur est requise.' };
    }
    return await sysinfo.createUltimateScheme();
  } catch (err) {
    return { ok: false, detail: err.message };
  }
});

ipcMain.handle('power:no-sleep', async () => {
  try {
    if (!(await ensureAdmin())) {
      return { ok: false, error: 'admin_required', detail: 'L\'élévation administrateur est requise.' };
    }
    return await sysinfo.setNoSleep();
  } catch (err) {
    return { ok: false, detail: err.message };
  }
});

ipcMain.handle('power:disk-off', async () => {
  try {
    if (!(await ensureAdmin())) {
      return { ok: false, error: 'admin_required', detail: 'L\'élévation administrateur est requise.' };
    }
    return await sysinfo.setDiskNeverOff();
  } catch (err) {
    return { ok: false, detail: err.message };
  }
});

ipcMain.handle('power:monitor', async (event, minutes) => {
  try {
    if (!(await ensureAdmin())) {
      return { ok: false, error: 'admin_required', detail: 'L\'élévation administrateur est requise.' };
    }
    return await sysinfo.setMonitorTimeout(minutes);
  } catch (err) {
    return { ok: false, detail: err.message };
  }
});

// ---- GPU ----
ipcMain.handle('gpu:info', async () => {
  try {
    const hw = await getHardwareInfo();
    return { ok: true, gpu: hw.gpu, brand: gpuTools.brandOf(hw) };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
});

ipcMain.handle('gpu:nvidia-smi', async () => gpuTools.nvidiaSmiInfo());

ipcMain.handle('gpu:open-panel', async () => {
  try {
    const hw = await getHardwareInfo();
    return await gpuTools.openBrandPanel(hw);
  } catch (err) {
    return { ok: false, detail: err.message };
  }
});

// Meilleurs réglages système compatibles (MPO + persistance NVIDIA)
ipcMain.handle('gpu:apply-best', async () => {
  try {
    if (!(await ensureAdmin())) {
      return { ok: false, error: 'admin_required', detail: 'L\'élévation administrateur est requise.' };
    }
    const results = [];
    const hw = await getHardwareInfo();
    const brand = gpuTools.brandOf(hw);

    // MPO off (Multiplane Overlay) : réduit les micro-saccades avec les GPU NVIDIA/AMD
    const mpo = await run('reg', ['add', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\Dwm', '/v', 'OverlayTestMode', '/t', 'REG_DWORD', '/d', '5', '/f']);
    results.push({ id: 'mpo', ok: mpo.ok, detail: 'MPO désactivé (anti micro-saccades)' + (mpo.ok ? '' : ' : ' + (mpo.stderr || '')) });

    if (brand === 'nvidia') {
      const pm = await run('nvidia-smi', ['-pm', '1']);
      results.push({ id: 'nv_pm', ok: pm.ok, detail: 'Mode persistance NVIDIA activé' + (pm.ok ? '' : ' (nvidia-smi indisponible)') });
    }
    return { ok: true, brand, results };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
});

// ---- Post install ----
ipcMain.handle('postinstall:list', () => postinstall.POSTINSTALL_ACTIONS);

ipcMain.handle('postinstall:apply', async (event, ids) => {
  try {
    if (!(await ensureAdmin())) {
      return { ok: false, error: 'admin_required', detail: 'L\'élévation administrateur est requise.' };
    }
    const state = loadState();
    const results = await postinstall.applyPostInstall(state, ids);
    saveState(state);
    return { ok: true, results };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
});

ipcMain.handle('postinstall:revert', async () => {
  try {
    if (!(await ensureAdmin())) {
      return { ok: false, error: 'admin_required', detail: 'L\'élévation administrateur est requise.' };
    }
    const state = loadState();
    const results = await postinstall.revertPostInstall(state);
    saveState(state);
    return { ok: true, results };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
});

ipcMain.handle('postinstall:applied', () => {
  const state = loadState();
  return Object.keys(state.postinstall || {}).filter(k => state.postinstall[k]);
});

// ---- Jeux ----
ipcMain.handle('games:list', () => games.GAMES);

ipcMain.handle('games:apply', async (event, names) => {
  try {
    if (!(await ensureAdmin())) {
      return { ok: false, error: 'admin_required', detail: 'L\'élévation administrateur est requise.' };
    }
    const results = [];
    const state = loadState();
    for (const name of names) {
      const game = games.gameByName(name);
      if (game) results.push(...(await games.applyForGame(game, state)));
    }
    saveState(state);
    return { ok: true, results };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
});

ipcMain.handle('games:revert', async (event, names) => {
  try {
    if (!(await ensureAdmin())) {
      return { ok: false, error: 'admin_required', detail: 'L\'élévation administrateur est requise.' };
    }
    const results = [];
    const state = loadState();
    for (const name of names) {
      const game = games.gameByName(name);
      if (game) results.push(...(await games.revertForGame(game, state)));
    }
    saveState(state);
    return { ok: true, results };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
});

// ---- Pilotes GPU ----
ipcMain.handle('driver:info', async () => {
  try {
    const hw = await getHardwareInfo();
    return { ok: true, ...driver.getDriverInfo(hw) };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
});

ipcMain.handle('driver:check', async () => {
  try {
    const hw = await getHardwareInfo();
    return await driver.checkLatest(hw);
  } catch (err) {
    return { ok: false, detail: err.message };
  }
});

ipcMain.handle('driver:download', async () => {
  try {
    const hw = await getHardwareInfo();
    return await driver.downloadLatestDriver(hw);
  } catch (err) {
    return { ok: false, reason: 'error', detail: err.message };
  }
});

ipcMain.handle('driver:install', async (event, exePath) => {
  try {
    return await driver.installDriver(exePath);
  } catch (err) {
    return { ok: false, detail: err.message };
  }
});

ipcMain.handle('driver:open-page', async () => {
  try {
    const hw = await getHardwareInfo();
    const brand = driver.brandOf(hw);
    const page = driver.OFFICIAL_PAGES[brand] || driver.OFFICIAL_PAGES.nvidia;
    await execFileP('cmd', ['/c', 'start', '', page], { windowsHide: true });
    return { ok: true, detail: 'Page officielle des pilotes ouverte.' };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
});
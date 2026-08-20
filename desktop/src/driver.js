const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileP = promisify(execFile);

function brandOf(hardware) {
  const names = (hardware.gpu || []).map(g => (g.name || '').toLowerCase()).join(' ');
  if (/nvidia|geforce|quadro|rtx|gtx/.test(names)) return 'nvidia';
  if (/amd|radeon|rx\s|vega|firepro/.test(names)) return 'amd';
  if (/intel|uhd|iris|arc/.test(names)) return 'intel';
  return 'other';
}

function getDriverInfo(hardware) {
  const brand = brandOf(hardware);
  const gpu = (hardware.gpu || [])[0] || {};
  const driver = gpu.driver || null;
  return {
    brand,
    name: gpu.name || 'Inconnu',
    currentDriver: driver,
    driverInstalled: !!(driver && !/basic|microsoft/i.test(driver)),
    vramMB: gpu.vramMB || 0
  };
}

const OFFICIAL_PAGES = {
  nvidia: 'https://www.nvidia.com/Download/index.aspx?lang=en-us',
  amd: 'https://www.amd.com/en/support/downloads/drivers.html/graphics',
  intel: 'https://www.intel.com/content/www/us/en/download-center/home.html'
};

async function checkNvidia() {
  try {
    const res = await fetch(
      'https://gfwsl.geforce.com/services_toolkit/services/com/nvidia/services/AJAXFrameController?page=1&parentCategory=278&childCategory=0&architecture=0&downloadType=all&chipset=0&language=en-us&limit=50&sort=1&offset=0',
      { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const d = data && data.RecommendedDriver;
    if (!d || !d.Version) return null;
    return {
      version: d.Version,
      name: d.Name,
      releaseDate: d.ReleaseDateTime,
      size: d.DownloadURLFileSize,
      url: d.DownloadURL,
      branch: d.Branch || 'WHQL',
      notes: (d.ImportantNotes || d.Notes || '')
    };
  } catch {
    return null;
  }
}

async function checkLatest(hardware) {
  const brand = brandOf(hardware);
  if (brand === 'nvidia') {
    const latest = await checkNvidia();
    if (latest) return { brand, latest };
    return { brand, latest: null, page: OFFICIAL_PAGES.nvidia };
  }
  return { brand, latest: null, page: OFFICIAL_PAGES[brand] || OFFICIAL_PAGES.nvidia };
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const go = (u) => {
      const req = https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return go(res.headers.location);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error('HTTP ' + res.statusCode));
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve(dest)));
        file.on('error', reject);
      });
      req.setTimeout(180000, () => { req.destroy(new Error('timeout téléchargement')); });
      req.on('error', reject);
    };
    go(url);
  });
}

async function downloadLatestDriver(hardware) {
  const brand = brandOf(hardware);
  if (brand !== 'nvidia') {
    return { ok: false, reason: 'page', detail: 'Téléchargement automatique uniquement pour NVIDIA. Ouverture de la page officielle.', page: OFFICIAL_PAGES[brand] || OFFICIAL_PAGES.nvidia };
  }
  const latest = await checkNvidia();
  if (!latest || !latest.url) return { ok: false, reason: 'unavailable', detail: 'Impossible de récupérer le dernier pilote NVIDIA.' };

  const dir = path.join(os.homedir(), 'Downloads', 'VxampOpti-Driver');
  fs.mkdirSync(dir, { recursive: true });
  const ext = /\.exe$/i.test(latest.url) ? 'exe' : 'download';
  const dest = path.join(dir, `nvidia-driver-${latest.version}.${ext}`);
  try {
    await download(latest.url, dest);
    return { ok: true, dest, version: latest.version, size: latest.size, url: latest.url };
  } catch (err) {
    return { ok: false, reason: 'download', detail: err.message };
  }
}

async function installDriver(exePath) {
  try {
    await execFileP('powershell.exe', ['-NoProfile', '-Command',
      `Start-Process -FilePath '${exePath}' -Verb RunAs`], { windowsHide: true });
    return { ok: true, detail: 'Installateur du pilote lancé (suivez les étapes à l\'écran).' };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

module.exports = { getDriverInfo, checkLatest, downloadLatestDriver, installDriver, OFFICIAL_PAGES, brandOf };
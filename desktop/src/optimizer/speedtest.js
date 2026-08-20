const https = require('node:https');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileP = promisify(execFile);

function downloadSpeed(url, bytes) {
  return new Promise((resolve) => {
    const start = Date.now();
    let received = 0;
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) return resolve(null);
      res.on('data', (chunk) => { received += chunk.length; });
      res.on('end', () => {
        const secs = (Date.now() - start) / 1000;
        const mbps = secs > 0 ? (received * 8) / (secs * 1e6) : 0;
        resolve(mbps);
      });
    });
    req.setTimeout(15000, () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

async function measureDownload() {
  const candidates = [
    'https://speed.cloudflare.com/__down?bytes=10000000',
    'https://proof.ovh.net/files/10Mb.dat',
    'https://http3.cloudflare.com/__down?bytes=10000000'
  ];
  for (const url of candidates) {
    const mbps = await downloadSpeed(url, 10 * 1024 * 1024);
    if (mbps && mbps > 1) return mbps;
  }
  return null;
}

async function measurePing() {
  const { stdout } = await execFileP('ping', ['-n', '4', '1.1.1.1'], { windowsHide: true });
  const m = stdout.match(/Minimum = (\d+)ms/);
  return m ? parseInt(m[1], 10) : null;
}

async function runSpeedTest() {
  const [download, ping] = await Promise.all([measureDownload(), measurePing()]);
  return { downloadMbps: download ? Math.round(download * 10) / 10 : null, pingMs: ping };
}

module.exports = { runSpeedTest, measureDownload, measurePing };
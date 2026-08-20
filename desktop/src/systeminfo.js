const { run } = require('./optimizer/system');
const { execPs } = require('./hardware');

// --- Firmware / BIOS ---
async function firmwareType() {
  const r = await run('reg', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control', '/v', 'PEFirmwareType']);
  if (r.ok) {
    const m = r.stdout.match(/0x([0-9a-fA-F]+)/);
    const v = m ? parseInt(m[1], 16) : null;
    if (v) return v === 2 ? 'UEFI' : v === 1 ? 'BIOS (Legacy)' : 'inconnu';
  }
  try {
    const out = await execPs('(Get-ComputerInfo -Property BiosFirmwareType).BiosFirmwareType');
    const t = String(out).trim();
    if (/uefi/i.test(t)) return 'UEFI';
    if (/bios|legacy/i.test(t)) return 'BIOS (Legacy)';
  } catch {}
  return 'inconnu';
}

async function openMsInfo() {
  return run('cmd', ['/c', 'start', '', 'msinfo32']);
}

// --- Plans d'alimentation ---
async function getActiveScheme() {
  const out = await execPs('powercfg /getactivescheme');
  const m = out.match(/([0-9a-f]{8}-[0-9a-f-]{27})\s*\(([^)]+)\)/i);
  return m ? { guid: m[1], name: m[2].trim() } : null;
}

async function listSchemes() {
  const out = await execPs('powercfg /list');
  return out.split(/\r?\n/).map(l => {
    const m = l.match(/([0-9a-f]{8}-[0-9a-f-]{27})\s*\(([^)]+)\)\s*(\*)?/i);
    return m ? { guid: m[1], name: m[2].trim(), active: Boolean(m[3]) } : null;
  }).filter(Boolean);
}

async function setActiveScheme(guid) {
  return run('powercfg', ['/setactive', guid]);
}

const ULTIMATE_GUID = 'e9a42b02-d5df-448d-aa00-03f14749eb61';

async function createUltimateScheme() {
  // Duplique le plan "Ultimate Performance" s'il est disponible, puis l'active.
  const dup = await run('powercfg', ['/duplicatescheme', ULTIMATE_GUID]);
  if (!dup.ok) {
    return { ok: false, detail: 'Plan Ultimate Performance indisponible sur ce système : ' + dup.stderr };
  }
  const m = dup.stdout.match(/([0-9a-f]{8}-[0-9a-f-]{27})/i);
  if (!m) return { ok: false, detail: 'Impossible de récupérer le GUID du nouveau plan.' };
  const guid = m[1];
  const act = await setActiveScheme(guid);
  return { ok: act.ok, guid, detail: act.ok ? `Plan "${await getActiveScheme().then(s => s && s.name)}" activé` : act.stderr };
}

// Réglages rapides powercfg
async function setNoSleep() {
  const r1 = await run('powercfg', ['/change', 'standby-timeout-ac', '0']);
  const r2 = await run('powercfg', ['/change', 'standby-timeout-dc', '0']);
  const r3 = await run('powercfg', ['/change', 'hibernate-timeout-ac', '0']);
  const r4 = await run('powercfg', ['/change', 'hibernate-timeout-dc', '0']);
  return { ok: r1.ok && r2.ok && r3.ok && r4.ok, detail: 'Veille et hibernation désactivées (secteur et batterie)' };
}

async function setDiskNeverOff() {
  const r1 = await run('powercfg', ['/change', 'disk-timeout-ac', '0']);
  const r2 = await run('powercfg', ['/change', 'disk-timeout-dc', '0']);
  return { ok: r1.ok && r2.ok, detail: 'Extinction du disque dur désactivée' };
}

async function setMonitorTimeout(min) {
  const r1 = await run('powercfg', ['/change', 'monitor-timeout-ac', String(min)]);
  const r2 = await run('powercfg', ['/change', 'monitor-timeout-dc', String(min)]);
  return { ok: r1.ok && r2.ok, detail: `Extinction de l'écran après ${min} min` };
}

module.exports = {
  firmwareType, openMsInfo,
  getActiveScheme, listSchemes, setActiveScheme, createUltimateScheme,
  setNoSleep, setDiskNeverOff, setMonitorTimeout
};
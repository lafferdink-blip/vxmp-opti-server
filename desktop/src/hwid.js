const crypto = require('node:crypto');
const { getHardwareInfo } = require('./hardware');

// Empreinte matérielle stable : combine identifiants CPU, carte mère, BIOS, disque et MAC.
async function computeHwid() {
  const info = await getHardwareInfo();
  const parts = [
    info.cpu?.processorId || 'n/a',
    info.board?.serial || 'n/a',
    info.bios?.serial || 'n/a',
    (info.disks || []).map(d => d.serial).join('|'),
    (info.net || []).map(n => n.mac).join('|')
  ];
  const raw = parts.join('::');
  return crypto.createHash('sha256').update(raw).digest('hex').toUpperCase().slice(0, 32);
}

module.exports = { computeHwid };
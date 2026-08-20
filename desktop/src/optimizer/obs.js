const { run } = require('./system');

function detectEncoder(hardware) {
  const gpuNames = (hardware.gpu || []).map(g => (g.name || '').toLowerCase()).join(' ');
  if (/nvidia|geforce|quadro|rtx|gtx/.test(gpuNames)) return 'nvenc';
  if (/amd|radeon|rx |vega/.test(gpuNames)) return 'amf';
  if (/intel|uhd|iris/.test(gpuNames)) return 'qsv';
  return 'x264';
}

function buildPreset(hardware, speedMbps) {
  const encoder = detectEncoder(hardware);
  const gpuAccel = encoder !== 'x264';
  const threads = hardware.cpu?.threads || 8;
  const speed = speedMbps || 50;
  const isNvenc = encoder === 'nvenc';

  // Bitrate : 85% du débit mesuré pour l'encodage GPU, 60% pour x264
  const bitrate = Math.min(
    isNvenc ? Math.round(speed * 0.85) : Math.round(speed * 0.6),
    isNvenc ? 20000 : 12000
  );

  // Résolution / FPS selon la puissance et le débit
  const can1080p60 = (gpuAccel && speed >= 25) || (threads >= 12 && speed >= 25);
  const can1080p30 = speed >= 12;
  const baseResolution = can1080p60 || can1080p30 ? '1920x1080' : '1280x720';
  const fps = can1080p60 ? 60 : (speed >= 12 ? 30 : 30);

  const preset = {
    encoder: encoder === 'qsv' ? 'obs_qsv11' : (encoder === 'amf' ? 'h264_amf' : (encoder === 'nvenc' ? 'nvenc_h264' : 'x264')),
    encoderLabel: isNvenc ? 'NVIDIA NVENC (GPU)' : encoder === 'amf' ? 'AMD AMF (GPU)' : encoder === 'qsv' ? 'Intel QSV (GPU)' : 'x264 (CPU)',
    baseResolution,
    fps,
    outputResolution: baseResolution,
    videoBitrate: Math.max(bitrate, 2500),
    audioBitrate: 160,
    keyint: fps * 2,
    presetName: isNvenc ? 'p5 : Slow (Good Quality)' : encoder === 'amf' ? 'Quality' : 'veryfast',
    rateControl: 'CBR',
    rationale: [
      `Encodeur : ${isNvenc ? 'NVENC utilise le GPU, aucun impact CPU' : encoder === 'amf' ? 'AMF utilise le GPU' : 'x264 utilise le CPU'}`,
      `Bitrate vidéo : ${Math.max(bitrate, 2500)} kbps (basé sur un débit montant mesuré de ~${speed} Mbps)`,
      `Résolution : ${baseResolution} à ${fps} fps`,
      `Keyframe interval : ${fps * 2} (2 secondes, obligatoire pour Twitch)`
    ]
  };
  return preset;
}

async function applyGpuTweak(hardware) {
  // Tweak GPU : active le mode persistance NVIDIA si nvidia-smi est disponible
  const gpuNames = (hardware.gpu || []).map(g => (g.name || '').toLowerCase()).join(' ');
  if (!/nvidia/.test(gpuNames)) {
    return { ok: true, detail: 'Aucune carte NVIDIA détectée, étape ignorée' };
  }
  const r = await run('nvidia-smi', ['-pm', '1']);
  return { ok: r.ok, detail: r.ok ? 'Mode persistance NVIDIA activé' : 'nvidia-smi indisponible, ignoré' };
}

module.exports = { buildPreset, detectEncoder, applyGpuTweak };
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('booststream', {
  hardware: () => ipcRenderer.invoke('hardware:info'),
  hwid: () => ipcRenderer.invoke('hwid:get'),
  diagnose: () => ipcRenderer.invoke('diagnose:run'),
  tweaks: () => ipcRenderer.invoke('tweaks:list'),
  activate: (payload) => ipcRenderer.invoke('license:activate', payload),
  verify: () => ipcRenderer.invoke('license:verify'),
  rebind: () => ipcRenderer.invoke('license:rebind'),
  localLicense: () => ipcRenderer.invoke('license:local'),
  applyTweaks: (ids) => ipcRenderer.invoke('optimize:apply', ids),
  revertTweaks: () => ipcRenderer.invoke('optimize:revert'),
  appliedTweaks: () => ipcRenderer.invoke('optimize:applied'),
  obsPreset: (speedMbps) => ipcRenderer.invoke('obs:preset', speedMbps),
  speedTest: () => ipcRenderer.invoke('speed:test'),
  isAdmin: () => ipcRenderer.invoke('system:isAdmin'),

  systemBios: () => ipcRenderer.invoke('system:bios'),
  openMsInfo: () => ipcRenderer.invoke('system:open-msinfo'),

  powerInfo: () => ipcRenderer.invoke('power:info'),
  powerSet: (guid) => ipcRenderer.invoke('power:set', guid),
  powerUltra: () => ipcRenderer.invoke('power:ultra'),
  powerNoSleep: () => ipcRenderer.invoke('power:no-sleep'),
  powerDiskOff: () => ipcRenderer.invoke('power:disk-off'),
  powerMonitor: (minutes) => ipcRenderer.invoke('power:monitor', minutes),

  gpuInfo: () => ipcRenderer.invoke('gpu:info'),
  gpuNvidiaSmi: () => ipcRenderer.invoke('gpu:nvidia-smi'),
  gpuOpenPanel: () => ipcRenderer.invoke('gpu:open-panel'),
  gpuApplyBest: () => ipcRenderer.invoke('gpu:apply-best'),

  splash: {
    onStatus: (cb) => ipcRenderer.on('splash:status', (_e, d) => cb(d)),
    onResult: (cb) => ipcRenderer.on('splash:result', (_e, d) => cb(d)),
    login: () => ipcRenderer.send('splash:login'),
    openMain: () => ipcRenderer.send('splash:open-main')
  },

  discordLogin: () => ipcRenderer.invoke('discord:login'),

  postinstallList: () => ipcRenderer.invoke('postinstall:list'),
  postinstallApply: (ids) => ipcRenderer.invoke('postinstall:apply', ids),
  postinstallRevert: () => ipcRenderer.invoke('postinstall:revert'),
  postinstallApplied: () => ipcRenderer.invoke('postinstall:applied'),

  gamesList: () => ipcRenderer.invoke('games:list'),
  gamesApply: (names) => ipcRenderer.invoke('games:apply', names),
  gamesRevert: (names) => ipcRenderer.invoke('games:revert', names),

  driverInfo: () => ipcRenderer.invoke('driver:info'),
  driverCheck: () => ipcRenderer.invoke('driver:check'),
  driverDownload: () => ipcRenderer.invoke('driver:download'),
  driverInstall: (exePath) => ipcRenderer.invoke('driver:install', exePath),
  driverOpenPage: () => ipcRenderer.invoke('driver:open-page')
});
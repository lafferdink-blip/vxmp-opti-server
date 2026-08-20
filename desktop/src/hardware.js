const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileP = promisify(execFile);

const PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$cpu    = Get-CimInstance Win32_Processor
$gpu    = Get-CimInstance Win32_VideoController
$mem    = Get-CimInstance Win32_PhysicalMemory
$cs     = Get-CimInstance Win32_ComputerSystem
$os     = Get-CimInstance Win32_OperatingSystem
$board  = Get-CimInstance Win32_BaseBoard
$disk   = Get-CimInstance Win32_DiskDrive
$bios   = Get-CimInstance Win32_BIOS
$net    = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' }
$props = [ordered]@{
  pcName    = $cs.Name
  isVirtual = $cs.Model
  systemType = $cs.PCSystemType
  cpu       = $cpu | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors, MaxClockSpeed, CurrentClockSpeed, LoadPercentage, ProcessorId
  gpu       = $gpu | Select-Object Name, DriverVersion, AdapterRAM, VideoProcessor
  ramGB     = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
  ram       = $mem | Select-Object Capacity, Speed
  board     = $board | Select-Object Manufacturer, Product, SerialNumber
  bios      = $bios | Select-Object Manufacturer, SMBIOSBIOSVersion, Version, ReleaseDate, SerialNumber
  battery   = Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining, BatteryStatus, EstimatedRunTime
  os        = $os | Select-Object Caption, Version, BuildNumber
  disks     = $disk | Select-Object Model, MediaType, Size, SerialNumber
  net       = $net | Select-Object Name, InterfaceDescription, LinkSpeed, MacAddress
}
$props | ConvertTo-Json -Depth 5
`;

async function execPs(script) {
  const utf8 = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ' + script;
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', utf8];
  const { stdout } = await execFileP('powershell.exe', args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

async function getHardwareInfo() {
  const stdout = await execPs(PS_SCRIPT);
  const data = JSON.parse(stdout);
  return normalize(data);
}

function normalize(d) {
  const first = (obj) => Array.isArray(obj) ? obj[0] : obj;
  const cpu = first(d.cpu);
  const gpuArr = Array.isArray(d.gpu) ? d.gpu : (d.gpu ? [d.gpu] : []);
  const netArr = Array.isArray(d.net) ? d.net : (d.net ? [d.net] : []);
  const bat = first(d.battery);
  return {
    pcName: d.pcName,
    isVirtual: d.isVirtual,
    systemType: d.systemType,
    os: d.os ? { caption: first(d.os).Caption, version: first(d.os).Version, build: first(d.os).BuildNumber } : null,
    cpu: cpu ? {
      name: cpu.Name,
      cores: cpu.NumberOfCores,
      threads: cpu.NumberOfLogicalProcessors,
      maxClockMhz: cpu.MaxClockSpeed,
      currentClockMhz: cpu.CurrentClockSpeed,
      load: cpu.LoadPercentage,
      processorId: cpu.ProcessorId
    } : null,
    gpu: gpuArr.map(g => ({
      name: g.Name,
      driver: g.DriverVersion,
      vramMB: Math.round((g.AdapterRAM || 0) / (1024 * 1024)),
      processor: g.VideoProcessor
    })),
    ramGB: d.ramGB,
    ram: Array.isArray(d.ram) ? d.ram.map(m => ({ capacityMB: Math.round((m.Capacity || 0) / (1024 * 1024)), speedMhz: m.Speed })) : [],
    board: d.board ? { manufacturer: first(d.board).Manufacturer, product: first(d.board).Product, serial: first(d.board).SerialNumber } : null,
    bios: d.bios ? (() => {
      const b = first(d.bios);
      let releaseDate = b.ReleaseDate || null;
      if (typeof releaseDate === 'string' && releaseDate.startsWith('/Date(')) {
        const ts = parseInt(releaseDate.replace('/Date(', '').replace(')/', ''), 10);
        releaseDate = new Date(ts).toISOString();
      }
      return {
        manufacturer: b.Manufacturer,
        smbiosVersion: b.SMBIOSBIOSVersion,
        version: b.Version,
        releaseDate,
        serial: b.SerialNumber
      };
    })() : null,
    battery: bat ? {
      chargePercent: bat.EstimatedChargeRemaining,
      batteryStatus: bat.BatteryStatus,
      runtimeMin: bat.EstimatedRunTime,
      isLaptop: d.systemType === 2 || d.systemType === 3
    } : null,
    disks: Array.isArray(d.disks) ? d.disks.map(x => ({ model: x.Model, media: x.MediaType, sizeGB: x.Size ? Math.round(x.Size / 1e9) : null, serial: x.SerialNumber })) : [],
    net: netArr.map(n => ({
      name: n.Name,
      desc: n.InterfaceDescription,
      linkSpeedMbps: n.LinkSpeed ? Math.round(n.LinkSpeed / 1e6) : null,
      mac: n.MacAddress
    }))
  };
}

module.exports = { getHardwareInfo, execPs };
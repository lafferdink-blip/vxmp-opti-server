const { run, regQuery, regSet, regDelete } = require('./system');
const { execPs } = require('../hardware');

const POSTINSTALL_ACTIONS = [
  {
    id: 'pi_bloat',
    category: 'nettoyage',
    label: 'Supprimer les applis préinstallées',
    description: 'Retire les applis inutiles du Microsoft Store (Bing, Solitaire, Votre téléphone, etc.).'
  },
  {
    id: 'pi_tips',
    category: 'confidentialité',
    label: 'Désactiver astuces et suggestions',
    description: 'Cache les conseils Windows et les suggestions du menu Démarrer.'
  },
  {
    id: 'pi_bing',
    category: 'confidentialité',
    label: 'Désactiver la recherche Bing',
    description: 'La recherche du menu Démarrer ne s\'appuie plus sur le web.'
  },
  {
    id: 'pi_adid',
    category: 'confidentialité',
    label: 'Désactiver l\'identifiant publicitaire',
    description: 'Windows n\'utilise plus votre ID de suivi pour la publicité.'
  },
  {
    id: 'pi_gamebar',
    category: 'jeu',
    label: 'Désactiver la barre de jeux (Game Bar)',
    description: 'Libère des ressources : désactive la Game Bar et l\'enregistrement par défaut.'
  },
  {
    id: 'pi_temp',
    category: 'nettoyage',
    label: 'Nettoyer les fichiers temporaires',
    description: 'Vide les dossiers Temp utilisateur et Windows (action ponctuelle, non réversible).'
  }
];

const BLOAT_PACKAGES = [
  'Microsoft.3DBuilder', 'BingWeather', 'BingNews', 'Microsoft.BingSports',
  'Microsoft.BingFinance', 'Microsoft.BingFoodAndDrink', 'Microsoft.BingTravel',
  'Microsoft.GetHelp', 'Microsoft.Microsoft3DViewer', 'Microsoft.MicrosoftOfficeHub',
  'Microsoft.MicrosoftSolitaireCollection', 'Microsoft.MixedReality.Portal',
  'Microsoft.Office.OneNote', 'Microsoft.Paint3D', 'Microsoft.People',
  'Microsoft.SkypeApp', 'Microsoft.Wallet', 'Microsoft.WindowsAlarms',
  'Microsoft.WindowsCamera', 'Microsoft.WindowsCommunicationsApps',
  'Microsoft.WindowsFeedbackHub', 'Microsoft.WindowsMaps', 'Microsoft.WindowsSoundRecorder',
  'Microsoft.Xbox.TCUI', 'Microsoft.XboxApp', 'Microsoft.ZuneMusic', 'Microsoft.ZuneVideo'
];

async function applyPostInstall(state, ids) {
  const results = [];
  state.postinstall = state.postinstall || {};

  if (ids.includes('pi_bloat') && !state.postinstall.pi_bloat) {
    const list = BLOAT_PACKAGES.map(p => `'${p}'`).join(',');
    const script = `$ErrorActionPreference='SilentlyContinue'
      $t = @(${list})
      Get-AppxPackage -AllUsers | Where-Object { $t -contains $_.Name -or $t -contains $_.PackageFamilyName } | ForEach-Object {
        try { Remove-AppxPackage -Package $_.PackageFullName -ErrorAction SilentlyContinue } catch {}
      }
      'done'`;
    const r = await execPs(script);
    state.postinstall.pi_bloat = { done: true };
    results.push({ id: 'pi_bloat', ok: true, detail: 'Applications préinstallées supprimées (vérifiez le Menu Démarrer).' });
  }

  if (ids.includes('pi_tips') && !state.postinstall.pi_tips) {
    const path = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager';
    const prev = {
      a: await regQuery(path, 'SubscribedContent-338389Enabled'),
      b: await regQuery(path, 'SubscribedContent-338388Enabled'),
      c: await regQuery(path, 'SubscribedContent-310093Enabled'),
      d: await regQuery(path, 'SystemPaneSuggestionsEnabled')
    };
    state.postinstall.pi_tips = { path, prev };
    const r1 = await regSet(path, 'SubscribedContent-338389Enabled', 0);
    const r2 = await regSet(path, 'SubscribedContent-338388Enabled', 0);
    const r3 = await regSet(path, 'SubscribedContent-310093Enabled', 0);
    const r4 = await regSet(path, 'SystemPaneSuggestionsEnabled', 0);
    results.push({ id: 'pi_tips', ok: r1.ok && r2.ok && r3.ok && r4.ok, detail: 'Astuces et suggestions désactivées.' });
  }

  if (ids.includes('pi_bing') && !state.postinstall.pi_bing) {
    const path = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Search';
    const prev = { a: await regQuery(path, 'BingSearchEnabled'), b: await regQuery(path, 'CortanaConsent') };
    state.postinstall.pi_bing = { path, prev };
    const r1 = await regSet(path, 'BingSearchEnabled', 0);
    const r2 = await regSet(path, 'CortanaConsent', 0);
    results.push({ id: 'pi_bing', ok: r1.ok && r2.ok, detail: 'Recherche Bing désactivée dans le menu Démarrer.' });
  }

  if (ids.includes('pi_adid') && !state.postinstall.pi_adid) {
    const polPath = 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\AdvertisingInfo';
    const usrPath = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo';
    const prev = { a: await regQuery(polPath, 'DisabledByGroupPolicy'), b: await regQuery(usrPath, 'Enabled') };
    state.postinstall.pi_adid = { polPath, usrPath, prev };
    const r1 = await regSet(polPath, 'DisabledByGroupPolicy', 1);
    const r2 = await regSet(usrPath, 'Enabled', 0);
    results.push({ id: 'pi_adid', ok: r1.ok && r2.ok, detail: 'Identifiant publicitaire désactivé.' });
  }

  if (ids.includes('pi_gamebar') && !state.postinstall.pi_gamebar) {
    const path = 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\GameDVR';
    const prev = await regQuery(path, 'AllowGameDVR');
    state.postinstall.pi_gamebar = { path, prev };
    const r1 = await regSet(path, 'AllowGameDVR', 0);
    const r2 = await regSet('HKCU\\System\\GameConfigStore', 'GameDVR_Enabled', 0);
    results.push({ id: 'pi_gamebar', ok: r1.ok && r2.ok, detail: 'Game Bar et enregistrement désactivés.' });
  }

  if (ids.includes('pi_temp') && !state.postinstall.pi_temp) {
    const script = `$ErrorActionPreference='SilentlyContinue'
      Remove-Item "$env:TEMP\\*" -Recurse -Force
      Remove-Item "C:\\Windows\\Temp\\*" -Recurse -Force
      'done'`;
    await execPs(script);
    state.postinstall.pi_temp = { done: true };
    results.push({ id: 'pi_temp', ok: true, detail: 'Fichiers temporaires nettoyés.' });
  }

  return results;
}

async function revertPostInstall(state) {
  const results = [];
  const pi = state.postinstall || {};

  if (pi.pi_tips) {
    const { path, prev } = pi.pi_tips;
    await restoreReg(path, 'SubscribedContent-338389Enabled', prev.a);
    await restoreReg(path, 'SubscribedContent-338388Enabled', prev.b);
    await restoreReg(path, 'SubscribedContent-310093Enabled', prev.c);
    await restoreReg(path, 'SystemPaneSuggestionsEnabled', prev.d);
    results.push({ id: 'pi_tips', ok: true, detail: 'Astuces et suggestions restaurées.' });
    delete pi.pi_tips;
  }
  if (pi.pi_bing) {
    const { path, prev } = pi.pi_bing;
    await restoreReg(path, 'BingSearchEnabled', prev.a);
    await restoreReg(path, 'CortanaConsent', prev.b);
    results.push({ id: 'pi_bing', ok: true, detail: 'Recherche Bing restaurée.' });
    delete pi.pi_bing;
  }
  if (pi.pi_adid) {
    const { polPath, usrPath, prev } = pi.pi_adid;
    await restoreReg(polPath, 'DisabledByGroupPolicy', prev.a);
    await restoreReg(usrPath, 'Enabled', prev.b);
    results.push({ id: 'pi_adid', ok: true, detail: 'Identifiant publicitaire restauré.' });
    delete pi.pi_adid;
  }
  if (pi.pi_gamebar) {
    const { path, prev } = pi.pi_gamebar;
    await restoreReg(path, 'AllowGameDVR', prev);
    await regSet('HKCU\\System\\GameConfigStore', 'GameDVR_Enabled', 1);
    results.push({ id: 'pi_gamebar', ok: true, detail: 'Game Bar restaurée.' });
    delete pi.pi_gamebar;
  }
  if (pi.pi_bloat) { delete pi.pi_bloat; results.push({ id: 'pi_bloat', ok: true, detail: 'Bloatware : réinstallez depuis le Microsoft Store si besoin.' }); }
  if (pi.pi_temp) { delete pi.pi_temp; results.push({ id: 'pi_temp', ok: true, detail: 'Nettoyage Temp : action ponctuelle, rien à restaurer.' }); }

  return results;
}

async function restoreReg(path, name, prev) {
  if (prev !== null && prev !== undefined) {
    const v = parseInt(prev, 10);
    await regSet(path, name, isNaN(v) ? prev : v, isNaN(v) ? 'REG_SZ' : 'REG_DWORD');
  } else {
    await regDelete(path, name);
  }
}

module.exports = { POSTINSTALL_ACTIONS, applyPostInstall, revertPostInstall };
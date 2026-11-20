'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { importAndLaunchRelease, launchSelectedRelease, openBrowser, ReleaseLaunchError } = require('./release-launcher');
const { fingerprint, launchAnchor, localApplication, readRecord, readRollbackSelection, readSelection, saveSelection, versionPattern } = require('./release-selection');

const run = promisify(execFile);
const sha256Pattern = /^[a-f0-9]{64}$/iu;

function selectedReleaseRecord(file) {
  try {
    const record = readRecord(file);
    // Check the outer record before comparing versions. The importer still verifies the full record and ZIP.
    if (record?.file === 'agents-workbench-react.zip' && record.platform === 'windows-x64' &&
        record.formal === true && record.localBuildChanges === false &&
        typeof record.version === 'string' && versionPattern.test(record.version) &&
        typeof record.node === 'string' && versionPattern.test(record.node) &&
        typeof record.sourceBaseRevision === 'string' && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/iu.test(record.sourceBaseRevision) &&
        typeof record.installerSha256 === 'string' && sha256Pattern.test(record.installerSha256) &&
        record.documentationSha256 && typeof record.documentationSha256 === 'object' && !Array.isArray(record.documentationSha256) &&
        Number.isSafeInteger(record.bytes) && record.bytes > 0 &&
        typeof record.sha256 === 'string' && sha256Pattern.test(record.sha256)) return record;
  } catch { /* An unreadable or malformed selection can be replaced. */ }
  return null;
}

function newerVersion(currentVersion, nextVersion) {
  if (typeof nextVersion !== 'string' || !versionPattern.test(nextVersion)) return false;
  const current = currentVersion.split('.').map(BigInt);
  const next = nextVersion.split('.').map(BigInt);
  const changed = next.findIndex((part, index) => part !== current[index]);
  return changed !== -1 && next[changed] > current[changed];
}

async function pickRelease({ signal } = {}) {
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const script = `
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
function Select-ReleaseFile($title, $filter) {
  $dialog = New-Object System.Windows.Forms.OpenFileDialog
  try {
    $dialog.Title = $title
    $dialog.Filter = $filter
    $dialog.CheckFileExists = $true
    if ($dialog.ShowDialog() -eq 'OK') { $dialog.FileName }
  } finally { $dialog.Dispose() }
}
$archive = Select-ReleaseFile '选择团队发放的工作台 ZIP' '工作台压缩包 (*.zip)|*.zip'
if ($archive) {
  $record = Select-ReleaseFile '选择工作台 ZIP 对应的包外发行记录' '工作台发行记录 (*.json)|*.json'
  if ($record) { @{archive=$archive;releaseRecord=$record} | ConvertTo-Json -Compress }
}
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const { stdout } = await run(powershell, ['-NoProfile', '-STA', '-EncodedCommand', encoded], {
    windowsHide: true, encoding: 'utf8', maxBuffer: 64 * 1024, signal,
  });
  return stdout.trim() ? JSON.parse(stdout) : null;
}

function createReleaseUpdateService(projectRoot, {
  applicationRoot = path.resolve(__dirname, '../../..'),
  inheritedAnchor,
  platform = process.platform,
  choose = pickRelease,
  launch = importAndLaunchRelease,
  relaunch = launchSelectedRelease,
  openPrevious = openBrowser,
} = {}) {
  let application;
  let anchor;
  try {
    if (platform === 'win32' && projectRoot) application = localApplication(applicationRoot);
    if (application) anchor = launchAnchor(application, inheritedAnchor, projectRoot);
  }
  catch { /* A source checkout or an incomplete package keeps its existing launch path. */ }
  function rollbackSelection() {
    return readRollbackSelection(anchor, application, projectRoot);
  }

  return {
    get available() { return Boolean(application); },
    get canRollback() {
      try { return Boolean(application && rollbackSelection()); }
      catch { return false; }
    },
    async open(observation, { signal } = {}) {
      if (!application) return { error: 'release-update-unavailable' };
      if (signal?.aborted) return { cancelled: true };
      let files;
      try { files = await choose({ signal }); }
      catch { return signal?.aborted ? { cancelled: true } : { error: 'release-picker-unavailable' }; }
      if (!files || signal?.aborted) return { cancelled: true };
      const record = selectedReleaseRecord(files.releaseRecord);
      if (!record) return { error: 'release-record-invalid' };

      try {
        if (!newerVersion(application.version, record.version)) return { error: 'release-not-newer' };
        let selection;
        try { selection = readSelection(anchor, projectRoot); }
        catch { /* A corrupt or inaccessible default must still allow opening a verified candidate. */ }
        if (selection && !newerVersion(selection.current.version, record.version)) return { error: 'release-not-newer' };
        const result = await launch({ archive: files.archive, releaseRecord: files.releaseRecord, projectRoot, installRoot: application.installRoot,
          expectedBinding: observation.binding, expectedRelease: { version: record.version, sha256: record.sha256 }, anchor });
        if (result.release.version !== record.version || result.release.sha256.toLowerCase() !== record.sha256.toLowerCase()) {
          await result.close();
          return { error: 'release-selection-changed' };
        }
        let selectionSaved = false;
        try {
          const previous = selection?.current ?? { base: true, version: anchor.version, treeDigest: await fingerprint(anchor.directory) };
          const current = { base: false, version: result.release.version, treeDigest: result.release.treeDigest };
          saveSelection(anchor, projectRoot, selection, { current, previous });
          selectionSaved = true;
        } catch { /* The verified candidate remains available even when its default couldn't be saved. */ }
        return { version: result.release.version, address: result.address, selectionSaved };
      } catch (error) {
        return { error: error instanceof ReleaseLaunchError ? error.code : 'import-failed' };
      }
    },
    async rollback(observation) {
      if (!application) return { error: 'release-update-unavailable' };
      try {
        const selection = rollbackSelection();
        if (!selection) return { error: 'release-rollback-unavailable' };
        const result = await relaunch({ anchor, entry: selection.previous, projectRoot, expectedBinding: observation.binding });
        try { saveSelection(anchor, projectRoot, selection, { current: selection.previous, previous: null }); }
        catch (error) { await result.close(); throw error; }
        try { openPrevious(result.address); } catch { /* The page still offers the ready local address. */ }
        return { version: result.release.version, address: result.address, selectionSaved: true };
      } catch (error) {
        return { error: error instanceof ReleaseLaunchError ? error.code : 'release-rollback-failed' };
      }
    },
  };
}

module.exports = { createReleaseUpdateService };

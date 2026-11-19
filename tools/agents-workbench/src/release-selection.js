'use strict';

const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const versionPattern = /^\d+\.\d+\.\d+$/u;
const digestPattern = /^[a-f0-9]{64}$/u;
const stateDirectory = '.workbench-launch';
// The OS releases the per-record mutex even when a Launcher process is terminated mid-save.
const replaceSelectionCommand = Buffer.from(String.raw`
$ErrorActionPreference = 'Stop'
$change = ConvertFrom-Json -InputObject $env:WORKBENCH_SELECTION_CHANGE
$mutex = [Threading.Mutex]::new($false, 'Global\imedical-agents-workbench-' + $change.key)
$locked = $false
$temp = $null
try {
  try { $locked = $mutex.WaitOne(3000) }
  catch [Threading.AbandonedMutexException] { $locked = $true }
  if (-not $locked) { throw 'Workbench selection is busy.' }
  $current = $null
  if ([IO.File]::Exists($change.file)) {
    if ([IO.File]::GetAttributes($change.file) -band [IO.FileAttributes]::ReparsePoint) { throw 'Invalid Workbench selection path.' }
    $current = [IO.File]::ReadAllText($change.file, [Text.Encoding]::UTF8)
  }
  if ($current -cne $change.expected) { exit 2 }
  $target = $change.file + '.tmp'
  if ([IO.File]::Exists($target)) {
    if ([IO.File]::GetAttributes($target) -band [IO.FileAttributes]::ReparsePoint) { throw 'Invalid Workbench temporary selection path.' }
    [IO.File]::Delete($target)
  }
  $output = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  $temp = $target
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($change.next)
    $output.Write($bytes, 0, $bytes.Length)
    $output.Flush($true)
  } finally { $output.Dispose() }
  if ($null -eq $current) { [IO.File]::Move($temp, $change.file) }
  else { [IO.File]::Replace($temp, $change.file, [NullString]::Value) }
  $temp = $null
} finally {
  try { if ($temp) { [IO.File]::Delete($temp) } }
  finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
  }
}
`, 'utf16le').toString('base64');

function readRecord(file) {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size > 128 * 1024) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''));
}

function localApplication(root) {
  const directory = fs.realpathSync.native(root);
  if (directory.startsWith('\\\\') || fs.existsSync(path.join(directory, '.git'))) return null;
  const record = readRecord(path.join(directory, 'workbench-release.json'));
  if (record?.formal !== true || record.localBuildChanges !== false || record.platform !== 'windows-x64' ||
      typeof record.version !== 'string' || !versionPattern.test(record.version) ||
      !fs.lstatSync(path.join(directory, 'runtime/node.exe'), { throwIfNoEntry: false })?.isFile()) return null;
  return { version: record.version, directory, installRoot: path.dirname(directory) };
}

function launchAnchor(application, inherited = process.env.WORKBENCH_LAUNCH_ANCHOR) {
  if (inherited) {
    try {
      const anchor = localApplication(inherited);
      if (anchor?.installRoot === application.installRoot) return anchor;
    } catch { /* A moved installation launches from its own directory. */ }
  }
  return application;
}

function statePath(anchor, projectRoot) {
  const project = fs.realpathSync.native(projectRoot);
  const stat = fs.statSync(project, { bigint: true });
  if (!stat.isDirectory()) throw Error('project-unavailable');
  const directory = path.join(anchor.directory, stateDirectory);
  if (fs.existsSync(directory) && !fs.lstatSync(directory).isDirectory()) throw Error('selection-unavailable');
  const key = crypto.createHash('sha256').update(JSON.stringify([project, String(stat.dev), String(stat.ino)])).digest('hex');
  return path.join(directory, key + '.json');
}

function validEntry(entry) {
  return Boolean(entry && typeof entry.base === 'boolean' && typeof entry.version === 'string' && versionPattern.test(entry.version) &&
    typeof entry.treeDigest === 'string' && digestPattern.test(entry.treeDigest));
}

function validSelection(record) {
  return Boolean(record && validEntry(record.current) && (record.previous === null || validEntry(record.previous)));
}

function readStateFile(file) {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return { text: null, selection: null };
  if (!stat.isFile() || stat.nlink > 1 || stat.size > 128 * 1024) throw Error('selection-unavailable');
  const text = fs.readFileSync(file, 'utf8');
  const selection = JSON.parse(text);
  if (selection !== null && !validSelection(selection)) throw Error('selection-unavailable');
  return { text, selection };
}

function readSelection(anchor, projectRoot) {
  return readStateFile(statePath(anchor, projectRoot)).selection;
}

function saveSelection(anchor, projectRoot, previous, next) {
  if (next !== null && !validSelection(next)) throw Error('selection-unavailable');
  const file = statePath(anchor, projectRoot);
  const { text, selection } = readStateFile(file);
  if (JSON.stringify(selection) !== JSON.stringify(previous)) throw Error('selection-changed');
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!fs.lstatSync(directory).isDirectory()) throw Error('selection-unavailable');
  const key = crypto.createHash('sha256').update(file.toLowerCase()).digest('hex');
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'workbench_selection_change'));
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', replaceSelectionCommand], {
    windowsHide: true, timeout: 7000, stdio: 'ignore', env: { ...env,
      WORKBENCH_SELECTION_CHANGE: JSON.stringify({ key, file, expected: text, next: JSON.stringify(next) + '\n' }),
    },
  });
  if (result.status === 2) throw Error('selection-changed');
  if (result.status !== 0) throw Error('selection-unavailable');
}

function releaseDirectory(anchor, entry) {
  return entry.base ? anchor.directory : path.join(anchor.installRoot, `agents-workbench-react-${entry.version}`);
}

async function fingerprint(directory) {
  if (!fs.lstatSync(directory).isDirectory() || fs.realpathSync.native(directory) !== directory) throw Error('release-changed');
  const envelope = crypto.createHash('sha256');
  async function walk(relative) {
    const names = fs.readdirSync(path.join(directory, relative)).sort();
    for (const name of names) {
      const item = relative ? relative + '/' + name : name;
      const file = path.join(directory, item);
      const stat = fs.lstatSync(file);
      if (item === stateDirectory && stat.isDirectory()) continue;
      if (stat.isDirectory()) {
        envelope.update(JSON.stringify(['directory', item]) + '\n');
        await walk(item);
      } else if (stat.isFile() && stat.nlink <= 1) {
        const contents = crypto.createHash('sha256');
        for await (const bytes of fs.createReadStream(file)) contents.update(bytes);
        envelope.update(JSON.stringify(['file', item, contents.digest('hex')]) + '\n');
      } else throw Error('release-changed');
    }
  }
  await walk('');
  return envelope.digest('hex');
}

module.exports = { fingerprint, launchAnchor, localApplication, readRecord, readSelection, releaseDirectory, saveSelection, versionPattern };

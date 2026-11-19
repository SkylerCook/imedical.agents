'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createTempDirectory, ownsTempDirectory } = require('../../../scripts/tests/fixtures/temp-directory');

const importer = path.resolve(__dirname, '../react/import-workbench-release.ps1');
const windowsOnly = { skip: process.platform !== 'win32' };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const longEntry = `nested/${'a'.repeat(100)}/${'b'.repeat(100)}/notes.txt`;
const docs = {
  'docs/guides/usage-manual.md': '# Team guide\n',
  'docs/update-agents.md': '# Update\n',
  'docs/workspace-overlay.md': '# Overlay\n',
};
const installer = '# Sample installer\n';
const metadata = {
  version: '0.2.1', platform: 'windows-x64', formal: true, node: '24.22.3',
  sourceBaseRevision: 'a'.repeat(40), localBuildChanges: false,
  installerSha256: digest(installer), documentationSha256: Object.fromEntries(Object.entries(docs).map(([name, bytes]) => [name, digest(bytes)])),
};

function fixture(t) {
  const root = createTempDirectory('workbench-release-import-');
  t.after(() => {
    assert.ok(ownsTempDirectory(root));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  });
  const installRoot = path.join(root, '工作台 [安装]');
  const old = path.join(installRoot, 'agents-workbench-react-0.2.0');
  fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, 'start-workbench.cmd'), 'old launcher');
  fs.writeFileSync(path.join(root, 'outside.txt'), 'existing project');
  return { root, installRoot, old };
}

function powershell(command, env) {
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    windowsHide: true, encoding: 'utf8', timeout: 15000, env: { ...process.env, ...env },
  });
}

function writeRelease(root, { inner = metadata, extra = [], replace = {}, omit = [], corrupt = false, outer = {} } = {}) {
  const archive = path.join(root, '下载重复名 (1).zip');
  const record = path.join(root, 'approved-release.json');
  if (corrupt) {
    fs.writeFileSync(archive, 'not a ZIP');
  } else {
    const files = {
      'workbench-release.json': JSON.stringify(inner),
      'runtime/node.exe': 'fixture only', 'runtime/LICENSE': 'license',
      'start-workbench.cmd': 'new launcher',
      'tools/agents-workbench/prototype/serve.js': 'process.exit(41)',
      'tools/agents-workbench/react/dist/index.html': '<!doctype html>',
      'scripts/install-agents.ps1': installer,
      'plugins/empty/': '',
      ...docs, ...replace,
    };
    const entries = Object.entries(files).filter(([name]) => !omit.includes(name)).map(([name, text]) => ({ name, text }));
    const entryFile = path.join(root, 'entries.json');
    fs.writeFileSync(entryFile, JSON.stringify([...entries, ...extra]));
    const created = powershell(`
      $ErrorActionPreference = 'Stop'
      Add-Type -AssemblyName System.IO.Compression
      $stream = [IO.File]::Open($env:WORKBENCH_TEST_ZIP, [IO.FileMode]::CreateNew)
      try {
        $zip = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $true)
        try {
          foreach ($entry in (Get-Content -LiteralPath $env:WORKBENCH_TEST_ENTRIES -Raw -Encoding UTF8 | ConvertFrom-Json)) {
            $file = $zip.CreateEntry($entry.name)
            if ($entry.attributes) { $file.ExternalAttributes = [int]$entry.attributes }
            $data = $file.Open()
            try {
              $bytes = [Text.Encoding]::UTF8.GetBytes([string]$entry.text)
              $data.Write($bytes, 0, $bytes.Length)
            } finally { $data.Dispose() }
          }
        } finally { $zip.Dispose() }
      } finally { $stream.Dispose() }
    `, { WORKBENCH_TEST_ZIP: archive, WORKBENCH_TEST_ENTRIES: entryFile });
    assert.equal(created.status, 0, created.stderr || created.error?.message);
  }
  const bytes = fs.readFileSync(archive);
  fs.writeFileSync(record, JSON.stringify({
    ...metadata, file: 'agents-workbench-react.zip', bytes: bytes.length, sha256: digest(bytes), ...outer,
  }));
  return { archive, record };
}

function runImport(f, release) {
  return powershell(`
    $ErrorActionPreference = 'Stop'
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    & $env:WORKBENCH_TEST_IMPORT -Archive $env:WORKBENCH_TEST_ZIP -ReleaseRecord $env:WORKBENCH_TEST_RECORD -InstallRoot $env:WORKBENCH_TEST_ROOT
  `, {
    WORKBENCH_TEST_IMPORT: importer, WORKBENCH_TEST_ZIP: release.archive,
    WORKBENCH_TEST_RECORD: release.record, WORKBENCH_TEST_ROOT: f.installRoot,
  });
}

function assertPreserved(f, versions = ['agents-workbench-react-0.2.0']) {
  assert.deepEqual(fs.readdirSync(f.installRoot).sort(), versions);
  assert.equal(fs.readFileSync(path.join(f.old, 'start-workbench.cmd'), 'utf8'), 'old launcher');
  assert.equal(fs.readFileSync(path.join(f.root, 'outside.txt'), 'utf8'), 'existing project');
}

function assertRejected(f, release, error) {
  const result = runImport(f, release);
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  if (error) assert.match(result.stderr, error);
  assertPreserved(f);
}

test('a verified full ZIP installs side by side and preserves existing versions', windowsOnly, t => {
  const f = fixture(t);
  const release = writeRelease(f.root, { extra: [{ name: longEntry, text: 'kept at a long Windows path' }] });
  const result = runImport(f, release);
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const target = path.join(f.installRoot, 'agents-workbench-react-0.2.1');
  assert.deepEqual(JSON.parse(result.stdout), {
    state: 'imported', version: metadata.version, sourceBaseRevision: metadata.sourceBaseRevision,
    sha256: digest(fs.readFileSync(release.archive)).toUpperCase(), path: target,
  });
  assert.equal(fs.readFileSync(path.join(target, 'start-workbench.cmd'), 'utf8'), 'new launcher');
  assert.equal(fs.statSync(path.join(target, 'plugins/empty')).isDirectory(), true);
  assert.equal(fs.readFileSync(path.join(target, longEntry), 'utf8'), 'kept at a long Windows path');
  assert.equal(fs.readFileSync(path.join(target, 'docs/guides/usage-manual.md'), 'utf8'), docs['docs/guides/usage-manual.md']);
  fs.writeFileSync(path.join(target, 'owner.txt'), 'kept');

  const repeated = runImport(f, release);
  assert.notEqual(repeated.status, 0);
  assert.match(repeated.stderr, /already exists/);
  assert.equal(fs.readFileSync(path.join(target, 'owner.txt'), 'utf8'), 'kept');
  assertPreserved(f, ['agents-workbench-react-0.2.0', 'agents-workbench-react-0.2.1']);
});

test('release size, digest and ZIP format failures leave the older tree untouched', windowsOnly, async t => {
  await t.test('size mismatch', t => {
    const f = fixture(t);
    assertRejected(f, writeRelease(f.root, { outer: { bytes: 1 } }), /size does not match/);
  });
  await t.test('archive bytes changed after the release record was made', t => {
    const f = fixture(t);
    const release = writeRelease(f.root);
    const bytes = fs.readFileSync(release.archive);
    bytes[20] ^= 1;
    fs.writeFileSync(release.archive, bytes);
    assertRejected(f, release, /ZIP SHA-256 does not match/);
  });
  await t.test('malformed archive with a matching digest', t => {
    const f = fixture(t);
    assertRejected(f, writeRelease(f.root, { corrupt: true }));
  });
});

test('unsafe archive namespaces are rejected even with a matching digest', windowsOnly, async t => {
  const cases = [
    ['parent traversal', { name: '../outside.txt', text: 'must not replace' }, /unsafe entry path/],
    ['Windows stream', { name: 'README.md:payload', text: 'unsafe' }, /unsafe entry path/],
    ['reserved device', { name: 'dev/AUX.log', text: 'unsafe' }, /unsafe entry path/],
    ['case collision', { name: 'Runtime/NODE.exe', text: 'unsafe' }, /colliding entries/],
    ['file and directory collision', { name: 'docs', text: 'unsafe' }, /colliding entries/],
    ['Unix symlink', { name: 'external-link', text: '../outside.txt', attributes: 0xa1ff << 16 }, /linked or unsupported/],
    ['Windows reparse attribute', { name: 'reparse', text: '../outside.txt', attributes: 0x400 }, /linked or unsupported/],
  ];
  for (const [label, entry, error] of cases) {
    await t.test(label, t => {
      const f = fixture(t);
      assertRejected(f, writeRelease(f.root, { extra: [entry] }), error);
    });
  }
});

test('metadata and package file digests must agree with the trusted release record', windowsOnly, async t => {
  await t.test('different release inside the ZIP', t => {
    const f = fixture(t);
    assertRejected(f, writeRelease(f.root, { inner: { ...metadata, version: '0.2.2' } }), /metadata does not match/);
  });
  await t.test('missing launcher', t => {
    const f = fixture(t);
    assertRejected(f, writeRelease(f.root, { omit: ['start-workbench.cmd'] }), /missing a required file/);
  });
  await t.test('a runtime pin must be present in both records and match', t => {
    const f = fixture(t);
    const pin = { revision: metadata.sourceBaseRevision, treeDigest: 'b'.repeat(64) };
    const oneSided = writeRelease(f.root, { inner: { ...metadata, runtimePin: pin } });
    assertRejected(f, oneSided, /runtime pin does not match/);
    fs.unlinkSync(oneSided.archive);
    const conflicting = writeRelease(f.root, {
      inner: { ...metadata, runtimePin: pin }, outer: { runtimePin: { ...pin, treeDigest: 'c'.repeat(64) } },
    });
    assertRejected(f, conflicting, /runtime pin does not match/);
    fs.unlinkSync(conflicting.archive);
    const matching = writeRelease(f.root, { inner: { ...metadata, runtimePin: pin }, outer: { runtimePin: pin } });
    const imported = runImport(f, matching);
    assert.equal(imported.status, 0, imported.stderr || imported.error?.message);
  });
  await t.test('handbook fails digest check and imported staging is removed', t => {
    const f = fixture(t);
    const release = writeRelease(f.root, {
      extra: [{ name: longEntry, text: 'staging must be cleaned' }],
      replace: { 'docs/guides/usage-manual.md': 'unexpected' },
    });
    assertRejected(f, release, /file SHA-256 does not match/);
  });
});

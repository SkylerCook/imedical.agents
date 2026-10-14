'use strict';

// Also loaded from HEAD by the PowerShell bootstrap when this file is sparse-excluded.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function git(root, args, options = {}) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) {
    throw new Error(`git ${args[0]} failed: ${result.error?.message || result.stderr || result.status}`);
  }
  return result.stdout;
}

function assertRegularRuntimeFile(root, file) {
  const parts = file.split('/');
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Linked raw runtime asset: ${file}`);
  }
  if (!fs.statSync(current).isFile()) throw new Error(`Raw runtime asset is not a regular file: ${file}`);
  return current;
}

function validatePatterns(patterns) {
  if (!Array.isArray(patterns) || !patterns.length || patterns.some(p => typeof p !== 'string' || !/^\/[\w/.*-]+$/.test(p))) {
    throw new Error('Expected non-empty positive runtime sparse patterns');
  }
}

function rawBytes(root, entries, repair) {
  if (!entries.length) return { checked: 0, repaired: 0 };
  // --cached uses tracked attributes even if a legacy sparse checkout omits them.
  const values = git(root, ['check-attr', '--cached', '-z', '--stdin', 'text', 'filter', 'working-tree-encoding'],
    { input: entries.map(e => e.file).join('\0') + '\0' }).split('\0');
  const attrs = new Map();
  for (let i = 0; i + 2 < values.length; i += 3) {
    if (!attrs.has(values[i])) attrs.set(values[i], {});
    attrs.get(values[i])[values[i + 1]] = values[i + 2];
  }
  const mismatches = [];
  let checked = 0;
  for (const entry of entries) {
    const a = attrs.get(entry.file) || {};
    if (a.text !== 'unset' || !['unspecified', 'unset'].includes(a.filter) || !['unspecified', 'unset'].includes(a['working-tree-encoding'])) continue;
    if (entry.mode !== '100644' && entry.mode !== '100755') throw new Error(`Unsupported raw runtime asset mode: ${entry.file}`);
    const at = assertRegularRuntimeFile(root, entry.file), actual = fs.readFileSync(at);
    const id = crypto.createHash(entry.oid.length === 64 ? 'sha256' : 'sha1')
      .update(`blob ${actual.length}\0`).update(actual).digest('hex');
    checked++;
    if (id !== entry.oid) mismatches.push({ ...entry, at, actual });
  }
  if (!mismatches.length) return { checked, repaired: 0 };
  if (!repair) throw new Error(`Raw runtime byte mismatch: ${mismatches.slice(0, 10).map(e => e.file).join(', ')}`);
  if (git(root, ['--no-optional-locks', 'status', '--porcelain']).trim()) throw new Error('Cannot repair raw bytes in a dirty capability checkout');
  const head = git(root, ['rev-parse', 'HEAD']).trim();
  // Read all immutable blobs first; refuse the entire plan if any content differs.
  const blobs = git(root, ['cat-file', '--batch'], { encoding: null, input: mismatches.map(e => e.oid).join('\n') + '\n' });
  let offset = 0;
  for (const entry of mismatches) {
    const end = blobs.indexOf(10, offset), header = blobs.subarray(offset, end).toString('ascii');
    const match = /^([a-f0-9]+) blob (\d+)$/.exec(header);
    if (!match || match[1] !== entry.oid) throw new Error(`Cannot read raw runtime blob: ${entry.file}`);
    const size = Number(match[2]); offset = end + 1;
    entry.expected = blobs.subarray(offset, offset + size); offset += size + 1;
    const normalized = Buffer.from(entry.actual.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
    if (entry.actual.includes(0) || entry.expected.includes(0) || !entry.actual.includes(Buffer.from('\r\n')) || !normalized.equals(entry.expected)) {
      throw new Error(`Raw runtime bytes contain custom or unsupported changes; preserved: ${entry.file}`);
    }
  }
  for (const entry of mismatches) {
    const temporary = path.join(path.dirname(entry.at), `.agents-raw-${process.pid}-${crypto.randomBytes(8).toString('hex')}.tmp`);
    try {
      assertRegularRuntimeFile(root, entry.file);
      fs.writeFileSync(temporary, entry.expected, { flag: 'wx', mode: fs.statSync(entry.at).mode & 0o777 });
      if (git(root, ['rev-parse', 'HEAD']).trim() !== head || !fs.readFileSync(entry.at).equals(entry.actual)) {
        throw new Error(`Raw runtime asset changed during repair; preserved: ${entry.file}`);
      }
      fs.renameSync(temporary, entry.at);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  if (git(root, ['rev-parse', 'HEAD']).trim() !== head) throw new Error('HEAD changed during raw asset repair');
  const index = new Map(git(root, ['ls-files', '--stage', '-z']).split('\0').filter(Boolean).map(record => {
    const match = /^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/.exec(record);
    return match ? [match[4], { mode: match[1], oid: match[2], stage: match[3] }] : ['', {}];
  }));
  for (const entry of mismatches) {
    const cached = index.get(entry.file);
    if (!cached || cached.mode !== entry.mode || cached.oid !== entry.oid || cached.stage !== '0' || !fs.readFileSync(entry.at).equals(entry.expected)) {
      throw new Error(`Raw runtime index or bytes changed during repair: ${entry.file}`);
    }
  }
  // -text changes the expected worktree size. Reset stat data using IDENTICAL index
  // entries: no new blob is staged and unrelated index entries are untouched.
  git(root, ['update-index', '-z', '--index-info'], {
    input: mismatches.map(e => `${e.mode} ${e.oid}\t${e.file}\0`).join('')
  });
  return { checked, repaired: mismatches.length };
}

function verify(root, patterns, options = {}) {
  validatePatterns(patterns);
  const specs = patterns.map(pattern => `:(glob)${pattern.replace(/^\//, '')}`);
  const entries = git(root, ['ls-files', '-t', '-z', '--', ...specs]).split('\0').filter(Boolean);
  const missing = entries.filter(entry => entry.startsWith('S ') || !fs.existsSync(path.join(root, entry.slice(2))));
  if (missing.length) throw new Error(`Sparse runtime files not materialized: ${missing.slice(0, 10).map(entry => entry.slice(2)).join(', ')}`);
  // A --no-checkout clone can have an empty index: do not accept vacuous success.
  const matchers = patterns.map(pattern => new RegExp('^' + pattern.slice(1).split('**').map(part => part.split('*').map(text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*') + '$'));
  const tree = git(root, ['ls-tree', '-r', '-z', 'HEAD']).split('\0').filter(Boolean).map(record => {
    const match = /^(\d+) \w+ ([a-f0-9]+)\t([\s\S]+)$/.exec(record);
    if (!match) throw new Error('Invalid runtime tree entry');
    return { mode: match[1], oid: match[2], file: match[3] };
  }).filter(entry => matchers.some(re => re.test(entry.file)));
  const expected = tree.map(entry => entry.file);
  const absent = expected.filter(file => !fs.existsSync(path.join(root, file)));
  if (absent.length) throw new Error(`Sparse HEAD files not materialized: ${absent.slice(0, 10).join(', ')}`);
  const report = rawBytes(root, tree, options.repairRawBytes === true);
  if (report.repaired) rawBytes(root, tree, false);
  return report;
}

function refresh(root, patterns, initial = false) {
  validatePatterns(patterns);
  if (!initial && git(root, ['status', '--porcelain']).trim()) throw new Error('Cannot refresh a dirty capability checkout');
  // Argument input is independent of PowerShell $OutputEncoding and its UTF-8 BOM.
  git(root, ['sparse-checkout', 'init', '--no-cone']);
  git(root, ['sparse-checkout', 'set', '--no-cone', '--', ...patterns]);
  if (initial) git(root, ['checkout']);
  verify(root, patterns, { repairRawBytes: true });
}

module.exports = { refresh, verify };
if (require.main === module || process.argv[1] === '--sparse-bootstrap') {
  try {
    const args = process.argv.slice(3);
    const patterns = args.filter(arg => !['--initial', '--verify', '--repair-raw'].includes(arg));
    if (args.includes('--verify') || args.includes('--repair-raw')) verify(process.argv[2], patterns, { repairRawBytes: args.includes('--repair-raw') });
    else refresh(process.argv[2], patterns, args.includes('--initial'));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

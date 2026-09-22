'use strict';
const fs = require('node:fs');
const path = require('node:path');

function vendorScript(capabilityRoot) {
  const target = path.join(capabilityRoot, 'vendor', 'sftp-server', 'src', 'main.py');
  if (!fs.existsSync(target)) throw new Error('sftp-vendor-missing');
  return target;
}

function buildSftp(config, capabilityRoot) {
  const legacyArgs = Array.isArray(config.args) ? config.args : [config.scriptPath];
  const vendor = config.runtime === 'vendor' || (!config.runtime && (!config.scriptPath && !config.args || legacyArgs.length === 1 && /[\\/]sftp-server[\\/]src[\\/]main\.py$/.test(legacyArgs[0])));
  if (config.runtime && !['vendor', 'custom'].includes(config.runtime)) throw new Error('Unsupported sftp.runtime');
  const args = vendor ? [vendorScript(capabilityRoot)] : Array.isArray(config.args) ? config.args : [config.scriptPath];
  if (!args.length || args.some(a => typeof a !== 'string' || !a || a.startsWith('TODO'))) throw new Error('Missing sftp script path');
  return {
    command: config.command || 'python', args,
    env: {
      TARGET_HOST: config.host, TARGET_PORT: String(config.port || 22), TARGET_USERNAME: config.username,
      TARGET_PASSWORD: config.password || '', LOCAL_PATH: config.localPath, REMOTE_PATH: config.remotePath,
      IGNORE_PATTERNS: JSON.stringify(config.ignorePatterns || ['*.log', 'node_modules/', '.git/', '.vscode/']),
      ...(config.keyFile ? {TARGET_KEY_FILE: config.keyFile} : {}),
      ...(config.knownHosts ? {TARGET_KNOWN_HOSTS: config.knownHosts} : {}),
      ...(vendor ? {ALLOW_REMOTE_COMMANDS: String(config.allowRemoteCommands === true)} : {})
    }, disabled: false
  };
}

// Refresh recognized existing SFTP launchers during every update; preserve connection fields.
function migrate(projectRoot, contextRoot, capabilityRoot, mode = 'DryRun') {
  const target = '.mcp.json';
  const result = (status, reason) => [{status: `config-migration-${status}`, target, reason}];
  const configPath = path.join(contextRoot, 'config', 'project-env.json');
  const mcpPath = path.join(projectRoot, target);
  const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')) : {};
  if (config.sftp?.runtime === 'custom') return result('unchanged', 'Explicit custom runtime retained');
  if (!fs.existsSync(mcpPath)) return result('unchanged', 'No MCP configuration; no SFTP service created');
  const original = fs.readFileSync(mcpPath);
  const document = JSON.parse(original.toString('utf8').replace(/^\uFEFF/, ''));
  const name = config.sftp?.serverName || 'sftp-server';
  const entry = document.mcpServers?.[name];
  if (!entry) return result('unchanged', 'No existing SFTP service; nothing created');
  if (!Array.isArray(entry.args) || entry.args.length !== 1 || !/[\\/]sftp-server[\\/]src[\\/]main\.py$/.test(entry.args[0])) {
    return result('review-required', 'Missing or customized SFTP launch arguments; no automatic replacement');
  }
  const script = vendorScript(capabilityRoot);
  if (entry.args[0] === script) return result('unchanged', 'SFTP already uses vendor runtime');
  entry.args[0] = script; // Preserve command, credentials, disabled state, env, all other MCP servers.
  if (mode === 'DryRun') return result('planned', 'Refresh recognized SFTP script argument to bundled vendor');
  if (mode !== 'Write') throw new Error('Invalid migration mode');
  if (!original.equals(fs.readFileSync(mcpPath))) throw new Error('MCP configuration changed during migration');
  const temporary = mcpPath + `.sftp-${require('node:crypto').randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(document, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    if (!original.equals(fs.readFileSync(mcpPath))) throw new Error('MCP configuration changed before replacement');
    fs.renameSync(temporary, mcpPath);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return result('applied', 'SFTP script argument migrated; interpreter and connection fields preserved');
}

module.exports = {buildSftp, migrate};
if (require.main === module) {
  try {
    const [projectRoot, contextRoot, mode] = process.argv.slice(2);
    const {resolveWorkspaceContext, validateWorkspaceContext} = require('../../../../scripts/lib/workspace-context');
    const resolved = resolveWorkspaceContext(projectRoot);
    const issues = validateWorkspaceContext(resolved).filter(item => ['manifest-invalid', 'schema-version-unsupported'].includes(item.status));
    if (issues.length) throw new Error('Invalid workspace context');
    console.log(JSON.stringify(migrate(projectRoot, path.resolve(projectRoot, contextRoot), resolved.capabilityRoot, mode)));
  } catch (error) {
    console.log(JSON.stringify([{status: 'config-migration-failed', target: '.mcp.json', reason: 'Invalid configuration or unavailable vendor runtime; no credentials logged'}]));
    process.exitCode = 1;
  }
}

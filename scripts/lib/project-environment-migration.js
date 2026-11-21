'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {isDeepStrictEqual} = require('node:util');
const io = require('./configuration-file-io');
const store = require('./project-configuration');
const migration = require('./project-configuration-migration');
const environment = require('./project-environment');
const data = require('./project-environment-data');
const selection = require('./iris-selected-target');

function ready(value) {
  return typeof value === 'string' && !!value.trim() && !value.startsWith('TODO');
}

function named(value) {
  return typeof value === 'string' && /^[\w.-]+$/.test(value) && !['__proto__','prototype','constructor'].includes(value);
}

function validatedValue(section,key,value) {
  const flags = new Set(['enabled','tlsVerify','allowRemoteCommands','includeBuiltInSkills']);
  const privateText = /:\/\/[^/\s]*@|(?:[?&]|--)\s*(?:password|secret|token|api[_-]?key)(?:[=\s]|$)/i;
  const text = value => typeof value === 'string' && !/[\x00\r\n]/.test(value) && !privateText.test(value);
  if (flags.has(key)) {
    if (section === 'iris' && ['true','false'].includes(String(value).toLowerCase())) return value;
    if (typeof value === 'boolean') return value;
  } else if (key === 'port') {
    if (Number.isInteger(value) || typeof value === 'string' && /^\d+$/.test(value)) return value;
  } else if (key === 'args' || key === 'ignorePatterns') {
    if (Array.isArray(value) && value.every(text)) return value;
  } else if (text(value) || (key === 'nodeTlsRejectUnauthorized' && value === 0)) return value;
  throw Error('unrecognized-or-private-project-env-value: ' + section + '.' + key);
}

function addCredential(credentials, id, pair) {
  if (!Object.keys(pair).length) return;
  if (Object.hasOwn(credentials,id) && !isDeepStrictEqual(credentials[id],pair)) {
    throw Error('project-config-conflict: private connection reference');
  }
  credentials[id] = pair;
}

function split(legacy, credentials) {
  const result = {};
  for (const [section,row] of Object.entries(legacy)) {
    if (section === 'irisProfileCredentials') {
      for (const [id,pair] of Object.entries(row || {})) {
        if (!/^[\w-]+$/.test(id) || !named(id) || !pair ||
            Object.keys(pair).some(key=>!data.privateKeys.iris.includes(key) || typeof pair[key] !== 'string')) {
          throw Error('unrecognized-private-profile');
        }
        addCredential(credentials,id,pair);
      }
      continue;
    }
    if (!Object.hasOwn(data.sections,section) || !row || typeof row !== 'object' || Array.isArray(row)) {
      throw Error('project-env-unrecognized-section');
    }
    const pub = {}, secrets = {};
    for (const [key,value] of Object.entries(row)) {
      if (data.sections[section].includes(key)) pub[key] = validatedValue(section,key,value);
      else if (data.privateKeys[section]?.includes(key) && typeof value === 'string') secrets[key] = value;
      else throw Error('project-env-unrecognized-field: ' + section);
    }
    result[section] = {pub,secrets};
  }
  return result;
}

function profileFor(context, main, sections, credentials) {
  const iris = sections.iris;
  if (!iris) return null;
  const safe = require('./project-directories').safePath;
  const settingsFile = safe(context.workspaceRoot,'.vscode/settings.json');
  const settings = io.parse(store.fileText(settingsFile) ?? '{}');
  const conn = settings['objectscript.conn'];
  const serverName = sections.mcp?.pub.serverName || main.irisConnections?.serverName || 'iris-agentic-dev';
  if (!named(serverName)) throw Error('invalid-iris-mcp-name');
  const mcp = environment.json(safe(context.workspaceRoot,'.mcp.json'));
  const server = mcp?.mcpServers?.[serverName];
  if (conn?.server && !Object.hasOwn(settings['intersystems.servers'] || {},conn.server)) throw Error('project-config-conflict: VS Code binding');
  const bindings = {central:true,vscode:!!conn?.server,mcp:!!server,
    toml:store.fileText(safe(context.workspaceRoot,'.iris-agentic-dev.toml')) !== null};
  const state = main.irisConnections || {active:'current',serverName,bindings,profiles:{}};
  const id = state.active, before = state.profiles?.[id];
  if (!named(id) || !/^[\w-]+$/.test(id) || !state.profiles || state.serverName !== serverName ||
      (main.irisConnections && (!before || !isDeepStrictEqual(state.bindings,bindings)))) throw Error('project-config-conflict: IRIS bindings');
  const profile = {...iris.pub,...before,alias:before?.alias || iris.pub.alias || conn?.server || 'project',
    port:Number(iris.pub.port),tlsVerify:String(iris.pub.tlsVerify ?? false).toLowerCase() === 'true'};
  if (!ready(profile.host) || !ready(profile.namespace) || !['http','https'].includes(profile.scheme) ||
      !Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65535 ||
      !['true','false'].includes(String(iris.pub.tlsVerify ?? false).toLowerCase())) throw Error('project-env-target-incomplete');
  const ref = before?.credentialRef || 'private:' + id;
  const key = /^private:([\w-]+)$/.exec(ref)?.[1];
  if (!named(key)) throw Error('project-env-credential-reference');
  addCredential(credentials,key,iris.secrets);
  return {...state,source:'project.jsonc',profiles:{...state.profiles,[id]:{...profile,credentialRef:ref}}};
}

function prepare(context, main, legacy, credentials) {
  const next = structuredClone(main);
  const parts = split(legacy,credentials);
  const connection = profileFor(context,main,parts,credentials);
  if (connection) next.irisConnections = connection;
  if (parts.mcp) next.mcp = parts.mcp.pub;
  for (const section of ['web','sftp']) {
    if (!parts[section]) continue;
    const key = '$' + section;
    addCredential(credentials,key,parts[section].secrets);
    next.serviceConnections ||= {};
    next.serviceConnections[section] = {...parts[section].pub,
      ...(Object.hasOwn(credentials,key) ? {credentialRef:'private:'+key} : {})};
  }
  if (!data.canonical(next)) throw Error('project-env-no-managed-fields');
  const result = data.read(next,legacy,credentials);
  if (connection) selection.selected(context,{requireBindings:true,project:next,environmentConfig:result});
  return next;
}

function migrate(context, mode) {
  const main = store.document(context.contextRoot);
  const name = 'project-env.json';
  const file = store.filePath(context.contextRoot,name);
  const legacy = environment.json(file);
  if (!legacy) return null;
  const previous = store.fileText(file);
  io.parse(previous);
  const privateFile = store.filePath(context.contextRoot,data.credentialFile);
  const privateBefore = store.fileText(privateFile);
  const credentials = environment.json(privateFile) || {};
  const next = data.canonical(main.value) ? main.value : prepare(context,main.value,legacy,credentials);
  data.read(next,legacy,credentials);
  const archive = store.filePath(context.contextRoot,'.migrations/'+name);
  for (const target of [main.file,file,privateFile,archive]) migration.privatePath(context,target);
  if (store.fileText(archive) !== null) throw Error('project-config-legacy-returned: ' + name);
  if (mode === 'Write') {
    // Write references last. A re-run can verify the same credential before retiring
    // the original file if the process exits between these operations.
    if (Object.keys(credentials).length && !isDeepStrictEqual(credentials,environment.json(privateFile))) {
      store.replace(privateFile,privateBefore,JSON.stringify(credentials,null,2)+'\n');
    }
    const edits = store.delta([],main.value,next);
    store.replace(main.file,main.text,store.edited(main,edits));
    const observed = environment.local(context.contextRoot);
    if (!observed.canonical) throw Error('project-environment-readback-failed');
    if (observed.config.iris) selection.selected(context,{requireBindings:true});
    migration.retire(context,file,previous,name);
  }
  return {id:'connections',source:name,status:mode === 'Write' ? 'applied' : 'planned'};
}

module.exports = {migrate};

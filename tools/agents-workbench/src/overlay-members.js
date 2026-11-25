'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { loadState, sameContextRoot } = require('../../../scripts/lib/plugin-deployment');
const pluginProfile = require('../../../scripts/lib/project-plugin-profile');
const { resolveWorkspaceContext, workspaceContextBlockers } = require('../../../scripts/lib/workspace-context');
const { inspectFramework } = require('./project-context');

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const localPath = value => typeof value === 'string' && path.isAbsolute(value) && !/^[\\/]{2}/.test(value);
const memberId = contextRoot => digest(process.platform === 'win32' ? path.resolve(contextRoot).toLowerCase() : path.resolve(contextRoot));
const identityBlockers = new Set(['manifest-invalid','schema-version-unsupported','capability-root-missing','capability-git-missing']);
const sourceBlockers = new Set(['source-directory-invalid','source-path-missing','source-path-not-junction','source-root-missing','git-root-missing']);

function directoryIdentity(directory) {
  if (!localPath(directory)) throw Error('overlay-path-not-local');
  const info = fs.lstatSync(directory,{bigint:true});
  if (!info.isDirectory()) throw Error('overlay-path-not-physical');
  return [fs.realpathSync.native(directory),String(info.dev),String(info.ino)];
}

function readManifest(file) {
  const stat = fs.lstatSync(file,{throwIfNoEntry:false});
  if (!stat?.isFile() || stat.nlink !== 1) throw Error('overlay-manifest-missing');
  const text = new TextDecoder('utf-8',{fatal:true}).decode(fs.readFileSync(file));
  return {text,data:JSON.parse(text)};
}

function inverseDeclaredWorkspace(contextRoot, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || /:/.test(relative))
    throw Error('overlay-context-not-relative');
  const segments = relative.split(/[\\/]/);
  if (segments.some(part => !part || part === '.' || part === '..')) throw Error('overlay-context-not-relative');
  const workspaceRoot = segments.reduce(cursor => path.dirname(cursor),contextRoot);
  if (!sameContextRoot(path.join(workspaceRoot,...segments),contextRoot)) throw Error('overlay-declaration-mismatch');
  return workspaceRoot;
}

function inspectRoot(workspaceRoot) {
  if (!localPath(workspaceRoot)) throw Error('overlay-standard-root-required');
  const standard = inspectFramework(workspaceRoot);
  if (standard.status !== 'standard') throw Error('overlay-standard-root-required');
  const capabilityRoot = path.join(workspaceRoot,'.agents');
  const gitRoot = path.join(capabilityRoot,'.git');
  const binding = digest([workspaceRoot,capabilityRoot,gitRoot].map(directoryIdentity));
  return {workspaceRoot,capabilityRoot,gitRoot,binding,revision:standard.revision};
}

function usesStandardConnection(context) {
  const fallback = context.mode === 'workspace-overlay' && context.manifest?.projectEnvFallback;
  return typeof fallback === 'string' && !!fallback.trim() && sameContextRoot(
    path.resolve(context.workspaceRoot, fallback), path.join(context.capabilityRoot, 'config', 'project-env.json'));
}

function inspectMember(record, root, connectionScope = false) {
  const {contextRoot,lastRequired} = record;
  const id = memberId(contextRoot);
  const label = localPath(record.workspaceRoot) ? path.basename(record.workspaceRoot)
    : path.basename(contextRoot) === '.agents' ? path.basename(path.dirname(contextRoot)) : path.basename(contextRoot);
  const result = {id,label,lastRequired:[...lastRequired]};
  try {
    if (!localPath(contextRoot)) return {...result,status:'needs-verification'};
    const info = fs.lstatSync(contextRoot,{throwIfNoEntry:false});
    if (!info) return {...result,status:'offline'};
    const physicalContext = directoryIdentity(contextRoot);
    const localManifest = record.workspaceRoot === undefined && readManifest(path.join(contextRoot,'capability.json'));
    const workspaceRoot = record.workspaceRoot ?? inverseDeclaredWorkspace(contextRoot,localManifest.data.contextRoot);
    const physicalWorkspace = directoryIdentity(workspaceRoot);
    const declarationDirectory = path.join(workspaceRoot,'.agents');
    const [physicalDeclaration] = directoryIdentity(declarationDirectory);
    if (!sameContextRoot(physicalDeclaration,path.join(physicalWorkspace[0],'.agents'))) return {...result,status:'needs-verification'};
    const manifest = readManifest(path.join(declarationDirectory,'capability.json'));
    if (localManifest && localManifest.text !== manifest.text) return {...result,status:'needs-verification'};
    if (connectionScope && manifest.data.mode === 'workspace-overlay') {
      const declared = manifest.data.projectEnvFallback;
      if (declared === undefined || declared === false) result.connectionScope = 'other';
      else if (typeof declared === 'string' && declared.trim()) {
        result.connectionScope = sameContextRoot(path.resolve(workspaceRoot, declared),
          path.join(root.capabilityRoot,'config','project-env.json')) ? 'linked' : 'other';
      }
    }
    const context = resolveWorkspaceContext(workspaceRoot);
    const blockers = workspaceContextBlockers(context);
    const expectedContext = path.join(physicalWorkspace[0],path.relative(workspaceRoot,context.contextRoot));
    if (context.mode !== 'workspace-overlay' || blockers.some(item=>identityBlockers.has(item.status)) ||
        !sameContextRoot(physicalContext[0],expectedContext) ||
        !sameContextRoot(directoryIdentity(context.contextRoot)[0],physicalContext[0]) ||
        !sameContextRoot(directoryIdentity(context.capabilityRoot)[0],directoryIdentity(root.capabilityRoot)[0])) {
      return {...result,status:'needs-verification'};
    }
    if (lastRequired.length && !pluginProfile.read(contextRoot).exists) return {...result,status:'offline'};
    const verified = {...result,label:context.workspaceName || path.basename(workspaceRoot),workspaceRoot,
      contextRoot,identity:digest([physicalWorkspace,physicalContext,manifest.text])};
    if (blockers.length) {
      const issue = blockers.some(item=>sourceBlockers.has(item.status)) ? 'member-sources-unready' : 'member-layout-unready';
      return {...verified,status:'owner-blocked',issue};
    }
    return {...verified,status:'ready'};
  } catch { return {...result,status:'needs-verification'}; }
}

function memberRecords(root) {
  const registry = path.join(root.gitRoot,'plugin-deployment.json');
  const stat = fs.lstatSync(registry,{throwIfNoEntry:false});
  if (stat && (!stat.isFile() || stat.nlink !== 1)) throw Error('overlay-registry-unsafe');
  return loadState(root.capabilityRoot,registry).members.filter(record => !sameContextRoot(record.contextRoot,root.capabilityRoot));
}

function inspectMembers(root, records, connectionScope = false) {
  const members = records.map(record => inspectMember(record,root,connectionScope));
  const identities = new Map();
  for (const member of members) {
    for (const key of [member.id,member.identity].filter(Boolean)) {
      const duplicate = identities.get(key);
      if (duplicate) member.status = duplicate.status = 'needs-verification';
      else identities.set(key,member);
    }
  }
  return members;
}

function planOverlayUpdate(workspaceRoot) {
  const root = inspectRoot(workspaceRoot);
  return {root,members:inspectMembers(root,memberRecords(root))};
}

function inspectConnectionRoster(workspaceRoot) {
  const candidate = path.join(workspaceRoot,'.agents','.git','plugin-deployment.json');
  if (!fs.lstatSync(candidate,{throwIfNoEntry:false})) return null;
  const root = inspectRoot(workspaceRoot);
  const records = memberRecords(root);
  const members = inspectMembers(root,records,true);
  const linked = members.filter(member => member.connectionScope === 'linked');
  const unavailable = members.filter(member => !member.connectionScope ||
    (member.connectionScope === 'linked' && member.status !== 'ready'));
  return {root,linked,unavailable,fingerprint:digest([root.binding,root.revision,records,members])};
}

function inspectOverlayLink(workspaceRoot) {
  const context = resolveWorkspaceContext(workspaceRoot);
  if (context.mode !== 'workspace-overlay') return null;
  const [capabilityRoot] = directoryIdentity(context.capabilityRoot);
  const root = inspectRoot(path.dirname(capabilityRoot));
  if (!sameContextRoot(directoryIdentity(root.capabilityRoot)[0],capabilityRoot)) return null;
  const member = inspectMember({workspaceRoot,contextRoot:context.contextRoot,lastRequired:[]},root);
  return canOpenMember(member) ? {root,member,id:digest([root.binding,root.revision,member.identity])} : null;
}

function canOpenMember(member) {
  return ['ready','owner-blocked'].includes(member?.status);
}

function inspectRegisteredMember(root, id) {
  const candidates = memberRecords(root).filter(record => memberId(record.contextRoot) === id);
  if (candidates.length === 1) return inspectMember(candidates[0],root);
}

module.exports = { directoryIdentity, planOverlayUpdate, inspectRoot, inspectRegisteredMember, inspectOverlayLink, canOpenMember,
  inspectConnectionRoster, usesStandardConnection };

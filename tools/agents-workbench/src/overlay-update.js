'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { inspectRoot, inspectRegisteredMember, inspectOverlayLink } = require('./overlay-members');
const { runOwnerPowerShell } = require('./owner-powershell');

const modes = ['DryRun','Write','Check'];
const ownerDiagnostics = ['runtime-assets-invalid','source-directory-invalid','source-path-missing',
  'shared-path-not-junction','junction-target-mismatch','manifest-invalid','config-migration-conflict','thin-index-conflict'];

function readBackRoot(expected) {
  try {
    const current = inspectRoot(expected.workspaceRoot);
    return current.binding === expected.binding && current.revision === expected.revision ? current : null;
  } catch { return null; }
}

function readBackMember(root, member) {
  try {
    const current = inspectRegisteredMember(root,member.id);
    return current?.status === 'ready' && current.identity === member.identity ? current : null;
  } catch { return null; }
}

function refreshMember(root, member, owner, token, readTarget = () => readBackMember(root,member)) {
  const result = {id:member.id,label:member.label,status:'complete',steps:[]};
  for (const mode of modes) {
    if (!readBackRoot(root)) return {...result,status:'blocked',error:'overlay-root-changed'};
    const current = readTarget();
    if (!current) return {...result,status:'blocked',error:'overlay-member-changed'};
    let step;
    try { step = owner(root,current,mode,token); }
    catch { return {...result,status:'failed',error:'overlay-member-owner-failed'}; }
    const noPull = step?.noPull === true;
    result.steps.push({mode,exitCode:step?.exitCode ?? null,noPull,...(step?.diagnostic ? {diagnostic:step.diagnostic} : {})});
    if (step?.exitCode !== 0 || !noPull) return {...result,status:'failed',error:'overlay-member-owner-failed'};
    if (!readBackRoot(root)) return {...result,status:'blocked',error:'overlay-root-changed'};
  }
  return result;
}

function refreshBoundOverlay(link,runMember,token) {
  function readTarget() {
    try {
      const actual = inspectOverlayLink(link.member.workspaceRoot);
      return actual?.id === link.id && actual.member.status === 'ready' ? actual.member : null;
    } catch { return null; }
  }
  return refreshMember(link.root,link.member,runMember,token,readTarget);
}

// Callers keep the plan server-side and authorize its opaque member IDs.
// updateRoot reuses the normal standard-root action. withMemberLease verifies the
// new execution tree and holds the existing CapabilityRoot deployment lock.
function applyOverlayUpdate(plan, selectedIds, {updateRoot,withMemberLease,runMember}) {
  if (!Array.isArray(selectedIds) || !selectedIds.length || new Set(selectedIds).size !== selectedIds.length)
    throw Error('overlay-selection-required');
  const available = new Map(plan.members.filter(member => member.status === 'ready').map(member => [member.id,member]));
  const selected = selectedIds.map(id => {
    const member = available.get(id);
    if (!member) throw Error('overlay-selection-unverified');
    return member;
  });
  const before = readBackRoot(plan.root);
  if (!before) return {status:'blocked',error:'overlay-root-changed',members:[]};
  const members = new Map();
  for (const member of selected) {
    if (!readBackMember(before,member)) members.set(member.id,{id:member.id,label:member.label,status:'blocked',error:'overlay-member-changed',steps:[]});
  }
  if (members.size === selected.length) return {status:'blocked',error:'overlay-selection-changed',members:[...members.values()]};

  let root = before, rootStatus = 'current';
  if (updateRoot) {
    let outcome;
    try { outcome = updateRoot(before); }
    catch { return {status:'blocked',error:'overlay-root-update-failed',members:[...members.values()]}; }
    if (outcome?.exitCode !== 0 || outcome.error || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(outcome.after?.revision ?? ''))
      return {status:'blocked',error:'overlay-root-update-failed',members:[...members.values()]};
    root = readBackRoot({...before,revision:outcome.after.revision});
    if (!root) return {status:'blocked',error:'overlay-root-changed',members:[...members.values()]};
    rootStatus = 'updated';
  }

  let leased = false;
  try {
    withMemberLease(root,token => {
      if (!token) throw Error('overlay-member-lease-required');
      leased = true;
      for (const member of selected) {
        if (!members.has(member.id)) members.set(member.id,refreshMember(root,member,runMember,token));
      }
    });
  } catch { leased = false; }
  if (!leased) return {status:'partial',error:'overlay-member-lease-failed',rootStatus,revision:root.revision,members:[...members.values()]};

  const results = selected.map(member => members.get(member.id)).filter(Boolean);
  return {status:results.length === selected.length && results.every(result => result.status === 'complete') ? 'complete' : 'partial',
    rootStatus,revision:root.revision,members:results};
}

function runCanonicalMember(root, member, mode, token, tools) {
  const scripts = path.join(root.capabilityRoot,'scripts');
  const entry = path.join(scripts,'update-agents.ps1');
  if (!modes.includes(mode) || !token || !path.isAbsolute(tools.ps) ||
      !fs.lstatSync(scripts,{throwIfNoEntry:false})?.isDirectory() || !fs.lstatSync(entry,{throwIfNoEntry:false})?.isFile())
    throw Error('overlay-member-owner-unavailable');
  const result = runOwnerPowerShell(tools.ps,entry,{ProjectRoot:member.workspaceRoot,Mode:mode,NoPull:true,Detailed:true},{
    cwd:member.workspaceRoot,env:{...tools.env,IMEDICAL_DEPLOYMENT_LOCK:token,GIT_ALLOW_PROTOCOL:'',GIT_NO_LAZY_FETCH:'1'},
    timeout:120000,
  });
  const statuses = new Set([...String(result.stdout ?? '').matchAll(/^\s*status\s*:\s*([\w-]+)\s*$/gmi)].map(match=>match[1]));
  const diagnostic = result.status === 0 ? undefined : ownerDiagnostics.find(code=>statuses.has(code));
  return {exitCode:result.status,noPull:statuses.has('capability-pull-skipped-overlay'),diagnostic};
}

module.exports = { applyOverlayUpdate, refreshBoundOverlay, runCanonicalMember };

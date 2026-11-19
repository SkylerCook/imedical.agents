'use strict';

const { fork } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const { inspectRoot, inspectRegisteredMember, inspectOverlayLink, canOpenMember } = require('./overlay-members');
const { readStartupAddress, probeProject } = require('./release-launcher');

const launcher = path.join(__dirname,'start-release.js');

function resolveOverlayTarget(root,plan,link,{overlayPlanId,memberId}) {
  if (!memberId) {
    if (link?.id !== overlayPlanId) return null;
    const current = inspectOverlayLink(root);
    if (current?.id !== overlayPlanId) return null;
    return {workspaceRoot:current.root.workspaceRoot, status:'standard', revision:current.root.revision, binding:current.root.binding};
  }
  if (plan?.id !== overlayPlanId) return null;
  const member = plan.members.find(value=>value.id === memberId);
  if (!canOpenMember(member)) return null;
  const current = inspectRoot(root);
  if (current.binding !== plan.root.binding || current.revision !== plan.root.revision) return null;
  const found = inspectRegisteredMember(current,memberId);
  if (!canOpenMember(found) || found.identity !== member.identity) return null;
  return {workspaceRoot:found.workspaceRoot, status:'overlay-declared', revision:null, binding:found.identity};
}

function createOverlayOpener() {
  const launches = new Map();
  async function launch(target,entry,clear,stillCurrent) {
    const timeout = AbortSignal.timeout(15000);
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
      !/^(port|node_options|node_path|node_channel_fd|node_channel_serialization_mode|workbench_startup_parent)$/iu.test(name)));
    let child;
    try {
      child = fork(launcher,['--project',target.workspaceRoot],{cwd:path.resolve(__dirname,'../../..'),execArgv:[],
        env:{...env,PORT:'0',WORKBENCH_STARTUP_PARENT:'1'},windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
      entry.child = child;
      child.once('exit',clear);
      child.once('error',clear);
      const stopped = once(child,'exit',{signal:timeout}).then(()=>{ throw Error('overlay-startup-failed'); });
      const ready = async () => {
        const [message] = await once(child,'message',{signal:timeout});
        const origin = readStartupAddress(message);
        const state = await probeProject(origin,{name:path.basename(target.workspaceRoot),hasFramework:true,status:target.status,
          revision:target.revision,binding:target.status === 'standard' ? target.binding : undefined},timeout);
        // Older module windows omit binding. Their owned launcher still uses the exact verified path.
        if ((state.binding && state.binding !== target.binding) || !stillCurrent()) throw Error('overlay-target-changed');
        return `${origin}/#bootstrap=${message.bootstrap}`;
      };
      const address = await Promise.race([ready(),stopped]);
      child.unref();
      child.channel?.unref();
      return address;
    } catch (error) {
      if (child?.pid && child.exitCode === null && child.signalCode === null) {
        const stopped = once(child,'exit',{signal:AbortSignal.timeout(3000)});
        child.kill();
        await stopped.catch(()=>{});
      }
      if (error.message === 'overlay-target-changed') throw error;
      throw Error(timeout.aborted ? 'overlay-startup-timeout' : 'overlay-startup-failed');
    }
  }
  async function open(target,stillCurrent) {
    const key = JSON.stringify([target.workspaceRoot,target.binding]);
    let entry = launches.get(key);
    if (!entry) {
      entry = {};
      const clear = () => { if (launches.get(key) === entry) launches.delete(key); };
      launches.set(key,entry);
      entry.pending = launch(target,entry,clear,stillCurrent);
    }
    try {
      const address = await entry.pending;
      if (!stillCurrent()) throw Error('overlay-target-changed');
      return {address};
    } catch (error) {
      if (launches.get(key) === entry) launches.delete(key);
      throw error;
    }
  }
  return {open};
}

module.exports = { resolveOverlayTarget, createOverlayOpener };

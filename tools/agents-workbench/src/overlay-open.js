'use strict';

const path = require('node:path');
const { inspectRoot, inspectRegisteredMember, inspectOverlayLink, canOpenMember } = require('./overlay-members');
const { launchProjectWindow } = require('./release-launcher');

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

async function openOverlayProject(target, stillCurrent, signal) {
  try {
    const address = await launchProjectWindow(target.workspaceRoot, {
      name:path.basename(target.workspaceRoot), hasFramework:true, status:target.status, revision:target.revision,
      binding:target.status === 'standard' ? target.binding : undefined,
    }, { signal, stillCurrent:state => (!state.binding || state.binding === target.binding) && stillCurrent() });
    return {address};
  } catch (error) {
    if (error.message === 'project-target-changed') throw Error('overlay-target-changed');
    throw Error(error.message === 'project-startup-timeout' ? 'overlay-startup-timeout' : 'overlay-startup-failed');
  }
}

module.exports = { resolveOverlayTarget, openOverlayProject };

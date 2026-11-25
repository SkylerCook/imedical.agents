'use strict';

const path = require('node:path');
const {createHash} = require('node:crypto');
const owner = require('../../ai-dev-offline/configure-project');
const operation = require('../../ai-dev-offline/operation-runtime');
const {inspectConnectionRoster,inspectRoot,inspectRegisteredMember,inspectOverlayLink} = require('./overlay-members');

const connectionFields = ['host','port','scheme','namespace','alias','description','tlsVerify'];
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const names = values => values.slice(0,5).join('、') + (values.length > 5 ? `等 ${values.length} 个工作区` : '');
const settingsError = message => Object.assign(new Error(message), {name:'SettingsError'});

function connectionRoster(root) {
  try { return inspectConnectionRoster(root); }
  catch { throw settingsError('共享工作区登记无法核对，请先检查主工程的成员登记。'); }
}

function planRootConnectionSwitch(request, runtime) {
  const root = owner.plan(request,runtime);
  const roster = connectionRoster(request.projectRoot);
  if (roster?.unavailable.length) {
    throw settingsError(`无法确认 ${names(roster.unavailable.map(member=>member.label))} 的连接批量范围或就绪状态，配置未写入。`);
  }
  const source = root.profile.connection;
  const connection = Object.fromEntries(connectionFields.map(key=>[key,source[key]]));
  const credentials = {username:source.username,password:source.password};
  const members = (roster?.linked || []).map(member=>{
    const req = {projectRoot:member.workspaceRoot,profile:{id:root.profile.id,connection,credentials}};
    let plan;
    try { plan = owner.plan(req,{...runtime,overlayMode:'batch'}); }
    catch { throw settingsError(`${member.label} 的连接无法预演，请在该模块核对 IRIS 绑定。配置未写入。`); }
    return {member,request:{...req,fingerprint:plan.fingerprint},plan};
  });
  const fingerprint = digest([roster?.fingerprint,root.fingerprint,root.profile.id,connection,credentials,
    members.map(item=>item.plan.fingerprint)]);
  return {root,roster,members,fingerprint};
}

function withConnectionLock(capabilityRoot, callback) {
  return operation.withLock(capabilityRoot,{},callback);
}

async function applyRootConnectionSwitch(request, expected, runtime) {
  const plan = planRootConnectionSwitch(request,runtime);
  if (expected !== plan.fingerprint) throw settingsError('开发库配置或成员清单已变化，请重新预览。');
  const rootRequest = {...request,fingerprint:plan.root.fingerprint};
  if (!plan.members.length) return owner.apply(rootRequest,runtime);

  const finished = [];
  let label = '主工程';
  const verifyRoot = () => {
    const live = inspectRoot(request.projectRoot);
    if (live.binding !== plan.roster.root.binding || live.revision !== plan.roster.root.revision)
      throw settingsError('主工程的共享能力根发生变化，请重新预览。');
    return live;
  };
  try {
    for (const item of plan.members) {
      label = item.member.label;
      const member = inspectRegisteredMember(verifyRoot(),item.member.id);
      if (member?.status !== 'ready' || member.identity !== item.member.identity)
        throw settingsError('成员声明或目录发生变化，请重新预览。');
      const outcome = await owner.apply(item.request,{...runtime,overlayMode:'batch'});
      if (outcome.receiptFile) finished.push({member,projectRoot:item.request.projectRoot,receiptFile:outcome.receiptFile});
    }
    label = '主工程';
    if (connectionRoster(request.projectRoot)?.fingerprint !== plan.roster.fingerprint)
      throw settingsError('工作区登记发生变化，请重新预览。');
    const root = await owner.apply(rootRequest,runtime);
    if (root.receiptFile) finished.push({projectRoot:request.projectRoot,receiptFile:root.receiptFile});
    if (connectionRoster(request.projectRoot)?.fingerprint !== plan.roster.fingerprint)
      throw settingsError('工作区登记发生变化，请重新预览。');
  } catch {
    const unresolved = [];
    for (const target of finished.reverse()) {
      try {
        if (target.member) {
          const current = inspectOverlayLink(target.projectRoot);
          if (current?.member.identity !== target.member.identity || current.root.binding !== plan.roster.root.binding)
            throw settingsError('成员目录已变化。');
        } else if (inspectRoot(target.projectRoot).binding !== plan.roster.root.binding) {
          throw settingsError('主工程目录已变化。');
        }
        await owner.rollback({projectRoot:target.projectRoot,receiptFile:target.receiptFile});
      } catch { unresolved.push(target.member?.label || '主工程'); }
    }
    const restoration = unresolved.length ? `请到 ${names(unresolved)} 的「任务与恢复」核对配置回执。`
      : '本批已完成的写入已撤销。';
    throw settingsError(`批量切换在 ${label} 处未完成。${restoration}请在该工作区的「任务与恢复」核对配置回执后重新预览。`);
  }
  return {memberCount:plan.members.length};
}

module.exports = {connectionRoster,planRootConnectionSwitch,applyRootConnectionSwitch,withConnectionLock};

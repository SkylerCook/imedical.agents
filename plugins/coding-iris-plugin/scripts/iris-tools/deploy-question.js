'use strict';

// Presentation metadata only. No UI tool, natural-language parser, or authorization inference.
const CHOICES = Object.freeze({
  pause: {label: '暂停协调', description: '保持停止，先与相关人员协调。'},
  inspect: {label: '查看差异', description: '只读查看文件和服务器状态，不授权上传。'},
  merge: {label: '重新合并', description: '仅为当前快照重新尝试合并，冲突仍会停止。'},
  overwrite: {label: '覆盖当前文件', description: '用本地内容替换当前服务器文件，会丢弃该文件的服务器差异。'},
  resume: {label: '核实后恢复', description: '核实上次部署结果后重新检查；不自动解决冲突。'}
});

function actions(reason, details) {
  const codes = ['pause', 'inspect'];
  if (!/^[a-f0-9]{64}$/.test(details.token || '')) return codes;
  if (reason === 'previous-result-unknown') return [...codes, 'resume'];
  if (reason === 'remote-overwritten-again') return [...codes, 'merge', 'overwrite'];
  if (['merge-conflict', 'new-file-collision', 'remote-deleted'].includes(reason)) return [...codes, 'overwrite'];
  return codes; // Encoding, Storage, Git and transport issues require diagnosis first.
}

function needsInput(reason, details = {}, extra = {}) {
  const codes = actions(reason, details);
  return {
    ...extra, status: 'needs-user-input', reason,
    details: {...details, options: codes},
    question: {
      schema: 'iris-deploy-question/v1',
      reason,
      token: details.token || null,
      recommendedAction: 'pause',
      requiresExplicitResponse: true,
      choices: codes.map(code => ({code, ...CHOICES[code]}))
    }
  };
}

// Existing {action, token} receipts remain supported. Labels, positions and "yes" are not codes.
function decisionError(decision) {
  if (decision === undefined || decision === null) return null;
  if (typeof decision !== 'object' || Array.isArray(decision) ||
      typeof decision.action !== 'string' || !Object.hasOwn(CHOICES, decision.action) ||
      (decision.schema !== undefined && decision.schema !== 'iris-deploy-decision/v1')) {
    return 'invalid-decision';
  }
  if (['pause', 'inspect'].includes(decision.action)) return 'decision-' + decision.action;
  if (typeof decision.token !== 'string' || !/^[a-f0-9]{64}$/.test(decision.token)) return 'invalid-decision-token';
  return null;
}

module.exports = {needsInput, decisionError};

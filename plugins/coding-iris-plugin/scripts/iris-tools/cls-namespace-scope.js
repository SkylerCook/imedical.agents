'use strict';

// SET arguments are separated by top-level commas. Parenthesized expressions
// and the optional command postcondition may themselves contain comparisons.
function namespaceTargets(args) {
  const targets = [];
  let depth = 0, target = true, condition = args[0]?.value === ':';
  for (const [i, token] of args.entries()) {
    const previous = args[i-1];
    if (condition && !depth && previous && token.column > previous.column + previous.value.length) condition = false;
    if (!condition && !depth && target && /^\$namespace$/i.test(token.value) && args[i+1]?.value === '=') targets.push(token);
    if (!condition && !depth) target = token.value === ',';
    if (token.type === 'Delimiter') {
      for (const ch of token.value) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
      }
    }
  }
  return targets;
}

// true/false are decided at preprocessing time. null depends on the build.
function and(left, right) {
  if (left === false || right === false) return false;
  return left === true && right === true ? true : null;
}

function not(value) {
  return value === null ? null : !value;
}

function compileCondition(tokens, line) {
  const argument = tokens[2];
  if (!argument) return null;
  const expression = line.slice(argument.column-1).split(/\s/, 1)[0];
  // Everything following the expression after whitespace is a directive comment.
  if (!/^[+-]?\d+$/.test(expression)) return null;
  return /[1-9]/.test(expression);
}

function preprocessing() {
  const stack = [];
  let active = true;
  return (tokens, line) => {
    if (tokens[0]?.type !== 'Pre-Processor Command' || tokens[0].value !== '#') return active;
    const directive = tokens[1]?.value.toLowerCase();
    if (['if','ifdef','ifndef','ifundef'].includes(directive)) {
      const test = directive === 'if' ? compileCondition(tokens,line) : null;
      stack.push({parent:active, remaining:and(active,not(test))});
      active = and(active,test);
    } else if (stack.length) {
      const frame = stack[stack.length-1];
      if (directive === 'elseif') {
        const test = compileCondition(tokens,line);
        active = and(frame.remaining,test);
        frame.remaining = and(frame.remaining,not(test));
      } else if (directive === 'else') {
        active = frame.remaining;
        frame.remaining = false;
      } else if (directive === 'endif') {
        active = stack.pop().parent;
      }
    }
    return false; // Preprocessor arguments never establish a runtime guard.
  };
}

// Compare violations across complete methods so removing a guard or call is visible
// even when the SET line itself is unchanged.
function namespaceIssues(lines, parsed, methods, attrs) {
  const issues = [];
  for (const [key, method] of methods) {
    if (method.bodyStart === undefined) continue;
    const called = new Set();
    const jumped = new Set();
    const switches = [];
    const snapshots = new Map();
    const blocks = [];
    let closedIf, lastCommand;
    const compiled = preprocessing();
    const conditions = [];
    const firstIssue = issues.length;
    let possibleGuard = false;
    let conditionalFlow = false;
    let dynamicEntry = false;
    let label, saved = false, terminated = false, isolated = false;
    for (let row = method.bodyStart; row < method.bodyEnd; row++) {
      const line = lines[row];
      const tokens = parsed[row].filter(t => t.l === 1).map(t => ({
        value:line.slice(t.p,t.p+t.c), type:attrs[t.s], column:t.p+1
      }));
      const first = tokens[0];
      if (!first) continue;
      if (first.type === 'Pre-Processor Command' && /^(?:if|ifdef|ifndef|ifundef|elseif|else|endif)$/i.test(tokens[1]?.value)) {
        conditions.push(line.trim());
      }
      const included = compiled(tokens,line);
      if (included === false) continue;
      // Alternative labels, exits or braces can change the frame reaching a
      // switch. Keep those paths for review instead of merging their effects.
      if (included === null && tokens.some(t => t.type === 'Label' ||
          t.type === 'Command' && /^(?:q|quit|return|g|goto|d|do|x|xecute)$/i.test(t.value) ||
          t.type === 'Brace')) conditionalFlow = true;
      if (first.type === 'Label' && first.column === 1) {
        snapshots.clear();
        label = first.value;
        isolated = terminated;
        saved = false;
        blocks.length = 0;
        closedIf = undefined;
        terminated = false;
      }
      for (const [i,t] of tokens.entries()) {
        const next = tokens[i+1];
        if (t.type === 'Extrinsic function' && t.value === '$$' && next?.type === 'Label' && tokens[i+2]?.value.startsWith('(')) called.add(next.value);
        if (t.value === '}' && t.type !== 'String') {
          const block = blocks.pop();
          if (block) {
            const branchEnd = saved;
            saved = block.kind === 'else' ? and(block.thenSaved,branchEnd) : block.entry;
            closedIf = block.kind === 'if' ? {thenSaved:branchEnd} : undefined;
          }
          lastCommand = undefined;
        } else if (t.value === '{' && t.type !== 'String') {
          const kind = lastCommand === 'if' ? 'if' : lastCommand === 'else' && closedIf ? 'else' : 'other';
          blocks.push({kind,entry:saved,thenSaved:closedIf?.thenSaved});
          closedIf = undefined;
        }
        // The native CLS lexer can mark an indirect GOTO as Error in a procedure.
        // Preserve the uncertain control flow alongside any syntax diagnostic.
        if (t.type === 'Error' && /^(?:g|goto)$/i.test(t.value) && next?.value === '@') dynamicEntry = true;
        if (t.type !== 'Command') continue;
        lastCommand = t.value.toLowerCase();
        if (/^(?:x|xecute)$/.test(lastCommand) || (/^(?:d|do|g|goto)$/.test(lastCommand) && next?.value === '@')) dynamicEntry = true;
        if (/^(?:g|goto)$/.test(lastCommand)) {
          // Complex target lists, offsets and postconditions need control-flow review.
          const rest = tokens.slice(i+1);
          const end = rest.findIndex(v => ['Command','Comment'].includes(v.type));
          const args = end < 0 ? rest : rest.slice(0,end);
          if (args.length === 1 && next.type === 'Label' && included === true) jumped.add(next.value);
          else dynamicEntry = true;
        }
        if (lastCommand === 'i') lastCommand = 'if';
        if (lastCommand === 'e') lastCommand = 'else';
        if (lastCommand !== 'else') closedIf = undefined;
        if (/^d(?:o)?$/i.test(t.value) && next?.type === 'Label' && tokens[i+2]?.value !== '^') called.add(next.value);
        if (i === 0 && /^(q(?:uit)?|return)$/i.test(t.value) && next?.value !== ':') terminated = true;
        if (i === 0 && /^n(?:ew)?$/i.test(t.value) && /^\$namespace$/i.test(next?.value)) {
          possibleGuard = true;
          if (saved !== true) saved = included;
        }
        if (/^(?:zn|znspace)$/i.test(t.value) && next) {
          const original = snapshots.get(next.value);
          if (original?.outbound && !saved) {
            issues.push({...original.outbound, manualRestore:true, conditional:included === null || original.outbound.conditional || saved === null || conditionalFlow});
            snapshots.delete(next.value);
          } else {
            for (const snapshot of snapshots.values()) {
              if (!snapshot.outbound) snapshot.outbound = {key,label,line:row+1,column:t.column,source:line.trim(),conditional:included === null || snapshot.conditional};
            }
          }
        }
        if (!/^s(?:et)?$/i.test(t.value)) continue;
        if (next && tokens[i+2]?.value === '=') {
          snapshots.delete(next.value);
          const rhs = tokens[i+3], following = tokens[i+4];
          if (rhs && /^\$(?:namespace|znspace)$/i.test(rhs.value) &&
              (!following || ['Comment','Command'].includes(following.type) || following.value === ',')) {
            snapshots.set(next.value, {conditional:included === null});
          }
        }
        const rest = tokens.slice(i+1);
        const end = rest.findIndex(v=>v.type === 'Command');
        const args = end < 0 ? rest : rest.slice(0,end);
        for (const v of namespaceTargets(args)) {
          switches.push({label, saved, isolated, included, line:row+1, column:v.column, key,
            source:line.trim()});
        }
      }
      // A conditional or block-local quit cannot establish a fall-through barrier.
      if (first.value === '{' || first.value === '}') terminated = false;
    }
    for (const item of switches) {
      // An independently called method may itself own the frame. Indirect jumps
      // and dynamic code also require the reviewer to inspect the actual caller.
      if (item.included === true && jumped.has(item.label)) issues.push(item);
      else if (item.saved === null || (conditionalFlow && possibleGuard) || item.included === null) issues.push({...item, conditional:true});
      else if (item.saved && (!item.label || dynamicEntry)) issues.push({...item, manual:true});
      else if (!(item.label && called.has(item.label) && item.isolated && item.saved)) issues.push(item);
    }
    // A changed build condition reopens review even if the SET line is identical.
    const signature = JSON.stringify(conditions);
    for (let i = firstIssue; i < issues.length; i++) {
      if (issues[i].conditional) issues[i].conditions = signature;
    }
  }
  return issues;
}
module.exports = {namespaceIssues};

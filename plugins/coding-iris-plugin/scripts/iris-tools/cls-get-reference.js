'use strict';

// Only the outer variable in the first argument is subject to the reference rule.
// Expressions inside a subscript or the default may legally call methods.
module.exports = function getReferenceIssues(lines, parsed, attrs, declarations, selected) {
  const members = new Map();
  for (const [key, declaration] of declarations) {
    if (key.startsWith('field:') || key.startsWith('method:')) members.set(declaration.name, declaration);
  }
  const issues = [];
  parsed.forEach((row, index) => {
    if (!selected(index + 1)) return;
    const tokens = row.map(t => lines[index].slice(t.p,t.p+t.c));
    for (const [i, token] of row.entries()) {
      if (token.l !== 1 || attrs[token.s] !== 'Function' || !/^\$g(?:et)?$/i.test(tokens[i]) || tokens[i+1] !== '(') continue;
      const head = tokens[i+2];
      if (!head) continue;
      let manual = false;
      if (head === '..' || tokens[i+3] === '.') {
        const self = head === '..';
        const name = tokens[i+(self ? 3 : 4)];
        const member = self && members.get(name);
        if (member?.multidimensional) continue;
        if (!member) {
          if (head === '%request' && name === 'CgiEnvs' || head === '%session' && name === 'Data') continue;
          manual = !(head === '%request' && name === 'GetCgiEnv');
        }
      } else if (!['##class','$$','$'].includes(head.toLowerCase()) &&
                 !(head.startsWith('$') && !head.startsWith('$$$') && /^(?:Function|System variable)$/.test(attrs[row[i+2].s]))) {
        continue;
      }
      issues.push({line:index+1,column:token.p+1,...(manual ? {status:'manual-review'} : {}),
        message:manual ? 'OS010: verify the receiver class and MultiDimensional property declaration for $GET' :
          'OS010: $GET first argument must reference a variable or MultiDimensional property'});
    }
  });
  return issues;
};

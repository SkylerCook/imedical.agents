'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {inspect, commandRules} = require('../cls-delivery-gate');

const cases = {
  OS001: {
    bad: ['q:(a) || (b) ""', '.q:(a) && (b)', 'continue:(a) && (##class(Demo.T).Get(b))', 's:(a) && (b) x=1'],
    good: ['q:((a)||(b)) ""', 'continue:((a)&&(b))', 's:((a)&&(b)) x=1',
      's x="q:(a) || (b)"', '; continue:(a) && (b)', '/* q:(a) || (b) */',
      'q:((a) || (b)) ""']
  }
};

test('every registered command ban has executable examples', () => {
  assert.deepEqual(Object.keys(commandRules).sort(), Object.keys(cases).sort());
});
for (const [id, examples] of Object.entries(cases)) {
  test(id + ' rejects bad commands and accepts legal controls', {skip:process.platform !== 'win32' || process.arch !== 'x64'}, () => {
    for (const [kind, lines] of Object.entries(examples)) {
      assert.ok(lines.length);
      for (const line of lines) {
        const source = 'Class Demo.Test\n{\nClassMethod Run()\n{\n    ' + line + '\n}\n}';
        assert.equal(inspect(source).some(issue => issue.message.startsWith(id + ':')), kind === 'bad', line);
      }
    }
  });
}

test('OS002 compares effective method scopes with frozen declarations', {skip:process.platform !== 'win32' || process.arch !== 'x64'}, () => {
  const source = (attrs, members) => 'Class Demo.Scope ' + attrs + '\n{\n' + members + '\n}';
  const method = (name, attrs = '') => 'ClassMethod ' + name + '() ' + attrs + '\n{\n    quit\n}';
  const legacy = '[ Not ProcedureBlock ]';
  const original = source(legacy, method('Old','[ ProcedureBlock = 0 ]'));
  const hits = (after, before = '') => inspect(after, () => true, before).filter(i => i.message.startsWith('OS002'));
  assert.equal(hits(original).length,2);
  assert.equal(hits(original.replace('Old()','Old(a As %String)').replace('quit','quit 1'),original).length,0);
  assert.equal(hits(source(legacy,method('Old')+'\n'+method('New')),original).length,1);
  assert.equal(hits(source(legacy,method('New','[ ProcedureBlock ]')),original).length,0);
  assert.equal(hits(source('',method('New','[\n ProcedureBlock = 0\n]'))).length,1);
  assert.equal(hits(source('',method('New','[ Language = python, ProcedureBlock = 0 ]'))).length,0);
  assert.equal(hits(source('',method('New').replace('quit','write "Not ProcedureBlock"'))).length,0);
});

test('OS003 checks block dots only in new ObjectScript method bodies', {skip:process.platform !== 'win32' || process.arch !== 'x64'}, () => {
  const member = (kind, name, lines) => [kind+' '+name+'()', '{', ...lines, '}'].join('\n');
  const legacy = member('ClassMethod','Legacy',['    Do','    .Set value=1']);
  const wrap = members => ['Class Demo.Test','{',...members,'}'].join('\n');
  const before = wrap([legacy]);
  const hits = source => inspect(source, () => false, before).filter(i=>i.message.startsWith('OS003'));
  const added = member('Method','Added',['    If ok Do','    .Do Out','    . Set i=1 For  Do','    ..Set x=2','    . . .Set i=i+1']);
  assert.equal(hits(wrap([legacy.replace('value=1','value=2'),added])).length,4);
  const braces = member('Method','Added',['    If ok {','        Do ..Out(.value)','        Set x=obj.Prop','        Write ".Set i=1"','        // ..Set x=2','    }']);
  assert.deepEqual(hits(wrap([legacy,braces])),[]);
});

test('OS004 checks changed login reads without matching quoted examples or comments', {skip:process.platform !== 'win32' || process.arch !== 'x64'}, () => {
  const lines = ['Class Demo.Test','{','Method Run()','{',
    '    If LocID="" Set LocID=%session.Get("LOGON.CTLOCID")',
    '    If UserID="" Set UserID=%session.Get("LOGON.USERID")',
    '    Write "%session.Get(""LOGON.USERID"")"',
    '    // Set x=%session.Get("LOGON.CTLOCID")',
    '    Set x=..%LogonLocId(sessionStr)',
    '    Set x=%session.Data("LOGON.USERID")',
    '    Set x=%session.Get("LOGON.HOSPID")',
    '    Set x=%session.Get("LOGON.USERID"_suffix)',
    '    Set x=..%LogonUserId(sessionStr)', '}', '}'];
  const check = selected => inspect(lines.join('\n'),selected).filter(i=>i.message.startsWith('OS004')).map(i=>i.line);
  assert.deepEqual(check(()=>true),[5,6]);
  assert.deepEqual(check(n=>n===6),[6]);
});

test('OS006 checks only new documented declarations and accepts legacy tag aliases', {skip:process.platform !== 'win32' || process.arch !== 'x64'}, () => {
  const bare = 'Class Demo.Example Extends %Persistent\n{\nProperty code As %String;\nClassMethod Read(input As %String) As %String\n{\n    Quit input\n}\n}';
  const check = (source, before='') => inspect(source,()=>false,before).filter(i=>i.message.startsWith('OS006'));
  assert.deepEqual(check(bare).map(i=>i.message.split(': ').pop()),['Name, Table, Description','Name','Name, Return']);
  const documented = bare.replace(/^Class /,'/// Name: 批次\n/// Table: Demo.Example\n/// Description: 每行代表一次导入。\nClass ')
    .replace('Property ','/// 名称：批次编码\nProperty ')
    .replace('ClassMethod ','/// Name: 读取批次\n/// Return: 批次编码\nClassMethod ');
  assert.deepEqual(check(documented),[]);
  assert.equal(check(bare.replace('Quit input','Quit ""'),bare).length,0);
  assert.equal(check(bare.replace('Property code','/// Name:   \nProperty added As %String;\nProperty code'),bare).length,1);
});

test('OS008 requires a called local label, protected switch and no main-path fallthrough', {skip:process.platform !== 'win32' || process.arch !== 'x64'}, () => {
  const wrap=body=>'Class Demo.Test\n{\nMethod Run()\n{\n'+body+'\n}\n}';
  const outer='    Do Switch\n    Quit\nSwitch\n', protect='    New $Namespace\n', assign='    Set $Namespace=target\n    Quit';
  const good=wrap(outer+protect+assign);
  const hits=(src,old='')=>inspect(src,()=>false,old).filter(i=>i.message.startsWith('OS008'));
  assert.deepEqual(hits(good),[]);
  const functionCall=wrap('    Set ok=$$Switch(target)\n    Quit\nSwitch(target)\n'+protect+assign+' 1');
  assert.deepEqual(hits(functionCall),[]);
  assert.equal(hits(functionCall.replace('Set ok=$$Switch(target)','Goto Switch')).length,1);
  assert.equal(hits(wrap(protect+assign)).length,1);
  for (const changed of [good.replace(protect,''),good.replace('Do Switch','Do Other'),good.replace('    Quit\nSwitch','Switch')]) assert.equal(hits(changed,good).length,1);
  assert.deepEqual(hits(wrap('    Write $Namespace')),[]);
});

test('OS008 distinguishes reaching branches and top-level SET targets', {skip:process.platform !== 'win32' || process.arch !== 'x64'}, () => {
  const check = body => inspect('Class Demo.Test\n{\nMethod Run(flag,target)\n{\n    Do Switch\n    Quit\nSwitch\n'+body+'\n    Quit\n}\n}').filter(i=>i.message.startsWith('OS008'));
  const branch='    If flag {\n        New $Namespace\n    }';
  assert.equal(check(branch+'\n    Set $Namespace=target').length,1);
  assert.deepEqual(check(branch+' Else {\n        New $Namespace\n    }\n    Set $Namespace=target'),[]);
  assert.deepEqual(check('    If flag {\n        New $Namespace\n        Set $Namespace=target\n    }'),[]);
  assert.deepEqual(check('    Set flag=$Select(flag:1,$Namespace=target:2,1:3)'),[]);
  assert.equal(check('    Set flag=$Select(flag:1,1:3),$Namespace=target').length,1);
  assert.equal(check('    Set:flag $Namespace=target').length,1);
});

test('OS008 preserves uncertain calling context for review', {skip:process.platform !== 'win32' || process.arch !== 'x64'}, () => {
 const source='Class Demo.Test\n{\nMethod Run(target)\n{\n    New $Namespace\n    Set $Namespace=target\n    Quit\n}\n}';
 const findings=inspect(source).filter(i=>i.message.startsWith('OS008'));
 assert.deepEqual(findings.map(i=>i.status),['manual-review']);
});

test('OS008 examines mixed and indirect entry even when a local call exists', {skip:process.platform !== 'win32' || process.arch !== 'x64'}, () => {
  const check = route => inspect('Class Demo.Test\n{\nMethod Run(target,flag)\n{\n'+route+'\n    Do Switch\n    Quit\nSwitch\n    New $Namespace\n    Set $Namespace=target\n    Quit\n}\n}').filter(i=>i.message.startsWith('OS008'));
  assert.equal(check('    If flag G Switch').length,1);
  assert.equal(check('    If flag Goto @target')[0].status,'manual-review');
  assert.deepEqual(check('    Write "Goto Switch"'),[]);
});

test('OS008 only credits guards included by conditional compilation', {skip:process.platform !== 'win32' || process.arch !== 'x64'}, () => {
  const save='    New $Namespace', change='    Set $Namespace=target';
  const method = body => ['Class Demo.Test','{','Method Run(target)','{','    Do Switch','    Quit','Switch',...body,'    Quit','}','}'].join('\n');
  const findings = (body,old=[]) => inspect(method(body),()=>false,method(old))
    .filter(issue=>issue.message.startsWith('OS008')).map(issue=>issue.status || 'fail');
  const original=[save,change];
  assert.deepEqual(findings(['#if 0',save,'#endif',change],original),['fail']);
  assert.deepEqual(findings(['#if 1',save,'#endif',change],original),[]);
  assert.deepEqual(findings(['#if 0','#ifdef FLAG',save,'#endif','#endif',change]),['fail']);
  assert.deepEqual(findings(['#if 0',change,'#elseif 1',save,'#else',change,'#endif',change]),[]);
  assert.deepEqual(findings(['#if $$$FLAG',save,'#endif',change],original),['manual-review']);
  assert.deepEqual(findings(['#if 0','#elseif $$$FLAG',save,'#endif',change]),['manual-review']);
  assert.deepEqual(findings(['#if 1',save,'#elseif $$$FLAG',change,'#endif',change]),[]);
  assert.deepEqual(findings(['#if $$$B',save,'#endif',change],['#if $$$A',save,'#endif',change]),['manual-review']);
  assert.deepEqual(findings(['#if 1-1',save,'#endif',change]),['manual-review']);
  assert.deepEqual(findings(['    /*','#if 0','    */',save,change]),[]);
});
test('OS009 follows the display producer through a local alias to typed write destinations', {skip:process.platform !== 'win32' || process.arch !== 'x64'}, () => {
  const source=(sink,expr='##class(websys.Conversions).DateLogicalToHtml(day)')=>[
    'Class Demo.A Extends %Persistent','{','Property Stamp As %DateTime [ SqlFieldName = changed_at ];',
    'Property Caption As %String;','Method Run(day)','{','    Set value='+expr,'    Set alias=value',sink,'    Quit','}','}'].join('\n');
  const check=(sink,expr,old='')=>inspect(source(sink,expr),()=>false,old).filter(i=>i.message.startsWith('OS009')).map(i=>i.status);
  assert.deepEqual(check('    Write alias'),[]);
  assert.deepEqual(check('    Set obj=##class(Demo.A).%New()\n    Set obj.Stamp=alias'),['fail']);
  assert.deepEqual(check('    Set ..Caption=alias'),[]);
  for(const sink of ['    Set ..Stamp=alias','    &sql(Update Demo.A Set changed_at=:alias)',
    '    &sql(Insert Into Demo.A (Caption,changed_at) Values (:day,:alias))']){
    assert.deepEqual(check(sink),['fail']);
    assert.deepEqual(check(sink,'$zdt($h,3)'),[]);
    assert.deepEqual(check(sink,'..UnknownHelper(day)'),['manual-review']);
    assert.deepEqual(check(sink,undefined,source(sink)),[]);
  }
  assert.deepEqual(check('    &sql(Update Other.Table Set changed_at=:alias)'),['manual-review']);
  assert.deepEqual(check('    &sql(Update Demo.A Set Caption=:alias Where changed_at=:alias)'),[]);
  const shared=source('    &sql(Update Outside.T Set stamp=:alias)','..%ZD(day)_" "_..%ZT(day)').replace('%Persistent','DHCDoc.Util.RegisteredObject');
  assert.ok(inspect(shared).some(i=>i.status==='manual-review' && i.message.startsWith('OS009')));
  assert.ok(!inspect(shared.replace('%ZD(day)','%ZD(day,3)').replace('%ZT(day)','%ZT(day,1)')).some(i=>i.message.startsWith('OS009')));
});

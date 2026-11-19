'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {spawnSync} = require('node:child_process');
const {createTempDirectory, ownsTempDirectory} = require('./fixtures/temp-directory');
const tool = path.resolve(__dirname, '../../plugins/coding-iris-plugin/scripts/iris-tools/xml-to-source.js');
const {hash} = require(path.join(path.dirname(tool), 'xml-package-core'));

function fixture(t) {
  const root = createTempDirectory('iris-xtoc-');
  t.after(() => {
    assert.ok(ownsTempDirectory(root));
    fs.rmSync(root, {recursive: true, force: true});
  });
  const incoming = path.join(root, 'incoming');
  fs.mkdirSync(incoming);
  return {root, incoming, write(name, xml) {
    fs.writeFileSync(path.join(incoming, name), xml);
    return path.join(incoming, name);
  }};
}

function run(cwd, ...args) {
  return spawnSync(process.execPath, [tool, ...args], {cwd, encoding: 'utf8', windowsHide: true});
}

function converted(cwd, input, dest) {
  const result = run(cwd, '--input', input, '--out', dest);
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  return JSON.parse(fs.readFileSync(summary.manifest, 'utf8'));
}

test('converts a mixed local batch into deterministic independently verifiable source files', t => {
  const {root, incoming, write} = fixture(t);
  const cls = '<Class name="Demo.Patient"><Import>Demo.Types,Demo.Common</Import><Description>说明</Description>' +
    '<Super>%Persistent,Demo.Base</Super><ClassType/><Owner>_SYSTEM</Owner><ProcedureBlock>0</ProcedureBlock><TimeChanged>1</TimeChanged>' +
    '<Parameter name="Code"><Default>001</Default></Parameter>' +
    '<Property name="Display"><Type>%String</Type><Parameter name="MAXLEN" value="80"/><SqlFieldName>DISPLAY_NAME</SqlFieldName></Property>' +
    '<Property name="Items"><Type>Demo.Item</Type><Relationship>1</Relationship><Cardinality>children</Cardinality><Inverse>Patient</Inverse></Property>' +
    '<Index name="ByDisplay"><Properties>Display,Items(ELEMENTS)</Properties><Unique>1</Unique></Index>' +
    '<UDLText name="T1"><Content><![CDATA[' + '\n// retained comment\n' + ']]></Content></UDLText>' +
    '<Method name="Load"><ClassMethod>1</ClassMethod><FormalSpec><![CDATA[&x:%String(MAXLEN=10),*err:%Status,lang:%String="a,b",options...]]></FormalSpec>' +
    '<ReturnType>%Status</ReturnType><PlaceAfter>Other,Load2</PlaceAfter><ServerOnly>1</ServerOnly><Implementation><![CDATA[' +
    '\n    Quit $SELECT(x="&x":1,1:0)\n' + ']]></Implementation></Method>' +
    '<Query name="Recent"><Type>%SQLQuery</Type><SqlProc>1</SqlProc><Parameter name="CONTAINID" value="1"/><SqlQuery>SELECT ID FROM Demo.Patient</SqlQuery></Query>' +
    '<Trigger name="OnInsert"><Event>INSERT</Event><Time>AFTER</Time><Order>1</Order><Code>    Quit</Code></Trigger>' +
    '<XData name="Spec"><XMLNamespace>urn:demo</XMLNamespace><Data><![CDATA[<Value a="}">诊疗</Value>]]></Data></XData>' +
    '<Storage name="Default"><Type>%Storage.SQL</Type><SQLMap name="Rows"><Subscript name="1"><Expression>{ID}</Expression></Subscript>' +
    '<Data name="Name"><Piece>1</Piece><Delimiter>&amp;|</Delimiter></Data></SQLMap></Storage></Class>';
  const a = write('a.xml', '<?xml version="1.0" encoding="UTF-8"?><Export generator="IRIS" version="26">' + cls +
    '<Package name="Demo" sqlname="DemoSQL"/><Project name="Example"><Items><ProjectItem name="Demo.Patient"/></Items></Project>' +
    '<Routine name="Demo" type="MAC" timestamp="1"><![CDATA[' + '\nDemo\n    Quit\n' + ']]></Routine>' +
    '<Routine name="DemoLib.inc"><![CDATA[#define VALUE 1]]></Routine>' +
    '<Routine name="DemoInt" type="INT"><![CDATA[ROUTINE DemoInt [Type=INT]' + '\nDemoInt\n' + ']]></Routine>' +
    '<CSP name="nested/a.js" application="/web/" default="1"><![CDATA[let x = "<p>诊疗</p>";]]></CSP></Export>');
  const raw = Buffer.from([0xef, 0xa7, 0x00, 0xff, 0x0d, 0x0a]);
  write('b.XML', '<Export generator="Cache" version="25">' + cls.replace('<TimeChanged>1', '<TimeChanged>2') +
    '<CSPBase64 name="legacy.js" application="/web/" default="1">' + raw.toString('base64') + '</CSPBase64></Export>');
  write('excluded.txt', 'not xml');
  fs.mkdirSync(path.join(incoming, 'nested.xml'));
  fs.writeFileSync(path.join(incoming, 'nested.xml', 'nested.xml'), 'invalid');
  const dest = path.join(root, 'one');
  const result = converted(root, incoming, dest);
  assert.equal(result.inputs.length, 2);
  assert.equal(result.inputs[0].sha256, hash(fs.readFileSync(a)));
  assert.deepEqual(result.inputs[0].metadata.map(node => node.tag), ['Package', 'Project']);
  assert.match(result.inputs[0].metadata[1].xml, /<ProjectItem name="Demo.Patient"\/>/);
  assert.equal(result.files.length, 6);
  assert.deepEqual(result, converted(root, incoming, path.join(root, 'two')));
  const read = file => fs.readFileSync(path.join(dest, 'src', file));
  for (const item of result.files) assert.equal(hash(fs.readFileSync(path.join(dest, item.path))), item.sha256);
  assert.deepEqual(result.files.find(item => item.identity === 'CLS:Demo.Patient.cls').sources.map(source => source.file), ['a.xml', 'b.XML']);
  assert.equal(read('Demo.mac').toString(), 'ROUTINE Demo [Type = MAC]\nDemo\n    Quit\n');
  assert.equal(read('DemoLib.inc').toString(), 'ROUTINE DemoLib [Type = INC]\n#define VALUE 1');
  assert.equal(read('DemoInt.int').toString(), 'ROUTINE DemoInt [Type=INT]\nDemoInt\n');
  assert.equal(read('web/nested/a.js').toString(), 'let x = "<p>诊疗</p>";');
  assert.deepEqual(read('web/legacy.js'), raw);
  const udl = read('Demo/Patient.cls').toString();
  for (const text of [
    'Import (Demo.Types, Demo.Common)', '/// 说明',
    'Class Demo.Patient Extends (%Persistent, Demo.Base) [ ClassType = "", Owner = {_SYSTEM}, Not ProcedureBlock ]\n{\n\n',
    'Parameter Code = 001;', 'Property Display As %String(MAXLEN = 80) [ SqlFieldName = DISPLAY_NAME ];',
    'Relationship Items As Demo.Item [ Cardinality = children, Inverse = Patient ];',
    'Index ByDisplay On (Display, Items(ELEMENTS)) [ Unique ];', '// retained comment',
    'ClassMethod Load(ByRef x As %String(MAXLEN=10), Output err As %Status, lang As %String = "a,b", options...) As %Status',
    '[ PlaceAfter = (Other, Load2), ServerOnly = 1 ]', 'Quit $SELECT(x="&x":1,1:0)',
    'Query Recent() As %SQLQuery(CONTAINID = 1) [ SqlProc ]', 'SELECT ID FROM Demo.Patient',
    'Trigger OnInsert [ Event = INSERT, Time = AFTER, Order = 1 ]', 'XData Spec [ XMLNamespace = "urn:demo" ]',
    '<Value a="}">诊疗</Value>', 'Storage Default', '<Type>%Storage.SQL</Type>',
    '<SQLMap name="Rows"><Subscript name="1"><Expression>{ID}</Expression></Subscript>',
    '<Data name="Name"><Piece>1</Piece><Delimiter>&amp;|</Delimiter></Data>'
  ]) assert.ok(udl.includes(text), text);
  assert.match(udl, /;\n\n\/\/ retained comment\nClassMethod Load/);
  assert.match(udl, /\n}\n\n}\n$/);
});

test('preserves reference and output arguments in locally packaged FormalSpec', t => {
  const {root, write} = fixture(t);
  const input = write('module.xml', '<Export><Class name="Demo.Module">' +
    '<Method name="Process"><ClassMethod>1</ClassMethod>' +
    '<FormalSpec>value, Output reason, ByRef state:%String, *error:%Status, &amp;result:%String="a,b"</FormalSpec>' +
    '</Method></Class></Export>');
  const out = path.join(root, 'out');
  converted(root, input, out);
  const source = fs.readFileSync(path.join(out, 'src/Demo/Module.cls'), 'utf8');
  assert.ok(source.includes('ClassMethod Process(value, Output reason, ByRef state As %String, ' +
    'Output error As %Status, ByRef result As %String = "a,b")'));
});

test('help outranks conversion and validates no paths on help', t => {
  const {root} = fixture(t);
  const result = run(root, '--input', 'nonexistent.xml', '--out', 'created', '--help');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--input.*--out/);
  assert.equal(fs.existsSync(path.join(root, 'created')), false);
});

test('keeps the qualified class name when its last component is cls', t => {
  const {root, write} = fixture(t);
  const input = write('test.xml', '<Export><Class name="Demo.cls"/></Export>');
  const result = converted(root, input, path.join(root, 'out'));
  assert.equal(result.files[0].identity, 'CLS:Demo.cls.cls');
  assert.equal(result.files[0].path, 'src/Demo/cls.cls');
});

test('removes only the native XML framing line from web text while preserving source line numbers', t => {
  const {root, incoming, write} = fixture(t);
  const original = '\nconst first = 1;\r\nconst second = 2;\r\n';
  const raw = Buffer.from('\r\nconst binary = 1;\r\n');
  write('native.xml', '<Export generator="IRIS" version="26"><CSP name="source.js" application="/web/"><![CDATA[' +
    '\n' + original + ']]></CSP><CSP name="plain.txt" application="/web/">\nplain</CSP>' +
    '<CSPBase64 name="raw.js" application="/web/">' + raw.toString('base64') + '</CSPBase64></Export>');
  write('cache.xml', '<Export generator="Cache" version="25"><CSP name="legacy.css" application="/web/"><![CDATA[' +
    '\nbody{}\n]]></CSP></Export>');
  write('generic.xml', '<Export><CSP name="generic.js" application="/web/"><![CDATA[' +
    '\nconst generic = 1;\n]]></CSP></Export>');
  const target = path.join(root, 'out');
  converted(root, incoming, target);
  const read = name => fs.readFileSync(path.join(target, 'src/web', name));
  assert.equal(read('source.js').toString(), original.replace(/\r\n/g, '\n'));
  assert.equal(read('legacy.css').toString(), 'body{}\n');
  assert.equal(read('plain.txt').toString(), '\nplain');
  assert.equal(read('generic.js').toString(), '\nconst generic = 1;\n');
  assert.deepEqual(read('raw.js'), raw);
});

test('reports the exact broken object and never publishes incomplete batches', t => {
  const {root, incoming, write} = fixture(t);
  write('first.xml', '<Export><Class name="Demo.Patient"/></Export>');
  const output = path.join(root, 'out');
  const checks = [
    ['<Export><Class name="Demo.Patient"><Method name="M"/></Class></Export>', 'source-object-conflict'],
    ['<Export><CSP name="Patient.cls" application="/Demo/">x</CSP></Export>', 'source-path-conflict'],
    ['<Export><Class name="demo.Child"/></Export>', 'source-path-conflict'],
    ['<Export><Class name="CON.Patient"/></Export>', 'unsafe-source-output-path'],
    ['<Export><CSP name="../a.js" application="/Demo/">x</CSP></Export>', 'unsafe-document-name'],
    ['<Export><CSPBase64 name="a.js" application="/Demo/">bad!</CSPBase64></Export>', 'invalid-csp-base64'],
    ['<Export><Class name="Demo.Other"><Unknown>value</Unknown></Class></Export>', 'unsupported-udl-field', 'Class/Unknown'],
    ['<Export><Routine name="Test.mac" type="INT">Quit</Routine></Export>', 'routine-type-conflict', '@type'],
    ['<Export><Global/></Export>', 'unsupported-export-item'],
    ['<!DOCTYPE Export [<!ENTITY external SYSTEM "file:///invalid">]><Export/>', 'xml-doctype-forbidden'],
    ['<Export><Class name="X"></Export>', 'invalid-xml']
  ];
  for (const [input, reason, field] of checks) {
    write('second.xml', input);
    const result = run(root, '--input', incoming, '--out', output);
    assert.notEqual(result.status, 0, result.stdout);
    const detail = JSON.parse(result.stderr);
    assert.equal(detail.reason, reason, result.stderr);
    assert.equal(detail.field, field);
    assert.equal(detail.input, 'second.xml');
    assert.equal(fs.existsSync(output), false);
    assert.equal(fs.existsSync(path.join(root, '.out.xtoc-lock')), false);
  }
});

test('refuses a list-only XML, an unknown encoding and an existing output directory', t => {
  const {root, write} = fixture(t);
  const out = path.join(root, 'out');
  for (const [xml, reason] of [
    ['<Export><Project name="Demo"><Items><ProjectItem name="Demo.A"/></Items></Project></Export>', 'xml-source-objects-required'],
    ['<?xml version="1.0" encoding="GB2312"?><Export><Class name="Demo.A"/></Export>', 'xml-utf8-required']
  ]) {
    const result = run(root, '--input', write('test.xml', xml), '--out', out);
    assert.notEqual(result.status, 0);
    assert.equal(JSON.parse(result.stderr).reason, reason);
  }
  fs.mkdirSync(out);
  const existing = run(root, '--input', write('test.xml', '<Export><Class name="Demo.A"/></Export>'), '--out', out);
  assert.notEqual(existing.status, 0);
  assert.equal(JSON.parse(existing.stderr).reason, 'source-output-already-exists');
  assert.deepEqual(fs.readdirSync(out), []);
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const updater = require('../../maintenance/hisui-build/update-hisui-vendor');
const repo = path.resolve(__dirname, '../..'), vendor = path.join(repo, 'vendor/hisui');
function temporary(run) {
  const base = process.env.HISUI_TEST_TEMP || path.join(os.tmpdir(), 'Codex');
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'hisui-test-'));
  try { return run(root); } finally { updater.removeOwned(root, base); }
}
test('pinned vendor inventory and source index match all assets', () => {
  const result = updater.verify(vendor);
  assert.equal(result.status, 'verified');
  assert.ok(result.files > 100);
  assert.ok(result.jqueryEntrypoints > 40);
});
test('inventory rejects modified, additional and missing files', () => temporary(root => {
  fs.cpSync(vendor, root, { recursive: true });
  const file = path.join(root, 'dist/js/jquery.hisui.js'), bytes = fs.readFileSync(file);
  fs.appendFileSync(file, '\n// synthetic change');
  assert.throws(() => updater.verify(root), /hash mismatch/);
  fs.writeFileSync(file, bytes);
  fs.writeFileSync(path.join(root, 'dist/new.txt'), 'synthetic');
  assert.throws(() => updater.verify(root), /hash mismatch/);
  fs.unlinkSync(path.join(root, 'dist/new.txt'));
  fs.unlinkSync(file);
  assert.throws(() => updater.verify(root), /hash mismatch/);
}));
test('unsupported build arrays and ambiguous CLI arguments stop', () => {
  assert.deepEqual(updater.parseArray("var components = ['one', 'two'];", 'components'), ['one', 'two']);
  assert.throws(() => updater.parseArray('var components = [getInputs()];', 'components'), /Unsupported/);
  assert.throws(() => updater.argumentsOf(['update', '--commit', 'master']), /full SHA/);
  assert.throws(() => updater.argumentsOf(['update', '--unknown', 'x']), /Invalid argument/);
});
test('replacement verification failure restores the previous snapshot', () => temporary(root => {
  const target = path.join(root, 'target'), next = path.join(root, 'next');
  fs.mkdirSync(path.join(target, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(target, 'dist/old.txt'), 'previous');
  fs.writeFileSync(path.join(target, 'README.md'), 'preserve maintainer text');
  fs.mkdirSync(path.join(next, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(next, 'licenses'));
  for (const name of ['LICENSE', 'THIRD-PARTY-NOTICES.md', 'source-index.json', 'resource-warnings.json', 'upstream.json']) fs.writeFileSync(path.join(next, name), '{}');
  assert.throws(() => updater.publish(next, target, root), /Invalid upstream identity/);
  assert.equal(fs.readFileSync(path.join(target, 'dist/old.txt'), 'utf8'), 'previous');
  assert.equal(fs.readFileSync(path.join(target, 'README.md'), 'utf8'), 'preserve maintainer text');
  assert.deepEqual(fs.readdirSync(target).sort(), ['README.md', 'dist']);
}));
test('failed rollback preserves the original files for recovery', () => temporary(root => {
  const target = path.join(root, 'target'), next = path.join(root, 'next');
  fs.mkdirSync(path.join(target, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(target, 'dist/old.txt'), 'previous');
  fs.mkdirSync(path.join(next, 'dist'), { recursive: true }); fs.mkdirSync(path.join(next, 'licenses'));
  for (const name of ['LICENSE', 'THIRD-PARTY-NOTICES.md', 'source-index.json', 'resource-warnings.json', 'upstream.json']) fs.writeFileSync(path.join(next, name), '{}');
  const rename = fs.renameSync;
  try {
    fs.renameSync = (from, to) => {
      if (from.includes(path.sep + 'previous' + path.sep)) throw new Error('synthetic recovery failure');
      return rename(from, to);
    };
    assert.throws(() => updater.publish(next, target, root), /recovery files preserved/);
  } finally { fs.renameSync = rename; }
  const recovery = fs.readdirSync(target).find(name => name.startsWith('.hisui-update-'));
  assert.ok(recovery);
  assert.equal(fs.readFileSync(path.join(target, recovery, 'previous/dist/old.txt'), 'utf8'), 'previous');
}));
test('human-facing widget references point at the current source definitions', () => {
  const text = fs.readFileSync(path.join(repo, 'plugins/coding-iris-plugin/references/hisui-widget-index.md'), 'utf8');
  const index = JSON.parse(fs.readFileSync(path.join(vendor, 'source-index.json'), 'utf8'));
  for (const m of text.matchAll(/^\| \*\*(\w+)\*\* \| (\d+) \| (\d+|搜索定位)/gm)) {
    const entry = index.widgets[m[1]]; assert.ok(entry, m[1]);
    assert.equal(Number(m[2]), entry.definition, m[1]);
    if (/^\d+$/.test(m[3])) assert.equal(Number(m[3]), entry.defaults, m[1] + ' defaults');
  }
});
test('symlink cleanup cannot expand outside the owned task directory', () => {
  const base = process.env.HISUI_TEST_TEMP || path.join(os.tmpdir(), 'Codex');
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'hisui-link-test-'));
  const outside = path.join(root, 'outside'), task = path.join(root, 'task'), link = path.join(task, 'linked');
  fs.mkdirSync(outside); fs.mkdirSync(task); fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep');
  try {
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => updater.removeOwned(task, root), /Linked/);
    assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'keep');
  } finally { if (fs.existsSync(link)) fs.unlinkSync(link); updater.removeOwned(root, base); }
});
test('resource gaps are disclosed and new missing references stop', () => temporary(root => {
  assert.deepEqual(updater.resources(vendor), JSON.parse(fs.readFileSync(path.join(vendor, 'resource-warnings.json'), 'utf8')));
  fs.mkdirSync(path.join(root, 'dist/css'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/css/synthetic.css'), '.x { background:url(new-missing-image.png) }');
  assert.throws(() => updater.resources(root), /New upstream resource gap/);
}));
test('pinned source and distribution inputs reproduce the shipped assets', { skip: !process.env.HISUI_UPSTREAM_SOURCE || !process.env.HISUI_BUILD_TOOLS }, async () => {
  const base = process.env.HISUI_TEST_TEMP || path.join(os.tmpdir(), 'Codex');
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'hisui-rebuild-'));
  try {
    const build = await updater.build(process.env.HISUI_UPSTREAM_SOURCE, root, process.env.HISUI_BUILD_TOOLS);
    const metadata = JSON.parse(fs.readFileSync(path.join(vendor, 'upstream.json'), 'utf8'));
    assert.deepEqual(build, metadata.build);
    assert.deepEqual(updater.inventory(root), metadata.files);
  } finally { updater.removeOwned(root, base); }
});
test('changed distribution inputs cannot be silently carried into an upgrade', () => temporary(root => {
  const source = path.join(root, 'source'), output = path.join(root, 'output'), reference = path.join(root, 'reference');
  fs.mkdirSync(source); fs.mkdirSync(output); fs.mkdirSync(path.join(reference, 'dist/css'), { recursive: true });
  fs.writeFileSync(path.join(reference, 'dist/css/font-awesome.all.min.css'), 'synthetic unexpected change');
  assert.throws(() => updater.copyDistribution(source, output, reference), /Distribution input changed/);
}));
for (const filename of ['jquery.hisui.js', 'jquery.hisui.min.js']) {
  test(`real ${filename} initializes controls and reads datagrid editors without an application helper`, { skip: !process.env.HISUI_BUILD_TOOLS }, async () => {
    const req = createRequire(path.join(path.resolve(process.env.HISUI_BUILD_TOOLS), 'package.json'));
    const { JSDOM, VirtualConsole } = req('jsdom'), errors = [];
    const console = new VirtualConsole(); console.on('jsdomError', e => errors.push(e.message));
    const dom = new JSDOM('<!doctype html><html><body><input id="qty"><table id="grid"></table><div id="panel"></div></body></html>',
      { url: 'http://127.0.0.1/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: console });
    try {
      dom.window.eval(fs.readFileSync(path.join(vendor, 'dist/js/jquery-1.11.3.min.js'), 'utf8'));
      dom.window.eval(fs.readFileSync(path.join(vendor, 'dist/js', filename), 'utf8'));
      dom.window.eval(fs.readFileSync(path.join(vendor, 'dist/js/locale/hisui-lang-zh_CN.js'), 'utf8'));
      const $ = dom.window.jQuery;
      assert.equal(typeof $.fn.getValue, 'undefined');
      $('#qty').numberbox({ precision: 2 }); $('#qty').numberbox('setValue', 12.5);
      assert.equal($('#qty').numberbox('getValue'), '12.50');
      $('#panel').panel({ title: 'Synthetic panel', width: 400, height: 160 });
      assert.equal($('#panel').panel('options').title, 'Synthetic panel');
      $('#grid').datagrid({ width: 400, height: 200, columns: [[{ field: 'qty', title: 'Qty', width: 100, editor: 'numberbox' }]], data: [{ qty: 1 }] });
      $('#grid').datagrid('beginEdit', 0);
      const editor = $('#grid').datagrid('getEditor', { index: 0, field: 'qty' });
      assert.ok(editor); editor.actions.setValue(editor.target, 7);
      assert.equal(String(editor.actions.getValue(editor.target)), '7');
      $('#grid').datagrid('endEdit', 0);
      assert.equal(String($('#grid').datagrid('getRows')[0].qty), '7');
      await new Promise(resolve => dom.window.setTimeout(resolve, 30));
      assert.deepEqual(errors, []);
    } finally { dom.window.close(); }
  });
}

for (const filename of ['jquery.hisui.js', 'jquery.hisui.min.js']) {
  for (const theme of ['hisui.pure.css', 'hisui.vben.css']) {
    test(`real ${filename} with ${theme} preserves tree modes, panel border ownership and native fit dimensions`, { skip: !process.env.HISUI_BUILD_TOOLS }, async () => {
      const req = createRequire(path.join(path.resolve(process.env.HISUI_BUILD_TOOLS), 'package.json'));
      const { JSDOM, VirtualConsole } = req('jsdom'), errors = [];
      const console = new VirtualConsole(); console.on('jsdomError', error => errors.push(error.message));
      const dom = new JSDOM('<!doctype html><html><head></head><body><div id="owner" style="width:400px;height:180px;padding:20px;border:1px solid"><div id="fitChild"></div></div><div id="borderPanel"></div><table id="borderGrid"></table><ul id="ordinaryTree"></ul><ul id="linesTree"></ul><div id="nativeLayout" style="width:400px;height:160px"><div data-options="region:&quot;center&quot;"></div></div></body></html>',
        { url: 'http://127.0.0.1/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: console });
      try {
        const styleCode = theme === 'hisui.vben.css' ? 'vben' : 'pure';
        dom.window.HISUIStyleCode = styleCode;
        dom.window.HISUITheme = styleCode === 'vben' ? 'bgseablue' : '';
        dom.window.document.body.setAttribute('data-theme', dom.window.HISUITheme);
        const style = dom.window.document.createElement('style');
        style.textContent = fs.readFileSync(path.join(vendor, 'dist/css', theme), 'utf8');
        dom.window.document.head.appendChild(style);
        // jsdom has no auto text layout; an explicit synthetic title height exercises the native positive-height branch without replacing its API.
        const fixtureStyle = dom.window.document.createElement('style');
        fixtureStyle.textContent = '.tree-title { height: 40px; }';
        dom.window.document.head.appendChild(fixtureStyle);
        dom.window.eval(fs.readFileSync(path.join(vendor, 'dist/js/jquery-1.11.3.min.js'), 'utf8'));
        dom.window.eval(fs.readFileSync(path.join(vendor, 'dist/js', filename), 'utf8'));
        const $ = dom.window.jQuery;
        assert.equal($.hisui.getHisuiStyle(), styleCode);
        assert.equal(dom.window.document.body.getAttribute('data-theme'), styleCode === 'vben' ? 'bgseablue' : '');
        assert.equal($.fn.tree.defaults.lines, false);
        assert.equal($.fn.tree.defaults.autoNodeHeight, false);
        const data = [{ id: 1, text: 'Synthetic folder', children: [{ id: 2, text: 'Synthetic leaf' }] }];
        $('#ordinaryTree').tree({ data, lines: false, autoNodeHeight: false });
        const folder = $('#ordinaryTree .tree-folder'), leaf = $('#ordinaryTree .tree-file');
        assert.equal(folder.length, 1); assert.equal(leaf.length, 1);
        assert.equal(folder.hasClass('tree-folder-open'), true);
        const rules = Array.from(style.sheet.cssRules);
        const folderCss = rules.filter(rule => rule.selectorText === '.tree-folder').map(rule => rule.style.cssText).join('\n');
        const lineCss = rules.filter(rule => rule.selectorText === '.tree-lines .tree-folder.tree-folder-open.tree-icon-lines').map(rule => rule.style.cssText).join('\n');
        if (styleCode === 'vben') {
          assert.match(folderCss, /var\(--tree-icons-img-url\)/);
          assert.match(lineCss, /var\(--tree-lines-img-url\)/);
          const bodyRule = rules.find(rule => rule.selectorText === 'body' && rule.style.getPropertyValue('--tree-icons-img-url'));
          assert.ok(bodyRule, 'native default sea-blue resource variables exist');
          assert.match(bodyRule.style.getPropertyValue('--tree-icons-img-url'), /tree_icons_seablue\.png/);
          assert.match(bodyRule.style.getPropertyValue('--tree-lines-img-url'), /tree_lines_seablue\.png/);
          assert.equal(bodyRule.style.getPropertyValue('--primary-color').trim(), '#3047A9');
        } else { assert.match(folderCss, /tree_icons/); assert.match(lineCss, /tree_lines/); }
        $('#ordinaryTree').tree('collapse', $('#ordinaryTree').tree('find', 1).target);
        assert.equal(folder.hasClass('tree-folder-open'), false);
        $('#ordinaryTree').tree('expand', $('#ordinaryTree').tree('find', 1).target);
        assert.equal(folder.hasClass('tree-folder-open'), true);
        const customData = [{ id: 1, text: 'Custom folder', iconCls: 'icon-search', children: [{ id: 2, text: 'Custom leaf', iconCls: 'icon-search' }] }];
        $('#ordinaryTree').tree({ data: customData, lines: true, autoNodeHeight: false });
        assert.equal($('#ordinaryTree .tree-icon-lines').length, 0);
        assert.equal($('#ordinaryTree .tree-icon.icon-search').length, 2);
        $('#linesTree').tree({ data: customData, lines: true, autoNodeHeight: true });
        await new Promise(resolve => dom.window.setTimeout(resolve, 0));
        const lineIcons = $('#linesTree .tree-icon');
        assert.equal($('#linesTree').hasClass('tree-lines'), true);
        assert.equal(lineIcons.length, 2);
        assert.equal(lineIcons.filter('.tree-icon-lines').length, 2);
        assert.equal(lineIcons.filter('.icon-search').length, 0, 'the native variable-height branch does not append iconCls');
        // Sprite references were checked above; jsdom does not resolve every theme CSS variable into pixels.
        $('#borderPanel').panel({ width: 240, height: 100, border: false });
        assert.equal($('#borderPanel').hasClass('panel-body-noborder'), true);
        $('#borderPanel').panel({ border: true });
        assert.equal($('#borderPanel').hasClass('panel-body-noborder'), false);
        assert.equal($('#borderPanel').css('borderTopWidth'), '1px');
        $('#borderGrid').datagrid({ width: 240, height: 100, border: true, columns: [[{ field: 'value', title: 'Value', width: 100 }]], data: [] });
        const gridBody = $('#borderGrid').datagrid('getPanel');
        assert.equal(gridBody.hasClass('panel-body'), true);
        assert.equal(gridBody.parent().hasClass('datagrid'), true);
        assert.notEqual(gridBody[0], gridBody.parent()[0]);
        assert.equal(gridBody.panel('options').border, true);
        assert.equal(gridBody.hasClass('panel-body-noborder'), false);
        $('#nativeLayout').layout();
        $('#nativeLayout').layout('resize', { width: 300 });
        assert.equal($('#nativeLayout').width(), 400, 'layout.resize ignores the panel-style second argument');
        $('#nativeLayout').width(300).layout('resize');
        assert.equal($('#nativeLayout').width(), 300);
        const fit = $('#fitChild')._fit(false);
        assert.equal(fit.width, $('#owner').width()); assert.equal(fit.height, $('#owner').height());
        assert.equal(fit.width, 400); assert.equal(fit.height, 180);
        $('#owner').css({ width: 300, height: 140 });
        const resized = $('#fitChild')._fit(false);
        assert.equal(resized.width, 300); assert.equal(resized.height, 140);
        // jsdom does not expand the sprite background shorthand; inspect the actual theme rule, leaving paint/scrollbars/corners to browser validation.
        await new Promise(resolve => dom.window.setTimeout(resolve, 30));
        assert.deepEqual(errors, []);
      } finally { dom.window.close(); }
    });
  }
}

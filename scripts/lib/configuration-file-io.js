'use strict';

const fs = require('node:fs');
const parser = require('../../vendor/jsonc-parser/main');

function readText(file) {
    return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(fs.readFileSync(file));
}

function parse(text) {
    const errors = [];
    const tree = parser.parseTree(text.replace(/^\uFEFF/, ''), errors);
    if (errors.length) throw new Error('Invalid JSONC at offset ' + errors[0].offset + ': ' + parser.printParseErrorCode(errors[0].error));
    if (tree?.type !== 'object') throw new Error('Expected a JSONC configuration object');
    function check(node) {
        if (node.type === 'object') {
            const keys = new Set();
            for (const property of node.children || []) {
                const key = property.children[0].value;
                if (keys.has(key)) throw new Error('Duplicate JSONC configuration key');
                keys.add(key);
            }
        }
        for (const child of node.children || []) check(child);
    }
    check(tree);
    return parser.getNodeValue(tree);
}

function edit(text, changes) {
    parse(text);
    const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
    let body = text.slice(bom.length);
    const indent = body.match(/(?:\r\n|\r|\n)([ \t]+)"/)?.[1] || '  ';
    const eol = body.match(/\r\n|\r|\n/)?.[0] || '\n';
    for (const {path, value} of changes) {
        if (value === undefined) {
            const tree = parser.parseTree(body);
            const node = parser.findNodeAtLocation(tree,path);
            const property = node?.parent;
            if (property?.type === 'property') {
                const siblings = property.parent.children;
                const index = siblings.indexOf(property);
                let start = property.offset;
                let end = start + property.length;
                const commaBefore = index > 0;
                if (siblings.length > 1) {
                    const from = commaBefore ? siblings[index-1].offset + siblings[index-1].length : end;
                    const to = commaBefore ? start : siblings[index+1].offset;
                    const scanner = parser.createScanner(body.slice(from,to),true);
                    if (scanner.scan() !== parser.SyntaxKind.CommaToken) throw Error('Missing JSONC member separator');
                    const comma = from + scanner.getTokenOffset();
                    body = body.slice(0,comma) + body.slice(comma + 1);
                    if (commaBefore) { start--; end--; }
                }
                body = body.slice(0,start) + body.slice(end);
                continue;
            }
        }
        const edits = parser.modify(body,path,value,{getInsertionIndex:()=>0});
        for (const change of edits) {
            // Format only newly inserted bytes. Formatting a whole source line can
            // rewrite an adjacent section owned by a different configuration domain.
            if (change.length === 0 && /^,?"(?:\\.|[^"\\])*": /.test(change.content)) {
                const comma = change.content.startsWith(',') ? ',' : '';
                const suffix = change.content.endsWith(',') ? ',' : '';
                const member = JSON.parse('{' + change.content.slice(comma.length, suffix ? -1 : undefined) + '}');
                const key = Object.keys(member)[0];
                const depth = path.length;
                const padded = indent.repeat(depth);
                change.content = comma + eol + padded + JSON.stringify(key) + ': ' +
                    JSON.stringify(member[key],null,indent).replace(/\n/g,eol + padded);
                if (suffix) change.content += suffix;
                else if (!comma) change.content += eol + indent.repeat(depth - 1);
            }
        }
        body = parser.applyEdits(body,edits);
    }
    parse(body);
    return bom + body;
}

function copyFileAccess(source, target) {
    if (process.platform !== 'win32') {
        fs.chmodSync(target, fs.statSync(source).mode & 0o7777);
        return;
    }
    const script = [
        "$ErrorActionPreference='Stop'",
        '[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)',
        '$paths=[Console]::In.ReadToEnd() | ConvertFrom-Json',
        '$section=[Security.AccessControl.AccessControlSections]::Access',
        '$original=[IO.File]::GetAccessControl($paths.source,$section)',
        '$replacement=[Security.AccessControl.FileSecurity]::new()',
        '$replacement.SetSecurityDescriptorSddlForm($original.GetSecurityDescriptorSddlForm($section),$section)',
        '[IO.File]::SetAccessControl($paths.target,$replacement)',
    ].join('\n');
    require('node:child_process').execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command',script], {
        input: Buffer.from(JSON.stringify({source, target}), 'utf8'),
        windowsHide: true, stdio: ['pipe','pipe','pipe'],
    });
}

module.exports = {readText, parse, edit, copyFileAccess};

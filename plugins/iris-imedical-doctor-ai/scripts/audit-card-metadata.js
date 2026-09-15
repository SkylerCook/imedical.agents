'use strict';
const fs = require('node:fs');

function readLiteral(source, start) {
    const quote = source[start]; let value = ''; let escaped = false; let i = start + 1;
    while (i < source.length) {
        const c = source[i++];
        if (c.charCodeAt(0) === 92) { escaped = true; i++; continue; }
        if (c === quote) return { end: i, value, escaped };
        if (quote === '`' && c === '$' && source[i] === '{') {
            i = skipExpression(source, i + 1);
        } else value += c;
    }
    throw new Error('Unclosed string');
}
function skipExpression(source, start) {
    let depth = 1; let i = start;
    while (i < source.length) {
        const c = source[i];
        if (c === '"' || c === "'" || c === '`') { i = readLiteral(source, i).end; continue; }
        if (source.startsWith('//', i)) { const end = source.indexOf('\n', i); if (end < 0) break; i = end; continue; }
        if (source.startsWith('/*', i)) { const end = source.indexOf('*/', i + 2); if (end < 0) break; i = end + 2; continue; }
        if (c === '/') throw new Error('Unsupported slash expression; inspect metadata manually');
        if (c === '{') depth++;
        if (c === '}' && --depth === 0) return i + 1;
        i++;
    }
    throw new Error('Unclosed template expression');
}

// Small lexical reader: never evaluate business scripts. Only accept simple literal fields.
function tokens(source) {
    const out = [];
    for (let i = 0; i < source.length;) {
        const c = source[i];
        if (/\s/.test(c)) { i++; continue; }
        if (source.startsWith('//', i)) { i = source.indexOf('\n', i); if (i < 0) break; continue; }
        if (source.startsWith('/*', i)) {
            const end = source.indexOf('*/', i + 2);
            if (end < 0) throw new Error('Unclosed comment');
            i = end + 2; continue;
        }
        if (c === '"' || c === "'" || c === '`') {
            const literal = readLiteral(source, i);
            out.push({ kind: c === '`' || literal.escaped ? 'opaque' : 'string', value: literal.value });
            i = literal.end;
            continue;
        }
        if (c === '/') throw new Error('Unsupported slash expression; inspect metadata manually');
        const word = /^[A-Za-z_$][\w$]*/.exec(source.slice(i));
        if (word) { out.push({ kind: 'word', value: word[0] }); i += word[0].length; }
        else { out.push({ kind: 'symbol', value: c }); i++; }
    }
    return out;
}

function inspect(source, file) {
    const ts = tokens(source); const fields = {};
    for (const field of ['ACTION_CODE', 'PERSIST']) {
        const values = [];
        for (let i = 0; i < ts.length - 4; i++) {
            if (ts[i].kind === 'word' && ts[i].value === 'static' &&
                ts[i + 1].kind === 'word' && ts[i + 1].value === field && ts[i + 2].value === '=') {
                values.push(ts[i + 3].kind === 'string' && ts[i + 4].value === ';' ? ts[i + 3].value : null);
            }
        }
        fields[field] = values.length === 1 ? values[0] : null;
    }
    return { file, ...fields };
}

function audit(entries) {
    const cards = []; const findings = []; const seen = new Map();
    for (const { file, source } of entries) {
        let card;
        try { card = inspect(source, file); }
        catch (error) { findings.push({ file, code: 'unparsed', message: error.message }); continue; }
        cards.push(card);
        if (!card.ACTION_CODE || !card.PERSIST) { findings.push({ file, code: 'incomplete' }); continue; }
        if (seen.has(card.ACTION_CODE)) {
            findings.push({ file, code: 'duplicate-action', other: seen.get(card.ACTION_CODE) });
        } else seen.set(card.ACTION_CODE, file);
    }
    if (!entries.length) findings.push({ code: 'incomplete' });
    const status = findings.some(f => f.code === 'duplicate-action') ? 'conflict'
        : findings.length ? 'incomplete' : 'checked';
    return { scope: 'literal-card-metadata-only', status, cards, findings };
}

if (require.main === module) {
    try {
        const files = process.argv.slice(2);
        if (files.length === 1 && files[0] === '--help') {
            console.log('node audit-card-metadata.js <card-file> [more-card-files]');
        } else {
            if (files.some(f => f.startsWith('--'))) throw new Error('Unknown option');
            const result = audit(files.map(file => ({ file, source: new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(file)) })));
            console.log(JSON.stringify(result, null, 2));
            process.exitCode = result.status === 'checked' ? 0 : result.status === 'conflict' ? 1 : 2;
        }
    } catch (error) { console.error(error.message); process.exitCode = 2; }
}
module.exports = { audit, inspect };

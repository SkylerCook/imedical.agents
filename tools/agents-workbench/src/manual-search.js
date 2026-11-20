'use strict';

const resultLimit = 24;
const queryLimit = 120;
const excerptLimit = 200;

function indexManual({ file, title, body }) {
    const lines = body.split(/\r\n|\n|\r/u);
    const rows = [];
    let fence;
    let section = null;
    let titleLine = 1;
    let foundTitle = false;
    for (const [index, original] of lines.entries()) {
        const text = original.trim();
        if (!text) continue;
        const marker = /^[ \t]*(`{3,}|~{3,})(.*)$/u.exec(original);
        const wasInFence = Boolean(fence);
        if (fence) {
            if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
        } else if (marker && (marker[1][0] !== '`' || !marker[2].includes('`'))) {
            fence = marker[1];
        }
        const heading = !wasInFence && !fence && /^(#{1,6})[ \t]+(.+)$/u.exec(original);
        if (heading) {
            const label = heading[2].replace(/[ \t]+#+[ \t]*$/u, '').trim();
            section = heading[1] === '#' && index < 3 ? null : label || null;
            if (!foundTitle && heading[1] === '#' && heading[2] === title) {
                titleLine = index + 1;
                foundTitle = true;
            }
        }
        rows.push({ text, folded: text.toLowerCase(), line: index + 1, section, heading: Boolean(heading) });
    }
    return { file, title, fileFolded: file.toLowerCase(), titleFolded: title.toLowerCase(), titleLine, rows };
}

function excerpt(text, position) {
    if (text.length <= excerptLimit) return text;
    const width = excerptLimit - 2;
    let start = Math.min(Math.max(position - 40, 0), text.length - width);
    let end = start + width;
    if (/[\uDC00-\uDFFF]/u.test(text[start])) start++;
    if (end < text.length && /[\uDC00-\uDFFF]/u.test(text[end])) end--;
    return (start ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

function createManualSearch(manuals) {
    const index = [...manuals.values()]
        .sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0)
        .map(indexManual);

    return function search(query) {
        if (typeof query !== 'string' || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(query)) throw new RangeError('invalid manual query');
        const text = query.trim();
        if (text.length > queryLimit) throw new RangeError('manual query too long');
        const term = text.toLowerCase();
        if (!term) return { matches: [], truncated: false };
        const ranked = [[], [], []];
        const preferred = [[], [], []];
        let count = 0;
        for (const manual of index) {
            const { file, title, titleLine, rows } = manual;
            const metadataMatch = manual.fileFolded.includes(term) || manual.titleFolded.includes(term);
            let bestRank = Infinity;
            let bestMatch;
            const add = (rank, line, section, text, position) => {
                count++;
                const keep = ranked[rank].length < resultLimit;
                if (!keep && rank >= bestRank) return;
                const match = { file, title, section, line, excerpt: excerpt(text, position) };
                if (keep) ranked[rank].push(match);
                if (rank < bestRank) {
                    bestMatch = match;
                    bestRank = rank;
                }
            };
            if (metadataMatch) {
                const row = rows.find(entry => entry.line === titleLine);
                add(0, titleLine, row?.section ?? null, row?.text || title, Math.max(row?.folded.indexOf(term) ?? 0, 0));
            }
            for (const row of rows) {
                if (metadataMatch && row.line === titleLine) continue;
                const position = row.folded.indexOf(term);
                if (position !== -1) add(row.heading ? 1 : 2, row.line, row.section, row.text, position);
            }
            if (bestMatch && preferred[bestRank].length < resultLimit) preferred[bestRank].push(bestMatch);
        }
        const leading = preferred.flat().slice(0, resultLimit);
        const selected = new Set(leading);
        const other = ranked.flat().filter(match => !selected.has(match)).slice(0, resultLimit - leading.length);
        return { matches: leading.concat(other), truncated: count > resultLimit };
    };
}

module.exports = { createManualSearch };

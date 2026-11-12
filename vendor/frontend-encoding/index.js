'use strict';
// Minimal iconv-lite 0.6.3 DBCS adapter. No package installation at runtime.
const Codec = require('./dbcs-codec')._dbcs;
const cache = new Map();
const strictTable = require('./gb2312.json');
const strictEncode = new Map(Object.entries(strictTable).map(([bytes, text]) => [text, Buffer.from(bytes, 'hex')]));
function codec(name) {
    if (!cache.has(name)) cache.set(name, new Codec({encodingName: name,
        table: () => require('./cp936.json').concat(require('./gbk-added.json')),
        ...(name === 'gb18030' ? {gb18030: () => require('./gb18030-ranges.json'), encodeSkipVals: [0x80], encodeAdd: {'€': 0xA2E3}} : {})
    }, {defaultCharUnicode: '\uFFFD', defaultCharSingleByte: '?'}));
    return cache.get(name);
}
function encode(text, name) {
    if (name === 'utf8') return Buffer.from(text, 'utf8');
    if (name === 'gb2312') return Buffer.concat(Array.from(text, char => char.codePointAt(0) < 128 ? Buffer.from(char) : strictEncode.get(char) || Buffer.from('?')));
    const encoder = new (codec(name).encoder)({}, codec(name));
    return Buffer.concat([encoder.write(text), encoder.end() || Buffer.alloc(0)]);
}
function decode(bytes, name) {
    if (name === 'utf8') return new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);
    if (name === 'gb2312') {
        let text = '';
        for (let i = 0; i < bytes.length; i++) {
            if (bytes[i] < 128) text += String.fromCharCode(bytes[i]);
            else { text += strictTable[bytes.subarray(i, i + 2).toString('hex')] || '\uFFFD'; i++; }
        }
        return text;
    }
    const decoder = new (codec(name).decoder)({}, codec(name));
    return decoder.write(bytes) + (decoder.end() || '');
}
module.exports = {encode, decode};

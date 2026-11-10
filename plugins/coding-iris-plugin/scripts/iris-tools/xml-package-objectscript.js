'use strict';

// The class is the only ObjectScript source. The execute adapter embeds exactly
// its marked body, so fixes to task ownership, reads and cleanup cannot drift.
const fs = require('node:fs');
const path = require('node:path');
const SOURCE = path.resolve(__dirname, '../../templates/DHCDoc/Util/XmlPackage.cls');
const MARKER = 'IRIS_XML_RESULT:';
function body() {
    const source = fs.readFileSync(SOURCE, 'utf8').replace(/\r\n/g, '\n');
    const start = source.indexOf('    // BEGIN IRIS XML SHARED DISPATCH\n');
    const end = source.indexOf('    // END IRIS XML SHARED DISPATCH');
    if (start < 0 || end <= start || source.indexOf('    // BEGIN IRIS XML SHARED DISPATCH\n', start + 1) >= 0) throw Error('xml-shared-dispatch-source-invalid');
    return source.slice(start + '    // BEGIN IRIS XML SHARED DISPATCH\n'.length, end);
}
function encode(request) {
    const encoded = Buffer.from(JSON.stringify(request)).toString('base64');
    if (encoded.length > 1024 * 1024) throw Error('xml-request-too-large');
    return encoded;
}
function executeCode(request) {
    return `set payload="${encode(request)}"\n${body()}\nwrite !,"${MARKER}",result.%ToJSON(),!`;
}
function terminalCode(request) {
    // WS v1.5 sends each input line separately. The documented XECUTE private
    // block compiles the trusted canonical body as one line. User data remains
    // a Base64 JSON argument and never becomes executable source.
    const lines=body().split('\n').filter(line=>!line.trim().startsWith('//')).map(line=>line.trim()).filter(Boolean);
    for(const line of lines){
        let quoted=false;
        for(let index=0;index<line.length;index++){
            if(line[index]==='"'){if(quoted&&line[index+1]==='"'){index++;continue;}quoted=!quoted;}
            if(!quoted && line[index]==='/' && ['/', '*'].includes(line[index+1]))throw Error('xml-terminal-inline-comment-unsupported');
        }
        if(quoted)throw Error('xml-terminal-multiline-string-unsupported');
    }
    const program='(payload,result) { '+lines.join(' ')+' }';
    const code=`set payload="${encode(request)}"\nxecute ("${program.replace(/"/g,'""')}",payload,.result)\nwrite !,"${MARKER}",result.%ToJSON(),!`;
    if(Buffer.byteLength(code,'utf8')>32768)throw Error('xml-terminal-command-too-large-use-class');
    return code;
}
function classQuery(request) {
    return `SELECT DHCDoc_Util.XmlPackage_Dispatch('${encode(request)}') AS value`;
}
function parseExecuteOutput(value) {
    // MCP owns its response envelope. Only the explicit framed stdout is data;
    // Export and compiler diagnostics may surround it and are never evaluated.
    const output = typeof value === 'string' ? value : value?.output ?? value?.result?.output ?? value?.stdout;
    if (typeof output !== 'string') throw Error('xml-execute-output-invalid');
    const frames = output.split(/\r?\n/).filter(line => line.startsWith(MARKER));
    if (frames.length !== 1) throw Error('xml-execute-frame-invalid');
    return JSON.parse(frames[0].slice(MARKER.length));
}
module.exports = {SOURCE, MARKER, body, encode, executeCode, terminalCode, classQuery, parseExecuteOutput};

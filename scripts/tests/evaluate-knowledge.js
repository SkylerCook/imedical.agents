'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const rag = require('../lib/knowledge-retrieval');
const { loadDocuments } = require('../lib/knowledge-sources');
const questions = require('./fixtures/knowledge-questions.json');
const { resolveContext } = require('../knowledge-query');

async function main() {
    const root = path.resolve(__dirname, '../..');
    const context = resolveContext(root);
    const documents = loadDocuments(context);
    const rows = [];
    for (const question of questions) {
        const domain = question.group === 'business' ? 'business' : 'ui';
        // UI previously uses manual reference routing; this is a literal-text baseline only.
        const literal = documents.filter(document => document.domain === domain && document.content.toLowerCase().includes(question.query.toLowerCase())).slice(0,6);
        const started = performance.now();
        const result = await rag.search(context, question.query, {domain,provider:process.argv.includes('--provider')?process.argv[process.argv.indexOf('--provider')+1]:undefined,localOnly:!process.argv.includes('--semantic'),queryPublic:process.argv.includes('--semantic')});
        const hits = result.matches.filter(item => item.path.endsWith(question.expected));
        rows.push({ ...question, literalHit:literal.some(item=>item.path.endsWith(question.expected)),
            hit:hits.length>0, conditionPresent:hits.some(item=>(item.heading+'\n'+item.documentContext+'\n'+item.text).toLowerCase().includes(question.condition.toLowerCase())),
            mode:result.mode, milliseconds:Math.round(performance.now()-started), characters:JSON.stringify(result).length,
            embeddingTokens:result.embeddingTokens, topPaths:result.matches.map(item=>item.path),warnings:result.warnings });
    }
    const report = {cases:rows.length,literalHits:rows.filter(row=>row.literalHit).length,hits:rows.filter(row=>row.hit).length,
        conditionsPresent:rows.filter(row=>row.conditionPresent).length,semanticCases:rows.filter(row=>row.mode==='hybrid').length,
        taskTokens:null,answerCorrectness:null,limitations:['Condition presence is not answer correctness.','Full task token comparison requires the same model and prompts.'],rows};
    console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});

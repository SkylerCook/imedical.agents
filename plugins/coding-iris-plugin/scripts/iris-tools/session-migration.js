#!/usr/bin/env node
'use strict';
const {migrate}=require('../../../../scripts/lib/iris-session-migration');
const args=process.argv.slice(2),options={};
try {
  for(let i=0;i<args.length;i+=2) {
    const key={'--project-root':'projectRoot','--mode':'mode','--server-name':'serverName'}[args[i]];
    if(!key || !args[i+1])throw new Error('session-migration-arguments-invalid');options[key]=args[i+1];
  }
  const result=migrate(options);
  console.log(JSON.stringify([{status:result.status==='applied'?'config-migration-applied':result.status==='planned'?'config-migration-planned':'config-migration-unchanged',target:'.mcp.json',reason:JSON.stringify(result)}]));
}catch(error){console.log(JSON.stringify([{status:'config-migration-review-required',target:'.mcp.json',reason:error.code || 'session-migration-failed'}]));if(['Check','Rollback'].includes(options.mode))process.exitCode=1;}

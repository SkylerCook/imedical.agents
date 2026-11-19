#!/usr/bin/env node
'use strict';
const {resolveWorkspaceContext}=require('./lib/workspace-context');
const settings=require('./lib/project-plugin-settings');
const [mode,id,root,...args]=process.argv.slice(2);
try {
  if (!['Canonical','Read','DryRun','Write','Init','Rollback'].includes(mode) || !root || args.length%2) throw Error('Usage: plugin-settings.js Read|DryRun|Write|Init|Rollback <plugin> <project-root> [key value ...]');
  if (args.length && (mode!=='Write' || id==='coding-iris-plugin')) throw Error('Use Write for plugin settings; use frontend-encoding-cli.js confirm for encoding changes');
  const context=resolveWorkspaceContext(require('node:path').resolve(root));
  if (context.mode==='invalid') throw Error('Invalid workspace context');
  if (mode==='Canonical') {
    const state=settings.inspect(context,id);
    const encodingKeys=['frontendMode','sourceEncoding','serverEncoding','serverEncodingConfirmation','serverEncodingTarget'];
    console.log(JSON.stringify(encodingKeys.some(key=>Object.hasOwn(state.canonical||{},key))));
    return;
  }
  console.log(JSON.stringify(settings.apply(context,id,mode,Object.fromEntries(Array.from({length:args.length/2},(_,i)=>args.slice(2*i,2*i+2))))));
} catch (error) { console.error(error.message);process.exitCode=1; }

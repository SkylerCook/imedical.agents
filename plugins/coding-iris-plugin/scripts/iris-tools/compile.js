#!/usr/bin/env node
'use strict';
// Backend and frontend share direct development deployment and opt-in Git protection.
// Use compile-csp.js only for already-uploaded CSP compilation.
if(process.argv.includes('--help')){
 console.log('Usage: node compile.js --project-root <workspace> --files <project-relative.cls|mac|inc...> [--execute] [--mode direct|guarded] [--demand <id>] [--decision <json>]\nDefault: direct development deployment, no Git session. --demand without --mode preserves guarded compatibility and requires deploy-guard.js initialization. Without --execute: local plan only.');
}else{
 require('./deploy-protected').main('backend',process.argv.slice(2));
}

#!/usr/bin/env node
'use strict';
// Source upload always enters the same Git/Server protection as frontend deployment.
// Use compile-csp.js only for already-uploaded CSP compilation.
if(process.argv.includes('--help')){
 console.log('Usage: node compile.js --project-root <workspace> --demand <id> --files <project-relative.cls|mac|inc...> [--execute] [--decision <json>]\nInitialize deploy-guard.js first. Legacy positional upload is intentionally blocked.');
}else{
 require('./deploy-protected').main('backend',process.argv.slice(2));
}

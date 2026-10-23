#!/usr/bin/env node
'use strict';
// Backend and frontend share direct development deployment and opt-in Git protection.
// Use compile-csp.js only for already-uploaded CSP compilation.
if(process.argv.includes('--help')){
 console.log('--kind standard|project: explicit task type overrides the project default. Only confirmed project + on-demand mode requires a source plan; License admission remains shared.');
 console.log('Usage: node compile.js --project-root <workspace> --files <project-relative.cls|mac|inc...> [--execute] [--mode direct|guarded] [--demand <id>] [--decision <json>] [--source-plan <reviewed-plan.json>] [--publication-decision <publish-receipt.json>] [--run-directory <run> --work-item <id> --environment-alias <alias>]\nWithout --execute: local plan only. On-demand project mode requires a reviewed source plan and local Git commit; production additionally requires the exact publication receipt. Other projects retain direct/guarded compatibility. Bound night execution requires work identity and preflight.');
}else{
 require('./deploy-protected').main('backend',process.argv.slice(2));
}

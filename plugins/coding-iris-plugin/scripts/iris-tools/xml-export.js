#!/usr/bin/env node
'use strict';
const core=require('./xml-export-core');
const HELP=`IRIS XML export (no QTZ dependency; no import operation)
  xml-export.js plan --project-root <root> --manifest <typed-items.json> --namespace <NS> --channel class|execute --server-root <absolute-private-root> [--web-application </virtual/app>] [--format iris|cache] [--split --layout flat|tree] [--name <merged.xml>] [--out <delivery-dir>]
  xml-export.js preflight|inspect|download|verify|status --plan <plan.json>
  xml-export.js export --plan <plan.json> --confirm-export
  xml-export.js cleanup --plan <plan.json> [--confirm-discard]
  xml-export.js recover-lock --plan <plan.json> --confirm-recovery --lock-token <status.localLock.token>
plan is offline and creates only the private local plan. The manifest contains items [{name,type}].
class uses the explicitly deployed DHCDoc.Util.XmlPackage. execute defaults to --executor terminal, using one managed MCP process for iris_ws_open/exec/close (IRIS 2023.2+/Atelier v7+, target qualification required).
Terminal input uses the trusted canonical XECUTE private block; the 32KiB UTF-8 command bound is checked offline. Larger scopes must use class. Real target syntax and resource release require integration validation.
Optional --executor mcp uses HTTP iris_execute; vendor v1.5.0 can retry internally up to 3 attempts. It is refused unless policy qualification.channels.mcp.acceptInternalRetries=true; it is never an automatic fallback.
No class is automatically deployed. WS close acknowledgement and MCP process exit are recorded; neither proves License release.
export submits once; after an unknown result use inspect, never replay export or switch channel.
If the public owner is blocked/circuit-open, inspect also stops. Use the existing iris-remote status/reconcile evidence workflow first, then inspect the original task; local recover-lock does not clear the public owner.
download uses bounded Base64 stream chunks, without requiring an HTTP download mapping. verify publishes only a complete checked package.
cleanup deletes only owned server task artifacts. Unverified local packages require explicit --confirm-discard.
Server roots, connection facts and task state belong only to the target project. --help performs no configuration or server access.`;
function args(argv){const options={command:argv[0],projectRoot:process.cwd()};
    const flags=new Set(['split','confirm-export','confirm-discard','confirm-recovery']);
    const values=new Set(['project-root','manifest','namespace','channel','server-root','web-application','format','out','plan','executor','layout','name','lock-token']);
    for(let i=1;i<argv.length;i++){const key=argv[i].replace(/^--/,'');if(!argv[i].startsWith('--'))throw Error('xml-option-invalid');
        const name=key.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());if(flags.has(key)){options[name]=true;continue;}
        if(!values.has(key)||!argv[i+1]||argv[i+1].startsWith('--'))throw Error('xml-option-invalid');options[name]=argv[++i];}
    return options;}
async function main(argv){if(!argv.length||argv.includes('--help')||argv.includes('-h')){console.log(HELP);return;}
    const input=args(argv);let result;
    if(input.command==='plan')result=core.createPlan(input);
    else{if(!input.plan)throw Error('xml-plan-required');switch(input.command){
        case 'preflight':result=await core.preflight(input.plan);break;case 'export':result=await core.exportPlan(input.plan,input);break;
        case 'inspect':result=await core.inspect(input.plan);break;case 'download':result=await core.download(input.plan);break;
        case 'verify':result=core.verify(input.plan);break;case 'cleanup':result=await core.cleanup(input.plan,input);break;
        case 'recover-lock':result=core.recoverLock(input.plan,input);break;
        case 'status':result=core.status(input.plan);break;default:throw Error('xml-command-invalid');}}
    console.log(JSON.stringify(result));if(['export-failed','export-outcome-unknown','cleanup-unknown'].includes(result.state))process.exitCode=2;}
if(require.main===module)main(process.argv.slice(2)).catch(error=>{const reason=/^[a-z0-9-]+$/.test(error.code||error.message)?error.code||error.message:'xml-operation-failed-or-unknown';
    console.error(JSON.stringify({schema:core.SCHEMA,status:'blocked',reason,
        ...(/remote-pool-(?:reconciliation|required|busy)|circuit-open/.test(reason)?{recovery:'Use iris-remote status/reconcile with verified server-task and resource evidence before XML inspect; no replay or automatic unlock.'}:{})}));process.exitCode=1;});
module.exports={args,main,HELP};

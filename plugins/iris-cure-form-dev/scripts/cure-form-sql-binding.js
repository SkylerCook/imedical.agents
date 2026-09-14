'use strict';
// Fixed SQL compatibility transport: bind all arguments, enforce one row in a transaction.
function buildBoundUpdate(parameters) {
 const {UPDATE}=require('./cure-form-sql-cover');
 if(!Array.isArray(parameters)||parameters.length!==13||parameters.some(p=>typeof p!=='string'))throw Error('Expected thirteen string parameters.');
 if(!/^\d+$/.test(parameters[1])||!['CA','CR'].includes(parameters[2])||parameters[2]!==parameters[7]||!/^\d+$/.test(parameters[6]))throw Error('Invalid fixed SQL identity.');
 if(parameters[3]!==parameters[4]||parameters[9]!==parameters[10]||parameters[11]!==parameters[12]||parameters[5]!=='%||'+parameters[1]+'||%')throw Error('Invalid fixed SQL baseline.');
 if(Buffer.byteLength(JSON.stringify(parameters))>1000000)throw Error('SQL payload exceeds bounded size.');
 const encoded=Buffer.from(JSON.stringify(parameters),'utf8').toString('base64');
 const quote=s=>'"'+s.replace(/"/g,'""')+'"';
 const count='SELECT COUNT(*) FROM SQLUser.DHC_DocAppBLTemple'+UPDATE.slice(UPDATE.indexOf(' WHERE '));
 const bound=Array.from({length:13},(_,i)=>'p.%Get('+i+')');
 return [
  'set payload=""',...(encoded.match(/.{1,1024}/g)||[]).map(c=>'set payload=payload_'+quote(c)),
  'set result={"success":false,"rows_affected":0,"rows_check_skipped":false}',
  'try {',
  'set p=##class(%DynamicArray).%FromJSON($zconvert(##class(%SYSTEM.Encryption).Base64Decode(payload),"I","UTF8"))',
  'set counter=##class(%SQL.Statement).%New(), updater=##class(%SQL.Statement).%New()',
  'set cs=counter.%Prepare('+quote(count)+'), us=updater.%Prepare('+quote(UPDATE)+')',
  'if $$$ISERR(cs) { do result.%Set("error_code","ROWS_CHECK_FAILED") set result.error=$system.Status.GetErrorText(cs) }',
  'elseif $$$ISERR(us) { do result.%Set("error_code","SQL_PREPARE_FAILED") set result.error=$system.Status.GetErrorText(us) }',
  'else {',
  'tstart',
  'set cr=counter.%Execute('+bound.slice(1).join(',')+')',
  'if cr.%SQLCODE<0 { do result.%Set("error_code","ROWS_CHECK_FAILED") set result.error=cr.%Message }',
  'elseif cr.%Next() {',
  'set result.precheckRows=cr.%GetData(1)',
  'if result.precheckRows=1 {',
  'set wr=updater.%Execute('+bound.join(',')+')',
  'if wr.%SQLCODE<0 { do result.%Set("error_code","SQL_ERROR") set result.error=wr.%Message }',
  'elseif wr.%ROWCOUNT=1 { set result={"success":true,"rows_affected":1,"precheck_rows":1,"rows_check_skipped":false} }',
  'else { do result.%Set("error_code","ROWS_LIMIT_OR_CONFLICT"),result.%Set("rows_affected",wr.%ROWCOUNT) }',
  '} else { do result.%Set("error_code","ROWS_LIMIT_OR_CONFLICT") }',
  '} else { do result.%Set("error_code","ROWS_CHECK_FAILED") }',
  'if result.success { tcommit } else { trollback }',
  '}',
  '} catch ex { if $tlevel>0 { trollback } do result.%Set("error_code","SQL_BINDING_ERROR") set result.error=ex.DisplayString() }',
  'write "CURE_SQL_RESULT:",$translate(##class(%SYSTEM.Encryption).Base64Encode($zconvert(result.%ToJSON(),"O","UTF8")),$char(10,13),""),":CURE_SQL_END",!'
 ].join('\n');
}
async function executeBoundUpdate(client,namespace,parameters) {
 const response=await client.request('tools/call',{name:'iris_execute',arguments:{namespace,code:buildBoundUpdate(parameters),translate_sql:false,timeout:30}},35000);
 if(response.error||response.result?.isError){const e=Error('Fixed SQL MCP execution failed; no automatic retry.');e.privateResponse=response;throw e;}
 const texts=(response.result?.content||[]).filter(c=>c.type==='text').map(c=>c.text);
 const candidates=[response.result?.structuredContent,...texts.map(t=>{try{return JSON.parse(t);}catch{return t;}})];
 let frame;
 const visit=v=>{if(typeof v==='string'){const m=/CURE_SQL_RESULT:([A-Za-z0-9+/=\r\n]+):CURE_SQL_END/.exec(v);if(m)frame=m[1];}else if(v&&typeof v==='object')Object.values(v).forEach(visit);};
 candidates.forEach(visit);
 if(!frame){const e=Error('Fixed SQL acknowledgment missing; no automatic retry.');e.privateResponse=response;throw e;}
 const value=JSON.parse(Buffer.from(frame.replace(/[\r\n]/g,''),'base64').toString('utf8'));
 if(value.rows_check_skipped!==false)throw Error('Fixed SQL row guard was not confirmed.');
 if(value.success!==true)throw Error('Fixed SQL rolled back: '+(value.error_code||'UNKNOWN')+' '+(value.error||''));
 return value;
}
module.exports={buildBoundUpdate,executeBoundUpdate};

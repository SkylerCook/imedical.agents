// PROTOTYPE: browser-only fixtures. Never runs framework commands.
export const projects={clinic:{name:'临床协同工程',kind:'独立工程',path:'demo/clinic'},fresh:{name:'门诊服务工程',kind:'首次接入',path:'demo/outpatient'},root:{name:'医疗研发工作区',kind:'共享工作区',path:'demo/medical'},dental:{name:'口腔业务模块',kind:'Overlay 模块',path:'demo/medical/dental',parent:'root'},nursing:{name:'护理业务模块',kind:'Overlay 模块',path:'demo/medical/nursing',parent:'root'}};
const KEY='agents-ui-prototype-v1';
export const libraryLabels = { a: '开发库 A', b: '开发库 B' };
const demoConnections = (first = { host: 'demo.invalid', port: 52773, secret: true }) => ({
  a: first,
  b: { host: 'dev-b.invalid', port: 52774, secret: true }
});
const seed=id=>({name:'',installed:id!=='fresh',environment:id!=='fresh',wizard:0,client:'Codex',mode:'connected',activeLibrary:'a',connections:demoConnections(),plugins:{iris:id!=='fresh',bos:false,ui:false},clients:{Codex:'入口已生成'},tasks:[],vector:0,updated:false,legacy:false,custom:false,conflict:false});
let data;try{data=JSON.parse(localStorage.getItem(KEY))||{}}catch{data={}}
export function state(id) {
  const project = data[id] || (data[id] = seed(id));
  if (!project.connections) {
    project.connections = demoConnections(project.connection);
    project.activeLibrary = 'a';
    delete project.connection;
  }
  return project;
}
export const connectionFor = (project, library = project.activeLibrary) => project.connections[library];
export const save=()=>localStorage.setItem(KEY,JSON.stringify(data));
export function reset(){data={};save()}
export function task(id,title,type='工具执行',status='待执行'){const t={id:crypto.randomUUID(),title,type,status,steps:['准备上下文','执行操作','读回验证'],answer:'',returned:false,plugin:state(id).pendingPlugin||'iris'};state(id).tasks.unshift(t);save();return t}
export function prompt(id,t){const p=projects[id],skill={iris:'coding-iris-plugin/skills/coding-iris-init',bos:'bos-plugin/skills/bos-init',ui:'imedical-ui/skills/imedical-ui-init'}[t.plugin||'iris'];return `请在 ${p.path}（${state(id).name||p.name}）继续任务：${t.title}。\n已有结果：工程身份已确认，模拟配置已准备。\n待完成：读取目标工程 AGENTS.md，通过 ${p.parent?'CapabilityRoot':'.agents'}/${t.entry||('plugins/'+skill+'/SKILL.md')} 核对工程事实与必要配置。\n能力根：${p.parent?'共享工作区的 CapabilityRoot，以 capability.json 解析为准':'当前工程 .agents'}。\n请保留已有配置，仅处理本任务；不要提交、推送或访问远端服务。凭据只从获准本机来源读取，不回传。\n完成后说明实际修改、验证结果和剩余事项，返回工作台重新检查。\n任务标识：${t.id}\n【UI 原型演示材料，路径与数据均为虚构】`}

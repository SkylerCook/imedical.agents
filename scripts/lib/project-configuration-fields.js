'use strict';

const text = (label, description, extra = {}) => ({type:'string', label, description, ...extra});
const toggle = (label, description, extra = {}) => ({type:'boolean', label, description, ...extra});
const number = (label, description, extra = {}) => ({type:'number', label, description, ...extra});
const group = (label, description, properties) => ({type:'object', label, description, properties});
const list = (label, description, items) => ({type:'array', label, description, items});
const record = (label, description, entries) => ({type:'object', label, description, entries});
const generated = {readOnly:true};
const credential = text('凭据来源', '使用现有私有配置中的凭据引用。', generated);
const relative = text('项目相对路径', '以当前工程为基准的路径，使用正斜杠。');
const publicConnection = {
  host:text('主机', '此档案对应的开发库主机。'),
  port:number('Web 端口', 'IRIS Web 服务端口。', {integer:true,min:1,max:65535}),
  scheme:text('协议', 'IRIS Web 协议。', {options:['https','http']}),
  namespace:text('命名空间', '要访问的开发命名空间。'),
  alias:text('连接名称', '宿主中所用的服务器别名。'),
  description:text('连接说明', '用于区分不同开发库的说明。'),
  tlsVerify:toggle('验证 TLS 证书', '校验目标 HTTPS 服务的证书。'),
  credentialRef:credential,
    pathPrefix:text('IRIS 应用前缀', '此档案的 IRIS 应用路径前缀。'),
    webBasePath:text('旧 Web 根路径', '缺少独立 Web 路径时用于兼容已有档案。'),
};
const evidence = group('既有核验证据', '原核验流程生成的记录。', {
  status:text('状态', '上次核验状态。', generated),
  reference:text('证据文件', '本机证据文件引用。', generated),
  sha256:text('证据摘要', '已核验证据的 SHA-256。', generated),
});
const menu = group('菜单来源', '由菜单登记入口核验来源后创建。', {
  schema:text('规则版本', '菜单刷新器使用的数据契约。', generated),
  sourceId:text('来源标识', '登记菜单时使用的标识。', generated),
  targetFingerprint:text('连接目标摘要', '核验菜单来源与当前连接是否一致。', generated),
  methodSourceHash:text('方法摘要', '登记时审核通过的读取方法摘要。', generated),
  allowMenuRead:toggle('允许读取菜单', '设为关闭时暂停该来源的菜单刷新。'),
  groupFilter:text('用户组范围', '当前刷新器使用启用的用户组。', generated),
  maxRemovalRatio:number('减少比例上限', '超过上限须人工核对，允许 0 以上至 0.5。', {minExclusive:0,max:0.5}),
});

const sections = {
  projectContext:group('工程上下文', '描述当前工程的源码覆盖和 Agent 工作方式。', {
    contextMode:text('上下文模式','完整源码或按需导出的项目上下文范围。', {options:['codebase-complete','intent-first-on-demand-export']}),
    guidanceMode:text('Agent 辅助程度','默认 auto，可选 concise 或 assisted。', {options:['auto','concise','assisted']}),
    skillDirectories:list('技能目录','已明确授权生成技能入口的项目相对目录。', relative),
  }),
  documentationLayout:group('文档目录', '文档目录治理开关及当前工程扩展目录。', {
    schema:text('规则版本','目录治理使用的数据契约。', generated),
    enabled:toggle('启用文档目录治理','接入后按插件和扩展目录声明生成目录导航。'),
    extensions:list('扩展目录','当前工程在 docs 下自有的目录声明。', group('目录','说明项目自有目录的用途。',{
      path:relative,
      purpose:text('用途','目录应存放的资料。'),
      boundary:text('归档边界','相近资料之间的归属规则。'),
      lifecycle:text('维护周期','何时维护或归档此目录。'),
      examples:list('示例','资料类型或文件示例。', text('示例','示例名称。')),
    })),
  }),
  plugins:record('插件状态', '按插件 ID 记录启用状态和初始化入口。', group('插件', '使用插件管理入口启用或禁用。', {
    status:text('启用状态','由插件管理入口写入。', generated),
    initSkill:text('初始化技能','插件对应的初始化入口。', generated),
  })),
  deployment:group('插件部署策略','控制缺失能力的补装。',{
    autoInstall:toggle('允许自动补装','允许原更新器按依赖补装插件。'),
    schemaVersion:number('规则版本','部署策略使用的数据契约。', generated),
  }),
  pluginSettings:record('插件参数', '各插件在同一工程内使用的运行参数。', group('插件运行参数', '当前插件维护的运行参数。', {})),
  irisDevelopment:group('IRIS 开发环境','当前工程的开发方式及发布路由。',{
    developmentMode:text('开发模式','connected 连接开发库，offline 使用本地源码和离线交付。',{options:['connected','offline']}),
    environmentAlias:text('环境别名','按源码同步和发布时的环境声明填写。'),
    environmentType:text('环境类型','选择实际环境类型。',{options:['test','development','production']}),
  }),
  irisConnections:group('开发库档案','选择档案后同步本工程已绑定的客户端。',{
    active:text('当前档案','切换后同步框架及已登记的客户端。'),
    profiles:record('连接档案','各档案使用独立连接及凭据引用。',group('开发库','一个开发库的连接目标和凭据引用。',publicConnection)),
    bindings:group('同步入口','已登记由开发库档案同步的客户端。',{
      central:toggle('框架连接','由当前工作区档案提供框架连接。',generated),
      vscode:toggle('VS Code','同步 ObjectScript 连接。',generated),
      mcp:toggle('MCP','同步本工程 IRIS MCP 服务。',generated),
      toml:toggle('IRIS TOML','同步原生工具的 TOML 文件。',generated),
    }),
    serverName:text('IRIS MCP 服务名','工程的 IRIS MCP 注册名称。',generated),
    source:text('框架连接来源','项目 JSONC 接管后记录配置来源。',generated),
    inheritServices:toggle('沿用共享服务配置','模块独立维护 IRIS 档案时，未单独配置的 Web 和 SFTP 继续使用共享来源。',generated),
  }),
  irisRemotePolicy:group('IRIS 远程策略','受管远端操作的连接与协调策略。',{
    schema:text('规则版本','远程操作策略使用的数据契约。',generated),
    enabled:toggle('启用远程策略','启用后由框架统一协调远程操作。'),
    maxFrameworkSessions:number('受管会话上限','普通会话的本机上限，缺省 12。',{integer:true,min:1}),
    coordinationRoot:text('协调状态目录','本机用于保存远端协调状态的目录。',generated),
    poolKey:text('会话池标识','与当前受管目标匹配的会话池标识。',generated),
    maxConcurrent:number('并发操作上限','当前序列化策略要求值为 1。',generated),
    allowSharedPool:toggle('共享会话池','多个连接仅在当前策略明确允许时共享状态。',generated),
    qualification:evidence,
    readBatch:group('读取批次','既有批次策略及核验证据。',{
      sessions:number('会话数','旧读取批次的会话设置。',generated),
      intervalMs:number('间隔（毫秒）','旧读取批次的间隔设置。',generated),
      qualification:evidence,
    }),
  }),
  irisSessionBackend:group('IRIS 会话后端','受管 MCP 迁移和连接切换时同步生成。',{
    schema:text('规则版本','受管 MCP 后端的数据契约。',generated),
    serverName:text('服务名','绑定的 IRIS MCP 服务。',generated),
    command:text('后端命令','已核验的用户工具入口。',generated),
    args:list('后端参数','由连接和运行时所有者生成。',text('参数','运行时参数。',generated)),
    originalArgsPresent:toggle('原配置含参数','用于恢复原客户端入口。',generated),
    managedHash:text('绑定摘要','核对客户端入口是否还是对应的受管版本。',generated),
  }),
  serviceConnections:group('Web 与 SFTP','当前工程的 Web 路径和文件连接。',{
    web:group('Web','框架访问 Web、CSP 和 Broker 时使用的路径。',{
      basePath:text('Web 根路径','用于读取或部署 Web 项目的应用路径。'),
      cspBasePath:text('CSP 根路径','CSP 应用的路径前缀。'),
      frontendTransport:text('前端部署通道','可选择 Atelier 或 SFTP，省略时使用 SFTP。',{options:['atelier','sftp']}),
      brokerPath:text('Broker 路径','Broker 的相对路径。'),
      credentialRef:credential,
    }),
    sftp:group('SFTP','工程的独立文件连接及目录。',{
      enabled:toggle('启用 SFTP','控制工程使用已登记文件连接。'),
      host:publicConnection.host,port:publicConnection.port,
      localPath:text('本地目录','同步的项目本地目录。'),
      remotePath:text('远端目录','SFTP 服务端目标目录。'),
      serverName:text('MCP 服务名','此连接绑定的 SFTP MCP 服务。',generated),
      runtime:text('文件传输运行时','使用已随包的运行时或明确配置的自定义入口。',generated),
      command:text('启动程序','已登记的 SFTP 服务解释器。',generated),
      scriptPath:text('启动脚本','已登记的 SFTP 服务脚本。',generated),
      args:list('启动参数','已登记的 SFTP 运行参数。',text('参数','SFTP 的启动参数。',generated)),
      keyFile:text('密钥路径','已登记的本机密钥文件引用。',generated),
      knownHosts:text('主机校验文件','SSH known_hosts 的位置。',generated),
      allowRemoteCommands:toggle('远程命令权限','原工具审核后记录的 SFTP 扩展权限。',generated),
      ignorePatterns:list('同步忽略规则','同步时跳过的路径模式。',text('规则','忽略规则。',generated)),
      credentialRef:credential,
    }),
  }),
  mcp:group('MCP 配置','工程框架拥有的 MCP 服务声明。',{
    serverName:text('IRIS 服务名','本工程 MCP 中的 IRIS 服务标识。',generated),
    serverPath:text('IRIS 程序路径','实际使用的 IRIS MCP 运行程序。',generated),
    nodeTlsRejectUnauthorized:text('Node TLS 校验','当前 IRIS MCP 进程的 TLS 校验选项。',generated),
    includeBuiltInSkills:toggle('载入内置 Skill','原生 IRIS MCP 启动时是否载入内置 Skill。',generated),
  }),
};

const pluginDescriptions = {
  frontendMode:text('前端编码模式','按工程前端实际编码模式和后端限定范围选择。',{readOnly:true}),
  frontendRoot:text('前端源码根目录','编码确认后，导出、部署与提升工具使用的项目目录。',generated),
  sourceEncoding:text('前端源码编码','本地源码编码，沿编码确认入口维护。',generated),
  serverEncoding:text('前端目标编码','目标库前端编码，沿编码确认入口维护。',generated),
  serverEncodingConfirmation:text('编码确认状态','由原编码确认入口生成。',generated),
  serverEncodingTarget:text('编码确认目标','须与当前开发库一致。',generated),
  defaultDemandKind:text('默认需求类型','standard 为标版需求，project 为项目需求。',{options:['standard','project']}),
  WorkRoot:text('工作目录','表单预览和交付工作目录，auto 按项目目录声明推导。'),
  PreviewVendorRoot:text('预览资源根目录','表单预览使用的 HISUI 资源根。'),
  PreviewHisuiCss:text('HISUI CSS','表单预览样式。'),
  PreviewJqueryJs:text('jQuery 脚本','表单预览使用的 jQuery 脚本。'),
  PreviewHisuiJs:text('HISUI 脚本','表单预览使用的 HISUI 主脚本。'),
  PreviewHisuiLocaleJs:text('HISUI 语言脚本','表单预览使用的本地化脚本。'),
  PreviewAsscomCss:text('辅助组件样式','表单预览附加的组件样式。'),
  PreviewAdaptationCss:text('适配样式','工程预览附加的样式。'),
  PreviewBrowserCommand:text('预览浏览器','用于本地表单渲染的浏览器程序。'),
  CommonMigrationConfig:text('公共模板迁移声明','使用的公共表单模板迁移文件。'),
  ResponsiveDeploymentStrategy:text('响应式部署方式','插件用于响应式转换和部署的策略。'),
  xmlPrintReferencesDir:text('XML 打印模板源','XML 打印模板原文所在目录。'),
  xmlPrintOutputDir:text('XML 打印模板输出','XML 同步和差异输出目录。'),
  i18nTermsDir:text('术语表目录','工程的翻译术语资料目录。'),
  cspTransBackupsDir:text('CSP 翻译备份','翻译同步使用的恢复目录。'),
  outputRoot:text('接口文档输出','接口提取的输出目录，auto 沿插件默认。'),
  frontendPathModes:list('目录编码模式','按目录匹配历史导出模式。',group('目录','前端目录覆盖。',{
    path:{...relative,...generated},
    mode:text('编码模式','目录对应的既有导出编码模式。',generated),
  })),
  frontendEncodingOverrides:list('目录编码确认','按最长目录前缀应用已确认的源码和目标端编码。',group('编码覆盖','编码配置依赖实际源码和连接目标。',{
    path:{...relative,...generated},
    source:text('源码编码','作用范围的本地编码。',generated),
    server:text('服务器编码','匹配目标的编码。',generated),
    confirmation:text('确认状态','按编码确认入口核对。',generated),
  })),
};

function pluginField(plugin, key) {
  if (plugin === 'coding-iris-plugin' && key === 'menuSync') {
    return group('菜单同步','当前工程已核验并登记的菜单来源。',{sources:record('菜单来源','按来源标识管理。',menu)});
  }
  return Object.hasOwn(pluginDescriptions, key) ? pluginDescriptions[key] : undefined;
}

function notes(value) {
  const output = [];
  function visit(node, definition, path) {
    if (!definition || node === undefined) return;
    if (typeof path.at(-1) === 'string') output.push({path, description:definition.description});
    if (definition.items && Array.isArray(node)) {
      node.forEach((value, i) => visit(value, definition.items, [...path, i]));
    } else if (node && typeof node === 'object' && !Array.isArray(node)) {
      for (const [key, item] of Object.entries(node)) {
        const child = path[0] === 'pluginSettings' && path.length === 2
          ? pluginField(path[1], key) : definition.properties?.[key] ?? definition.entries;
        visit(item, child, [...path,key]);
      }
    }
  }
  for (const [id, definition] of Object.entries(sections)) {
    if (Object.hasOwn(value, id)) visit(value[id], definition, [id]);
  }
  return output;
}

module.exports = {sections, pluginField, notes};

# External Interface Management (外部接口管理规范)

## 注册要求

必须在**外部接口管理**中注册：
- **Vendor Name** (厂家名称)
- **Module Name** (模块名称)
- **Associated Business Middleware** (关联的业务中间层)

## 前端架构规范

前端代码必须遵循**三层架构**：

```
Business JS → Middleware JS → External Interface Layer JS
```

**层级说明**：

| 层级 | 职责 | 示例路径 |
|------|------|---------|
| **Business JS** | 页面业务逻辑，用户交互 | `/opcare/oeord/scripts/orderEntry.js` |
| **Middleware JS** | 业务抽象，编排钩子 | `/opcare/oeord/scripts/OEOrder.Common.Control.js` |
| **External Interface Layer JS** | 第三方接口封装，协议适配 | `/comoe/interface/{Vendor}/{Module}.js` |

## 命名规范

外部接口层JS按**Vendor + Module + Product**命名：

```
/comoe/interface/{Vendor}/{Module}.js
```

**示例**：
- `/comoe/interface/iMedical/SPD.js` - iMedical厂商SPD模块接口
- `/comoe/interface/Haier/Stock.js` - Haier库存模块接口
- `/comoe/interface/Siemens/LIS.js` - Siemens LIS系统接口

## 第三方 JS 资源部署与关联

当第三方厂商提供前端 JS 库文件（如弹窗组件、UI 框架、工具库等）时，按以下规范部署和配置：

### 部署位置

第三方 JS 文件与 HIS 外部接口层 JS **放在同一目录下**，禁止分散部署到其他路径：

```
{hisfront}/static/comoe/interface/{Vendor}/
  ├── {Module}.js          # HIS 外部接口层 JS（调用 PushInterfaceArr 注册）
  ├── {vendor_lib1}.js     # 第三方提供的 JS 文件
  ├── {vendor_lib2}.js     # 第三方提供的 JS 文件
  └── ...                  # 弹窗页面等其余第三方资源
```

**示例**（上海医浦合理用药）：

```
{hisfront}/static/comoe/interface/ShangHaiYiPu/
  ├── HLYY.js              # HIS 外部接口层
  ├── layui.js             # 医浦提供 (layui 框架)
  ├── hiepana.js           # 医浦提供 (弹窗入口，暴露全局函数 hiepHandle())
  └── index.html           # 弹窗页面
```

### PageId 页面引入

第三方 JS 文件需在对应的 PageId 页面中通过 `<script>` 标签引入。引入顺序需保证第三方依赖在前，HIS 外部接口层 JS 在后，确保第三方全局函数（如 `hiepHandle()`）在 `BeforeUpdate` 钩子触发时已就绪。

```html
<!-- 第三方 JS（先加载） -->
<script src="/comoe/interface/ShangHaiYiPu/layui.js"></script>
<script src="/comoe/interface/ShangHaiYiPu/hiepana.js"></script>
<!-- HIS 外部接口层 JS（后加载） -->
<script src="/comoe/interface/ShangHaiYiPu/HLYY.js"></script>
```

### 约束

- 第三方 JS 文件与 HIS 外部接口层 JS 放在同一厂商目录下，**禁止**分散到 `{hisfront}/static/thirdparty/` 等非标准路径
- 第三方 JS 文件**禁止**在 `HLYY.js` 中通过 `$.getScript()` 或动态创建 `<script>` 标签的方式加载（会导致时序不可控）

---

## 业务中间层关联

外部接口必须与业务中间层关联。

**关键生命周期钩子**：

| 钩子 | 时机 | 使用场景 |
|------|------|---------|
| **Init** | 页面初始化 | 初始化第三方连接 |
| **BeforeUpdate** | 数据更新前 | 与第三方验证数据 |
| **AfterUpdate** | 数据更新后 | 同步数据到第三方 |
| **AfterAdd** | 添加新记录后 | 通知第三方新数据 |

**详细规范**: `references/business-middleware.md`

## 决策流程

```
第三方需求
    ↓
是否嵌入医生站工作流？
    ↓ 是
需要在外部接口管理中注册
    ↓
遵循三层架构
    ↓
Business JS → Middleware JS → External Interface Layer JS
```

## Chrome中间件集成

当第三方对接需要访问**本地资源（DLL/OCX/ActiveX/硬件设备）**时，需要使用**医为浏览器插件（WebSysAddins）**平台。

**重要说明**：
- **WebSysAddins是一个跨技术栈开发平台**，由BSP基础平台组负责运维
- **具体的插件应用开发由应用团队负责**（医生站组自行开发业务插件）
- BSP组仅提供平台技术支持和问题排查，不做具体应用开发

**职责分工**：

| 职责 | BSP基础平台组 | 医生站组 |
|------|--------------|---------|
| WebSysAddins平台运维 | ✅ 负责 | ❌ 不负责 |
| 平台技术支持 | ✅ 负责 | ❌ 不负责 |
| 具体插件应用开发 | ❌ 不负责 | ✅ 负责 |
| 第三方DLL/OCX集成 | ❌ 不负责 | ✅ 负责 |
| 业务逻辑实现 | ❌ 不负责 | ✅ 负责 |

**使用场景判断**：

| 第三方技术要求 | 解决方案 | 负责团队 |
|---------------|---------|---------|
| DLL/OCX/ActiveX调用 | **基于WebSysAddins平台自行开发插件应用** | 医生站组（开发）+ BSP组（平台支持） |
| 标准HTTP/REST接口 | 本skill提供的前后端集成方案 | 医生站组 |

**遇到平台问题**：使用 **imedical-bsp-websysaddins** skill获取BSP组技术支持

**参考文档**: http://hisui.cn/wp-content/uploads/2022/06/Chrome中间件相关开发.pdf

## 前端架构

### 核心要点

- **浏览器**: 医为浏览器（基于 CEFSharp 109 / Chromium 109）
- **技术栈**: jQuery + HISUI (EasyUI扩展)
- **架构**: B/S架构，前后端分离
- **外部接口层路径**: `/comoe/interface/{Vendor}/{Module}.js`

### 与本地客户端交互

前端JavaScript无法直接调用DLL/OCX，两种方案：
1. **后端Controller封装（推荐）**: 前端调用HTTP接口，后端处理本地通信
2. **WebSysAddins中间件**: 仅在必要时使用，详细规范见 `imedical-bsp-websysaddins` skill

**详细架构说明**: `references/frontend-architecture.md`

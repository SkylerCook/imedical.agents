# Frontend Architecture (前端架构详情)

## Architecture Overview

Doctor station frontend uses **B/S Architecture** (Browser/Server), based on **Yiwei Browser (医为浏览器)**:

- **Browser Kernel**: Yiwei Browser based on **CEFSharp 109**
- **Architecture Pattern**: Frontend-Backend separation
- **Communication Protocol**: HTTP/HTTPS + WebSocket (real-time)
- **Deployment**: Static resources + Nginx reverse proxy

## Yiwei Browser Characteristics

Yiwei Browser is a customized browser for HIS systems, based on Chromium Embedded Framework (CEF) 109:

| Feature | Description |
|---------|-------------|
| **Kernel Version** | CEFSharp 109 (based on Chromium 109) |
| **Frontend Framework** | jQuery + HISUI (based on EasyUI extension) |
| **Rendering Engine** | Blink (same as Chrome) |
| **JavaScript Engine** | V8 |
| **Compatibility** | Supports HTML5, CSS3, ES6+ |

## Interaction with Local Client/C/S Systems

**⚠️ 重要提示**: 前端与本地客户端程序交互

由于浏览器安全沙箱限制，前端JavaScript**无法直接**与本地客户端程序（DLL、OCX、本地EXE）交互。

### 方案1: 使用医为浏览器插件（WebSysAddins）
/ne
- WebSysAddins是BSP组提供的跨技术栈开发平台
- **医生站组基于该平台自行开发插件应用**，实现DLL/OCX调用
- BSP组仅提供平台技术支持，不负责具体应用开发
- 开发过程中遇到平台问题，使用 **imedical-bsp-websysaddins** skill联系BSP组

### 方案2: 通过后端Controller封装（推荐）

- 前端仅调用HTTP接口
- 后端负责与本地组件通信
- 医生站组完全自主开发，无需依赖插件平台

**医生站组的标准做法**: 优先通过后端Controller封装，前端仅调用HTTP接口；仅在必要时使用WebSysAddins平台开发插件应用

## Frontend Directory Structure

```
static/
├── base/                           # Base framework resources
│   ├── scripts/                    # Core scripts
│   │   ├── hisui.js               # HISUI framework entry
│   │   ├── doc/util/              # Doctor station utilities
│   │   │   └── doc.interface.js   # External interface loader
│   │   └── websys.*.js            # System common methods
│   └── ...
│
├── opcare/                        # Outpatient care
│   ├── oeord/                     # Order management
│   │   ├── scripts/               # Business scripts
│   │   │   ├── OEOrder.Common.Control.js    # Middleware layer
│   │   │   └── OEOrder.Common.js            # Business logic
│   └── ...
│
├── comoe/                         # Common orders
│   └── interface/                 # External interface layer
│       └── {Vendor}/              # Vendor directory
│           └── {Module}.js        # Interface implementation
│
└── ...
```

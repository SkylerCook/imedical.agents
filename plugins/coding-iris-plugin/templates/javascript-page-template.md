# JavaScript 页面组织模板

本文提供普通页面与闭包页面两种可选组织方式，供新建页面、确需调整组织结构或 Review 初始化链路时读取。依据用户指定的医生站 code.template.js 所表达的页面组织和生命周期约定整理，不复制其业务命名，不将历史写法提升为通用风格。命名、缩进、引号和兼容基线统一按[前端规范](../references/frontend-coding-format.md)。

## 选择条件

| 条件 | 选择 |
|---|---|
| 独立页面，已加载 jQuery，现有容器允许页面级函数且无命名冲突 | 普通页面模板，由 DOM ready 启动 |
| 已确认项目加载 createObjByStr、cspInitClosure，页面容器采用模块对象初始化契约 | 闭包模板，由调用方显式初始化 |
| 无上述依赖，或使用模块框架、组件框架及其它生命周期 | 沿用已确认的项目生命周期，不引入这些 helper，不强行改为两种模板之一 |

不能凭 doctor-dev 类型、DOC:HEAD 存在或模板文件存在推断 helper 可用。核对目标页面实际资源加载及实现；历史页面按原有契约局部修改，不为统一模板重构。历史 PageLogicObj、_opts、接口键及全局回调不得因示例命名而机械改名。

以下代码只展示初始化职责；samplePage、example.page、sampleReset 均需按页面实际对象及选择器替换。两种模板二选一，不同时运行；不新增空生命周期方法。示例使用 ES5 语法，helper 和依赖库仍须满足项目浏览器基线；原参考中的 const、let 和默认参数不是全局要求。

## 普通页面

本例要求 jQuery 先加载，DOM 中已有 sampleReset 按钮。ready 是唯一启动方，顺序为组件初始化、事件绑定；已有 ready 或容器入口时合并到该入口，不再创建第二条初始化链。事件仅在首次初始化绑定，刷新数据不要再次绑定。

~~~javascript
var pageState = {
    selectedId: ""
};

$(function () {
    init();
    initEvent();
});

function init() {
    pageState.selectedId = "";
    // 在此初始化页面实际需要的控件。
}

function initEvent() {
    $("#sampleReset").on("click", function () {
        pageState.selectedId = "";
    });
}
~~~

pageState、init、initEvent 是示例的页面级标识；只有页面隔离或无冲突时才采用。嵌入多个页面或共享 window 时先核对全局命名和容器契约，不静默覆盖已有函数。

## 闭包页面

先加载已确认的公共 helper，再加载业务模块定义；DOM 和控件依赖就绪后，由页面调用方传入明确的初始化参数，调用 cspInitClosure 一次。模块定义自身不注册 ready、不自动初始化。init 负责组件初始化及事件绑定，initEvent 保持私有；调用方不再单独调用它。

~~~javascript
createObjByStr("example.page").view = (function () {
    var pageOptions;
    var selectedId;

    function init(options) {
        pageOptions = options;
        selectedId = pageOptions.initialId;
        initEvent();
    }

    function initEvent() {
        $(pageOptions.resetSelector).on("click", function () {
            selectedId = "";
        });
    }

    function getSelectedId() {
        return selectedId;
    }

    return {
        init: init,
        getSelectedId: getSelectedId
    };
}());
~~~

下面是独立的调用端示例，必须在模块定义和目标 DOM 已加载后执行；放入项目现有的就绪入口，不能与其它启动方重复调用。示例参数属于本模板的演示契约，不替代项目参数校验。

~~~javascript
var pageOptions = {
    initialId: "",
    resetSelector: "#sampleReset"
};
cspInitClosure(example.page.view, pageOptions);
~~~

按已核对的 helper 契约，cspInitClosure 会将返回对象中非 init 的方法挂载到 window（已存在同名全局时不会覆盖），再立即调用 init(opts)。因此即使采用闭包，导出的方法仍需检查全局重名；不同项目的实现可能不同，以实际源码为准。不要将所有内部方法都放进返回对象，不通过模板自动增加 helper 或兼容兜底。需要多次初始化或销毁重建时，按项目容器另行明确解绑与清理，本模板不承诺重入安全。

## 可选生命周期与 Review

| 名称 | 仅在容器存在对应契约且业务需要时实现 |
|---|---|
| xhrRefresh(args) | 局部刷新数据，避免重新绑定已存在的事件 |
| onBeforeCloseTab() | 关闭前处理；只有实际需要拦截时按容器契约返回 false |
| chartOnBlur() | 离开页签时处理；返回 false 的效果以容器实现为准 |

普通模板按容器约定提供全局入口；闭包模板将需要的方法放入返回对象并核对 helper 如何暴露。不得为了“完整”增加空方法、默认返回 false 或擅自改名。

Review 检查：模板选择有依赖与容器依据；资源先加载、参数先定义；初始化只由一个入口触发；事件绑定未遗漏或重复；导出与全局名称无冲突；只保留实际需要的生命周期；刷新、返回值、this 和接口语义未因整理改变。现有[review-agent](../../../agents/review-agent/AGENT.md)接收命中的模板、前端规范和项目契约，无独立 Agent 时报告串行自审。静态或模拟验证不证明真实页面、旧浏览器及目标 helper 已加载生效。

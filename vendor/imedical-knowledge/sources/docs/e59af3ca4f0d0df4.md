# ObjectScript 编码规范

本文档是 `AGENTS.md`「ObjectScript 编码规范」一节的外联详情文档，涵盖类定义、方法签名、异常处理、注释语言与完整示例。

> **适用范围**：仅适用于**新增代码与重构**，历史存量代码不要求改造。

---

## 类定义

- 新增业务类**必须直接或间接继承 `DHCDoc.Util.RegisteredObject`**，以获得统一的翻译（`%Trans`）与异常（`%GetException`）能力
- 类名使用大驼峰（PascalCase）
- 包名按分层约定：Web 接口类 `web.Product.Feature`、BLL 类 `Product.BLL.Feature`、DAL 类 `Product.DAL.Feature`
- `Order` / `Diagnos` 子系统另有六层架构与 `V9` 版本目录约定，见 `.agents/docs/代码架构详解.md`

## 方法签名

- 方法名使用小驼峰（camelCase）
- 入参推荐使用动态对象 `%DynamicObject`，避免长参数列表
- **必须标注返回值类型**（`As %DynamicObject` / `As %DynamicArray`）；非简单方法的返回值优先使用动态对象或动态数组，便于前端直接消费
- 读取动态对象属性用 `param.%Get("key")`，写入用 `set obj.key = value`；数组用 `%DynamicArray` 的 `%Push()` / `%GetIterator()`

## 异常处理

- 需中断退出时统一使用 `throw ..%GetException(errCode, errMsg)`
- `errMsg` **必须用 `..%Trans()` 包裹**，禁止裸中文
- 含变量时使用占位符：`..%Trans("在{0}天内", "", days)`
- 完整翻译方法表见 `.agents/docs/多语言翻译指南.md`

## 注释语言

ObjectScript 与 JS 代码中的注释统一使用**中文**，与现有代码风格保持一致。

---

## 完整示例

```objectscript
Class DHCDoc.EPMI.Service Extends DHCDoc.Util.RegisteredObject
{
    ClassMethod getPatBaseInfo(param As %DynamicObject = "", SessionStr = "") As %DynamicObject
    {
        set patientId = param.%Get("patientId")
        if patientId="" {
            throw ..%GetException("", ..%Trans("系统不存在此患者"))
        }
        set patObj = {}
        set patObj.patientId = patientId
        Q patObj
    }
}
```

示例覆盖的要点：

| 要点 | 体现位置 |
|------|---------|
| 继承 `DHCDoc.Util.RegisteredObject` | `Extends` 子句 |
| 方法名小驼峰 | `getPatBaseInfo` |
| 入参用动态对象 | `param As %DynamicObject = ""` |
| 标注返回值类型 | `As %DynamicObject` |
| 动态对象字面量 | `set patObj = {}` |
| 统一异常 + 强制翻译 | `throw ..%GetException("", ..%Trans("系统不存在此患者"))` |

---

## 相关文档

- `.agents/docs/命名规范.md`：类名 / 方法名 / 变量大小写规则
- `.agents/docs/多语言翻译指南.md`：`%Trans` 完整方法表与占位符用法
- `.agents/docs/代码架构详解.md`：分层架构、厂商接口适配层与版本目录
- `.agents/docs/编译与部署指南.md`：`iris_doc_load` 上传与编译

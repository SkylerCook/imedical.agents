# 广东省电子健康卡信封结构示例

本文件是规约 AD"请求报文嵌套 body 结构"的具体实现参考，来源于广东省电子健康码对接文档。
其他省份平台按各自对接文档实现，不得直接沿用本文的 version、encryptMode 或签名算法。

## 嵌套结构

请求报文分为**头部**和 **body** 两层：

- **头部字段**：`appId` / `timestamp` / `nonceStr` / `version` / `method` / `signMode` / `encryptMode` / `headSign` / `bodySign`
- **body 内字段**：所有业务字段 + `orgCode` + `appRecordNo`

`buildBaseRequest()` 只构建头部；`buildBody(dto)` 构建业务字段 Map 并追加 orgCode/appRecordNo。

## 广东省具体参数

| 参数 | 值 | 说明 |
|------|-----|------|
| `version` | `"V3.5.0"` | 非 "1.0" |
| `encryptMode`（直连） | `"SM4/ECB/ZeroBytePadding"` | 非 "SM4" |
| `encryptMode`（总线前置） | `"none"` | body 明文，由总线代加解密 |

## 签名计算

- **headSign**：所有顶层字段（排除 headSign 自身），body 序列化为 JSON 字符串参与签名
- **bodySign**：body 内业务字段按 key 字典序排列拼接 + appSecret

## 前置代理模式

`signMode=none` / `encryptMode=none` / `headSign=none` / `bodySign=none`，body 内明文传输。

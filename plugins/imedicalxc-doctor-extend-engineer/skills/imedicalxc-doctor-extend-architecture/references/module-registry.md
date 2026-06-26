# Module Registry (业务模块注册表)

## 设计原则

1. **厂家+模块双维度管理**: 同一模块可由不同厂家实现
2. **目录结构**: `/comoe/interface/{Vendor}/{Module}.js`
3. **配置独立**: 每个厂家+模块组合独立配置、独立启用/停用
4. **接口隔离**: 不同厂家的同一模块接口相互隔离，避免冲突

## 已注册业务模块列表

| 模块Code | 模块描述 | 典型厂家 | 业务场景 |
|---------|---------|---------|---------|
| **InsuCard** | 医保卡 | iMedical, 各省级平台 | 医保卡读卡、身份识别 |
| **Call** | 叫号分诊系统 | iMedical | 门诊叫号、分诊管理 |
| **HRP** | HRP | 各HRP厂商 | 人力资源与绩效管理 |
| **ExamLabHR** | 检查检验结果互认 | HuNanShengPingTai, GuiZhouShengPingTai | 跨院检查检验结果互认 |
| **PublicHealthReport** | 公共卫生上报 | 各省级平台 | 传染病上报、公卫数据上报 |
| **InternetQrPay** | 互联网扫码付费 | 各支付平台 | 扫码支付、移动支付 |
| **CDSS** | CDSS | iMedical | 临床决策支持系统 |
| **EInsuFace** | 人脸识别 | iMedical | 医保人脸识别、身份核验 |
| **CPW** | 临床路径 | iMedical | 临床路径管理 |
| **AICopilot** | AI 机器人 | iMedical | AI辅助诊疗 |
| **ExamLabHRBySelf** | 检查检验互认(自行开发界面) | iMedical | 自定义互认界面 |
| **InsuReg** | 医保挂号 | 各省级医保平台 | 医保挂号、预约 |
| **MisPos** | MisPos | 各支付厂商 | POS机支付 |
| **EInvoice** | 电子发票 | 各发票平台 | 电子发票开具 |
| **SPD** | 第三方耗材物资系统SPD | GuoYaoXinChuang, 其他SPD厂商 | 耗材管理、库存管理 |
| **QSInsuCard** | 全省医保卡 | 各省级平台 | 省级医保卡统一接口 |
| **HLYY** | 合理用药 | iMedical, MeiKang, HangZhouYiYao | 处方审核、用药监测 |
| **InsuBusiness** | 国家医保智能审核 | iMedical | 医保智能审核 |
| **OutPresc** | 国家医保处方流转 | DongRuan, 其他厂商 | 处方外流、院外购药 |
| **ElecHealthCard** | 电子健康卡 | HuNanShengPingTai, 其他省级平台 | 电子健康卡应用 |
| **PrescAudit** | 审方系统 | iMedical, MeiKang | 处方前置审核 |
| **Drgs** | Drgs | ChuangZhiHeYu, 其他厂商 | 疾病诊断相关分组 |
| **InsuRules** | 医保控费 | 各医保平台 | 医保费用控制 |
| **EInsuCard** | 电子医保凭证 | iMedical | 电子医保卡 |
| **DrgDip** | Drg-Dip预分组 | iMedical | DRG/DIP预分组 |
| **HealthManagementPlatform** | 全民健康信息平台 | HuNanShengPingTai, 其他省级平台 | 健康档案、数据共享 |

## 多厂家实现示例

**合理用药模块(HLYY)** 的多厂家实现：

```
/comoe/interface/iMedical/HLYY.js          (东华医为合理用药)
/comoe/interface/MeiKang/HLYY.js           (美康合理用药)
/comoe/interface/HangZhouYiYao/HLYY.js     (杭州逸曜合理用药)
```

每个文件独立实现，通过配置决定启用哪个厂家。

## 模块分类

### 医保相关
- InsuCard, QSInsuCard, EInsuCard, InsuReg, InsuBusiness, InsuRules

### 合理用药
- HLYY, PrescAudit

### 平台对接
- ExamLabHR, PublicHealthReport, HealthManagementPlatform, ElecHealthCard

### 支付相关
- InternetQrPay, MisPos, EInvoice

### 临床辅助
- CDSS, CPW, AICopilot, Drgs, DrgDip

### 物资管理
- SPD, HRP

## 注册新模块流程

1. **确定模块Code**：使用CamelCase格式，简洁明了
2. **编写模块描述**：使用简洁的中文业务术语
3. **确定关联中间层**：从业务中间层列表中选择
4. **外部接口管理注册**：
   - 厂家名称
   - 模块名称
   - 关联业务中间层
5. **创建接口文件**：按规范创建 `/comoe/interface/{Vendor}/{Module}.js`

## 注意事项

- 模块Code一旦确定，尽量不要修改
- 同一模块支持多厂家并行接入
- 不同厂家的实现相互隔离
- 通过配置灵活切换厂家

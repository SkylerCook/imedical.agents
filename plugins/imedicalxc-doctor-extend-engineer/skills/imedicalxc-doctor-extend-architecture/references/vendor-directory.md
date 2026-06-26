# Vendor Directory (第三方厂商目录)

## 命名规范

### 目录命名规则

1. 使用**驼峰命名法**（CamelCase），首字母大写
2. 优先使用厂商的**英文名称**或**拼音缩写**
3. 省级平台统一使用`{省份拼音}ShengPingTai`格式
4. 目录名一旦确定，前后端必须保持一致

## 已收录厂商列表

| 目录名 | 厂商名称 | 说明 |
|--------|---------|------|
| `HuNanShengPingTai` | 湖南省平台 | 省级平台接口（如全民健康信息平台） |
| `GuiZhouShengPingTai` | 贵州省平台 | 省级平台接口 |
| `JiangXiShengPingTai` | 江西省平台 | 省级平台接口 |
| `iMedical` | iMedical/东华医为 | 东华医为自有产品（合理用药、CDSS等） |
| `MeiKang` | 美康 | 美康合理用药系统 |
| `WanDaXinXi` | 万达信息 | 万达信息接口 |
| `GuoYaoXinChuang` | 国药新创 | 国药新创SPD系统 |
| `ChuangZhiHeYu` | 创智和宇 | 创智和宇DRGs系统 |
| `DongRuan` | 东软 | 东软系统接口 |
| `BeiJingShouXinKeJi` | 北京首信科技 | 首信科技接口 |
| `HangZhouYiYao` | 杭州逸曜 | 逸曜合理用药 |
| `TongZhiWeiYe` | 同智伟业 | 同智伟业接口 |
| `GuanXinKeJi` | 冠新科技 | 冠新科技接口 |
| `CeShiHe1` | 测试 he1 | 测试环境专用 |

## 目录结构示例

### 前端目录

```
/comoe/interface/HuNanShengPingTai/HealthManagementPlatform.js
/comoe/interface/MeiKang/HLYY.js
/comoe/interface/GuoYaoXinChuang/SPD.js
```

### 后端目录

```
/opcare/external/controller/hunan/HuNanRegInterfaceController.java
/opcare/external/blh/meikang/hlyy/OpCareHLYYMKAbstract.java
/opcare/external/model/vo/guoyaoxinchuang/SPDResponseVO.java
```

## 新增厂商流程

1. **确认厂商名称**：获取厂商的正式中文名称和英文名称
2. **确定目录名**：
   - 优先使用英文名称（CamelCase）
   - 无英文名称时使用拼音缩写（CamelCase）
   - 省级平台使用`{省份拼音}ShengPingTai`格式
3. **前后端统一**：确保前后端使用相同的目录名
4. **注册到外部接口管理**：在系统中注册厂家名称和模块名称
5. **创建目录**：按规范创建前后端目录结构

## 注意事项

- 目录名一旦确定，**严禁随意修改**，会影响已部署的接口
- 新增厂商前，先检查是否已有相同或类似厂商存在
- 保持目录结构的清晰和一致性，便于后期维护

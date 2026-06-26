
# BLH 审查清单

将以下清单派发给代码质量审查子代理。**任何适用清单中的未勾选项 = REJECT，返回实现者修复。**

## 适用规则

仅在实现任务**创建或修改 BLH 类**（Abstract / CommonBLH / RegionBLH / ProjectBLH / DriverCom）时派发这些清单。

| 任务范围 | 适用清单 |
|------------|----------------------|
| 创建或修改 BLH 类 | BLH-1、BLH-2、BLH-3、BLH-4、BLH-5 |
| 后端任务，无 BLH 变更 | **跳过全部 BLH 清单** |

**注意**：VO/DTO 字段文档（`@ApiModelProperty`、Jackson 注解等）由 `imedicalxc-doctor-extend-architecture` → `references/domain-constraints.md` → 清单 5 以及 `imedicalxc-doctor-extend-dataformat` 覆盖。

---

### 清单 BLH-1：BLH 逻辑前提（核心约束）

> **门禁规则**：本清单必须在其他 BLH 清单之前通过。若 BLH-1 失败 → 立即 REJECT，不再继续 BLH-2~5。

- [ ] 用户已明确确认该逻辑是项目专属（项目专属）
- [ ] 用户已明确确认该逻辑不会影响其他已部署医院（不影响其他医院）
- [ ] 用户已明确确认无需额外部署配置（无需额外配置）
- [ ] BLH 实现类中不存在未经用户确认的具体业务逻辑

**检测规则**：
- 若 BLH 实现类（CommonBLH / RegionBLH / ProjectBLH）包含超出接口定义、依赖注入、简单路由或透传骨架代码的具体业务逻辑方法 → 视为“未经确认的业务逻辑” → 必须回溯到 Step 0 获取用户明确确认后方可保留。

---

### 清单 BLH-2：类命名

- [ ] Abstract 类命名为 `{功能}Abstract`
- [ ] CommonBLH 命名为 `{功能}CommonBLH`
- [ ] RegionBLH 命名为 `{功能}RegionBLH`
- [ ] ProjectBLH 命名为 `{功能}ProjectBLH`
- [ ] DriverCom 命名为 `{功能}DriverCom`
- [ ] DriverCom 服务于多个业务域（而非仅单一业务）
- [ ] `@BLH` 的 `value` 符合 `{业务域}.{组件}.{功能}BLH` 格式

---

### 清单 BLH-3：@BLH 注解

- [ ] `value` 以小写字母开头
- [ ] `version` 与 BLH 类型匹配（CommonBLH 用标准语义化版本，RegionBLH 用区域标识，ProjectBLH 用项目标识）
- [ ] `notes` 填写功能描述
- [ ] 同一功能的所有 BLH 实现 `value` 一致

---

### 清单 BLH-4：包路径

- [ ] Abstract 类位于 `blh/{功能}/` 包下
- [ ] 实现类（Common/Region/Project）位于 `blh/{功能}/ext/` 包下
- [ ] 实现类位于 `blh/**/ext/**` 子包下（框架扫描要求）

---

### 清单 BLH-5：配置

- [ ] Nacos 中已配置对应 BLH 的版本路由
- [ ] Nacos 版本值与 `@BLH` 注解的 `version` 值一致
- [ ] `@BLHScan` 的 `basePackages` 配置正确
- [ ] `@BLHScan` 包路径覆盖所有 BLH 实现包

---

## 相关技能

- **imedicalxc-doctor-blh** — BLH 编码规范与架构
- **imedicalxc-doctor-extend-architecture** → references/domain-constraints.md — HIS 领域审查清单

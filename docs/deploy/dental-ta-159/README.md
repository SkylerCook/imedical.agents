# 部署场景：dental-ws 口腔技工单 → 159 服务器

> 场景 ID: `dental-ta-159`
> 日期: 2026-06-01
> 状态: ✅ 已完成

## 场景概述

口腔技工单（dental-ws / DHCDoc.Dental.TA）前后端首次全量部署到 172.18.18.159 服务器。

## 部署结果

| 阶段 | 结果 |
|------|------|
| 后端类上传 | 61/61 ✅ |
| 后端类编译 | 61/61 ✅ |
| 前端 SFTP 上传 | 66 文件（36 CSP + 30 scripts/img/css） ✅ |
| CSP 编译 | 36/36 ✅ |

## 场景文件

| 文件 | 说明 |
|------|------|
| [`deploy-plan-159.md`](deploy-plan-159.md) | 最终版部署计划（10 阶段 + 复盘修正） |
| [`deploy-backend.js`](deploy-backend.js) | 后端批量部署脚本（Storage Default 剥离 + 分组编译） |
| [`deploy-frontend.js`](deploy-frontend.js) | 前端批量部署脚本（SFTP 分目录同步 + CSP namespace 编译） |

## 关联经验条目

以下经验条目来自 [`../../feedback/experience/deploy-com-exp.md`](../../feedback/experience/deploy-com-exp.md)，本次场景命中：

| 经验编号 | 标题 | 分类 |
|----------|------|------|
| [1.1](../../feedback/experience/deploy-com-exp.md#11-实体类-storage-default-块导致编译-5559) | 实体类 Storage Default 块导致编译 #5559 | 后端编译 |
| [1.2](../../feedback/experience/deploy-com-exp.md#12-实体类跨包依赖需先全部上传再编译) | 实体类跨包依赖需先全部上传再编译 | 后端编译 |
| [1.3](../../feedback/experience/deploy-com-exp.md#13-windows-crlf-换行导致文本处理失败) | Windows CRLF 换行导致文本处理失败 | 后端编译 |
| [1.4](../../feedback/experience/deploy-com-exp.md#14-实体类上传需先删除旧版本) | 实体类上传需先删除旧版本 | 后端编译 |
| [2.1](../../feedback/experience/deploy-com-exp.md#21-sync_directory-的-ignore_patterns-在-windows-上对-git-目录模式失效) | sync_directory IGNORE_PATTERNS 在 Windows 上失效 | SFTP |
| [2.2](../../feedback/experience/deploy-com-exp.md#22-upload_file-是全量覆盖的可靠方式) | upload_file 是全量覆盖的可靠方式 | SFTP |
| [3.1](../../feedback/experience/deploy-com-exp.md#31-iris_execute-默认在-user-命名空间执行csp-编译必须显式传-namespace-参数) | iris_execute namespace 参数 | CSP 编译 |
| [3.2](../../feedback/experience/deploy-com-exp.md#32-csp-文件虚拟路径格式) | CSP 文件虚拟路径格式 | CSP 编译 |

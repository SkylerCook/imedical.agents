# registerElecHealthCard 数据流详解

电子健康卡建卡时 `elec_pid` 的写入有两条来源路径，最终都持久化到 `pa_card_ref.elec_pid`。

## 来源一：前端读卡（读卡号 / 读取信息）

```
ElecHealthCard.js ReadMagCard / ReadPersonInfo
  → 后端 GetElecHealthCardInfoAbstract.getElecHealthCardNo / getElecHealthCardInfo
    → 返回 ElecHealthCardNoVO / ElecHealthCardInfoVO（含 elecPid）
      → 前端 SetPatInfoByXML 映射到 hidden field（#elecPid）
        → GetCardRefInfo() 读取 hidden field → paCardRefDto.elecPid
          → 建卡请求传入后端
```

## 来源二：后端注册（当前端未传入 elecPid 时）

```
SaveCardInfoAbstract.registerElecHealthCardIfIdCard
  ├─ 若 paCardRefDto.elecPid 已有值 → 跳过注册，直接使用
  └─ 若为空 → cardInvoke(REGISTER_ELEC_HEALTH_CARD) → 厂家策略 registerElecHealthCard
      → 返回 CardRegisterResponseVO
        → paCardRefDto.setElecPid(responseVO.getElecCardNo())
```

## 最终持久化

```
paCardDefBLH.saveCardInfo (BeanUtil.copyProperties → saveOrUpdate)
  → pa_card_ref.elec_pid 持久化
```

## 触发条件

`registerElecHealthCardIfIdCard` 仅在卡类型为"卡号等效证件类型"（如身份证等效卡）时执行，
普通实体卡建卡不触发。注册失败不阻断建卡流程（try-catch 保护）。

## 前端建卡页面布线清单

新厂家接入时同步检查：

- HTML hidden field：`#elecPid`
- `commonJson`（`doc.cardregconfig.json.js`）：`elecPid: 'elecPid'`
- `CardRefInfo`（`doc.cardref.entity.json.js`）：`"elecPid":"elecPid"`

## 前端读卡返回 VO 必备字段

`ElecHealthCardNoVO` 和 `ElecHealthCardInfoVO` 必须包含：

- `elecPid`（电子健康卡 ID）— 必须

# 旧 DM-Core-01A 指令废止说明

日期：2026-07-21  
版本：v0.1.1

> 本文**只废止开发指令**，**不**否认仓库中已存在的实现提交。

---

## 1. 必须区分的两个对象

| 对象 | 标识 | 状态 | 含义 |
|------|------|------|------|
| **① 旧 DM-Core-01A 开发指令** | 当时下发的「代表我完成任务」实现命令与并列模块开发口径 | **`superseded`** | **不得**再按该**旧指令**继续扩展开发、验收或宣称正式闭环交付 |
| **② 已存在实现提交** | `55ae01fd089a232200d90191fa788da5153d88e8`（`feat(dm-core-01a): add act-on-my-behalf task entry`；父提交 `aa7dbff`） | **`retained_for_mapping_review`**（亦记作 `experimental_infrastructure`） | 新规划冻结**之前**已形成的代码；**真实存在于仓库**；本次**不得修改**；**不是**第一纵向闭环完成态 |

### 禁止的笼统表述

- 避免单独写「旧 DM-Core-01A 不得执行」而不加对象限定——易被误读为「`55ae01f` 不存在或尚未执行」。  
- 正确说法：**「旧开发指令已 `superseded`；提交 `55ae01f` 为 `retained_for_mapping_review`，保留供合同映射与规格冻结后裁定。」**

---

## 2. 对提交 `55ae01f` 的约束

1. **不得**写成尚未执行、不存在或未合入。  
2. **不得**标记为「第一纵向闭环完成」或用户面正式「可用」闭环。  
3. 后续只能在**合同映射与规格冻结**之后，决定**复用、调整或废弃**；须另获实现授权。  
4. 本次规划澄清与复核**不得修改**该实现。  
5. 能力边界与四合同字段状态见 [`digitalme_first_vertical_loop_sprint_plan_v0.1.md`](digitalme_first_vertical_loop_sprint_plan_v0.1.md) §2.1 / §4.2。

---

## 3. 权威依据

- [`digitalme_subject_architecture_and_rd_principles_v0.1.md`](digitalme_subject_architecture_and_rd_principles_v0.1.md)  
- [`digitalme_first_vertical_loop_sprint_plan_v0.1.md`](digitalme_first_vertical_loop_sprint_plan_v0.1.md)  
- `digitalme_context.md` 决策 #94 / #95  

关联证据（若存在、通常不提交）：`DigitalMe_DM_Core_01A_act_behalf_review.patch`、`DigitalMe_55ae01f_implementation_review.patch`（复核材料，非执行指令）。

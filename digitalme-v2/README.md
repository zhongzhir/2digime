# Digital Me V2

Digital Me V2 干净实现基线。规格权威见 `../docs/v2/`:

- `digitalme_v2_architecture.md` — 分层与原则
- `digitalme_v2_domain_model.md` — 8 个最小权威对象
- `digitalme_v2_runtime_contracts.md` — 命令面、Adapter、执行器、状态派生契约
- `digitalme_v2_migration_boundary.md` / `digitalme_v2_legacy_reuse_inventory.md` — Legacy 边界
- `digitalme_v2_phase_plan.md` — 阶段计划

## 当前状态

- P0/P0.1:契约骨架与状态派生/转移守卫。
- P1.1:基础设施端口。
- P1.2:Work Runtime(Task → Job → Snapshot → Adapter → Artifact)。
- P1.3:Subject 成长闭环(Package / GrowthEvent / 确认 / 相似任务注入)。下一步 P1.4(薄壳或真实模型接入)前须 CTO 复核。

## 目录

```
src/
  shared/             ids、Result、领域事件
  subject-core/       SubjectPackage、GrowthEvent、派生视图
  work-runtime/       Task、ContextSnapshot、ExecutionJob、Artifact、状态派生
  capability/         CapabilityRegistration、Adapter 契约、注册表
  collaboration/      协作 schema、AuthorizationGrant、本地模拟
  artifact-workspace/ Artifact 查看/编辑/导出契约
  runtime/            命令总线契约、持久化端口
  infrastructure/     端口实现:json-store、event-log、secret-store、model-http、
                      zip、extract、content-store、export、digest(含 tests/)
```

## 验证

```
npm install
npm run verify   # 编译 + 契约冒烟 + 基础设施专项测试
```

## 纪律

- 禁止 import `digitalme-app/`(Legacy)任何路径。
- 新增持久对象、新增命令须先过 CTO 复核(见 domain model §1、contracts §1)。

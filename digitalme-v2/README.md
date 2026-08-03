# Digital Me V2

Digital Me V2 干净实现基线。规格权威见 `../docs/v2/`:

- `digitalme_v2_architecture.md` — 分层与原则
- `digitalme_v2_domain_model.md` — 8 个最小权威对象
- `digitalme_v2_runtime_contracts.md` — 命令面、Adapter、执行器、状态派生契约
- `digitalme_v2_migration_boundary.md` / `digitalme_v2_legacy_reuse_inventory.md` — Legacy 边界
- `digitalme_v2_phase_plan.md` — 阶段计划

## 当前状态

- P0–P1.4:领域层闭环与真实模型 Adapter。
- P1.5:Electron 薄壳 + Artifact 工作区 UI(开发启动 `npm run dev`)。

## 目录

```
src/                  领域层(零 Electron 依赖)
electron/             App Shell:main / preload / renderer
scripts/              构建、预检、凭证引导
```

## 启动(唯一开发入口)

```
npm install
npm run electron:version   # 独立版本检查(不会把 JS 表达式当应用路径)
npm run preflight:electron # 启动预检(空格路径 / 参数数组)
npm run dev                # 编译 + 预检 + 启动 UI
```

历史启动错误根因:
- `D:\console.log(process.versions.electron)` ← 把 `electron -e "console.log(...)"` 的表达式误当作应用入口。
- `D:\Projects\Digital` ← 未可靠引号地拼接含空格路径 `Digital Me`。
本仓库一律用 `spawn(electronPath, [script], { shell: false })` 参数数组启动。

## 验证

```
npm run verify   # build + smoke + tests + electron preflight
```

## 纪律

- 领域层禁止 import `digitalme-app/`(Legacy);Electron 壳可只读引导本机已有模型凭证。
- 新增持久对象、新增命令须先过 CTO 复核。
- 不修改 Legacy 启动脚本。

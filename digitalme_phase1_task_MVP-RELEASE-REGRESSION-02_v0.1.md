# MVP-RELEASE-REGRESSION-02 · 发布主路径完整回归

- **状态**：`release_main_path_validated` / `create_and_import_paths_passed` / `restart_recovery_validated` / `accepted_as_engineered` / `not_pushed`
- **基线**：`bd6f0316944895ba2b2d3b52cf21c61e347061a9` @ `codex/mvp-release-gate-01`
- **parent**：`40cf0bf47238a6df4a85cba84597b0960e4bf660`
- **报告**：`MVP_RELEASE_REGRESSION_02_REPORT_20260802.md`
- **证据**：`digitalme-app/scripts/_mvp-release-regression-02-evidence/`（本地保留，不入库）

## 目标

在最近质量改动之后，验证发布主路径仍可完整走通：创建与导入、做事、真实模型生成、质量环、打开成果、采用、学习回流、重启恢复与中断治愈。不新增产品能力。

## 覆盖

1. 干净用户环境首次启动（隔离 store）
2. 创建 Digital Me / 导入 Digital Me
3. 进入做事主路径、复杂目标、文件与文件夹材料
4. 应用内已连接模型（SecretStore）
5. 真实成果生成、质量评估与定向修正、页内查看、打开本地文件
6. 继续修改契约面（产品 API 保留）、采用、学习回流
7. 重启恢复；残留 generating 治愈；Store 原子写/备份（01D 专项）
8. 无内部评估提示泄漏；Store/IPC/知识源增量 0/0/0

## 验收结论

- 路径 A（创建）与路径 B（导入）均 `ok`
- 专项与既有发布回归全部通过
- **建议**重建 portable 后由 Owner 做最终安装验收
- **不得** push；**不得**宣称 `closed_alpha_ready` / `mvp_ready`

## 运行

```powershell
Set-Location "D:\Projects\Digital Me\digitalme-app"
npm run test:mvp-release-regression-02
```

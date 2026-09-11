# Brand Kit v0 (Slice D)

同一 Core，不同 brand config → 不同发行品牌。

| Brand id | 产品名 | appId | userData |
|----------|--------|-------|----------|
| `tujimi` | 兔机米 | `local.digitalme.v2` | `digitalme-v2` |
| `demo-telecom` | Demo Telecom AI | `local.demotelecom.ai` | `demo-telecom-ai` |

## Build

```bash
npm run build:packaged -- --brand=tujimi
npm run build:packaged -- --brand=demo-telecom
```

`scripts/apply-brand.cjs` 生成（均 gitignore）：

- `electron/brand.json` — runtime
- `electron-builder.brand.json` — electron-builder

## Rules

- Brand Kit 只含品牌展示与可选 Institution Backend **默认地址**（无 master key）
- 官方 `userDataDirName` / `appId` 不可变
- 白标必须使用独立 `appId` + `userDataDirName`
- `strings.openSourceNote` 必须保留 2digime 开源身份

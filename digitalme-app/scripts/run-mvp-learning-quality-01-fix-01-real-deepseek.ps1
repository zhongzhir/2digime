# MVP-LEARNING-QUALITY-01-FIX-01 — Owner 真实 DeepSeek 回归（一键）
# 验证：Learn Job 必须 committed；expression≈4；boundary≥1；正文不进长期 Resolver。
#
# 用法（交互式 PowerShell）：
#   $env:DEEPSEEK_API_KEY = Read-Host "DeepSeek API Key"
#   $env:DIGITALME_VALUE_PROVIDER = "deepseek"
#   $env:DIGITALME_VALUE_MODEL = "deepseek-chat"
#   Set-Location "D:\Projects\Digital Me\digitalme-app"
#   .\scripts\run-mvp-learning-quality-01-fix-01-real-deepseek.ps1
#   Remove-Item Env:DEEPSEEK_API_KEY

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

Write-Host "== Static + production-path learning tests =="
npm run test:mvp-learning-quality-01
if ($LASTEXITCODE -ne 0) { throw "mvp-learning-quality-01 failed" }
npm run test:dvl2-04-auto-learn
if ($LASTEXITCODE -ne 0) { throw "dvl2-04-auto-learn failed" }

if (-not $env:DEEPSEEK_API_KEY) {
  Write-Host "DEEPSEEK_API_KEY missing — static/integration only. Status: real_model_regression_pending"
  exit 2
}

$env:DIGITALME_VALUE_PROVIDER = "deepseek"
$env:DIGITALME_VALUE_MODEL = "deepseek-chat"
$env:DIGITALME_LEARNING_QUALITY_FIX_01 = "1"

Write-Host "== Real DeepSeek Probe C =="
npx electron scripts/electron-probe-c-value-ab.cjs
$code = $LASTEXITCODE

Remove-Item Env:DEEPSEEK_API_KEY -ErrorAction SilentlyContinue
Write-Host "DEEPSEEK_API_KEY cleared from process env."

if ($code -ne 0) {
  Write-Host "Probe C failed with exit $code"
  exit $code
}

Write-Host "Done. Inspect latest probe-c evidence:"
Write-Host "  - learning.expressionCount expect >= 4"
Write-Host "  - learning.boundaryCount expect >= 1"
Write-Host "  - learn-job-wait.json status expect committed"
Write-Host "  - learn-job-pending-conflict.json must NOT appear"
exit 0

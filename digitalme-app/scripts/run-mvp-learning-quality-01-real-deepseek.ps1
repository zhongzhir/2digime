# MVP-LEARNING-QUALITY-01 — Owner 真实 DeepSeek 回归（一键）
# 用法（交互式 PowerShell）：
#   $env:DEEPSEEK_API_KEY = Read-Host "DeepSeek API Key"
#   $env:DIGITALME_VALUE_PROVIDER = "deepseek"
#   $env:DIGITALME_VALUE_MODEL = "deepseek-chat"
#   Set-Location "D:\Projects\Digital Me\digitalme-app"
#   .\scripts\run-mvp-learning-quality-01-real-deepseek.ps1
#
# 结束后清除密钥。不得把 Key 写入脚本、报告或 evidence。

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

Write-Host "== MVP-LEARNING-QUALITY-01 static tests =="
npm run test:mvp-learning-quality-01
if ($LASTEXITCODE -ne 0) { throw "static learning quality tests failed" }

if (-not $env:DEEPSEEK_API_KEY) {
  Write-Host "DEEPSEEK_API_KEY missing — static only. Status: real_model_regression_pending"
  exit 2
}

$env:DIGITALME_VALUE_PROVIDER = "deepseek"
$env:DIGITALME_VALUE_MODEL = "deepseek-chat"
$env:DIGITALME_LEARNING_QUALITY_01 = "1"

Write-Host "== Real DeepSeek Probe C (value A/B + learning audit) =="
npx electron scripts/electron-probe-c-value-ab.cjs
$code = $LASTEXITCODE

Remove-Item Env:DEEPSEEK_API_KEY -ErrorAction SilentlyContinue
Write-Host "DEEPSEEK_API_KEY cleared from process env."

if ($code -ne 0) {
  Write-Host "Probe C failed with exit $code"
  exit $code
}

Write-Host "Done. Check latest evidence under scripts/_mvp-value-validation-real-model-01-evidence/"
Write-Host "Expect: expression≈4, boundary≥1, body paragraphs not in long-term prefs, provenance fields present."
exit 0

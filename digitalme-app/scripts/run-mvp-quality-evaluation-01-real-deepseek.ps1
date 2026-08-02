# MVP-QUALITY-EVALUATION-01 — optional DeepSeek provider verification (NOT a closeout gate)
#
# Closeout path (OpenAI → DashScope):
#   $env:DIGITALME_QUALITY_EVAL_REAL = "1"
#   npm run test:mvp-quality-evaluation-01-document-real
#
# Optional DeepSeek only:
#   $env:DEEPSEEK_API_KEY = Read-Host "DeepSeek API Key"
#   .\scripts\run-mvp-quality-evaluation-01-real-deepseek.ps1
#
# Never writes key to evidence. Clears process DeepSeek key afterward.

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

if (-not $env:DEEPSEEK_API_KEY) {
  Write-Host "OPTIONAL SKIP: DEEPSEEK_API_KEY missing (not a closeout gate)."
  exit 0
}

$savedOpenAI = $env:OPENAI_API_KEY
$savedDash = $env:DASHSCOPE_API_KEY
Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:DASHSCOPE_API_KEY -ErrorAction SilentlyContinue

$env:DIGITALME_QUALITY_EVAL_REAL = "1"
$env:DIGITALME_QUALITY_EVAL_FORCE_DEEPSEEK = "1"
$env:DIGITALME_VALUE_MODEL = "deepseek-chat"

Write-Host "== optional DeepSeek document provider verification =="
node scripts/run-mvp-quality-evaluation-01-document-real-model.cjs
$code = $LASTEXITCODE

if ($savedOpenAI) { $env:OPENAI_API_KEY = $savedOpenAI } else { Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue }
if ($savedDash) { $env:DASHSCOPE_API_KEY = $savedDash } else { Remove-Item Env:DASHSCOPE_API_KEY -ErrorAction SilentlyContinue }
Remove-Item Env:DEEPSEEK_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:DIGITALME_QUALITY_EVAL_FORCE_DEEPSEEK -ErrorAction SilentlyContinue
Write-Host "DEEPSEEK_API_KEY cleared from process env."

exit $code

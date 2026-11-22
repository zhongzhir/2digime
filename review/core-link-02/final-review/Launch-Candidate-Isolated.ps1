$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$candidatePath = Join-Path $taskRoot 'release-staging\v2-tujimi-20261007T100528Z-54adc4ad\win-unpacked\兔机米.exe'
$expectedHash = 'f121d211d41091b3b340b6af058d2b344cc020aaf45eca427e6542d4b57654cc'
if ((Get-FileHash -LiteralPath $candidatePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { throw 'Candidate hash mismatch' }
$experiencePath = Join-Path $taskRoot 'build\owner-experience-54adc4a'
foreach ($item in Get-ChildItem Env:) { if ($item.Name -match '^DIGITALME_|API_KEY|GEMINI|DEEPSEEK|OPENAI|ANTHROPIC|ELECTRON_RUN_AS_NODE') { Remove-Item -LiteralPath ('Env:' + $item.Name) } }
$env:DIGITALME_V2_USER_DATA = Join-Path $experiencePath 'user-data'
$env:DIGITALME_V2_SEARCH_ENABLED = '0'
$env:DIGITALME_V2_ALLOW_DEV_CREDENTIAL = '0'
Write-Host ('Isolated historical package: ' + (Join-Path $experiencePath 'historical-package'))
Start-Process -FilePath $candidatePath -WorkingDirectory $taskRoot -WindowStyle Normal

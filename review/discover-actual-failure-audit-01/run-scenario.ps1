param(
  [Parameter(Mandatory=$true)][string]$Name,
  [Parameter(Mandatory=$true)][string]$Scenario,
  [string]$Source = 'owner-copy',
  [int]$CapMs = 480000,
  # 只在本次运行的副本里换一个新的安装身份（网关按安装每小时 30 次搜索）。不碰 Owner 副本本身。
  [switch]$FreshInstall
)
$ErrorActionPreference = 'Stop'
$audit = $PSScriptRoot
$root = Resolve-Path (Join-Path $audit '..\..')
# 运行产物只放仓库外，见 data-root.cjs。
$data = if ($env:AUDIT_DATA_ROOT) { $env:AUDIT_DATA_ROOT } else { Join-Path $root '..\_dm-audit-data\discover-actual-failure-audit-01' }
$run = Join-Path $data "runs\$Name"
if (Test-Path $run) { Remove-Item $run -Recurse -Force }
New-Item -ItemType Directory -Force $run | Out-Null
if ($Source -ne 'clean') {
  robocopy (Join-Path $data "$Source\userData") (Join-Path $run 'userData') /E /NFL /NDL /NJH /NJS /NP | Out-Null
}
if ($FreshInstall) { Remove-Item (Join-Path $run 'userData\install-capability-token.json') -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Force (Join-Path $run 'userData'), (Join-Path $run 'home') | Out-Null
$env:AUDIT_USER_DATA = Join-Path $run 'userData'
$env:AUDIT_HOME = Join-Path $run 'home'
$env:AUDIT_SCENARIO = $Scenario
$env:AUDIT_OUT = Join-Path $run 'trace.json'
$env:AUDIT_CAP_MS = "$CapMs"
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$sw = [Diagnostics.Stopwatch]::StartNew()
& $electron (Join-Path $audit 'harness-main.cjs') --no-sandbox 2>&1 | Out-File (Join-Path $run 'stdout.txt') -Encoding utf8
"exit=$LASTEXITCODE wall_ms=$($sw.ElapsedMilliseconds) trace=$($env:AUDIT_OUT)"

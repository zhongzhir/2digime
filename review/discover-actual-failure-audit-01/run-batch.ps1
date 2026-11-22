param(
  [Parameter(Mandatory=$true)][string]$Tag,
  [string]$Source = 'owner-copy',
  [string[]]$Queries
)
$audit = $PSScriptRoot
$i = 0
foreach ($q in $Queries) {
  $i += 1
  $name = "$Tag-$i"
  & (Join-Path $audit 'run-scenario.ps1') -Name $name -Scenario "seek:$q" -Source $Source -CapMs 150000 | Out-Null
  "=== [$name] $q"
  node (Join-Path $audit 'print-trace.cjs') $name 2>&1 | Select-String -Pattern 'INPUT|<< RET|notice:|FINAL|unjudgedTitles' | ForEach-Object { $_.Line.Substring(0, [Math]::Min(700, $_.Line.Length)) }
}

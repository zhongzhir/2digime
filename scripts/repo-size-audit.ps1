#Requires -Version 5.1
param(
  [string]$Root = "D:\Projects\Digital Me",
  [string]$OutDir = "D:\Projects\Digital Me",
  [string]$Prefix = "repo-size-before"
)

$ErrorActionPreference = "Continue"
Set-Location $Root

function Classify-Path {
  param([string]$Rel, [string]$Name)
  $r = ($Rel -replace '\\','/').ToLowerInvariant()
  $n = $Name.ToLowerInvariant()

  if ($r -eq '.git' -or $r -like '.git/*') { return 'git_metadata' }
  if ($r -like 'digital-me-package*' -or $r -like '.digitalme-pkgstore*' -or $r -like 'source-materials*' -or $r -like 'digitalme-app/project*' -or $r -like '参考*' -or $r -like '运营*') { return 'user_data' }
  if ($n -eq 'node_modules' -or $r -like '*/node_modules/*' -or $r -like 'node_modules/*' -or $r -like '*electron/cache*' -or $r -like '*.cache*') { return 'dev_deps' }
  if ($r -like '*dist-alpha-build-staging/20260731-173649-597225e*' -or $r -like '*_mvp-release-gate-01e-evidence/build-manifest*' -or $r -like '*_mvp-release-gate-01e-evidence/build-integrity*') { return 'current_build' }
  if ($r -like '*dist-alpha-build*' -or $r -like '*win-unpacked*' -or $r -like '*_superseded*' -or $n -match '\.(zip|7z|asar|bundle)$' -or $r -like 'dist-alpha*' -or $r -like '*closed-alpha-build*') { return 'historical_build' }
  if ($r -like '*_evidence*' -or $r -like '*.codex-qa*' -or $r -like '*test-results*' -or $r -like '*playwright-report*' -or $r -like '*coverage*' -or $n -match '\.(mp4|webm)$' -or $r -like 'outputs*' -or $r -like '*-evidence/*') { return 'test_evidence' }
  if ($r -match '(^|/)(tmp|temp)(/|$)' -or $n -match '\.(log|tmp|temp)$' -or $r -like '*.runtime*' -or $r -like '*userdata*' -or $r -like 'dm-account-b*' -or $r -like '*_suite*' -or $r -like '*_vite_*' -or $r -like '*_r2_*' -or $r -like '*_audit_*' -or $r -like '*_git_diff*') { return 'temp' }
  if ($r -like 'docs/*' -or $n -match '\.(md|json|yml|yaml|cjs|mjs|js|ts|tsx|css|html|txt)$' -or $r -like 'digitalme-app/src/*' -or $r -like 'digitalme-app/scripts/*' -or $r -like 'digitalme-app/e2e/*' -or $r -like 'scripts/*' -or $r -like 'build/reports*' -or $r -like '.cursor/rules*' -or $r -eq '.gitignore' -or $r -like 'digitalme-app/package*' -or $r -like 'digitalme-app/electron*' -or $r -like 'digitalme-app/playwright*' -or $r -like 'digitalme-app/readme*' -or $r -like '.gitignore') { return 'source_docs' }
  return 'unknown'
}

Write-Host "[1/5] Collecting git tracked set..."
$trackedSet = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
& git -C $Root ls-files 2>$null | ForEach-Object {
  [void]$trackedSet.Add($_)
  [void]$trackedSet.Add(($_ -replace '/','\'))
}
Write-Host ("  tracked entries: {0}" -f $trackedSet.Count)

Write-Host "[2/5] Walking filesystem via Get-ChildItem (several minutes)..."
$sw = [Diagnostics.Stopwatch]::StartNew()
$allFiles = New-Object System.Collections.Generic.List[object]
$dirAgg = @{}
$categoryAgg = @{}
$totalBytes = [int64]0
$totalFiles = 0
$totalDirs = 0

function Ensure-DirAgg([string]$rel) {
  if (-not $dirAgg.ContainsKey($rel)) {
    $dirAgg[$rel] = @{ bytes = [int64]0; files = 0; dirs = 0; trackedBytes = [int64]0; trackedFiles = 0 }
  }
}

function Add-ToAncestors([string]$relFile, [int64]$size, [bool]$tracked) {
  $parts = $relFile -split '[\\/]'
  $acc = ""
  for ($i = 0; $i -lt ($parts.Length - 1); $i++) {
    if ($acc -eq "") { $acc = $parts[$i] } else { $acc = "$acc\$($parts[$i])" }
    Ensure-DirAgg $acc
    $dirAgg[$acc].bytes += $size
    $dirAgg[$acc].files += 1
    if ($tracked) {
      $dirAgg[$acc].trackedBytes += $size
      $dirAgg[$acc].trackedFiles += 1
    }
  }
}

# Directories
Get-ChildItem -LiteralPath $Root -Recurse -Force -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  $totalDirs++
  $rel = $_.FullName.Substring($Root.Length).TrimStart('\')
  if (-not $rel) { return }
  Ensure-DirAgg $rel
  $parent = Split-Path $rel -Parent
  if ($parent) {
    Ensure-DirAgg $parent
    $dirAgg[$parent].dirs += 1
  }
}

# Files
Get-ChildItem -LiteralPath $Root -Recurse -Force -File -ErrorAction SilentlyContinue | ForEach-Object {
  try {
    $size = $_.Length
    $rel = $_.FullName.Substring($Root.Length).TrimStart('\')
    $ext = $_.Extension
    $tracked = $trackedSet.Contains($rel) -or $trackedSet.Contains(($rel -replace '\\','/'))
    $cat = Classify-Path -Rel $rel -Name $_.Name

    $totalBytes += $size
    $totalFiles++

    if (-not $categoryAgg.ContainsKey($cat)) {
      $categoryAgg[$cat] = @{ bytes = [int64]0; files = 0 }
    }
    $categoryAgg[$cat].bytes += $size
    $categoryAgg[$cat].files += 1

    Add-ToAncestors $rel $size $tracked

    $allFiles.Add([pscustomobject]@{
      path = $rel
      bytes = $size
      ext = $ext
      tracked = $tracked
      mtime = $_.LastWriteTimeUtc.ToString('o')
      category = $cat
    })
  } catch {}
}

$sw.Stop()
Write-Host ("  files={0} dirs={1} bytes={2} ({3} GB) elapsed={4}s" -f $totalFiles, $totalDirs, $totalBytes, [math]::Round($totalBytes/1GB,3), [math]::Round($sw.Elapsed.TotalSeconds,1))

Write-Host "[3/5] Top-level + rankings..."
$topLevel = @()
Get-ChildItem -LiteralPath $Root -Force -ErrorAction SilentlyContinue | ForEach-Object {
  $name = $_.Name
  $rel = $name
  $bytes = [int64]0; $files = 0; $dirs = 0; $trackedB = [int64]0; $trackedF = 0
  if ($_.PSIsContainer) {
    if ($dirAgg.ContainsKey($rel)) {
      $bytes = $dirAgg[$rel].bytes
      $files = $dirAgg[$rel].files
      $dirs = $dirAgg[$rel].dirs
      $trackedB = $dirAgg[$rel].trackedBytes
      $trackedF = $dirAgg[$rel].trackedFiles
    }
  } else {
    $bytes = $_.Length
    $files = 1
    $tracked = $trackedSet.Contains($rel) -or $trackedSet.Contains(($rel -replace '\\','/'))
    if ($tracked) { $trackedB = $bytes; $trackedF = 1 }
  }
  $cat = Classify-Path -Rel $rel -Name $name
  $topLevel += [pscustomobject]@{
    name = $name
    fullPath = $_.FullName
    isDirectory = [bool]$_.PSIsContainer
    fileCount = $files
    dirCount = $dirs
    bytes = $bytes
    mb = [math]::Round($bytes / 1MB, 2)
    gb = [math]::Round($bytes / 1GB, 3)
    gitTrackedArea = (($trackedF -gt 0) -or ($name -eq '.git'))
    trackedFileCount = $trackedF
    trackedBytes = $trackedB
    category = $cat
  }
}

$topDirs = $dirAgg.GetEnumerator() | ForEach-Object {
  [pscustomobject]@{
    path = $_.Key
    bytes = $_.Value.bytes
    mb = [math]::Round($_.Value.bytes / 1MB, 2)
    gb = [math]::Round($_.Value.bytes / 1GB, 3)
    fileCount = $_.Value.files
    dirCount = $_.Value.dirs
    trackedFiles = $_.Value.trackedFiles
    category = (Classify-Path -Rel $_.Key -Name (Split-Path $_.Key -Leaf))
  }
} | Sort-Object bytes -Descending | Select-Object -First 100

$topFiles = $allFiles | Sort-Object bytes -Descending | Select-Object -First 200 | ForEach-Object {
  [pscustomobject]@{
    path = $_.path
    bytes = $_.bytes
    mb = [math]::Round($_.bytes / 1MB, 2)
    ext = $_.ext
    tracked = $_.tracked
    mtimeUtc = $_.mtime
    category = $_.category
  }
}

$categories = $categoryAgg.GetEnumerator() | ForEach-Object {
  [pscustomobject]@{
    category = $_.Key
    bytes = $_.Value.bytes
    mb = [math]::Round($_.Value.bytes / 1MB, 2)
    gb = [math]::Round($_.Value.bytes / 1GB, 3)
    files = $_.Value.files
  }
} | Sort-Object bytes -Descending

$trackedBytes = [int64]0; $trackedCount = 0
$untrackedBytes = [int64]0; $untrackedCount = 0
foreach ($f in $allFiles) {
  if ($f.tracked) { $trackedBytes += $f.bytes; $trackedCount++ }
  else { $untrackedBytes += $f.bytes; $untrackedCount++ }
}

Write-Host "[4/5] Writing outputs..."
$result = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  root = $Root
  totals = [ordered]@{
    bytes = $totalBytes
    mb = [math]::Round($totalBytes / 1MB, 2)
    gb = [math]::Round($totalBytes / 1GB, 3)
    files = $totalFiles
    directories = $totalDirs
  }
  git = [ordered]@{
    trackedFiles = $trackedCount
    trackedBytes = $trackedBytes
    trackedMb = [math]::Round($trackedBytes / 1MB, 2)
    untrackedFiles = $untrackedCount
    untrackedBytes = $untrackedBytes
    untrackedMb = [math]::Round($untrackedBytes / 1MB, 2)
  }
  categories = @($categories)
  topLevel = @($topLevel | Sort-Object bytes -Descending)
  topDirectories = @($topDirs)
  topFiles = @($topFiles)
}

$jsonPath = Join-Path $OutDir "$Prefix.json"
$mdPath = Join-Path $OutDir "$Prefix.md"
[System.IO.File]::WriteAllText($jsonPath, ($result | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))

$sb = New-Object Text.StringBuilder
[void]$sb.AppendLine("# Repo Size Audit ($Prefix)")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("Generated: $($result.generatedAt)")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("## Totals")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("| Metric | Value |")
[void]$sb.AppendLine("|---|---|")
[void]$sb.AppendLine("| Bytes | $($result.totals.bytes) |")
[void]$sb.AppendLine("| MB | $($result.totals.mb) |")
[void]$sb.AppendLine("| GB | $($result.totals.gb) |")
[void]$sb.AppendLine("| Files | $($result.totals.files) |")
[void]$sb.AppendLine("| Directories | $($result.totals.directories) |")
[void]$sb.AppendLine("| Git tracked files | $($result.git.trackedFiles) ($($result.git.trackedMb) MB) |")
[void]$sb.AppendLine("| Git untracked files | $($result.git.untrackedFiles) ($($result.git.untrackedMb) MB) |")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("## Categories")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("| Category | GB | MB | Files |")
[void]$sb.AppendLine("|---|---:|---:|---:|")
foreach ($c in $categories) {
  [void]$sb.AppendLine("| $($c.category) | $($c.gb) | $($c.mb) | $($c.files) |")
}
[void]$sb.AppendLine("")
[void]$sb.AppendLine("## Top-level directories / files")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("| Name | Path | Files | Dirs | GB | MB | Git area | Category |")
[void]$sb.AppendLine("|---|---|---:|---:|---:|---:|---|---|")
foreach ($t in ($topLevel | Sort-Object bytes -Descending)) {
  [void]$sb.AppendLine("| $($t.name) | $($t.fullPath) | $($t.fileCount) | $($t.dirCount) | $($t.gb) | $($t.mb) | $($t.gitTrackedArea) | $($t.category) |")
}
[void]$sb.AppendLine("")
[void]$sb.AppendLine("## Top 100 directories")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("| # | Path | GB | MB | Files | Category |")
[void]$sb.AppendLine("|---:|---|---:|---:|---:|---|")
$i = 1
foreach ($d in $topDirs) {
  [void]$sb.AppendLine("| $i | $($d.path) | $($d.gb) | $($d.mb) | $($d.fileCount) | $($d.category) |")
  $i++
}
[void]$sb.AppendLine("")
[void]$sb.AppendLine("## Top 200 files")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("| # | Path | MB | Ext | Tracked | MTime UTC | Category |")
[void]$sb.AppendLine("|---:|---|---:|---|---|---|---|")
$i = 1
foreach ($f in $topFiles) {
  [void]$sb.AppendLine("| $i | $($f.path) | $($f.mb) | $($f.ext) | $($f.tracked) | $($f.mtimeUtc) | $($f.category) |")
  $i++
}
[System.IO.File]::WriteAllText($mdPath, $sb.ToString(), [Text.UTF8Encoding]::new($false))

Write-Host "[5/5] Done."
Write-Host "JSON: $jsonPath"
Write-Host "MD:   $mdPath"
Write-Host ("TOTAL: {0} GB / {1} files / {2} dirs" -f $result.totals.gb, $result.totals.files, $result.totals.directories)
Write-Host ("Tracked: {0} MB / Untracked: {1} MB" -f $result.git.trackedMb, $result.git.untrackedMb)

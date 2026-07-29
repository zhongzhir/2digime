param(
  [Parameter(Mandatory = $true)][string]$EvidenceDir,
  [string]$WindowTitle = "Digital Me"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$code = @"
using System;
using System.Runtime.InteropServices;
public static class DmWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public static void LeftClick() {
    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
  }
}
"@
Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue

function Save-Region([int]$left, [int]$top, [int]$width, [int]$height, [string]$name) {
  $bmp = New-Object System.Drawing.Bitmap $width, $height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($left, $top, 0, 0, (New-Object System.Drawing.Size($width, $height)))
  $path = Join-Path $EvidenceDir $name
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  return $path
}

function Click-At([int]$x, [int]$y) {
  [DmWin]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds 80
  [DmWin]::LeftClick()
  Start-Sleep -Milliseconds 280
}

New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null
$summary = [ordered]@{
  windowFound = $false
  openClicked = $false
  revealClicked = $false
  menuOpenEnabled = $true
  shots = @()
  notes = @()
  clickPoints = @()
  error = $null
}

try {
  $proc = $null
  for ($i = 0; $i -lt 50; $i++) {
    $proc = Get-Process | Where-Object { $_.MainWindowTitle -like "*$WindowTitle*" -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($proc) { break }
    Start-Sleep -Milliseconds 400
  }
  if (-not $proc) { throw "Digital Me window not found" }
  $summary.windowFound = $true
  $hwnd = $proc.MainWindowHandle

  [DmWin]::ShowWindow($hwnd, 3) | Out-Null
  Start-Sleep -Milliseconds 400
  [DmWin]::BringWindowToTop($hwnd) | Out-Null
  [DmWin]::SetForegroundWindow($hwnd) | Out-Null
  Start-Sleep -Milliseconds 900

  $rect = New-Object DmWin+RECT
  [DmWin]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
  $w = $rect.Right - $rect.Left
  $h = $rect.Bottom - $rect.Top
  $summary.notes += "windowRect=$($rect.Left),$($rect.Top),$($rect.Right),$($rect.Bottom)"

  # Capture top strip (title + menu).
  $summary.shots += (Save-Region $rect.Left $rect.Top $w ([Math]::Min(160, $h)) "shot-00-top-strip.png")

  # Native menu「文件」: first menu label under title bar.
  $fileX = $rect.Left + 42
  $fileY = $rect.Top + 44
  $summary.clickPoints += @{ name = "file"; x = $fileX; y = $fileY }
  Click-At $fileX $fileY
  Start-Sleep -Milliseconds 500
  $summary.shots += (Save-Region $rect.Left $rect.Top ([Math]::Min(420, $w)) 220 "shot-01-file-dropdown.png")

  # First item: 打开当前成果
  $openX = $rect.Left + 120
  $openY = $rect.Top + 72
  $summary.clickPoints += @{ name = "open-current"; x = $openX; y = $openY }
  Click-At $openX $openY
  $summary.openClicked = $true
  Start-Sleep -Milliseconds 1800
  $summary.shots += (Save-Region $rect.Left $rect.Top $w ([Math]::Min(240, $h)) "shot-02-after-open.png")

  # Reveal folder
  [DmWin]::SetForegroundWindow($hwnd) | Out-Null
  Start-Sleep -Milliseconds 500
  Click-At $fileX $fileY
  Start-Sleep -Milliseconds 500
  $summary.shots += (Save-Region $rect.Left $rect.Top ([Math]::Min(420, $w)) 220 "shot-03-file-dropdown-2.png")
  $revealX = $rect.Left + 140
  $revealY = $rect.Top + 98
  $summary.clickPoints += @{ name = "reveal-folder"; x = $revealX; y = $revealY }
  Click-At $revealX $revealY
  $summary.revealClicked = $true
  Start-Sleep -Milliseconds 1800
  $summary.shots += (Save-Region $rect.Left $rect.Top $w ([Math]::Min(240, $h)) "shot-04-after-reveal.png")

  # Detect explorer windows that may have opened.
  $explorers = @(Get-Process explorer -ErrorAction SilentlyContinue)
  $summary.notes += "explorerProcessCount=$($explorers.Count)"
  $summary.notes += "os_mouse_sendinput=true"
}
catch {
  $summary.error = $_.Exception.Message
}

$json = ($summary | ConvertTo-Json -Depth 8)
[System.IO.File]::WriteAllText((Join-Path $EvidenceDir "mouse-summary.json"), $json, [System.Text.UTF8Encoding]::new($false))
Write-Output $json
if ($summary.error) { exit 1 }
if (-not ($summary.openClicked -and $summary.revealClicked)) { exit 1 }
exit 0

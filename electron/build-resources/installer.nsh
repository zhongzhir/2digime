; NSIS CreateShortCut fails when the target path contains non-ASCII (兔机米.exe).
; Use PowerShell / WScript instead — same mature Windows shortcut API.
!macro customInstall
  SetShellVarContext current
  System::Call 'Kernel32::SetEnvironmentVariableW(w "TUJIMI_INSTDIR", w "$INSTDIR")'
  System::Call 'Kernel32::SetEnvironmentVariableW(w "TUJIMI_NAME", w "${SHORTCUT_NAME}")'
  System::Call 'Kernel32::SetEnvironmentVariableW(w "TUJIMI_EXE", w "${APP_EXECUTABLE_FILENAME}")'
  ExecWait 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$$n=$$env:TUJIMI_NAME; $$e=Join-Path $$env:TUJIMI_INSTDIR $$env:TUJIMI_EXE; if (-not (Test-Path -LiteralPath $$e)) { exit 2 }; $$ws=New-Object -ComObject WScript.Shell; foreach ($$dir in @([Environment]::GetFolderPath(\"Desktop\"), [Environment]::GetFolderPath(\"Programs\"))) { $$p=Join-Path $$dir ($$n + \".lnk\"); $$s=$$ws.CreateShortcut($$p); $$s.TargetPath=$$e; $$s.WorkingDirectory=$$env:TUJIMI_INSTDIR; $$s.IconLocation=$$e + \",0\"; $$s.Description=$$n; $$s.Save() }"'
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  SetShellVarContext current
  System::Call 'Kernel32::SetEnvironmentVariableW(w "TUJIMI_NAME", w "${SHORTCUT_NAME}")'
  ExecWait 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$$n=$$env:TUJIMI_NAME; foreach ($$dir in @([Environment]::GetFolderPath(\"Desktop\"), [Environment]::GetFolderPath(\"Programs\"))) { $$p=Join-Path $$dir ($$n + \".lnk\"); if (Test-Path -LiteralPath $$p) { Remove-Item -LiteralPath $$p -Force } }"'
!macroend

; WINDOWS-INSTALLER-TRUST-01
; Standard NSIS shortcuts only. Do not call powershell.exe / cmd.exe / wscript.
;
; electron-builder already creates Desktop + Start Menu links, but upgrade from
; the previous PowerShell customUnInstall can leave Start Menu missing because
; keepShortcuts will not recreate a deleted link. Recreate both with NSIS
; CreateShortCut (Unicode). Same API electron-builder uses.

!macro customInstall
  SetShellVarContext current
  CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 "" "" "${PRODUCT_NAME}"
  CreateShortCut "$SMPROGRAMS\${SHORTCUT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 "" "" "${PRODUCT_NAME}"
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  SetShellVarContext current
  Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
  Delete "$SMPROGRAMS\${SHORTCUT_NAME}.lnk"
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

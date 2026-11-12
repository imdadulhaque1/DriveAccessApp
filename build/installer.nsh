; Custom NSIS hooks for electron-builder.
; Goal: running the Setup ALWAYS gives a clean, working install — even if the app is
; already installed, open, or a previous install is broken.

; 1) "Is the app running?" check.
; The default check can report the app as running when it is not, which blocks
; installation with "DriveAccessApp cannot be closed". Instead: if the app is really
; running, end it silently; otherwise do nothing.
!macro customCheckAppRunning
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
  Pop $0
  ${if} $0 == 0
    Sleep 1000 ; give Windows a moment to release the files
  ${endif}
!macroend

; 2) Removing the previously installed version.
; By default, if the old uninstaller fails (e.g. a broken earlier install), the Setup
; shows an error and quits. Instead, continue: the new files overwrite the old ones.
!macro _driveAccessUninstallCheck
  ${if} ${Errors}
  ${orIf} $R0 != 0
    DetailPrint "Previous version could not be removed cleanly (code $R0); reinstalling over it."
  ${endIf}
  ClearErrors
!macroend

!macro customUnInstallCheck
  !insertmacro _driveAccessUninstallCheck
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro _driveAccessUninstallCheck
!macroend

; 3) After files are installed: always (re)create the Start Menu and Desktop shortcuts.
; On a reinstall electron-builder normally keeps the old shortcuts, so deleted or
; broken shortcuts were never repaired.
!macro customInstall
  ${if} ${FileExists} "$newStartMenuLink"
    Delete "$newStartMenuLink"
  ${endIf}
  CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
  WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"

  ${if} ${FileExists} "$newDesktopLink"
    Delete "$newDesktopLink"
  ${endIf}
  CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
  WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"

  ClearErrors
  ; refresh icons in Explorer
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

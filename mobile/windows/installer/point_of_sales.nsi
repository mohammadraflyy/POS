; Installer for the shop PC: the Flutter app with its built-in server.
; Built by build.ps1 next to this file - it passes VERSION, SOURCE_DIR and OUT_FILE.
;
; Per-user install (no admin prompt), like the old POS Desktop. The shop's data lives in
; %APPDATA%\point_of_sales and is never touched by installing, updating or uninstalling.

Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"

!ifndef VERSION
  !error "VERSION is required"
!endif
!ifndef SOURCE_DIR
  !error "SOURCE_DIR is required (flutter build windows output)"
!endif
!ifndef OUT_FILE
  !define OUT_FILE "Point-of-Sales-Setup-${VERSION}.exe"
!endif

!define APP_NAME "Point of Sales"
!define APP_EXE "point_of_sales.exe"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\PointOfSales"

Name "${APP_NAME}"
OutFile "${OUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\${APP_NAME}"
InstallDirRegKey HKCU "${UNINSTALL_KEY}" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64
BrandingText "${APP_NAME} ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "FileDescription" "${APP_NAME} Setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Copyright (C) 2026 ${APP_NAME}"

!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Buka ${APP_NAME} sekarang"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Indonesian"

; A running copy holds its files (and the database) open: ask to close it automatically
; or manually, so the cashier can finish any sale before replacing files.
!macro RequireAppClosed
  ${Do}
    ${IfNot} ${FileExists} "$INSTDIR\${APP_EXE}"
      ${Break}
    ${EndIf}
    ClearErrors
    FileOpen $0 "$INSTDIR\${APP_EXE}" a
    ${IfNot} ${Errors}
      FileClose $0
      ${Break}
    ${EndIf}
    MessageBox MB_YESNOCANCEL|MB_ICONQUESTION "${APP_NAME} sedang berjalan.$\r$\n$\r$\nApakah Anda ingin menutup aplikasi secara otomatis dan melanjutkan pembaruan?" /SD IDYES IDYES closeApp IDNO waitManual
    Abort

    closeApp:
      nsExec::Exec 'taskkill /IM "${APP_EXE}" /T /F'
      Sleep 1000
      ${Continue}

    waitManual:
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Silakan tutup ${APP_NAME}, lalu tekan Retry." /SD IDCANCEL IDRETRY retryAgain
      Abort
      retryAgain:
      ${Continue}
  ${Loop}
!macroend

Function .onInit
  !insertmacro RequireAppClosed
FunctionEnd

Function un.onInit
  !insertmacro RequireAppClosed
FunctionEnd

Section "Install"
  ; a first install opens the app when Windows starts - the shop PC is the server, so it
  ; should be up before the first phone looks for it. An upgrade keeps the owner's choice
  ; (Pengaturan > Buka otomatis saat PC menyala).
  ReadRegStr $1 HKCU "${UNINSTALL_KEY}" "DisplayVersion"
  ${If} $1 == ""
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_NAME}" '"$INSTDIR\${APP_EXE}"'
  ${EndIf}

  SetOutPath "$INSTDIR"
  ; replace the program wholesale so no file from an older version lingers
  RMDir /r "$INSTDIR\data"
  File /r "${SOURCE_DIR}\*.*"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\Uninstall ${APP_NAME}.lnk" "$INSTDIR\Uninstall.exe"

  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "${APP_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXE}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\${APP_NAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APP_NAME}"
  ; the program folder only - the shop's data in %APPDATA%\point_of_sales stays
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_NAME}"
  MessageBox MB_ICONINFORMATION "${APP_NAME} sudah dihapus.$\r$\n$\r$\nData toko tetap tersimpan di:$\r$\n$APPDATA\point_of_sales" /SD IDOK
SectionEnd

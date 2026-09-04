!include "StrFunc.nsh"
${StrStr}

!macro NSIS_HOOK_PREINSTALL
  ga_prereq_retry:
    StrCpy $R0 ""
    ReadRegStr $R0 HKCU "Software\Valve\Steam" "SteamPath"
    ${If} $R0 != ""
      IfFileExists "$R0\steam.exe" ga_steam_ok 0
    ${EndIf}

    SetRegView 32
    ReadRegStr $R0 HKLM "Software\Valve\Steam" "InstallPath"
    ${If} $R0 != ""
      IfFileExists "$R0\steam.exe" ga_steam_ok 0
    ${EndIf}

    SetRegView 64
    ReadRegStr $R0 HKLM "Software\Valve\Steam" "InstallPath"
    ${If} $R0 != ""
      IfFileExists "$R0\steam.exe" ga_steam_ok 0
    ${EndIf}

    StrCpy $R0 "$PROGRAMFILES32\Steam"
    IfFileExists "$R0\steam.exe" ga_steam_ok 0
    StrCpy $R0 "$PROGRAMFILES64\Steam"
    IfFileExists "$R0\steam.exe" ga_steam_ok 0
    StrCpy $R0 "C:\Steam"
    IfFileExists "$R0\steam.exe" ga_steam_ok ga_steam_missing

  ga_steam_missing:
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "GameAccess necesita Steam instalado en este equipo.$\r$\n$\r$\nInstalá Steam y luego elegí Reintentar. La instalación no continuará hasta detectarlo." IDRETRY ga_prereq_retry IDCANCEL ga_prereq_abort

  ga_steam_ok:
    IfFileExists "$R0\config\loginusers.vdf" ga_accounts_scan ga_accounts_missing

  ga_accounts_scan:
    ClearErrors
    FileOpen $R1 "$R0\config\loginusers.vdf" r
    IfErrors ga_accounts_missing
    StrCpy $R3 "0"
  ga_accounts_loop:
    ClearErrors
    FileRead $R1 $R2
    IfErrors ga_accounts_done
    ${StrStr} $R4 "$R2" "RememberPassword"
    StrCmp $R4 "" ga_accounts_loop 0
    ${StrStr} $R4 "$R2" "1"
    StrCmp $R4 "" ga_accounts_loop 0
    StrCpy $R3 "1"
  ga_accounts_done:
    FileClose $R1
    StrCmp $R3 "1" ga_prereq_done ga_accounts_missing

  ga_accounts_missing:
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "GameAccess necesita al menos una cuenta de Steam iniciada y recordada en este equipo.$\r$\n$\r$\nAbrí Steam, iniciá sesión, activá la opción de recordar la cuenta y luego elegí Reintentar." IDRETRY ga_prereq_retry IDCANCEL ga_prereq_abort

  ga_prereq_abort:
    Abort "Requisitos de GameAccess no satisfechos."

  ga_prereq_done:
    DetailPrint "GameAccess: Steam y cuenta recordada verificados."
!macroend

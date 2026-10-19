; GameAccess additions to the Tauri NSIS installer (wired in tauri.conf.json > bundle.windows.nsis.installerHooks).
;
; A page after the install folder lets the user choose where games and downloads go. The choice is stored in
; HKLM\Software\gameAccess (GamesDir, DownloadsDir, 64-bit view) and read by apps/launcher/launcher_data.py.
; DownloadsDir is only written when it differs from <Downloads>\GameAccessDownloads, so every Windows user keeps
; their own Downloads folder by default. Passive updates skip the page and keep the stored choice.
!include nsDialogs.nsh
!include LogicLib.nsh

!define GA_REGKEY "Software\gameAccess"
!define GA_DOWNLOADS_ID "{374DE290-123F-4565-9164-39C4925E467B}"

Var GaShown
Var GaGamesDir
Var GaDownloadsDir
Var GaDefaultDownloads
Var GaGamesField
Var GaDownloadsField
Var GaGamesText
Var GaDownloadsText

; Absolute local path (X:\...), not a disk root.
!macro GaCheckFolder path
  StrCpy $0 ${path} 2 1
  StrLen $1 ${path}
  ${If} $0 != ":\"
  ${OrIf} $1 < 4
    ${If} $LANGUAGE = 1034
      MessageBox MB_ICONEXCLAMATION "Elegí una carpeta completa, por ejemplo C:\juegos_GameAccess (no la raíz de un disco)."
    ${Else}
      MessageBox MB_ICONEXCLAMATION "Choose a full folder path, for example C:\juegos_GameAccess (not the root of a disk)."
    ${EndIf}
    Abort
  ${EndIf}
!macroend

; Inserted by windows/installer.nsi right after the install folder page, where the template's variables
; ($PassiveMode) already exist.
!macro GAMEACCESS_FOLDERS_PAGE
  Page custom GaFoldersCreate GaFoldersLeave

Function GaFoldersDefaults
  SetRegView 64
  ReadRegStr $GaGamesDir HKLM "${GA_REGKEY}" "GamesDir"
  ReadRegStr $GaDownloadsDir HKLM "${GA_REGKEY}" "DownloadsDir"
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders" "${GA_DOWNLOADS_ID}"
  SetRegView lastused
  ExpandEnvStrings $0 $0
  ${If} $0 == ""
    StrCpy $0 "$PROFILE\Downloads"
  ${EndIf}
  StrCpy $GaDefaultDownloads "$0\GameAccessDownloads"
  ${If} $GaGamesDir == ""
    StrCpy $0 $WINDIR 2
    StrCpy $GaGamesDir "$0\juegos_GameAccess"
  ${EndIf}
  ${If} $GaDownloadsDir == ""
    StrCpy $GaDownloadsDir $GaDefaultDownloads
  ${EndIf}
FunctionEnd

Function GaFoldersCreate
  ${If} $PassiveMode = 1
    Abort
  ${EndIf}
  ${If} $GaShown != 1
    Call GaFoldersDefaults
  ${EndIf}
  ${If} $LANGUAGE = 1034
    StrCpy $GaGamesText "Carpeta de juegos"
    StrCpy $GaDownloadsText "Carpeta de descargas"
    !insertmacro MUI_HEADER_TEXT "Carpetas de juegos y descargas" "Elegí dónde se guardan los juegos y las descargas."
    StrCpy $1 "Game Access instala los juegos en la carpeta de juegos y deja los archivos que baja en la carpeta de descargas. Podés cambiarlas ahora o más adelante en Configuración."
    StrCpy $2 "Examinar..."
    StrCpy $3 "La carpeta de juegos está compartida por todos los usuarios de esta PC. Las descargas van a la carpeta Descargas de cada usuario, salvo que elijas otra."
  ${Else}
    StrCpy $GaGamesText "Games folder"
    StrCpy $GaDownloadsText "Downloads folder"
    !insertmacro MUI_HEADER_TEXT "Games and downloads folders" "Choose where games and downloads are kept."
    StrCpy $1 "Game Access installs games in the games folder and keeps the files it downloads in the downloads folder. You can change them now or later in Settings."
    StrCpy $2 "Browse..."
    StrCpy $3 "The games folder is shared by every user of this PC. Downloads go to each user's Downloads folder unless you choose another one."
  ${EndIf}

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 26u $1
  Pop $0
  ${NSD_CreateLabel} 0 32u 100% 10u $GaGamesText
  Pop $0
  ${NSD_CreateDirRequest} 0 44u 76% 13u $GaGamesDir
  Pop $GaGamesField
  ${NSD_CreateBrowseButton} 78% 43u 22% 15u $2
  Pop $0
  ${NSD_OnClick} $0 GaBrowseGames
  ${NSD_CreateLabel} 0 66u 100% 10u $GaDownloadsText
  Pop $0
  ${NSD_CreateDirRequest} 0 78u 76% 13u $GaDownloadsDir
  Pop $GaDownloadsField
  ${NSD_CreateBrowseButton} 78% 77u 22% 15u $2
  Pop $0
  ${NSD_OnClick} $0 GaBrowseDownloads
  ${NSD_CreateLabel} 0 102u 100% 26u $3
  Pop $0
  StrCpy $GaShown 1
  nsDialogs::Show
FunctionEnd

Function GaBrowseGames
  ${NSD_GetText} $GaGamesField $0
  nsDialogs::SelectFolderDialog $GaGamesText $0
  Pop $0
  ${If} $0 != error
    ${NSD_SetText} $GaGamesField $0
  ${EndIf}
FunctionEnd

Function GaBrowseDownloads
  ${NSD_GetText} $GaDownloadsField $0
  nsDialogs::SelectFolderDialog $GaDownloadsText $0
  Pop $0
  ${If} $0 != error
    ${NSD_SetText} $GaDownloadsField $0
  ${EndIf}
FunctionEnd

Function GaFoldersLeave
  ${NSD_GetText} $GaGamesField $GaGamesDir
  ${NSD_GetText} $GaDownloadsField $GaDownloadsDir
  !insertmacro GaCheckFolder $GaGamesDir
  !insertmacro GaCheckFolder $GaDownloadsDir
  ${If} $GaGamesDir == $GaDownloadsDir
    ${If} $LANGUAGE = 1034
      MessageBox MB_ICONEXCLAMATION "Los juegos y las descargas necesitan carpetas distintas."
    ${Else}
      MessageBox MB_ICONEXCLAMATION "Games and downloads need different folders."
    ${EndIf}
    Abort
  ${EndIf}
FunctionEnd
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $GaShown == 1
    SetRegView 64
    WriteRegStr HKLM "${GA_REGKEY}" "GamesDir" $GaGamesDir
    ${If} $GaDownloadsDir == $GaDefaultDownloads
      DeleteRegValue HKLM "${GA_REGKEY}" "DownloadsDir"
    ${Else}
      WriteRegStr HKLM "${GA_REGKEY}" "DownloadsDir" $GaDownloadsDir
    ${EndIf}
    SetRegView lastused
    CreateDirectory $GaGamesDir
  ${EndIf}
!macroend

; Uninstalling Game Access also removes the source plugins it installed. Plugins live in each user's
; %APPDATA%\GameAccess\plugins (see plugin_install.rs) and keep running as their own process, so they are
; stopped first. Skipped when the uninstaller runs as part of an update (/UPDATE).
!define GA_PROFILES "SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList"

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    nsExec::Exec `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-Process | Where-Object { $$_.Path -like '*\GameAccess\plugins\*' } | Stop-Process -Force"`
    Pop $0
    Sleep 1000
    SetShellVarContext current
    RMDir /r "$APPDATA\GameAccess\plugins"
    RMDir "$APPDATA\GameAccess"
    DeleteRegKey HKCU "Software\Classes\gameaccess"
    !insertmacro SetContext
    SetRegView 64
    StrCpy $1 0
    ga_profiles_loop:
      EnumRegKey $2 HKLM "${GA_PROFILES}" $1
      StrCmp $2 "" ga_profiles_done
      ReadRegStr $3 HKLM "${GA_PROFILES}\$2" "ProfileImagePath"
      ExpandEnvStrings $3 $3
      ${If} $3 != ""
      ${AndIf} ${FileExists} "$3\AppData\Roaming\GameAccess\plugins\*.*"
        RMDir /r "$3\AppData\Roaming\GameAccess\plugins"
        RMDir "$3\AppData\Roaming\GameAccess"
      ${EndIf}
      IntOp $1 $1 + 1
      Goto ga_profiles_loop
    ga_profiles_done:
    SetRegView lastused
  ${EndIf}
!macroend

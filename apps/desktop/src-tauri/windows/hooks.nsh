; GameAccess additions to the Tauri NSIS installer (wired in tauri.conf.json > bundle.windows.nsis.installerHooks).
;
; A page after the install folder lets the user choose where games and downloads go. The choice is stored in
; HKLM\Software\gameAccess (GamesDir, DownloadsDir, 64-bit view) and read by apps/launcher/launcher_data.py.
; DownloadsDir is only written when it differs from <Downloads>\GameAccessDownloads, so every Windows user keeps
; their own Downloads folder by default. The same page asks whether parental control starts on (checked by default;
; ParentalDefault 1/0, read by apps/desktop/src-tauri/src/parental_lock.rs; the password is created in the app).
; Passive updates skip the page and keep the stored choice.
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
Var GaParental
Var GaParentalBox

; Absolute local path (X:\...), not a disk root.
!macro GaCheckFolder path
  StrCpy $0 ${path} 2 1
  StrLen $1 ${path}
  ${If} $0 != ":\"
  ${OrIf} $1 < 4
    ${If} $LANGUAGE = 1034
      MessageBox MB_ICONEXCLAMATION "Elegí una carpeta completa, por ejemplo C:\GA_Juegos (no la raíz de un disco)."
    ${Else}
      MessageBox MB_ICONEXCLAMATION "Choose a full folder path, for example C:\GA_Juegos (not the root of a disk)."
    ${EndIf}
    Abort
  ${EndIf}
!macroend

; Inserted by windows/installer.nsi right after the install folder page, where the template's variables
; ($PassiveMode) already exist.
!macro GAMEACCESS_FOLDERS_PAGE
  Page custom GaFoldersCreate GaFoldersLeave

; $R0 = a folder -> $R1 = 1 when games may not start from it: longer than 40 characters (the limit
; apps/launcher/game_paths.py uses), or holding characters other than letters, digits, space, backslash and
; _ - . : (a comment line must not end in a backslash: NSIS joins it with the next one).
Function GaPathRisky
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  StrCpy $R1 0
  StrLen $R2 $R0
  ${If} $R2 > 40
    StrCpy $R1 1
  ${EndIf}
  StrCpy $R5 "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _-.:\"
  StrCpy $R3 0
  ${DoWhile} $R3 < $R2
    ${If} $R1 == 1
      ${ExitDo}
    ${EndIf}
    StrCpy $R4 $R0 1 $R3
    ; S== compares exact characters, so an accented letter never passes as the plain one.
    StrCpy $R6 0
    StrCpy $R1 1
    ${Do}
      StrCpy $0 $R5 1 $R6
      ${If} $0 == ""
      ${OrIf} $0 S== $R4
        ${ExitDo}
      ${EndIf}
      IntOp $R6 $R6 + 1
    ${Loop}
    ${If} $0 S== $R4
      StrCpy $R1 0
    ${EndIf}
    IntOp $R3 $R3 + 1
  ${Loop}
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
FunctionEnd

Function GaFoldersDefaults
  SetRegView 64
  ReadRegStr $GaGamesDir HKLM "${GA_REGKEY}" "GamesDir"
  ReadRegStr $GaDownloadsDir HKLM "${GA_REGKEY}" "DownloadsDir"
  ReadRegStr $GaParental HKLM "${GA_REGKEY}" "ParentalDefault"
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders" "${GA_DOWNLOADS_ID}"
  SetRegView lastused
  ExpandEnvStrings $0 $0
  ${If} $0 == ""
    StrCpy $0 "$PROFILE\Downloads"
  ${EndIf}
  StrCpy $GaDefaultDownloads "$0\GameAccessDownloads"
  ${If} $GaGamesDir == ""
    ; Short and plain at the root of the disk: some games do not start from long paths (apps/launcher/game_paths.py).
    ; A PC that already keeps its games in the old default folder goes on using it.
    StrCpy $0 $WINDIR 2
    ${If} ${FileExists} "$0\juegos_GameAccess\*.*"
      StrCpy $GaGamesDir "$0\juegos_GameAccess"
    ${Else}
      StrCpy $GaGamesDir "$0\GA_Juegos"
    ${EndIf}
  ${EndIf}
  ${If} $GaDownloadsDir == ""
    StrCpy $GaDownloadsDir $GaDefaultDownloads
  ${EndIf}
  ${If} $GaParental != "0"
    StrCpy $GaParental "1"
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
    StrCpy $4 "Activar el control parental (oculta los juegos para adultos; la contraseña se crea al abrir Game Access)"
  ${Else}
    StrCpy $GaGamesText "Games folder"
    StrCpy $GaDownloadsText "Downloads folder"
    !insertmacro MUI_HEADER_TEXT "Games and downloads folders" "Choose where games and downloads are kept."
    StrCpy $1 "Game Access installs games in the games folder and keeps the files it downloads in the downloads folder. You can change them now or later in Settings."
    StrCpy $2 "Browse..."
    StrCpy $3 "The games folder is shared by every user of this PC. Downloads go to each user's Downloads folder unless you choose another one."
    StrCpy $4 "Turn on parental control (hides adult games; the password is created when Game Access opens)"
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
  ${NSD_CreateLabel} 0 100u 100% 20u $3
  Pop $0
  ${NSD_CreateCheckbox} 0 124u 100% 12u $4
  Pop $GaParentalBox
  ${If} $GaParental == "1"
    ${NSD_Check} $GaParentalBox
  ${EndIf}
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
  ${NSD_GetState} $GaParentalBox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $GaParental "1"
  ${Else}
    StrCpy $GaParental "0"
  ${EndIf}
  !insertmacro GaCheckFolder $GaGamesDir
  !insertmacro GaCheckFolder $GaDownloadsDir
  ; A long games folder, or one with accents or symbols: warned, and the player decides.
  StrCpy $R0 $GaGamesDir
  Call GaPathRisky
  ${If} $R1 == 1
    ${If} $LANGUAGE = 1034
      StrCpy $1 "La carpeta de juegos es larga o tiene acentos o símbolos.$\r$\n$\r$\nAlgunos juegos no arrancan desde rutas largas o con caracteres especiales. Conviene una carpeta corta en la raíz del disco, como C:\GA_Juegos.$\r$\n$\r$\n¿Usar esta carpeta igual?"
    ${Else}
      StrCpy $1 "The games folder is long or has accents or symbols.$\r$\n$\r$\nSome games do not start from long paths or paths with special characters. A short folder at the root of the disk is better, such as C:\GA_Juegos.$\r$\n$\r$\nUse this folder anyway?"
    ${EndIf}
    MessageBox MB_YESNO|MB_ICONEXCLAMATION $1 /SD IDYES IDYES gaGamesPathOk
    Abort
    gaGamesPathOk:
  ${EndIf}
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

; Kid mode's restrictor (src-tauri/src/restrictor.rs) is this same executable run by Windows as a service: it is
; stopped before the files are replaced (an update included), or the executable could not be overwritten.
!define GA_RESTRICTOR "GameAccessRestrictor"
!macro NSIS_HOOK_PREINSTALL
  nsExec::Exec `sc.exe stop ${GA_RESTRICTOR}`
  Pop $0
  Sleep 1500
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; The restrictor owns its settings folder: users only read it (the parent's Game Access asks the service for every
  ; change, with the parent's key: restrictor_pipe.rs), SYSTEM and administrators change it. The service narrows it again
  ; at every start. Then the service is registered (or pointed at this executable), restarted if it stops, and started.
  ReadEnvStr $1 ProgramData
  CreateDirectory "$1\GameAccess\restriccion"
  nsExec::Exec `icacls "$1\GameAccess\restriccion" /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F *S-1-5-32-545:(OI)(CI)RX /Q`
  Pop $0
  ; What is inside inherits the folder's permissions (an earlier version left files with none).
  nsExec::Exec `icacls "$1\GameAccess\restriccion\*" /reset /T /Q`
  Pop $0
  nsExec::Exec `sc.exe create ${GA_RESTRICTOR} binPath= "\"$INSTDIR\${MAINBINARYNAME}.exe\" --restrictor" start= auto DisplayName= "Game Access kid mode"`
  Pop $0
  nsExec::Exec `sc.exe config ${GA_RESTRICTOR} binPath= "\"$INSTDIR\${MAINBINARYNAME}.exe\" --restrictor" start= auto`
  Pop $0
  nsExec::Exec `sc.exe description ${GA_RESTRICTOR} "Kid mode: only the allowed games and programs run while it is on."`
  Pop $0
  nsExec::Exec `sc.exe failure ${GA_RESTRICTOR} reset= 86400 actions= restart/1000/restart/1000/restart/1000`
  Pop $0
  nsExec::Exec `sc.exe start ${GA_RESTRICTOR}`
  Pop $0
  ${If} $GaShown == 1
    SetRegView 64
    WriteRegStr HKLM "${GA_REGKEY}" "GamesDir" $GaGamesDir
    ${If} $GaDownloadsDir == $GaDefaultDownloads
      DeleteRegValue HKLM "${GA_REGKEY}" "DownloadsDir"
    ${Else}
      WriteRegStr HKLM "${GA_REGKEY}" "DownloadsDir" $GaDownloadsDir
    ${EndIf}
    WriteRegStr HKLM "${GA_REGKEY}" "ParentalDefault" $GaParental
    SetRegView lastused
    CreateDirectory $GaGamesDir
  ${EndIf}
!macroend

; Uninstalling also deletes the children's Windows accounts that kid mode made (kid-account.ps1 -RemoveAll): an
; account whose desktop is Game Access would be a black screen without it. Runs before the files go (the script is
; in the install folder) and never in an update, which would otherwise erase the account at every new version.
!macro NSIS_HOOK_PREUNINSTALL
  ; The restrictor is stopped in any case (its executable goes), and removed unless this is an update.
  nsExec::Exec `sc.exe stop ${GA_RESTRICTOR}`
  Pop $0
  Sleep 1500
  ${If} $UpdateMode <> 1
    nsExec::Exec `sc.exe delete ${GA_RESTRICTOR}`
    Pop $0
  ${EndIf}
  ${If} $UpdateMode <> 1
  ${AndIf} ${FileExists} "$INSTDIR\runtime\kid-account.ps1"
    nsExec::Exec `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\runtime\kid-account.ps1" -RemoveAll`
    Pop $0
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

; Steam has to be installed before Game Access: the library brings in the Steam games and plays them signed in to
; the account that owns each one. Found through the registry (SteamPath of the user, InstallPath of the machine) or
; the default folder. Without it the installer offers Steam's download page and stops. Updates skip the check.
!macro GAMEACCESS_REQUIRE_STEAM
  ${If} $UpdateMode <> 1
    ReadRegStr $0 HKCU "Software\Valve\Steam" "SteamPath"
    ${If} $0 == ""
      SetRegView 32
      ReadRegStr $0 HKLM "SOFTWARE\Valve\Steam" "InstallPath"
      SetRegView lastused
    ${EndIf}
    ${If} $0 == ""
    ${AndIf} ${FileExists} "$PROGRAMFILES32\Steam\steam.exe"
      StrCpy $0 "$PROGRAMFILES32\Steam"
    ${EndIf}
    ${If} $0 == ""
      ${If} ${Silent}
        Abort
      ${EndIf}
      ${If} $LANGUAGE = 1034
        MessageBox MB_ICONEXCLAMATION|MB_YESNO "Game Access necesita Steam instalado antes.$\r$\n$\r$\n¿Abrir la página de descarga de Steam? Después de instalar Steam, volvé a ejecutar este instalador." IDNO ga_steam_quit
      ${Else}
        MessageBox MB_ICONEXCLAMATION|MB_YESNO "Game Access needs Steam to be installed first.$\r$\n$\r$\nOpen the Steam download page? Run this installer again once Steam is installed." IDNO ga_steam_quit
      ${EndIf}
      ExecShell "open" "https://store.steampowered.com/about/"
      ga_steam_quit:
      Quit
    ${EndIf}
  ${EndIf}
!macroend

; GameAccess additions to the Tauri NSIS installer (wired in tauri.conf.json > bundle.windows.nsis.installerHooks).
;
; A page after the install folder lets the user choose where games and downloads go. The choice is stored in
; HKLM\Software\gameAccess (GamesDir, DownloadsDir, 64-bit view) and read by apps/launcher/launcher_data.py.
; DownloadsDir is only written when it differs from <Downloads>\GameAccessDownloads, so every Windows user keeps
; their own Downloads folder by default. The same page asks whether parental control starts on (checked by default;
; ParentalDefault 1/0, read by apps/desktop/src-tauri/src/parental_lock.rs; the password is created in the app).
; Its own page asks whether the controller's button goes to Game Access instead of Steam (checked by default;
; GuideRedirect 1/0, read by apps/desktop/src-tauri/src/steam_guide.rs, which turns Steam's setting off).
; Passive updates skip the pages and keep the stored choice.
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
Var GaAntivirus
Var GaAntivirusBox
Var GaGuide
Var GaGuideBox

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
  Page custom GaAntivirusCreate GaAntivirusLeave
  Page custom GaGuideCreate GaGuideLeave

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
  ReadRegStr $GaGuide HKLM "${GA_REGKEY}" "GuideRedirect"
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
  ${If} $GaGuide != "0"
    StrCpy $GaGuide "1"
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

; The antivirus page: whether Microsoft Defender leaves the two folders alone (only for direct download). Checked by
; default; NSIS_HOOK_POSTINSTALL runs defender-exclusion.ps1, which skips folders already covered by an exclusion and
; records the result in HKLM\Software\gameAccess (DefenderExclusions) for the app (antivirusExclusion.ts).
Function GaAntivirusCreate
  ${If} $PassiveMode = 1
    Abort
  ${EndIf}
  ${If} $GaAntivirus == ""
    StrCpy $GaAntivirus "1"
  ${EndIf}
  ${If} $LANGUAGE = 1034
    !insertmacro MUI_HEADER_TEXT "Antivirus" "Que el antivirus no rompa los juegos de descarga directa."
    StrCpy $1 "Los fixes y cracks de los juegos de descarga directa a veces se marcan como amenaza aunque no lo sean (falsos positivos). El antivirus borra esa DLL o ese .exe sin avisar y el juego deja de abrir."
    StrCpy $2 "Por eso conviene que Microsoft Defender no revise la carpeta de juegos ni la de descargas. Solo hace falta para la descarga directa: los juegos de Steam y los vinculados no lo necesitan, y el resto de la PC se sigue revisando como siempre."
    StrCpy $3 "Excluir la carpeta de juegos y la de descargas de Microsoft Defender"
    StrCpy $4 "Si usás otro antivirus, Game Access te muestra cómo hacerlo al abrirse."
  ${Else}
    !insertmacro MUI_HEADER_TEXT "Antivirus" "Keep the antivirus from breaking direct-download games."
    StrCpy $1 "The fixes and cracks of direct-download games are sometimes flagged as threats although they are not (false positives). The antivirus deletes that DLL or .exe without a word and the game no longer starts."
    StrCpy $2 "So Microsoft Defender should leave the games folder and the downloads folder alone. It is only needed for direct download: Steam and linked games do not need it, and the rest of the PC is checked as usual."
    StrCpy $3 "Exclude the games folder and the downloads folder from Microsoft Defender"
    StrCpy $4 "If you use another antivirus, Game Access shows you how when it opens."
  ${EndIf}
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 30u $1
  Pop $0
  ${NSD_CreateLabel} 0 36u 100% 30u $2
  Pop $0
  ${NSD_CreateLabel} 0 72u 100% 22u "$GaGamesDir$\r$\n$GaDownloadsDir"
  Pop $0
  ${NSD_CreateCheckbox} 0 100u 100% 12u $3
  Pop $GaAntivirusBox
  ${If} $GaAntivirus == "1"
    ${NSD_Check} $GaAntivirusBox
  ${EndIf}
  ${NSD_CreateLabel} 0 118u 100% 12u $4
  Pop $0
  nsDialogs::Show
FunctionEnd

Function GaAntivirusLeave
  ${NSD_GetState} $GaAntivirusBox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $GaAntivirus "1"
  ${Else}
    StrCpy $GaAntivirus "0"
  ${EndIf}
FunctionEnd

; The controller page: the Xbox button opens Game Access instead of Steam's Big Picture.
Function GaGuideCreate
  ${If} $PassiveMode = 1
    Abort
  ${EndIf}
  ${If} $LANGUAGE = 1034
    !insertmacro MUI_HEADER_TEXT "Botón del mando" "Qué abre el botón Xbox del mando."
    StrCpy $1 "Steam abre su Big Picture con el botón Xbox del mando y tapa a Game Access. Con esta opción el botón abre el modo Big Picture de Game Access, aunque Game Access esté cerrado. Durante una partida el botón queda para el juego."
    StrCpy $2 "Deshabilitar el botón del mando que abre Steam y usarlo para abrir Game Access"
    StrCpy $3 "Se puede cambiar después en Configuración › Steam. Si Steam está abierto, Game Access lo reinicia una vez para aplicarlo."
  ${Else}
    !insertmacro MUI_HEADER_TEXT "Controller button" "What the controller's Xbox button opens."
    StrCpy $1 "Steam opens its Big Picture with the controller's Xbox button and covers Game Access. With this option the button opens Game Access's big picture mode, even with Game Access closed. During a game the button stays with the game."
    StrCpy $2 "Disable the controller button that opens Steam and use it to open Game Access"
    StrCpy $3 "You can change it later in Settings › Steam. If Steam is open, Game Access restarts it once to apply this."
  ${EndIf}
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 40u $1
  Pop $0
  ${NSD_CreateCheckbox} 0 48u 100% 12u $2
  Pop $GaGuideBox
  ${If} $GaGuide != "0"
    ${NSD_Check} $GaGuideBox
  ${EndIf}
  ${NSD_CreateLabel} 0 68u 100% 22u $3
  Pop $0
  nsDialogs::Show
FunctionEnd

Function GaGuideLeave
  ${NSD_GetState} $GaGuideBox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $GaGuide "1"
  ${Else}
    StrCpy $GaGuide "0"
  ${EndIf}
FunctionEnd
!macroend

; What earlier versions left behind and nothing uses any more (vault/Modo niño.md, MN.23): the same-account kid
; mode's service and its folder, Windows' password for administrator tasks where Game Access turned it on, and a
; family file whose children's accounts are gone. Every install and update, kid mode set up or not.
!macro NSIS_HOOK_POSTINSTALL
  ${If} ${FileExists} "$INSTDIR\runtime\kid-account.ps1"
    nsExec::Exec `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\runtime\kid-account.ps1" -CleanStale`
    Pop $0
  ${EndIf}
  ${If} $GaShown == 1
    SetRegView 64
    WriteRegStr HKLM "${GA_REGKEY}" "GamesDir" $GaGamesDir
    ${If} $GaDownloadsDir == $GaDefaultDownloads
      DeleteRegValue HKLM "${GA_REGKEY}" "DownloadsDir"
    ${Else}
      WriteRegStr HKLM "${GA_REGKEY}" "DownloadsDir" $GaDownloadsDir
    ${EndIf}
    WriteRegStr HKLM "${GA_REGKEY}" "ParentalDefault" $GaParental
    WriteRegStr HKLM "${GA_REGKEY}" "GuideRedirect" $GaGuide
    SetRegView lastused
    CreateDirectory $GaGamesDir
    ; The antivirus page (the installer already runs as administrator: no second permission question). The 64-bit
    ; PowerShell when there is one, so Defender's module and the registry are the machine's own.
    ${If} $GaAntivirus == "1"
    ${AndIf} ${FileExists} "$INSTDIR\runtime\defender-exclusion.ps1"
      StrCpy $1 "powershell.exe"
      ${If} ${FileExists} "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
        StrCpy $1 "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
      ${EndIf}
      DetailPrint "Microsoft Defender: $GaGamesDir | $GaDownloadsDir"
      nsExec::Exec `"$1" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\runtime\defender-exclusion.ps1" -Paths "$GaGamesDir|$GaDownloadsDir"`
      Pop $0
    ${EndIf}
  ${EndIf}
!macroend

; Uninstalling also deletes the children's Windows accounts that kid mode made (kid-account.ps1 -RemoveAll): an
; account whose desktop is Game Access would be a black screen without it. Runs before the files go (the script is
; in the install folder) and never in an update, which would otherwise erase the account at every new version.
!macro NSIS_HOOK_PREUNINSTALL
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
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "GameAccessGuideButton"
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

; The controller's watcher is this same program with no window (steam_guide.rs): it goes first, or the check below
; would ask the player to close an app that is not open, and the program could not be replaced.
!macro GAMEACCESS_STOP_GUIDE_WATCH
  nsExec::Exec `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \"Name='${MAINBINARYNAME}.exe'\" | Where-Object { $$_.CommandLine -like '*--guide-watch*' } | Invoke-CimMethod -MethodName Terminate"`
  Pop $0
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

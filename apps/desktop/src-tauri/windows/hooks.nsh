!macro NSIS_HOOK_PREINSTALL
  InitPluginsDir
  File /oname=$PLUGINSDIR\gameaccess-check-prerequisites.ps1 "${__FILEDIR__}\check-prerequisites.ps1"
  ga_prereq_retry:
    nsExec::ExecToStack 'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\gameaccess-check-prerequisites.ps1"'
    Pop $0
    Pop $1
    ${If} $0 == 0
      DetailPrint "GameAccess prerequisites: $1"
      Goto ga_prereq_done
    ${ElseIf} $0 == 20
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "GameAccess necesita Steam instalado en este equipo.$\r$\n$\r$\nInstalá Steam y luego elegí Reintentar. La instalación no continuará hasta detectarlo." IDRETRY ga_prereq_retry IDCANCEL ga_prereq_abort
    ${ElseIf} $0 == 30
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "GameAccess necesita al menos una cuenta de Steam iniciada y recordada en este equipo.$\r$\n$\r$\nAbrí Steam, iniciá sesión, dejá la cuenta recordada y luego elegí Reintentar." IDRETRY ga_prereq_retry IDCANCEL ga_prereq_abort
    ${Else}
      MessageBox MB_RETRYCANCEL|MB_ICONSTOP "No se pudieron validar los requisitos de GameAccess.$\r$\n$\r$\nDetalle: $1$\r$\nCódigo: $0" IDRETRY ga_prereq_retry IDCANCEL ga_prereq_abort
    ${EndIf}
  ga_prereq_abort:
    Abort "Requisitos de GameAccess no satisfechos."
  ga_prereq_done:
!macroend

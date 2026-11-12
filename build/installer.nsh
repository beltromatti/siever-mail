; SIEVER Mail's own steps in its Windows installer and uninstaller.
;
; Closing the app. Before an update replaces it, or an uninstall takes it
; away, the app is asked to close as the user would close it
; (`--siever-quit`): it finishes what it was writing — a draft, a message
; leaving the outbox — and quits. Only an app that does not quit in time is
; stopped, as electron-builder does by default.
;
; Uninstalling (vision §13.2). The user decides what stays: the connections
; — the mailboxes and calendars with their accesses, so the next install
; finds them connected — or nothing. The choice comes from the app
; (Impostazioni › Dati, `--siever-keep=`) or is asked here. The clearing is
; the app's own (`--siever-uninstall`), the same on every system. During an
; update nothing is asked and nothing is cleared: the new version takes the
; data as it is. A silent uninstall nobody chose for leaves the data as it is.

; What electron-builder's own way of closing the app needs, which it leaves out when an app has
; its own: this one ends with it.
!include "getProcessInfo.nsh"
Var pid

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
  ${if} $R0 == 0
    DetailPrint "Chiudo ${PRODUCT_NAME}…"
    Exec `"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --siever-quit`
    StrCpy $R1 0
    sieverWaitForQuit:
      Sleep 500
      IntOp $R1 $R1 + 1
      !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
      ${if} $R0 == 0
        ${if} $R1 < 30
          Goto sieverWaitForQuit
        ${endIf}
      ${endIf}
  ${endIf}
  ; Still running: electron-builder's own way, which asks and then stops it.
  !insertmacro _CHECK_APP_RUNNING
!macroend

!macro customUnInit
  Var /GLOBAL sieverKeep
  StrCpy $sieverKeep ""

  ${ifNot} ${isUpdated}
    ${GetParameters} $R0
    ClearErrors
    ${GetOptions} $R0 "--siever-keep=" $R1

    ${ifNot} ${Errors}
      StrCpy $sieverKeep $R1
    ${else}
      ${ifNot} ${Silent}
        MessageBox MB_YESNOCANCEL|MB_ICONQUESTION|MB_DEFBUTTON1 "Vuoi tenere le connessioni di SIEVER Mail?$\n$\nSì: restano solo le caselle e i calendari, con i loro accessi. Installandolo di nuovo li ritrovi già collegati; tutto il resto si toglie.$\n$\nNo: si toglie tutto. Non resta niente di SIEVER Mail su questo computer.$\n$\nAnnulla: SIEVER Mail resta installato." IDYES sieverKeepConnections IDNO sieverKeepNothing
        Quit

        sieverKeepConnections:
          StrCpy $sieverKeep "connessioni"
          Goto sieverKeepChosen

        sieverKeepNothing:
          StrCpy $sieverKeep "niente"

        sieverKeepChosen:
      ${endIf}
    ${endIf}
  ${endIf}
!macroend

!macro customUnInstall
  ${if} $sieverKeep == "connessioni"
  ${orIf} $sieverKeep == "niente"
    ; The profile is the user's own, also when the app was installed for every user.
    ${if} $installMode == "all"
      SetShellVarContext current
    ${endIf}
    StrCpy $R2 "$APPDATA\${APP_PACKAGE_NAME}"
    ${if} $installMode == "all"
      SetShellVarContext all
    ${endIf}

    InitPluginsDir
    DetailPrint "Tolgo i dati di ${PRODUCT_NAME}…"
    ; Its own Chromium profile, so the one it clears is held by nobody.
    ; Asked from the app, the uninstaller runs unseen: the app's own message says how it went.
    StrCpy $R4 ""
    ${if} ${Silent}
      StrCpy $R4 " --siever-tell"
    ${endIf}
    ExecWait `"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --siever-uninstall=$sieverKeep "--siever-profile=$R2" "--user-data-dir=$PLUGINSDIR\siever-mail-disinstalla"$R4` $R3

    ${if} $R3 != 0
    ${andIfNot} ${Silent}
      MessageBox MB_OK|MB_ICONEXCLAMATION "Una parte dei dati di ${PRODUCT_NAME} non si è potuta togliere: resta in $R2, e si può togliere a mano."
    ${endIf}
  ${endIf}
!macroend

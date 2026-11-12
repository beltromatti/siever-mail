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

; Its words, in the installer's languages (electron-builder.yml, `installerLanguages`): the one
; Windows speaks, if it is one of them, else English. By language id, as electron-builder writes
; its own: the languages are loaded after this file — 1033 English, 1040 Italian, 1031 German.
LangString sieverClosing 1033 "Closing ${PRODUCT_NAME}…"
LangString sieverClosing 1040 "Chiudo ${PRODUCT_NAME}…"
LangString sieverClosing 1031 "${PRODUCT_NAME} wird geschlossen…"

LangString sieverKeepQuestion 1033 "Do you want to keep SIEVER Mail’s connections?$\n$\nYes: only the mailboxes and the calendars stay, with their sign-ins. Install it again and you find them already connected; everything else is removed.$\n$\nNo: everything is removed. Nothing of SIEVER Mail stays on this computer.$\n$\nCancel: SIEVER Mail stays installed."
LangString sieverKeepQuestion 1040 "Vuoi tenere le connessioni di SIEVER Mail?$\n$\nSì: restano solo le caselle e i calendari, con i loro accessi. Installandolo di nuovo li ritrovi già collegati; tutto il resto si toglie.$\n$\nNo: si toglie tutto. Non resta niente di SIEVER Mail su questo computer.$\n$\nAnnulla: SIEVER Mail resta installato."
LangString sieverKeepQuestion 1031 "Möchten Sie die Verbindungen von SIEVER Mail behalten?$\n$\nJa: Nur die Postfächer und die Kalender bleiben, mit ihren Anmeldungen. Wenn Sie es erneut installieren, sind sie schon verbunden; alles andere wird entfernt.$\n$\nNein: Alles wird entfernt. Von SIEVER Mail bleibt nichts auf diesem Computer.$\n$\nAbbrechen: SIEVER Mail bleibt installiert."

LangString sieverRemovingData 1033 "Removing ${PRODUCT_NAME}’s data…"
LangString sieverRemovingData 1040 "Tolgo i dati di ${PRODUCT_NAME}…"
LangString sieverRemovingData 1031 "Die Daten von ${PRODUCT_NAME} werden entfernt…"

; $R2 is where the data is: the strings are read when said, with it.
LangString sieverDataLeft 1033 "Part of ${PRODUCT_NAME}’s data couldn’t be removed: it stays in $R2, and can be removed by hand."
LangString sieverDataLeft 1040 "Una parte dei dati di ${PRODUCT_NAME} non si è potuta togliere: resta in $R2, e si può togliere a mano."
LangString sieverDataLeft 1031 "Ein Teil der Daten von ${PRODUCT_NAME} konnte nicht entfernt werden: Er bleibt in $R2 und kann von Hand entfernt werden."

; What electron-builder's own way of closing the app needs, which it leaves out when an app has
; its own: this one ends with it.
!include "getProcessInfo.nsh"
Var pid

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
  ${if} $R0 == 0
    DetailPrint "$(sieverClosing)"
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
        MessageBox MB_YESNOCANCEL|MB_ICONQUESTION|MB_DEFBUTTON1 "$(sieverKeepQuestion)" IDYES sieverKeepConnections IDNO sieverKeepNothing
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
    DetailPrint "$(sieverRemovingData)"
    ; Its own Chromium profile, so the one it clears is held by nobody.
    ; Asked from the app, the uninstaller runs unseen: the app's own message says how it went.
    StrCpy $R4 ""
    ${if} ${Silent}
      StrCpy $R4 " --siever-tell"
    ${endIf}
    ExecWait `"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --siever-uninstall=$sieverKeep "--siever-profile=$R2" "--user-data-dir=$PLUGINSDIR\siever-mail-disinstalla"$R4` $R3

    ${if} $R3 != 0
    ${andIfNot} ${Silent}
      MessageBox MB_OK|MB_ICONEXCLAMATION "$(sieverDataLeft)"
    ${endIf}
  ${endIf}
!macroend

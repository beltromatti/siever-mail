; Custom uninstall logic for SIEVER Mail.
;
; An update runs the previous version's uninstaller before installing the
; new one. That must never touch the user's data: the new version migrates
; it on its first launch, keeping everything but the message cache, which
; resyncs from the server. So nothing below runs during an update
; (`${isUpdated}`, set by electron-builder's installer), whether that
; uninstaller runs silently or not.
;
; A real uninstall asks whether to keep the data for a later reinstall.
; "No", the highlighted default, removes the database, the logins and every
; local copy; a silent uninstall (/S) keeps them, since nobody was asked.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Vuoi conservare i login salvati e i dati utente di SIEVER Mail per una futura installazione?$\n$\nScegli 'No' per cancellare il database e tutti i dati locali (raccomandato per una disinstallazione completa)." /SD IDYES IDYES sieverKeepUserData
      RMDir /r "$APPDATA\SIEVER Mail"
    sieverKeepUserData:
  ${endIf}
!macroend

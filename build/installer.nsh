; Custom uninstall logic for SIEVER Mail.
;
; Goal:
; - Interactive uninstall (user via Control Panel / Settings): default = full wipe
;   of the user's local database, login state and all cached data. The user can
;   override by choosing "Sì" to keep the user-data folder for a later reinstall.
; - Silent uninstall (e.g. invoked by the new installer during an in-place
;   upgrade): default = KEEP the user-data folder so login state survives the
;   upgrade. The new app version then runs its own data-migration on first
;   launch, which wipes everything EXCEPT the saved logins.
;
; The interactive default ("No" → wipe) is enforced via MB_DEFBUTTON2 so the
; highlighted button matches the user-stated default. The silent default ("Sì"
; → keep) is enforced via /SD IDYES so unattended upgrades never destroy the
; user's saved accounts.
!macro customUnInstall
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Vuoi conservare i login salvati e i dati utente di SIEVER Mail per una futura installazione?$\n$\nScegli 'No' per cancellare il database e tutti i dati locali (raccomandato per una disinstallazione completa)." /SD IDYES IDYES sieverKeepUserData
    RMDir /r "$APPDATA\SIEVER Mail"
  Goto sieverUserDataDone
  sieverKeepUserData:
  sieverUserDataDone:
!macroend

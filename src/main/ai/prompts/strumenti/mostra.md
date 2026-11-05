Mostra qualcosa all'utente nella finestra principale, accanto a te. Usalo quando ti chiede di vedere qualcosa o quando conviene che guardi lui stesso (per esempio i risultati di una ricerca lunga).

Parametri (uno):

- `messaggio`: il riferimento di un messaggio da aprire nel lettore.
- `bozza`: il riferimento di una bozza da aprire.
- `progetto`: il riferimento di un progetto da aprire.
- `giorno`: un giorno (AAAA-MM-GG) da aprire nel calendario.
- `ricerca`: una lista di messaggi da mostrare, che l'utente può tenere come cartella — `titolo` (il nome della lista), `testo` (con la sintassi di `cerca_posta`), e se servono `account`, `cartella`, `non_lette`, `con_allegati`, un periodo fisso (`dal`, `al`) oppure contato da oggi (`periodo`: `oggi`, `ieri`, `questa_settimana`, `settimana_scorsa`, `questo_mese`, `mese_scorso`, `ultimi_giorni` con `giorni`), così la lista si sposta con i giorni.

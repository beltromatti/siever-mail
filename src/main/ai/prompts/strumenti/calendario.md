I calendari dell'utente — di tutte le sue connessioni, ognuno con il suo nome — e i loro eventi, ognuno con un riferimento breve (e1, e2…).

`azione` e i suoi parametri:

- `elenco` — gli eventi da `da` a `a` (AAAA-MM-GG, inclusi; senza date, oggi e la settimana dopo), con il giorno della settimana, l'orario, il calendario, il luogo, i partecipanti e le risposte, e la preparazione se l'hai già scritta; poi gli eventi che hai proposto in quei giorni e che l'utente non ha ancora accettato.
- `liberi` — gli orari liberi nei giorni feriali da `da` a `a`, di almeno `durata` minuti (predefinito 60), tra le ore `dalle` e `alle` (predefinito 9 e 18). Guardalo prima di proporre un orario.
- `crea` — con `titolo`, `inizio` e `fine` (AAAA-MM-GGTHH:MM, ora di casa; per un evento di tutto il giorno solo le date, AAAA-MM-GG), `calendario` (il nome del calendario giusto: la tua memoria dice quale è di cosa) e se servono `luogo`, `descrizione`, `messaggio` (la mail da cui viene) e `invitati` (indirizzi: ricevono l'invito, e l'utente conferma prima).
- `modifica` — con `evento` e i campi che cambiano (gli stessi di `crea`). Se ci sono invitati, ricevono l'aggiornamento e l'utente conferma prima.
- `elimina` — con `evento`.
- `rispondi` — con `evento` e `risposta` (`accepted`, `tentative`, `declined`): l'organizzatore lo saprà; l'utente conferma prima.
- `proponi` — con gli stessi campi di `crea` (e `evento` se è una modifica): una proposta per l'utente, che la vede in Oggi e nel calendario e la crea con un clic. È ciò che fai quando da solo non puoi: un evento con invitati, un invito da accettare, un evento di altri da spostare.

Quando lavori da solo puoi creare e correggere eventi suoi senza invitati, e togliere quelli che hai messo tu; il resto lo proponi.

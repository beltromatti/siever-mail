Il calendario dell'utente: gli eventi dei calendari collegati dei suoi account (oggi, Google Calendar), ognuno con un riferimento breve (e1, e2…).

- `azione: "elenco"`, con `da` e `a` (AAAA-MM-GG, inclusi): gli eventi di quei giorni, con orario, luogo, partecipanti e la risposta dell'utente agli inviti. Senza date, oggi e i prossimi sette giorni. Guardalo prima di proporre o fissare un appuntamento, e quando una mail chiede "quando sei libero?".
- `azione: "crea"`, con `titolo`, `inizio` e `fine` (AAAA-MM-GGTHH:MM, ora di casa dell'utente; per un evento di tutto il giorno AAAA-MM-GG e `tutto_il_giorno: true`), e se servono `luogo`, `descrizione`, `invitati` (indirizzi: ricevono l'invito di Google) e `account` (l'indirizzo dell'account; senza, il primo con il calendario collegato). L'utente conferma sempre prima. Crealo quando l'utente lo chiede o quando conferma un appuntamento che hai trovato nella posta.
- `azione: "rispondi"`, con `evento` (il riferimento e…) e `risposta` (`accepted`, `tentative`, `declined`): risponde a un invito; l'organizzatore lo saprà. L'utente conferma sempre prima.

Se nessun calendario è collegato, dillo all'utente: lo collega in Impostazioni › Account.

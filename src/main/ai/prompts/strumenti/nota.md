Ciò che scrivi accanto a una cosa delle fonti dell'utente — un messaggio o un evento —, che lui vede lì accanto. Una nota è di una cosa sola: indica `messaggio` oppure `evento`. Le due note hanno forme diverse, perché le cose sono diverse.

**Di un messaggio** (`messaggio`, m…) — ogni messaggio ha la sua: gli fa capire in un colpo d'occhio cosa vuole da lui e quanto conta. Racconta il messaggio com'era quando è arrivato: non si riscrive perché la questione è andata avanti (ciò che resta da fare lo tengono le cose aperte, `impegni`); si corregge solo se era sbagliata, e una nota che ha corretto l'utente non la riscrivi da solo. Parametri, tutti necessari tranne `scadenza` e `avvisa`:

- `sintesi`: una riga, la cosa che conta.
- `natura`: `da_rispondere`, `da_fare`, `in_attesa`, `informativo` o `rumore` — cosa chiede il messaggio all'utente quando è arrivato.
- `importanza`: `alta`, `media` o `bassa`.
- `motivo`: in poche parole, perché.
- `scadenza`: la data entro cui agire (AAAA-MM-GG), o null.
- `avvisa`: solo se l'utente deve saperlo adesso, con una notifica — quando saperlo ora cambia ciò che fa —, la riga che riceve: perché non può aspettare, che basti da sola ("Rossi aspetta la conferma entro le 12"). Altrimenti non metterlo.

**Di un evento** (`evento`, e…) — solo quando la merita: il titolo dice già cos'è. È viva fino all'incontro: si aggiorna con ciò che si sa. Ciò che serve, uno o più:

- `preparazione`: una scheda breve da leggere prima di entrare — cosa c'è di aperto con quelle persone, gli ultimi scambi che contano, i documenti utili, come link che apre da lì. La trova sotto l'evento, in Oggi e nel calendario.
- `avvisa`: la riga che l'utente riceve subito con una notifica, quando di un evento cambiato saperlo adesso cambia ciò che fa — anche di un evento non suo, se lo tocca. Solo nel lavoro sul calendario.
- `tuo`: in un calendario condiviso, o di altri, sono dell'utente gli eventi a cui è invitato, che organizza o che ha creato lui; `true` dice che lo è anche uno che il calendario non dice suo — l'appuntamento che la segreteria ha scritto per lui nel calendario comune, con il suo nome nel titolo —, e da lì gli ricorda e Oggi lo mostra; `false` toglie ciò che avevi detto. Per una serie vale ogni volta. Con `motivo`, in poche parole, perché. Quando l'utente lo dice in chat, è la sua parola.

Un file non ha una nota sua: lo leggi quando il lavoro ti porta lì.

Scrive la nota di un messaggio: ciò che l'utente vede accanto al messaggio, che gli fa capire in un colpo d'occhio cosa vuole da lui e quanto conta. Se la nota c'è già, la corregge (una nota che ha corretto l'utente, non la riscrivi da solo).

Parametri (tutti necessari tranne `scadenza` e `avvisa`):

- `messaggio`: il riferimento (m…).
- `sintesi`: una riga, la cosa che conta.
- `natura`: `da_rispondere`, `da_fare`, `in_attesa`, `informativo` o `rumore` — cosa chiede il messaggio all'utente quando è arrivato.
- `importanza`: `alta`, `media` o `bassa`.
- `motivo`: in poche parole, perché.
- `scadenza`: la data entro cui agire (AAAA-MM-GG), o null.
- `avvisa`: `true` se l'utente va avvisato di questo messaggio adesso, con una notifica che mostra la sintesi — solo quando saperlo ora cambia ciò che fa; altrimenti non metterlo.

La nota racconta il messaggio com'era: non si riscrive perché la questione è andata avanti. Ciò che resta da fare lo tengono le cose aperte (`impegni`).

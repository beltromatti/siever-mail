Le risposte che prepari in anticipo, che l'utente trova già scritte nel lettore: una risposta a un messaggio che aspetta la sua, o un sollecito dopo un suo messaggio che aspetta da troppo. Restano qui, in locale: nessuno le riceve finché l'utente non le usa.

Parametri:

- `messaggio`: il riferimento del messaggio — quello a cui si risponde, o per un sollecito l'ultimo dell'utente.
- `azione`:
  - `prepara` — con `testo` (il corpo, nella voce dell'utente, con tra parentesi quadre ciò che deve completare lui), `dubbi` (in una o due frasi, cosa deve decidere o verificare prima di mandarla; vuoto se niente) e `tipo` (`risposta` o `sollecito`). Se ce n'era già una, la sostituisce.
  - `conferma` — una risposta segnata da rivedere è ancora giusta così.
  - `scarta` — con `motivo`: non serve più (l'utente ha già risposto, la questione è cambiata).

Una risposta che l'utente ha scartato non la riproponi.

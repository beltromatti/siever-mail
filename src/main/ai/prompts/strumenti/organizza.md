Mette in ordine la posta come farebbe l'utente con un clic: archivia (come fa il suo provider: toglie dalla posta in arrivo), sposta, contrassegna, segna come letto o non letto, sposta nel cestino. Tutto si può annullare; nulla viene eliminato per sempre. Si usa solo quando l'utente lo chiede: archiviare o spostare non cambia le cose aperte, che restano finché non sono fatte.

Parametri:

- `messaggi`: i riferimenti dei messaggi (m1, m2…).
- `azione`: `archivia`, `sposta`, `contrassegna`, `togli_contrassegno`, `segna_letto`, `segna_non_letto`, `cestina`.
- `cartella`: per `sposta`, il nome della cartella di destinazione (dello stesso account del messaggio).

Restituisce cosa è stato fatto e cosa no, con il motivo.

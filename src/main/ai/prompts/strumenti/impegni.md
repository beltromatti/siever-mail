Le cose aperte tra l'utente e gli altri, in tutti i suoi account: ciò che gli chiedono (`ti_chiedono`), ciò che ha promesso (`hai_promesso`), ciò che aspetta (`aspetti`), ciò che deve fare (`da_fare`). Ognuna ha un numero (#12), il messaggio da cui nasce, la scadenza se c'è e la sua storia: chi l'ha aperta, chiusa o riaperta, quando e perché. Sono loro a decidere cosa sta in "Da gestire" e in "In attesa" e cosa vede l'utente in Oggi.

Fai tutte le operazioni che servono in una sola chiamata, in `operazioni`. Ognuna ha la sua `azione`:

- `elenco` — le cose aperte (e quelle rinviate), le più vicine per prime, con il messaggio da cui nascono; si restringe con `tipo`, `entro` (AAAA-MM-GG), `progetto` (p…) e `persona` (un indirizzo: le conversazioni in cui ha scritto, in tutti gli account).
- `apri` — con `messaggio` (il riferimento del messaggio da cui nasce), `tipo`, `testo` (la cosa, breve e concreta) e `scadenza` se c'è. Se la stessa cosa è già aperta nella conversazione, restituisce quella.
- `aggiorna` — con `id`: cambia `testo`, `scadenza` o `tipo` (una data fissata o spostata, ciò che resta da fare).
- `fatta` — con `id`: è fatta. Indica in `prova` il messaggio che lo mostra, se c'è, e in `motivo` cosa è successo.
- `non_serve` — con `id` e `motivo`: non c'è più da fare (annullata, superata, letta male).
- `rinvia` — con `id` e `fino_a` (AAAA-MM-GG): sparisce dalle viste fino a quel giorno, poi torna aperta.
- `riapri` — con `id`: torna aperta, con il `motivo` (e la `prova`, se viene da un messaggio).
- `chiedi` — con `id` e `domanda`: chiedi all'utente se è ancora aperta; la vede in Oggi e risponde con un clic.
- `unisci` — con `id` (quella da tenere) e `con` (i numeri delle altre): sono la stessa cosa.

Ogni operazione dice com'è andata. Se una cosa è cambiata da quando l'hai letta — l'utente l'ha appena spuntata, per esempio — l'operazione non si fa e ti dice com'è ora: rileggi e decidi di nuovo. Ciò che ha deciso l'utente lo cambi solo con una `prova` più recente della sua decisione.

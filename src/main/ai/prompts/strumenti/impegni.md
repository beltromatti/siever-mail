Le cose aperte tra l'utente e gli altri, come le hai annotate leggendo la posta di tutti gli account: cosa gli chiedono, cosa ha promesso, cosa aspetta, cosa deve fare. Ognuna ha un numero, il messaggio da cui nasce (un riferimento m…) e la scadenza se c'è.

- `azione: "elenco"`: le cose aperte, quelle con la scadenza più vicina per prime (le scadute in testa), poi le altre dalla più recente. Si restringe con `tipo` (`ti_chiedono`, `hai_promesso`, `aspetti`, `da_fare`), `entro` (AAAA-MM-GG: quelle che scadono entro quel giorno) e `argomento` (un riferimento a…).
- `azione: "chiudi"`, con `id`: segna come fatta una cosa aperta. Fallo quando l'utente dice che è fatta, o quando hai visto tu che lo è (una risposta mandata, un documento arrivato): in quel caso dillo all'utente.

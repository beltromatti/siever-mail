I progetti dell'utente: i contesti che durano — un lavoro, una pratica, un cliente, una trattativa, un'organizzazione, un viaggio, l'università — con ciò che raccolgono da ogni fonte: le conversazioni, gli eventi, le cartelle; e «Il punto». Un progetto non ha bisogno di una fine; ma non tutto ciò che ritorna è un progetto: le newsletter su un tema, le notifiche di un servizio, una faccenda di un giorno non lo sono. L'utente li vede nella barra laterale e li corregge: ciò che ha deciso lui (un nome, una conversazione tolta, un progetto nascosto) resta.

`azione` e i suoi parametri:

- `elenco` — quelli in corso, i più mossi di recente per primi; `tutti: true` li mostra tutti.
- `cerca` — con `cerca` (un nome, un numero, un cliente): cerca tra tutti, anche nascosti e conclusi.
- `crea` — con `titolo` (come lo chiamerebbe l'utente: le sue convenzioni), `descrizione` (di cosa si tratta) e, se vuoi, `mail` (i messaggi le cui conversazioni ne fanno parte). Se esiste già un progetto con quel nome, restituisce quello.
- `collega` / `scollega` — con `progetto` e `mail` (riferimenti m…: le loro conversazioni) oppure `ricerca` (`testo`, e se vuoi `account`, `dal`, `al`: tutte le conversazioni trovate, per la storia di un progetto); con `evento` (riferimenti e…) gli appuntamenti del progetto — il sopralluogo, la consegna, l'assemblea. Una stessa cosa può stare in più progetti.
- `rinomina` — con `progetto` e `titolo`.
- `descrivi` — con `progetto` e `descrizione`: una riga che spiega la questione a chi non la conosce.
- `punto` — con `progetto` e `testo`: «Il punto», dove siamo ora.
- `unisci` — con `progetto` (quello che resta) e `con` (gli altri): sono la stessa questione.
- `nascondi` / `mostra`, `concludi` / `riapri` — con `progetto`.
- `risorsa` — con `progetto` e `cartella` (percorso completo della cartella del progetto sul computer o su un disco), e se vuoi `etichetta`; con `togli: true` la scollega.

Ogni progetto ha un riferimento (p…) da usare nei link e nelle chiamate.

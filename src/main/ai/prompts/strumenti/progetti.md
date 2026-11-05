I progetti dell'utente: le questioni che durano — un lavoro, una pratica, una trattativa, un'organizzazione — con le loro conversazioni, «Il punto», le cartelle collegate. L'utente li vede nella barra laterale e li corregge: ciò che ha deciso lui (un nome, una conversazione tolta, un progetto nascosto) resta.

`azione` e i suoi parametri:

- `elenco` — quelli in corso, i più mossi di recente per primi; con `cerca` (un nome, un numero, un cliente) cerca tra tutti, anche nascosti e conclusi; `tutti: true` li mostra tutti.
- `crea` — con `titolo` (come lo chiamerebbe l'utente: le sue convenzioni), `descrizione` (di cosa si tratta) e, se vuoi, `mail` (i messaggi le cui conversazioni ne fanno parte). Se esiste già un progetto con quel nome, restituisce quello.
- `collega` / `scollega` — con `progetto` e `mail` (riferimenti m…: le loro conversazioni) oppure `ricerca` (`testo`, e se vuoi `account`, `dal`, `al`: tutte le conversazioni trovate, per la storia di un progetto). Una conversazione può stare in più progetti.
- `rinomina` — con `progetto` e `titolo`.
- `descrivi` — con `progetto` e `descrizione`: una riga che spiega la questione a chi non la conosce.
- `punto` — con `progetto` e `testo`: «Il punto», dove siamo ora.
- `unisci` — con `progetto` (quello che resta) e `con` (gli altri): sono la stessa questione.
- `nascondi` / `mostra`, `concludi` / `riapri` — con `progetto`.
- `risorsa` — con `progetto` e `cartella` (percorso completo della cartella del progetto sul computer o su un disco), e se vuoi `etichetta`; con `togli: true` la scollega.

Ogni progetto ha un riferimento (p…) da usare nei link e nelle chiamate.

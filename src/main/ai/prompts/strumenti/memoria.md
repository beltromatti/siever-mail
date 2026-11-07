Il tuo quaderno, che dura tra un lavoro e l'altro ed è lo stesso in ogni momento in cui lavori: ciò che sai dell'utente, delle sue connessioni, delle persone, dei progetti, delle sue convenzioni. L'utente può leggerlo e correggerlo nelle impostazioni. Ogni versione di ogni nota viene conservata.

`comando` e i suoi parametri:

- `leggi` — senza `percorso` la mappa (ogni nota con la sua prima riga; una cartella con molte note in una riga); con una cartella (`contatti/`) le sue note; con un `percorso` la nota con le righe numerate.
- `cerca` — con `parole`: le righe di tutte le note che le contengono.
- `modifica` — con `percorso` e `modifiche`: una lista di sostituzioni `{vecchio, nuovo}`, ognuna su un testo che compare una volta sola nella nota; si applicano tutte o nessuna. È il modo normale di cambiare una nota: precisa, senza toccare il resto, e senza perdere ciò che un altro lavoro ha scritto nel frattempo.
- `inserisci` — con `percorso`, `testo` e `riga` (le righe vanno dopo quella; 0 per l'inizio, senza per la fine). Crea la nota se non c'è.
- `scrivi` — con `percorso` e `testo`: una nota nuova, o riscritta per intero. Per una nota che esiste già preferisci `modifica`; se l'hai letta in questo lavoro e intanto è cambiata, ti avverte.
- `elimina` — con `percorso`.
- `rinomina` — con `percorso` e `nuovo_percorso`.
- `storia` — con `percorso`: le versioni passate, con chi le ha scritte.
- `ripristina` — con `percorso` e `versione`: riporta una versione passata.

`percorso` è per esempio `tu.md`, `stile.md`, `connessioni.md`, `contatti/luca-rossi.md`, `progetti/hotel-lido.md`. Ogni nota inizia con una riga che dice di cosa parla: è quella che compare nella mappa. Una nota ha al massimo 20.000 caratteri.

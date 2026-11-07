Cerca file e cartelle sul computer dell'utente e sui dischi di rete collegati, per nome. Solo lettura: puoi trovare e leggere, mai modificare o cancellare.

Parametri:

- `nome`: parte del nome del file o della cartella (senza badare a maiuscole e accenti). Più parole devono esserci tutte.
- `cartella`: dove cercare, come percorso completo (una cartella che conosci, un disco di rete, la cartella di un progetto). Senza, cerca nelle cartelle dell'utente (Documenti, Scrivania, Download…) e nei dischi collegati.
- `elenca`: se vero, invece di cercare elenca il contenuto di `cartella` (sottocartelle e file, con dimensione e data): serve a capire com'è organizzato un archivio. Una cartella con molti elementi si sfoglia con `pagina` (2, 3…).
- `continua`: il nome di una ricerca che non ha finito (`s1`): riprende da dove si era fermata. Su un archivio di rete grande una ricerca guarda per qualche secondo e poi ti dice cosa ha trovato e quante cartelle restano: decidi tu se continuare — finché non ha finito, ciò che non ha trovato può esserci ancora.
- `limite`: quanti risultati mostrare per volta (predefinito 30); gli altri arrivano continuando.

Restituisce i file trovati con il loro riferimento (f1, f2…), il percorso, la dimensione e la data di modifica. Per leggerne uno usa `leggi`; per allegarlo a una bozza passa il riferimento a `scrivi_bozza`; per collegare una cartella a un progetto usa `progetti`.

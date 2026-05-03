REGOLE GENERALI DA SEGUIRE PER PROGRAMMARE SU QUESTA REPO:

- questa è la repo di un app desktop cross platform (macOS e windows) per un client email con funzione di archiviazione email su filesystem aziendale custom per le esigenze specifiche della azienda committente.

- lo stack usato è: electron + vite per build e development, react + typescript + tailwindcss per la UI, SQlite per database locale per persistenza login e preferenze e dati, l'app non possiede backend server.

- scrivi codice sempre coerente con il resto dell'app, pensa a tutti gli edge cases possibili e a possibili regressioni da altre parti dell'app, fixa tutto proattivamente, rendi sempre tutto coerente e intelligente, trova soluzioni smart, scrivi codice production grade seguendo sempre la best practice in ogni ambito, ma non aggiungere boilerplate inutile, tieni il codice snello ma che vada dritto al punto e gestisca tutti i casi, non trovare scorciatoie, non aggiungere fallback, fai sempre le cose fatte per bene e coerenti e complete anche se significa spendere piu tempo in fare ricerche online, leggere codice in altre parti della repo etc

- tutti i colori usati devono essere resi dinamici e collegati al tema centralizzato di tailwindcss per poterli controllare centralmente e cambiare l'intero look dell'app da lì, evita colori hardcodati a meno che non siano componenti custom con colore indipendente dal tema e usato una volta sola.

- per la UI cerca di riutilizzare i componenti presenti e se necessario scaricane di nuovi da shadcn/ui oppure creane di custom compatibili che seguano lo stile dell'app, tutto questo se pensi che possa essere utile in futuro riutilizzarli più volte, se necessario crea nuove varianti in quelli già presenti, se invece ti serve un componente custom UI che usi solo in un punto dell'app allora puoi hardcodarlo per non aggiungere boilerplate inutile, ma le regole dei colori scritte sopra valgono comunque.

- l'app non ha backend server, è un client mail con funzione di archiviazione custom che usa solo un database SQlite locale per la persistenza dei login, delle preferenze e dei dati.

- il frontend usa react + typescript con tailwindcss per lo styling, l'obiettivo è creare codice che vada bene sia per app desktop mac (sia intel che apple silicon) che per app desktop windows e eventualmente app desktop per distribuzioni di linux con grafica (ma secondario).

- quando implementi codice nuovo pensa sempre alla scalabilità dell'app, scrivi codice modulare riutilizzabile dove necessario e mantieni coerenza con la struttura dei file dell'app, creandone di nuovi e anche nuove cartelle se ritieni necessario per fare un lavoro più pulito e scalabile seguendo la best practice senza aggiungere boilerplate inutile.

- sei invitato a usare codice gia scritto da altri opensource per implementare funzioni in maniera più potente e completa senza reinventare la ruota, prima di agire DEVI eseguire ricerce su internet in autonomia per cercare le soluzioni più aggiornate, repo da clonare e codice da implmentare, e soprattutto la relativa documentazione online, con possibilità ben accettata e promossa di eseguire ricerce complete anche su forum in caso di bug o di implementazioni ambigue per cercare la soluzione sempre più aggiornata e definitiva.

- esegui ricerche su internet per implementare sempre la versione piu recente di librerie e api, allineandoti con la documentazione aggiornata e usandole perfettamente, vatti anche a leggere il codice direttamente dentro node_modules se ti aiuta a implementare correttamente le librerie.

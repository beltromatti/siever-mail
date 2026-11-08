REGOLE GENERALI PER PROGRAMMARE SU QUESTA REPO

## Che cos'è

- SIEVER Mail è un sistema operativo personale per il lavoro (e per la vita), per chi ha molto da seguire: app alla pari — Posta, Calendario, File, poi Contatti e Progetti — ognuna con le sue connessioni, tenute insieme da un solo agente, il Segretario. Funziona benissimo senza AI; con l'AI accesa diventa intelligente. Non è più un client di posta, e non è fatto per un'azienda sola.
- Il documento guida è **`docs/vision.md`**: leggilo prima di lavorare su una parte dell'app, e tienilo vero. Ciò che si decide di nuovo si scrive lì, nel suo posto, con il perché; le sezioni si citano come §N, anche nei commenti.
- App desktop cross platform: macOS (Apple silicon e Intel) e Windows prima di tutto, Linux con interfaccia grafica dopo. Nessun backend server: tutto sta in un database SQLite locale (connessioni, preferenze, dati, il lavoro del Segretario).
- Lo stack: Electron + electron-vite per build e sviluppo; React + TypeScript + Tailwind CSS per l'interfaccia; SQLite (Prisma e SQL) per i dati; il modello passa da OpenRouter con la chiave dell'utente.
- L'interfaccia e i prompt sono in italiano.

## Il pubblico e le estensioni

- Questa repo è la versione **pubblica**: generale, per tutti, per qualunque lavoro. Nessuna scritta, esempio o comportamento di un'organizzazione nell'interfaccia; nessun nome reale di persone o aziende nel codice, nei test, nei commenti (usa esempi inventati: `acme-srl`, `brenta.it`, «Casa al mare»).
- Un'**estensione privata** fa l'edizione di un'organizzazione: istruzioni per il Segretario, strumenti, azioni nell'interfaccia, dati, la forma della casa. Porta il nome legale dell'ente e un identificativo che ne deriva («Siever S.r.l.» → `siever-srl`). Vive in un repository privato, clonato in `extension/` (fuori da git), e si monta con `LOAD_EXTENSION=1`.
- L'estensione usa l'app **solo** attraverso il contratto (`src/extension/types.ts`), il kit (`src/extension/kit/`), i componenti di `@renderer/components/ui/*` e il modello condiviso `@shared/*`: il lint vieta il resto. Se le serve altro, allarga il contratto o il kit con nomi generici, in un commit dell'app che non parla dell'estensione. Mai codice di un'organizzazione dentro l'app.
- Nella cartella `extension/` prettier non entra (è fuori da git): formattala con `eslint --fix`.

## Il Segretario

- Obiettivi e criteri, non procedure: i prompt dicono cosa deve esserci alla fine e perché, il modello sceglie come arrivarci, quanto lavorare, cosa leggere. Il contesto lo sceglie lui con gli strumenti: niente dossier iniettati, suggerimenti morbidi nei prompt, mai controlli con espressioni regolari sul testo che scrive.
- Nessun limite fisso deciso da noi su passi, tempo, token o tentativi del modello; il sistema garantisce gli invarianti sotto (identità, revisioni, coda durevole, permessi, idempotenza).
- Nei prompt pubblici gli esempi vengono da lavori diversi e sono detti come esempi, non convenzioni: le convenzioni vere arrivano solo dalle istruzioni di un'estensione.

## Come si scrive il codice

- Scrivi codice sempre coerente con il resto dell'app; pensa a tutti i casi limite e alle regressioni in altre parti, e sistemale. Soluzioni intelligenti e complete, qualità da produzione, le buone pratiche di ogni ambito, ma niente boilerplate inutile: codice snello, che vada dritto al punto e gestisca tutti i casi. Niente scorciatoie, niente ripieghi: fai le cose per bene e complete, anche se costa più tempo in ricerche e letture di altre parti della repo.
- Tutti i colori sono token del tema centralizzato di Tailwind (`src/renderer/src/styles/globals.css`), così l'aspetto dell'app si cambia da lì. Niente colori scritti a mano, salvo un componente con un colore suo, indipendente dal tema e usato una volta sola.
- Riusa i componenti che ci sono; se servono, prendine di nuovi da shadcn/ui o creane di compatibili con lo stile dell'app, o aggiungi varianti a quelli presenti, quando torneranno utili più volte. Un componente usato in un punto solo può restare lì, con le stesse regole sui colori.
- Nessun codice di migrazione dalle versioni precedenti: la 2.0 si installa da capo, le tabelle nascono come sono (`docs/vision.md` §15.1). Una migrazione si scrive solo quando servirà, per un passaggio preciso.
- Pensa alla crescita dell'app: codice modulare e riusabile dove serve, coerente con la struttura dei file; nuovi file e cartelle quando rendono il lavoro più pulito.
- Prima di agire cerca online le soluzioni più aggiornate, il codice open source da riusare invece di reinventare, e soprattutto la documentazione ufficiale; nei bug o nei casi ambigui anche forum e issue. Usa sempre la versione più recente di librerie e API, come dice la loro documentazione; leggi il codice in `node_modules` quando aiuta.

## Prima di dire finito

- `npm run typecheck` (la variante pubblica: gli alias `@app/extension/*` puntano agli stub di `src/extension/`), `npm run typecheck:ext` (se hai l'estensione: senza, i tipi del codice privato non li controlla nessuno — `electron-vite build` scarta i tipi e basta), `npm test`, `npm run lint` (zero errori), e le build delle due varianti: `npx electron-vite build` e `LOAD_EXTENSION=1 npx electron-vite build`.
- Prova dal vivo ciò che cambia, nello studio di prova o nel profilo di sviluppo (`docs/vision.md` §15.3), mai nel profilo dell'app installata.

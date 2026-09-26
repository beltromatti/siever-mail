# SIEVER Mail — Technical Documentation

How SIEVER Mail is put together: the processes, the data, the mail engine,
the interface and the extension surface. It is written for engineers who
read, debug or extend the code. The code comments go deeper on each piece;
this page is the map.

## Stack

| Layer       | Technology                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| Shell       | [Electron](https://www.electronjs.org/) 39                                                             |
| Bundler     | [electron-vite](https://electron-vite.org/) + Vite                                                     |
| UI          | [React 19](https://react.dev/) + TypeScript, [Tailwind CSS v4](https://tailwindcss.com/), Radix/shadcn |
| Local store | SQLite through [Prisma 7](https://www.prisma.io/) and its `better-sqlite3` adapter                     |
| Mail        | [imapflow](https://imapflow.com/) (IMAP), [nodemailer](https://nodemailer.com/) (SMTP), mailparser     |
| Gmail       | OAuth 2.0 over IMAP/SMTP (XOAUTH2); no Gmail HTTP API                                                  |
| Editor      | [Squire](https://github.com/fastmail/Squire), inside a sandboxed iframe                                |
| HTML safety | [DOMPurify](https://github.com/cure53/DOMPurify)                                                       |
| Tests       | [Vitest](https://vitest.dev/) (node + jsdom projects)                                                  |

## Processes and startup

The usual Electron split. Only the main process touches the network, the
file system and the database; the renderer is context-isolated and reaches
it through the typed `window.mailApi` bridge (`src/preload/index.ts`,
channels in `src/shared/ipc.ts`).

Startup, in `src/main/index.ts`:

1. `prepareUpgradeMigration()` — before the database is opened, detects a
   version change and backs up the user data (see
   [Upgrades](#upgrades)). Never throws.
2. `MailService.openStorage()` — opens SQLite, reconciles the schema, then
   finishes any upgrade migration.
3. `MailService.start()` — the mail engine connects the accounts.
4. The extension installs (see [Extensions](#extensions)).

The window is created right away and loads alongside. **Every IPC channel
that touches stored data waits for step 2** (`register-mail-ipc.ts`), so
the interface never reads rows the migration is about to purge or restore;
channels that only drive the window (minimise, close, …) never wait.

The theme is applied before any of this, from a one-word file in the user
data folder, so the first frame is already in the right colours
(`src/main/theme.ts`).

## Source layout

```
src/
├── main/                      Node side
│   ├── index.ts               lifecycle, window, tray, startup order
│   ├── app-menu.ts            macOS menu bar (Italian); none elsewhere
│   ├── theme.ts               Sistema / Chiaro / Scuro → nativeTheme
│   ├── ipc/register-mail-ipc.ts   every IPC handler
│   ├── services/
│   │   ├── mail-service.ts    façade the IPC layer calls
│   │   ├── database.ts        Prisma client, raw DDL, queries
│   │   ├── data-migration.ts  upgrade lifecycle
│   │   ├── mail-engine/       connections, sync, sending, parsing
│   │   ├── attachment-files.ts  opened/saved attachments on disk
│   │   ├── recent-files.ts    the OS's recent documents, for "Allega"
│   │   ├── google-oauth.ts    Gmail OAuth
│   │   └── secure-storage.ts  safeStorage wrapper for secrets
│   └── utils/                 logging to file, errors, external URLs
├── preload/index.ts           window.mailApi
├── renderer/src/
│   ├── App.tsx                top-level state and wiring
│   ├── features/              accounts, mail (list, table, reader,
│   │                          composer, editor), settings, workspace
│   ├── components/ui/         shared primitives (dialog, confirm, menus…)
│   ├── lib/                   selection, sections, HTML pipelines, zoom
│   └── styles/globals.css     Tailwind entry and the theme tokens
├── shared/                    types, search grammar, fonts, sender/subject keys
└── extension/                 the extension contract and its no-op stubs
```

## Data

One SQLite file, `userData/siever-mail.sqlite`. The schema is declared in
`prisma/schema.prisma` and applied at boot with raw
`CREATE TABLE IF NOT EXISTS` plus additive column checks in `database.ts`,
so an older file is brought forward in place.

| Table                | Holds                                                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accounts`           | IMAP and Gmail accounts; `encrypted_secret` is the password or OAuth token, encrypted with `safeStorage`.                                                                    |
| `folders`            | Folder metadata and sync cursors (UIDVALIDITY, HIGHESTMODSEQ, last UID). _Cache._                                                                                            |
| `messages`           | Envelopes, previews, flags, body cache. Denormalised `sender_label` / `sender_sort` / `subject_sort` let the database sort and group by sender or subject directly. _Cache._ |
| `contacts`           | Addresses learned from traffic, for recipient suggestions.                                                                                                                   |
| `account_signatures` | One signature per account, with the version of the page it was written for (`html_format`).                                                                                  |
| `recent_files`       | Files the user attached, saved or an extension filed away, offered first in "Allega".                                                                                        |
| `app_preferences`    | One row: theme, layout, list order, sort, grouping, reader zoom, the accounts TUTTI gathers.                                                                                 |

An extension may add tables through the database handle it receives; they
live in the same file and connection. The host never reads them.

"Elimina tutti i dati" (Settings → Dati) empties everything but the
accounts and the view preferences, then calls the extension's
`clearData()`. Clearing one account's data drops its cache and opened
attachments; the mail downloads again.

### Upgrades

`data-migration.ts` treats the two kinds of rows oppositely. **Cache**
(`messages`, `folders`, opened attachments) is rebuilt from the server, so a
version change drops it. **User data** — every other table, an extension's
included — exists nowhere else and is never dropped.

- Before the database opens, a version change (`userData/install-version.json`)
  copies every user table, definition and rows, into a small backup file,
  leaving the cache out.
- After the schema is reconciled, the finalize step purges the cache,
  stamps the new version and drops the backup.
- If a launch never gets there (a crash, the app quit, a file the new
  schema cannot apply to), the next launch sets the file aside, boots on a
  fresh schema and restores every table from the backup. A table the fresh
  database lacks — an extension's, created only when it installs — is
  recreated from its own definition, and its owner reconciles it like after
  any upgrade. Tables are restored one by one; one that fails does not stop
  the rest, and whatever could not be restored stays on disk.
- A recovery that has not completed after two launches is given up,
  keeping the user data on disk, so the app always starts.

`SIEVER_FORCE_DATA_MIGRATION=1` runs the flow in development, where the
version never changes. `data-migration.test.ts` covers each path.

The Windows installer never touches the user data folder during an update
(`build/installer.nsh`); a real uninstall asks.

## Mail engine

`src/main/services/mail-engine/`. One `AccountConnection` per account, each
with two IMAP clients:

- **primary** — what the user does (open, move, flag, delete, download) and
  IDLE on the folder on screen, so its changes arrive as they happen;
- **sync** — the initial download and background catch-up, so neither
  waits for the other.

Sync runs in layers: envelopes first, in large batches, so the list fills
at once; then previews; then incremental deltas driven by IDLE and by polls
(20 s for the folder on screen, 45 s for the others). Bodies and
attachments are fetched on demand.

The connection has a state machine (`connecting`, `connected`,
`reconnecting`, `offline`, `error`) that drives the sync badge in the
header. It reconnects with a backoff (2 s up to 60 s), notices the network
coming back (`net.isOnline`) and the machine waking or unlocking
(`powerMonitor`) and checks the link with a NOOP rather than trusting a
socket that may be dead. "Sincronizzato" is only shown when it is true.

What the user asks for is reported truthfully:

- imapflow reports a refused MOVE, STORE or EXPUNGE as `false`, not an
  error; each result is checked, and the local copy only changes when the
  server's did. A server without MOVE gets copy-then-delete, step by step.
- Without a connection, an operation waits up to 20 s for a reconnect and
  then fails with the reason, so the interface puts back what it had
  already shown. An account whose login was refused fails at once.
- Sending goes over SMTP; for IMAP accounts a copy is filed in the Sent
  folder afterwards, in the background (Gmail files its own). A sent
  message is never reported as failed because that copy is late.

### What counts as an attachment

Real messages carry signature logos, banners and every picture of the
quoted chain as `cid:` parts. `message-parts.ts` holds the one rule: a part
is body content when the HTML references its Content-ID, when it sits in the
`multipart/related` container, or when it is inline with a Content-ID.
Everything else is an attachment. The list's paperclip, the reader and the
extension's archive all use the same rule.

## Interface

### State

`App.tsx` owns the selected account and folder, the loaded page of
messages, the selection, the persisted `UiPreferences` and the dialogs. The
main process pushes changes through four events (messages, folders, TUTTI's
summary, connection states); the renderer never polls.

The selection (`lib/message-selection.ts`) keeps the **selected rows** and
the **cursor** apart, following Finder/Explorer: click replaces, Ctrl/⌘
toggles, Shift extends, ⌘/Ctrl+A selects all, Esc narrows to the cursor.

### Layouts

Two arrangements share every component (`features/workspace/workspace-layout.tsx`):
_apple_ — folders, list and reader side by side — and _outlook_ — a dense
sortable table above the reader. Both list shells implement
`MessageListViewProps`. Expanding the reader turns either into the same
narrow list beside a full-height message. Sizes are `clamp()`s, never
breakpoints, so any window size works.

### TUTTI and several accounts

TUTTI gathers the inboxes of the accounts chosen in Settings. Its rows say
which account each message came to (a tag, or the "Account" column), and
every action works on the message's own account: a reply or forward starts
from it, "Sposta" lists its folders, a selection spanning accounts is
explained rather than moved. The composer has a "Da" row whenever there is
more than one account; moving a reply or forward to an account other than
the one that received it is confirmed first, and the signature follows the
account.

Questions like that use one component, `components/ui/confirm-dialog.tsx`,
also available as `useConfirmDialog()` (`if (await confirm({ … }))`).

### Lists, sorting and search

Sorting (date, sender, subject, size) and grouping (Automatico, Mittente,
Nessuno) happen in the database; `lib/message-sections.ts` only slices the
ordered page into sections.

A sender section is one sender as the reader sees them. The spellings one
address uses for the same name share a label (`isSameSenderName` in
`shared/sender.ts`: the identifying words in any order, initials, the
desk words a company adds — "A.beltrami-SIEVER" and "A. Beltrami -
SIEVER", "HYPE" and "Team HYPE"), while the different people a shared
address relays keep their own; a message with no name takes its address's
label, and labels that differ only in dress share a sort key. A database
kept across a change of these rules is re-filed once at start
(`SENDER_FILING_VERSION`).

The search grammar in `shared/search.ts` is
parsed once and used by both sides — the main process builds the `WHERE`,
the renderer highlights the same terms. Words match sender, recipients,
subject and body; `da:`, `a:`, `oggetto:` narrow a term to one field.

### Theme

`styles/globals.css` defines every colour as a token (HSL triplets), with a
dark set and a light one under `prefers-color-scheme: light`. The choice in
Settings (Sistema, Chiaro, Scuro) becomes Electron's `themeSource`, which is
what that media query reports. Components only use the tokens. Message
bodies stay on a white page in both themes, as they were written.

## Mail content

### Reading

Bodies are sanitised with DOMPurify and shown in a sandboxed `srcdoc`
iframe whose height follows its content (`lib/mail-html.ts`). The page is a
plain one, like any client's, so a message looks as it was sent. Ctrl/⌘ +
wheel, a pinch or ⌘/Ctrl +/−/0 zoom the body (50–200 %), remembered across
messages. Shortcut chords pressed inside the frame are forwarded to the app.

### Writing

The composer (`features/mail/mail-composer-dialog.tsx`) runs Squire in an
iframe on the same page as the reader, so what is written looks as it will
arrive. A body starts with lines to write on, the signature in a
`gmail_signature` block and, for a reply or forward, the quote after a blank
line (`composer-body.ts`). Changing the sending account swaps that block.

Sending lays the message out once more off screen and writes onto it what
it rendered as (`lib/outgoing-mail-html.ts`): fonts on text, margins on
paragraphs and lists, line heights in pixels, link colours, image sizes,
inside a document that tells Outlook to render at 96 dpi. Outlook's Word
engine otherwise re-spaces paragraphs, ignores unitless line heights and
drops inherited fonts.

Font choices are full cross-platform stacks (`shared/mail-fonts.ts`): mail
clients ignore `@font-face`, so a font only shows where it is installed. The
public build starts in Arial; an extension can add fonts and colours and set
the default.

### Attachments

Opening one writes a copy to `userData/attachments/<account>/<attachment>`
and hands it to the default application; executables are never launched
from a click, and on Windows the copy carries the mark of the web. "Salva
con nome" and "Salva tutti" write where the user chooses. The copies are
measured and emptied in Settings → Dati and dropped on every upgrade.

A forward carries the original's attachments, as every client does: the
composer shows them at once and the main process copies them from one
download of the message (`copyMessageAttachments`), into copies of their
own that no application the reader opened can change. Sending waits until
every copy is there; one that failed says so on its chip, with "Riprova".
A reply leaves them out, and "Allega" offers them under "Dal messaggio
originale" — as it offers any the user removed from a forward — above the
files recently used on the computer (Windows Recent, macOS Spotlight's
last-used date, Linux `recently-used.xbel`) and in SIEVER Mail. Files can
also be dropped onto the composer. A file that is gone by the time the
message is sent is named in the error, not half-uploaded.

## Extensions

The host reserves one extension slot, filled at build time through four
Vite aliases:

| Alias                     | Loaded by      | Public stub                         |
| ------------------------- | -------------- | ----------------------------------- |
| `@app/extension/main`     | main process   | `src/extension/main.public.ts`      |
| `@app/extension/renderer` | renderer       | `src/extension/renderer.public.tsx` |
| `@app/extension/preload`  | preload        | `src/extension/preload.public.ts`   |
| `@app/extension/shared`   | main, renderer | `src/extension/shared.public.ts`    |

With `LOAD_EXTENSION=1` and a checkout at `extension/` (gitignored), the
aliases point at `extension/{main,renderer,preload,shared}/index.*`;
otherwise at the stubs (`electron.vite.config.ts`). The host never imports
extension code by path. The contract is `src/extension/types.ts`:

| Surface                                     | What it does                                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| `ExtensionMain.install(context)`            | Runs once after the engine starts: DDL, IPC handlers, startup work.               |
| `ExtensionMain.clearData()`                 | Deletes its data, as part of "Elimina tutti i dati".                              |
| `ExtensionMain.uninstall()`                 | Optional; called when the app quits.                                              |
| `ExtensionMain.defaultAccountSignatureHtml` | Signature given to the first account added. Empty in the public build.            |
| `ExtensionRenderer.toolbarActions`          | Buttons after "Nuovo messaggio", given the selection.                             |
| `ExtensionRenderer.settingsTabs`            | Tabs after the host's in Settings.                                                |
| `ExtensionRenderer.PrimaryActionDialog`     | A dialog the host mounts and opens on request.                                    |
| `ExtensionRenderer.fontFaceCss`             | `@font-face` rules for bundled fonts, applied to the app and every message frame. |
| `ExtensionRenderer.localDataLabel`          | How the data `clearData()` removes reads in Settings.                             |
| `ExtensionComposition` (shared)             | Fonts, default font, text colours and extra font stacks the composer offers.      |
| `ExtensionPreloadInstaller`                 | Methods merged onto `window.mailApi`.                                             |

`install()` receives an `ExtensionMainContext`: `app`, `ipcMain`, the user
data path, a database handle (`applyDdl`, `query`, `execute`) on the host's
connection, a mail engine handle (`fetchMessageRawSource`,
`moveMessageToTrash`), `getMainWindow()` and `recordRecentFiles()`. Renderer
surfaces get `ExtensionHostHooks` (optimistic removal from the list) so an
extension reuses the host's behaviour instead of copying it.

An extension's tables survive upgrades and failed upgrades like the host's
own (see [Upgrades](#upgrades)); it should create them with
`CREATE TABLE IF NOT EXISTS` and add columns additively.

Type-check an extension with `npm run typecheck:ext` — `npm run typecheck`
only sees the stubs, and the build strips types without checking them. Its
tests (`extension/**/*.test.ts`) run with the host's `npm test`.

## Testing

`npm test` runs two Vitest projects: `main` (node) for the main process and
`shared/`, `renderer` (jsdom) for the interface. Aliases mirror the build.
`better-sqlite3` is compiled for Electron, so tests that need SQLite mock
it over Node's built-in `node:sqlite`. Before a change is done:
`npm run typecheck`, `npm run typecheck:ext` (with an extension),
`npm test`, `npm run lint` and both builds (`npx electron-vite build`,
`LOAD_EXTENSION=1 npx electron-vite build`).

## Build and release

`build.mjs <version>` builds installers: `--target=<id>` for one of
`macos-arm64`, `macos-x64`, `windows-x64`, `linux-x64`, `linux-arm64`
(Linux in Docker), `--all` for every one, none for macOS arm64 + Windows
x64. It sets the version in `package.json` for the build and restores it
afterwards, signs and notarises on macOS when the credentials are present,
and writes to `release/<label>/v<version>/`. `runBuild()` is exported, so
an extension can build its own releases with `loadExtension: true` and a
label of its own.

`.github/workflows/release.yml` runs the targets in parallel on `v*` tags
and publishes a GitHub Release.

## Security

- `contextIsolation: true`, `nodeIntegration: false`; the preload exposes
  only the typed bridge, and navigation is limited to the app's own page.
- Incoming HTML is sanitised with DOMPurify and shown in sandboxed frames.
- Secrets pass through `safeStorage`; without an OS keychain they are not
  stored.
- External links open in the browser only if they are `http(s)`.
- Opened attachments never execute; Windows marks them as downloaded.

## License

Apache License 2.0. See [`LICENSE`](../LICENSE).

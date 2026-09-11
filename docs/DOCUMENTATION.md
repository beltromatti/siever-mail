# SIEVER Mail — Technical Documentation

This document describes the architecture, the runtime topology and the main
implementation choices behind SIEVER Mail. It is intended for engineers who
need to read, debug or extend the code.

## Stack

| Layer       | Technology                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------ |
| Shell       | [Electron](https://www.electronjs.org/)                                                                            |
| Bundler     | [`electron-vite`](https://electron-vite.org/) + Vite                                                               |
| UI          | [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)                                     |
| Styling     | [TailwindCSS v4](https://tailwindcss.com/) + shadcn-style components                                               |
| Local store | [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) + [Prisma](https://www.prisma.io/) (SQLite adapter) |
| Mail engine | [`imapflow`](https://imapflow.com/) (IMAP) + [`nodemailer`](https://nodemailer.com/) (SMTP)                        |
| Gmail       | [`googleapis`](https://github.com/googleapis/google-api-nodejs-client) (OAuth, no Gmail HTTP API)                  |
| Editor      | [Squire](https://github.com/fastmail/Squire) (rich-text)                                                           |
| HTML safety | [DOMPurify](https://github.com/cure53/DOMPurify)                                                                   |
| Tests       | [Vitest](https://vitest.dev/) + Testing Library + Playwright                                                       |

## Process topology

SIEVER Mail uses the conventional Electron three-process model:

```
┌────────────────────────────┐  IPC bridge   ┌──────────────────────────┐
│  Main process (Node.js)    │ ←──────────→  │  Renderer process (React) │
│  src/main/index.ts         │   contextBridge │  src/renderer/src/App.tsx │
│   ▸ MailService             │   safe by design│   ▸ folder sidebar       │
│   ▸ MailEngine (imapflow)   │                 │   ▸ message list         │
│   ▸ AppDatabase (Prisma)    │                 │   ▸ message viewer       │
│   ▸ GoogleOAuthService      │                 │   ▸ rich-text composer   │
│   ▸ DataMigration           │                 │   ▸ settings dialog      │
└────────────────────────────┘                  └──────────────────────────┘
            │                                              │
            │   src/preload/index.ts (typed window.mailApi)│
            └──────────────────────────────────────────────┘
```

Only the main process talks to the OS, the network and the database. The
renderer is sandboxed and gets a small typed surface (`window.mailApi`) via
the preload bridge defined in `src/shared/ipc.ts`.

## Source layout

```
src/
├── main/                  # Node-side: services, IPC, OS integration
│   ├── index.ts           # entry point: lifecycle, single-instance lock,
│   │                      # MailService boot, data migration hook-in
│   ├── ipc/               # register-mail-ipc.ts: every IPC handler lives here
│   ├── services/
│   │   ├── mail-service.ts      # high-level façade (account CRUD, archive)
│   │   ├── mail-engine/         # imap/SMTP connections, queues, transport
│   │   ├── database.ts          # Prisma client + raw DDL + queries
│   │   ├── google-oauth.ts      # Gmail OAuth refresh-token flow
│   │   ├── secure-storage.ts    # Electron safeStorage wrapper
│   │   └── data-migration.ts    # upgrade-safe wipe-except-logins
│   ├── config/                  # runtime env loader
│   └── utils/                   # error + URL helpers
├── preload/index.ts             # contextBridge: exposes window.mailApi
├── renderer/src/                # React app
│   ├── App.tsx                  # root: bootstraps state, mounts shell
│   ├── features/                # feature folders (mail/, settings/)
│   ├── components/ui/           # shadcn-style components
│   ├── lib/                     # tiny client utilities (utils, dates, ...)
│   └── styles/globals.css       # Tailwind v4 entry + theme tokens
├── shared/                      # types and IPC channel constants used both sides
└── extensions/archive/          # public stub of the optional archive extension
```

## Data model

The local store is a single SQLite file under
`app.getPath('userData')/siever-mail.sqlite`. Schema is declared in
`prisma/schema.prisma` and re-asserted at boot via raw `CREATE TABLE
IF NOT EXISTS` statements in `src/main/services/database.ts` so that
schema drift is self-healing.

Key tables:

| Table                | Purpose                                                                                                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accounts`           | Mail accounts (IMAP/Gmail). `encrypted_secret` stores the safeStorage-wrapped password / OAuth refresh token.                                                                                                          |
| `folders`            | Per-account folder metadata + sync cursors (UID validity, modseq).                                                                                                                                                     |
| `messages`           | Message envelopes + body cache + attachments JSON. Also carries `is_flagged` and the denormalised `sender_name` / `sender_key`, which let the database order and group by sender without sorting the raw address JSON. |
| `contacts`           | Address-book learned from sent/received traffic.                                                                                                                                                                       |
| `account_signatures` | One signature row per account.                                                                                                                                                                                         |
| `app_preferences`    | Singleton row of app-wide UI preferences: unified-inbox account selection, layout mode, list sort, grouping, inverted-order flag. Read and written as one `UiPreferences` record.                                      |

Extensions may install additional tables of their own through the
`database.applyDdl()` handle exposed at install time. They share the
same SQLite connection (and therefore the same WAL) so cross-table
transactions stay safe; the host never reads or writes them.

### Upgrade lifecycle

Versioning of the local data is tracked in `userData/install-version.json`.
`src/main/services/data-migration.ts` splits the file into two categories and
treats them oppositely:

- **cache** — `messages` and `folders`. The IMAP server is their source of
  truth and their shape changes between releases, so a version change drops
  them and lets the next sync rebuild them.
- **user data** — everything else: accounts, signatures, preferences, the
  contact history, and any table an extension installed. None of it exists
  anywhere else, so it is never touched.

The flow is: `prepareUpgradeMigration()` runs before the database is opened
and takes a WAL-checkpointed backup; the schema reconciles additively as
usual; `finalizeUpgradeMigration()` then purges the cache tables and stamps
the new marker — deliberately before the mail engine starts, so the purge
cannot race an incoming sync.

If the app never reaches the finalize step, the pending marker is still on
disk at the next launch and the recovery path takes over: the unusable file
is set aside, the app boots on a fresh schema, and every table the backup and
the new schema share — minus the cache — is copied back. That copy walks
`sqlite_master` instead of a hardcoded list, which is how extension-owned
tables survive without the public host knowing their names.

> Releases up to 1.7.1 did the opposite: they deleted the whole database and
> restored only accounts and signatures, silently destroying the SIEVER
> archive root, every manually-added practice and the app preferences on each
> update. `src/main/services/data-migration.test.ts` covers the new
> behaviour, including the recovery path.

## Mail engine

`MailEngine` is the broker between the IMAP/SMTP world and the rest of the
app. Each `Account` gets its own `AccountConnection` instance which holds
an `imapflow` socket, a folder cache, a sync queue and IDLE-based change
listeners. The engine emits four kinds of events into the renderer:

- `engine:messages-changed` — folder content delta (added/updated/removed).
- `engine:folders-changed` — folder list / counts.
- `engine:unified-inbox-changed` — aggregate summary across accounts.
- `engine:account-connection-changed` — connection state machine
  (`connecting` → `connected` → `reconnecting` → `error` / `disconnected`).

There is no fixed-interval polling. All updates are server-pushed; the UI
reacts to events.

## Renderer state

`App.tsx` owns the top-level state:

- Selected account, selected folder.
- The page-of-messages currently rendered + total count.
- The selection (see below).
- The persisted `UiPreferences` record and the transient list filter.
- Composer / settings / archive dialog open flags.
- A normalised map of per-account connection statuses (used by the online /
  offline indicator in the header).

The IPC bridge exposed at `window.mailApi` is the single source of truth for
all data; renderer state is essentially a denormalised cache of what the
main process tells it via the four event channels above.

### Selection model

`src/renderer/src/lib/message-selection.ts` keeps two notions apart:

- the **selection** — every row an action applies to;
- the **cursor** — the row the keyboard is on, and the pivot a Shift range
  measures from.

Conflating them is what made a Ctrl-clicked row keep its highlight after
being removed from the selection. They are one state value so every mutation
commits atomically, and the list paints them differently: a fill for
selected, an inset ring for the cursor. Mouse and keyboard follow the
Explorer/Finder conventions — plain click replaces, Ctrl/Cmd toggles, Shift
extends, `Ctrl/Cmd+A` selects all, `Esc` collapses to the cursor.

The reading pane follows a selection of exactly one; above that it shows a
summary and the toolbar acts on the whole set.

### Layouts

`src/renderer/src/features/workspace/workspace-layout.tsx` holds the two
arrangements (`apple`, `outlook`). Both receive identical props and share
every component inside them — only the geometry differs, plus which list
shell fills the message slot (`message-list.tsx` vs `message-table.tsx`).
Both shells implement `MessageListViewProps`, so the layout is a one-line
preference rather than a fork in the state logic. A third arrangement,
`expanded`, is not a preference: it is what either layout becomes when the
reading pane is expanded, and it narrows the list to a spine beside a
full-height reader.

Every dimension in that file is a `clamp()`, never a breakpoint and never a
fixed pixel count, because the app has to survive any window size and any
live resize rather than a handful of tested ones. The sidebar is
`clamp(196px, 15%, 256px)`, the apple message list `clamp(288px, 27%, 408px)`
and the expanded spine `clamp(260px, 22%, 360px)`, so each track keeps a
usable floor, tracks the window in between and stops growing once more width
would only pad it.

The outlook split is the one measurement that cannot be expressed as a
percentage, because what matters there is how many messages the user can take
in at a glance. `src/renderer/src/features/mail/message-list-metrics.ts`
holds the table's real chrome — panel header, column header, two grouping
bands, border slack — and `messageTablePaneHeight(rows)` converts a row count
into a pane height, so the layout asks for fifteen rows and the arithmetic
follows the row height the table actually renders. The result is wrapped in
`min(clamp(…15 rows…, 48%, …20 rows…), 62%)`: the outer `min()` is the safety
valve, so a window too short to honour the floor gives up rows instead of
starving the message below it.

### The reading header

The reading pane's header used to cost 151px — a subject line, a row of
labelled actions and a four-line Da/A/Cc/Data grid — before a single line of
the message appeared. In the outlook layout, where the reader is only about
half the workspace, that was most of the space the customer wanted for the
email itself. It is now 66px at every resolution, and the two rules that keep
it there are worth stating because they are easy to undo by accident.

First, the envelope collapses to one line (`Da · A · data · 📎`) with a
`Dettagli` disclosure that expands the full grid in place, the way every mail
client handles it.

Second, only the actions the toolbar has no equivalent for carry a label.
The toolbar labels what acts on the selection — archivia, sposta, segna,
contrassegna, elimina — so repeating those words in the header stacked two
identical rows on top of each other, most visibly in the expanded view. The
header therefore labels `Rispondi` and `Inoltra` and keeps the rest as icons
with tooltips; the labelled toolbar directly above is what makes them
discoverable. That takes the action row from ~664px to ~339px, which is why
the subject and the actions still share one line on a narrow pane instead of
wrapping to a third row.

### Grouping

`src/renderer/src/lib/message-sections.ts` slices an already-ordered page
into labelled runs. The database does the ordering: sender grouping asks the
query to order by sender first so each run arrives contiguous. Section keys
carry the run's ordinal because the same sender can legitimately appear in
several runs while a re-ordered page is still in flight — duplicate React
keys there break reconciliation and strand DOM nodes.

### Attachments vs body imagery

A modern Outlook message carries the sender's signature logos, the corporate
banner and every picture from the quoted chain below as `cid:`-referenced
MIME parts; a dozen of them is ordinary. Treating those as attachments puts a
paperclip on nearly every message, offers `image005.png` next to the one real
document in the reading pane, and — in the SIEVER archive — writes them all
out as loose files beside the message.

`src/main/services/mail-engine/message-parts.ts` owns the single rule that
separates the two. A part is body content when its Content-ID is referenced
from the HTML, when mailparser placed it in the `multipart/related`
container, or when it is `inline` and carries a Content-ID. The cid reference
is the decisive signal: disposition alone is not enough, because Outlook
labels signature logos `Content-Disposition: attachment` while still drawing
them through `cid:`. A message with no HTML body has nothing that could
reference a `cid:`, so everything it carries counts as an attachment.

Three consequences worth knowing:

- `parseMessageSource` sets `skipImageLinks`, so `parsed.html` keeps its
  `cid:` references instead of being rewritten into inline `data:` URIs.
  Rewriting is convenient for a viewer but lossy for anything reconstructing
  the message. The reading pane inlines them itself, later, on its own copy.
- Classified attachments carry their **original index** in
  `parsed.attachments`. Downloads re-parse the message and index straight
  into that array, so a filtered list must never renumber.
- The message list's paperclip comes from BODYSTRUCTURE, before any body is
  available, so it uses the closest proxy — an image part with a Content-ID
  is body imagery. Once the body is actually fetched the answer is exact, and
  `updateMessageBody` writes the corrected flag back, so opening a message
  quietly fixes a row that was flagged for nothing but a logo.

### Search grammar

`src/shared/search.ts` is parsed once and consumed by both sides: the main
process turns the result into a Prisma `WHERE`, the renderer uses the same
terms to highlight matches, so a row can never be "returned but not
highlighted". Whitespace ANDs, a bare `OR` alternates, quotes make a phrase,
and a `da:` / `a:` / `oggetto:` prefix (with the English `from:` / `to:` /
`subject:` as aliases) confines a term to one field. Scoped terms only
highlight the field they matched on.

## Testing

`npm test` runs two vitest projects: `main` on the node environment (main
process and shared code) and `renderer` on jsdom. Path aliases mirror
`electron.vite.config.ts`, and `@app/extension/*` resolves to the drop-in
when one is checked out — so an extension can ship its own tests and they run
with the host's suite. The `extension/**` globs are inert in the public
repository, where the directory simply does not exist.

`better-sqlite3` is rebuilt against Electron's ABI, so plain Node cannot load
it; tests that need SQLite mock it over Node's built-in `node:sqlite`.

## Theming

The Tailwind v4 setup lives in `src/renderer/src/styles/globals.css` and
declares semantic tokens (`--background`, `--card`, `--primary`, `--ring`,
…) plus optional brand tokens (`--brand-primary`, `--brand-accent`,
`--status-online`, `--status-offline`). Components consume the tokens via
`@theme inline`-mapped Tailwind colour utilities. Hardcoded colours are
forbidden anywhere there is a sensible token.

## Build & release

The single-source-of-truth build entry is `build.mjs` at the repo root. It
takes a positional `<version>` argument and the following flags:

- `--target=<id>` — build a single target (`macos-arm64`, `macos-x64`,
  `windows-x64`, `linux-x64`, `linux-arm64`).
- `--all` — build the entire matrix in sequence (Linux runs in Docker).
- (no flag) — build the default duo `macos-arm64` + `windows-x64` for
  quick local releases.

The script writes artifacts under `release/<variant>/v<version>/`. The
`<variant>` segment is `public` for the open-source build and `siever`
when the optional extension is loaded.

`build.mjs` exports `runBuild()` so other scripts (notably the
gitignored `build-siever.mjs` wrapper) can invoke the same logic with a
preset variant.

A GitHub Actions workflow (`.github/workflows/release.yml`) runs the
script with `--target=<id>` on per-OS runners in parallel, downloads the
artifacts and publishes them as a GitHub Release whenever a `v*` tag is
pushed.

## Extension system

SIEVER Mail reserves a single optional extension slot loaded at build
time through three Vite aliases:

- `@app/extension/main` — main-process entry
- `@app/extension/renderer` — renderer entry
- `@app/extension/preload` — preload bridge additions

Their target resolves to no-op stubs under `src/extension/` for the
default open-source build. A custom build supplies its own
implementation through those aliases (typically by checking out a
private extension repository to a local path and pointing the aliases
at it via `LOAD_EXTENSION=1`); see
[`electron.vite.config.ts`](../electron.vite.config.ts) for the exact
resolution policy. A build-time constant `__APP_BUILD_VARIANT__`
(`'public' | 'siever'`) is also injected for diagnostic checks.

### What an extension can contribute

Defined in [`src/extension/types.ts`](../src/extension/types.ts):

| Surface                       | Where it shows up                                     |
| ----------------------------- | ----------------------------------------------------- |
| `defaultAccountSignatureHtml` | Auto-applied to the very first account a user adds    |
| `toolbarActions[]`            | Buttons next to "Nuovo messaggio" in the mail toolbar |
| `settingsTabs[]`              | Extra tabs after the core tabs in the Settings dialog |
| `PrimaryActionDialog`         | Optional dialog mounted at the renderer root          |
| `install(context)`            | IPC handlers, DDL, startup hooks                      |
| `ExtensionPreloadInstaller`   | Additional methods merged onto `window.mailApi`       |

The host is responsible for state coordination: it tracks which selected
messages a toolbar action sees, opens/closes the primary dialog, and
provides `ExtensionHostHooks` (e.g. `optimisticallyRemoveMessage`) so
extensions reuse the host's UX primitives rather than reimplementing
them.

### Extension main context

The `install()` hook receives an `ExtensionMainContext` exposing:

- `app` — the Electron `App` instance
- `ipcMain` — for registering custom IPC handlers
- `userDataDirectoryPath` — typically `app.getPath('userData')`
- `database` — a thin SQL handle (`applyDdl` / `query` / `execute`) backed
  by the host's shared SQLite connection so extension writes
  participate in the same WAL
- `mailEngine` — `fetchMessageRawSource(ref)` returns the raw RFC 822
  source plus a parsed envelope; the extension can use it to materialise
  archived emails, build attachments archives, etc.
- `getMainWindow()` — to broadcast events back to the renderer

This context is intentionally minimal so extensions stay portable across
host versions.

### Authoring an extension

A new extension only needs three small entry files plus whatever
internal modules it wants to keep private:

```
my-extension/
├── main/
│   └── index.ts        # `export default ExtensionMain`
├── renderer/
│   └── index.tsx       # `export default ExtensionRenderer`
└── preload/
    └── index.ts        # `export default ExtensionPreloadInstaller`
```

Pointing the Vite aliases at `my-extension/{main,renderer,preload}/index`
and starting the build with the feature flag set is enough; nothing in
the host's source tree needs to change.

SIEVER Mail was originally developed as an internal tool for the
Italian engineering company **SIEVER S.R.L.** (which is unrelated to
the open-source project — see the README disclaimer). Their
company-specific customisations have been split into a separate
private repository owned by the maintainer, loaded as a regular
extension through the surface above.

## Security notes

- The renderer runs with `contextIsolation: true` and `nodeIntegration: false`.
- The preload script exposes only a small typed surface; nothing else
  crosses the IPC boundary.
- Incoming HTML mail bodies are sanitised with DOMPurify before display.
- Credentials at rest pass through `safeStorage`. On platforms where the OS
  keychain is unavailable, the application refuses to persist secrets.
- External URLs go through `normalizeExternalHttpUrl()` and `shell.openExternal`
  with strict allow-lists.

## License

Apache License 2.0. See [`LICENSE`](../LICENSE).

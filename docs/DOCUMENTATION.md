# SIEVER Mail — Technical Documentation

This document describes the architecture, the runtime topology and the main
implementation choices behind SIEVER Mail. It is intended for engineers who
need to read, debug or extend the code.

## Stack

| Layer        | Technology                                                |
| ------------ | --------------------------------------------------------- |
| Shell        | [Electron](https://www.electronjs.org/)                   |
| Bundler      | [`electron-vite`](https://electron-vite.org/) + Vite      |
| UI           | [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) |
| Styling      | [TailwindCSS v4](https://tailwindcss.com/) + shadcn-style components |
| Local store  | [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) + [Prisma](https://www.prisma.io/) (SQLite adapter) |
| Mail engine  | [`imapflow`](https://imapflow.com/) (IMAP) + [`nodemailer`](https://nodemailer.com/) (SMTP) |
| Gmail        | [`googleapis`](https://github.com/googleapis/google-api-nodejs-client) (OAuth, no Gmail HTTP API) |
| Editor       | [Squire](https://github.com/fastmail/Squire) (rich-text)  |
| HTML safety  | [DOMPurify](https://github.com/cure53/DOMPurify)          |
| Tests        | [Vitest](https://vitest.dev/) + Testing Library + Playwright |

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

| Table                | Purpose                                                |
| -------------------- | ------------------------------------------------------ |
| `accounts`           | Mail accounts (IMAP/Gmail). `encrypted_secret` stores the safeStorage-wrapped password / OAuth refresh token. |
| `folders`            | Per-account folder metadata + sync cursors (UID validity, modseq). |
| `messages`           | Message envelopes + body cache + attachments JSON. |
| `contacts`           | Address-book learned from sent/received traffic.   |
| `account_signatures` | One signature row per account.                     |
| `app_preferences`    | Singleton row: app-wide UI preferences (currently the unified-inbox account selection). |

Extensions may install additional tables of their own through the
`database.applyDdl()` handle exposed at install time. They share the
same SQLite connection (and therefore the same WAL) so cross-table
transactions stay safe; the host never reads or writes them.

Versioning of the local data is tracked separately in
`userData/install-version.json`. The migration module compares this marker
against `app.getVersion()` at startup; on mismatch it stashes login rows
into `userData/.upgrade-credentials-stash.json`, wipes the database +
ancillary caches, and restores the stash once the new schema is in place.
This guarantees a clean upgrade with preserved logins, even across schema
changes.

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

- Selected account, selected folder, selected message ref.
- The page-of-messages currently rendered + total count.
- Multi-selection state.
- Composer / settings / archive dialog open flags.
- A normalised map of per-account connection statuses (used by the online /
  offline indicator in the header).

The IPC bridge exposed at `window.mailApi` is the single source of truth for
all data; renderer state is essentially a denormalised cache of what the
main process tells it via the four event channels above.

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

| Surface                             | Where it shows up                                      |
| ----------------------------------- | ------------------------------------------------------ |
| `defaultAccountSignatureHtml`       | Auto-applied to the very first account a user adds     |
| `toolbarActions[]`                  | Buttons next to "Nuovo messaggio" in the mail toolbar  |
| `settingsTabs[]`                    | Extra tabs after the core tabs in the Settings dialog  |
| `PrimaryActionDialog`               | Optional dialog mounted at the renderer root           |
| `install(context)`                  | IPC handlers, DDL, startup hooks                       |
| `ExtensionPreloadInstaller`         | Additional methods merged onto `window.mailApi`        |

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

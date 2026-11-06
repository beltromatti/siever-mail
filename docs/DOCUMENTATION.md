# SIEVER Mail — Technical Documentation

How SIEVER Mail is put together: the processes, the data, the connections,
the mail engine, the interface, the Segretario, the calendar and the
extension surface. It is written for engineers who read, debug or extend
the code. The code comments go deeper on each piece; this page is the map.

## Stack

| Layer       | Technology                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shell       | [Electron](https://www.electronjs.org/) 44 (macOS 13+, Windows 10+ x64, Linux)                                                                         |
| Bundler     | [electron-vite](https://electron-vite.org/) + Vite                                                                                                     |
| UI          | [React 19](https://react.dev/) + TypeScript, [Tailwind CSS v4](https://tailwindcss.com/), Radix/shadcn                                                 |
| Local store | SQLite through [Prisma 7](https://www.prisma.io/) and its `better-sqlite3` adapter                                                                     |
| Mail        | [imapflow](https://imapflow.com/) (IMAP), [nodemailer](https://nodemailer.com/) (SMTP), mailparser                                                     |
| Google      | OAuth 2.0: Gmail over IMAP/SMTP (XOAUTH2), no Gmail HTTP API; the Calendar API through googleapis                                                      |
| Microsoft   | [MSAL Node](https://www.npmjs.com/package/@azure/msal-node): IMAP/SMTP with OAuth, Microsoft Graph for the calendar and, where SMTP is off, sending    |
| Calendars   | Google Calendar API, Microsoft Graph, CalDAV ([tsdav](https://github.com/natelindev/tsdav)), iCalendar ([ical.js](https://github.com/kewisch/ical.js)) |
| Editor      | [Squire](https://github.com/fastmail/Squire), inside a sandboxed iframe                                                                                |
| Lists       | [TanStack Virtual](https://tanstack.com/virtual) for the endless message list                                                                          |
| HTML safety | [DOMPurify](https://github.com/cure53/DOMPurify)                                                                                                       |
| Tests       | [Vitest](https://vitest.dev/) (node + jsdom projects)                                                                                                  |
| Segretario  | The user's own [OpenRouter](https://openrouter.ai/) key; the newest DeepSeek Flash; no server of ours                                                  |
| Documents   | unpdf (PDF text), PDF.js (scanned pages), mammoth (Word), SheetJS (spreadsheets), fflate (OpenDocument)                                                |
| Markdown    | [Streamdown](https://streamdown.ai/) for what the Segretario writes, as it writes it                                                                   |

## Processes and startup

The usual Electron split. Only the main process touches the network, the
file system and the database; the renderer is context-isolated and reaches
it through the typed `window.mailApi` bridge (`src/preload/index.ts`,
channels in `src/shared/ipc.ts`), the Segretario through
`window.segretarioApi` (channels in `src/shared/segretario.ts`), the
calendars through `window.calendarApi` (channels in `src/shared/calendar.ts`)
and the File source through `window.filesApi` (`src/shared/files.ts`).

SIEVER Mail is a set of apps at par, not a mail client with extras. The
sources — Posta, Calendario and, coming, File — each bring their objects
from their own family of connections; Contatti and Progetti are derived,
with no connections of their own; Oggi is the Segretario's desk. The
families and the apps are declared once (`src/shared/workspace.ts`:
`CONNECTION_FAMILIES`, `WORKSPACE_APPS`), and the rail, Settings and the
Segretario read them from there. A new source is a family, an object, a
way for the Segretario to notice it, its tools and its app; the registry,
Oggi and the projects take it in as they take mail and calendars.

The main process is put together by the `Workspace`
(`src/main/workspace.ts`). It owns what every app shares — the database,
the sign-ins with Google and Microsoft — creates the sources as peers,
`MailService` and `CalendarService`, and the `SegretarioService` over
them, and connects them through ports: the Segretario's to the mail
(`MailService.segretarioPort`) and to the calendars, the mail's to the
Segretario's lists, and the hooks by which one learns of another — new
mail wakes the Segretario, a mailbox or a calendar removed is forgotten.
What spans sources is its own: a Google or Microsoft consent that brings
mail and calendar, a message's invitation with its event, "Elimina tutti
i dati". No source creates another, nor the Segretario.

Startup, from `src/main/index.ts`:

1. `prepareUpgradeMigration()` — before the database is opened, detects a
   version change and backs up the user data (see
   [Upgrades](#upgrades)). Never throws.
2. `Workspace.start()` opens the storage (`Workspace.openStorage()`):
   SQLite opens, the schema is reconciled, then any upgrade migration
   finishes.
3. The sources open: the mounted network shares are remembered (see
   [Network shares](#network-shares)); `MailService.start()` applies the
   notification preferences and the icon badge, the mail engine connects
   the accounts and the drafts the server lacks are filed; then the
   calendars open (see [Calendar](#calendar)) and the Segretario opens
   (see [Segretario](#segretario)). The calendar and the Segretario open
   even when the mail engine could not start; either failing to open is
   logged and leaves the others working. When startup fails, what waits
   for the calendar and the Segretario is rejected, so their channels
   answer with the reason instead of hanging.
4. The extension installs (see [Extensions](#extensions)).

The window is created right away and loads alongside. **Every IPC channel
that touches stored data waits for step 2** (`register-mail-ipc.ts`), so
the interface never reads rows the migration is about to purge or restore;
channels that only drive the window (minimise, close, …) never wait. The
calendar's channels also wait for the calendars to open, the Segretario's
for it to open (`register-calendar-ipc.ts`, `register-segretario-ipc.ts`).

The theme is applied before any of this, from a one-word file in the user
data folder, so the first frame is already in the right colours
(`src/main/theme.ts`). The window's session grants one web permission, the
clipboard write "Copia indirizzo" needs; Electron would otherwise grant
them all.

## Source layout

```
src/
├── main/                      Node side
│   ├── index.ts               lifecycle, window, tray, permissions
│   ├── workspace.ts           the root: shared database and sign-ins, the sources, the Segretario, startup order
│   ├── app-identity.ts        the bundle id / AppUserModelID
│   ├── app-window.ts          the window the user works in, named
│   ├── app-menu.ts            macOS menu bar (Italian); none elsewhere
│   ├── context-menu.ts        native menus for text, links, pictures, spelling
│   ├── theme.ts               Sistema / Chiaro / Scuro → nativeTheme
│   ├── config/env.ts          the OAuth clients the build carries (Google, Microsoft)
│   ├── ipc/                   IPC handlers: the mail's, the calendars', the files', the Segretario's
│   ├── ai/                    the Segretario (see Segretario)
│   │   ├── segretario-service.ts  the façade the IPC calls: key, switch, setup, the user's work
│   │   ├── agent/             the runner, the conversation rebuilt from the log, short handles, tool ports
│   │   ├── engine/            the planner, the durable work queue, the scheduler
│   │   ├── tasks/             what each kind of run starts from, and how a run starts
│   │   ├── registry/          the user's work: notes, commitments, projects, replies, proposals, copies, the day
│   │   ├── memory/notebook.ts the versioned memory
│   │   ├── tools/             the tool catalogue
│   │   ├── prompts/           its words, in Italian: identity, context, tasks, tools, chores
│   │   ├── schema.ts          its tables, versioned, and the migration from 1.x
│   │   ├── ai-store.ts        key, usage, runs and their logs, lessons, learning, facts
│   │   ├── openrouter.ts      the model: requests, streaming, errors, the key's credit
│   │   ├── mail-search.ts     the full-text index as the agent asks it
│   │   ├── mail-overview.ts   who the user writes to and hears from, month by month
│   │   ├── extraction.ts      the text of PDFs, Office files, spreadsheets, pictures
│   │   └── pdf-pages.ts       scanned PDF pages drawn as pictures, in a hidden window
│   ├── calendar/              calendar connections, sync, providers (Google, Graph, CalDAV, links), iCalendar, search
│   ├── files/file-sources.ts  the File source as it is today: this computer, its volumes, the network shares
│   ├── services/
│   │   ├── mail-service.ts    the mail: the façade its IPC calls, the Segretario's port to it
│   │   ├── database.ts        Prisma client, raw DDL, queries
│   │   ├── data-migration.ts  upgrade lifecycle
│   │   ├── mail-engine/       connections, sync, identity, archiving, sending, parsing, notifications
│   │   ├── mail-discovery.ts  a mailbox's servers from its address
│   │   ├── mail-tokens.ts     the access tokens of the mailboxes signed in with OAuth
│   │   ├── google-oauth.ts    Google sign-in (Gmail, Google Calendar)
│   │   ├── microsoft-oauth.ts Microsoft sign-in, with MSAL
│   │   ├── drafts.ts          drafts: kept here as they are typed, filed in Bozze
│   │   ├── contact-ranking.ts which contacts the composer suggests, in what order
│   │   ├── attachment-files.ts  attachment copies (opened, forwarded) on disk
│   │   ├── recent-files.ts    the OS's recent documents, for "Allega"
│   │   ├── network-volumes.ts shares a restart left unmounted, mounted again
│   │   ├── app-badge.ts       the unread count on the Dock / taskbar icon
│   │   ├── file-utils.ts      names, unique writes
│   │   └── secure-storage.ts  safeStorage wrapper for secrets
│   └── utils/                 logging to file, errors, external URLs
├── preload/index.ts           window.mailApi, window.segretarioApi, window.calendarApi, window.filesApi
├── renderer/src/
│   ├── App.tsx                the shell: rail, the Segretario's panel, Settings, the setup,
│   │                          opening a message, an event or a project from anywhere
│   ├── apps/                  Oggi (today/), the Posta (mail/), the Calendario (calendar/),
│   │                          the page of an app with nothing to show yet (app-placeholder.tsx)
│   ├── features/              connections, onboarding, mail (list, table, reader, composer,
│   │                          editor), calendar (invitations), segretario, settings, workspace
│   ├── components/ui/         shared primitives (dialog, confirm, menus…)
│   ├── lib/                   selection, sections, HTML pipelines, zoom
│   └── styles/globals.css     Tailwind entry and the theme tokens
├── shared/                    types, commands and shortcuts, search grammar, folder
│                              roles, address parsing, fonts, sender/subject keys,
│                              the Segretario's contract (segretario.ts) and its links
│                              (segretario-links.ts), the calendars' (calendar.ts),
│                              the files' (files.ts), the apps and connection families
│                              (workspace.ts), mail discovery (connections.ts)
└── extension/                 the extension contract and its no-op stubs
```

## Data

One SQLite file, `userData/siever-mail.sqlite`. The schema is declared in
`prisma/schema.prisma` and applied at boot with raw
`CREATE TABLE IF NOT EXISTS` plus additive column checks in `database.ts`,
so an older file is brought forward in place. The Segretario's tables are
created and migrated by `src/main/ai/schema.ts`, which `database.ts` calls:
their shape has its own version in `ai_meta` (`schema_version`, now 5;
step 4 adds the links of the words that stay, see [Runs](#runs); step 5
rebuilds `ai_items` so a commitment may come from a message, an event or
the user's word — the message's columns nullable, `event_key` added — and
can run again over a rebuild cut short), and a
fresh install runs every step in order, as an old file runs the steps it
has not had. The step from 1.x renames the commitments' states, turns
topics into projects (an extension's pratiche only where they had
conversations) and what an extension archived (`ai_archived`) into saved
copies; `database.ts` turns the 1.x `calendar_accounts` into calendar
connections with the same ids, so events keep their keys.

| Table                                                       | Holds                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accounts`                                                  | The mail connections: `type` `gmail` or `imap` (Microsoft's are `imap` signed in with `oauth`); `encrypted_secret` is the password, Google's refresh token or MSAL's token cache, encrypted with `safeStorage`.                                                                                                                                      |
| `folders`                                                   | Folder metadata and sync cursors (UIDVALIDITY, HIGHESTMODSEQ, UIDNEXT, last UID). _Cache._                                                                                                                                                                                                                                                           |
| `messages`                                                  | Envelopes, previews, flags. `message_key` names a message wherever it is filed, `thread_id` its conversation (see [Mail engine](#mail-engine)). Denormalised `sender_label` / `sender_sort` / `subject_sort` let the database sort and group by sender or subject, and the folded `search_*` columns let it search without case or accents. _Cache._ |
| `message_bodies`                                            | One body per `message_key`, shared by every folder that holds the message: its text for the index (level 1) or the readable message with its parts (level 2). _Cache._                                                                                                                                                                               |
| `message_fts`                                               | The full-text index (FTS5 over `message_bodies`, kept in step by triggers), accents and case folded as the search box folds them. _Cache._                                                                                                                                                                                                           |
| `search_hits`                                               | The index's matches for the searches on screen, so the list's query joins them instead of carrying thousands of ids. _Cache._                                                                                                                                                                                                                        |
| `app_meta`                                                  | Small facts about the file itself: the shape of the cache (`cache_version`).                                                                                                                                                                                                                                                                         |
| `contacts`                                                  | Everyone stored mail names, for the composer's suggestions: `usage_count` / `last_used_at` count the mail written to them, `last_received_at` the newest they sent, `hidden_at` a contact taken out of the suggestions.                                                                                                                              |
| `drafts`                                                    | The messages being written: recipients, subject, body, files, the thread they answer; `revision` / `server_revision` say whether Bozze has the draft as it is, `server_*` where its copy is, `docked` that a composer holds it.                                                                                                                      |
| `account_signatures`                                        | One signature per account, with the version of the page it was written for (`html_format`) and the edition of the extension's content it has (`extension_revision`).                                                                                                                                                                                 |
| `recent_files`                                              | Files the user attached, saved or an extension filed away, offered first in "Allega".                                                                                                                                                                                                                                                                |
| `recent_folders`                                            | The folders each account's messages were last moved to, offered first by "Sposta".                                                                                                                                                                                                                                                                   |
| `message_id_keys`                                           | Which message holds each key made of a Message-ID, by the digest every copy shares, kept after its rows go (see [Mail engine](#mail-engine)). Not cache: a cache reset keeps who is who.                                                                                                                                                             |
| `left_out_messages`                                         | Messages a folder's sync leaves out for now: the app's own deletions not expunged yet, and those the server refuses to give, with their tries. _Cache._                                                                                                                                                                                              |
| `app_preferences`                                           | One row: theme, layout, list order, sort, grouping, reader zoom, "Dettagli", shortcut overrides, the accounts "Tutti gli account" gathers, the notification preferences, the extension signature edition every account has joined.                                                                                                                   |
| `calendar_connections`                                      | Each calendar connection on its own: `provider` (`google`, `microsoft`, `caldav`, `ics`), the account or name it shows, the mail connection that came with the same access (`mail_account_id`), the server, the token, password or link encrypted with `safeStorage`, the last sync and its problem.                                                 |
| `calendar_calendars`                                        | A connection's calendars: name, primary, writable, colour, hidden in the Calendario, and where their sync stands (`sync_token`, `window_end`).                                                                                                                                                                                                       |
| `calendar_events`                                           | The events in the window, an instance per occurrence: times, place, guests and answers, the call's link, the iCalendar UID (Exchange's read from its Global Object ID, `canonicalUid`), and `origin_json` when the Segretario put it there.                                                                                                          |
| `calendar_objects`                                          | A CalDAV calendar's objects as the server has them (URL, ETag, iCalendar text), to sync and to change them in place.                                                                                                                                                                                                                                 |
| `calendar_changes`                                          | What a sync found changed not through the app — new, changed, cancelled — with the event before and after, kept a month for the Segretario.                                                                                                                                                                                                          |
| `ai_meta`                                                   | The Segretario schema's version and the facts kept between runs: the guided setup under way (`onboarding`), how far the calendar's changes were looked at (`calendar_seen`), the day whose morning run is done (`morning_done`), when keeping up last found too little to do (`keep_up_checked`).                                                    |
| `ai_settings`                                               | The OpenRouter key, encrypted with `safeStorage`, the last check of it, and the one switch (`SegretarioPreferences`).                                                                                                                                                                                                                                |
| `ai_activities`, `ai_events`                                | Every run: its task, where it shows (`pannello`, `diario`, `nascosta`), the work unit it ran; and the log of everything said and done in it, which the conversation is rebuilt from.                                                                                                                                                                 |
| `ai_work`                                                   | The engine's queue: units of work by task and scope key, with priority, status, attempts and when they may start.                                                                                                                                                                                                                                    |
| `ai_usage`                                                  | Every call to the model: its task, tokens, cache hits and what OpenRouter billed.                                                                                                                                                                                                                                                                    |
| `ai_memory`, `ai_memory_history`                            | The notebook, path → Markdown with a revision and who wrote it last, and the past versions of each note.                                                                                                                                                                                                                                             |
| `ai_learning`                                               | The connections Conoscimi knows — a mailbox by its id, a calendar as `calendario:<id>` — with the run that did it.                                                                                                                                                                                                                                   |
| `ai_lessons`                                                | What the next reflection takes in: drafts the user corrected or sent as they were, their corrections and decisions on notes, commitments, projects, replies, proposals and the memory — each with the message it is about and the open thing's number — a mailbox or a calendar removed.                                                             |
| `ai_drafts`                                                 | The drafts the Segretario wrote, as it wrote them, to compare with what the user sends.                                                                                                                                                                                                                                                              |
| `ai_notes`                                                  | The note on each message, by its key: the gist, its nature (`da_rispondere`, `da_fare`, `in_attesa`, `informativo`, `rumore`), priority, reason, deadline, who wrote it last, a revision.                                                                                                                                                            |
| `ai_items`, `ai_item_history`                               | The commitments ("cose aperte"), each from where it came: a message (account, conversation, message), an event (`event_key`) or the user's word; kind, text, deadline, status, who set it and why, the message that showed it, a question for the user, a revision; and every change to them, before and after.                                      |
| `ai_projects`, `ai_project_threads`, `ai_project_resources` | The projects (title and who gave it, description, "Il punto" with its links (`state_links_json`) and since when it is behind, hidden, concluded), the conversations in each — one in several, or rejected by the user, with who linked it — and the folders and events linked to them.                                                               |
| `ai_ready_drafts`                                           | Replies and reminders prepared ahead, one per message, with where each stands.                                                                                                                                                                                                                                                                       |
| `ai_proposals`                                              | What the Segretario recommends and may not do alone — a new event, a change to one, an answer to an invitation, an extension's action — until the user accepts it or sets it aside.                                                                                                                                                                  |
| `ai_saved_copies`                                           | Copies an extension saved outside the mail, by message and destination, with their files.                                                                                                                                                                                                                                                            |
| `ai_gone`                                                   | Messages something open came from that are missing from every folder, and since when (see [Views](#views)).                                                                                                                                                                                                                                          |
| `ai_briefings`, `ai_event_preps`                            | The letter at the top of Oggi, by local day, and how to prepare for a meeting, by event, each with the links of its short names (`links_json`).                                                                                                                                                                                                      |
| `ai_saved_searches`                                         | Searches asked in words that the user kept as folders: the search they became, run again each time.                                                                                                                                                                                                                                                  |

Beside the database, `network-volumes.json` remembers the URL each network
share was mounted from (macOS).

An extension may add tables through the database handle it receives; they
live in the same file and connection. The host never reads them.

"Elimina tutti i dati" (Settings → Dati) empties the mail cache, the
contacts, drafts, signatures and recent files and folders, the Segretario's
tables but its key and settings (`AiStore.clearData`), and the calendars'
calendars and events — the connections stay and read them anew — then
calls the extension's `clearData()`, all with the mail's connections
stopped (`Workspace.clearAllDataKeepAccounts`); the AI turns off, so on
again it starts from the guided setup. The accounts, the calendar
connections and the preferences stay. Clearing one account's data drops
its cache and the copies of its attachments, and keeps its signature; the
mail downloads again.

### Upgrades

`data-migration.ts` treats the two kinds of rows differently. **Cache**
(`folders`, `messages`, their bodies and the index) can be rebuilt from the
server; since 2.0 it holds the whole mailbox, so it is kept across
updates, and its shape is versioned on its own: when `CACHE_SCHEMA_VERSION`
changes, `database.ts` drops those tables before anything reads them and
the engine downloads the mail anew. **User data** — every other table, an
extension's and the Segretario's included — exists nowhere else and is
never dropped.

- Before the database opens, a version change (`userData/install-version.json`)
  copies every user table, definition and rows, into a small backup file,
  leaving the cache out.
- After the schema is reconciled, the finalize step empties the attachment
  copies, stamps the new version and drops the backup.
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

## Connections

A connection is one service from one access: a mailbox, or a calendar. The
two are separate — a calendar connection has its own access, and the mail
never depends on it, nor it on the mail. Settings → "Connessioni"
(`features/connections/connections-list.tsx`) shows them by the access that
brought them (`connection-groups.ts`): each account, server or link with its
mail, its calendar or both, how each stands, the calendar an account can
still give (a Google account's), "Ricollega" for a Google or Microsoft
calendar connection with a problem (`canReconnect`: its sign-in again), and
what can be taken away — one service or the whole access. Adding one
(`add-connection.tsx`) is the same there and in the guided setup:

| Choice                  | Mail                                                                    | Calendar                                                                     |
| ----------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Google                  | Gmail, IMAP/SMTP with OAuth (`google-oauth.ts`)                         | Google Calendar, in the same consent or alone                                |
| Microsoft               | Microsoft 365, Outlook.com: IMAP/SMTP with OAuth (`microsoft-oauth.ts`) | Microsoft Graph, in the same consent or alone                                |
| iCloud                  | IMAP/SMTP with an app password                                          | CalDAV at `caldav.icloud.com`, with the same app password                    |
| "Altra posta"           | any mailbox, PEC included, its servers found from the address           | —                                                                            |
| "Calendario CalDAV"     | —                                                                       | any CalDAV server (Fastmail, Nextcloud, a company's), user name and password |
| "Calendario da un link" | —                                                                       | a calendar published at a link (`.ics`, `webcal://`), read only              |

**A mailbox from its address.** `discoverMailSettings` (`mail-discovery.ts`)
finds the servers as Thunderbird does: the providers SIEVER Mail knows by
the address's domain (the Italian ones and the PEC among them); then the
provider's own config file over https (a redirect followed only to https,
`net.request`, since Electron's `net.fetch` refuses `redirect: 'manual'`)
and Thunderbird's database (ISPDB),
looked up while the domain's MX is resolved; failing those, a known
provider recognised by its mail servers (a company's domain hosted there),
the config files of the MX host's own domain, the domain's SRV records
(RFC 6186), and only then a guess, tried on the network. What it finds (`DiscoveredMailSettings`) says
where it came from, whether the mailbox is a PEC, whether it wants an app
password, and — when the provider has its own sign-in (Google, Microsoft,
iCloud) — which one, so the form goes there. The user can read and correct
every server (`mail-servers.ts`: picking SSL/TLS or STARTTLS moves a
standard port to the other's, as Thunderbird does); a real sign-in checks
the result before the account is kept.

**OAuth.** The mailboxes signed in with OAuth get their access tokens from
`MailTokenBroker` (`mail-tokens.ts`): Google's for a Gmail account,
Microsoft's for the others. A Microsoft sign-in (`MicrosoftOAuthService`)
runs MSAL Node's `PublicClientApplication` at the `common` authority, in
the user's browser: one consent for the services turned on — with the mail,
the mailbox's scopes and Graph's through `extraScopesToConsent`; the
calendar alone, Graph's only. What is kept, encrypted, is MSAL's token
cache with the account it is for; Microsoft renews the refresh token at
each use, so every change of the cache is stored again, one renewal at a
time per account. The account's address comes from Graph (`/me`), since a
work account's sign-in name may not be it. The browser's answer is waited
for five minutes at most, and "Indietro" — or leaving the form — cancels
the sign-in (`cancelSignIn`), so a tab closed without answering never
leaves the form waiting. The mailbox is
`outlook.office365.com` over IMAP; mail goes out through
`smtp-mail.outlook.com` for a personal account and `smtp.office365.com` for
a work or school one — or, where the organisation turned SMTP AUTH off
(`5.7.139`), through Graph's `/me/sendMail`, which files its own copy in
Posta inviata.

**Microsoft 365 / Outlook setup.** Signing in with Microsoft needs an app
registered in Microsoft Entra, its client id in `MICROSOFT_OAUTH_CLIENT_ID`;
without it the choice says Microsoft is not active in this build. The
registration is a public client with no secret: accounts in any
organizational directory and personal Microsoft accounts, platform "Mobile
and desktop applications" with the redirect URI `http://localhost` (MSAL
Node takes the answer on a loopback port of its own). Its delegated
permissions are the scopes the code asks for (`microsoft-oauth.ts`):

- `https://outlook.office.com/IMAP.AccessAsUser.All` and
  `https://outlook.office.com/SMTP.Send` — the mailbox;
- `https://graph.microsoft.com/User.Read`, always — the account's address;
- `Mail.Send` and `Mail.ReadWrite`, with the mail — sending through Graph
  (a message with blind copies goes as a draft first, since Graph is not
  documented to send to a Bcc found in the MIME);
- `Calendars.ReadWrite` and `MailboxSettings.Read`, with the calendar — its
  events, and the mailbox's time zone, which all-day events are written in.
  The second is asked for only to write an all-day event: a calendar
  consented without it syncs, edits and answers as before, refuses only
  that write (nothing is written in a guessed zone) and shows "Ricollega";
- `openid`, `profile` and `offline_access`, which MSAL adds to every request.

`.env.example` has notes beside the variable.

Removing a mail connection stops the Segretario's work on it and forgets
what it kept of it alone (see [Segretario](#segretario)); a calendar
connection that came with it stays, on its own (`forgetAccount` and
`mailAccountRemoved`, through `MailServiceOptions.onAccountRemoving`).
Removing a calendar connection forgets its meetings' preparations, its
event proposals and Conoscimi's knowing it (`forgetCalendar`, through
`CalendarServiceOptions.onDisconnected`).

## Mail engine

`src/main/services/mail-engine/`. One `AccountConnection` per account, each
with three IMAP clients, so what the user does never waits behind a sync:

- **primary** — what the user does (read, move, flag, delete, download),
  one command at a time, and IDLE on the folder on screen — the inbox
  when the user is elsewhere (another account, Oggi, the calendar, a view
  of every account) — so its changes arrive as they happen. A command that
  opened another folder (a message read from "Tutti i messaggi") leaves
  IDLE there: two seconds after the queue empties it goes back, and what
  came meanwhile, which raised no event, is synced from the counts the
  folder opens with. It is the only client that idles, listening again a
  second after its last command (`PRIMARY_IDLE_DELAY_MS`);
- **sync** — first downloads, catch-up, previews, the messages read ahead
  and the server side of a search, in a queue ordered by priority (`user`,
  then `active-sync`, then `background`): a search jumps the queue, a
  background folder waits;
- **index** — the `MailIndexer`, which reads the text of every message, the
  newest first, for the full-text index and the Segretario. It fetches only
  the text parts — grouped by the shape of their structure, sixty messages
  a round with a pause between — and never an attachment. On Gmail it reads
  "Tutti i messaggi" and Bozze, where every message is once; elsewhere every
  folder but Spam and the Trash. It rests while the account is offline, and
  with nothing to read closes its connection; it starts again when new mail
  arrives. Its progress shows on the rail's sync dot.

**What changed** is found with one `LIST` that asks every folder's
`STATUS` (`reviewFolders`), every 45 s — ahead of the backlog a start or a
reconnect queues, not behind it — and when the machine wakes or the
network comes back; a folder whose status came without counts is not
known, not unchanged; IDLE pushes the folder it watches, and the folder on
screen is also looked at every 20 s. A folder found unchanged is marked
current, at most every five minutes (`markFolderCurrent`), so the
Segretario can tell a message gone from the server from one in a folder
nobody looked at (see [Views](#views)). A message whose text the index gets,
or one that goes away, wakes the Segretario's engine (`onMailChanged`, at
most every two seconds). A folder is synced
only when its counts, UIDNEXT or (where the server keeps it per folder)
HIGHESTMODSEQ moved — Gmail's modseq is global, so it is not trusted alone
— and before planning a folder already open the connection NOOPs, so an
expunge that arrived meanwhile is seen. On connecting, a folder whose
cached rows differ in number from the server's count is synced too, and
`replaceFolders` leaves a synced folder's stored count as its last sync
set it, so a change left unsynced at quit is still noticed. Unread counts
come from `ESEARCH COUNT` where the server has it.

**A folder is marked synced** — its highest UID, counts and time
(`writeFolderSyncState`) — only once its cache holds exactly its messages,
since what the Segretario closes as deleted rests on it: a batch that
failed leaves it changed for the next review, what a reconciliation finds
missing is fetched before it is marked, and a SEARCH the server refuses
throws instead of reading as an empty folder. A FETCH it refuses is first
checked against a message it should give (`fetchSettingApart`): a server
refusing everything costs two commands and marks nothing; one refusing
some is asked in halves, at most 64 commands a batch, down to the messages
it cannot read. Those — refused, or given without an envelope — are kept
apart (`left_out_messages`, `unreadable-messages.ts`): tried again at each
sync, and after three the folder is marked synced without them, counted
in its total, and they are asked for again once a day; one the server
expunged meanwhile is forgotten.

**A folder's first download** shows its first 100 envelopes at once, with
their previews right behind, then the rest in batches of 1 000 envelopes.
Previews beyond the first 300 are fetched when their rows come into view
(`hydratePreviews`). When the cache and the server disagree on a folder's
count, a reconciliation lines them up both ways, quietly.

**Bodies** load through one queue with an intent: `read` (the message on
screen — a newer read replaces one still waiting), `use` (a reply, a
forward, an attachment, which must not be dropped) and `prefetch` (the
neighbours of the message read, after it has been on screen 300 ms, on the
sync client). A message over 512 KB is fetched without its attachments: its
skeleton is rebuilt from the `BODYSTRUCTURE` and the text parts, and an
attachment comes later from its own part (`message-skeleton.ts`). The 25
newest messages of the inbox are downloaded ahead in the background.

**Moves** keep the rows: a server with UIDPLUS answers with the new UIDs
(`COPYUID`) and the rows are relocated, so a message moved is in its new
folder at once. Actions on a selection send one command per folder, in
chunks of 500 UIDs. The UIDs that leave a folder are remembered for the
session: a sync that read one off the server just before it went does not
put it back in the list (a UID is never given twice under one UIDVALIDITY).
Without UIDPLUS a plain EXPUNGE would also take the messages another
program flagged `\Deleted` and has yet to expunge (`server-moves.ts`): a
move by copy-then-delete is refused while any such message waits in the
folder, and a delete for good leaves its own messages flagged for the
folder's next expunge, saying so — as a draft replaced there may stay.
The messages the app left flagged so are its own across restarts
(`left_out_messages`, reason `deleted`): a sync does not bring them back,
and they never count as another program's.

**Who a message is** (`message-identity.ts`). `message_key` is the
server's id for it (Gmail's X-GM-MSGID, or OBJECTID's EMAILID), else its
Message-ID, else a digest. Copies sharing a Message-ID are told apart by
what every copy says alike — the Date header, the sender, the subject
(`contentDigest`), never size or arrival time, which differ between the
Sent copy and the one received — so the copies of one email share its
key, and a different message reusing the Message-ID, as ticketing systems
and scanners write, gets `m:<id>#<digest>`. Who holds each such key is
remembered by that digest (`message_id_keys`, `message-id-keys.ts`), also
after every row of the message is gone, until every folder has synced
since and no table of the Segretario names it: a message stored again,
moved by another client or archived into a folder never synced, gets its
key back whatever order its copies arrive in. A row keeps the key and
conversation it was first stored with (`settleMessageIdentities`), so
nothing that hangs off them is orphaned, and a reply that names no
References, on a server that gives no thread, joins the conversation of
the message it answers when the cache holds it.

**Bodies are kept once per message** (`message_bodies`, by `message_key`):
a message in three Gmail labels is downloaded and indexed once, and a body
never goes back to a lower level.

**Search** runs locally on the folded `search_*` columns and on the
full-text index (`full-text-query.ts` turns the search grammar into an
FTS5 expression: groups AND'ed, alternatives OR'ed, each word matched as
the start of a word). The index keeps a code whole — "Prat2463" is one
word — so a number of three digits or more searched on its own also
matches the words that write it after letters, looked up in the index's
vocabulary (`message_fts_vocab`, the most used first, a hash with the
number in its middle left out). For the messages the index has not read yet, it asks
the server too — `IMAP SEARCH`, one per group of the query, intersected
(`server-search.ts`); the matches it finds join the list. A newer search
replaces one still waiting.

The connection has a state machine (`connecting`, `connected`,
`reconnecting`, `offline`, `error`) that drives the sync badge in the
header. It reconnects with a backoff (2 s up to 60 s), notices the network
coming back (`net.isOnline`) and the machine waking or unlocking
(`powerMonitor`) and checks the link with a NOOP rather than trusting a
socket that may be dead. When the computer goes to sleep every account
closes its links and none reconnects until it wakes, then at once
(`suspend`, `resume`, `services/system-sleep.ts`). "Sincronizzato" is only
shown when it is true.

What the user asks for is reported truthfully:

- imapflow reports a refused MOVE, STORE or EXPUNGE as `false`, not an
  error; each result is checked, and the local copy only changes when the
  server's did. A server without MOVE gets copy-then-delete, step by step.
  Answers the server volunteers about other messages are taken as their
  new flags, never as the messages asked for.
- Without a connection, an operation waits up to 20 s for a reconnect and
  then fails with the reason, so the interface puts back what it had
  already shown. An account whose login was refused fails at once.
- Sending goes over SMTP — through Graph for a Microsoft account whose
  organisation turned SMTP off (see [Connections](#connections)); for IMAP
  accounts a copy is filed in the Sent folder afterwards, in the background
  (Gmail and Graph file their own). A sent
  message is never reported as failed because that copy is late. The SMTP
  socket is opened by Node, trying the server's IPv6 and IPv4 addresses in
  turn (Happy Eyeballs), as imapflow's are: nodemailer alone picks one at
  random, and an IPv6 address on a network without IPv6 held a message for
  the whole connection timeout.
- "Elimina" moves a message to the Trash; in the Trash, or on an account
  without one, it deletes for good, after asking.
- "Archivia" — the toolbar, a notification, the Segretario, an extension, a
  drop on Archivio — goes through `AccountConnection.archive`, planned by
  what each message is rather than the row picked (`archive-plan.ts`). On
  Gmail it leaves the inbox and its labels stay; one in the Trash or Spam
  goes back through the inbox to "Tutti i messaggi"; one in neither is
  archived already. Elsewhere it moves to the archive folder (`\Archive`,
  or an "Archivio" created the first time, as Thunderbird and Apple Mail
  do) unless it is there or in a folder inside it. A message archived
  already is no error; one the cache no longer holds is reported failed.
  On Gmail, archived from a label, Posta inviata or "Tutti i messaggi", its
  row stays in the list: in the account's own folders it is never taken
  out (`archiveSelection` in `App.tsx`); seen from "Tutti gli account" it
  comes back as soon as the server says it stays (`kept`, `keptRefs`).
- An IMAP account's servers are reached over SSL/TLS or STARTTLS, as chosen
  when it is added; STARTTLS is required, never opportunistic.

### Notifications

`notifications.ts` announces unread messages arriving in Posta in arrivo
of the accounts not muted: one message with its sender, subject and
preview (the subject opens the body where there is no subtitle, on Windows
and Linux) and the buttons "Segna come letta" and "Archivia"; several
arriving together as one alert naming who they are from. Alerts are grouped
by account and withdrawn once their messages are read, moved or deleted,
here or elsewhere. A folder's first download never alerts. What became of
the last alert — shown, or refused by the system, with the reason — is
kept for Settings → Notifiche. `app-badge.ts` puts the unread count of
every inbox on the icon: the Dock badge on macOS, the launcher on Linux,
and on Windows an overlay the renderer draws (`lib/taskbar-badge.ts`).

### Network shares

After a restart macOS leaves a share mounted under `/Volumes` unmounted
until the Finder opens it, and a path inside it does not exist.
`network-volumes.ts` remembers the URL each share was mounted from, as
`mount` reports it, and mounts it again — `mount volume` from Standard
Additions, with the keychain's credentials and no Finder window — when a
path under it is needed (`ensurePathReachable`); a stale folder in its
place is told apart from a mount. On Windows a mapped drive left
"Unavailable" is reconnected with `New-SmbMapping`, as Microsoft documents.
Attaching, opening a file and the extension's archive all go through it;
the Segretario's tools only in a run the user watches, or Conoscimi, where
someone can answer if the system asks for the share's password
(`reachShare` in `ai/tools/files.ts`).

### What counts as an attachment

Real messages carry signature logos, banners and every picture of the
quoted chain as `cid:` parts. `message-parts.ts` holds the one rule: a part
is body content when the HTML references its Content-ID, when it sits in the
`multipart/related` container, or when it is inline with a Content-ID.
Everything else is an attachment. The list's paperclip, the reader and the
extension's archive all use the same rule.

## Interface

### State

`App.tsx` owns the selected account and folder, the loaded rows, the
selection, the persisted `UiPreferences` and the dialogs. The main process
pushes changes through events (messages, folders, the "Tutti gli account"
summaries, connection states, notification status); the renderer never
polls. Changes arriving in bursts are applied as one list refresh every
300 ms at most, and a row that only changed is patched in place.

The selection (`lib/message-selection.ts`) keeps the **selected rows** and
the **cursor** apart, following Finder/Explorer: click replaces, Ctrl/⌘
toggles, Shift extends, ⌘/Ctrl+A selects the rows loaded, Esc narrows to
the cursor. When every row loaded is selected and the view holds more, the
selection panel offers "Seleziona tutti i N": the rest is loaded, up to the
20 000 one action takes (`MAX_MESSAGES_PER_ACTION`), and selected. Rows can
be dragged onto a folder of the sidebar.

A message is marked read the way Outlook does it by default (Apple Mail,
Thunderbird and Gmail agree where it matters): shown in the reading pane it
stays as it is while it is being read, and is marked read once the pane
moves on — to another message, to several, to another folder, account or
search. Opening it (Invio, a double click, the expand button, the next
message in expanded reading) marks it at once. A state the user sets by
hand while it is shown stays; a message whose body never showed, or that
left the list, is not touched (`followShownMessage` in `App.tsx`).

Archiving, deleting and moving take the rows out of the list before the
server answers, and the reading pane moves on to the next message that is
staying. What the server refuses comes back, and so does what it did but
left where it was shown (`MessagesActionResult.kept`); once every removal started
together has settled, so does the selection they had — unless the user has
picked something else meanwhile. A list loaded again in which nothing
selected is left selects the message that came after it
(`reconcileWithNeighbour`), as working through a list one by one expects.

### Layouts

The window is a row of panes laid edge to edge, a hairline between each:
the rail (`features/workspace/app-rail.tsx` — the apps, the Segretario's
panel, the connection, Settings), then the app. The rail's apps (`App.tsx`,
`apps/`, from `WORKSPACE_APPS`) come in three groups, a thin line between
them: the desk, Oggi (`apps/today/`, there only with the AI on); the
sources, Posta (`apps/mail/`), the Calendario (`apps/calendar/`, see
[Calendar](#calendar)) and File; the derived apps, Contatti and Progetti.
File, Contatti and Progetti open on a page saying what they will be
(`apps/app-placeholder.tsx`, "In arrivo"). A connection of any family is
enough to work: with no mailbox, Posta says so and offers to connect one,
and the workspace opens on Oggi, else on the first source with something
connected. Each app takes the place of the mail's columns; the rail and the
Segretario's panel stay. The shell (`App.tsx`) keeps the frame, the rail,
the panel, Settings, the setup and the way from anywhere to a message, an
event or a project; the Posta's state and handlers live in
`apps/mail/use-mail-app.ts`, which the shell calls so the mail keeps its
place while another app is in front, and its keys answer only while it is
shown. Posta is the
sidebar ("Scrivi", the account, the folders), then the message list and
the reading pane. Each pane's first band is 52 px tall and is the
window's title bar: dragged like one, with the
macOS lights over the rail and the sidebar and, on Windows, the app's own
window buttons in the top right corner, which the pane there keeps clear
of (`--titlebar-lights`, `--titlebar-controls`). The list's header holds
its title, count, order and selection controls, the search and the filter;
the reading pane's holds what can be done to what it shows — reply and
forward, the extension's actions, archive, move, mark, flag, delete — for
one message, or in words for a selection.

Two arrangements share every component (`features/workspace/workspace-layout.tsx`):
_apple_ — folders, list and reader side by side — and _outlook_ — a dense
sortable table above the reader. Both list shells implement
`MessageListViewProps`. Expanding the reader turns either into the same
narrow list beside a full-height message. Sizes are `clamp()`s, never
breakpoints, so any window size works.

The divider between list and reader can be dragged in both layouts
(`components/ui/resizable-split.tsx`, the WAI-ARIA window splitter): within
minimums that keep both panes usable, with a detent on the default — the
grip lengthens and turns to the accent colour there, and letting go hands
the size back to the `clamp()`. Arrow keys (Shift for bigger steps), Home,
End, Enter and a double click work too. A dragged size is never stored: a
new layout, expanded reading or the next launch start from the default.

### Sidebar and several accounts

The sidebar has two sections for the mail — with the AI on, the
Segretario's views and searches and the projects come above them (see
[Segretario](#segretario)). **Tutti gli account** gathers, for the
accounts chosen in Settings → Preferenze, each folder every account has —
Posta in arrivo, Posta inviata, Bozze, Archivio, Spam, Cestino — found by
role whatever the server calls it (`shared/folders.ts`; on Gmail
"Tutti i messaggi" is the archive). Below it, **the account chosen in the
header** shows its folders as a tree, the role folders first under their
Italian names. Badges count the unread messages, the drafts in Bozze, and
nothing in Posta inviata, Archivio and Cestino, where unread says
nothing.

Rows of "Tutti gli account" say which account each message came to, and
every action works on the message's own account: a reply or forward starts
from it (the composer's "Da" row says so, and moving it elsewhere is
confirmed first), "Sposta" lists its folders, a selection spanning
accounts is explained rather than moved.

"Sposta" (`features/mail/folder-picker.tsx`) finds a folder as it is
typed, case and accents aside, lists the account's recent destinations
first, then the tree, and offers to create the folder that was typed. A
folder has a menu — open, mark all read, new subfolder, rename — and
⌘/Ctrl+1 and ⌘/Ctrl+⇧+G reach the inbox and any folder from the keyboard.

Questions use one component, `components/ui/confirm-dialog.tsx`
(`useConfirmDialog()`), and a name is asked with `prompt-dialog.tsx`.

### Lists, sorting and search

Sorting (date, sender, subject, size) and grouping (Automatico, Mittente,
Nessuno) happen in the database; `lib/message-sections.ts` only slices the
ordered rows into sections. The list is endless and virtualised
(`features/mail/virtual-message-rows.tsx`): the next 100 rows load before
the end is reached, the heading of the section in view stays pinned, and
after a change of order the selected message is kept in view, with its
section around it when it fits.

A sender section is one sender as the reader sees them. The spellings one
address uses for the same name share a label (`isSameSenderName` in
`shared/sender.ts`: the identifying words in any order, initials, the
desk words a company adds — "A.beltrami-SIEVER" and "A. Beltrami -
SIEVER", "HYPE" and "Team HYPE"), while the different people a shared
address relays keep their own; a message with no name takes its address's
label, and labels that differ only in dress share a sort key. A database
kept across a change of these rules is re-filed once at start
(`SORT_FILING_VERSION`).

A subject sorts by what it is about (`shared/subject.ts`): reply and
forward prefixes in any language and gateway tags are stripped, and the
quotes or symbols it opens with are passed over; messages without a
subject come first.

The search grammar in `shared/search.ts` is parsed once and used by both
sides — the main process builds the `WHERE`, the renderer highlights the
same terms. Words match sender, recipients, subject and body, without case
or accents (`foldSearchText`); `da:`, `a:`, `oggetto:` narrow a term to one
field, quotes keep a phrase, `OR` joins alternatives. Bodies are searched
in the full-text index; those it has not read yet, on the server (see
[Mail engine](#mail-engine)). The list says where it looked: the folder,
how many messages, whether the server's full-text search is still going
and how many messages have not arrived yet.

### Commands, shortcuts and menus

Every command — the host's and an extension's — is declared once in
`shared/commands.ts` with its default chord. Settings → Scorciatoie lists
them and lets the user change a chord (overrides are stored, conflicts and
reserved chords refused); the macOS menu bar, the tooltips and the native
menus show the chord in effect. Chords pressed inside a message frame or
the editor are forwarded to the app.

Right clicks open native menus everywhere: text, links, pictures and the
editor's spelling come from the main process (`context-menu.ts`); rows,
folders, attachments, people and recipients build theirs in the renderer
and show them through `showContextMenu`.

### Theme

`styles/globals.css` defines every colour as a token (HSL triplets), with a
dark set and a light one under `prefers-color-scheme: light`. The choice in
Settings (Sistema, Chiaro, Scuro) becomes Electron's `themeSource`, which is
what that media query reports. Components only use the tokens.

The palette is the logo's: a compass star over an envelope, electric blue
and yellow, on cool neutrals. The blue (`--primary`, `--primary-text`) is
the app's ink: actions, the selection's tint, unread mail (`--unread`),
sending (`--seal`, the brightest key). The yellow is the star, the
Segretario's alone (`--ai-star` as a mark, `--ai` for its labels — a deep
amber on a light page — and `--ai-muted` for its running text); its mark
everywhere is the logo's star (`CompassStar`), and the logo itself heads
the rail. Red (`--urgent`) is kept for what is late or urgent. There are
three surfaces, each a step lighter: the desk (rail and sidebar,
`--background`), the panes on it (the list, the Segretario, Oggi, the
Calendario, `.paper`) and the page being read (the message, `.page`), all with a
faint grain painted once as a background image (`--paper-grain`). Buttons
have a body — ink, seal and raised keys (`button-ink`, `button-seal`,
`button-raised` utilities), lit from above and giving a little when
pressed; shortcuts show as keycaps. Settings group their rows under a
heading and a hairline (`settings-group`), never a box inside the dialog's. What floats is a `sheet` / `sheet-high`: one surface, a
hairline and a shadow. Message bodies stay on a white page in both themes,
as they were written.

The interface is set in Mona Sans (OFL), bundled with the app as a variable
font (`@fontsource-variable/mona-sans`, weights 200–900, widths 75–125 %),
so it looks the same on every machine: `--font-sans` for everything,
`--font-display` with `.display-title` — the same family at 110 % width —
for titles. Newsreader (OFL, `@fontsource-variable/newsreader`) is
`--font-serif`, the Segretario's hand (`.voice`): what it writes reads as
writing.

## Mail content

### Reading

Bodies are sanitised with DOMPurify and shown in a sandboxed `srcdoc`
iframe whose height follows its content (`lib/mail-html.ts`). The page is a
plain one, like any client's, so a message looks as it was sent. Ctrl/⌘ +
wheel, a pinch or ⌘/Ctrl +/−/0 zoom the body (50–200 %), remembered across
messages, as is whether "Dettagli" shows every recipient. While a large
body downloads, the header and preview show at once; a body that failed
to load says so, with "Riprova".

### Writing

The composer (`features/mail/mail-composer.tsx`) runs Squire in an
iframe on the same page as the reader, so what is written looks as it will
arrive. A body starts with lines to write on, the signature in a
`gmail_signature` block and, for a reply or forward, the quote after a blank
line (`composer-body.ts`). Changing the sending account swaps that block.
The lines the user writes carry the default face and line height on the
block itself; a block the editor makes later — a list, a heading, a paste —
gets them in the live document, so the caret never moves.

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

Recipients are chips (`features/mail/recipient-field.tsx`): a comma, a
semicolon, Invio, a space after a whole address or leaving the field makes
what was typed a chip, and a pasted list — Outlook's, Gmail's, a column of
a spreadsheet — one chip per person (`parseRecipients` in
`shared/email-address.ts`). A chip shows the contact's name, its address
in the tooltip, and turns red when no mail can reach it: one validator
(`isValidEmailAddress`), shared with the main process, accepts addresses
in any script and catches a top-level domain one letter short. Chips move
between A, Cc and Ccn by dragging or from their menu, are edited with a
double click or Invio and removed with ⌫. The message goes out addressed
by name. A message without a subject is confirmed before sending; a reply
or forward of one is "Re:" or "Fwd:" alone, the prefix added once
(`replySubject`, `forwardSubject` in `shared/subject.ts`).

The suggestions come from `contacts`: everyone stored mail names (drafts
and spam aside), with the name a person gives themselves, and the mail
written to each — counted when sent from here and, idempotently, from the
sent folders of every device. `contact-ranking.ts` matches the start of a
name or of any part of an address, puts the people written to first, and
leaves out a mistyped copy of an address that has written to the user (the
same mailbox at a domain one letter off). A suggestion can be taken out
with its ×; writing to the address again brings it back. A database from an
earlier version has its contacts learned again once, when the table gains
these columns.

### Drafts

Whatever is being written is a draft from the first change (`drafts.ts`):
the composer hands it to the main process 0.7 s after the last keystroke,
which keeps it in `drafts` — a crash, a quit or a lost connection costs
nothing — and 5 s later files it in the account's Bozze (created when the
account has none), with `\Draft \Seen`, so Gmail, Outlook and the phone
have it. Each server save appends the new version and deletes the one it
replaces for good — on Gmail by moving it to the Trash and expunging it
there, which is how Gmail deletes. Every version has its own Message-ID
(Gmail drops a message whose id it has seen) and the draft's id in
`X-Siever-Draft-Id`, which is how a draft opened from Bozze is known again.
A save the server refused is tried again every 30 s; quitting files what
is waiting for up to 4 s, and the next launch files the rest. The footer
says where the draft is: saving, "Salvata in Bozze alle 18:22", or why the
server has not got it yet.

A composer opened and left untouched leaves nothing behind; a body changes
only when what it reads as changes, not when the editor touches its DOM.

In Bozze — of this app or any other client — a double click, Invio or
"Continua a scrivere" (in place of Rispondi and Inoltra) opens the draft:
the copy kept here if it is newer or open, otherwise the server's,
parsed with its recipients, Ccn, thread, files (written to
`userData/drafts/<id>/`) and inline pictures. A draft whose copy leaves
Bozze — moved, archived, thrown away, by the user or the Segretario — goes
with it (`DraftService.hold`): it stops being filed while the copy leaves,
what is newer here is filed first so the copy that leaves is the draft as
it is (a draft the server cannot take as it is stays, and says why), and
only once the copy did leave is what is kept of it let go — a composer
holding it closes (status `gone`) and no later save puts it back.

Several messages are written at once. One is in front, modal; the others
wait in the dock, bars in the bottom right corner, as Gmail keeps them,
each with its subject and who it goes to, those that do not fit folded
into "+N". A composer put aside (Esc, a click beside it, "–") is never
taken down: coming back finds the caret, the undo history and a
half-typed recipient where they were. × closes it and keeps the draft in
Bozze ("Apri" brings it back); the bin throws it away — its copy goes to
the Trash — with "Annulla" for 10 s. Sending deletes the draft once the
message has gone; if it fails, the draft waits in Bozze as it was sent.
The drafts left open come back to the dock at the next launch. While a
message is in front, notices come in at the top, off its Invia; otherwise
they rise above the dock.

### Attachments

Opening one writes a copy to `userData/attachments/<account>/<attachment>`
and hands it to the default application; executables are never launched
from a click, and on Windows the copy carries the mark of the web. "Salva
con nome" and "Salva tutti" write where the user chooses. A name written to
disk goes through `sanitizePathSegment` (`file-utils.ts`): what Windows
refuses goes, and a device name gets an underscore (`aux.pdf` is
`aux_.pdf`). The copies are measured and emptied in Settings → Dati and
dropped on every upgrade.

In the composer an attachment opens with a click — the user's own file, or
the copy a forward carries — so it can be checked or changed before it
goes; its menu shows it in the Finder or Esplora file.

A forward carries the original's attachments, as every client does: the
composer shows them at once and the main process copies them from one
download of the message (`copyMessageAttachments`), into copies of their
own that no application the reader opened can change. Sending waits until
every copy is there; one that failed says so on its chip, with "Riprova".
A reply leaves them out, and "Allega" offers them under "Dal messaggio
originale" — as it offers any the user removed from a forward — above the
files recently used on the computer (Windows Recent, macOS Spotlight's
last-used date, Linux `recently-used.xbel`) and in SIEVER Mail, each with
its folder. What the system remembers is kept between lookups and looked
up again in the background, so a slow index never empties the list; the
copies programs keep for themselves (attachments opened from a message,
Temp, AppData, Library) are left out; files on a share a restart left
unmounted stay. The list is fetched again when the window comes back to
the front and never reorders while the menu is open. Files can also be
dropped onto the composer. A file that is gone by the time the message is
sent is named in the error, not half-uploaded.

## Segretario

SIEVER Mail's agent (`src/main/ai/`). There is one Segretario — one
identity (`prompts/segretario.md`), one memory, one set of tools, one
record of the user's work — and many runs of it: the reading of a
conversation, the day, a project's "Il punto", a look at the calendar,
getting to know the user, the requests in its panel (`features/segretario/`,
⌘J), the help in the composer and in the search field. Each run is an
activity whose first message says its task; what it does comes back
through its tools. `SegretarioService` is the façade the IPC calls
(`register-segretario-ipc.ts`), created by the `Workspace` with its ports
to the mail and the calendars; underneath are the runner, the engine that
wakes it, the registry and the notebook.

**The key is the user's.** There is no server of ours: the Segretario calls
[OpenRouter](https://openrouter.ai/) with the user's own key (`sk-or-…`),
given in the guided setup or Settings → Segretario, checked there
(`/api/v1/key` and `/api/v1/credits`: unknown, without credit, at its limit)
and kept encrypted with `safeStorage` like the accounts' passwords. It is
checked again every 20 minutes while the app runs; a key refused or out of
credit pauses the engine until the user acts. The panel then says why and
the one way on — a key refused: Settings › Segretario; the credit gone:
OpenRouter's page to recharge it — and the rail's star shows a dot while
the key or the credit is the problem (`SetupNotice` in
`segretario-panel.tsx`). Without a key the AI is off — the page, the panel
and the app menu all go by the switch up and a key given — and the switch
leads to the guided setup. What every call cost
(`usage.cost`) is recorded by task — a generation that ended before saying
its bill (stopped, cut by the network, over its time) is billed from
OpenRouter's record of it, asked for until it is there (`lateBill` in
`openrouter.ts`) — and Settings shows today's and this month's spending
and the last thirty days by function.

**The model is not a setting.** Requests go to the alias of the newest
DeepSeek Flash (`~deepseek/deepseek-flash-latest`), so a new checkpoint is
used as soon as it ships, with a routing policy rather than a named
provider: only endpoints with zero data retention that do not train on the
data, the cheapest of those fast enough (`PROVIDER_POLICY` in
`openrouter.ts`). A `session_id` per activity keeps it on one provider, so
the prompt cache holds. Answers stream; rate limits and outages are retried
before the first token, and every error reaches the user in their words.

### One switch, and the guided setup

"Funzioni AI" (Settings → Segretario, `SegretarioPreferences.enabled`) is
off until the user turns it on in the guided setup. Off, every run stops,
nothing is read or prepared and nothing of the Segretario shows — Oggi
leaves the rail, the panel and "Vista › Segretario" go (`updateAppMenuAi`)
— while what it learnt is kept; on again, the engine catches up with what
came meanwhile. "Elimina tutti i dati" turns it off too.

The guided setup (`features/onboarding/onboarding-wizard.tsx`) is one
full-screen flow for five cases (`OnboardingCase`): the first launch, a
connection added, the AI turned on for the first time, turned on again,
and Conoscimi done again. Its steps run in order — `connessioni` (one of
any family is enough: a mailbox, a calendar), `segretario` (the key, and
the switch on), `preparazione` (every mailbox synced and, with the AI, its
last thirty days indexed; every calendar through its first sync),
`conoscimi`, `lettura`, `entra` — and each case takes the ones it needs
(`CASE_STEPS`, `applies`): the key only while the AI is off, Conoscimi only
with it on, the reading with it on and mail to read. The state is kept in `ai_meta` (`onboarding`),
so a quit brings the user back to the same step. Conoscimi is started by
the user and watched as it works; the reading of the last thirty days runs
eight at a time, with its progress, an estimate and what failed — nothing
passes for read, and the user enters anyway. A connection that cannot
sync does not hold the preparation back: it says which, and "Continua
senza" goes on. "Rifai Conoscimi" cancelled goes back to the app with the
memory as it was. The engine follows the setup: until its Conoscimi is
done, the setup's connections are not read, so the reading starts
informed. Only the setup that turns the AI on (`setupTurnsAiOn`: its own
cases, or a connection added with the AI off and turned on along the way,
`OnboardingState.turnsAiOn`) holds every connection, keeps the day, the
projects and the memory waiting, and has the day written at its end, even
before dawn. A connection added with the AI on holds only its accounts,
and its reading step counts only them (`readingStatus(accountIds)`). The
switch in Settings and "Rifai Conoscimi" lead there — "Rifai Conoscimi"
with the AI off to the setup that turns it on.

### Runs

Every run turns the same loop (`agent/runner.ts`): the model writes, calls
its tools, reads what they found, and goes on until the work is done. The
conversation is rebuilt at every step from the run's log (`ai_events`,
`agent/conversation.ts`) — the context, the user's words, the model's turns
and tool calls, the results, confirmations, compactions, the changes made.
At start, a conversation in the panel that a quit cut short says so and
waits for the user; work done alone starts over from the queue. What the harness
keeps for itself is what cannot be left to the model:

- the user's confirmation, on the run's card, before anything reaches
  others — only a conversation in the panel can ask for it
  (`RunContext.watched`, see [What a run may do](#what-a-run-may-do));
- the size of what the model reads: past 60 000 prompt tokens old tool
  results are cleared, the eight newest kept — at once the first time, then
  twelve at a time, since each clearing changes the prefix the provider
  caches; past 140 000 the older part of the run is summarised
  (`infrastruttura/compattazione.md`), and a run compacted in the middle
  goes on from its context and the summary; 80 steps at most;
- a tool call that failed is not made again as it was, remembered by its
  cause: one that failed on a short name the run had not been given
  (`UnknownHandle`) may be made again once a tool gives new names, one
  refused for a conflict at once (see [The registry](#the-registry));
  invalid JSON and an unknown tool count as failures, and a step cut off by
  its length says so instead of "invalid JSON";
- how long work alone may take: a background run is stopped after 15
  minutes (Conoscimi 60, `al_passo` and `riflessione` 30) and that counts
  as a failure — only a call that never returns gets there; the user's own
  runs have no limit. A run stopped before it began (the AI switched off,
  the computer asleep) does not run;
- what the task must leave (`missing`): a run that stops short is told what
  is missing, twice at most, then fails.

What the model reads is its own choice: the harness checks a tool call,
never the text the model writes, and decides only the little a run begins
with. A run begins (`tasks/start-run.ts`) with its task
(`prompts/compiti/`), a map (`contesto.md`, `tasks/context.ts`: the date
and time zone, the connections — mailboxes with their signatures,
calendars — and the memory's index), then what changed: the messages that
came, named for the run to read; the project that moved; the calendar's
changes; the user's corrections; the request and what the user is looking
at. Everything else — the conversation and the work already on it, the
memory's notes, the calendar, what is open with a person or in a project —
the run looks up with its tools, as much as the case needs; the prompts
suggest where to look, the tools return dates with their weekday.

The system prompt is the identity with what the extension adds
(`assistant.instructions()`), and every run gets the same tools in the
same order (`tools/index.ts`), so the prefix the provider caches is shared
by all of them. The model names what it saw by short
handles — `m4` a message, `f2` a file or an attachment, `b1` a draft, `p3`
a project, `e2` an event (`agent/handles.ts`) — which the panel turns into
links (`shared/segretario-links.ts`): `[testo](mail:m4)`, with
`risposta:` and `sollecito:` naming the message a reply is for. A message
link carries its key and opens where the message is now (`replySource`).
An open thing is linked by its number, `[testo](impegno:12)`, which holds
everywhere and opens the message it comes from (`commitmentSource`).

Words that stay — the letter of Oggi (`ai_briefings.links_json`), a
meeting's preparation (`ai_event_preps.links_json`), "Il punto"
(`ai_projects.state_links_json`) — keep the links of the short names they
use (`linksIn` in `agent/entries.ts`), drawn by `LinkedWords` with the one
opener `SegretarioLinkProvider` gives (`features/segretario/segretario-text.tsx`).
A later run reads them without their links (`unlinked`): the names of an
earlier run are not its own.

| Task          | Started by                                                                                                                                                                                                                   | Kind                | Leaves                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------- |
| `lettura`     | the engine: messages not read yet                                                                                                                                                                                            | background, diary   | a note on each message, and what the conversation needs: commitments, projects, a reply, an event |
| `giornata`    | the engine: the morning's, once a day from 6:00; again when the letter is behind by three hours, by one when Oggi is looked at; at once when the setup that turned the AI on ends without today's letter; the user from Oggi | background, diary   | the letter at the top of Oggi, preparations for meetings                                          |
| `punto`       | the engine: a project behind on "Il punto"; the user opening it                                                                                                                                                              | background, diary   | "Il punto" written again                                                                          |
| `calendario`  | the engine: the calendar changed elsewhere                                                                                                                                                                                   | background, diary   | the commitments and the user's events in line with the calendar                                   |
| `conoscimi`   | the user, in the setup or from "Rifai Conoscimi"                                                                                                                                                                             | background, panel   | the memory: the user, the connections, people, projects, the style                                |
| `riflessione` | the engine: lessons waiting, at most every six hours                                                                                                                                                                         | background, diary   | rules in the memory                                                                               |
| `al_passo`    | the engine: some connection known, the reading done, about once a day                                                                                                                                                        | background, diary   | the memory kept true                                                                              |
| `richiesta`   | the user, in the panel                                                                                                                                                                                                       | interactive, panel  | what was asked                                                                                    |
| `scrittura`   | the user, in the composer                                                                                                                                                                                                    | interactive, inline | the text for the editor                                                                           |
| `revisione`   | Invia                                                                                                                                                                                                                        | interactive, inline | what to fix before sending                                                                        |
| `ricerca`     | ⌘↵ in a search field                                                                                                                                                                                                         | interactive, inline | the search to show                                                                                |

### The engine

The engine (`engine/`) wakes the Segretario for the work it does alone. It
is not a second mind: what a message means the Segretario decides; when
and in what order it is read, and that nothing is lost or done twice, the
engine does. Every 20 seconds, and at once when mail is indexed or goes away, when the key starts working,
the switch changes or the setup moves on, the planner (`engine.ts`) — with
the AI on and a key — asks the state what work there is. Each question is
idempotent: asked again, it queues nothing twice. In order:

- what was put off until today opens again, and what came from messages
  deleted for good is settled (see [Views](#views));
- the conversations with messages not read yet, in every folder but the
  Trash, Spam and Bozze, thirty days back (`READING_HORIZON_DAYS`), at most
  the 300 newest a planning, found by one window-function query per account
  (`mail-engine/unnoted-conversations.ts`): those with mail of the last two
  days as new mail, after 15 seconds for the rest of its burst, the others
  as backlog. A reply prepared before the new messages is marked to be
  looked at again; a conversation whose reading failed rests a day, unless
  something newer came;
- the day, as in the table above: the morning's run is marked done in
  `ai_meta` (`morning_done`) only when it began after 6:00, so a day
  written before dawn at the end of a setup leaves the morning to come.
  The letter is behind when an open thing changed since it was written,
  other than by the day's own run (`CommitmentStore.changedSince`), and it
  is older than three hours — one, when Oggi is looked at
  (`LETTER_LOOKED_AT_STALE_MS` in `segretario-service.ts`);
- the calendar's changes, looked at two minutes after the first of them
  (what comes meanwhile joins the same look), those from yesterday to two
  months ahead (the first time, the past is passed over); the mark
  (`calendar_seen`) moves only once a look is done, so one that fails leaves
  them to the next, and one that failed for good rests a day unless the
  calendar changed after it;
- "Il punto" of the projects behind on it: at once for one that has none,
  else once a day from the morning, the latest moved first, ten at most —
  a project the user opens behind has it written then;
- the reflection, and keeping up — once some connection is known through
  Conoscimi — when a dozen notes on messages that say something came since
  and twenty hours passed.

What the user asks for — the day looked at again, "Il punto" of a project
opened — starts at once, a waiting unit moved to now
(`enqueue({ now: true })`), and never twice: not while the same work
already waits or runs (`inProgress`).

The queue (`work-queue.ts`, `ai_work`) is durable. One unit waits per scope
key (`lettura:<account>:<thread>`, `giornata:<day>`, `punto:<project>`…, a
partial unique index): what comes for a scope while it waits joins it — the
scopes merged, the more urgent priority kept, a burst's start moved on. A
failed unit is tried again after a minute, then five, three attempts in
all; a request that hung (`timeout`) counts against it, the network or the
provider not answering does not (the scheduler waits, below). Work
failed for good is not queued again for its scope for a day
(`FAILED_REST_MS`) — a failure repeated at every planning would be paid
each time — and is then forgotten with the work done. Settings shows what
failed, with "Riprova": the latest failure of each scope is tried again,
unless work for it already waits. When a unit for the same scope is
already waiting, a failing one joins it, with its attempts. The AI switched
off stops what runs and lets go of what waits (`switchedOff`): on again,
the planning finds from the state what is still to do; nothing queued
starts while it is off. After a quit, what was
running waits again (`recover`), unless a unit for its scope is already
waiting. While the computer sleeps nothing starts — the few seconds a Mac
wakes for now and then (Power Nap) are no time for a run — and what was
running waits again, uncounted, until it wakes (`services/system-sleep.ts`:
`suspend`, `resume`, the screen unlocked, someone using the computer).
Removing an account stops its running units before what they wrote is
taken away (`stopWhere`), as "Dimentica tutto" stops the memory's work. A
reflection a quit cut short gives its lessons back to the next one at
startup.

The scheduler (`scheduler.ts`) runs four units at once — eight while the
setup's reading is prepared — the most urgent first (new mail, the day,
the calendar, the projects, then the memory and the backlog), always
keeping one place for what is not backlog, so new mail never waits behind
a month being read. Two units holding a lock key never run together: a
reading holds its conversation, its projects and its outside sender, so
what belongs together is read in turn; "Il punto" holds its project, and
the day, the calendar and the memory's work one key each. Within a lane
the oldest conversation goes first (`TaskExecutor.order`,
`ReadingScope.newest`): a unit gives way only to an earlier one at least
as urgent, so new mail still never waits for the backlog. It looks at up
to 120 ready units a page at a time, so a long backlog of units waiting on
a lock never hides one that may start. Between, it sleeps until the next
unit's time comes (a minute at most); one ready but held starts when what
holds it ends, which wakes it.

A key refused, a credit run out or no key pauses everything until the
user acts; `EngineState.paused` says why — what a run met, the key as last
checked (`blocked()` in `segretario-service.ts`), or the wait for the
network — and Oggi, the setup and Settings show it. When the network or
the provider does not answer (`network`, `unavailable`, `rate-limited`),
the whole engine waits — 30 s, 1 min, 2 min, then 5 min between tries —
with one unit trying at a time; it tries at once when the computer wakes
and goes back to full pace at the first success. A request the provider
blocks for what it carries (`blocked`) is that unit's failure only.

### The registry

The registry (`registry/`) is the state of the user's work as the
Segretario keeps it: facts the interface shows and other runs rely on, in
tables with invariants, changed only through `Registry`. Every change
refreshes what shows it, makes "Il punto" of its projects stale, goes on
the run's page of the diary and — made by the user — becomes a lesson,
which names its message (and the open thing's number) so the reflection
can read it.

- **Notes** (`notes.ts`): what each message said for the user when it came —
  the gist, its nature, priority, reason, deadline. History, written once
  and corrected only when it was read wrong; one the user corrected is not
  rewritten from the background. A write lands only over the revision it
  read, so a correction made in between is checked again. A note is also
  how the app knows a message was read. A message that came to another of
  the user's accounts too (the same Message-ID) and was read there is not
  read again: its note is copied (`twin_account_id`), and goes when the
  account it was copied from is removed.
- **Commitments**, "cose aperte" (`commitments.ts`): `ti_chiedono`,
  `hai_promesso`, `aspetti`, `da_fare`, each from where it came
  (`CommitmentOrigin`): a message, with its conversation; an event — what
  an appointment asks, preparing or bringing something; or the user's word,
  said to the Segretario in the panel or written in Oggi. Where it comes
  from does not change what it is: it shows in Oggi, in the calendar on its
  date and in the projects of its source; the Posta's views gather those
  from messages, and the event panel those from its event.
  A commitment is `aperta` until it is `fatta`, turns out `non_serve`, or is
  `rinviata` to a day, when it opens again; any can be reopened, corrected,
  merged with another (all or none), or asked about — the Segretario's
  question, answered in Oggi. Every change goes in `ai_item_history`, with
  who made it, before and after, and can be undone; "Annulla" after the
  user ticks one undoes their last change and takes back its lesson
  (`undoCommitmentStatus`, `retractLessons`). The user's word wins: a
  commitment the user created or edited is theirs (`set_by`), and a run in
  the background changes what the user decided only with a message newer
  than the decision, given as evidence; without one, it does not open
  again what the user closed — the same kind, worded alike, in the same
  conversation.
- **Projects** (`projects.ts`): the matters that last. The Segretario makes,
  names and fills them as it reads; the user renames, merges, hides and
  concludes them from the sidebar. Made one at a time, a project called
  like one already there — hidden or concluded too — is that one, and a
  name taken is refused to a rename. A conversation may be in several; one
  the user took out is never filed there again, and a merge keeps who
  linked each. Folders on the computer or a network disk and events are
  linked as resources (`cartella`, `evento`): a project shows its
  appointments, counts what is open from them, and "Il punto" reads them. "Il punto" says where a project stands; once something moves
  after it, it is stale (`stale_since`) and the engine has it written
  again — also when the project moved after its writer began, other than
  by the run's own change. A run in the background does not merge the
  user's projects, nor open again one the user concluded (`closed_by`).
- **Replies prepared** (`replies.ts`): one per message, a reply or a
  reminder (`sollecito`), local until the user takes it up: `pronta`;
  `da_rivedere` once the conversation moved on (kept, not counted as ready);
  `usata`, `scartata`, or `superata`. One the user used or set aside is not
  offered again from the background — checked in the write itself, over
  the revision read.
- **Proposals** (`proposals.ts`): what the Segretario recommends and may not
  do alone, until the user accepts it or sets it aside. An extension's
  action (archiving) is one open per message and kind; an event proposal
  (`evento`) is one per event (`replaces`, `perMessage: false`), in three
  forms: a new event; a change to one, holding only what changes (`change`,
  with `changes` in words); an answer to its invitation (`response`).
  Accepting does just that, as the user's own act (`decideProposalNow`) —
  a proposal written before kept the whole event, and what it does not say
  is left as it is — and an event accepted as proposed teaches nothing.
  `calendario ritira` withdraws one of the Segretario's own
  (`withdrawProposal`); a message's archive proposals are settled once its
  copy is saved, however it was (`ExtensionAssistant.savedCopyProposalKind`).
  Written again, a proposal's revision goes up; the user's answer is to the
  revision on screen, so one to a proposal changed meanwhile is refused, to
  be looked at again.
- **Saved copies**: copies an extension saved outside the mail, facts on
  the message wherever it goes, shown with the extension's label
  (`savedCopyLabel`).
- **The day** (`day.ts`): the letter at the top of Oggi and the preparation
  of a meeting, each with when it was written and its links.

A calendar connection removed takes its meetings' preparations and event
proposals with it, and becomes a lesson (`forgetCalendar`).

Every object has a revision. A run remembers the revision of what it read
(`RunContext.seen`) — what its context showed counts as read, and a
conversation in the panel keeps them from one request to the next — and a
write over a newer one is refused (`RevisionConflict`), saying what the
object is now: the run has seen it, so it decides again at once — the same
write included (`ToolConflict`) — and two runs never overwrite each other
unknowingly.

### Views

"Da gestire" (messages something the user owes comes from), "In attesa"
(what the user waits for) and "Risposte pronte" (a reply ready) are
computed from the registry (`viewKeys`), whatever folder the message is
filed in; with the AI on, every list has an "Attivi" filter, the messages
with something open or a reply waiting (`allActiveKeys`). Their paths
(`segretarioViewPath`, and `segretarioProjectPath` for a project's every
conversation) open like a folder of "Tutti gli account": the main process
shows each message in the folder the user thinks of it in (`locate`).
Archiving or moving closes nothing. A message only in the Trash or Spam is
set aside: what is open from it leaves the views, Oggi and the projects'
counts until it comes back. The "Attivi" filter, like the views, follows
the work as it changes, in any folder. A message deleted for good —
missing from every folder for half an hour, every folder of its account
synced since (`ai_gone`, `settleDeleted`) — closes what came from it as
not needed, its reply and proposals superseded; its note stays, as
history.

### Tools

Every run has the same tools (`tools/`), each described to the model by
`prompts/strumenti/<name>.md`, the extension's after them:

| Tool           | What it does                                                                                                                                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cerca_posta`  | The full-text index over every account: words, folder, project, period, unread, attachments; with `quadro`, who the user writes to and hears from, month by month (`mail-overview.ts`).                                             |
| `cerca_file`   | Files and folders by name in the user's folders and the mounted disks, or a folder's listing — all of it read and sorted, folders then the newest, before it is cut.                                                                |
| `leggi`        | Whatever a handle names — a message or its whole conversation with the work already on it, an attachment or a file (`extraction.ts`), an event, a project, a draft — or a file by its path.                                         |
| `nota`         | Writes or corrects a message's note.                                                                                                                                                                                                |
| `impegni`      | Lists the commitments — by kind, date, project or person, with `chiuse` those closed in the last 14 days — and changes them, several operations a call; one opens on a message, an event, or the user's word in the panel.          |
| `progetti`     | Lists, creates, links and unlinks conversations and events, renames, describes, writes "Il punto", merges, hides, concludes, links folders.                                                                                         |
| `risposta`     | Lists the replies and reminders prepared, prepares one, confirms one to look at again, discards one.                                                                                                                                |
| `scrivi_bozza` | A real draft — reply, forward, new — saved in Bozze and opened in the composer; in `scrittura`, the text for the editor.                                                                                                            |
| `invia_bozza`  | Sends a draft once the user confirms its card.                                                                                                                                                                                      |
| `organizza`    | Archives, moves, flags, marks read or unread, moves to the Trash.                                                                                                                                                                   |
| `calendario`   | Lists events (with the events it proposed), searches them by words, past and coming, finds free times, creates, changes and deletes what the user organises, answers invitations, proposes, withdraws its own proposals (`ritira`). |
| `memoria`      | Reads, searches, edits, inserts, writes, renames and deletes notes; a note's history, and a version restored.                                                                                                                       |
| `oggi`         | The letter of Oggi — written by the day's run, or when the user asks: a reading puts what matters today in the commitments instead — and a meeting's preparation.                                                                   |
| `revisione`    | The outcome of a reread before sending: four warnings at most, each within 280 characters, or it is refused.                                                                                                                        |
| `mostra`       | Opens a message, a draft, a project, an event or a day on screen, or a search as a list.                                                                                                                                            |
| `diario`       | What it did in the last days, run by run, with the changes each made: searched in SQL, 40 runs at most.                                                                                                                             |

Making an event or proposing one is idempotent, as making a project or a
commitment is: they are made one at a time, and one already there at the
same times with a title like it is given back instead of a copy — two
readings of one booking, running together, leave one event. The tools take
what the model naturally writes, and a refusal says what would succeed: a
project by its short name or by its name (or none, when the run knows only
one), the words of `progetti cerca` however they come, an event to prepare
by its reference or its title, an event all day or at an hour as its times
are written — an all-day `fine` as its last day, as one says it — an
answer to an invitation in Italian ("partecipo", "forse"), a note's nature
where a commitment's kind is meant; a missing note is answered with the
notes called most like it, a search that finds nothing says why. The dates
they return carry their weekday ("mar 10/11/2026"). A change to an event is
confirmed on a card that says, in local time, what it was and what it
becomes; an event someone else organises (`organizedByUser === false`) is
answered, never changed or deleted.

A message read with `leggi` comes with what is already there — its note,
what is open in its conversation and recently closed, its projects, the
reply prepared, the drafts answering it, where it was saved outside the
mail, the proposals waiting — so a run continues the work instead of doing
it again beside it. A conversation too long to read whole gives its first
and newest messages, and names those in the middle, a line each, to read
one by one. A draft `scrivi_bozza` writes in answer to a message counts the
reply prepared for it as used.

### What a run may do

A run in the background (`RunContext.background`: every run the engine
starts, and Conoscimi) reads mail it cannot trust with nobody watching, so
it never acts outward. It keeps the user's work and the memory up to date,
and creates or corrects the user's own events without guests, deleting
only those it made itself. It does not send, archive, move or trash mail,
write real drafts or open anything on screen (`requireInteractive`), cannot
ask for a confirmation, and answers no invitation: an event with guests, a
change to one, an answer to an invitation become a proposal (`calendario`,
`proponi`), and an extension's tool gets `propose`, its `confirm` always
false. Only a run the user has in front of them can ask
(`RunContext.watched`: the panel's conversations): it asks on its card
before what reaches others — a send (through the composer, with its
checks), an event with guests created or changed, an invitation answered,
any event deleted. The user's runs that show no conversation — the reread
before sending, the help in the composer, the search in words — cannot
ask either, and so refuse what reaches others. Files are only read, and
mail is never deleted for good.

### The diary and undo

A run's changes are kept with it (a `changes` event). The panel's diary
("Diario: il lavoro fatto da solo") shows the work done alone, run by run,
for 21 days, each change with "Annulla" where it can be undone
(`undoChange`): a commitment's change, a conversation filed in or out of a
project, a reply prepared, a project made, renamed or hidden, an event
created, changed or deleted.

### Memory

The notebook (`memory/notebook.ts`, `ai_memory`) is Markdown notes the
Segretario organises itself, shared by every run. Its shape is the
Segretario's: the identity suggests a start (`tu.md`, `stile.md`,
`connessioni.md`, `persone/…`, `progetti/…`, `decisioni.md`) and principles
— what the mail does not say goes in, what a search finds again or what
changes by the day does not; one note per subject, each fact in one place —
and nothing in the code depends on a path. What the notebook guarantees is
integrity: edits are patches on the note as it is now (each passage
replaced found exactly once, all or none), so two runs editing different
lines both land; a whole rewrite made on an older reading is refused, as
is an insertion at a line counted on an older version — at the end of a
note it always lands. A refusal for a change made meanwhile comes back
with the note as it is now, numbered, and counts as read (`ToolConflict`
in `tools/memory.ts`). Every version is kept (the last 40) with who wrote
it, and can be restored; a note holds 20 000 characters at most. A note is
read with numbered lines (number, tab, line); a passage copied with the
spaces of that numbering is found all the same, and an edit given without
its note lands in the one note that holds its text. A search whose words
are all in a note's name finds the note, not each of its lines. Every run
begins with its map (`index`): each note with its first line, a folder of
more than twelve as one line with its count and the notes touched last,
opened with `memoria leggi <cartella>/` — so the map stays small however
much the memory grows. Settings → "Cosa so di te" shows every note to
read, correct (a lesson; a note the Segretario changed since it was opened
is refused), and restore from its history; its "Dimentica tutto" stops the
work that writes the memory, then forgets the notes and the connections
known, so Conoscimi is to be done again.

- **Conoscimi** (`compiti/conoscimi.md`): pressed by the user, it gets to
  know the connections chosen — mailboxes and calendars (`ai_learning`; a
  calendar that came with a known mailbox is known with it) — building on
  what it knows, and writes the user, the connections, people, projects and
  their style into the memory.
- **Riflessione**: every draft the Segretario writes is kept (`ai_drafts`);
  when it goes out the composer reports what the user wrote above the
  signature, and the difference — or that nothing changed — becomes a
  lesson (`ai_lessons`), as do the user's corrections and decisions in the
  registry and the memory. With lessons waiting, at most every six hours, a
  run turns them into rules, each lesson's message named as `m…` to read.
- **Al passo**: once some connection is known and the reading is done,
  about once a day, the notes written since on messages that say something
  (the latest 150, each message named as `m…`) go to a run that keeps the
  memory true — people who come back, connections used differently, stable
  facts about the user — and in order: notes that repeat or contradict each
  other merged, day-to-day facts taken out, notes grown into lists of
  details cut back, many small notes of one kind gathered.

A connection removed — a mailbox or a calendar — takes its learning with
it, and the next reflection hears of it, to correct the memory wherever it
wrote of it. "Dimentica tutto" in Settings → Segretario
(`forgetAll`) goes further: memory, notes, commitments, projects, replies,
diary and spending go — the key and the copies an extension saved stay —
and the AI turns off; on again, it starts from the guided setup.

### Prompts

Every prompt is a Markdown file in Italian under `src/main/ai/prompts/`,
bundled with `?raw` (`prompts.ts`): `segretario.md` (the identity, every
run), `contesto.md` (the context of a run's first message), `compiti/<task>.md` (one per task), `strumenti/<tool>.md` (each
tool's description) and `infrastruttura/` (`compattazione.md`, the summary
of a long run; `titolo.md`, a conversation's title). An extension adds its
own (see [Extensions](#extensions)). For tuning them,
`SIEVER_AI_TRACE=<folder>` writes every call's messages and answer there, a
JSON line each; it is off unless set.

### In the interface

The panel's state comes from `useSegretario`
(`features/segretario/use-segretario.ts`), which keeps the stream of the
activity on screen alone and returns one memoised object, so work done
alone, step after step, does not redraw the app.

**Oggi** (`apps/today/today-page.tsx`), the first app of the rail with the
AI on (`getToday`): the letter the day's run wrote, its links live; "In
agenda", the day's events with the preparation written for them; "Ti
chiedo", the Segretario's questions — what it asks about shows there
alone; then what is due today or late, this week, what the user owes
without a date or later, the replies prepared, what they wait on; and the
proposals, events first, each naming the message it comes from
(`Proposal.source`). Each line opens where it comes from — a message, an
event, or nothing for the user's own word (`DayLine.source`,
`day-line-source.ts`); an open thing's has the reader's menu too
(`CommitmentMenu`: Sollecita, Non serve, Rinvia, Scadenza). "Una cosa da
ricordare" at the bottom keeps what the user writes as an open thing of
their own, without a date. While mail is
still to be read the page says so, and while the Segretario is stopped it
says why (`paused`). A letter behind is written again when the page is
looked at (see [The engine](#the-engine)), the page saying so
(`letterRewriting`); "Guarda di nuovo la giornata" asks for the day again.

**In the mail.** A row says what is expected now — owed, a reply ready, an
answer awaited — with its deadline, in the Segretario's colour
(`row-work.tsx`). The reader opens on "Il punto" (`message-work.tsx`): the
note, what is open in the conversation — ticked off with an undo, put off,
not needed, corrected, reopened, a question answered — the reply ready
("Usa questa risposta" opens it in the composer as a reply, learnt from
like the Segretario's drafts; "Scarta"), the proposals — the events of the
whole conversation, an archiving only on its own message — the projects of
the conversation, and the copy an extension saved. Proposals read the
same wherever they show (`proposal-words.ts`). "Segna come gestito"
(⌘⇧E, on a selection of any size) closes as done what the user owes in
those conversations. The sidebar lists the views, the searches kept and the
projects, each project with its menu (rename, merge, conclude, hide); a
project opens as the list of its conversations under its "Il punto"
(`project-banner.tsx`), its links live, written again when it is behind.

**Alerts that matter.** With "Solo ciò che conta" on (Settings → Notifiche,
the default) and the Segretario reading new mail — the AI on, the key
working — a new message is not announced as it arrives: it waits for its
note, and only one that asks something of the user and matters — a reply
or an action of high priority, a reply of medium — gets an alert, saying
what the note says. A note that has not come within ten minutes, or the
Segretario stopping, lets what waited be announced as it is
(`NotificationManager.setSegretarioReading`, `noteWritten`).

**Writing together.** In the composer, ⌘J (or its "Segretario" button)
starts a `scrittura` run with the request, the text so far and the message
answered: it writes the reply, or rewrites what is written — shorter, more
formal, warmer, corrected, in English, or as asked in a few words — and may
look things up while the user waits. The text takes the place of the lines
above the signature and the quote (`replaceWrittenPart`), with an undo, and
is kept as the Segretario's draft so the user's later edits are learnt
from. With a
passage selected, only that passage is rewritten; the rest stays the
user's, not learnt from.

**Asking the mail in words.** In any list's search field, ⌘↵ (or the star
beside it) hands what is typed to a `ricerca` run, which turns it into the
search tool's own parameters (`mostra`, `ricerca`); the full-text search
runs over every account and the result opens as a list
(`segretarioSearchPath`) titled with what was sought, the question above
it. The latest twenty are kept for the session; "Tienila come cartella"
keeps one for good (`ai_saved_searches`): a folder under Segretario in the
sidebar that runs the same search again each time it opens — no model call
— until "Togli dalle cartelle". A period said from today ("questa
settimana", "negli ultimi 10 giorni") is kept as said and counted from the
day it runs.

**Rereading before it goes.** With the AI on, pressing Invia has a
`revisione` run reread the message as it will go, with the one it answers
named for it to read, and the calendar there if it needs it (`review.ts`). It flags only what
the user would want to fix — an attachment named and not attached, a
question skipped, a greeting to someone not among the recipients, a weekday
that does not match its date, a "[data]" left to fill — in a panel at the
button, with "Correggi" and "Invia comunque". Nothing found, it goes; a
reread not back within twelve seconds (`REVIEW_TIMEOUT_MS`, shared by the composer and the run) never holds it. What the Segretario
sends after the user confirmed its card is not reread.

**Scanned PDFs** are looked at. A PDF is read page by page: a page with
text gives its text (unpdf), a page without — a scan — is drawn as a JPEG
1 600 pixels wide and handed to the model as a picture, five at most per
read. The drawing happens in a hidden, sandboxed window
(`renderer/pdf-pages.html`, `ai/pdf-pages.ts`) with PDF.js on the
browser's own canvas and its JBIG2 and JPEG 2000 decoders in WebAssembly,
so no native module is built for any platform; the window opens with the
first scan and closes a minute after the last. Because that window exists,
the app's own window is named (`app-window.ts`): what the interface is
told, and what a notification brings forward, goes there and nowhere else.

## Calendar

The calendar connections (`src/main/calendar/`, `shared/calendar.ts`), each
with its own access (see [Connections](#connections)). `CalendarService`
keeps a copy of their calendars and events in step with the providers, and
the Calendario, Oggi, the reader and the Segretario read it from there.

**Providers** implement one interface (`CalendarProvider`): the calendars
(name, primary, whether events can be written in it, colour); the events
of a calendar, every one in a window or what changed since a token,
cancelled ones included; create, update and remove, telling the guests —
a provider that could not tell them refuses — where an update writes only
the fields that really differ (`differingFields`), so what someone else
changed meanwhile in another stays, and the editor sends only what its
form changed (`event-editor.tsx`); answer an invitation, one occurrence or
the whole series — refused in a calendar someone else shares.

| `provider`  | Module               | How it syncs                                                                                                                                                                                                 | Writes                                                                                                                                                                                                                                                                                                                                         |
| ----------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `google`    | `google-calendar.ts` | the Calendar API (googleapis) with its sync token; an expired one starts over                                                                                                                                | through the API, Google inviting the guests                                                                                                                                                                                                                                                                                                    |
| `microsoft` | `graph-calendar.ts`  | Microsoft Graph, each calendar with its own delta, a removal asked again (gone, or moved out of the window); ids that stay as an event moves; the UID read from Exchange's Global Object ID (`canonicalUid`) | through Graph, which tells the guests: timed events in UTC, all-day ones at midnight in the mailbox's zone; guests kept with their type and name; the body written, as HTML, only when it changed                                                                                                                                              |
| `caldav`    | `caldav-calendar.ts` | tsdav, by the server's sync token (sync-collection) or its ctag; objects kept as the server has them (`calendar_objects`) and expanded into the window                                                       | in place, with the version read; an instance of a series as its exception; guests, changes to an event with guests and answers only where the server says `calendar-auto-schedule` (RFC 6638), which sends them; asked with the client's own headers and sign-in, a refusal or a 5xx asked again next time, never taken as "does not schedule" |
| `ics`       | `ics-calendar.ts`    | the whole file again when its ETag or date — or, with neither, its fingerprint — says it changed; `webcal://` read as `https://`                                                                             | none: read only                                                                                                                                                                                                                                                                                                                                |

iCalendar text — CalDAV objects, links, invitations — is read with ical.js
(`icalendar.ts`): a series with its exceptions by UID, a calendar's own
VTIMEZONEs registered again at each read (two calendars may define one
TZID two ways), a time zone named without its VTIMEZONE resolved by its
IANA name, the instances that fall in the window. A rule that would never
give an instance is cut off (`guardedIterator`: ical.js guards only
monthly and yearly ones), and an event without a UID is kept by its place
in the file. An event the Segretario put in a calendar says so
(`EventOrigin`), marked in the provider's own private properties.

**Sync.** Every five minutes; a connection's syncs and writes take turns
(`inTurn`), so a sync never reads an event while it is written. The
calendars listed (one no longer there takes its events and CalDAV objects
with it), then each calendar's events — from two months back to a year
ahead the first time, then only what changed; when the token expires or
the window's end comes within six months, the window is read again. A
CalDAV object read is kept only once its events are (`commit`), so a sync
cut short reads it again. What a sync finds changed that the app did not
change — new, moved, cancelled, an invitation answered — is noted in
`calendar_changes`, kept a month, for the Segretario's `calendario` run; a
calendar read whole again (a link, an expired token) is compared with what
it held, and only an event gone that was inside the window read counts as
cancelled. A calendar that cannot be read does not stop the others. A
connection's last problems are kept with it, in the user's words.

**The Calendario** (`apps/calendar/`): day, week, month and agenda, the
small month, and the calendars by connection with their colours, each
shown or hidden on this computer. With the AI on it adds the Segretario's
layers: what is due — from any source (`getDue`) — and the events it proposes. A
click or a drag on the grid makes an event. An event the user organises
(`CalendarEvent.organizedByUser`: theirs, a calendar's they write in, or
one without guests) is dragged to move it (guests are asked about first),
and changed or deleted from the panel beside it; an invitation is only
answered. The panel also joins the call and, with the AI on, shows the
event's share of the work as the reader shows a message's: the preparation
the Segretario wrote, the projects the event is in, the open things born
from it and a field to add one, due on its day (`event-work.tsx`,
`eventWork`). Events are searched by words — title, place, description,
guests, calendar — past and coming, the coming first (`calendar:search`,
`event-search.ts`; the Segretario's `calendario cerca` runs the same
search), the results opening on their day. From the keyboard: T today, J
and K the next and previous period, D, W, M and A the views, C a new event,
⌘F the search, Esc closes the panel — commands of their own (`calendar`
group), answering only while the calendar is in front and changed in
Settings › Scorciatoie like the mail's. The Segretario is told what the
calendar shows (`CalendarSight`), and `mostra` opens a day or an event
there. Oggi lists the day's events under "In agenda".

**Invitations.** An invitation in a message (its `.ics`, read by `ics.ts`)
shows at the top of the reader (`features/calendar/invitation-card.tsx`).
Its event is looked for by UID (`eventByUid`, `event-roles.ts`) — the
occurrence its RECURRENCE-ID names, or a series' next one — and answered
there only where the answer reaches the organizer: in a calendar the user
writes in, whose provider tells the organizer, and only as the address the
invitation came to — in the calendar of that mail account, or where the
user's own entry among the guests is that address (a CalDAV server may
list more addresses for the same person). The user's addresses are the
mail accounts', the Google and Microsoft identities, a CalDAV username that
is an address and those the servers report — never a connection's label. Partecipo, Forse, Non partecipo answer the whole series
for an invitation to one. Otherwise — no calendar has it, only one the
user reads or someone else's, a server that does not schedule, the user
invited through a list or an alias — the answer goes to the organizer by
mail, as calendars answer one another (iMIP: a `REPLY` from the account
the invitation came to, `respondToInvitationByMail`), the date read from
the file. The Segretario's `calendario` tool lists events and free times,
creates, changes and deletes, answers, proposes and withdraws, within what
a run may do (see [What a run may do](#what-a-run-may-do)); an event has a
short handle (`e1`) the panel links to the Calendario.

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

| Surface                                         | What it does                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ExtensionMain.install(context)`                | Runs once after the mail, the calendars and the Segretario start: DDL, IPC handlers, startup work.                                                                                                                                                                                                                       |
| `ExtensionMain.clearData()`                     | Deletes its data, as part of "Elimina tutti i dati", after the host emptied its own, while the mail's connections are stopped.                                                                                                                                                                                           |
| `ExtensionMain.uninstall()`                     | Optional; called when the app stops, before the host's own pieces.                                                                                                                                                                                                                                                       |
| `ExtensionMain.defaultAccountSignatureHtml`     | Signature given to the first account added. Empty in the public build.                                                                                                                                                                                                                                                   |
| `ExtensionMain.accountSignatureRevision`        | Edition of that content; stored signatures on an older one — and accounts without one — are handed, once, to `upgradeAccountSignatureHtml`.                                                                                                                                                                              |
| `ExtensionMain.assistant.instructions()`        | What the Segretario must know of the company the build is for — how its work and projects are organised and named, where its archive is — in Italian; joined to the identity in every run and read as the run starts, so it may say what the user configured. Never the projects themselves: the Segretario finds those. |
| `ExtensionMain.assistant.tools`                 | Tools the Segretario gets after the host's (`ExtensionAssistantTool`: name, description, JSON Schema, the line shown while it runs, `execute`).                                                                                                                                                                          |
| `ExtensionMain.assistant.savedCopyLabel`        | What a copy the extension saved is called on the message it came from ("Archiviato Siever"); "Salvato" without one.                                                                                                                                                                                                      |
| `ExtensionMain.assistant.savedCopyProposalKind` | The kind of proposal a saved copy answers: once a message's copy is recorded, its proposals of that kind still open are settled, however it was saved.                                                                                                                                                                   |
| `ExtensionShared.composition`                   | Fonts, default font, text colours and extra font stacks the composer offers.                                                                                                                                                                                                                                             |
| `ExtensionShared.commands`                      | Commands with their default chords, listed in Settings → Scorciatoie and, on macOS, in the menu bar.                                                                                                                                                                                                                     |
| `ExtensionRenderer.runCommand`                  | Runs one of those commands on the main window's selection; returns whether it did anything.                                                                                                                                                                                                                              |
| `ExtensionRenderer.toolbarActions`              | Buttons first in the reading pane's header, given the selection.                                                                                                                                                                                                                                                         |
| `ExtensionRenderer.settingsTabs`                | Tabs after the host's in Settings.                                                                                                                                                                                                                                                                                       |
| `ExtensionRenderer.PrimaryActionDialog`         | A dialog the host mounts and opens on request.                                                                                                                                                                                                                                                                           |
| `ExtensionRenderer.proposalActions`             | For each kind of proposal the extension makes, the button on it and the command it runs on its message.                                                                                                                                                                                                                  |
| `ExtensionRenderer.fontFaceCss`                 | `@font-face` rules for bundled fonts, applied to the app and every message frame.                                                                                                                                                                                                                                        |
| `ExtensionRenderer.localDataLabel`              | How the data `clearData()` removes reads in Settings.                                                                                                                                                                                                                                                                    |
| `ExtensionPreloadInstaller`                     | Methods added to `window.mailApi` (`ExtensionBridge`): never one named like the host's — it would replace the host's for the whole app — which fails the extension's type check; at run time the host's own method wins.                                                                                                 |

`install()` receives an `ExtensionMainContext`: `app`, `ipcMain`, the user
data path, a database handle (`applyDdl`, `query`, `execute`) on the host's
connection, a mail engine handle, `getMainWindow()`, `recordRecentFiles()`
and `adoptShortcutOverride()`, and three ways into the Segretario's
registry: `copiesSaved(entries)` records copies of messages the extension
saved outside the mail, as facts on each message wherever it goes;
`savedCopies(refs)` says where these messages were saved before, so what is
saved already is not saved again; `proposalDecided(id, accepted, result)`
settles one of its proposals with what the user chose, for the reflection
to learn from. A copy counts as saved only once it is recorded:
`copiesSaved` fails when the record cannot be written — the Segretario
unable to open, a message no longer where `ref` says — and that message's
save with it, so it is not archived. An entry may carry the proposals the
user followed for its message: they are accepted with what the user chose
once the copy is recorded, and the others open on it set aside; settling
them never fails a copy that is recorded. `savedCopies` fails rather than
know none, and nothing is saved twice. With the Segretario unable to open, a
decision goes unrecorded. The engine handle gives raw messages in bulk —
`fetchMessageRawSources(refs, onMessage)` downloads a few per command and
hands each on while the next arrive, resolving with those no longer on the
server (`missing`) and those whose folder could not be read now (`unread`,
with the reason), a folder's failure not stopping the others — and
`archiveMessages(refs)` archives them as the host's Archivia does (see
[Mail engine](#mail-engine)): a message archived already is no failure.
Main-side extension code may also import the host's helpers, such as
`ensurePathReachable` and `writeUniqueFile`.

A tool of the extension's runs like the host's (`tools/index.ts`): it is
given an `ExtensionToolContext` with `message(handle)` — the short name the
model wrote resolved to a message (its ref, key, conversation, subject,
date, sender) — `background`, `confirm()` (the user's answer on the card;
always false where the run cannot ask, see
[What a run may do](#what-a-run-may-do)), `propose()` (a proposal on a
message, one open per message and kind, which the extension carries out
itself through `proposalActions`), `recentCopies(limit)` (where the user
saved mail lately with it: their habits) and an abort signal.

The selection handed to toolbar actions, commands and the primary dialog
carries `savedBefore` — where a copy of an earlier message of the selected
conversations, or else of the same sender, was saved — `projectFolders`,
the folders linked to the projects those conversations are in, and the
Segretario's open `proposals` on the selected messages; all are empty with
the AI off.
Renderer surfaces get `ExtensionHostHooks`:
`optimisticallyRemoveMessages(refs, action, fallbackErrorMessage)` takes the
rows out of the list at once and puts back the ones the action reports
failed, as the host's own Archivia does.

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
it over Node's built-in `node:sqlite`; the Segretario's stores run their
very SQL on it (`ai/testing/memory-sql.ts`). The CalDAV provider has a test
against a real server (`caldav-calendar.integration.test.ts`), skipped
unless `CALDAV_TEST_URL`, `CALDAV_TEST_USER` and `CALDAV_TEST_PASSWORD` are
set. Before a change is done: `npm run typecheck`, `npm run typecheck:ext`
(with an extension), `npm test`, `npm run lint` and both builds
(`npx electron-vite build`, `LOAD_EXTENSION=1 npx electron-vite build`).

## Build and release

`build.mjs <version>` builds installers: `--target=<id>` for one of
`macos-arm64`, `macos-x64`, `windows-x64`, `linux-x64`, `linux-arm64`
(Linux in Docker), `--all` for every one, none for macOS arm64 + Windows
x64. It sets the version in `package.json` for the build and restores it
afterwards, signs and notarises on macOS when the credentials are present,
and writes to `release/<label>/v<version>/`. `runBuild()` is exported, so
an extension can build its own releases with `loadExtension: true` and a
label of its own.

The packaged app reads its OAuth clients — Google's
(`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`) and Microsoft's
(`MICROSOFT_OAUTH_CLIENT_ID`, see [Connections](#connections)) — from a
`.env` in its resources (`config/env.ts`); a client left out, or blank,
turns its sign-in off. `build.mjs` writes that file (`.env.runtime`) from the local
`.env`, keeping only the variables the app reads (`RUNTIME_ENV_KEYS`): a
developer's own keys never ship.

`.github/workflows/release.yml` runs the targets in parallel on `v*` tags,
with the three clients from the repository's secrets of the same names,
and publishes a GitHub Release.

## Security

- `contextIsolation: true`, `nodeIntegration: false`; the preload exposes
  only the typed bridge, and navigation is limited to the app's own page.
- Incoming HTML is sanitised with DOMPurify and shown in sandboxed frames.
- Secrets — passwords, OAuth tokens (MSAL's token cache for Microsoft),
  a calendar's link, the OpenRouter key — pass through `safeStorage`;
  without an OS keychain they are not stored. A CalDAV password is sent
  only over https, or to a server on this computer.
- Microsoft's sign-in is a public client without a secret, in the user's
  browser; Google's opens in a window of its own.
- The window's session grants only the clipboard write; camera,
  microphone, location and every other web permission are refused.
- External links open in the browser only if they are `http(s)`.
- Opened attachments never execute; Windows marks them as downloaded.
- The Segretario's runs in the background, which read mail nobody has
  checked, cannot reach anyone: they send, move and invite nothing, and
  propose instead. What a conversation in its panel sends or does towards
  others waits for the user's confirmation on its card; runs that show no
  conversation cannot ask, and refuse. It never deletes
  mail for good and only reads files. Mail and files are data to it, never
  instructions (its system prompt says so, and it reports what looks like
  an attempt). It talks only to OpenRouter, with the user's key, and only
  to providers that keep no data and train on none.

## License

Apache License 2.0. See [`LICENSE`](../LICENSE).

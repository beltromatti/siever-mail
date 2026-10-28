# SIEVER Mail — Technical Documentation

How SIEVER Mail is put together: the processes, the data, the mail engine,
the interface and the extension surface. It is written for engineers who
read, debug or extend the code. The code comments go deeper on each piece;
this page is the map.

## Stack

| Layer       | Technology                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| Shell       | [Electron](https://www.electronjs.org/) 44 (macOS 13+, Windows 10+ x64, Linux)                          |
| Bundler     | [electron-vite](https://electron-vite.org/) + Vite                                                      |
| UI          | [React 19](https://react.dev/) + TypeScript, [Tailwind CSS v4](https://tailwindcss.com/), Radix/shadcn  |
| Local store | SQLite through [Prisma 7](https://www.prisma.io/) and its `better-sqlite3` adapter                      |
| Mail        | [imapflow](https://imapflow.com/) (IMAP), [nodemailer](https://nodemailer.com/) (SMTP), mailparser      |
| Gmail       | OAuth 2.0 over IMAP/SMTP (XOAUTH2); no Gmail HTTP API                                                   |
| Editor      | [Squire](https://github.com/fastmail/Squire), inside a sandboxed iframe                                 |
| Lists       | [TanStack Virtual](https://tanstack.com/virtual) for the endless message list                           |
| HTML safety | [DOMPurify](https://github.com/cure53/DOMPurify)                                                        |
| Tests       | [Vitest](https://vitest.dev/) (node + jsdom projects)                                                   |
| Segretario  | The user's own [OpenRouter](https://openrouter.ai/) key; the newest DeepSeek Flash; no server of ours   |
| Documents   | unpdf (PDF text), PDF.js (scanned pages), mammoth (Word), SheetJS (spreadsheets), fflate (OpenDocument) |
| Markdown    | [Streamdown](https://streamdown.ai/) for what the Segretario writes, as it writes it                    |

## Processes and startup

The usual Electron split. Only the main process touches the network, the
file system and the database; the renderer is context-isolated and reaches
it through the typed `window.mailApi` bridge (`src/preload/index.ts`,
channels in `src/shared/ipc.ts`), and the Segretario through
`window.segretarioApi` (channels in `src/shared/segretario.ts`).

Startup, in `src/main/index.ts`:

1. `prepareUpgradeMigration()` — before the database is opened, detects a
   version change and backs up the user data (see
   [Upgrades](#upgrades)). Never throws.
2. `MailService.openStorage()` — opens SQLite, reconciles the schema, then
   finishes any upgrade migration.
3. `MailService.start()` — the notification preferences and the icon badge
   are applied, the mounted network shares remembered (see
   [Network shares](#network-shares)), the mail engine connects the
   accounts and the Segretario opens (see [Segretario](#segretario)).
4. The extension installs (see [Extensions](#extensions)).

The window is created right away and loads alongside. **Every IPC channel
that touches stored data waits for step 2** (`register-mail-ipc.ts`), so
the interface never reads rows the migration is about to purge or restore;
channels that only drive the window (minimise, close, …) never wait.

The theme is applied before any of this, from a one-word file in the user
data folder, so the first frame is already in the right colours
(`src/main/theme.ts`). The window's session grants one web permission, the
clipboard write "Copia indirizzo" needs; Electron would otherwise grant
them all.

## Source layout

```
src/
├── main/                      Node side
│   ├── index.ts               lifecycle, window, tray, permissions, startup order
│   ├── app-identity.ts        the bundle id / AppUserModelID
│   ├── app-window.ts          the window the user works in, named
│   ├── app-menu.ts            macOS menu bar (Italian); none elsewhere
│   ├── context-menu.ts        native menus for text, links, pictures, spelling
│   ├── theme.ts               Sistema / Chiaro / Scuro → nativeTheme
│   ├── ipc/                   IPC handlers: the mail's, the Segretario's
│   ├── ai/                    the Segretario
│   │   ├── segretario-service.ts  key, activities and the loop each one turns
│   │   ├── openrouter.ts      the model: requests, streaming, errors, the key's credit
│   │   ├── ai-store.ts        its tables: key, usage, activities, events, memory
│   │   ├── agent/             conversation rebuilt from the event log, short names
│   │   ├── tools/             what it can do: search, read, write, organise, remember
│   │   ├── prompts/           its instructions, in Italian, one file each
│   │   ├── mail-search.ts     the full-text index as the agent asks it
│   │   ├── extraction.ts      the text of PDFs, Office files, spreadsheets, pictures
│   │   └── pdf-pages.ts       scanned PDF pages drawn as pictures, in a hidden window
│   ├── services/
│   │   ├── mail-service.ts    façade the IPC layer calls
│   │   ├── database.ts        Prisma client, raw DDL, queries
│   │   ├── data-migration.ts  upgrade lifecycle
│   │   ├── mail-engine/       connections, sync, sending, parsing, notifications
│   │   ├── drafts.ts          drafts: kept here as they are typed, filed in Bozze
│   │   ├── contact-ranking.ts which contacts the composer suggests, in what order
│   │   ├── attachment-files.ts  attachment copies (opened, forwarded) on disk
│   │   ├── recent-files.ts    the OS's recent documents, for "Allega"
│   │   ├── network-volumes.ts shares a restart left unmounted, mounted again
│   │   ├── app-badge.ts       the unread count on the Dock / taskbar icon
│   │   ├── file-utils.ts      names, unique writes
│   │   ├── google-oauth.ts    Gmail OAuth
│   │   └── secure-storage.ts  safeStorage wrapper for secrets
│   └── utils/                 logging to file, errors, external URLs
├── preload/index.ts           window.mailApi
├── renderer/src/
│   ├── App.tsx                top-level state and wiring
│   ├── features/              accounts, mail (list, table, reader,
│   │                          composer, editor), segretario, settings, workspace
│   ├── components/ui/         shared primitives (dialog, confirm, menus…)
│   ├── lib/                   selection, sections, HTML pipelines, zoom
│   └── styles/globals.css     Tailwind entry and the theme tokens
├── shared/                    types, commands and shortcuts, search grammar, folder
│                              roles, address parsing, fonts, sender/subject keys,
│                              the Segretario's contract (segretario.ts)
└── extension/                 the extension contract and its no-op stubs
```

## Data

One SQLite file, `userData/siever-mail.sqlite`. The schema is declared in
`prisma/schema.prisma` and applied at boot with raw
`CREATE TABLE IF NOT EXISTS` plus additive column checks in `database.ts`,
so an older file is brought forward in place.

| Table                        | Holds                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accounts`                   | IMAP and Gmail accounts; `encrypted_secret` is the password or OAuth token, encrypted with `safeStorage`.                                                                                                                                                                                                                                                           |
| `folders`                    | Folder metadata and sync cursors (UIDVALIDITY, HIGHESTMODSEQ, UIDNEXT, last UID). _Cache._                                                                                                                                                                                                                                                                          |
| `messages`                   | Envelopes, previews, flags. `message_key` names a message wherever it is filed (Gmail's id, else its Message-ID, else a digest), `thread_id` its conversation. Denormalised `sender_label` / `sender_sort` / `subject_sort` let the database sort and group by sender or subject, and the folded `search_*` columns let it search without case or accents. _Cache._ |
| `message_bodies`             | One body per `message_key`, shared by every folder that holds the message: its text for the index (level 1) or the readable message with its parts (level 2). _Cache._                                                                                                                                                                                              |
| `message_fts`                | The full-text index (FTS5 over `message_bodies`, kept in step by triggers), accents and case folded as the search box folds them. _Cache._                                                                                                                                                                                                                          |
| `search_hits`                | The index's matches for the searches on screen, so the list's query joins them instead of carrying thousands of ids. _Cache._                                                                                                                                                                                                                                       |
| `app_meta`                   | Small facts about the file itself: the shape of the cache (`cache_version`).                                                                                                                                                                                                                                                                                        |
| `ai_settings`                | The Segretario's OpenRouter key, encrypted with `safeStorage`, the last check of it and the preferences.                                                                                                                                                                                                                                                            |
| `ai_activities`, `ai_events` | The Segretario's work: each activity and the log of everything said and done in it, which the conversation is rebuilt from.                                                                                                                                                                                                                                         |
| `ai_memory`                  | The Segretario's notes on the user, their accounts, people and matters, as path → text.                                                                                                                                                                                                                                                                             |
| `ai_usage`                   | Every call to the model: tokens, cache hits and what OpenRouter billed.                                                                                                                                                                                                                                                                                             |
| `ai_learning`                | Getting to know each account: the activity that did it, when it began and finished.                                                                                                                                                                                                                                                                                 |
| `ai_lessons`                 | What the next reflection takes in: how the user corrected a draft of the Segretario's, a draft sent as it was, an account removed.                                                                                                                                                                                                                                  |
| `ai_drafts`                  | The drafts the Segretario wrote, as it wrote them, to compare with what the user sends.                                                                                                                                                                                                                                                                             |
| `ai_notes`                   | The Segretario's note on a message, by its key: the one thing that counts, where it leaves the user (to answer, to do, waiting, information, noise), priority, deadline, and when the user marked it handled.                                                                                                                                                       |
| `ai_items`                   | What is open between the user and someone, by conversation: asked of them, promised, awaited, to do; closed by a later message or by the user.                                                                                                                                                                                                                      |
| `ai_ready_drafts`            | Replies the Segretario prepared ahead, by the message they answer: offered until the user takes one up or sets it aside.                                                                                                                                                                                                                                            |
| `ai_briefings`               | What the Segretario wrote at the top of each day ("Oggi"), by local day.                                                                                                                                                                                                                                                                                            |
| `contacts`                   | Everyone stored mail names, for the composer's suggestions: `usage_count` / `last_used_at` count the mail written to them, `last_received_at` the newest they sent, `hidden_at` a contact taken out of the suggestions.                                                                                                                                             |
| `drafts`                     | The messages being written: recipients, subject, body, files, the thread they answer; `revision` / `server_revision` say whether Bozze has the draft as it is, `server_*` where its copy is, `docked` that a composer holds it.                                                                                                                                     |
| `account_signatures`         | One signature per account, with the version of the page it was written for (`html_format`) and the edition of the extension's content it has (`extension_revision`).                                                                                                                                                                                                |
| `recent_files`               | Files the user attached, saved or an extension filed away, offered first in "Allega".                                                                                                                                                                                                                                                                               |
| `recent_folders`             | The folders each account's messages were last moved to, offered first by "Sposta".                                                                                                                                                                                                                                                                                  |
| `app_preferences`            | One row: theme, layout, list order, sort, grouping, reader zoom, "Dettagli", shortcut overrides, the accounts "Tutti gli account" gathers, the notification preferences, the extension signature edition every account has joined.                                                                                                                                  |

Beside the database, `network-volumes.json` remembers the URL each network
share was mounted from (macOS).

An extension may add tables through the database handle it receives; they
live in the same file and connection. The host never reads them.

"Elimina tutti i dati" (Settings → Dati) empties everything but the
accounts and the preferences, then calls the extension's `clearData()`. Clearing one account's data drops its cache and the copies
of its attachments, and keeps its signature; the mail downloads again.

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

## Mail engine

`src/main/services/mail-engine/`. One `AccountConnection` per account, each
with three IMAP clients, so what the user does never waits behind a sync:

- **primary** — what the user does (read, move, flag, delete, download),
  one command at a time, and IDLE on the folder on screen (or the inbox),
  so its changes arrive as they happen;
- **sync** — first downloads, catch-up, previews, the messages read ahead
  and the server side of a search, in a queue ordered by priority (`user`,
  then `active-sync`, then `background`): a search jumps the queue, a
  background folder waits;
- **index** — the `MailIndexer`, which reads the text of every message, the
  newest first, for the full-text index and the Segretario. It fetches only
  the text parts — grouped by the shape of their structure, sixty messages
  a round with a pause between — and never an attachment. On Gmail it reads
  "Tutti i messaggi" and Bozze, where every message is once; elsewhere every
  folder but Spam and the Trash. It rests while the account is offline and
  starts again when new mail arrives; its progress shows on the rail's sync
  dot.

**What changed** is found with one `LIST` that asks every folder's
`STATUS` (`reviewFolders`), every 45 s and when the machine wakes or the
network comes back; IDLE pushes the folder on screen, which is also looked
at every 20 s. A folder is synced
only when its counts, UIDNEXT or (where the server keeps it per folder)
HIGHESTMODSEQ moved — Gmail's modseq is global, so it is not trusted alone
— and before planning a folder already open the connection NOOPs, so an
expunge that arrived meanwhile is seen. Unread counts come from
`ESEARCH COUNT` where the server has it.

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

**Bodies are kept once per message** (`message_bodies`, by `message_key`):
a message in three Gmail labels is downloaded and indexed once, and a body
never goes back to a lower level.

**Search** runs locally on the folded `search_*` columns and on the
full-text index (`full-text-query.ts` turns the search grammar into an
FTS5 expression: groups AND'ed, alternatives OR'ed, each word matched as
the start of a word). For the messages the index has not read yet, it asks
the server too — `IMAP SEARCH`, one per group of the query, intersected
(`server-search.ts`); the matches it finds join the list. A newer search
replaces one still waiting.

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
  Answers the server volunteers about other messages are taken as their
  new flags, never as the messages asked for.
- Without a connection, an operation waits up to 20 s for a reconnect and
  then fails with the reason, so the interface puts back what it had
  already shown. An account whose login was refused fails at once.
- Sending goes over SMTP; for IMAP accounts a copy is filed in the Sent
  folder afterwards, in the background (Gmail files its own). A sent
  message is never reported as failed because that copy is late. The SMTP
  socket is opened by Node, trying the server's IPv6 and IPv4 addresses in
  turn (Happy Eyeballs), as imapflow's are: nodemailer alone picks one at
  random, and an IPv6 address on a network without IPv6 held a message for
  the whole connection timeout.
- "Elimina" moves a message to the Trash; in the Trash, or on an account
  without one, it deletes for good, after asking.
- "Archivia" moves a message to the account's archive folder (`\Archive`,
  or one named so); on Gmail to "Tutti i messaggi", which is leaving the
  inbox; elsewhere to an "Archivio" folder it creates the first time, as
  Thunderbird and Apple Mail do.
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
Attaching, opening a file and the extension's archive all go through it.

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
staying. What the server refuses comes back; once every removal started
together has settled, so does the selection they had — unless the user has
picked something else meanwhile.

### Layouts

The window is a row of panes laid edge to edge, a hairline between each:
the rail (`features/workspace/app-rail.tsx` — the app's places, the
connection, Settings), the sidebar ("Scrivi", the account, the folders),
then the message list and the reading pane. Each pane's first band is
52 px tall and is the window's title bar: dragged like one, with the
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

The sidebar has two sections. **Tutti gli account** gathers, for the
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
`--background`), the panes on it (the list, the Segretario, `.paper`) and
the page being read (the message, Oggi, the agenda, `.page`), all with a
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
by name. A message without a subject is confirmed before sending.

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
`userData/drafts/<id>/`) and inline pictures.

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
con nome" and "Salva tutti" write where the user chooses. The copies are
measured and emptied in Settings → Dati and dropped on every upgrade.

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

SIEVER Mail's agent (`src/main/ai/`). It is not a chatbot beside the mail:
it works on the mail itself — searches and reads it, reads attachments and
the user's files, writes drafts in the composer the user writes in, files
messages — and keeps notes on what it learns. Several activities run side
by side, each with its state on the panel (`features/segretario/`, ⌘J).

**The key is the user's.** There is no server of ours: the Segretario calls
[OpenRouter](https://openrouter.ai/) with the user's own key, given in
Settings → Segretario, checked there (`/api/v1/key` and `/api/v1/credits`:
unknown, without credit, at its limit) and kept encrypted with
`safeStorage` like the accounts' passwords. It is checked again every 20
minutes while the app runs. What every call cost (`usage.cost`) is
recorded, and Settings shows today's and this month's spending.

**The model is not a setting.** Requests go to the alias of the newest
DeepSeek Flash (`~deepseek/deepseek-flash-latest`), so a new checkpoint is
used as soon as it ships, with a routing policy rather than a named
provider: only endpoints with zero data retention that do not train on the
data, the cheapest of those fast enough (`PROVIDER_POLICY` in
`openrouter.ts`). A `session_id` per activity keeps it on one provider, so
the prompt cache holds. Answers stream; rate limits and outages are retried
before the first token, and every error reaches the user in their words.

**The harness is plain.** `SegretarioService` gives the model its goal,
its tools and what the user is looking at, and lets it work: no workflow,
no classifier, no rules the model could follow better on its own. What it
keeps for itself is what cannot be left to the model:

- nothing leaves without the user: `invia_bozza` asks, the panel shows the
  draft as it will go, and the send goes through the composer like any
  other, with its checks;
- files are read, never written; mail is never deleted for good;
- the conversation is rebuilt every turn from the activity's event log
  (`ai_events`, `agent/conversation.ts`), so an activity survives a restart
  and an unfinished step is answered as interrupted;
- the size of what the model reads: past 60 000 tokens old tool results are
  cleared (the eight newest kept), past 140 000 the older part of the
  activity is summarised (`compattazione.md`).

The context the model starts from — the date, the accounts, its notes —
sits in the first message, so the cached prefix stays the same through an
activity. The model names what it found by short handles (`m4` a message,
`f2` a file, `b1` a draft, `agent/handles.ts`), which the panel turns into
links.

**Its words are text files.** Every prompt — the system prompt, the
context block, each tool's description, the summary, the title — is a
Markdown file in Italian under `src/main/ai/prompts/`, bundled with `?raw`.
An extension adds its own (see [Extensions](#extensions)).

**Tools** (`src/main/ai/tools/`): `cerca_posta` (the full-text index, every
account, by folder, sender, date), `panoramica` (who the user writes to,
who writes to them and how often they answer, month by month, counted from
the envelopes, `mail-overview.ts`), `leggi_posta` (a message or its whole
conversation, quoted history left out), `leggi_allegato` and `leggi_file`
(PDF, Word, spreadsheets, presentations, OpenDocument, mail, text and
pictures, through `extraction.ts`, a part at a time), `cerca_file` (by name,
in the home folder and the mounted volumes), `scrivi_bozza` (the renderer
opens the composer as for a reply, a forward or a new message, with the
text written in; the draft is kept and filed in Bozze like the user's
own), `invia_bozza`, `organizza` (archive, move, read, flag, Trash),
`memoria` (its notes: read, write, edit, rename, delete), `argomenti` (the
topics in corso or searched, one read with where it stands, what is open
and its conversations, a conversation filed as the user asks; `a1` names
a topic and opens its list), `impegni` (what is open across the mail, the
most pressing first, narrowed by kind, date or topic; one closed) and
`mostra` (opens a message, a draft or a search on screen).

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

**Memory** is a set of notes the model keeps itself (`ai_memory`): who the
user is (`tu.md`), how they write (`stile.md`), each account, people,
matters. The two core notes and the index of the others come with every
activity, with each account's signature; the model reads and updates the
rest as it works. A note may not carry an activity's short names (`m4`):
the memory tool sends such a text back.

**Triage.** Every message of the last two weeks, in each account's inbox
and sent mail, gets a note once its text is indexed: one quick call
without reasoning, held to a JSON schema (`triage.ts`, `smistamento.md`),
with the account's note, the notes on the people involved, what is
already open in the conversation and the conversation up to the message.
A conversation in a pratica — filed in its topic, or naming it in the
subject — also gets what is open in the topic's other conversations (the
latest 20), may close those, and is not to open the same obligation again
in other words; for that judgement the call reasons briefly. Conversations
go in lanes (`triageLanes`): those of one topic in one lane, read one after
the other in the order they began, so what one opens the next sees; the
others each in their own, three lanes at once. Within a conversation the
messages go in the order they were written, so what one opens a later one
can close; an answer that does not hold the schema is asked for again at
once, before the next message. A network or OpenRouter failure ends the
round and the next one, 20 seconds later, tries again. The
note shows in the row in the Segretario's colour — "Rispondi · entro 30
ott" and the gist — and at the top of the reader as "Il punto", with what is
open to tick off and "Segna come gestito". It can be switched off in
Settings → Segretario.

**Alerts that matter.** With "Solo ciò che conta" on (Settings →
Notifiche, the default) and the Segretario reading new mail, a new message
is not announced as it arrives: it waits for its note, and only one that
asks something of the user and matters — a reply or an action of high
priority, a reply of medium — gets an alert, saying what the note says. A
note that has not come within ten minutes, or the Segretario stopping
(the key failing, triage turned off), lets what waited be announced as it
is (`NotificationManager.setSegretarioReading`, `noteWritten`).

**Replies prepared ahead.** For a conversation whose latest message waits
on the user's answer and matters (to answer, medium or high priority), the
Segretario writes the reply after triage, one at a time
(`ready-drafts.ts`, `risposta-pronta.md`): the conversation, the notes on
the user, their style and the people involved, and up to three of the
user's own replies to the same person, so the voice is theirs. It stays a
proposal in "Il punto" — "Usa questa risposta" opens it in the composer as
a reply, recorded like the Segretario's other drafts so the user's edits
are learnt from; "Scarta" sets it aside. Both can be switched off.

Reminders are prepared the same way (`sollecito.md`): where the user's own
last message waits for something past the date it was due — or three days,
without one — and no more than a month, a short follow-up in the user's
voice to whom they wrote, shown as "Sollecito pronto". Whatever was
prepared for a message is retired once a later message of its
conversation is read: the user answered from the phone, the reply came.

**Writing together.** In the composer, ⌘J (or the "Segretario" button
beside "Allega") asks it to write the reply, or to rewrite what is written —
shorter, more formal, corrected, in English, or in the user's own words.
One call (`scrittura.md`) with the conversation answered, the user's notes
and style and the people written to; what comes back takes the place of
the lines above the signature and the quote (`replaceWrittenPart`), with
"Annulla" to put them back, and is kept as the Segretario's draft so the
user's later edits are learnt from.

**Asking the mail in words.** In any list's search field, ⌘↵ (or the
star beside it) hands what is typed — "l'offerta di Gallo per i gruppi
frigo, con il pdf" — to the Segretario: one quick call
(`ask-mail.ts`, `chiedi-alla-posta.md`) makes it the search tool's own
parameters (words, folder, account, period, unread, attachments), the
full-text search runs over every account, and the result opens as a list
of the Segretario's (`segretarioSearchPath`), titled with what was sought
and how. The latest twenty are kept for the session.

**Rereading before it goes.** With "Rileggi prima di inviare" on (Settings
→ Segretario, the default), pressing Invia has the Segretario reread the
message in one quick call (`review.ts`, `revisione.md`): the message as it
will go, the one it answers, and the next weeks' days with their weekdays.
It flags only what the user would want to fix — an attachment named and
not attached, a question skipped, a greeting to someone not among the
recipients, a weekday that does not match its date, a figure that
contradicts the message answered, a "[data]" left to fill — in a panel at
the button, with "Correggi" and "Invia comunque". Nothing found, it goes;
a reread not done within eight seconds never holds it. What the Segretario
sends after the user confirmed on its card is not reread again.

**Oggi** is the page the workspace opens on when the Segretario is set up,
in the place of the list and the reader (`today-page.tsx`, the layout's
`page`). It is made of the notes and what is open: what is due today or
overdue, this week, who waits on the user, the replies prepared, what the
user waits on — each line opens its message. At the top, a few lines the
Segretario writes from the same material (`oggi.md`), kept in
`ai_briefings` with the lines they were written from: while triage still
has mail to read (the first launch, after a holiday) the page says so and
waits; once read, it writes; opened again after new lines came, it writes
again, and while open it says how many came since, with "Aggiorna".

**Views.** "Da gestire" holds the conversations whose latest note asks a
reply or an action and was not handled, or where something the user owes
is open; "In attesa" those where the user waits on someone; "Risposte
pronte" those with a reply prepared. Their paths
(`segretarioViewPath`) open like a folder of "Tutti gli account": the
main process resolves each conversation to one row, in the folder the user
thinks of it in, never Spam or the Trash, and the list shows exactly those.

**The same message in two accounts** — CC'd to both of the user's
addresses, a team mailbox's copy — is read once: triage finds it by its
Message-ID among the accounts it looks after, and copies the note of the
copy already read (`twin_account_id`), opening nothing; two copies come to
be read together, one waits for the other. The copy stays out of the
views, Oggi and the prepared replies, files its conversation in the same
topic, gives no second alert, and says in the reader where it is followed.

**Topics** (`topic-store.ts`, `ai_topics` / `ai_topic_threads`): the
lasting matters the mail is about — a job, a negotiation; in a company's
build, the pratiche of its archive, which the extension lists
(`ExtensionAssistant.topics`, called "Pratiche" there). Triage files each
conversation into one as it reads it (`argomento` in the schema), against a
catalogue in its system prompt: the topics in corso — joined lately, or
among the extension's hundred most recent — each with a line on what it is
about (`gist`, written from its conversations once they exist and again as
they double, `argomento-in-breve.md`), so a supplier's offer that never
names the client still finds its job. The others keep their key and come
with the conversation that names them: the extension gives each pratica
the names mail uses ("Prat2451", "pratica n. 2451", the client), compared
case, accents and punctuation aside (`topic-names.ts`). A conversation that
names one pratica alone goes there, whatever the model guessed; a "new"
topic whose title names one is that one; a topic the Segretario made and
the extension later brings — the job got its folder — is folded into it.
The user moves a conversation from the reader ("Cambia", which also makes
a new topic) and that choice is kept, and what both topics are about is
learnt again; a topic the Segretario made, left empty, goes. Noise is never
filed. In every other list each row shows its conversation's topic as a
tag — a pratica by its number (`conversation-topics.ts`). Each topic opens as a list, like a view, of every message of
its conversations (`segretarioTopicPath`), under "Il punto" — where it
stands, written by the Segretario when the topic moved since
(`argomento.md`), and what is open in it. The sidebar lists the busiest
eight and searches the rest. With the extension, ARCHIVIA SIEVER opens on
the pratica the conversation is in (`ExtensionSelectionContext.topicKey`).

**Archived, still followed.** An extension that files messages outside the
mail before taking them out of it — ARCHIVIA SIEVER, into a pratica, then
the Trash — says so (`ExtensionMainContext.messagesArchived`), and the
Segretario keeps it (`ai_archived`): what is open in those conversations
stays in Oggi and the views, found in the Trash while it keeps them, and
the reader says where they went ("Archiviata in Prat2451 › CORRISPONDENZA",
with the folder a click away).

For tuning the prompts, `SIEVER_AI_TRACE=<folder>` writes every call's
messages and answer there, a JSON line each; it is off unless set.

**Learning** is work the Segretario begins itself, once the user has said
yes (the panel asks; Settings → Cosa so di te switches it):

- **Conoscerti**, one activity per account (`conoscerti.md`), begins once
  the account's mail has arrived and its last 90 days are indexed. The
  model decides how to read — usually `panoramica`, then the sent mail
  and the conversations that matter — and leaves the account's note,
  `tu.md`, `stile.md`, people and matters, then tells the user what it
  understood so they can correct it. An account added later gets its
  own; one removed takes its note with it, and the next reflection hears
  of it.
- **Reflection** (`riflessione.md`): every draft the Segretario writes is
  kept (`ai_drafts`); when it goes out, the composer reports what the user
  wrote above the signature (`writtenText`), and the difference becomes a
  lesson. At most every six hours, with corrections waiting and no request
  of the user's running, a quiet activity turns them into rules in the
  notes.

Settings → Cosa so di te shows how far each account has got (with
"Rifai"), and every note, to read, correct or forget.

## Calendar

The calendars of the user's accounts (`src/main/calendar/`, `shared/calendar.ts`).
A Google account's is connected from Settings → Account, "Collega il
calendario": Google's own window asks for the calendar scope
(`https://www.googleapis.com/auth/calendar`) on the account already
chosen (`login_hint`, incremental with `include_granted_scopes`), and the
token it gives is kept for the calendar alone (`calendar_accounts`,
encrypted) — the account's mail never depends on it, and disconnecting
forgets it here without touching the grant.

**Sync.** The calendars the user shows in Google Calendar are read
(`calendarList`), and each one's events as single instances, from two
months back to a year ahead, into `calendar_events`; then every five
minutes only what changed, with the sync token Google gives (deleted
events included; a 410 starts over), and from the start again as the
window's end comes within six months. A provider is an interface
(`CalendarProvider`): Google's is `google-calendar.ts`; Microsoft 365's
(Graph `/me/calendarView` with delta) takes the same shape once Microsoft
accounts sign in with OAuth — an Azure app registration with
`Calendars.ReadWrite`, `IMAP.AccessAsUser.All` and `SMTP.Send`.

**Where it shows.** "Agenda" in the sidebar, two weeks a day at a time;
"In agenda" at the top of Oggi, and the day's events in what its opening is
written from; an invitation in a message (its `.ics`, `ics.ts`) at the top
of the reader, answered there — Partecipo, Forse, Non partecipo — through
the API, the organizer told. The Segretario's `calendario` tool lists the
agenda, creates an event and answers an invitation, each after the user
confirms on its card; an event has a short name (`e1`) the panel links to
the agenda.

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

| Surface                                     | What it does                                                                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `ExtensionMain.install(context)`            | Runs once after the engine starts: DDL, IPC handlers, startup work.                                                                         |
| `ExtensionMain.clearData()`                 | Deletes its data, as part of "Elimina tutti i dati".                                                                                        |
| `ExtensionMain.uninstall()`                 | Optional; called when the app quits.                                                                                                        |
| `ExtensionMain.defaultAccountSignatureHtml` | Signature given to the first account added. Empty in the public build.                                                                      |
| `ExtensionMain.accountSignatureRevision`    | Edition of that content; stored signatures on an older one — and accounts without one — are handed, once, to `upgradeAccountSignatureHtml`. |
| `ExtensionMain.assistant.systemPrompt`      | What the Segretario must know of the company the build is for; joins every prompt that reads the mail, after the host's.                    |
| `ExtensionMain.assistant.topics`            | The company's lasting matters (pratiche), the most recent first, with the names mail uses for them: the Segretario files mail into them.    |
| `ExtensionMain.assistant.tools`             | Tools the Segretario gets after the host's, given its short names resolved to messages and a confirmation asked on its card.                |
| `ExtensionMain.assistant.topicsLabel`       | What those are called in the sidebar and the prompts ("Pratiche"); "Argomenti" in the public build.                                         |
| `ExtensionRenderer.toolbarActions`          | Buttons first in the reading pane's header, given the selection.                                                                            |
| `ExtensionRenderer.settingsTabs`            | Tabs after the host's in Settings.                                                                                                          |
| `ExtensionRenderer.PrimaryActionDialog`     | A dialog the host mounts and opens on request.                                                                                              |
| `ExtensionRenderer.fontFaceCss`             | `@font-face` rules for bundled fonts, applied to the app and every message frame.                                                           |
| `ExtensionRenderer.localDataLabel`          | How the data `clearData()` removes reads in Settings.                                                                                       |
| `ExtensionComposition` (shared)             | Fonts, default font, text colours and extra font stacks the composer offers.                                                                |
| `ExtensionPreloadInstaller`                 | Methods merged onto `window.mailApi`.                                                                                                       |

`install()` receives an `ExtensionMainContext`: `app`, `ipcMain`, the user
data path, a database handle (`applyDdl`, `query`, `execute`) on the host's
connection, a mail engine handle, `getMainWindow()`, `recordRecentFiles()`,
`adoptShortcutOverride()`, `topicsChanged()` — called when what
`assistant.topics()` lists changed, so the Segretario reads it again then —
and `messagesArchived()`, for messages filed outside the mail before they
leave it.
The selection handed to toolbar actions and the primary dialog carries
`topicKey`, the extension topic its conversations are filed in, and
`filedIn`, the subfolder of that topic's folder their earlier messages went
into — or, for a new conversation, the one its sender's mail goes to in
that topic — and ARCHIVIA SIEVER opens on both. The engine handle gives raw messages in bulk
— `fetchMessageRawSources(refs, onMessage)` downloads a few per command and
hands each on while the next arrive — and `moveMessagesToTrash(refs)`, one
command per folder. Renderer surfaces get `ExtensionHostHooks`:
`optimisticallyRemoveMessages(refs, action)` takes the rows out of the list
at once and puts back the ones the action reports failed, as the host's
own Archivia does. Main-side extension code may also import the host's
helpers, such as `ensurePathReachable` and `writeUniqueFile`.

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

The packaged app reads the Google OAuth client from a `.env` in its
resources. `build.mjs` writes it (`.env.runtime`) from the local `.env`,
keeping only the variables the app reads (`RUNTIME_ENV_KEYS`): a
developer's own keys never ship.

`.github/workflows/release.yml` runs the targets in parallel on `v*` tags
and publishes a GitHub Release.

## Security

- `contextIsolation: true`, `nodeIntegration: false`; the preload exposes
  only the typed bridge, and navigation is limited to the app's own page.
- Incoming HTML is sanitised with DOMPurify and shown in sandboxed frames.
- Secrets pass through `safeStorage`; without an OS keychain they are not
  stored.
- The window's session grants only the clipboard write; camera,
  microphone, location and every other web permission are refused.
- External links open in the browser only if they are `http(s)`.
- Opened attachments never execute; Windows marks them as downloaded.
- The Segretario sends nothing without the user's confirmation, never
  deletes mail for good and only reads files. Mail and files are data to
  it, never instructions (its system prompt says so, and it reports what
  looks like an attempt). It talks only to OpenRouter, with the user's key,
  and only to providers that keep no data.

## License

Apache License 2.0. See [`LICENSE`](../LICENSE).

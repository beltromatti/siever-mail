# SIEVER Mail — Technical Documentation

How SIEVER Mail is put together: the processes, the data, the mail engine,
the interface and the extension surface. It is written for engineers who
read, debug or extend the code. The code comments go deeper on each piece;
this page is the map.

## Stack

| Layer       | Technology                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| Shell       | [Electron](https://www.electronjs.org/) 44 (macOS 13+, Windows 10+ x64, Linux)                         |
| Bundler     | [electron-vite](https://electron-vite.org/) + Vite                                                     |
| UI          | [React 19](https://react.dev/) + TypeScript, [Tailwind CSS v4](https://tailwindcss.com/), Radix/shadcn |
| Local store | SQLite through [Prisma 7](https://www.prisma.io/) and its `better-sqlite3` adapter                     |
| Mail        | [imapflow](https://imapflow.com/) (IMAP), [nodemailer](https://nodemailer.com/) (SMTP), mailparser     |
| Gmail       | OAuth 2.0 over IMAP/SMTP (XOAUTH2); no Gmail HTTP API                                                  |
| Editor      | [Squire](https://github.com/fastmail/Squire), inside a sandboxed iframe                                |
| Lists       | [TanStack Virtual](https://tanstack.com/virtual) for the endless message list                          |
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
3. `MailService.start()` — the notification preferences and the icon badge
   are applied, the mounted network shares remembered (see
   [Network shares](#network-shares)), and the mail engine connects the
   accounts.
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
│   ├── app-menu.ts            macOS menu bar (Italian); none elsewhere
│   ├── context-menu.ts        native menus for text, links, pictures, spelling
│   ├── theme.ts               Sistema / Chiaro / Scuro → nativeTheme
│   ├── ipc/register-mail-ipc.ts   every IPC handler
│   ├── services/
│   │   ├── mail-service.ts    façade the IPC layer calls
│   │   ├── database.ts        Prisma client, raw DDL, queries
│   │   ├── data-migration.ts  upgrade lifecycle
│   │   ├── mail-engine/       connections, sync, sending, parsing, notifications
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
│   │                          composer, editor), settings, workspace
│   ├── components/ui/         shared primitives (dialog, confirm, menus…)
│   ├── lib/                   selection, sections, HTML pipelines, zoom
│   └── styles/globals.css     Tailwind entry and the theme tokens
├── shared/                    types, commands and shortcuts, search grammar, folder
│                              roles, address parsing, fonts, sender/subject keys
└── extension/                 the extension contract and its no-op stubs
```

## Data

One SQLite file, `userData/siever-mail.sqlite`. The schema is declared in
`prisma/schema.prisma` and applied at boot with raw
`CREATE TABLE IF NOT EXISTS` plus additive column checks in `database.ts`,
so an older file is brought forward in place.

| Table                | Holds                                                                                                                                                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accounts`           | IMAP and Gmail accounts; `encrypted_secret` is the password or OAuth token, encrypted with `safeStorage`.                                                                                                                                    |
| `folders`            | Folder metadata and sync cursors (UIDVALIDITY, HIGHESTMODSEQ, UIDNEXT, last UID). _Cache._                                                                                                                                                   |
| `messages`           | Envelopes, previews, flags, body cache. Denormalised `sender_label` / `sender_sort` / `subject_sort` let the database sort and group by sender or subject, and the folded `search_*` columns let it search without case or accents. _Cache._ |
| `contacts`           | Everyone stored mail names, for the composer's suggestions: `usage_count` / `last_used_at` count the mail written to them, `last_received_at` the newest they sent, `hidden_at` a contact taken out of the suggestions.                      |
| `account_signatures` | One signature per account, with the version of the page it was written for (`html_format`) and the edition of the extension's content it has (`extension_revision`).                                                                         |
| `recent_files`       | Files the user attached, saved or an extension filed away, offered first in "Allega".                                                                                                                                                        |
| `recent_folders`     | The folders each account's messages were last moved to, offered first by "Sposta".                                                                                                                                                           |
| `app_preferences`    | One row: theme, layout, list order, sort, grouping, reader zoom, "Dettagli", shortcut overrides, the accounts "Tutti gli account" gathers, the notification preferences, the extension signature edition every account has joined.           |

Beside the database, `network-volumes.json` remembers the URL each network
share was mounted from (macOS).

An extension may add tables through the database handle it receives; they
live in the same file and connection. The host never reads them.

"Elimina tutti i dati" (Settings → Dati) empties everything but the
accounts and the preferences, then calls the extension's `clearData()`. Clearing one account's data drops its cache and the copies
of its attachments, and keeps its signature; the mail downloads again.

### Upgrades

`data-migration.ts` treats the two kinds of rows oppositely. **Cache**
(`messages`, `folders`, attachment copies) is rebuilt from the server, so a
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
with two IMAP clients, so what the user does never waits behind a sync:

- **primary** — what the user does (read, move, flag, delete, download),
  one command at a time, and IDLE on the folder on screen (or the inbox),
  so its changes arrive as they happen;
- **sync** — first downloads, catch-up, previews, the messages read ahead
  and the server side of a search, in a queue ordered by priority (`user`,
  then `active-sync`, then `background`): a search jumps the queue, a
  background folder waits.

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
chunks of 500 UIDs.

**Search** runs locally on the folded `search_*` columns, and — for what
those cannot see, the full text — as `IMAP SEARCH` on the server, one per
group of the query, intersected (`server-search.ts`); the matches it finds
join the list. A newer search replaces one still waiting.

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
  message is never reported as failed because that copy is late.
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
field, quotes keep a phrase, `OR` joins alternatives. The full text of
messages whose body is not downloaded is searched on the server (see
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
what that media query reports. Components only use the tokens. Message
bodies stay on a white page in both themes, as they were written.

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

The composer (`features/mail/mail-composer-dialog.tsx`) runs Squire in an
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
| `ExtensionRenderer.toolbarActions`          | Buttons after "Nuovo messaggio", given the selection.                                                                                       |
| `ExtensionRenderer.settingsTabs`            | Tabs after the host's in Settings.                                                                                                          |
| `ExtensionRenderer.PrimaryActionDialog`     | A dialog the host mounts and opens on request.                                                                                              |
| `ExtensionRenderer.fontFaceCss`             | `@font-face` rules for bundled fonts, applied to the app and every message frame.                                                           |
| `ExtensionRenderer.localDataLabel`          | How the data `clearData()` removes reads in Settings.                                                                                       |
| `ExtensionComposition` (shared)             | Fonts, default font, text colours and extra font stacks the composer offers.                                                                |
| `ExtensionPreloadInstaller`                 | Methods merged onto `window.mailApi`.                                                                                                       |

`install()` receives an `ExtensionMainContext`: `app`, `ipcMain`, the user
data path, a database handle (`applyDdl`, `query`, `execute`) on the host's
connection, a mail engine handle, `getMainWindow()`, `recordRecentFiles()`
and `adoptShortcutOverride()`. The engine handle gives raw messages in bulk
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

## License

Apache License 2.0. See [`LICENSE`](../LICENSE).

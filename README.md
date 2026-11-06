<div align="center">
  <img src="resources/icon.png" alt="SIEVER Mail" width="160" />
  <h1>SIEVER Mail</h1>
  <p><strong>A personal operating system for work: mail, calendar and files at par, kept in order by one secretary.</strong></p>
  <p>
    <img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" />
    <img alt="Platforms" src="https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey" />
    <img alt="Stack" src="https://img.shields.io/badge/stack-Electron%20%7C%20React%20%7C%20TypeScript-success" />
    <img alt="Status" src="https://img.shields.io/badge/status-active%20development-orange" />
  </p>
  <p><sub>personal work OS · mail · calendar · files · AI secretary · IMAP · Google and Microsoft OAuth · CalDAV · cross-platform · open source</sub></p>
</div>

---

## What SIEVER Mail is

SIEVER Mail is a **personal operating system for work** — and for the rest
of life — built for people with a lot to keep track of. Its apps are
peers: **Posta** (mail), **Calendario** (calendars) and, soon, **File**
(the computer's volumes, network shares and cloud drives) each bring their
objects from their own connections; **Contatti** and **Progetti** gather
what the sources hold without owning any of it; **Oggi** is the desk where
one agent, the **Segretario**, keeps the user's work in order across all of
them. No source is the centre: an open thing, a project, a proposal can
come from a message, an event or the user's word, and a new source — chat,
calls — slots in the same way. It works as a set of plain, fast apps
without AI; with AI on, it gets intelligent. The name is still the mail
client's it grew from, and will change.

## Why SIEVER Mail exists

SIEVER Mail was born as a tightly-focused desktop email client for a small
engineering team that needed something **fast, predictable and out of the way**
of their daily work. The team was tired of bloated, tracker-laden mail clients
where opening a single message turns a workstation into a fan-noise demo, and
of web-based UIs that ship a second-rate experience for power users with many
accounts and folders.

The core idea is simple: rebuild a classic mail client from scratch on a
modern stack — small, snappy, native-feeling, with one screen that respects
the screen real estate and one mental model the user already knows. Multiple
IMAP / Gmail accounts, a unified inbox, smooth conversation list, real
keyboard shortcuts, no telemetry, no ads, no surprises.

The internal version of the application carried company-specific extensions
that were not relevant outside the original deployment. **This public release
is the same client with those extensions removed**: clean, generic, ready for
anyone to fork or self-host.

## Disclaimer about the name

The product name "SIEVER Mail" is a historical artifact from the project's
origin. **The Italian limited liability company "SIEVER S.R.L." is unrelated
to this open-source project.** It does not develop, maintain, distribute,
endorse or otherwise sponsor the published client; it cannot be held liable
for anything related to it. The project is now an independent piece of
open-source software released under the Apache License 2.0.

## Highlights

- **A secretary that keeps your work** — the Segretario reads every
  message as it arrives, and the last thirty days when you start; it looks
  at the calendar when others change it, and reads your files when the work
  leads there. What is asked of you and by when, what you promised, what
  you are waiting for, what a meeting needs, what you told it to remember:
  each is one open thing, wherever it comes from, with its story — done,
  not needed, put off to a day, reopened — and your word wins over its
  guesses. It gathers conversations, events and folders into the projects
  they belong to and keeps "Il punto" of each. Your day opens on **Oggi**, written in
  its hand; **Da gestire**, **In attesa** and **Risposte pronte** are views
  it keeps for you, and an "Attivi" filter narrows any list.
- **Work done ahead** — replies to what matters and reminders for what is
  late are written before you ask, in your style; meetings come with what
  to know before them; a message is reread as it goes (the attachment you
  mention, the question left open, the weekday that does not match the
  date); alerts come only for what matters, saying what it wants.
- **Ask it anything, or ask the mail** — in its panel it searches and reads
  every message, attachment and file on your computer, writes and fixes
  drafts in the composer you use, schedules, files and tidies — nothing is
  sent without your confirmation. In any search field, ask in words
  ("le offerte di Gallo da settembre, con il pdf") and keep the answer as a
  folder that searches again each time it opens. In the composer, ⌘J
  writes the reply or rewrites what you selected.
- **On its own, it only proposes** — the work it does by itself never
  reaches anyone: it does not send, invite, archive or move mail, it leaves
  you a proposal one click away. A diary shows what it did, each change
  with its undo.
- **It learns you, and keeps up** — it gets to know your connections in
  Conoscimi, with you watching; learns from how you correct its drafts and
  its work; and keeps up with the mail that arrives: who people are, how
  you write to them. Every note is yours to read, correct, restore or
  forget. It is off until you turn it on in the guided setup, runs on your
  own [OpenRouter](https://openrouter.ai/) key, only through providers that
  keep no data, and you see what it costs.
- **Every source its own connection** — mail, calendars and (soon) files
  are families of connections at par, in one tab. Google, Microsoft 365 and
  Outlook.com, iCloud, and any IMAP mailbox (PEC included), its servers
  found from the address as Thunderbird finds them; calendars from Google,
  Microsoft, any CalDAV server or a published link, each connected with or
  without its mail. "Tutti gli account" gathers the inbox, sent mail,
  drafts, archive, spam and trash of every account, whatever each server
  calls them, and each account shows its folders as a tree. Every message
  is acted on from its own account: replies, forwards and moves never
  cross over unasked.
- **A calendar at par with the mail** — the Calendario shows every
  connected calendar by day, week, month or agenda, with the deadlines of
  every open thing and the events the Segretario proposes; search events by
  words, past and future; draw an event on the grid, drag it to move it,
  drive it from the keyboard. Each event shows what the Segretario keeps of
  it: its preparation, the open things born from it, its projects. An
  invitation in a message is answered from whichever calendar holds it, or
  by mail to its organizer.
- **Fast where it is felt** — a message opens at once, the next ones are
  read ahead, a large one shows before its attachments arrive; a new
  account shows its first screen in a moment; the list is endless and
  keeps the selected message in view. Changes are found with one command
  per check, and only what changed is downloaded.
- **Built for triage** — sort by date, sender, subject or size, group
  automatically or by sender, filter to unread or flagged, select a group,
  the rows loaded or the whole folder, and act on it in one command.
  Drag messages onto a folder, or find one with "Sposta" as you type; a
  folder can be created on the way. Search ignores case and accents,
  narrows with `da:` `a:` `oggetto:`, searches the full text of every
  message in a local index, and says where it looked.
- **A composer that knows people** — recipients are chips, checked before
  sending, pasted lists split into people, names resolved from the
  contacts. Suggestions put the people you write to first and leave out
  the typos. Attachments open from the composer to be checked.
- **Drafts that never get lost** — what you write is kept as you type and
  filed in the account's Bozze, so Gmail, Outlook and the phone have it;
  drafts from any client open here to be finished. Write several messages
  at once: the ones put aside wait in the bottom right corner, each exactly
  as you left it.
- **Mail that arrives as it was written** — the composer shows a message
  exactly as it will be received, and sending writes that layout onto the
  message so Outlook's Word engine and every other client keep it.
- **Attachments that behave** — open with the default application, save one
  or all, attach from the files recently used on the computer, or drop them
  onto the composer. A forward carries the original's attachments and a
  reply offers them. Signature logos and quoted pictures stay part of the
  message instead of posing as attachments.
- **Notifications worth having** — new mail with sender, subject and
  preview, buttons to mark it read or archive it, alerts that go away once
  the mail is read anywhere, and the unread count on the Dock or taskbar
  icon. All of it set in Settings → Notifiche.
- **Your keyboard, your menus** — every command has a shortcut, changeable
  in Settings → Scorciatoie, and right clicks open native menus on
  messages, folders, people, attachments, links and text.
- **Network folders that just work** — a share a restart left unmounted is
  mounted again (macOS) or reconnected (Windows) when it is needed.
- **Light, dark or the system's** — one set of colour tokens, two palettes;
  "Sistema" follows the computer as it switches. Two layouts, _Apple_ and
  _Outlook_, with the same features.
- **Sync you can trust** — changes are pushed by the server, reconnection is
  automatic, and "Sincronizzato" is only shown when it is true. An
  operation the server refuses is reported, never pretended.
- **Private by construction** — everything lives in a local SQLite database;
  credentials go through the OS keychain via Electron's `safeStorage`. No
  telemetry, no third-party tracking.
- **Upgrade-safe** — a new version rebuilds only the message cache. Accounts,
  calendar connections, signatures, preferences, contacts, the Segretario's
  work and any extension's data are kept, and an update interrupted halfway
  is recovered on the next launch.

## Roadmap

2.0 turns the client into a personal operating system: the Segretario — one
agent woken by an engine, over a record of your work — and sources at par,
each with connections of its own: Google, Microsoft, iCloud, CalDAV,
published calendars and any IMAP mailbox. Next: the File app with file
connections (the computer's volumes, network shares, Google Drive, OneDrive
and SharePoint, Dropbox, iCloud Drive), then the Projects and Contacts apps
— all three already on the rail as "In arrivo" —, a new name, accessibility
passes, localisation beyond Italian, and performance budgets for very large
mailboxes.

## Quick start

Prerequisites: Node.js 22+, npm 10+.

```bash
git clone https://github.com/<your-fork>/siever-mail.git
cd siever-mail
cp .env.example .env   # the Google and Microsoft OAuth clients, for their sign-ins
npm install
npm run dev
```

Google's sign-in needs an OAuth client of type "Desktop app"; Microsoft's
(Microsoft 365, Outlook.com) an app registered in Microsoft Entra as a
public client, its id in `MICROSOFT_OAUTH_CLIENT_ID` — the redirect URI and
the permissions are in `.env.example` and in
[docs/DOCUMENTATION.md](docs/DOCUMENTATION.md#connections). A client left
out only turns its sign-in off.

Production builds live behind a single script:

```bash
node build.mjs 1.0.0                    # mac arm64 + win x64 (default)
node build.mjs 1.0.0 --target=macos-x64 # single explicit target
node build.mjs 1.0.0 --all              # full matrix incl. Linux via Docker
```

A GitHub Actions workflow at `.github/workflows/release.yml` runs the same
script in parallel on macOS, Windows and Linux runners whenever a `v*` tag
is pushed, then publishes the artifacts as a GitHub Release.

## Extensions

SIEVER Mail ships with a small **extension surface** that lets a custom
fork plug in features — toolbar actions, commands, settings tabs, a
primary-action dialog, IPC handlers and tables of its own, fonts and
colours for the composer, a default account signature it can keep up to
date in the signatures already stored, and for the Segretario: what it
must know of the company, tools of its own, proposals it carries out, and
copies of messages saved outside the mail — without touching the public
source tree. The host loads exactly one extension at build time through four Vite
aliases:

- `@app/extension/main` — main-process entry (install, IPC, tables, data reset, the Segretario's instructions and tools)
- `@app/extension/renderer` — renderer entry (toolbar actions, commands, settings tabs, dialog, proposal actions, bundled fonts)
- `@app/extension/preload` — preload bridge additions on `window.mailApi`
- `@app/extension/shared` — loaded by both: the composer's fonts and colours, the commands

In the public source the aliases resolve to **no-op stubs** under
`src/extension/`, so the open-source build never imports any extension
code beyond those stubs. The contract lives in
[`src/extension/types.ts`](src/extension/types.ts); see
[docs/DOCUMENTATION.md](docs/DOCUMENTATION.md#extensions) for the full
description.

If you want to develop the host with a custom extension attached
locally, drop the extension repo at `extension/` (the path the Vite
aliases look at — gitignored in the host repo) and run:

```bash
npm run dev:ext   # equivalent to LOAD_EXTENSION=1 npm run dev
```

`npm run dev` keeps loading the no-op stubs as before, so you can
switch back to a clean public build at any time without changing files.

## Documentation

- **[docs/DOCUMENTATION.md](docs/DOCUMENTATION.md)** — architecture and
  implementation reference (startup, data and upgrades, connections, mail
  engine, interface, mail content, the Segretario, the calendar, extension
  points, build).
- **[docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)** — issue policy, support
  channels and how the maintainer handles external contributions.

## Status

The application is **in active development**. It is already fast, stable and
usable as a daily-driver mail and calendar client; the surface area is
being polished release after release. The data layout may change between
versions — the upgrade-safe migration is designed exactly for that, and the
Segretario's tables carry a schema version of their own, migrated in
place.

It runs on macOS 13 Ventura or later (Apple silicon and Intel), Windows 10
and 11 (64-bit) and Linux desktops.

## License

Apache License 2.0. See the [LICENSE](LICENSE) file for the full text.

---

<sub>Authored and maintained by <a href="mailto:beltromatti@gmail.com">Mattia Beltrami</a>. Issues welcome at the GitHub tracker.</sub>

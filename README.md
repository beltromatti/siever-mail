<div align="center">
  <img src="resources/icon.png" alt="SIEVER Mail" width="160" />
  <h1>SIEVER Mail</h1>
  <p><strong>A fast, modern, lightweight desktop email client.</strong></p>
  <p>
    <img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" />
    <img alt="Platforms" src="https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey" />
    <img alt="Stack" src="https://img.shields.io/badge/stack-Electron%20%7C%20React%20%7C%20TypeScript-success" />
    <img alt="Status" src="https://img.shields.io/badge/status-active%20development-orange" />
  </p>
  <p><sub>desktop email client · IMAP · Gmail OAuth · cross-platform · open source</sub></p>
</div>

---

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

- **Multi-account by design** — IMAP/SMTP and Gmail OAuth side by side, with
  a unified inbox (TUTTI) that tags each message with its account and acts
  on it from that account: replies, forwards and moves never cross over
  unasked.
- **Snappy native feel** — keyboard navigation and selection the way
  Finder and Explorer do it, precise truncation, no jank on resize, an
  Italian menu bar on macOS.
- **Light, dark or the system's** — one set of colour tokens, two palettes;
  "Sistema" follows the computer as it switches.
- **Two layouts, one product** — an _Apple_ arrangement (folders, list and
  reading pane side by side) and an _Outlook_ one (dense sortable table on
  top, message underneath). Same features in both.
- **Built for triage** — sort by date, sender, subject or size, group
  automatically or by sender, filter to unread or flagged, select a whole
  group with one click and act on it in bulk. Search finds a sender by
  typing part of the name; `da:` `a:` `oggetto:` narrow a term to one field.
- **Mail that arrives as it was written** — the composer shows a message
  exactly as it will be received, and sending writes that layout onto the
  message so Outlook's Word engine and every other client keep it.
- **Attachments that behave** — open with the default application, save one
  or all, attach from the files recently used on the computer, or drop them
  onto the composer. Signature logos and quoted pictures stay part of the
  message instead of posing as attachments.
- **Sync you can trust** — changes are pushed by the server, reconnection is
  automatic, and "Sincronizzato" is only shown when it is true. An
  operation the server refuses is reported, never pretended.
- **Private by construction** — everything lives in a local SQLite database;
  credentials go through the OS keychain via Electron's `safeStorage`. No
  telemetry, no third-party tracking.
- **Upgrade-safe** — a new version rebuilds only the message cache. Accounts,
  signatures, preferences, contacts and any extension's data are kept, and
  an update interrupted halfway is recovered on the next launch.

## Roadmap

The current focus is **stabilising the public client** — accessibility passes,
localisation, performance budgets, automated tests. Once that baseline is in
place, the next major chapter is opt-in **AI features** built directly into
the client: smart triage, summaries, draft assistance, and similar
assistive workflows that respect the existing local-only data model.

## Quick start

Prerequisites: Node.js 22+, npm 10+.

```bash
git clone https://github.com/<your-fork>/siever-mail.git
cd siever-mail
cp .env.example .env   # fill in Google OAuth credentials if you want Gmail
npm install
npm run dev
```

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
fork plug in features — toolbar actions, settings tabs, a primary-action
dialog, IPC handlers and tables of its own, fonts and colours for the
composer, a default account signature — without touching the public source
tree. The host loads exactly one extension at build time through four Vite
aliases:

- `@app/extension/main` — main-process entry (install, IPC, tables, data reset)
- `@app/extension/renderer` — renderer entry (toolbar actions, settings tabs, dialog, bundled fonts)
- `@app/extension/preload` — preload bridge additions on `window.mailApi`
- `@app/extension/shared` — loaded by both: the composer's fonts and colours

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
  implementation reference (startup, data and upgrades, mail engine,
  interface, mail content, extension points, build).
- **[docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)** — issue policy, support
  channels and how the maintainer handles external contributions.

## Status

The application is **in active development**. It is already fast, stable and
usable as a daily-driver mail client; the surface area is being polished
release after release. The data layout may change between versions while
the 1.x baseline settles — the upgrade-safe migration is designed exactly
for that.

## License

Apache License 2.0. See the [LICENSE](LICENSE) file for the full text.

---

<sub>Authored and maintained by <a href="mailto:beltromatti@gmail.com">Mattia Beltrami</a>. Issues welcome at the GitHub tracker.</sub>

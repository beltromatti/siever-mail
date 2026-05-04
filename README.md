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
  a unified inbox and per-account folder hierarchies.
- **Snappy native feel** — the mail list, viewer and tree pickers are tuned
  to behave like a native client (precise truncation, keyboard navigation,
  real focus rings, no jank on resize).
- **Real rich-text composer** — Squire-based editor with proper line-height,
  paste sanitisation and signature handling.
- **Background sync that doesn't poll** — server-pushed change events keep
  the UI live without burning battery or hammering the server.
- **Encrypted credentials at rest** — passwords and OAuth refresh tokens
  pass through the OS keychain via Electron's `safeStorage`.
- **Local-only data** — everything lives in a SQLite database on the user's
  machine. No remote analytics, no third-party tracking.
- **Upgrade-safe migrations** — moving between versions automatically wipes
  stale local state while keeping saved logins, so a new version always
  starts from a clean schema without forcing you to redo your accounts.

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
script in parallel across `macos-latest`, `macos-13`, `windows-latest` and
`ubuntu-latest` whenever a `v*` tag is pushed, then publishes the artifacts
as a GitHub Release.

## Extensions

SIEVER Mail ships with a small **extension surface** that lets a custom
fork plug in features — toolbar actions, settings tabs, a primary-action
dialog, IPC handlers, custom DDL, default account signature — without
touching the public source tree. The host loads exactly one extension at
build time through three Vite aliases:

- `@app/extension/main` — main-process entry (IPC + DDL + signature override)
- `@app/extension/renderer` — renderer entry (toolbar actions, settings tabs, dialog)
- `@app/extension/preload` — preload bridge additions on `window.mailApi`

In the public source the aliases resolve to **no-op stubs** under
`src/extension/`, so the open-source build never imports any extension
code beyond those stubs. The contract lives in
[`src/extension/types.ts`](src/extension/types.ts); see
[docs/DOCUMENTATION.md](docs/DOCUMENTATION.md#extension-system) for the
full description, including the path/env var any custom build is
expected to provide its own extension at.

If you want to develop the host with a custom extension attached
locally, drop the extension repo at `private-siever/` (the path the
Vite aliases look at) and run:

```bash
npm run dev:ext   # equivalent to LOAD_EXTENSION=1 npm run dev
```

`npm run dev` keeps loading the no-op stubs as before, so you can
switch back to a clean public build at any time without changing files.

The historical context: SIEVER Mail was first developed as an internal
tool for the Italian engineering company **SIEVER S.R.L.**. The
company-specific customisations no longer live anywhere in this
repository — they were lifted into a separate, private extension owned
by the maintainer.

## Documentation

- **[docs/DOCUMENTATION.md](docs/DOCUMENTATION.md)** — architecture and
  implementation reference (stack, processes, data flow, IPC, extension
  points).
- **[docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)** — issue policy, support
  channels and how the maintainer handles external contributions.

## Status

The application is **in active development**. It is already fast, stable and
usable as a daily-driver mail client; the surface area is being polished
release after release. Breaking changes between versions are possible while
the 1.x baseline settles — the upgrade-safe migration system is designed
exactly for that.

## License

Apache License 2.0. See the [LICENSE](LICENSE) file for the full text.

---

<sub>Authored and maintained by <a href="mailto:beltromatti@gmail.com">Alessandro Beltrami</a>. Issues welcome at the GitHub tracker.</sub>

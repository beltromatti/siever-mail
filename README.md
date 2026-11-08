<div align="center">
  <img src="resources/icon.png" alt="SIEVER Mail" width="160" />
  <h1>SIEVER Mail</h1>
  <p><strong>Your mail, your calendar and your files, kept in order by a secretary that knows your work.</strong></p>
  <p>
    <img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" />
    <img alt="Platforms" src="https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey" />
    <img alt="Status" src="https://img.shields.io/badge/status-active%20development-orange" />
  </p>
</div>

---

## A personal operating system for work

You have a lot to keep track of: messages, meetings, documents, people, many matters at once. SIEVER Mail brings them together in one place — **Posta**, **Calendario** and, soon, **File**, apps at par, each with its own connections — and gives you a **Segretario**: one assistant that reads, follows and prepares your work across all of them, so that nothing slips and your head stays free for what only you can do.

Without AI, SIEVER Mail is a set of fast, honest apps for mail and calendars. With AI on, it becomes intelligent.

## What it does for you

**Your day, already sorted.** Each morning **Oggi** opens on a short letter about your day: what matters most and why, who is waiting for you, what is due this week, the meetings ahead. Below it, everything still open — what you were asked, what you promised, what you are waiting for, what you have to do — wherever it came from: a message, an event, or a word you said.

**A secretary that knows your work.** It reads every message as it arrives and writes a line beside it: what it wants from you, and how much it matters. It looks at your calendar as events appear and change. It gathers conversations, events and folders into your **projects** — named the way you name them — and keeps "Il punto" of each: where things stand, in a few lines.

**Work done before you ask.** Replies to what matters, written in your style and waiting in the reader. Reminders for what is late. A briefing before each meeting. A last look at every message as you send it: the attachment you mention, the question left unanswered, the weekday that does not match the date.

**It learns you, and you can read what it knows.** In _Conoscimi_ it gets to know your connections while you watch; then it learns from how you correct it. Everything it remembers is a note you can read, correct, restore or forget.

**On its own, it only proposes.** Nothing reaches anyone without you: it does not send, invite or move your mail by itself — it leaves you a proposal, one click away. A diary shows everything it did, each change with its undo.

**Ask it anything.** In its panel it searches every message, attachment and file, drafts and fixes replies, schedules and tidies. In any search field, ask in words — _"the offers from Gallo since September, with the pdf"_ — and keep the answer as a folder. In the composer, ⌘J writes the reply for you.

**Every source, connected properly.** Google, Microsoft 365 and Outlook.com, iCloud, any IMAP mailbox, certified mail (PEC) read for what it is; calendars from Google, Microsoft, any CalDAV server or a published link. One dot tells you how all of them stand.

**A client that is fast where it is felt.** Messages open at once; the list is endless and smooth; search covers the full text of every message; drafts are never lost and live in your server's Drafts; a message arrives exactly as you wrote it; every command has a shortcut you can change.

**Private by construction.** Your data stays on your computer, in a local database; passwords and tokens in the system keychain. The AI runs on your own [OpenRouter](https://openrouter.ai/) key, only through providers that keep no data, and you always see what it costs. No telemetry, no tracking.

## Made to measure

SIEVER Mail is for everyone, and works on its own: it learns how you work from what it sees, whatever your job.

When an organisation wants it shaped around the way it works — its conventions, its archive, its own actions — SIEVER Mail takes a **private extension**, written for that organisation and named after it. The Segretario starts already knowing how things are done there; the app gains the buttons and tools that work needs. Nothing of what SIEVER Mail is changes: it is completed. To have one for your organisation, get in touch with the developers.

## The vision

Where SIEVER Mail is going, and why it works the way it does: **[docs/vision.md](docs/vision.md)** (in Italian).

Next: the **File** app and file connections — the computer's volumes, network shares, Google Drive, OneDrive and SharePoint, Dropbox, iCloud Drive —, then **Progetti** and **Contatti**, a new name, and languages beyond Italian.

## Get it

SIEVER Mail runs on macOS 13 Ventura or later (Apple silicon and Intel), Windows 10 and 11 (64-bit) and Linux. Installers are published with each release on GitHub.

To run it from source (Node.js 22+):

```bash
git clone https://github.com/beltromatti/siever-mail.git
cd siever-mail
cp .env.example .env   # the Google and Microsoft sign-in clients
npm install
npm run dev
```

## Contributing

Issues are welcome; see **[docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)** for how the project takes feedback.

## About the name

The name "SIEVER Mail" comes from the project's origin, and will change. **The Italian company "SIEVER S.R.L." does not develop, maintain, distribute, endorse or sponsor this open-source project**, and cannot be held liable for anything related to it.

## License

Apache License 2.0 — see [LICENSE](LICENSE).

---

<sub>Made by <a href="mailto:beltromatti@gmail.com">Mattia Beltrami</a>.</sub>

#!/usr/bin/env node
// Empirical audit of the preview parser against the live SQLite database.
//
// For every message with a stored body (html_body / text_body), re-run the
// NEW extractor on a synthetic ParsedMail object and report: which previews
// improved, which still carry suspicious patterns, which regressed.
//
// For every message without a stored body, scan the existing preview (produced
// by the OLD parser) for suspicious patterns so we can quantify how many bad
// previews currently live in the inbox — that guides what we still need to fix.
//
// Run with:  node scripts/audit-preview.mjs [sample-size]

import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { existsSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

// ---- Build the preview extractor via esbuild so we run the current TS source ----
// We emit inside the project's scripts/ dir so `mailparser` resolves through the
// project's node_modules hierarchy. The file is cleaned up at exit.
const projectRoot = new URL('..', import.meta.url).pathname
const outFile = join(projectRoot, 'scripts', '.preview.audit.generated.mjs')
const esbuild = await import('esbuild')
await esbuild.build({
  entryPoints: [join(projectRoot, 'src', 'main', 'services', 'mail-engine', 'preview.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  external: ['mailparser'],
  outfile: outFile
})
process.on('exit', () => {
  try {
    rmSync(outFile)
  } catch {
    // ignore
  }
})
const { extractPreview } = await import(outFile)

void dirname

// ---- Locate DB ----
const dbPath =
  process.argv[3] ||
  join(homedir(), 'Library', 'Application Support', 'siever-mail', 'siever-mail.sqlite')

if (!existsSync(dbPath)) {
  console.error('DB non trovato:', dbPath)
  process.exit(1)
}

const db = new DatabaseSync(dbPath, { readOnly: true })

// ---- Quality heuristics: flag suspicious preview patterns ----
//
// Heuristics err on the side of precision over recall — we only flag things
// a human would immediately label as "broken preview" looking at an inbox.
// A lone in-sentence URL is NOT bad; a URL-dominant preview is.
const PATTERN_CHECKS = [
  { id: 'html-tag-leading', test: (p) => /^\s*<\s*(?:!doctype|html|head|meta|style|body|!--)/i.test(p) },
  { id: 'angle-bracket-leak', test: (p) => /<[a-z!][^>]{0,200}>/i.test(p) },
  {
    id: 'url-dominant',
    test: (p) => {
      if (!p) return false
      const urls = p.match(/https?:\/\/\S+|www\.\S+/gi) || []
      if (urls.length === 0) return false
      const urlChars = urls.reduce((s, u) => s + u.length, 0)
      return urlChars / p.length > 0.35 || /^\s*https?:\/\//i.test(p)
    }
  },
  { id: 'decorative-asterisks', test: (p) => /\*{3,}/.test(p) },
  { id: 'decorative-dashes', test: (p) => /-{4,}/.test(p) },
  { id: 'decorative-dots', test: (p) => /\.{4,}/.test(p) },
  { id: 'markdown-link', test: (p) => /\[[^\]]*\]\([^)]*\)/.test(p) },
  { id: 'empty-anchor', test: (p) => /\(\s*#+\s*\)/.test(p) },
  {
    id: 'too-short',
    test: (p) => {
      const words = p.match(/[A-Za-zÀ-ÿ]{3,}/g) || []
      return p.length >= 1 && words.length < 2
    }
  }
]

function classify(preview) {
  const flags = []
  for (const { id, test } of PATTERN_CHECKS) {
    if (test(preview)) {
      flags.push(id)
    }
  }
  return flags
}

// ---- Pass 1: scan stored previews across the whole corpus ----
console.log('═══════════════════════════════════════════════════════════════')
console.log('PASS 1 — stored previews (all messages, old parser output)')
console.log('═══════════════════════════════════════════════════════════════')

const total = db.prepare('SELECT COUNT(*) AS n FROM messages').get().n
const counts = Object.fromEntries(PATTERN_CHECKS.map((p) => [p.id, 0]))
let cleanCount = 0

const examples = Object.fromEntries(PATTERN_CHECKS.map((p) => [p.id, []]))

for (const row of db.prepare('SELECT subject, preview FROM messages').all()) {
  const flags = classify(row.preview || '')
  if (flags.length === 0) {
    cleanCount += 1
    continue
  }
  for (const flag of flags) {
    counts[flag] += 1
    if (examples[flag].length < 3) {
      examples[flag].push({ subject: row.subject, preview: (row.preview || '').slice(0, 160) })
    }
  }
}

console.log(`Totale messaggi: ${total}`)
console.log(`Puliti: ${cleanCount} (${((cleanCount / total) * 100).toFixed(1)}%)`)
console.log(`Con pattern sospetti:`)
for (const { id } of PATTERN_CHECKS) {
  const n = counts[id]
  if (n === 0) continue
  console.log(`  ${id.padEnd(25)} ${String(n).padStart(5)}  (${((n / total) * 100).toFixed(1)}%)`)
  for (const ex of examples[id]) {
    console.log(`    ├─ [${ex.subject?.slice(0, 50) || '?'}]`)
    console.log(`    │   ${ex.preview}`)
  }
}

// ---- Pass 2: re-run new parser on messages with stored body ----
console.log('')
console.log('═══════════════════════════════════════════════════════════════')
console.log('PASS 2 — re-parsing messages with stored body via new extractor')
console.log('═══════════════════════════════════════════════════════════════')

const sampleSize = Number(process.argv[2]) || Number.POSITIVE_INFINITY
const bodied = db
  .prepare(
    `SELECT subject, preview, text_body AS textBody, html_body AS htmlBody
     FROM messages
     WHERE (text_body IS NOT NULL AND text_body <> '') OR (html_body IS NOT NULL AND html_body <> '')
     ORDER BY RANDOM()
     LIMIT ?`
  )
  .all(Number.isFinite(sampleSize) ? sampleSize : 100000)

console.log(`Messaggi con body disponibile: ${bodied.length}`)

let improved = 0
let unchanged = 0
let regressed = 0
let stillBadNew = 0
const beforeAfter = []

for (const row of bodied) {
  const parsed = { text: row.textBody ?? '', html: row.htmlBody ?? '' }
  const oldPreview = row.preview || ''
  const newPreview = extractPreview(parsed, row.subject || '')
  const oldFlags = classify(oldPreview)
  const newFlags = classify(newPreview)

  if (newFlags.length > 0) stillBadNew += 1

  if (oldFlags.length > 0 && newFlags.length === 0) improved += 1
  else if (oldFlags.length === 0 && newFlags.length > 0) regressed += 1
  else if (oldPreview === newPreview) unchanged += 1
  else beforeAfter.push({ subject: row.subject, oldPreview, newPreview, oldFlags, newFlags })
}

console.log(`Migliorati: ${improved}`)
console.log(`Peggiorati: ${regressed}`)
console.log(`Nuovi ancora con pattern sospetti: ${stillBadNew}`)
console.log(`Identici: ${unchanged}`)
console.log(`Cambiamenti senza regressione/improvement netto: ${beforeAfter.length}`)

console.log('')
console.log('── Esempi di cambiamento ──')
for (const { subject, oldPreview, newPreview, oldFlags, newFlags } of beforeAfter.slice(0, 10)) {
  console.log(`[${subject?.slice(0, 60) || '?'}]`)
  console.log(`  OLD${oldFlags.length ? ` (${oldFlags.join(',')})` : ''}: ${oldPreview.slice(0, 140)}`)
  console.log(`  NEW${newFlags.length ? ` (${newFlags.join(',')})` : ''}: ${newPreview.slice(0, 140)}`)
}

// ---- Pass 2b: re-feed every stored preview through the NEW parser as if it
// were HTML content. This lets us verify how the new parser behaves on the
// real-world signals captured in 13k+ stored previews, not just the 15 that
// happen to have a cached body. Also doubles as a dry-run of a preview
// migration that could be applied to clean stale DB rows without a resync. ----
console.log('')
console.log('═══════════════════════════════════════════════════════════════')
console.log('PASS 2b — feeding every stored preview to the new extractor')
console.log('═══════════════════════════════════════════════════════════════')

const everyRow = db.prepare('SELECT subject, preview FROM messages').all()
const migrationImproves = []
let migrationCleanCount = 0
let migrationNoChange = 0
let migrationRegressed = 0
let migrationStillBad = 0
const migrationFlagTally = Object.fromEntries(PATTERN_CHECKS.map((p) => [p.id, 0]))

for (const row of everyRow) {
  const oldPreview = row.preview || ''
  const oldFlags = classify(oldPreview)
  // Treat the stored preview as if it were HTML — if it is raw HTML, it gets
  // stripped; if it is plain text, it passes through largely unchanged.
  const candidate = extractPreview({ html: oldPreview, text: '' }, row.subject || '')
  const newFlags = classify(candidate)

  if (oldFlags.length === 0 && newFlags.length === 0) {
    migrationNoChange += 1
  } else if (oldFlags.length > 0 && newFlags.length === 0) {
    migrationCleanCount += 1
    if (migrationImproves.length < 10) {
      migrationImproves.push({ subject: row.subject, oldPreview, candidate, oldFlags })
    }
  } else if (oldFlags.length === 0 && newFlags.length > 0) {
    migrationRegressed += 1
  } else if (newFlags.length > 0) {
    migrationStillBad += 1
    for (const flag of newFlags) migrationFlagTally[flag] += 1
  }
}

console.log(
  `Stored previews scanned: ${everyRow.length}` +
    `  ·  migration cleaned: ${migrationCleanCount}` +
    `  ·  unchanged+clean: ${migrationNoChange}` +
    `  ·  still bad after migration: ${migrationStillBad}` +
    `  ·  regressed: ${migrationRegressed}`
)
console.log('Flags still present after migration:')
for (const { id } of PATTERN_CHECKS) {
  const n = migrationFlagTally[id]
  if (n === 0) continue
  console.log(`  ${id.padEnd(25)} ${String(n).padStart(5)}`)
}
console.log('── Esempi di preview risanate dalla migration ──')
for (const { subject, oldPreview, candidate, oldFlags } of migrationImproves) {
  console.log(`[${subject?.slice(0, 60) || '?'}] fixed=${oldFlags.join(',')}`)
  console.log(`  OLD: ${oldPreview.slice(0, 140)}`)
  console.log(`  NEW: ${candidate.slice(0, 140)}`)
}

console.log('')
console.log('── Esempi di ciò che resta too-short dopo migration ──')
let shown = 0
for (const row of everyRow) {
  if (shown >= 20) break
  const candidate = extractPreview({ html: row.preview || '', text: '' }, row.subject || '')
  const flags = classify(candidate)
  if (flags.length === 1 && flags[0] === 'too-short') {
    console.log(`[${row.subject?.slice(0, 60) || '?'}]`)
    console.log(`  OLD: ${(row.preview || '').slice(0, 120)}`)
    console.log(`  NEW: ${candidate.slice(0, 120)}`)
    shown += 1
  }
}

// ---- Pass 3: list remaining bad-new previews so we know what to fix ----
const remainingBad = []
for (const row of bodied) {
  const parsed = { text: row.textBody ?? '', html: row.htmlBody ?? '' }
  const newPreview = extractPreview(parsed, row.subject || '')
  const flags = classify(newPreview)
  if (flags.length > 0) {
    remainingBad.push({ subject: row.subject, preview: newPreview, flags })
  }
}

console.log('')
console.log('═══════════════════════════════════════════════════════════════')
console.log(`PASS 3 — previews new-parser ancora problematiche: ${remainingBad.length}`)
console.log('═══════════════════════════════════════════════════════════════')
for (const { subject, preview, flags } of remainingBad.slice(0, 30)) {
  console.log(`[${subject?.slice(0, 60) || '?'}] flags=${flags.join(',')}`)
  console.log(`  ${preview.slice(0, 180)}`)
}

db.close()
console.log('')
console.log('Done.')

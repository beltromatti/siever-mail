#!/usr/bin/env node
// Random-sample inspection of parser output on real DB emails.
//
// For each sampled message: print the real input the parser sees (preferring
// `text_body` / `html_body` when available, falling back to the stored 200-char
// preview) and the new-parser output. The script always requests a fresh
// random sample on each run, so iterating surfaces different sender templates.
//
//   node scripts/audit-preview-random.mjs [sample-size=25]

import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

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
    /* ignore */
  }
})
const { extractPreview } = await import(outFile)

const dbPath =
  process.argv[3] ||
  join(homedir(), 'Library', 'Application Support', 'siever-mail', 'siever-mail.sqlite')

if (!existsSync(dbPath)) {
  console.error('DB non trovato:', dbPath)
  process.exit(1)
}

const sampleSize = Number(process.argv[2]) || 25
const db = new DatabaseSync(dbPath, { readOnly: true })

// Prefer rows that have at least one of {text_body, html_body} so the parser
// sees the full content mailparser originally produced. Fall back to all rows
// if we need more than the bodies we have.
const withBodies = db
  .prepare(
    `SELECT subject, from_json AS fromJson, preview, text_body AS textBody, html_body AS htmlBody
     FROM messages
     WHERE (text_body IS NOT NULL AND text_body <> '') OR (html_body IS NOT NULL AND html_body <> '')
     ORDER BY RANDOM()
     LIMIT ?`
  )
  .all(sampleSize)

const remaining = sampleSize - withBodies.length
const additional =
  remaining > 0
    ? db
        .prepare(
          `SELECT subject, from_json AS fromJson, preview,
                  NULL AS textBody,
                  preview AS htmlBody
           FROM messages
           WHERE preview IS NOT NULL AND preview <> ''
           ORDER BY RANDOM()
           LIMIT ?`
        )
        .all(remaining)
    : []

const rows = [...withBodies, ...additional]

function shorten(value, max) {
  const v = String(value ?? '')
  if (v.length <= max) return v
  return `${v.slice(0, max)}… [+${v.length - max} chars]`
}

function parseFrom(fromJson) {
  try {
    const list = JSON.parse(fromJson || '[]')
    if (!Array.isArray(list) || list.length === 0) return '?'
    const first = list[0]
    return first?.name || first?.address || '?'
  } catch {
    return '?'
  }
}

console.log(`Random sample of ${rows.length} messages`)
console.log('═══════════════════════════════════════════════════════════════════════')

for (let index = 0; index < rows.length; index += 1) {
  const row = rows[index]
  const parsed = {
    text: row.textBody ?? '',
    html: row.htmlBody ?? ''
  }
  const preview = extractPreview(parsed, row.subject || '')

  console.log('')
  console.log(`── [${index + 1}/${rows.length}] ${shorten(row.subject || '(no subject)', 72)}`)
  console.log(`   from:    ${shorten(parseFrom(row.fromJson), 72)}`)
  if (row.textBody) {
    console.log(`   text in: ${shorten(row.textBody.replace(/\s+/g, ' ').trim(), 260)}`)
  }
  if (row.htmlBody && !row.textBody) {
    console.log(`   html in: ${shorten(row.htmlBody.replace(/\s+/g, ' ').trim(), 260)}`)
  }
  if (!row.textBody && !row.htmlBody) {
    console.log(`   prev in: ${shorten((row.preview || '').replace(/\s+/g, ' ').trim(), 260)}`)
  }
  console.log(`   → preview: ${shorten(preview, 260)}`)
}

db.close()

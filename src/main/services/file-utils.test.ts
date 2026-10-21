import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { writeUniqueFile } from './file-utils'

describe('writeUniqueFile', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'siever-unique-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('gives files written at once under one name a name each', async () => {
    const paths = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        writeUniqueFile(directory, 'Offerta.pdf', `copia ${index}`)
      )
    )

    expect(new Set(paths).size).toBe(6)
    expect((await readdir(directory)).sort()).toEqual([
      'Offerta (1).pdf',
      'Offerta (2).pdf',
      'Offerta (3).pdf',
      'Offerta (4).pdf',
      'Offerta (5).pdf',
      'Offerta.pdf'
    ])

    const contents = await Promise.all(paths.map((path) => readFile(path, 'utf8')))
    expect(new Set(contents).size).toBe(6)
  })

  it('keeps the suffixed name within the length allowed', async () => {
    await writeUniqueFile(directory, 'Verbale di sopralluogo.pdf', 'a', { maxFileNameLength: 16 })
    const second = await writeUniqueFile(directory, 'Verbale di sopralluogo.pdf', 'b', {
      maxFileNameLength: 16
    })

    expect(second.endsWith('Verbale (1).pdf')).toBe(true)
  })
})

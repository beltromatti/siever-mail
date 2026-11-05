import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { RegistryRefusal, type Actor } from '../registry/types'
import { ensureAiSchema } from '../schema'
import { memorySql } from '../testing/memory-sql'
import { normalizeMemoryPath, Notebook } from './notebook'

const RUN_A: Actor = { by: 'segretario', runId: 'a' }
const RUN_B: Actor = { by: 'segretario', runId: 'b' }

describe('Notebook', () => {
  let sql: ReturnType<typeof memorySql>
  let notebook: Notebook

  beforeEach(async () => {
    sql = memorySql()
    await ensureAiSchema(sql)
    notebook = new Notebook(sql)
  })

  afterEach(() => sql.close())

  it('maps the memory small: a folder of many notes in one line, opened on demand', async () => {
    await notebook.write('tu.md', '# Chi sei\n', RUN_A)

    for (let index = 1; index <= 13; index += 1) {
      await notebook.write(`persone/p${index}.md`, `# Persona ${index}\n`, RUN_A)
    }

    await notebook.write('progetti/hotel.md', '# Hotel Lido\n', RUN_A)

    const map = await notebook.index()

    expect(map).toContain('- tu.md — Chi sei')
    expect(map).toContain('- progetti/hotel.md — Hotel Lido')
    expect(map).toMatch(/- persone\/ — 13 note \(le ultime toccate: /)
    expect(map).not.toContain('persone/p1.md')
    expect(await notebook.folder('persone/')).toContain('- persone/p1.md — Persona 1')
    expect(await notebook.folder('clienti')).toBeNull()
  })

  it('takes a passage copied with the spaces of a numbered reading as the passage', async () => {
    await notebook.write(
      'connessioni.md',
      '# Caselle\n- Account Apple Developer\n  - rinnovo annuale\n',
      RUN_A
    )

    await notebook.edit(
      'connessioni.md',
      [
        {
          old: '  - Account Apple Developer',
          new: '  - Account Fineco\n  - Account Apple Developer'
        }
      ],
      RUN_A
    )

    expect((await notebook.read('connessioni.md'))?.content).toBe(
      '# Caselle\n- Account Fineco\n- Account Apple Developer\n  - rinnovo annuale\n'
    )
    // An indented line found as written stays as written.
    await notebook.edit(
      'connessioni.md',
      [{ old: '  - rinnovo annuale', new: '  - rinnovo a novembre' }],
      RUN_A
    )
    expect((await notebook.read('connessioni.md'))?.content).toContain('\n  - rinnovo a novembre\n')
  })

  it('names the notes most like one that is not there', async () => {
    await notebook.write('progetti/prat2492-malagoli.md', '# Prat2492 · Acetaia Malagoli\n', RUN_A)
    await notebook.write('stile.md', '# Come scrive\n', RUN_A)

    const said = await notebook.missing('progetti/prat2492-acetaia-malagoli.md')

    expect(said).toContain('progetti/prat2492-malagoli.md (Prat2492 · Acetaia Malagoli)')
    expect(said).not.toContain('stile.md')
  })

  it('lets two runs edit different lines of the same note, both landing', async () => {
    await notebook.write('tu.md', '# Chi sei\n- Lavori in SIEVER\n- Abiti a Milano\n', RUN_A)

    await notebook.edit(
      'tu.md',
      [{ old: 'Lavori in SIEVER', new: 'Lavori in SIEVER, ufficio tecnico' }],
      RUN_A
    )
    await notebook.edit(
      'tu.md',
      [{ old: 'Abiti a Milano', new: 'Abiti a Milano (studentato)' }],
      RUN_B
    )

    expect((await notebook.read('tu.md'))?.content).toBe(
      '# Chi sei\n- Lavori in SIEVER, ufficio tecnico\n- Abiti a Milano (studentato)\n'
    )
    expect((await notebook.read('tu.md'))?.revision).toBe(3)
  })

  it('applies a patch all or nothing', async () => {
    await notebook.write('stile.md', '# Stile\nCiao\nA presto\n', RUN_A)

    await expect(
      notebook.edit(
        'stile.md',
        [
          { old: 'Ciao', new: 'Buongiorno' },
          { old: 'Cordiali saluti', new: 'A presto' }
        ],
        RUN_A
      )
    ).rejects.toThrow(/non compare/)
    expect((await notebook.read('stile.md'))?.content).toBe('# Stile\nCiao\nA presto\n')
  })

  it('refuses a whole rewrite made on an old reading, and keeps every version', async () => {
    const { document } = await notebook.write('persone/anna.md', '# Anna\nCliente\n', RUN_A)
    await notebook.edit('persone/anna.md', [{ old: 'Cliente', new: 'Cliente storica' }], RUN_B)

    await expect(
      notebook.write('persone/anna.md', '# Anna\nFornitrice\n', RUN_A, {
        seenRevision: document.revision
      })
    ).rejects.toBeInstanceOf(RegistryRefusal)

    const history = await notebook.history('persone/anna.md')
    expect(history.map((version) => version.revision)).toEqual([2, 1])

    const restored = await notebook.restore('persone/anna.md', 1, { by: 'utente' })
    expect(restored).toMatchObject({
      content: '# Anna\nCliente\n',
      revision: 3,
      updatedBy: 'utente'
    })
  })

  it('inserts after a line, and finds lines by their words', async () => {
    await notebook.write('progetti/lido.md', '# Hotel Lido\nCliente: Rossi\n', RUN_A)
    await notebook.insert('progetti/lido.md', 1, 'Pratica 2470', RUN_A)

    expect((await notebook.read('progetti/lido.md'))?.content).toBe(
      '# Hotel Lido\nPratica 2470\nCliente: Rossi\n'
    )
    expect(await notebook.search('rossi')).toEqual([
      { path: 'progetti/lido.md', line: 3, text: 'Cliente: Rossi' }
    ])
  })

  it('keeps paths inside the notebook', () => {
    expect(normalizeMemoryPath('/memoria/persone\\anna')).toBe('persone/anna.md')
    expect(() => normalizeMemoryPath('../segreto')).toThrow(RegistryRefusal)
  })
})

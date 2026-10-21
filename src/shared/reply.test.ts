import { describe, expect, it } from 'vitest'

import { replyRecipients, replyReferences, type RepliedMessage } from './reply'

const ME = new Set(['a.beltrami@siever.it', 'alessandro.beltrami@ingpec.eu'])

function message(fields: Partial<RepliedMessage>): RepliedMessage {
  return { from: [], to: [], cc: [], replyTo: [], references: [], ...fields }
}

const carbonetta = { name: 'Giuseppe Carbonetta', address: 'giuseppe.carbonetta@engie.com' }
const romagnoli = { address: 'stefano.romagnoli@ingka.ikea.com' }
const me = { name: 'A. Beltrami - SIEVER', address: 'A.Beltrami@siever.it' }
const conti = { name: 'marco conti', address: 'marco.conti.pdr@gmail.com' }
const rossi = { address: 'renzo.rossi@ingka.ikea.com' }

describe('replyRecipients', () => {
  it('answers the sender, or the address they asked replies to go to', () => {
    expect(replyRecipients(message({ from: [carbonetta], to: [me] }), ME, 'sender')).toEqual({
      to: [carbonetta],
      cc: []
    })

    const list = { address: 'lista@cantiere.it' }
    expect(
      replyRecipients(message({ from: [carbonetta], replyTo: [list], to: [me] }), ME, 'sender').to
    ).toEqual([list])
  })

  it('answers everyone else, keeping To and Cc, never the user under any address', () => {
    const replied = message({
      from: [carbonetta],
      to: [romagnoli, me, conti],
      cc: [rossi, { address: 'alessandro.beltrami@ingpec.eu' }, carbonetta]
    })

    expect(replyRecipients(replied, ME, 'all')).toEqual({
      to: [carbonetta, romagnoli, conti],
      cc: [rossi]
    })
  })

  it('answers a message the user sent to the people it went to', () => {
    const sent = message({ from: [me], to: [conti, romagnoli], cc: [rossi] })

    expect(replyRecipients(sent, ME, 'sender')).toEqual({ to: [conti, romagnoli], cc: [] })
    expect(replyRecipients(sent, ME, 'all')).toEqual({ to: [conti, romagnoli], cc: [rossi] })
  })

  it('sends a note to self back to self', () => {
    expect(replyRecipients(message({ from: [me], to: [me] }), ME, 'all')).toEqual({
      to: [me],
      cc: []
    })
  })
})

describe('replyReferences', () => {
  it('appends the answered message to the thread, once each', () => {
    expect(
      replyReferences(message({ references: ['<a@x>', '<b@x>', '<a@x>'], messageId: '<c@x>' }))
    ).toEqual(['<a@x>', '<b@x>', '<c@x>'])
  })

  it('keeps the first message and the latest ones of a long thread', () => {
    const references = Array.from({ length: 30 }, (_, index) => `<${index}@x>`)
    const chain = replyReferences(message({ references, messageId: '<last@x>' }))

    expect(chain).toHaveLength(20)
    expect(chain[0]).toBe('<0@x>')
    expect(chain.at(-1)).toBe('<last@x>')
  })
})

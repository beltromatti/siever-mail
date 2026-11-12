import { describe, expect, it } from 'vitest'

import { descriptionParts } from './description-text'

describe('an event’s description, as words and links', () => {
  it('finds the links of plain text, the web’s and Markdown’s', () => {
    expect(
      descriptionParts(
        'Ordine del giorno: https://brenta.it/odg.pdf.\nMappa: [Casa al mare](https://maps.example.com/casa)\nVedi www.acme-srl.it'
      )
    ).toEqual([
      { text: 'Ordine del giorno: ' },
      { text: 'https://brenta.it/odg.pdf', href: 'https://brenta.it/odg.pdf' },
      { text: '.\nMappa: ' },
      { text: 'Casa al mare', href: 'https://maps.example.com/casa' },
      { text: '\nVedi ' },
      { text: 'www.acme-srl.it', href: 'https://www.acme-srl.it' }
    ])
  })

  it('reads the HTML a calendar’s editor writes as a page would show it, never as markup', () => {
    expect(
      descriptionParts(
        '<b>Sopralluogo</b> con Rossi<br>Porta i documenti:<ul><li>planimetria</li><li>contratto</li></ul><a href="https://brenta.it/pratica">la pratica</a><script>alert(1)</script>'
      )
    ).toEqual([
      { text: 'Sopralluogo con Rossi\nPorta i documenti:\n• planimetria\n• contratto\n' },
      { text: 'la pratica', href: 'https://brenta.it/pratica' }
    ])
  })

  it('keeps a link only where it may lead: the web, a mail address, a phone', () => {
    expect(
      descriptionParts(
        '<a href="javascript:alert(1)">qui</a> e <a href="mailto:rossi@brenta.it">Rossi</a>'
      )
    ).toEqual([{ text: 'qui e ' }, { text: 'Rossi', href: 'mailto:rossi@brenta.it' }])
  })

  it('shows Markdown’s escapes and strong marks as the words they mark', () => {
    expect(descriptionParts('**Importante**: porta il badge\\_ospite')).toEqual([
      { text: 'Importante: porta il badge_ospite' }
    ])
  })

  it('trims empty lines and spaces at the ends', () => {
    expect(descriptionParts('\n\n  Riunione\n\n\n\nAgenda  \n')).toEqual([
      { text: 'Riunione\n\nAgenda' }
    ])
    expect(descriptionParts('   ')).toEqual([])
  })
})

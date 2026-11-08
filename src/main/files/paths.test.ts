import { describe, expect, it } from 'vitest'

import { movedUnder } from './paths'

describe('movedUnder', () => {
  it('moves a folder and what is in it, nothing beside it', () => {
    const moved = movedUnder('/Volumes/Archivio/Clienti/', '/Volumes/Nuovo/Clienti')

    expect(moved('/Volumes/Archivio/Clienti')).toBe('/Volumes/Nuovo/Clienti')
    expect(moved('/Volumes/Archivio/Clienti/Rossi/251105 Offerta')).toBe(
      '/Volumes/Nuovo/Clienti/Rossi/251105 Offerta'
    )
    expect(moved('/Volumes/Archivio/Clienti2/x')).toBeNull()
    expect(moved('/Users/anna/Documenti')).toBeNull()
  })

  it('moves Windows paths by their own separator', () => {
    const moved = movedUnder('Z:\\Clienti', '\\\\nas\\archivio\\Clienti')

    expect(moved('Z:\\Clienti\\Rossi')).toBe('\\\\nas\\archivio\\Clienti\\Rossi')
    expect(moved('Z:\\ClientiVecchi')).toBeNull()
  })
})

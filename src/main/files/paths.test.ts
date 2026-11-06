import { describe, expect, it } from 'vitest'

import { movedUnder } from './paths'

describe('movedUnder', () => {
  it('moves a folder and what is in it, nothing beside it', () => {
    const moved = movedUnder('/Volumes/Archivio/Pratiche/', '/Volumes/Nuovo/Pratiche')

    expect(moved('/Volumes/Archivio/Pratiche')).toBe('/Volumes/Nuovo/Pratiche')
    expect(moved('/Volumes/Archivio/Pratiche/Prat2451-ROSSI/251105 Offerta')).toBe(
      '/Volumes/Nuovo/Pratiche/Prat2451-ROSSI/251105 Offerta'
    )
    expect(moved('/Volumes/Archivio/Pratiche2/x')).toBeNull()
    expect(moved('/Users/anna/Documenti')).toBeNull()
  })

  it('moves Windows paths by their own separator', () => {
    const moved = movedUnder('Z:\\Pratiche', '\\\\nas\\archivio\\Pratiche')

    expect(moved('Z:\\Pratiche\\Prat1')).toBe('\\\\nas\\archivio\\Pratiche\\Prat1')
    expect(moved('Z:\\PraticheVecchie')).toBeNull()
  })
})

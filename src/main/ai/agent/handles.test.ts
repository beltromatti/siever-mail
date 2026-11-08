import { describe, expect, it } from 'vitest'

import { HandleRegistry } from './handles'

describe('handles', () => {
  const registry = new HandleRegistry()
  const project = registry.name({
    kind: 'project',
    projectId: 'abc',
    title: 'Casa al mare'
  })
  const event = registry.name({ kind: 'event', eventKey: 'k', title: 'Sopralluogo' })

  it('names each thing once, by its kind', () => {
    expect(project).toBe('p1')
    expect(event).toBe('e1')
    expect(registry.name({ kind: 'project', projectId: 'abc', title: 'altro titolo' })).toBe('p1')
  })

  it('knows a name written the way a link writes it', () => {
    expect(registry.project('progetto:p1')?.projectId).toBe('abc')
    expect(registry.event(' Evento: E1 ')?.eventKey).toBe('k')
    expect(registry.project('P1')?.projectId).toBe('abc')
  })

  it('does not know a name it never gave', () => {
    expect(registry.resolve('progetto:p4')).toBeNull()
    expect(registry.resolve('x:p1')).toBeNull()
  })
})

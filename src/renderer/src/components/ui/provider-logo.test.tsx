import { cleanup, render, screen } from '@testing-library/react'
import * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { ProviderLogo, type Provider } from './provider-logo'

// The test runner compiles JSX to `React.createElement`: the components find React here.
Object.assign(globalThis, { React })

afterEach(cleanup)

const PROVIDERS: Provider[] = ['google', 'microsoft', 'icloud', 'imap', 'pec', 'caldav', 'ics']

describe('ProviderLogo', () => {
  it('draws every provider, hidden beside a name that says it, named where nothing else does', () => {
    const { container } = render(
      <>
        {PROVIDERS.map((provider) => (
          <ProviderLogo key={provider} provider={provider} />
        ))}
      </>
    )

    expect(container.querySelectorAll('svg')).toHaveLength(PROVIDERS.length)
    expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(PROVIDERS.length)
    cleanup()

    render(
      <>
        {PROVIDERS.map((provider) => (
          <ProviderLogo key={provider} provider={provider} named />
        ))}
      </>
    )

    expect(screen.getAllByRole('img').map((mark) => mark.getAttribute('aria-label'))).toEqual([
      'Google',
      'Microsoft',
      'iCloud',
      'IMAP mail',
      'PEC',
      'CalDAV',
      'Calendar from a link'
    ])
  })

  it('gives each drawing its own masks, filters and gradients, all of them found', () => {
    const { container } = render(
      <>
        <ProviderLogo provider="google" />
        <ProviderLogo provider="google" />
        <ProviderLogo provider="icloud" />
        <ProviderLogo provider="icloud" />
      </>
    )
    const ids = [...container.querySelectorAll('[id]')].map((element) => element.id)
    const references = [...container.querySelectorAll('[mask], [filter], [clip-path], [fill]')]
      .flatMap((element) =>
        ['mask', 'filter', 'clip-path', 'fill'].map((name) => element.getAttribute(name))
      )
      .flatMap((value) => /^url\(#(.+)\)$/.exec(value ?? '')?.slice(1) ?? [])

    expect(new Set(ids).size).toBe(ids.length)
    expect(references.length).toBeGreaterThan(0)
    expect(references.every((reference) => ids.includes(reference))).toBe(true)
  })

  it('keeps a brand’s own colours, and draws the kinds no brand stands for in the theme’s ink', () => {
    const { container } = render(
      <>
        <ProviderLogo provider="microsoft" className="size-5" />
        <ProviderLogo provider="imap" className="size-5" />
      </>
    )
    const [microsoft, imap] = container.querySelectorAll('svg')

    expect(
      [...microsoft.querySelectorAll('path')].map((square) => square.getAttribute('fill'))
    ).toEqual(['#F25022', '#7FBA00', '#00A4EF', '#FFB900'])
    expect(microsoft.getAttribute('class')).toContain('size-5')
    expect(imap.getAttribute('class')).toContain('text-muted-foreground')
    expect(imap.getAttribute('class')).toContain('size-5')
  })
})

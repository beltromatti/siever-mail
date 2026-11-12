import { useId } from 'react'
import { AtSign, Link2, Server, ShieldCheck, type LucideIcon } from 'lucide-react'

import { useMessages } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { defineMessages } from '@shared/i18n'

/**
 * Who a connection is with (vision §11.2): a provider with its own way in —
 * Google, Microsoft, iCloud — or a kind that is nobody's brand: a mailbox by
 * IMAP, a certified one (PEC), a CalDAV server, a calendar's link.
 */
export type Provider = 'google' | 'microsoft' | 'icloud' | 'imap' | 'pec' | 'caldav' | 'ics'

/** Each provider by its name, as the user knows it. */
export const PROVIDER_NAMES = defineMessages({
  google: { en: 'Google', it: 'Google', de: 'Google' },
  microsoft: { en: 'Microsoft', it: 'Microsoft', de: 'Microsoft' },
  icloud: { en: 'iCloud', it: 'iCloud', de: 'iCloud' },
  imap: { en: 'IMAP mail', it: 'Posta IMAP', de: 'IMAP-E-Mail' },
  pec: { en: 'PEC', it: 'PEC', de: 'PEC' },
  caldav: { en: 'CalDAV', it: 'CalDAV', de: 'CalDAV' },
  ics: { en: 'Calendar from a link', it: 'Calendario da un link', de: 'Kalender über einen Link' }
}) satisfies Record<Provider, unknown>

/** The kinds no brand stands for, in the app's own glyphs: never a made-up logo. */
const GLYPHS: Readonly<Record<'imap' | 'pec' | 'caldav' | 'ics', LucideIcon>> = {
  imap: AtSign,
  // As the PEC panel marks what is certified.
  pec: ShieldCheck,
  caldav: Server,
  ics: Link2
}

interface MarkProps {
  className: string
  /** Hidden from assistive technology, or the provider's name. */
  a11y: { 'aria-hidden': true } | { role: 'img'; 'aria-label': string }
}

/**
 * The provider's mark, the same wherever a connection shows: in the guided
 * setup, in Settings, in the Posta's and the Calendario's lists. Brand marks
 * are drawn inline as their owners draw them — no network, no files — in
 * their own colours, which their owners show on light and dark grounds
 * alike, so they need no tile in either theme (the AGENTS.md exception: a
 * colour of its own, independent of the theme). The other kinds are glyphs
 * of the app's family in the theme's ink. Sized like a Lucide icon: crisp
 * from 12 to 24 px.
 */
export function ProviderLogo({
  provider,
  named = false,
  className
}: {
  provider: Provider
  /** Says the provider's name to assistive technology: where nothing beside the mark says it. */
  named?: boolean
  className?: string
}): React.JSX.Element {
  const names = useMessages(PROVIDER_NAMES)
  const mark: MarkProps = {
    className: cn('size-4 shrink-0', className),
    a11y: named ? { role: 'img', 'aria-label': names[provider] } : { 'aria-hidden': true }
  }

  switch (provider) {
    case 'google':
      return <GoogleMark {...mark} />
    case 'microsoft':
      return <MicrosoftMark {...mark} />
    case 'icloud':
      return <ICloudMark {...mark} />
    default: {
      const Glyph = GLYPHS[provider]
      return <Glyph className={cn('text-muted-foreground', mark.className)} {...mark.a11y} />
    }
  }
}

/** An id of this drawing's own: two marks on one page must not share their masks and filters. */
function useSvgId(): (part: string) => string {
  const base = useId().replace(/[^\w-]/g, '')
  return (part) => `provider-${base}-${part}`
}

/** Google's conic gradient, as the official artwork sets it: red, blue, green, yellow, back to red. */
const GOOGLE_CONIC =
  'conic-gradient(from 90deg, #FF4641 0deg, #FF4641 4.146deg, #3186FF 39.154deg, #3186FF 72.004deg, #00A5B7 96.746deg, #0EBC5F 120.897deg, #0EBC5F 154.722deg, #6CC400 179.136deg, #FFCC00 203.588deg, #FFD314 226.915deg, #FFCC00 251.688deg, #FF6A2B 273.129deg, #FD4641 289.305deg, #FF4641 359.593deg, #FF4641 360deg)'

/** The soft lights over the conic: blue across the bar and to the right, red and pink at the top. */
const GOOGLE_LIGHTS: ReadonlyArray<React.SVGProps<SVGEllipseElement>> = [
  {
    cx: 20.0496,
    cy: 20.2413,
    rx: 5.39634,
    ry: 2.83537,
    transform: 'rotate(24.4473 20.0496 20.2413)',
    fill: '#3186FF'
  },
  { cx: 33.3538, cy: 18.2155, rx: 7.43918, ry: 3.09357, fill: '#3186FF' },
  { cx: 25.2744, cy: 16.2195, rx: 7.40854, ry: 2.37805, fill: '#FF4641' },
  { cx: 29.5427, cy: 12.9268, rx: 7.40854, ry: 2.37805, fill: '#FF5B8B' },
  { cx: 24.4817, cy: 19.878, rx: 8.5061, ry: 3.10976, fill: '#3186FF' },
  {
    cx: 25.1842,
    cy: 14.0197,
    rx: 4.53882,
    ry: 2.37805,
    transform: 'rotate(-28.6599 25.1842 14.0197)',
    fill: '#FF4641'
  }
]

/**
 * Google's «G», the gradient one that stands for all of Google since 2025,
 * from the official Sign in with Google assets, in their coordinates
 * (https://developers.google.com/identity/branding-guidelines, the
 * `signin-assets.zip` bundle): the G's shape lets through a blurred conic
 * gradient and six blurred lights. The view frames the G with the clear
 * space of a 24-unit icon.
 */
function GoogleMark({ className, a11y }: MarkProps): React.JSX.Element {
  const id = useSvgId()

  return (
    <svg viewBox="7.7866 8 24 24" fill="none" className={className} {...a11y}>
      <defs>
        <mask
          id={id('shape')}
          maskUnits="userSpaceOnUse"
          x="10"
          y="10"
          width="20"
          height="20"
          style={{ maskType: 'alpha' }}
        >
          <path
            fill="#fff"
            d="M29.3987 18.1814H19.9849V22.0445H25.3598C25.1286 23.294 24.4294 24.3596 23.3676 25.0712C22.4746 25.6716 21.3266 26.0211 19.9849 26.0211C17.3864 26.0211 15.1823 24.2666 14.3947 21.9004C14.1952 21.2989 14.0853 20.6599 14.0853 19.9983C14.0853 19.3367 14.1952 18.6966 14.3947 18.0962C15.1823 15.7311 17.3864 13.9755 19.9849 13.9755C21.4524 13.9755 22.767 14.4816 23.8039 15.4713L26.6653 12.6057C24.936 10.9908 22.6786 10 19.9849 10C16.0832 10 12.705 12.2414 11.0618 15.5076C10.383 16.8592 10 18.3834 10 19.9994C10 21.6155 10.383 23.1396 11.0618 24.4913C12.705 27.7597 16.0832 30 19.9849 30C22.6797 30 24.9485 29.1137 26.6018 27.5861C28.4887 25.8452 29.5732 23.2702 29.5732 20.2275C29.5732 19.5182 29.5131 18.835 29.3987 18.1825V18.1814Z"
          />
        </mask>
        <clipPath id={id('round')}>
          <path d="M7.25922 19.7927C7.25922 12.6759 13.0209 6.90668 20.1283 6.90668C27.2357 6.90668 32.9973 12.6759 32.9973 19.7927C32.9973 26.9094 27.2357 32.6786 20.1283 32.6786C13.0209 32.6786 7.25921 26.9094 7.25922 19.7927Z" />
        </clipPath>
        {/* One blur for every layer, its region wide enough that no layer's edge is cut. */}
        <filter
          id={id('blur')}
          filterUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="48"
          height="40"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur stdDeviation="1" />
        </filter>
      </defs>
      <g mask={`url(#${id('shape')})`}>
        <g filter={`url(#${id('blur')})`}>
          <g clipPath={`url(#${id('round')})`}>
            <foreignObject
              x="-4.3181"
              y="-4.2073"
              width="48"
              height="48"
              transform="rotate(-45 19.6819 19.7927)"
            >
              <div style={{ width: '100%', height: '100%', background: GOOGLE_CONIC }} />
            </foreignObject>
          </g>
        </g>
        {GOOGLE_LIGHTS.map((light, index) => (
          <g key={index} filter={`url(#${id('blur')})`}>
            <ellipse {...light} />
          </g>
        ))}
      </g>
    </svg>
  )
}

/**
 * Microsoft's logo, the four squares, from the official asset of the Sign
 * in with Microsoft branding guidelines, which ask for it to mean a
 * Microsoft account, personal or work
 * (https://learn.microsoft.com/entra/identity-platform/howto-add-branding-in-apps,
 * `ms-symbollockup_mssymbol_19.svg`). Its 21-unit box, with one unit more
 * around it: the squares weigh as much as the other marks.
 */
function MicrosoftMark({ className, a11y }: MarkProps): React.JSX.Element {
  return (
    <svg viewBox="-1 -1 23 23" className={className} {...a11y}>
      <path fill="#F25022" d="M1 1h9v9H1z" />
      <path fill="#7FBA00" d="M11 1h9v9h-9z" />
      <path fill="#00A4EF" d="M1 11h9v9H1z" />
      <path fill="#FFB900" d="M11 11h9v9h-9z" />
    </svg>
  )
}

/**
 * iCloud's cloud. Apple publishes it only as a picture — the icon of
 * https://www.icloud.com and its sharing image — so it is traced from
 * there: the circles fitted to its outline (the bumps either side, the big
 * one and the small one behind), and its blue, light above and deeper
 * below, sampled from it. Without the white tile of the app icon, as Apple
 * draws the cloud small; the shading of its layers goes, as it does in
 * Apple's own 32-pixel rendering.
 */
function ICloudMark({ className, a11y }: MarkProps): React.JSX.Element {
  const id = useSvgId()

  return (
    <svg viewBox="0 0 24 24" className={className} {...a11y}>
      <defs>
        <linearGradient
          id={id('blue')}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="4.81"
          x2="0"
          y2="19.19"
        >
          <stop offset="0" stopColor="#69BEFF" />
          <stop offset="1" stopColor="#3BAAFF" />
        </linearGradient>
      </defs>
      <g fill={`url(#${id('blue')})`}>
        <circle cx="6.79" cy="10.81" r="3.26" />
        <circle cx="13.49" cy="10.75" r="5.95" />
        <circle cx="5.28" cy="14.91" r="4.28" />
        <circle cx="18.72" cy="14.91" r="4.28" />
        <rect x="5.28" y="10.75" width="13.44" height="8.44" />
      </g>
    </svg>
  )
}

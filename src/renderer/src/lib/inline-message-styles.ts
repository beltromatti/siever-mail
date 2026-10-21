import { buildMessageFrameDocument, MAIL_APP_STYLE_ATTRIBUTE } from './mail-html'
import { withOffscreenFrames } from './offscreen-frame'

/** The composer's working width: the message is laid out as it will be seen there. */
const QUOTE_LAYOUT_WIDTH = 920

/** The author's style sheets, as opposed to the app's own canvas and defaults. */
const AUTHOR_STYLE_SHEETS = `style:not([${MAIL_APP_STYLE_ATTRIBUTE}]), link[rel~="stylesheet" i]`

/**
 * A received message as body HTML that looks the same anywhere: what its
 * style sheets did to each element is written on the element itself.
 *
 * A reply or a forward puts the message into the composer, and the
 * composer — like every editor, and every client the reply reaches — only
 * carries a body: the `<style>` blocks that laid it out stay behind. A
 * message written in Outlook lost its `p.MsoNormal { margin: 0 }` and
 * opened in the composer double-spaced, and went out that way.
 *
 * Nothing here knows any client's rules. The message is laid out twice off
 * screen — once as the reader shows it, once without its style sheets —
 * and wherever the two differ, the first one's value is written inline,
 * parents before children, so a value they inherit is written once. What
 * comes out reads the same in the composer as in the reader, and its look
 * is ordinary inline style the editor shows and changes like any other.
 * Values keep their computed form: a width of 50% stays 50%.
 */
export async function inlineMessageStyles(rawHtml: string): Promise<string> {
  const styled = buildMessageFrameDocument(rawHtml)
  const bare = withoutAuthorStyleSheets(styled)

  return withOffscreenFrames(
    [styled, bare],
    QUOTE_LAYOUT_WIDTH,
    ([styledDocument, bareDocument]) => {
      const styledView = styledDocument.defaultView
      const bareView = bareDocument.defaultView

      if (!styledView || !bareView) {
        throw new Error('Impossibile preparare il messaggio citato.')
      }

      const properties = Array.from(styledView.getComputedStyle(styledDocument.body))
      // The body's own look goes on first, so its children inherit it instead
      // of each carrying a copy; it ends up on the wrapper the body becomes.
      const bodyDeclarations = differingDeclarations(
        styledDocument.body,
        bareDocument.body,
        styledView,
        bareView,
        properties
      )

      for (const [property, value] of bodyDeclarations) {
        bareDocument.body.style.setProperty(property, value)
      }

      for (const level of pairElementsByDepth(styledDocument.body, bareDocument.body)) {
        // Read the whole level before writing any of it: a write restyles the
        // level below, which is read next, against what it now inherits.
        const writes = level.map(([styledElement, bareElement]) => ({
          element: bareElement,
          declarations: differingDeclarations(
            styledElement,
            bareElement,
            styledView,
            bareView,
            properties
          )
        }))

        for (const { element, declarations } of writes) {
          // HTML and SVG elements carry inline style; anything else has none to take.
          if (!(
            element instanceof bareView.HTMLElement || element instanceof bareView.SVGElement
          )) {
            continue
          }

          for (const [property, value] of declarations) {
            element.style.setProperty(property, value)
          }
        }
      }

      for (const sheet of [...bareDocument.body.querySelectorAll(AUTHOR_STYLE_SHEETS)]) {
        sheet.remove()
      }

      const wrapper = bareDocument.createElement('div')
      for (const [property, value] of bodyDeclarations) {
        wrapper.style.setProperty(property, value)
      }
      wrapper.append(...bareDocument.body.childNodes)

      return wrapper.outerHTML
    }
  )
}

/**
 * The same document with the author's style sheets switched off. They stay
 * in place — a `<style>` inside the body is a node like any other, and the
 * two layouts are compared node by node — but match no medium.
 */
function withoutAuthorStyleSheets(html: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html')

  for (const sheet of [...document.querySelectorAll(AUTHOR_STYLE_SHEETS)]) {
    sheet.setAttribute('media', 'not all')
  }

  return `<!doctype html>\n${document.documentElement.outerHTML}`
}

/** The two bodies' elements side by side, children after their parents. */
function pairElementsByDepth(
  styledRoot: Element,
  bareRoot: Element
): Array<Array<[Element, Element]>> {
  const levels: Array<Array<[Element, Element]>> = []
  let current: Array<[Element, Element]> = [[styledRoot, bareRoot]]

  while (current.length > 0) {
    const next: Array<[Element, Element]> = []

    for (const [styled, bare] of current) {
      const styledChildren = styled.children
      const bareChildren = bare.children

      for (
        let index = 0;
        index < styledChildren.length && index < bareChildren.length;
        index += 1
      ) {
        next.push([styledChildren[index], bareChildren[index]])
      }
    }

    if (next.length > 0) {
      levels.push(next)
    }

    current = next
  }

  return levels
}

/**
 * The properties whose value differs between the two layouts of one
 * element, with the styled layout's value in the form the style sheet gave
 * it. A difference only in the resolved value — a height in pixels that
 * moved because the text above it did — is no difference at all.
 */
function differingDeclarations(
  styled: Element,
  bare: Element,
  styledView: Window,
  bareView: Window,
  properties: ReadonlyArray<string>
): Array<[string, string]> {
  const styledStyle = styledView.getComputedStyle(styled)
  const bareStyle = bareView.getComputedStyle(bare)
  const changed = properties.filter(
    (property) => styledStyle.getPropertyValue(property) !== bareStyle.getPropertyValue(property)
  )

  if (changed.length === 0) {
    return []
  }

  const styledMap = styled.computedStyleMap()
  const bareMap = bare.computedStyleMap()
  const declarations: Array<[string, string]> = []

  for (const property of changed) {
    const styledValue = computedValue(styledMap, property) ?? styledStyle.getPropertyValue(property)
    const bareValue = computedValue(bareMap, property) ?? bareStyle.getPropertyValue(property)

    if (styledValue !== bareValue) {
      declarations.push([property, styledValue])
    }
  }

  return declarations
}

function computedValue(map: StylePropertyMapReadOnly, property: string): string | null {
  try {
    return map.get(property)?.toString() ?? null
  } catch {
    // A property the typed object model does not cover; the resolved value
    // stands in for it.
    return null
  }
}

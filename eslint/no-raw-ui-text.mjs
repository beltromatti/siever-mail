/**
 * Words the interface shows go through the app's messages (vision §13.5):
 * `defineMessages` with every language, read with `useMessages`. Text
 * written straight into JSX, into the attributes people read (a title, a
 * label, a placeholder), or into a toast would show in one language only —
 * this rule finds it as it is written, so a language never goes missing.
 *
 * What is not words is let through: punctuation and symbols (· › — ⌘),
 * numbers, units, and the product's name.
 */
const READ_ATTRIBUTES = new Set([
  'title',
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'placeholder',
  'alt',
  'label',
  'description',
  'lead',
  'confirmLabel',
  'cancelLabel',
  'tooltip',
  'emptyText'
])

/** Words that are names in every language. */
const NAMES =
  /\b(SIEVER Mail|SIEVER|OpenRouter|Google|Microsoft|iCloud|IMAP|SMTP|CalDAV|ICS|PEC|Gmail|Outlook)\b/g

function isWords(text) {
  const rest = text.replace(NAMES, '').replace(/\b(KB|MB|GB|B|px|%)\b/g, '')
  // Two letters in a row, in any alphabet: a word.
  return /\p{L}{2,}/u.test(rest)
}

function stringOf(node) {
  if (!node) {
    return null
  }

  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value
  }

  if (node.type === 'TemplateLiteral') {
    return node.quasis.map((quasi) => quasi.value.cooked ?? '').join(' ')
  }

  return null
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'UI text goes through defineMessages / useMessages (vision §13.5)' },
    messages: {
      raw: 'Text the user reads goes through the app’s messages (defineMessages + useMessages): «{{text}}».'
    },
    schema: []
  },
  create(context) {
    const report = (node, text) =>
      context.report({ node, messageId: 'raw', data: { text: text.trim().slice(0, 60) } })

    return {
      JSXText(node) {
        if (isWords(node.value)) {
          report(node, node.value)
        }
      },
      JSXAttribute(node) {
        const name = typeof node.name.name === 'string' ? node.name.name : ''

        if (!READ_ATTRIBUTES.has(name)) {
          return
        }

        const value =
          node.value?.type === 'JSXExpressionContainer' ? node.value.expression : node.value
        const text = stringOf(value)

        if (text !== null && isWords(text)) {
          report(node, text)
        }
      },
      JSXExpressionContainer(node) {
        if (node.parent?.type === 'JSXAttribute') {
          return
        }

        const text = stringOf(node.expression)

        if (text !== null && isWords(text)) {
          report(node, text)
        }
      },
      CallExpression(node) {
        const callee = node.callee
        const isToast =
          (callee.type === 'Identifier' && callee.name === 'toast') ||
          (callee.type === 'MemberExpression' &&
            callee.object.type === 'Identifier' &&
            callee.object.name === 'toast')

        if (!isToast) {
          return
        }

        const text = stringOf(node.arguments[0])

        if (text !== null && isWords(text)) {
          report(node.arguments[0], text)
        }
      }
    }
  }
}

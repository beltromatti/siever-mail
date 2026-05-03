import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
const __dirname = dirname(fileURLToPath(import.meta.url))

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
page.on('console', (msg) => console.log('[page]', msg.type(), msg.text()))
const mode = process.argv[2] === 'bare' ? '#bare' : ''
const url = 'file://' + resolve(__dirname, 'repro-sig-bug.html') + mode
await page.goto(url)
await page.waitForFunction(() => window.__ready__)

console.log('--- INITIAL HTML ---')
console.log(await page.evaluate(() => document.body.innerHTML))

// Click position — `left`, `middle`, `right`, or `force` (force caret at
// paragraph level, before the inner span — the worst-case scenario where
// natural typing would leak text out of the styled span and inherit the
// outer paragraph's color).
const where = process.argv[3] || 'left'
console.log('mode=', where)
if (where === 'force') {
  await page.evaluate(() => {
    const p = document.body.firstElementChild
    const r = document.createRange()
    r.setStart(p, 0)
    r.collapse(true)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(r)
    p.focus()
  })
} else {
  const firstDivBox = await page.evaluate((mode) => {
    const el = document.body.firstElementChild
    const r = el.getBoundingClientRect()
    if (mode === 'middle') return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    if (mode === 'right') return { x: r.right - 1, y: r.top + r.height / 2 }
    return { x: r.left + 1, y: r.top + r.height / 2 }
  }, where)
  await page.mouse.click(firstDivBox.x, firstDivBox.y)
}

// Read selection state.
const beforeType = await page.evaluate(() => {
  const sel = window.getSelection()
  const r = sel.rangeCount ? sel.getRangeAt(0) : null
  if (!r) return { error: 'no range' }
  const elem = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement
  const cs = window.getComputedStyle(elem)
  return {
    startContainer: r.startContainer.nodeName,
    startOffset: r.startOffset,
    endContainer: r.endContainer.nodeName,
    endOffset: r.endOffset,
    collapsed: r.collapsed,
    elementColor: cs.color,
    elementFontFamily: cs.fontFamily,
  }
})
console.log('--- BEFORE TYPING ---')
console.log(beforeType)

// Type 'a'.
await page.keyboard.type('a')
await page.waitForTimeout(50)

console.log('--- AFTER TYPING "a" ---')
console.log('innerHTML:', await page.evaluate(() => document.body.innerHTML))
console.log('typed-text computed colour:', await page.evaluate(() => {
  // Find the text node containing 'a' and report its parent's computed color.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let node
  while ((node = walker.nextNode())) {
    if (node.data && node.data.includes('a')) {
      const el = node.parentElement
      return { text: node.data, parentTag: el.tagName, parentInline: el.getAttribute('style'), computedColor: window.getComputedStyle(el).color, parentChain: (function(){const c=[];let n=el;while(n&&n!==document.body){c.push(n.tagName + (n.getAttribute('style')?'['+n.getAttribute('style')+']':''));n=n.parentElement}return c.join(' < ')})() }
    }
  }
  return null
}))

await browser.close()

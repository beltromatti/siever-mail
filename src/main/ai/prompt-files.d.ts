/** A prompt file, as text: Vite inlines it at build (`?raw`). */
declare module '*.md?raw' {
  const content: string
  export default content
}

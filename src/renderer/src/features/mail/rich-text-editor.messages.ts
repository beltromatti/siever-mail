import { defineMessages } from '@shared/i18n'

/** What the editor says: its toolbar, its menus, its link and table pickers, its body's hint. */
export const MESSAGES = defineMessages({
  bodyPlaceholder: {
    en: 'Write your email…',
    it: "Scrivi il contenuto dell'email...",
    de: 'Schreiben Sie Ihre E-Mail…'
  },
  frameTitle: { en: 'Email editor', it: 'Editor email', de: 'E-Mail-Editor' },
  tableSize: {
    en: (columns: number, rows: number) => `Table ${columns} × ${rows}`,
    it: (columns: number, rows: number) => `Tabella ${columns} × ${rows}`,
    de: (columns: number, rows: number) => `Tabelle ${columns} × ${rows}`
  },
  insertTable: { en: 'Insert a table', it: 'Inserisci una tabella', de: 'Tabelle einfügen' },
  tableOf: {
    en: (columns: number, rows: number) =>
      `Table of ${columns === 1 ? '1 column' : `${columns} columns`} and ${rows === 1 ? '1 row' : `${rows} rows`}`,
    it: (columns: number, rows: number) =>
      `Tabella di ${columns === 1 ? '1 colonna' : `${columns} colonne`} e ${rows === 1 ? '1 riga' : `${rows} righe`}`,
    de: (columns: number, rows: number) =>
      `Tabelle mit ${columns === 1 ? '1 Spalte' : `${columns} Spalten`} und ${rows === 1 ? '1 Zeile' : `${rows} Zeilen`}`
  },
  cannotReadFile: {
    en: (name: string) => `Couldn’t read the file: ${name}`,
    it: (name: string) => `Impossibile leggere il file: ${name}`,
    de: (name: string) => `Die Datei konnte nicht gelesen werden: ${name}`
  },
  invalidMedia: {
    en: (name: string) => `Invalid media format: ${name}`,
    it: (name: string) => `Formato media non valido: ${name}`,
    de: (name: string) => `Ungültiges Medienformat: ${name}`
  },
  unsupportedLink: {
    en: 'Link protocol not supported.',
    it: 'Protocollo link non supportato.',
    de: 'Link-Protokoll wird nicht unterstützt.'
  },
  chooseImage: {
    en: 'Choose a valid image file (PNG, JPG, GIF, WEBP).',
    it: 'Seleziona un file immagine valido (PNG, JPG, GIF, WEBP).',
    de: 'Wählen Sie eine gültige Bilddatei (PNG, JPG, GIF, WEBP).'
  },
  image: { en: 'Image', it: 'Immagine', de: 'Bild' },
  cannotInsert: {
    en: (name: string) => `Couldn’t insert ${name}.`,
    it: (name: string) => `Impossibile inserire ${name}.`,
    de: (name: string) => `${name} konnte nicht eingefügt werden.`
  },
  font: { en: 'Font', it: 'Font', de: 'Schriftart' },
  otherFont: { en: 'Other…', it: 'Altro...', de: 'Andere…' },
  otherFontNamed: {
    en: (name: string) => `Other: ${name}`,
    it: (name: string) => `Altro: ${name}`,
    de: (name: string) => `Andere: ${name}`
  },
  originalFont: { en: 'original font', it: 'font originale', de: 'Originalschrift' },
  bold: { en: 'Bold', it: 'Grassetto', de: 'Fett' },
  italic: { en: 'Italic', it: 'Corsivo', de: 'Kursiv' },
  underline: { en: 'Underline', it: 'Sottolineato', de: 'Unterstrichen' },
  strikethrough: { en: 'Strikethrough', it: 'Barrato', de: 'Durchgestrichen' },
  subscript: { en: 'Subscript', it: 'Pedice', de: 'Tiefgestellt' },
  superscript: { en: 'Superscript', it: 'Apice', de: 'Hochgestellt' },
  bulletList: { en: 'Bulleted list', it: 'Elenco puntato', de: 'Aufzählung' },
  numberedList: { en: 'Numbered list', it: 'Elenco numerato', de: 'Nummerierte Liste' },
  outdent: { en: 'Decrease indent', it: 'Riduci rientro', de: 'Einzug verkleinern' },
  indent: { en: 'Increase indent', it: 'Aumenta rientro', de: 'Einzug vergrößern' },
  quote: { en: 'Quote', it: 'Citazione', de: 'Zitat' },
  insertRowAbove: {
    en: 'Insert a row above',
    it: 'Inserisci una riga sopra',
    de: 'Zeile oberhalb einfügen'
  },
  insertRowBelow: {
    en: 'Insert a row below',
    it: 'Inserisci una riga sotto',
    de: 'Zeile unterhalb einfügen'
  },
  insertColumnLeft: {
    en: 'Insert a column to the left',
    it: 'Inserisci una colonna a sinistra',
    de: 'Spalte links einfügen'
  },
  insertColumnRight: {
    en: 'Insert a column to the right',
    it: 'Inserisci una colonna a destra',
    de: 'Spalte rechts einfügen'
  },
  deleteRow: { en: 'Delete the row', it: 'Elimina la riga', de: 'Zeile löschen' },
  deleteColumn: { en: 'Delete the column', it: 'Elimina la colonna', de: 'Spalte löschen' },
  deleteTable: { en: 'Delete the table', it: 'Elimina la tabella', de: 'Tabelle löschen' },
  paragraphStyle: { en: 'Paragraph style', it: 'Stile del paragrafo', de: 'Absatzformat' },
  paragraph: { en: 'Paragraph', it: 'Paragrafo', de: 'Absatz' },
  heading: {
    en: (level: number) => `Heading ${level}`,
    it: (level: number) => `Titolo ${level}`,
    de: (level: number) => `Überschrift ${level}`
  },
  headings: { en: 'Headings', it: 'Titoli', de: 'Überschriften' },
  alignment: { en: 'Alignment', it: 'Allineamento', de: 'Ausrichtung' },
  left: { en: 'Left', it: 'A sinistra', de: 'Links' },
  center: { en: 'Center', it: 'Al centro', de: 'Zentriert' },
  right: { en: 'Right', it: 'A destra', de: 'Rechts' },
  justified: { en: 'Justified', it: 'Giustificato', de: 'Blocksatz' },
  alignLeft: { en: 'Align left', it: 'Allinea a sinistra', de: 'Linksbündig' },
  alignCenter: { en: 'Center', it: 'Centra', de: 'Zentrieren' },
  alignRight: { en: 'Align right', it: 'Allinea a destra', de: 'Rechtsbündig' },
  justify: { en: 'Justify', it: 'Giustifica', de: 'Blocksatz' },
  insertImage: { en: 'Insert an image…', it: 'Inserisci un’immagine…', de: 'Bild einfügen…' },
  table: { en: 'Table', it: 'Tabella', de: 'Tabelle' },
  clearFormatting: {
    en: 'Clear formatting',
    it: 'Rimuovi formattazione',
    de: 'Formatierung entfernen'
  },
  undo: { en: 'Undo', it: 'Annulla', de: 'Rückgängig' },
  redo: { en: 'Redo', it: 'Ripeti', de: 'Wiederholen' },
  lineSpacing: { en: 'Line spacing', it: 'Interlinea', de: 'Zeilenabstand' },
  horizontalLine: { en: 'Horizontal line', it: 'Linea orizzontale', de: 'Horizontale Linie' },
  textSize: { en: 'Text size', it: 'Dimensione testo', de: 'Schriftgröße' },
  textSizeInPixels: {
    en: 'Text size in pixels',
    it: 'Dimensione testo in pixel',
    de: 'Schriftgröße in Pixel'
  },
  textColor: { en: 'Text color', it: 'Colore testo', de: 'Schriftfarbe' },
  defaultColor: { en: 'Default', it: 'Predefinito', de: 'Standard' },
  customColor: { en: 'Custom color', it: 'Colore personalizzato', de: 'Eigene Farbe' },
  highlightColor: {
    en: 'Text highlight color',
    it: 'Colore sfondo testo',
    de: 'Texthervorhebungsfarbe'
  },
  noHighlight: { en: 'No highlight', it: 'Nessuna evidenziazione', de: 'Keine Hervorhebung' },
  link: { en: 'Link', it: 'Link', de: 'Link' },
  insertMedia: {
    en: 'Insert media into the text',
    it: 'Inserisci media nel contenuto',
    de: 'Medien in den Text einfügen'
  },
  more: { en: 'More', it: 'Altro', de: 'Mehr' },
  moreCommands: {
    en: 'More formatting commands',
    it: 'Altri comandi di formattazione',
    de: 'Weitere Formatierungsbefehle'
  },
  linkPlaceholder: {
    en: 'https://example.com or name@domain.com',
    it: 'https://esempio.com o nome@dominio.com',
    de: 'https://beispiel.de oder name@domain.de'
  },
  apply: { en: 'Apply', it: 'Applica', de: 'Übernehmen' },
  removeLink: { en: 'Remove link', it: 'Rimuovi link', de: 'Link entfernen' }
})

/** The names of the colours the editor offers, as the picker shows them. */
export const COLOR_NAMES = defineMessages({
  charcoal: { en: 'Charcoal', it: 'Antracite', de: 'Anthrazit' },
  slate: { en: 'Slate', it: 'Ardesia', de: 'Schiefer' },
  gray: { en: 'Gray', it: 'Grigio', de: 'Grau' },
  silver: { en: 'Silver', it: 'Argento', de: 'Silber' },
  ice: { en: 'Ice', it: 'Ghiaccio', de: 'Eis' },
  red: { en: 'Red', it: 'Rosso', de: 'Rot' },
  scarlet: { en: 'Scarlet', it: 'Scarlatto', de: 'Scharlachrot' },
  orange: { en: 'Orange', it: 'Arancione', de: 'Orange' },
  amber: { en: 'Amber', it: 'Ambra', de: 'Bernstein' },
  ochre: { en: 'Ochre', it: 'Ocra', de: 'Ocker' },
  yellow: { en: 'Yellow', it: 'Giallo', de: 'Gelb' },
  lime: { en: 'Lime', it: 'Lime', de: 'Limette' },
  green: { en: 'Green', it: 'Verde', de: 'Grün' },
  emerald: { en: 'Emerald', it: 'Smeraldo', de: 'Smaragd' },
  teal: { en: 'Teal', it: 'Petrolio', de: 'Petrol' },
  cyan: { en: 'Cyan', it: 'Ciano', de: 'Cyan' },
  skyBlue: { en: 'Sky blue', it: 'Azzurro', de: 'Himmelblau' },
  blue: { en: 'Blue', it: 'Blu', de: 'Blau' },
  indigo: { en: 'Indigo', it: 'Indaco', de: 'Indigo' },
  magenta: { en: 'Magenta', it: 'Magenta', de: 'Magenta' },
  pink: { en: 'Pink', it: 'Rosa', de: 'Rosa' },
  peach: { en: 'Peach', it: 'Pesca', de: 'Pfirsich' },
  coral: { en: 'Coral', it: 'Corallo', de: 'Koralle' },
  lilac: { en: 'Lilac', it: 'Lilla', de: 'Flieder' }
})

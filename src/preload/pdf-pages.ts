import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

import { PDF_PAGES_IPC, type PdfPagesBridge, type PdfPagesRequest } from '@shared/pdf-pages'

const bridge: PdfPagesBridge = {
  onRequest: (listener) => {
    ipcRenderer.on(PDF_PAGES_IPC.render, (_event: IpcRendererEvent, request: PdfPagesRequest) =>
      listener(request)
    )
  },
  reply: (result) => ipcRenderer.send(PDF_PAGES_IPC.rendered, result)
}

contextBridge.exposeInMainWorld('pdfPages', bridge)

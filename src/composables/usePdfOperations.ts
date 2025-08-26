import { toValue, type MaybeRefOrGetter } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
import type { PageData } from '@/types'


/** Utility to clone a Uint8Array */
function cloneBytes(u: Uint8Array) {
  return new Uint8Array(u)
}

/** Convert bytes to base64 (no line breaks) */
function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

/**
 * Append one or more PDFs to `pages`.
 * Accepts either a Ref<PageData[]> or a plain PageData[].
 */
async function appendPdfs(files: FileList, pagesMaybe: MaybeRefOrGetter<PageData[]>): Promise<void> {
  const pages = toValue(pagesMaybe) // works with ref([]) or reactive([]) or plain []
  const valid = Array.from(files).filter((f) => f.size > 0 && f.type === 'application/pdf')

  for (const file of valid) {
    const buf = await file.arrayBuffer()
    const bytes = new Uint8Array(buf)

    const doc = await pdfjsLib.getDocument({ data: cloneBytes(bytes) }).promise
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i)
      const ops = await pg.getOperatorList()
      if (!ops.fnArray.length) continue

      pages.push({
        uid: crypto.randomUUID(),
        pageNumber: i,
        pdfBytes: bytes,                 // keep original bytes for rendering/signing
        viewport: null,
        imageData: null,
        thumbnailUrl: '',
        fields: [],
        fileName: file.name,
      } as PageData)
    }
  }
}

/**
 * Convert wrapper-space rect -> normalized PDF coords (all pages same width)
 * Used during signing. Keeps the same math you had before but decoupled from the component.
 */
function toPdfCoordsNormalized(
  fieldRect: { x: number; y: number; width: number; height: number },
  canvasRect: DOMRect,
  wrapperRect: DOMRect,
  padding: number,
  targetPageWidth: number,
  targetPageHeight: number,
) {
  const canvasLeftInWrapper = canvasRect.left - wrapperRect.left
  const canvasTopInWrapper = canvasRect.top - wrapperRect.top

  const xInCanvasCss = fieldRect.x - canvasLeftInWrapper - padding
  const yInCanvasCss = fieldRect.y - canvasTopInWrapper - padding

  const innerCanvasCssW = canvasRect.width - padding * 2
  const innerCanvasCssH = canvasRect.height - padding * 2

  const xR = xInCanvasCss / innerCanvasCssW
  const yR = yInCanvasCss / innerCanvasCssH
  const wR = fieldRect.width / innerCanvasCssW
  const hR = fieldRect.height / innerCanvasCssH

  const w = wR * targetPageWidth
  const h = hR * targetPageHeight
  const x = xR * targetPageWidth
  const y = (1 - (yR + hR)) * targetPageHeight

  return { x, y, w, h }
}

export function usePdfOperations() {
  return {
    appendPdfs,
    bytesToBase64,
    toPdfCoordsNormalized,
  }
}

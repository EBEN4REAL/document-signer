// src/composables/usePdfRendering.ts
import { ref } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
import type { PageViewport, PDFPageProxy } from 'pdfjs-dist'
import type { PageData } from '@/types'

// --- Configure the PDF.js worker exactly once ---
/**
 * Vite-friendly worker path:
 * new URL('pdfjs-dist/build/pdf.worker.min.js', import.meta.url).toString()
 * (falls back to non-min build if needed)
 */
(() => {
  if (typeof window === 'undefined') return

  const alreadySet =
    (pdfjsLib as any)?.GlobalWorkerOptions?.workerSrc &&
    typeof (pdfjsLib as any).GlobalWorkerOptions.workerSrc === 'string'

  if (!alreadySet) {
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.js',
        import.meta.url,
      ).toString()
    } catch {
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.js',
        import.meta.url,
      ).toString()
    }
  }
})()

export function usePdfRendering() {
  const pageCanvases = ref<HTMLCanvasElement[]>([])
  const renderTasks = ref<ReturnType<PDFPageProxy['render']>[]>([])
  const isLoading = ref(false)

  const PADDING = 6
  const SCALE = 1.25
  const DPR = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1

  /**
   * Ensure we always return a fresh, tightly-bound Uint8Array copy.
   * Avoids detached ArrayBuffer / SharedArrayBuffer issues.
   */
  const toTightBytes = (bytes: Uint8Array): Uint8Array =>
    new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))

  async function renderPage(page: PageData, canvas: HTMLCanvasElement, index: number) {
    const prev = renderTasks.value[index]
    if (prev) {
      try {
        prev.cancel()
      } catch {}
    }

    const pdf = await pdfjsLib.getDocument({ data: toTightBytes(page.pdfBytes) }).promise
    const pg = await pdf.getPage(page.pageNumber)
    const vp = pg.getViewport({ scale: SCALE })
    page.viewport = vp as PageViewport

    canvas.width = Math.round((vp.width + PADDING * 2) * DPR)
    canvas.height = Math.round((vp.height + PADDING * 2) * DPR)
    canvas.style.width = '100%'
    canvas.style.height = 'auto'

    const ctx = canvas.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(DPR, 0, 0, DPR, PADDING * DPR, PADDING * DPR)

    const task = pg.render({ canvasContext: ctx, viewport: vp })
    renderTasks.value[index] = task
    await task.promise

    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }

  async function generateThumbnail(page: PageData): Promise<string> {
    const pdf = await pdfjsLib.getDocument({ data: toTightBytes(page.pdfBytes) }).promise
    const pg = await pdf.getPage(page.pageNumber)
    const vp = pg.getViewport({ scale: 0.22 })

    const off = document.createElement('canvas')
    off.width = Math.ceil(vp.width)
    off.height = Math.ceil(vp.height)

    const ctx = off.getContext('2d')!
    await pg.render({ canvasContext: ctx, viewport: vp }).promise

    return off.toDataURL()
  }

  return {
    pageCanvases,
    renderTasks,
    isLoading,
    renderPage,
    generateThumbnail,
    PADDING,
    SCALE,
    DPR,
  }
}

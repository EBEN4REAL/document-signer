<template>
  <div class="pdf-signer-container">
    <DocumentName v-model="documentName" />

    <div class="pdf-signer-content" :class="{ locked: layoutLocked }">
      <!-- LEFT: Pages Thumbnails -->
      <ThumbnailColumn
        :pages="pages"
        @remove-page="removePage"
        @replace-page="onReplacePdfUpload"
        @add-documents="onAddPdfUpload"
        @scroll-to-page="scrollToPage"
      />

      <!-- MIDDLE: Canvas pages -->
      <CanvasColumn
        :pages="pages"
        :layoutLocked="layoutLocked"
        :isLoading="isLoading"
        :isDragOver="isDragOver"
        @drop-documents="onDropDocuments"
        @drop-field="onDropField"
        @field-mousedown="onFieldMouseDown"
        @field-delete="removeField"
        @canvas-mounted="handleCanvasMounted"
      />

      <!-- RIGHT: Toolbar -->
      <ToolbarColumn
        :layoutLocked="layoutLocked"
        @drag-start="onDragStart"
        @save-config="saveConfig"
        @sign-pdf="signPdf"
      />
    </div>

    <!-- Editor panel (shows in fill mode when a field is selected) -->
    <FieldPanel
      v-if="currentField && layoutLocked"
      :field="currentField"
      :drawingSig="drawingSig"
      @update-field="updateCurrentField"
      @start-drawing="startDrawingSig"
      @save-drawn="saveDrawn"
      @cancel-drawing="cancelDrawing"
      @sig-selected="onSigSelected"
      @clear-signature="clearSignature"
      @apply="applyField"
      @cancel="cancelField"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted, type Ref } from 'vue'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import interact from 'interactjs'

// Components
import DocumentName from './components/DocumentName.vue'
import ThumbnailColumn from './components/ThumbnailColumn.vue'
import CanvasColumn from './components/CanvasColumn.vue'
import ToolbarColumn from './components/ToolbarColumn.vue'
import FieldPanel from './components/FieldPanel.vue'

// Composables
import { usePdfRendering } from '@/composables/usePdfRendering'
import { useFieldManagement } from '@/composables/useFieldManagement'
import { useDragAndDrop } from '@/composables/useDragAndDrop'
import { usePdfOperations } from '@/composables/usePdfOperations'
import { useIndexedDB } from '@/composables/useIndexedDB'

// Types
import type { PageData, Field } from '@/types'

const STORAGE_KEY = 'pdfSignerConfigV7'
const NAME_KEY = 'pdfSignerDocumentNameV7'
const signerName = 'Oprah Winfrey'

// ----------------- State -----------------
const pages: Ref<PageData[]> = ref([])
const layoutLocked = ref<boolean>(false)
const documentName = ref<string>('')

// ----------------- Composables -----------------
const { pageCanvases, isLoading, renderPage, generateThumbnail, PADDING } = usePdfRendering()

// NOTE: These composables accept Ref<PageData[]>
const {
  currentField,
  drawingSig,
  removeField,     // (pageIdx: number, fieldId: string) => void
  selectField,     // (pageIdx: number, fieldId: string) => void
  applyField,      // () => void
  cancelField,     // () => void
} = useFieldManagement(pages, layoutLocked)

const {
  dragState,
  isDragOver,
  onDragStart,     // (e: DragEvent, type: 'signature' | 'initial') => void
  onDropField,     // (pageIdx: number, e: DragEvent) => void
  cleanupDragPreview,
} = useDragAndDrop(pages, layoutLocked, PADDING)

const { appendPdfs, toPdfCoordsNormalized } = usePdfOperations()
const { saveToIndexedDB, loadFromIndexedDB } = useIndexedDB()

// ----------------- Handlers -----------------
function onFieldMouseDown(pageIdx: number, fieldId: string) {
  if (!layoutLocked.value) return
  selectField(pageIdx, fieldId) // This opens the panel via currentField
}

async function onAddPdfUpload(files: FileList) {
  documentName.value =
    files.length === 1
      ? files[0].name.replace(/\.[^/.]+$/, '')
      : `Document_${Math.random().toString(36).substring(2, 6).toUpperCase()}`

  layoutLocked.value = false
  await appendPdfs(files, pages) // pushes into pages.value
  await nextTick()
  await generateThumbnails()
  await nextTick()
  await renderAllPages()
}

async function onDropDocuments(e: DragEvent) {
  const files = e.dataTransfer?.files
  if (!files?.length) return

  documentName.value =
    files.length === 1
      ? files[0].name.replace(/\.[^/.]+$/, '')
      : `Document_${Math.random().toString(36).substring(2, 6).toUpperCase()}`

  isLoading.value = true
  try {
    layoutLocked.value = false
    pages.value.splice(0)
    await appendPdfs(files, pages)
    await nextTick()
    await generateThumbnails()
    await nextTick()
    await renderAllPages()
  } finally {
    isLoading.value = false
  }
}

async function onReplacePdfUpload(idx: number, file: File) {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  const p = pages.value[idx]
  p.pdfBytes = bytes
  p.pageNumber = 1
  p.fields = []
  layoutLocked.value = false
  p.thumbnailUrl = await generateThumbnail(p)
  // Assign only; allow renderAllPages() to render to avoid overlapping renders
  if (pageCanvases.value[idx]) {
    await renderPage(p, pageCanvases.value[idx], idx)
  }
}

function removePage(idx: number) {
  pages.value.splice(idx, 1)
  nextTick(() => {
    generateThumbnails()
    renderAllPages()
  })
}

function scrollToPage(idx: number) {
  const wrapper = document.querySelectorAll<HTMLElement>('.page-wrapper')[idx]
  if (wrapper) wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function handleCanvasMounted(idx: number, canvas: HTMLCanvasElement) {
  pageCanvases.value[idx] = canvas
  // Do NOT immediately render here; renderAllPages() handles it to avoid overlap.
}

// Helpers
async function generateThumbnails() {
  for (let i = 0; i < pages.value.length; i++) {
    pages.value[i].thumbnailUrl = await generateThumbnail(pages.value[i])
  }
}

async function renderAllPages() {
  for (let i = 0; i < pages.value.length; i++) {
    const canvas = pageCanvases.value[i]
    if (canvas) {
      await renderPage(pages.value[i], canvas, i)
    }
  }
  initInteractions()
}

// ----------------- Interact.js (layout mode only) -----------------
function initInteractions() {
  interact('.field-overlay').unset()
  if (layoutLocked.value) return

  interact('.field-overlay')
    .draggable({
      modifiers: [interact.modifiers.restrictRect({ restriction: '.page-wrapper', endOnly: true })],
      listeners: {
        move(evt) {
          const el = evt.target as HTMLElement
          const id = el.dataset.id!
          const pageEl = el.closest('.page-wrapper')!
          const idx = Array.from(document.querySelectorAll('.page-wrapper')).indexOf(pageEl)
          const f = pages.value[idx].fields.find((x) => x.id === id)!
          f.rect.x += evt.dx
          f.rect.y += evt.dy
          el.style.left = `${f.rect.x}px`
          el.style.top = `${f.rect.y}px`
        },
      },
    })
    .resizable({
      edges: { top: true, left: true, bottom: true, right: true },
      modifiers: [
        interact.modifiers.restrictEdges({ outer: '.page-wrapper' }),
        interact.modifiers.restrictSize({ min: { width: 20, height: 20 } }),
      ],
      listeners: {
        move(evt) {
          const el = evt.target as HTMLElement
          const id = el.dataset.id!
          const pageEl = el.closest('.page-wrapper')!
          const idx = Array.from(document.querySelectorAll('.page-wrapper')).indexOf(pageEl)
          const f = pages.value[idx].fields.find((x) => x.id === id)!
          f.rect.x += evt.deltaRect.left
          f.rect.y += evt.deltaRect.top
          f.rect.width = evt.rect.width
          f.rect.height = evt.rect.height
          Object.assign(el.style, {
            left: `${f.rect.x}px`,
            top: `${f.rect.y}px`,
            width: `${f.rect.width}px`,
            height: `${f.rect.height}px`,
          })
        },
      },
    })
}

// ----------------- Persistence -----------------
async function saveConfig() {
  const success = await saveToIndexedDB(STORAGE_KEY, NAME_KEY, pages.value, documentName.value)
  if (success) {
    alert('Configuration saved – please refresh to enter Fill mode.')
    window.location.reload()
  } else {
    alert('Failed to save configuration.')
  }
}

// ----------------- Sign PDF -----------------
async function signPdf() {
  if (!pages.value.length) return
  isLoading.value = true

  try {
    const srcDocs = await Promise.all(pages.value.map((p) => PDFDocument.load(p.pdfBytes)))
    const srcLibPages = srcDocs.map((d, i) => d.getPages()[pages.value[i].pageNumber - 1])

    const targetWidth = Math.max(...srcLibPages.map((p) => p.getWidth()))
    const outPdf = await PDFDocument.create()
    const font = await outPdf.embedFont(StandardFonts.HelveticaBold)

    for (let i = 0; i < pages.value.length; i++) {
      const srcPage = srcLibPages[i]
      const origW = srcPage.getWidth()
      const origH = srcPage.getHeight()
      const scale = targetWidth / origW
      const targetH = origH * scale

      const outPage = outPdf.addPage([targetWidth, targetH])
      const embedded = await outPdf.embedPage(srcPage)
      outPage.drawPage(embedded, { x: 0, y: 0, width: targetWidth, height: targetH })

      for (const field of pages.value[i].fields) {
        const canvas = pageCanvases.value[i]!
        const wrapper = canvas.parentElement as HTMLElement

        const { x, y, w, h } = toPdfCoordsNormalized(
          field.rect,
          canvas.getBoundingClientRect(),
          wrapper.getBoundingClientRect(),
          PADDING,
          targetWidth,
          targetH,
        )

        if (field.type === 'signature' && field.sigBuffer) {
          const img =
            field.sigType === 'png'
              ? await outPdf.embedPng(field.sigBuffer)
              : await outPdf.embedJpg(field.sigBuffer)
          outPage.drawImage(img, { x, y, width: w, height: h })

          if (field.includeTimestamp && field.timestamp) {
            const ts = field.timestamp
            const timestampText = `Electronically signed by ${signerName} ${ts.toLocaleDateString(
              'en-US',
            )} at ${ts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
            const timestampSize = Math.min(w * 0.08, 10)
            const timestampY = y - timestampSize - 4
            outPage.drawText(timestampText, {
              x,
              y: Math.max(timestampY, 0),
              size: timestampSize,
              font,
              color: rgb(0.4, 0.4, 0.4),
            })
          }
        } else if (field.type === 'initial' && field.initialsText) {
          const txt = field.initialsText.trim()
          let size = Math.min(h * 0.7, 24)
          while (font.widthOfTextAtSize(txt, size) > w - 4 && size > 6) size -= 0.5
          outPage.drawText(txt, {
            x: x + (w - font.widthOfTextAtSize(txt, size)) / 2,
            y: y + (h - size) / 2 + size * 0.2,
            size,
            font,
            color: rgb(0, 0.5, 0),
          })
        }
      }
    }

    // Create a safe Blob from possibly offset Uint8Array
    const pdfBytes = await outPdf.save()
    const ab = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer
    const blob = new Blob([ab], { type: 'application/pdf' })

    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener,noreferrer')

    const a = document.createElement('a')
    a.href = url
    a.download = `${documentName.value}_${new Date().toISOString().slice(0, 10)}.pdf`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  } catch (err) {
    console.error('PDF signing error:', err)
    alert('Error generating signed PDF. Please try again.')
  } finally {
    isLoading.value = false
  }
}

// ----------------- Signature editing -----------------
function startDrawingSig() {
  drawingSig.value = true
}

// Receives ArrayBuffer from FieldPanel's draw canvas
async function saveDrawn(buf: ArrayBuffer) {
  if (!currentField.value) return
  const idx = pages.value.findIndex((pg) => pg.fields.some((f) => f.id === currentField.value!.id))
  if (idx >= 0) {
    const f = pages.value[idx].fields.find((x) => x.id === currentField.value!.id)!
    f.sigBuffer = buf
    f.sigType = 'png'
    currentField.value.sigBuffer = buf
    currentField.value.sigType = 'png'
  }
  drawingSig.value = false
}

function cancelDrawing() {
  drawingSig.value = false
}

async function onSigSelected(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file || !currentField.value) return
  const buf = await file.arrayBuffer()
  currentField.value.sigBuffer = buf
  currentField.value.sigType = file.type.includes('jpeg') ? 'jpg' : 'png'
}

function clearSignature() {
  if (!currentField.value) return
  currentField.value.sigBuffer = undefined
  currentField.value.sigType = undefined
}

function updateCurrentField(updates: Partial<Field>) {
  if (!currentField.value) return
  Object.assign(currentField.value, updates)
}

// ----------------- Mount -----------------
onMounted(async () => {
  const config = await loadFromIndexedDB(STORAGE_KEY, NAME_KEY)
  if (config) {
    documentName.value = config.documentName
    pages.value.push(...config.pages)
    layoutLocked.value = true
    await nextTick()
    await generateThumbnails()
    await nextTick()
    await renderAllPages()
  }
})
</script>

<style scoped>
/* Make the whole app fill the viewport and use a 3-column grid */
.pdf-signer-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

/* 3 columns: left (thumbs) | middle (canvas) | right (toolbar) */
.pdf-signer-content {
  display: grid;
  grid-template-columns: 260px 1fr 260px; /* tweak widths to taste */
  grid-template-rows: 1fr;
  column-gap: 16px;
  flex: 1 1 auto;
  background: #f5f5f5;
  min-height: 0; /* important for proper scrolling in grid children */
  padding-top: 20px;
}

/* Only the middle canvas column should scroll */
.canvas-col {
  overflow-y: auto;
  height: 100%;
  min-height: 0;
}

/* Keep the left & right columns fixed (non-scrollable) */
.thumbs-col,
.toolbar-col {
  position: sticky;
  top: 0;
  align-self: start;
  height: 100vh;       /* lock to viewport height */
  overflow: hidden;    /* prevent column scrollbars */
  background: #fff;
  border-right: 1px solid #ddd; /* thumbs */
}

/* Optional: separate the toolbar with left border instead */
.toolbar-col {
  border-right: none;
  border-left: 1px solid #ddd;
}

/* Good mobile behavior */
@media (max-width: 1024px) {
  .pdf-signer-content {
    grid-template-columns: 1fr; /* collapse to single column on small screens */
  }

  /* In small screens you can make everything scroll naturally */
  .thumbs-col,
  .toolbar-col {
    position: static;
    height: auto;
    overflow: visible;
    border: none;
  }

  .canvas-col {
    overflow: visible;
  }
}

</style>

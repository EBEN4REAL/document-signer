<template>
  <div class="pdf-signer-container">
    <DocumentName v-model="documentName" :isLocked="layoutLocked" />

    <div class="pdf-signer-content" :class="{ locked: layoutLocked }">
      <!-- LEFT: Pages Thumbnails -->
      <ThumbnailColumn :pages="pages" @remove-page="removePage" @replace-page="onReplacePdfUpload"
        @add-documents="onAddPdfUpload" @scroll-to-page="scrollToPage" />

      <!-- MIDDLE: Canvas pages -->
      <CanvasColumn :pages="pages" :layoutLocked="layoutLocked" :isLoading="isLoading" :isDragOver="isDragOver"
        :overlaysReady="overlaysReady" @drop-documents="onDropDocuments" @drop-field="onDropField"
        @field-mousedown="onFieldMouseDown" @field-delete="removeField" @canvas-mounted="handleCanvasMounted" />

      <!-- RIGHT: Toolbar -->
      <ToolbarColumn :layoutLocked="layoutLocked" @drag-start="onDragStart" @save-config="saveConfig"
        @sign-pdf="signPdf" />
    </div>

    <!-- Editor panel (shows in fill mode when a field is selected) -->
    <FieldPanel v-if="currentField && layoutLocked" :field="currentField" :drawingSig="drawingSig"
      @update-field="updateCurrentField" @start-drawing="startDrawingSig" @save-drawn="saveDrawn"
      @cancel-drawing="cancelDrawing" @sig-selected="onSigSelected" @clear-signature="clearSignature"
      @apply="applyField" @cancel="cancelField" />
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted, onBeforeUnmount, type Ref } from 'vue'
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
import type { PageData, Field, FieldRect, SavedConfig } from '@/types'

const STORAGE_KEY = 'pdfSignerConfigV7'
const NAME_KEY = 'pdfSignerDocumentNameV7'
const signerName = 'Oprah Winfrey'

// ----------------- State -----------------
const pages: Ref<PageData[]> = ref([])
const layoutLocked = ref<boolean>(false)
const documentName = ref<string>('')

// ----------------- Composables -----------------
const { pageCanvases, isLoading, renderPage, generateThumbnail, PADDING } = usePdfRendering()

// Track rendered size of each page so we can keep field positions in sync when the
// browser zoom level or available width changes.
const pageSizeCache = new Map<string, { width: number; height: number }>()
const pageResizeObservers = new Map<string, ResizeObserver>()
const overlaysReady = ref(true)

// NOTE: These composables accept Ref<PageData[]>
const {
  currentField,
  drawingSig,
  removeField,
  selectField,
  applyField,
} = useFieldManagement(pages, layoutLocked)

const {
  dragState,
  isDragOver,
  onDragStart,
  onDropField,
  cleanupDragPreview,
} = useDragAndDrop(pages, layoutLocked, PADDING)

const { appendPdfs, toPdfCoordsNormalized } = usePdfOperations()
const { saveToIndexedDB, loadFromIndexedDB } = useIndexedDB()

// ----------------- Handlers -----------------
function onFieldMouseDown(pageIdx: number, fieldId: string) {
  if (!layoutLocked.value) return
  selectField(pageIdx, fieldId) // This opens the panel via currentField
}

function cancelField() {
  currentField.value = null
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
    cleanupAllPageObservers()
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
  const page = pages.value[idx]
  if (page) cleanupPageObserver(page.uid)
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
  if (canvas) trackPageWrapper(idx, canvas)
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
  await hydrateFieldsFromNormalized()
  initInteractions()
}

// ----------------- Responsive field positioning -----------------
function trackPageWrapper(idx: number, canvas: HTMLCanvasElement) {
  const wrapper = canvas.parentElement as HTMLElement | null
  const page = pages.value[idx]
  if (!wrapper || !page) return
  const uid = page.uid

  cleanupPageObserver(uid)

  const updateCache = () => {
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    pageSizeCache.set(uid, { width: rect.width, height: rect.height })
  }
  updateCache()

  if (typeof ResizeObserver === 'undefined') return
  const observer = new ResizeObserver(() => {
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    handlePageResize(uid, rect.width, rect.height)
  })
  observer.observe(wrapper)
  pageResizeObservers.set(uid, observer)
}

function handlePageResize(uid: string, width: number, height: number) {
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height)) return

  const prev = pageSizeCache.get(uid)
  if (!prev) {
    pageSizeCache.set(uid, { width, height })
    return
  }

  const deltaX = Math.abs(prev.width - width)
  const deltaY = Math.abs(prev.height - height)
  if (deltaX < 0.25 && deltaY < 0.25) return

  const page = pages.value.find((p) => p.uid === uid)
  if (!page) {
    cleanupPageObserver(uid)
    return
  }

  const scaleX = width / prev.width
  const scaleY = height / prev.height

  page.fields.forEach((field) => {
    field.rect.x *= scaleX
    field.rect.y *= scaleY
    field.rect.width *= scaleX
    field.rect.height *= scaleY
    clampFieldToCanvas(field, width, height)
  })

  pageSizeCache.set(uid, { width, height })
}

function clampFieldToCanvas(field: Field, canvasWidth: number, canvasHeight: number) {
  const minX = PADDING
  const minY = PADDING
  const maxX = Math.max(canvasWidth - PADDING, minX)
  const maxY = Math.max(canvasHeight - PADDING, minY)

  field.rect.width = Math.min(field.rect.width, maxX - minX)
  field.rect.height = Math.min(field.rect.height, maxY - minY)
  field.rect.x = Math.min(Math.max(field.rect.x, minX), maxX - field.rect.width)
  field.rect.y = Math.min(Math.max(field.rect.y, minY), maxY - field.rect.height)
}

function cleanupPageObserver(uid: string) {
  const observer = pageResizeObservers.get(uid)
  if (observer) {
    observer.disconnect()
    pageResizeObservers.delete(uid)
  }
  pageSizeCache.delete(uid)
}

function cleanupAllPageObservers() {
  pageResizeObservers.forEach((observer) => observer.disconnect())
  pageResizeObservers.clear()
  pageSizeCache.clear()
}

type CanvasMetrics = {
  wrapperRect: DOMRect
  canvasRect: DOMRect
}

function getCanvasMetrics(pageIdx: number): CanvasMetrics | null {
  const canvas = pageCanvases.value[pageIdx]
  if (!canvas) return null
  const wrapper = canvas.parentElement as HTMLElement | null
  if (!wrapper) return null
  const wrapperRect = wrapper.getBoundingClientRect()
  const canvasRect = canvas.getBoundingClientRect()
  if (!canvasRect.width || !canvasRect.height) return null
  return { wrapperRect, canvasRect }
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function isNormalizedRect(rect?: FieldRect | null) {
  if (!rect) return false
  const within = (val: number) => Number.isFinite(val) && val >= 0 && val <= 1
  return within(rect.x) && within(rect.y) && within(rect.width) && within(rect.height)
}

function toNormalizedRect(pageIdx: number, field: Field): FieldRect | null {
  const metrics = getCanvasMetrics(pageIdx)
  if (!metrics) return null
  const { wrapperRect, canvasRect } = metrics
  const canvasLeftInWrapper = canvasRect.left - wrapperRect.left
  const canvasTopInWrapper = canvasRect.top - wrapperRect.top
  const innerW = canvasRect.width - PADDING * 2
  const innerH = canvasRect.height - PADDING * 2
  if (innerW <= 0 || innerH <= 0) return null

  const relX = field.rect.x - (canvasLeftInWrapper + PADDING)
  const relY = field.rect.y - (canvasTopInWrapper + PADDING)

  return {
    x: clamp01(relX / innerW),
    y: clamp01(relY / innerH),
    width: clamp01(field.rect.width / innerW),
    height: clamp01(field.rect.height / innerH),
  }
}

function fromNormalizedRect(norm: FieldRect, metrics: CanvasMetrics): FieldRect | null {
  const { wrapperRect, canvasRect } = metrics
  const innerW = canvasRect.width - PADDING * 2
  const innerH = canvasRect.height - PADDING * 2
  if (innerW <= 0 || innerH <= 0) return null
  const canvasLeftInWrapper = canvasRect.left - wrapperRect.left
  const canvasTopInWrapper = canvasRect.top - wrapperRect.top

  const width = Math.max(0, norm.width * innerW)
  const height = Math.max(0, norm.height * innerH)
  const x = canvasLeftInWrapper + PADDING + norm.x * innerW
  const y = canvasTopInWrapper + PADDING + norm.y * innerH

  return { x, y, width, height }
}

function hasPendingNormalizedHydration() {
  return pages.value.some((page) => page.fields.some((field) => !!field.rectNormalized))
}

async function hydrateFieldsFromNormalized() {
  if (!hasPendingNormalizedHydration()) {
    overlaysReady.value = true
    return
  }
  overlaysReady.value = false
  await nextTick()
  pages.value.forEach((page, idx) => {
    const metrics = getCanvasMetrics(idx)
    if (!metrics) return
    page.fields.forEach((field) => {
      if (!field.rectNormalized) return
      const rect = fromNormalizedRect(field.rectNormalized, metrics)
      if (rect) {
        field.rect = rect
        field.rectNormalized = undefined
      }
    })
  })
  overlaysReady.value = true
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
  await hydrateFieldsFromNormalized()
  console.log("Saving config to IndexedDB...", pages.value);

  const serial: SavedConfig = {
    pages: pages.value.map((p, pageIdx) => ({
      uid: p.uid,
      pageNumber: p.pageNumber,
      pdfBase64: bytesToBase64(p.pdfBytes),
      fileName: p.fileName,
      fields: p.fields.map((f) => {
        const normalizedRect = toNormalizedRect(pageIdx, f)
        return ({
          id: f.id,
          type: f.type,
          rect: { ...f.rect },
          rectNormalized: normalizedRect ?? undefined,
          initialsText: f.initialsText,
          sigBase64: f.sigBase64 || undefined,
          sigType: f.sigType,
          includeTimestamp: f.includeTimestamp,
          timestamp: f.timestamp ? f.timestamp.toISOString() : undefined,
        })
      }),
    })),
    documentName: documentName.value,
  };

  try {
    await saveToIndexedDB(STORAGE_KEY, serial);
    alert("Configuration saved – please refresh to enter Fill mode.");
    window.location.reload();
  } catch (err) {
    console.error("Failed to save to IndexedDB:", err);
    alert("Failed to save configuration.");
  }
}



function bufferToBase64(buf: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, sub as unknown as number[]);
  }
  return btoa(binary);
}

// ----------------- Sign PDF -----------------
// async function signPdf() {
//   if (!pages.value.length) return
//   isLoading.value = true

//   try {
//     const srcDocs = await Promise.all(pages.value.map((p) => PDFDocument.load(p.pdfBytes)))
//     const srcLibPages = srcDocs.map((d, i) => d.getPages()[pages.value[i].pageNumber - 1])

//     const targetWidth = Math.max(...srcLibPages.map((p) => p.getWidth()))
//     const outPdf = await PDFDocument.create()
//     const font = await outPdf.embedFont(StandardFonts.HelveticaBold)

//     for (let i = 0; i < pages.value.length; i++) {
//       const srcPage = srcLibPages[i]
//       const origW = srcPage.getWidth()
//       const origH = srcPage.getHeight()
//       const scale = targetWidth / origW
//       const targetH = origH * scale

//       const outPage = outPdf.addPage([targetWidth, targetH])
//       const embedded = await outPdf.embedPage(srcPage)
//       outPage.drawPage(embedded, { x: 0, y: 0, width: targetWidth, height: targetH })

//       for (const field of pages.value[i].fields) {
//         const canvas = pageCanvases.value[i]!
//         const wrapper = canvas.parentElement as HTMLElement

//         const { x, y, w, h } = toPdfCoordsNormalized(
//           field.rect,
//           canvas.getBoundingClientRect(),
//           wrapper.getBoundingClientRect(),
//           PADDING,
//           targetWidth,
//           targetH,
//         )

//         if (field.type === 'signature' && field.sigBase64) {
//             const img =
//               field.sigType === "png"
//                 ? await outPdf.embedPng(field.sigBase64)
//                 : await outPdf.embedJpg(field.sigBase64);

//             outPage.drawImage(img, { x, y, width: w, height: h });

//           if (field.includeTimestamp && field.timestamp) {
//             const ts = field.timestamp
//             const timestampText = `Electronically signed by ${signerName} ${ts.toLocaleDateString(
//               'en-US',
//             )} at ${ts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
//             const timestampSize = Math.min(w * 0.08, 10)
//             const timestampY = y - timestampSize - 4
//             outPage.drawText(timestampText, {
//               x,
//               y: Math.max(timestampY, 0),
//               size: timestampSize,
//               font,
//               color: rgb(0.4, 0.4, 0.4),
//             })
//           }
//         } else if (field.type === 'initial' && field.initialsText) {
//           const txt = field.initialsText.trim()
//           let size = Math.min(h * 0.7, 24)
//           while (font.widthOfTextAtSize(txt, size) > w - 4 && size > 6) size -= 0.5
//           outPage.drawText(txt, {
//             x: x + (w - font.widthOfTextAtSize(txt, size)) / 2,
//             y: y + (h - size) / 2 + size * 0.2,
//             size,
//             font,
//             color: rgb(0, 0.5, 0),
//           })
//         }
//       }
//     }

//     // Create a safe Blob from possibly offset Uint8Array
//     const pdfBytes = await outPdf.save()
//     const ab = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer
//     const blob = new Blob([ab], { type: 'application/pdf' })

//     const url = URL.createObjectURL(blob)
//     window.open(url, '_blank', 'noopener,noreferrer')

//     const a = document.createElement('a')
//     a.href = url
//     a.download = `${documentName.value}_${new Date().toISOString().slice(0, 10)}.pdf`
//     a.click()
//     setTimeout(() => URL.revokeObjectURL(url), 10000)
//   } catch (err) {
//     console.error('PDF signing error:', err)
//     alert('Error generating signed PDF. Please try again.')
//   } finally {
//     isLoading.value = false
//   }
// }

function cleanBase64(b64: string): string {
  if (!b64) return "";
  const commaIdx = b64.indexOf(",");
  return commaIdx !== -1 ? b64.substring(commaIdx + 1) : b64;
}

function base64ToBytes(base64?: string): Uint8Array {
  if (!base64) return new Uint8Array(); // defensive: older records
  const clean = base64.replace(/[\r\n\s]/g, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}


async function signPdf() {
  if (!pages.value.length) return;
  isLoading.value = true;

  try {
    await hydrateFieldsFromNormalized()
    // 1) Save config (your simplified version)
   const signedPayload: SavedConfig = {
      pages: pages.value.map((p, pageIdx) => ({
        uid: p.uid,
        pageNumber: p.pageNumber,
        pdfBase64: bytesToBase64(p.pdfBytes),  // plain string
        fileName: p.fileName,
        fields: p.fields.map((f) => {
          const normalizedRect = toNormalizedRect(pageIdx, f)
          return ({
            id: f.id,
            type: f.type,
            rect: { ...f.rect },                  // ensure plain object
            rectNormalized: normalizedRect ?? undefined,
            initialsText: f.initialsText ?? undefined,
            sigBase64: f.sigBase64 ?? undefined,
            sigType: f.sigType ?? undefined,
            includeTimestamp: f.includeTimestamp ?? undefined,
            timestamp: f.timestamp
              ? (f.timestamp instanceof Date ? f.timestamp.toISOString() : f.timestamp)
            : undefined,
          })
        }),
      })),
      documentName: documentName.value,
    }
    console.log("signedPayload: => 415", signedPayload);
    await saveToIndexedDB(STORAGE_KEY, signedPayload);

    // 2) Build PDF
    const srcDocs = await Promise.all(
      pages.value.map((p) => PDFDocument.load(p.pdfBytes))
    );
    const srcLibPages = srcDocs.map(
      (d, i) => d.getPages()[pages.value[i].pageNumber - 1]
    );

    const targetWidth = Math.max(...srcLibPages.map((p) => p.getWidth()));
    const outPdf = await PDFDocument.create();
    const font = await outPdf.embedFont(StandardFonts.HelveticaBold);

    for (let i = 0; i < pages.value.length; i++) {
      const srcPage = srcLibPages[i];
      const scale = targetWidth / srcPage.getWidth();
      const targetH = srcPage.getHeight() * scale;

      const outPage = outPdf.addPage([targetWidth, targetH]);
      const embedded = await outPdf.embedPage(srcPage);
      outPage.drawPage(embedded, {
        x: 0,
        y: 0,
        width: targetWidth,
        height: targetH,
      });

      for (const field of pages.value[i].fields) {
        const canvas = pageCanvases.value[i]!;
        const wrapper = canvas.parentElement as HTMLElement;

        const { x, y, w, h } = toPdfCoordsNormalized(
          field.rect,
          canvas.getBoundingClientRect(),
          wrapper.getBoundingClientRect(),
          PADDING,
          targetWidth,
          targetH
        );

        if (field.type === "signature" && field.sigBase64) {
          const clean = cleanBase64(field.sigBase64);

          const img =
            field.sigType === "png"
              ? await outPdf.embedPng(clean)   // 👈 pass clean base64 directly
              : await outPdf.embedJpg(clean);

          outPage.drawImage(img, { x, y, width: w, height: h });

          if (field.includeTimestamp && field.timestamp) {
            const ts = field.timestamp;
            const tsText = `Electronically signed by ${signerName} ${ts.toLocaleDateString(
              "en-US"
            )} at ${ts.toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            })}`;
            const tsSize = Math.min(w * 0.08, 10);

            outPage.drawText(tsText, {
              x,
              y: Math.max(y - tsSize - 4, 0),
              size: tsSize,
              font,
              color: rgb(0.4, 0.4, 0.4),
            });
          }
        } else if (field.type === "initial" && field.initialsText) {
          const txt = field.initialsText.trim();
          let size = Math.min(h * 0.7, 24);
          while (font.widthOfTextAtSize(txt, size) > w - 4 && size > 6) {
            size -= 0.5;
          }
          outPage.drawText(txt, {
            x: x + (w - font.widthOfTextAtSize(txt, size)) / 2,
            y: y + (h - size) / 2 + size * 0.2,
            size,
            font,
            color: rgb(0, 0.5, 0),
          });
        }
      }
    }

    // 3) Output PDF
    const pdfBytes = await outPdf.save();

    // ✅ Force into a fresh Uint8Array (no SharedArrayBuffer type issues)
    const normalized = new Uint8Array(pdfBytes);

    const blob = new Blob([normalized], { type: "application/pdf" });


    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");

    const a = document.createElement("a");
    a.href = url;
    a.download = `${documentName.value}_${new Date()
      .toISOString()
      .slice(0, 10)}.pdf`;
    a.click();

    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (err) {
    console.error("PDF signing error:", err);
    alert("Error generating signed PDF.");
  } finally {
    isLoading.value = false;
  }
}



// ----------------- Signature editing -----------------
function startDrawingSig() {
  drawingSig.value = true
}

// Receives ArrayBuffer from FieldPanel's draw canvas
// async function saveDrawn() {
//   if (!currentField.value) return
//   const canvas = document.querySelector<HTMLCanvasElement>('.draw-pad')
//   if (!canvas) return

//   // raw base64 (no data: prefix) for storage, dataURL for preview
//   const dataUrl = canvas.toDataURL('image/png')
//   const base64 = dataUrl.split(',')[1]

//   setFieldById(currentField.value.id, {
//     sigBase64: base64,
//     sigType: 'png',
//     sigPreviewUrl: dataUrl,
//   })

//   drawingSig.value = false
// }

async function saveDrawn() {
  if (!currentField.value) return
  const canvas = document.querySelector<HTMLCanvasElement>('.draw-pad')
  if (!canvas) return

  const dataUrl = canvas.toDataURL('image/png')
  const base64 = dataUrl.split(',')[1]

  setFieldById(currentField.value.id, {
    sigBase64: base64,       // ✅ save raw base64
    sigType: 'png',
    sigPreviewUrl: dataUrl,  // ✅ preview in UI
  })

  drawingSig.value = false
}


function cancelDrawing() {
  drawingSig.value = false
}

async function onSigSelected(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file || !currentField.value) return

  const reader = new FileReader()
  reader.onload = () => {
    const dataUrl = reader.result as string
    const base64 = dataUrl.split(',')[1] || ''
    const type: 'png' | 'jpg' = file.type.includes('jpeg') ? 'jpg' : 'png'

    setFieldById(currentField.value!.id, {
      sigBase64: base64,       // ✅ raw base64
      sigType: type,
      sigPreviewUrl: dataUrl,  // ✅ preview
    })
  }
  reader.readAsDataURL(file)
}


function clearSignature() {
  if (!currentField.value) return
  currentField.value.sigBase64 = undefined
  currentField.value.sigType = undefined
  currentField.value.sigPreviewUrl = undefined
}

function setFieldById(fieldId: string, patch: Partial<Field>) {
  const pi = pages.value.findIndex(p => p.fields.some(f => f.id === fieldId))
  if (pi === -1) return
  const fi = pages.value[pi].fields.findIndex(f => f.id === fieldId)
  const updated = { ...pages.value[pi].fields[fi], ...patch }
  delete updated.rectNormalized
  // replace (so Vue reactivity sees it)
  pages.value[pi].fields.splice(fi, 1, updated)
  // keep panel copy in sync too
  if (currentField.value?.id === fieldId) currentField.value = { ...updated }
}


function updateCurrentField(updates: Partial<Field>) {
  console.log
  if (!currentField.value) return
  const merged = { ...currentField.value, ...updates }
  setFieldById(currentField.value.id, merged)
}

// ----------------- Mount -----------------
// --- onMounted: load from IndexedDB and HYDRATE into PageData ---
onMounted(async () => {
  const config = await loadFromIndexedDB(STORAGE_KEY); // returns SavedConfig
  if (!config) return;

  documentName.value = config.documentName ?? '';

  // Map SavedConfig -> PageData (runtime)
  const restoredPages: PageData[] = config.pages.map((s) => ({
    uid: s.uid,
    pageNumber: s.pageNumber,
    pdfBytes: s.pdfBytes,              // 👈 hydrate
    viewport: null,
    imageData: null,
    thumbnailUrl: '',
    fileName: s.fileName ?? '',
    fields: s.fields.map((f) => ({
      id: f.id,
      type: f.type,
      rect: { ...f.rect },
      rectNormalized: f.rectNormalized ?? (isNormalizedRect(f.rect) ? { ...f.rect } : undefined),
      initialsText: f.initialsText,
      sigBase64: f.sigBase64,                          // stays base64
      sigType: f.sigType,
      includeTimestamp: f.includeTimestamp,
      timestamp: f.timestamp ? new Date(f.timestamp) : undefined, // 👈 Date
      sigPreviewUrl: f.sigBase64
        ? `data:${f.sigType === 'jpg' ? 'image/jpeg' : 'image/png'};base64,${f.sigBase64}`
        : undefined,
    })),
  }));

  // Replace the reactive array so Vue updates properly
  cleanupAllPageObservers()
  pages.value.splice(0, pages.value.length, ...restoredPages);
  if (hasPendingNormalizedHydration()) overlaysReady.value = false

  // Enter Fill mode and render
  layoutLocked.value = true;
  await nextTick();
  await generateThumbnails();
  await nextTick();
  await renderAllPages();

  // Optional sanity check
  // console.log('Restored pages:', pages.value.map(p => ({ uid: p.uid, fields: p.fields.length, pdfLen: p.pdfBytes.length })));
});

onBeforeUnmount(() => {
  cleanupAllPageObservers()
})


// --- helpers (use these exact versions) ---
function bytesToBase64(bytes: Uint8Array): string {
  // chunked to avoid call-stack / invalid base64 on large PDFs
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, sub as unknown as number[]);
  }
  return btoa(binary);
}
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
  grid-template-columns: 260px 1fr 260px;
  /* tweak widths to taste */
  grid-template-rows: 1fr;
  flex: 1 1 auto;
  min-height: 0;
  /* important for proper scrolling in grid children */
  padding-top: 10px;
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
  height: 100vh;
  overflow: hidden;
}

/* Good mobile behavior */
@media (max-width: 1024px) {
  .pdf-signer-content {
    grid-template-columns: 1fr;
    /* collapse to single column on small screens */
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

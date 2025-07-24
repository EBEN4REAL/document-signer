<template>
  <div class="pdf-signer-container" :class="{ locked: layoutLocked }">
    <!-- Left thumbnails & “Add PDF” -->
    <div class="col thumbs-col">
      <!-- Scrollable thumbnails list -->
      <div class="thumbs-scroll">
        <div
          v-for="(p, idx) in pages"
          :key="p.uid"
          class="thumb-wrapper"
          @click="scrollToPage(idx)"
        >
          <img :src="p.thumbnailUrl" class="thumb" />

          <!-- Improved overlay with Replace + Close -->
          <div class="thumb-overlay improved">
            <!-- Delete page is always allowed (doesn't affect your 6 rules) -->
            <button class="thumb-close" @click.stop="removePage(idx)">✕</button>

            <button class="thumb-replace-pill" @click.stop="triggerReplace(idx)">REPLACE</button>

            <!-- Hidden input actually doing the replace -->
            <input
              :ref="(el) => (replaceInputs[idx] = el as HTMLInputElement | null)"
              type="file"
              accept="application/pdf"
              class="hidden-input"
              @change="onReplacePdfUpload(idx, $event)"
            />
          </div>
        </div>

      </div>

      <!-- Fixed footer button -->
      <div v-if="pages.length" class="thumbs-footer fixed-footer">
        <label class="add-doc-btn big-pill">
          ⬆ ADD DOCUMENT
          <input
            type="file"
            accept="application/pdf"
            multiple
            class="hidden-input"
            @change="onAddPdfUpload"
          />
        </label>
      </div>
    </div>

    <!-- Canvas area -->
    <div class="col canvas-col" ref="canvasCol">
      <div v-if="!pages.length" class="initial-upload-container">
        <div v-if="isLoading" class="loader">Loading PDF...</div>
        <label
          v-else
          class="dropzone"
          :class="{ 'drag-over': isDragOver }"
          @dragover.prevent="isDragOver = true"
          @dragleave.prevent="isDragOver = false"
          @drop.prevent="
            (e) => {
              isDragOver = false
              onDropDocuments(e)
            }
          "
        >
          <!-- Cloud upload icon -->
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            class="dz-icon"
          >
            <path
              d="M3 15a4 4 0 0 0 4 4h11a4 4 0 0 0 1-7.874A5 5 0 0 0 9 9.5c0 .168.006.335.02.5A4 4 0 0 0 3 15z"
            />
            <path d="M12 12v9" />
            <path d="m8 16 4-4 4 4" />
          </svg>

          <h2 class="dz-title">Add documents or images</h2>
          <p class="dz-subtitle">Click to upload or drag and drop files</p>

          <input
            type="file"
            accept="application/pdf,image/*"
            multiple
            class="hidden-input"
            @change="onPdfUpload"
          />
        </label>
      </div>

      <div v-for="(p, idx) in pages" :key="p.uid" class="page-wrapper">
        <canvas
          :ref="(el) => (pageCanvases[idx] = el as HTMLCanvasElement | null)"
          class="pdf-canvas"
          @dragover.prevent
          @drop="onDropField(idx, $event)"
        />

        <!-- Interactive overlays -->
        <div
          v-for="f in p.fields"
          :key="f.id"
          class="field-overlay"
          :class="[f.type, { locked: layoutLocked }]"
          :data-id="f.id"
          :style="{
            left: f.rect.x + 'px',
            top: f.rect.y + 'px',
            width: f.rect.width + 'px',
            height: f.rect.height + 'px',
          }"
          @mousedown.stop="onFieldMouseDown(idx, f.id)"
        >
          <!-- delete small x (ONLY in layout mode) -->
          <button v-if="!layoutLocked" class="field-delete" @click.stop="removeField(idx, f.id)">
            ✕
          </button>

          <!-- Signature image if present -->
          <img v-if="f.type === 'signature' && f.sigBuffer" :src="getSigUrl(f)" class="sig-img" />
          <!-- Fallback icon -->
          <span v-else-if="f.type === 'signature'" class="sig-icon">✒️</span>

          <!-- Initials text -->
          <span v-if="f.type === 'initial' && f.initialsText" class="initial-text">
            {{ f.initialsText }}
          </span>
        </div>
      </div>
    </div>

    <!-- Toolbar -->
    <div class="col toolbar-col">
      <div class="field-selector">
        <div
          class="field-card"
          :class="{ disabled: layoutLocked }"
          :draggable="!layoutLocked"
          @dragstart="(e) => onDragStart(e, 'signature')"
        >
          <span class="drag-handle">⋮⋮</span>
          <span class="field-icon">✒️</span>
          <span class="field-label">Signature</span>
        </div>
        <div
          class="field-card"
          :class="{ disabled: layoutLocked }"
          :draggable="!layoutLocked"
          @dragstart="(e) => onDragStart(e, 'initial')"
        >
          <span class="drag-handle">⋮⋮</span>
          <span class="field-icon">🔤</span>
          <span class="field-label">Initials</span>
        </div>
      </div>

      <hr />

      <button
        class="action-btn"
        :disabled="layoutLocked"
        :class="{ disabled: layoutLocked }"
        @click="saveConfig"
      >
        💾 Save Config
      </button>
      <button class="action-btn primary" @click="signPdf">Complete</button>
    </div>

    <!-- Editor Panel (only in FILL phase i.e. layoutLocked = true) -->
    <div v-if="currentField && layoutLocked" class="field-panel active">
      <div class="panel-header">
        <h3>{{ currentField.type === 'signature' ? 'Signature' : 'Initials' }}</h3>
        <button class="panel-close" @click="cancelField">✕</button>
      </div>

      <div v-if="currentField.type === 'signature'" class="sig-config">
        <div class="sig-actions">
          <button class="pill" @click="startDrawingSig">✍ DRAW</button>
          <label class="pill">
            ⬆ UPLOAD
            <input
              ref="sigInput"
              type="file"
              accept="image/png,image/jpeg"
              class="hidden-input"
              @change="onSigSelected"
            />
          </label>
          <button class="pill" @click="clearSignature">↺ CLEAR</button>
        </div>

        <!-- Always visible preview box -->
        <div class="sig-preview">
          <canvas
            v-if="drawingSig"
            ref="drawPad"
            class="draw-pad"
            width="600"
            height="200"
          ></canvas>

          <img
            v-else-if="currentField.sigBuffer"
            :src="getSigUrl(currentField)"
            class="preview-img"
          />

          <div v-else class="sig-placeholder">No signature yet. Draw or upload above.</div>
        </div>

        <!-- faint buttons for the draw pad only -->
        <div class="draw-actions" v-if="drawingSig">
          <button class="pill faint success" @click="saveDrawn">✔ SAVE</button>
          <button class="pill faint danger" @click="cancelDrawing">✖ CANCEL</button>
        </div>
      </div>

      <div v-else class="initials-config">
        <label class="initials-label">
          Initials
          <input
            v-model="currentField.initialsText"
            maxlength="3"
            placeholder="EJ"
            class="initials-input"
          />
        </label>
      </div>

      <div class="panel-actions">
        <button class="pill success" @click="applyField">Apply</button>
        <button class="pill danger" @click="cancelField">Cancel</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import interact from 'interactjs'
import { v4 as uuidv4 } from 'uuid'
import type { PageViewport, PDFPageProxy } from 'pdfjs-dist'

const STORAGE_KEY = 'pdfSignerConfigV6'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.js',
  import.meta.url,
).toString()

/** --- Types --- **/
interface FieldRect {
  x: number
  y: number
  width: number
  height: number
}
interface Field {
  id: string
  type: 'signature' | 'initial'
  rect: FieldRect
  initialsText?: string
  sigBuffer?: ArrayBuffer
  sigType?: 'png' | 'jpg'
}
interface PageData {
  uid: string
  pageNumber: number
  pdfBytes: Uint8Array
  viewport: PageViewport | null
  imageData: ImageData | null
  thumbnailUrl: string
  fields: Field[]
}
type RenderTask = ReturnType<PDFPageProxy['render']>

/** --- State --- **/
const pages = reactive<PageData[]>([])
const pageCanvases = ref<(HTMLCanvasElement | null)[]>([])
const renderTasks = ref<(RenderTask | null)[]>([])

const replaceInputs = ref<(HTMLInputElement | null)[]>([])

const isLoading = ref(false)

// phase control
// layoutLocked = false => Layout phase (drag/drop + delete, no editor popup)
// layoutLocked = true  => Fill phase   (no drag/drop + delete; click shows editor)
const layoutLocked = ref(false)

const currentField = ref<Field | null>(null)
const drawingSig = ref(false)
const drawPad = ref<HTMLCanvasElement | null>(null)
const canvasCol = ref<HTMLDivElement | null>(null)

const isDragOver = ref(false)

/** --- Helpers & Constants --- **/
const PADDING = 6,
  SCALE = 1.25,
  DPR = window.devicePixelRatio || 1
const cloneBytes = (u: Uint8Array) => new Uint8Array(u)
const getSigUrl = (f: Field) =>
  f.sigBuffer
    ? URL.createObjectURL(
        new Blob([f.sigBuffer], { type: f.sigType === 'png' ? 'image/png' : 'image/jpeg' }),
      )
    : ''

// reset refs on pages.length change
watch(
  () => pages.length,
  (len) => {
    pageCanvases.value = Array(len).fill(null)
    renderTasks.value = Array(len).fill(null)
  },
  { immediate: true },
)

watch(layoutLocked, (locked) => {
  if (locked && canvasCol.value) {
    const w = canvasCol.value.getBoundingClientRect().width + 'px'
    canvasCol.value.style.maxWidth = w
    canvasCol.value.style.minWidth = w
    canvasCol.value.style.margin = '0 auto' // keep it centered if needed
  }
})

// Load saved config on mount (Fill phase)
onMounted(async () => {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw) {
    const saved = JSON.parse(raw) as {
      pages: Array<{
        uid: string
        pageNumber: number
        pdfBase64: string
        fields: Array<
          Omit<Field, 'sigBuffer'> & {
            sigBuffer?: number[]
          }
        >
      }>
    }
    saved.pages.forEach((s) => {
      pages.push({
        uid: s.uid,
        pageNumber: s.pageNumber,
        pdfBytes: Uint8Array.from(atob(s.pdfBase64), (c) => c.charCodeAt(0)),
        viewport: null,
        imageData: null,
        thumbnailUrl: '',
        fields: s.fields.map((f) => ({
          ...f,
          sigBuffer: f.sigBuffer ? new Uint8Array(f.sigBuffer).buffer : undefined,
        })),
      })
    })
    layoutLocked.value = true // now in Fill phase
    await nextTick()
    await generateThumbnails()
    await nextTick()
    await renderAllPages()
  }
})

/** --- Drag state --- **/
const dragState = reactive<{
  type: 'signature' | 'initial' | null
  boxW: number
  boxH: number
  anchorX: number
  anchorY: number
}>({
  type: null,
  boxW: 0,
  boxH: 0,
  anchorX: 0,
  anchorY: 0,
})

/** --- Floating drag preview --- **/
let dragPreviewEl: HTMLDivElement | null = null

function onDocDragOver(e: DragEvent) {
  if (!dragPreviewEl) return
  dragPreviewEl.style.left = `${e.clientX - dragState.anchorX}px`
  dragPreviewEl.style.top = `${e.clientY - dragState.anchorY}px`
}

function cleanupDragPreview() {
  if (dragPreviewEl) {
    dragPreviewEl.remove()
    dragPreviewEl = null
  }
  dragState.type = null
}

onMounted(() => {
  document.addEventListener('dragover', onDocDragOver)
  document.addEventListener('dragend', cleanupDragPreview)
  document.addEventListener('drop', cleanupDragPreview)
})
onBeforeUnmount(() => {
  document.removeEventListener('dragover', onDocDragOver)
  document.removeEventListener('dragend', cleanupDragPreview)
  document.removeEventListener('drop', cleanupDragPreview)
})

/** --- Utility --- **/
function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

/** ******************************
 *  Geometry helpers
 ********************************/
function triggerReplace(idx: number) {
  replaceInputs.value[idx]?.click()
}

function getInnerBounds(pageIdx: number) {
  const canvas = pageCanvases.value[pageIdx]!
  const wrapper = canvas.parentElement as HTMLElement

  const wrapperRect = wrapper.getBoundingClientRect()
  const canvasRect = canvas.getBoundingClientRect()

  const canvasLeftInWrapper = canvasRect.left - wrapperRect.left
  const canvasTopInWrapper = canvasRect.top - wrapperRect.top

  const innerW = canvasRect.width - PADDING * 2
  const innerH = canvasRect.height - PADDING * 2

  const minX = canvasLeftInWrapper + PADDING
  const minY = canvasTopInWrapper + PADDING
  const maxX = minX + innerW
  const maxY = minY + innerH

  return { minX, minY, maxX, maxY }
}
function clampToInner(x: number, y: number, w: number, h: number, pageIdx: number) {
  const { minX, minY, maxX, maxY } = getInnerBounds(pageIdx)
  const clampedX = Math.min(Math.max(x, minX), maxX - w)
  const clampedY = Math.min(Math.max(y, minY), maxY - h)
  return { x: clampedX, y: clampedY }
}

/** --- PDF upload & rendering --- **/
async function appendPdfs(files: FileList) {
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
        uid: uuidv4(),
        pageNumber: i,
        pdfBytes: bytes,
        viewport: null,
        imageData: null,
        thumbnailUrl: '',
        fields: [],
      })
    }
  }
}

async function onPdfUpload(e: Event) {
  const inp = e.target as HTMLInputElement
  if (!inp.files?.length) return

  isLoading.value = true
  try {
    // brand new session => Layout phase
    layoutLocked.value = false
    pages.splice(0)
    await appendPdfs(inp.files)
    inp.value = ''
    await nextTick()
    await generateThumbnails()
    await nextTick()
    await renderAllPages()
  } finally {
    isLoading.value = false
  }
}

async function onAddPdfUpload(e: Event) {
  const inp = e.target as HTMLInputElement
  if (!inp.files?.length) return
  layoutLocked.value = false // still in layout phase
  await appendPdfs(inp.files)
  inp.value = ''
  await nextTick()
  await generateThumbnails()
  await nextTick()
  await renderAllPages()
}

async function onDropDocuments(e: DragEvent) {
  const files = e.dataTransfer?.files
  if (!files?.length) return

  isLoading.value = true
  try {
    layoutLocked.value = false
    pages.splice(0)
    await appendPdfs(files)
    await nextTick()
    await generateThumbnails()
    await nextTick()
    await renderAllPages()
  } finally {
    isLoading.value = false
  }
}

async function generateThumbnails() {
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]
    const pdf = await pdfjsLib.getDocument({ data: cloneBytes(p.pdfBytes) }).promise
    const pg = await pdf.getPage(p.pageNumber)
    const vp = pg.getViewport({ scale: 0.22 })
    const off = document.createElement('canvas')
    off.width = vp.width
    off.height = vp.height
    const ctx = off.getContext('2d')!
    await pg.render({ canvasContext: ctx, viewport: vp }).promise
    p.thumbnailUrl = off.toDataURL()
  }
}
async function generateThumbnail(idx: number) {
  const p = pages[idx]
  const pdf = await pdfjsLib.getDocument({ data: cloneBytes(p.pdfBytes) }).promise
  const pg = await pdf.getPage(p.pageNumber)
  const vp = pg.getViewport({ scale: 0.22 })
  const off = document.createElement('canvas')
  off.width = vp.width
  off.height = vp.height
  const ctx = off.getContext('2d')!
  await pg.render({ canvasContext: ctx, viewport: vp }).promise
  p.thumbnailUrl = off.toDataURL()
}

async function renderAllPages() {
  for (let i = 0; i < pages.length; i++) await renderPage(i)
  await nextTick()
  initInteractions()
}
async function renderPage(idx: number) {
  const canvas = pageCanvases.value[idx]
  if (!canvas) return
  const prev = renderTasks.value[idx]
  if (prev)
    try {
      prev.cancel()
    } catch {}
  const p = pages[idx]
  const pdf = await pdfjsLib.getDocument({ data: cloneBytes(p.pdfBytes) }).promise
  const pg = await pdf.getPage(p.pageNumber)
  const vp = pg.getViewport({ scale: SCALE })
  p.viewport = vp

  canvas.width = (vp.width + PADDING * 2) * DPR
  canvas.height = (vp.height + PADDING * 2) * DPR
  canvas.style.width = '100%'
  canvas.style.height = 'auto'

  const ctx = canvas.getContext('2d')!

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.setTransform(DPR, 0, 0, DPR, PADDING * DPR, PADDING * DPR)
  const task = pg.render({ canvasContext: ctx, viewport: vp })
  renderTasks.value[idx] = task
  await task.promise

  ctx.setTransform(1, 0, 0, 1, 0, 0)
}

/** --- interact.js overlays --- **/
function initInteractions() {
  interact('.field-overlay').unset()

  if (layoutLocked.value) {
    // no drag/resize in Fill phase
    return
  }

  interact('.field-overlay')
    .draggable({
      modifiers: [interact.modifiers.restrictRect({ restriction: '.page-wrapper', endOnly: true })],
      listeners: {
        move(evt) {
          const el = evt.target as HTMLElement
          const id = el.dataset.id!
          const pageEl = el.closest('.page-wrapper')!
          const idx = Array.from(canvasCol.value!.children).indexOf(pageEl)
          const f = pages[idx].fields.find((x) => x.id === id)!
          f.rect.x += evt.dx
          f.rect.y += evt.dy
          const { x, y } = clampToInner(f.rect.x, f.rect.y, f.rect.width, f.rect.height, idx)
          f.rect.x = x
          f.rect.y = y
          el.style.left = f.rect.x + 'px'
          el.style.top = f.rect.y + 'px'
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
          const idx = Array.from(canvasCol.value!.children).indexOf(pageEl)
          const f = pages[idx].fields.find((x) => x.id === id)!
          f.rect.x += evt.deltaRect.left
          f.rect.y += evt.deltaRect.top
          f.rect.width = evt.rect.width
          f.rect.height = evt.rect.height

          const { minX, minY, maxX, maxY } = getInnerBounds(idx)
          f.rect.x = Math.max(minX, Math.min(f.rect.x, maxX - f.rect.width))
          f.rect.y = Math.max(minY, Math.min(f.rect.y, maxY - f.rect.height))
          f.rect.width = Math.min(f.rect.width, maxX - f.rect.x)
          f.rect.height = Math.min(f.rect.height, maxY - f.rect.y)

          Object.assign(el.style, {
            left: f.rect.x + 'px',
            top: f.rect.y + 'px',
            width: f.rect.width + 'px',
            height: f.rect.height + 'px',
          })
        },
      },
    })
}

/** --- Toolbar drag & drop --- **/
function onDragStart(e: DragEvent, type: 'signature' | 'initial') {
  if (layoutLocked.value) {
    e.preventDefault()
    return
  }
  dragState.type = type
  dragState.boxW = type === 'signature' ? 150 : 60
  dragState.boxH = 50

  const targetRect = (e.target as HTMLElement).getBoundingClientRect()
  dragState.anchorX = e.clientX - targetRect.left
  dragState.anchorY = e.clientY - targetRect.top

  cleanupDragPreview()
  dragPreviewEl = document.createElement('div')
  dragPreviewEl.style.position = 'fixed'
  dragPreviewEl.style.pointerEvents = 'none'
  dragPreviewEl.style.zIndex = '999999'
  dragPreviewEl.style.width = `${dragState.boxW}px`
  dragPreviewEl.style.height = `${dragState.boxH}px`
  dragPreviewEl.style.border = '2px dashed #6a2a86'
  dragPreviewEl.style.background = 'rgba(106, 42, 134, 0.08)'
  dragPreviewEl.style.boxSizing = 'border-box'
  document.body.appendChild(dragPreviewEl)

  const dummy = document.createElement('canvas')
  dummy.width = dummy.height = 1
  e.dataTransfer?.setDragImage(dummy, 0, 0)

  e.dataTransfer?.setData('fieldType', type)
}

function onDropField(idx: number, e: DragEvent) {
  if (layoutLocked.value) return
  e.preventDefault()

  const type = (e.dataTransfer?.getData('fieldType') as 'signature' | 'initial') || dragState.type
  if (!type) return

  const canvas = pageCanvases.value[idx]
  if (!canvas) return

  const wrapper = canvas.parentElement as HTMLElement
  const wrapperRect = wrapper.getBoundingClientRect()
  const canvasRect = canvas.getBoundingClientRect()

  const xInWrapper = e.clientX - wrapperRect.left
  const yInWrapper = e.clientY - wrapperRect.top

  const canvasLeftInWrapper = canvasRect.left - wrapperRect.left
  const canvasTopInWrapper = canvasRect.top - wrapperRect.top

  const left = canvasLeftInWrapper + (xInWrapper - canvasLeftInWrapper) - dragState.anchorX
  const top = canvasTopInWrapper + (yInWrapper - canvasTopInWrapper) - dragState.anchorY

  const clamped = clampToInner(left, top, dragState.boxW, dragState.boxH, idx)

  pages[idx].fields.push({
    id: uuidv4(),
    type,
    rect: {
      x: clamped.x,
      y: clamped.y,
      width: dragState.boxW,
      height: dragState.boxH,
    },
  })

  cleanupDragPreview()
}

/** Remove field (layout mode only) */
function removeField(pageIdx: number, fieldId: string) {
  if (layoutLocked.value) return
  const list = pages[pageIdx].fields
  const i = list.findIndex((f) => f.id === fieldId)
  if (i >= 0) list.splice(i, 1)
}

/** Click on field - behavior changes by phase */
function onFieldMouseDown(pageIdx: number, fieldId: string) {
  if (!layoutLocked.value) {
    // Layout phase -> do nothing (no editor popup)
    return
  }
  // Fill phase -> open editor
  selectField(pageIdx, fieldId)
}

function selectField(pageIdx: number, fieldId: string) {
  const f = pages[pageIdx].fields.find((x) => x.id === fieldId)!
  currentField.value = { ...f }
}

/** Signature / Initials editor **/
function startDrawingSig() {
  drawingSig.value = true
  nextTick(() => {
    const c = drawPad.value!,
      ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    let drawing = false
    c.onpointerdown = (ev) => {
      drawing = true
      ctx.beginPath()
      ctx.moveTo(ev.offsetX, ev.offsetY)
    }
    c.onpointermove = (ev) => {
      if (!drawing) return
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.lineTo(ev.offsetX, ev.offsetY)
      ctx.stroke()
    }
    const end = () => (drawing = false)
    c.onpointerup = end
    c.onpointerleave = end
  })
}

async function saveDrawn() {
  if (!currentField.value) return
  const blob = await new Promise<Blob>((res) => drawPad.value!.toBlob((b) => res(b!), 'image/png'))
  const buf = await blob.arrayBuffer()

  // Push into real field data
  const idx = pages.findIndex((pg) => pg.fields.some((f) => f.id === currentField.value!.id))
  if (idx >= 0) {
    const f = pages[idx].fields.find((x) => x.id === currentField.value!.id)!
    f.sigBuffer = buf
    f.sigType = 'png'
    // sync editor state
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

  // Sync in editor
  currentField.value.sigBuffer = buf
  currentField.value.sigType = file.type.includes('jpeg') ? 'jpg' : 'png'
}
function clearSignature() {
  if (!currentField.value) return
  currentField.value.sigBuffer = undefined
  currentField.value.sigType = undefined
}

function applyField() {
  if (!currentField.value) return
  const idx = pages.findIndex((pg) => pg.fields.some((f) => f.id === currentField.value!.id))
  if (idx < 0) return
  const list = pages[idx].fields
  const i = list.findIndex((f) => f.id === currentField.value!.id)
  if (i >= 0) {
    // persist new values
    list.splice(i, 1, { ...currentField.value! })
  }
  cancelField()
}
function cancelField() {
  currentField.value = null
}

/** --- Save config => locks the layout (after refresh) --- **/
function saveConfig() {
  const serial = {
    pages: pages.map((p) => ({
      uid: p.uid,
      pageNumber: p.pageNumber,
      pdfBase64: bytesToBase64(p.pdfBytes),
      fields: p.fields.map((f) => ({
        id: f.id,
        type: f.type,
        rect: { ...f.rect },
        initialsText: f.initialsText,
        sigBuffer: f.sigBuffer ? Array.from(new Uint8Array(f.sigBuffer)) : undefined,
        sigType: f.sigType,
      })),
    })),
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serial))
  alert('Configuration saved – please refresh to enter Fill mode.')
}

/** --- Scroll helper --- **/
function scrollToPage(idx: number) {
  const col = canvasCol.value!
  const wrapper = col.querySelectorAll<HTMLElement>('.page-wrapper')[idx]
  if (wrapper) wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/**
 * Convert wrapper-space rect -> normalized PDF coords (all pages same width)
 */
function toPdfCoordsNormalized(
  field: Field,
  pageIndex: number,
  targetPageWidth: number,
  targetPageHeight: number,
) {
  const canvas = pageCanvases.value[pageIndex]
  if (!canvas) return { x: 0, y: 0, w: 0, h: 0 }

  const wrapper = canvas.parentElement as HTMLElement
  const wrapperRect = wrapper.getBoundingClientRect()
  const canvasRect = canvas.getBoundingClientRect()

  const canvasLeftInWrapper = canvasRect.left - wrapperRect.left
  const canvasTopInWrapper = canvasRect.top - wrapperRect.top

  const xInCanvasCss = field.rect.x - canvasLeftInWrapper - PADDING
  const yInCanvasCss = field.rect.y - canvasTopInWrapper - PADDING

  const innerCanvasCssW = canvasRect.width - PADDING * 2
  const innerCanvasCssH = canvasRect.height - PADDING * 2

  const xR = xInCanvasCss / innerCanvasCssW
  const yR = yInCanvasCss / innerCanvasCssH
  const wR = field.rect.width / innerCanvasCssW
  const hR = field.rect.height / innerCanvasCssH

  const w = wR * targetPageWidth
  const h = hR * targetPageHeight
  const x = xR * targetPageWidth
  const y = (1 - (yR + hR)) * targetPageHeight

  return { x, y, w, h }
}

/** --- PDF Signing (normalized widths) --- **/
async function signPdf() {
  if (!pages.length) return
  isLoading.value = true

  try {
    const srcDocs = await Promise.all(pages.map((p) => PDFDocument.load(p.pdfBytes)))
    const srcLibPages = srcDocs.map((d, i) => d.getPages()[pages[i].pageNumber - 1])

    // common width
    const targetWidth = Math.max(...srcLibPages.map((p) => p.getWidth()))

    const outPdf = await PDFDocument.create()
    const font = await outPdf.embedFont(StandardFonts.HelveticaBold)

    for (let i = 0; i < pages.length; i++) {
      const srcPage = srcLibPages[i]
      const origW = srcPage.getWidth()
      const origH = srcPage.getHeight()
      const scale = targetWidth / origW
      const targetH = origH * scale

      const outPage = outPdf.addPage([targetWidth, targetH])

      const embedded = await outPdf.embedPage(srcPage)
      outPage.drawPage(embedded, {
        x: 0,
        y: 0,
        width: targetWidth,
        height: targetH,
      })

      for (const field of pages[i].fields) {
        const { x, y, w, h } = toPdfCoordsNormalized(field, i, targetWidth, targetH)

        if (field.type === 'signature' && field.sigBuffer) {
          const img =
            field.sigType === 'png'
              ? await outPdf.embedPng(field.sigBuffer)
              : await outPdf.embedJpg(field.sigBuffer)
          outPage.drawImage(img, { x, y, width: w, height: h })
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

    const pdfBytes = await outPdf.save()
    const blob = new Blob([pdfBytes], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)

    // open in new tab
    window.open(url, '_blank', 'noopener,noreferrer')

    // (optional) also trigger download:
    // const a = document.createElement('a')
    // a.href = url
    // a.download = `signed_${new Date().toISOString().slice(0, 10)}.pdf`
    // a.click()

    setTimeout(() => URL.revokeObjectURL(url), 10000)
  } catch (err) {
    console.error('PDF signing error:', err)
    alert('Error generating signed PDF. Please try again.')
  } finally {
    isLoading.value = false
  }
}

/** --- Remove & Replace --- **/
async function removePage(idx: number) {
  pages.splice(idx, 1)
  await nextTick()
  await generateThumbnails()
  await renderAllPages()
}
async function onReplacePdfUpload(idx: number, e: Event) {
  const inp = e.target as HTMLInputElement
  if (!inp.files?.length) return
  const file = inp.files[0]
  inp.value = ''
  const buf = await file.arrayBuffer(),
    bytes = new Uint8Array(buf)
  pages[idx].pdfBytes = bytes
  pages[idx].pageNumber = 1
  pages[idx].fields = []
  layoutLocked.value = false // you replaced a page, so you are back to layout phase for that page set
  await generateThumbnail(idx)
  await renderAllPages()
}
</script>

<style scoped>
/* ---------- Layout ---------- */
.pdf-signer-container {
  display: flex;
  height: 100vh;
  background: #f5f5f5;
  font-family:
    system-ui,
    -apple-system,
    Segoe UI,
    Roboto,
    sans-serif;
}
.col {
  padding: 1rem;
  box-sizing: border-box;
  height: 100%;
}

/* ---------- Thumbs ---------- */
.thumbs-col {
  width: 15%;
  background: white;
  border-right: 1px solid #ddd;
  display: flex;
  flex-direction: column;
}
.thumbs-scroll {
  flex: 1 1 auto;
  overflow-y: auto;
  padding-right: 4px;
}
.fixed-footer {
  flex: 0 0 auto;
  position: sticky;
  bottom: 0;
  background: white;
  padding-top: 0.75rem;
  border-top: 1px solid #eee;
}
.thumb-wrapper {
  position: relative;
  margin-bottom: 0.75rem;
  cursor: pointer;
  border: 1px solid #eee;
  border-radius: 6px;
  overflow: hidden;
}
.thumb {
  width: 100%;
  display: block;
}
.thumb-overlay.improved {
  position: absolute;
  inset: 0;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  opacity: 0;
  transition: opacity 0.15s;
}
.thumb-wrapper:hover .thumb-overlay.improved {
  opacity: 1;
  background: rgba(255, 255, 255, 0.6);
}
.thumb-close {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.75);
  color: #fff;
  cursor: pointer;
  line-height: 24px;
  text-align: center;
}
.thumb-replace-pill {
  position: absolute;
  top: 6px;
  left: 50%;
  transform: translateX(-50%);
  background: #3b0f5c;
  color: #fff;
  border: none;
  border-radius: 999px;
  padding: 4px 14px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.hidden-input {
  display: none;
}
.thumbs-footer {
  text-align: center;
  margin-top: 1rem;
}
.big-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  background: #f7f2f9;
  color: #3b0f5c;
  border: 2px solid #3b0f5c;
  border-radius: 999px;
  padding: 0.65rem 1rem;
  cursor: pointer;
  font-size: 14px;
}

/* ---------- Canvas column ---------- */
.canvas-col {
  flex: 1;
  overflow-y: auto;
  margin: 0 1rem;
}
.page-wrapper {
  position: relative;
  margin-bottom: 2rem;
}
.pdf-canvas {
  width: 100% !important;
  height: auto !important;
  background: white;
  border: 1px solid #eee;
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.1);
}

/* ---------- Field overlay ---------- */
.field-overlay {
  position: absolute;
  border: 2px dashed #6a2a86;
  background: rgba(106, 42, 134, 0.08);
  box-sizing: border-box;
  border-radius: 4px;
  cursor: pointer; /* <- rule #4 */
  touch-action: none;
}
.field-overlay.locked {
  /* when locked, just for clarity if you want a slightly different look */
  border-style: solid;
}
.field-delete {
  position: absolute;
  top: -10px;
  right: -10px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #ff4d4f;
  color: #fff;
  border: none;
  font-size: 12px;
  line-height: 20px;
  text-align: center;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
}
.field-overlay.initial::before {
  content: 'Initials';
  position: absolute;
  top: -18px;
  left: 50%;
  transform: translateX(-50%);
  background: #000;
  color: #fff;
  padding: 2px 6px;
  border-radius: 2px;
  font-size: 10px;
}
.sig-img {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.sig-icon {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 1.2em;
}
.initial-text {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 1em;
  color: #000;
}

/* ---------- Toolbar ---------- */
.toolbar-col {
  width: 15%;
  background: white;
  border-left: 1px solid #ddd;
  display: flex;
  flex-direction: column;
  padding: 1rem;
}
.field-selector {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 1rem;
}
.field-card {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  border: 2px dashed #ccc;
  border-radius: 6px;
  background: #fafafa;
  cursor: grab;
}
.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.field-card:hover {
  background: white;
  border-color: #bbb;
}
.drag-handle {
  font-size: 1rem;
  color: #888;
}
.field-icon {
  font-size: 1.25rem;
}
.field-label {
  font-size: 0.9rem;
  font-weight: 500;
}

hr {
  margin: 0.5rem 0 1rem;
  border: none;
  border-top: 1px solid #eee;
}
.action-btn {
  width: 100%;
  padding: 0.65rem;
  margin-bottom: 0.5rem;
  background: #f0f0f0;
  border: 1px solid #ddd;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
}
.action-btn.primary {
  background: #3b0f5c;
  border-color: #3b0f5c;
  color: #fff;
}
.action-btn:hover {
  background: #e0e0e0;
}
.action-btn:last-of-type {
  margin-bottom: 0;
}

/* ---------- Editor Panel (modal look) ---------- */
.field-panel {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: #f9f7f8;
  padding: 1rem 1.25rem;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.2);
  border: 1px solid #eee;
  border-radius: 12px;
  display: none;
  z-index: 1000;
  min-width: 640px;
}
.field-panel.active {
  display: block;
}
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}
.panel-close {
  background: transparent;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: #3b0f5c;
}
.sig-actions {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
.pill {
  border-radius: 999px;
  padding: 0.4rem 0.9rem;
  border: 2px solid #3b0f5c;
  background: #fff;
  color: #3b0f5c;
  cursor: pointer;
  font-weight: 600;
}
.pill.success {
  border-color: #2e7d32;
  color: #2e7d32;
}
.pill.danger {
  border-color: #c62828;
  color: #c62828;
}

/* faint just inside the draw pad action area */
.pill.faint {
  background: #f7f7f7;
  border-color: #e1e1e1;
  color: #555;
  font-weight: 500;
}

.sig-preview {
  background: #fff;
  border: 1px solid #e5e2e2;
  border-radius: 10px;
  padding: 0.75rem;
  max-height: 220px;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
}
.draw-pad {
  border: 1px solid #ccc;
  background: transparent !important;
  width: 600px;
  height: 200px;
  margin-bottom: 0.5rem;
  border-radius: 8px;
}
.draw-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}
.preview-img {
  max-width: 100%;
  max-height: 200px;
  display: block;
}
.initials-config {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.initials-label {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-weight: 600;
}
.initials-input {
  border: 2px solid #3b0f5c33;
  border-radius: 8px;
  padding: 0.5rem 0.75rem;
  font-size: 1rem;
  width: 120px;
}
.panel-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
  justify-content: flex-end;
}

/* ---------- Misc ---------- */
.loader {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  font-size: 1.2rem;
  color: #555;
}
.initial-upload-container {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}
.drop-area {
  width: 100%;
  background: #f5f2f2;
  border: 2px dashed #ccc;
  border-radius: 8px;
  padding: 3rem 2rem;
  text-align: center;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  transition:
    background 0.2s,
    border-color 0.2s;
}
.drop-area:hover {
  background: #fafafa;
  border-color: #bbb;
}
.drop-icon {
  font-size: 3rem;
  margin-bottom: 1rem;
}
.drop-text {
  font-size: 1.25rem;
  color: #666;
}

.sig-placeholder {
  color: #888;
  font-size: 0.9rem;
  text-align: center;
  width: 100%;
}

/* When locked, keep the columns' space but make them invisible & non-interactive */
/* .pdf-signer-container.locked .thumbs-col,
.pdf-signer-container.locked .toolbar-col {
  visibility: hidden; 
  pointer-events: none;
  opacity: 0;
} */

/* Drop zone style */
/* New dropzone that matches the screenshot */
.dropzone {
  width: 100%;
  min-height: 360px;
  border: 2px dashed #e5e7eb; /* light gray dashed */
  border-radius: 12px; /* rounded corners like the shot */
  background: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    box-shadow 0.15s ease;
}

.dropzone.drag-over,
.dropzone:hover {
  border-color: #9ca3af; /* a bit darker gray on hover/drag */
  background: #fafafa;
}

.dz-icon {
  width: 48px;
  height: 48px;
  margin-bottom: 18px;
  color: #111; /* black like the screenshot */
}

.dz-title {
  margin: 0 0 6px;
  font-size: 17px;
  line-height: 1.2;
  font-weight: 600;
  color: #424242;
}

.dz-subtitle {
  margin: 0;
  font-size: 16px;
  color: #6b7280; /* muted gray */
}

/* keep your hidden input utility */
.hidden-input {
  display: none;
}
</style>

<template>
  <div class="pdf-signer-container">
    <!-- Left thumbnails & “Add PDF” (appends) -->
    <div class="col thumbs-col">
      <div>
        <div
          v-for="(p, idx) in pages"
          :key="p.uid"
          class="thumb-wrapper"
          @click="scrollToPage(idx)"
        >
          <img :src="p.thumbnailUrl" class="thumb" />

          <!-- overlay shown on hover -->
          <div class="thumb-overlay">
            <button class="overlay-btn" @click.stop="removePage(idx)">🗑 Remove</button>
            <label class="overlay-btn replace-label">
              🔄 Replace
              <input
                type="file"
                accept="application/pdf"
                class="hidden-input"
                @change="onReplacePdfUpload(idx, $event)"
              />
            </label>
          </div>
        </div>

        <div class="thumbs-footer" v-if="pages.length > 0">
          <label class="add-doc-btn">
            ➕ ADD DOCUMENTS
            <input
              type="file"
              accept="application/pdf"
              multiple
              @change="onAddPdfUpload"
              class="hidden-input"
            />
          </label>
        </div>
        <div v-else>No document uploaded yet.</div>
      </div>
    </div>

    <!-- Middle: drop‑zone or all page canvases -->
    <div class="col canvas-col" ref="canvasCol">
      <div v-if="pages.length === 0" class="initial-upload-container">
        <label class="drop-area" @dragover.prevent @drop.prevent="onDropDocuments">
          <div class="drop-icon">📄⬆️</div>
          <div class="drop-text">Add documents</div>
          <input
            type="file"
            accept="application/pdf"
            multiple
            @change="onPdfUpload"
            class="hidden-input"
          />
        </label>
      </div>
      <div
        v-for="(p, idx) in pages"
        :key="p.uid"
        class="page-wrapper"
        @dragover.prevent
        @drop="onDropField(idx, $event)"
      >
        <h4>Page {{ idx + 1 }}</h4>
        <canvas
          :ref="(el) => (pageCanvases[idx] = el as HTMLCanvasElement | null)"
          class="pdf-canvas"
          @mousedown="(e) => onMouseDown(idx, e)"
          @mousemove="(e) => canDraw && onMouseMove(idx, e)"
          @mouseup="(e) => onMouseUp(idx, e)"
          @click="(e) => onCanvasClick(idx, e)"
        />
      </div>
    </div>

    <!-- Right toolbar -->
    <div class="col toolbar-col">
      <button
        :disabled="!canDraw"
        :class="{ active: mode === 'place-signature', disabled: !canDraw }"
        @click="toggleMode('place-signature')"
        draggable="true"
        @dragstart="(e) => onDragStart(e, 'signature')"
      >
        ✒️ Place Signature
      </button>

      <button
        :disabled="!canDraw"
        :class="{ active: mode === 'place-initial', disabled: !canDraw }"
        @click="toggleMode('place-initial')"
        draggable="true"
        @dragstart="(e) => onDragStart(e, 'initial')"
      >
        🔤 Place Initial
      </button>

      <hr />
      <button @click="saveConfig">💾 Save Config</button>
      <button @click="signPdf">🖋️ Sign PDF</button>
    </div>

    <!-- Floating editor panel -->
    <div v-if="currentField && !canDraw" class="field-panel active">
      <h3>{{ currentField.type === 'signature' ? 'Signature' : 'Initials' }}</h3>

      <div v-if="currentField.type === 'signature'" class="sig-config">
        <button @click="startDrawingSig">✏️ Draw Signature</button>
        <label class="upload-pdf-btn">
          📷 Upload Signature Image
          <input
            ref="sigInput"
            type="file"
            accept="image/png,image/jpeg"
            @change="onSigSelected"
            class="hidden-input"
          />
        </label>

        <div v-if="drawingSig" class="draw-container">
          <canvas ref="drawPad" class="draw-pad" width="600" height="200"></canvas>
          <button @click="saveDrawn">✔️ Save Drawing</button>
          <button @click="cancelDrawing">✖️ Cancel</button>
        </div>

        <div v-if="currentField.sigBuffer">
          <img :src="getSigUrl(currentField)" class="preview-img" />
          <button @click="clearSignature">❌ Clear Signature</button>
        </div>
      </div>

      <div v-else class="initials-config">
        <label>
          Enter Initials:
          <input v-model="currentField.initialsText" placeholder="EJ" maxlength="3" />
        </label>
      </div>

      <div class="panel-actions">
        <button @click="applyField">Apply</button>
        <button @click="cancelField">Cancel</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, nextTick, watch } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import type { PageViewport, PDFPageProxy } from 'pdfjs-dist'
import { v4 as uuidv4 } from 'uuid'

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
const pageCtxs = ref<(CanvasRenderingContext2D | null)[]>([])
const pageImageDatas = ref<(ImageData | null)[]>([])
const renderTasks = ref<(RenderTask | null)[]>([])

const mode = ref<'idle' | 'place-signature' | 'place-initial'>('idle')
const canDraw = ref(true)

const isSelecting = ref(false)
const startX = ref(0)
const startY = ref(0)
const activePageIdx = ref<number | null>(null)

const currentField = ref<Field | null>(null)
const drawingSig = ref(false)
const tempSigUrl = ref<string | null>(null)
const sigInput = ref<HTMLInputElement | null>(null)
const drawPad = ref<HTMLCanvasElement | null>(null)
const canvasCol = ref<HTMLDivElement | null>(null)

/** --- Helpers & Constants --- **/
const PADDING = 6,
  SCALE = 1.25,
  DPR = window.devicePixelRatio || 1
const cloneBytes = (u: Uint8Array) => new Uint8Array(u)
const getRatio = (c: HTMLCanvasElement) => c.width / c.clientWidth
const getSigUrl = (f: Field) =>
  f.sigBuffer
    ? URL.createObjectURL(
        new Blob([f.sigBuffer], { type: f.sigType === 'png' ? 'image/png' : 'image/jpeg' }),
      )
    : ''

watch(
  () => pages.length,
  (len) => {
    pageCanvases.value = Array(len).fill(null)
    pageCtxs.value = Array(len).fill(null)
    pageImageDatas.value = Array(len).fill(null)
    renderTasks.value = Array(len).fill(null)
  },
  { immediate: true },
)

/** --- Load saved config --- **/
onMounted(async () => {
  const raw = localStorage.getItem('pdfSignerConfigV5')
  if (!raw) return
  const saved: Array<{
    uid: string
    pageNumber: number
    pdfBase64: string
    fields: Array<Omit<Field, 'sigBuffer'> & { sigBuffer?: number[] }>
  }> = JSON.parse(raw)

  saved.forEach((s) => {
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

  canDraw.value = false
  await nextTick()
  await generateThumbnails()
  await nextTick()
  await renderAllPages()
})

/** --- PDF append & upload handlers --- **/
async function appendPdfs(files: FileList) {
  const valid = Array.from(files).filter((f) => f.size > 0 && f.type === 'application/pdf')
  for (const file of valid) {
    const buf = await file.arrayBuffer()
    const bytes = new Uint8Array(buf)
    const doc = await pdfjsLib.getDocument({ data: cloneBytes(bytes) }).promise
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i)
      const opList = await pg.getOperatorList()
      if (opList.fnArray.length === 0) continue
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
  pages.splice(0)
  await appendPdfs(inp.files)
  inp.value = ''
  canDraw.value = true
  await nextTick()
  await generateThumbnails()
  await nextTick()
  await renderAllPages()
}

async function onAddPdfUpload(e: Event) {
  const inp = e.target as HTMLInputElement
  if (!inp.files?.length) return
  await appendPdfs(inp.files)
  inp.value = ''
  canDraw.value = true
  await nextTick()
  await generateThumbnails()
  await nextTick()
  await renderAllPages()
}

/** --- NEW: drop‑handler for the big box --- **/
async function onDropDocuments(e: DragEvent) {
  const files = e.dataTransfer?.files
  if (!files?.length) return
  pages.splice(0)
  await appendPdfs(files)
  canDraw.value = true
  await nextTick()
  await generateThumbnails()
  await nextTick()
  await renderAllPages()
}

/** --- Thumbnails & rendering --- **/
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
  for (let i = 0; i < pages.length; i++) {
    await renderPage(i)
  }
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
  pageCtxs.value[idx] = ctx
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.setTransform(DPR, 0, 0, DPR, PADDING * DPR, PADDING * DPR)

  const task = pg.render({ canvasContext: ctx, viewport: vp })
  renderTasks.value[idx] = task
  await task.promise

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  pageImageDatas.value[idx] = ctx.getImageData(0, 0, canvas.width, canvas.height)
  drawFieldsOnPage(idx)
}

function drawFieldsOnPage(idx: number) {
  const ctx = pageCtxs.value[idx],
    img = pageImageDatas.value[idx]
  if (!ctx || !img) return
  ctx.putImageData(img, 0, 0)

  pages[idx].fields.forEach((f) => {
    const x = (f.rect.x + PADDING) * DPR,
      y = (f.rect.y + PADDING) * DPR,
      w = f.rect.width * DPR,
      h = f.rect.height * DPR

    ctx.save()
    ctx.strokeStyle = f.type === 'signature' ? 'blue' : 'green'
    ctx.lineWidth = 2 * DPR
    ctx.strokeRect(x, y, w, h)

    if (f.type === 'signature' && !f.sigBuffer) {
      ctx.font = '' + Math.min(16, h / 2) * DPR + 'px sans-serif'
      ctx.fillStyle = 'blue'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('✍️', x + w / 2, y + h / 2)
    }

    if (f.type === 'initial') {
      ctx.font = 10 * DPR + 'px sans-serif'
      ctx.fillStyle = 'green'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillText('INITIALS', x + w / 2, y - 5 * DPR)
    }

    if (f.type === 'initial' && f.initialsText) {
      ctx.font = Math.min(14, h / 2) * DPR + 'px sans-serif'
      ctx.fillStyle = 'green'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(f.initialsText, x + w / 2, y + h / 2)
    }

    if (f.type === 'signature' && f.sigBuffer) {
      const imgEl = new Image()
      imgEl.onload = () => {
        ctx.drawImage(imgEl, x, y, w, h)
        ctx.restore()
      }
      imgEl.src = getSigUrl(f)
    } else {
      ctx.restore()
    }
  })
}

/** --- Interaction handlers --- **/
function scrollToPage(idx: number) {
  const col = canvasCol.value!
  const wrapper = col.querySelectorAll<HTMLElement>('.page-wrapper')[idx]
  if (wrapper) wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function toggleMode(m: 'place-signature' | 'place-initial') {
  if (!canDraw.value) return
  mode.value = mode.value === m ? 'idle' : m
}

function onDragStart(e: DragEvent, type: 'signature' | 'initial') {
  if (!canDraw.value) return
  e.dataTransfer?.setData('fieldType', type)
}

function onDropField(idx: number, e: DragEvent) {
  if (!canDraw.value) return
  const type = e.dataTransfer?.getData('fieldType') as 'signature' | 'initial'
  if (!type) return

  const canvas = pageCanvases.value[idx]!,
    r = canvas.getBoundingClientRect()

  // 🛠️ Store CSS‑px coordinates:
  const xCss = e.clientX - r.left - PADDING
  const yCss = e.clientY - r.top - PADDING
  const wCss = type === 'signature' ? 150 : 60
  const hCss = 50

  pages[idx].fields.push({
    id: uuidv4(),
    type,
    rect: { x: xCss, y: yCss, width: wCss, height: hCss },
  })

  drawFieldsOnPage(idx)
}

function onMouseDown(idx: number, e: MouseEvent) {
  if (!canDraw.value || mode.value === 'idle') return
  const canvas = pageCanvases.value[idx]!
  isSelecting.value = true
  activePageIdx.value = idx
  const r = canvas.getBoundingClientRect(),
    ratio = getRatio(canvas)
  startX.value = (e.clientX - r.left - PADDING) * ratio
  startY.value = (e.clientY - r.top - PADDING) * ratio
}

function onMouseMove(idx: number, e: MouseEvent) {
  if (!isSelecting.value || activePageIdx.value !== idx) return
  const canvas = pageCanvases.value[idx]!,
    ctx = pageCtxs.value[idx]!,
    img = pageImageDatas.value[idx]!,
    ratio = getRatio(canvas)
  const r = canvas.getBoundingClientRect()
  const cx = (e.clientX - r.left - PADDING) * ratio,
    cy = (e.clientY - r.top - PADDING) * ratio
  ctx.putImageData(img, 0, 0)
  drawFieldsOnPage(idx)
  const x = Math.min(startX.value, cx),
    y = Math.min(startY.value, cy),
    w = Math.abs(cx - startX.value),
    h = Math.abs(cy - startY.value)
  ctx.strokeStyle = 'red'
  ctx.lineWidth = 2 * DPR
  ctx.strokeRect(x, y, w, h)
}

function onMouseUp(idx: number, e: MouseEvent) {
  if (!isSelecting.value || activePageIdx.value !== idx) return
  isSelecting.value = false

  const canvas = pageCanvases.value[idx]!,
    r = canvas.getBoundingClientRect(),
    ratio = getRatio(canvas)

  // subtract CSS-padding, *then* scale:
  const ex = (e.clientX - r.left - PADDING) * ratio
  const ey = (e.clientY - r.top - PADDING) * ratio

  const x = Math.min(startX.value, ex),
    y = Math.min(startY.value, ey),
    w = Math.abs(ex - startX.value),
    h = Math.abs(ey - startY.value)

  if (w < 5 || h < 5) return

  pages[idx].fields.push({
    id: uuidv4(),
    type: mode.value === 'place-signature' ? 'signature' : 'initial',
    rect: { x: x / DPR, y: y / DPR, width: w / DPR, height: h / DPR },
  })

  drawFieldsOnPage(idx)
}

function onCanvasClick(idx: number, e: MouseEvent) {
  // Only open the editor if we're NOT in the middle of placing something:
  if (mode.value !== 'idle') return

  const canvas = pageCanvases.value[idx]!,
    r = canvas.getBoundingClientRect(),
    ratio = getRatio(canvas)

  // Subtract the CSS padding BEFORE scaling:
  const cx = (e.clientX - r.left - PADDING) * ratio
  const cy = (e.clientY - r.top - PADDING) * ratio

  const hit = pages[idx].fields.find((f) => {
    const L = f.rect.x * DPR,
      R = (f.rect.x + f.rect.width) * DPR,
      T = f.rect.y * DPR,
      B = (f.rect.y + f.rect.height) * DPR
    return cx >= L && cx <= R && cy >= T && cy <= B
  })

  if (!hit) return

  // Populate currentField and flip into “edit” mode
  currentField.value = { ...hit }
  activePageIdx.value = idx
  tempSigUrl.value = hit.sigBuffer ? getSigUrl(hit) : null
  drawingSig.value = false
}

/** --- Signature / Initials editing --- **/
async function onSigSelected(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file || !currentField.value) return
  const buf = await file.arrayBuffer()
  currentField.value.sigBuffer = buf
  currentField.value.sigType = file.type.includes('jpeg') ? 'jpg' : 'png'
  tempSigUrl.value = URL.createObjectURL(new Blob([buf], { type: file.type }))
  drawingSig.value = false
}

function clearSignature() {
  if (!currentField.value) return
  currentField.value.sigBuffer = undefined
  currentField.value.sigType = undefined
  tempSigUrl.value = null
}

function startDrawingSig() {
  drawingSig.value = true
  tempSigUrl.value = null
  nextTick(() => {
    const c = drawPad.value!,
      ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    c.onpointerdown = drawStart
    c.onpointermove = drawMove
    c.onpointerup = drawEnd
    c.onpointerleave = drawEnd
  })
}

let drawing = false
function drawStart(ev: PointerEvent) {
  drawing = true
  const ctx = drawPad.value!.getContext('2d')!
  ctx.beginPath()
  ctx.moveTo(ev.offsetX, ev.offsetY)
}
function drawMove(ev: PointerEvent) {
  if (!drawing) return
  const ctx = drawPad.value!.getContext('2d')!
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.lineTo(ev.offsetX, ev.offsetY)
  ctx.stroke()
}
function drawEnd() {
  drawing = false
}

async function saveDrawn() {
  if (!currentField.value) return
  const blob = await new Promise<Blob>((res) => drawPad.value!.toBlob((b) => res(b!), 'image/png'))
  const buf = await blob.arrayBuffer()
  const idx = activePageIdx.value
  if (idx !== null) {
    const field = pages[idx].fields.find((f) => f.id === currentField.value!.id)
    if (field) {
      field.sigBuffer = buf
      field.sigType = 'png'
      drawFieldsOnPage(idx)
    }
  }
  currentField.value = null
  tempSigUrl.value = null
  drawingSig.value = false
}
function cancelDrawing() {
  drawingSig.value = false
  tempSigUrl.value = null
}

/** --- Apply / cancel field edit --- **/
function applyField() {
  if (!currentField.value || activePageIdx.value === null) return
  const list = pages[activePageIdx.value].fields
  const i = list.findIndex((f) => f.id === currentField.value!.id)
  if (i >= 0) list.splice(i, 1, { ...currentField.value })
  else {
    if (currentField.value.type === 'initial' && !currentField.value.initialsText) {
      currentField.value.initialsText = prompt('Enter initials') || ''
    }
    list.push({ ...currentField.value })
  }
  currentField.value = null
  tempSigUrl.value = null
  drawingSig.value = false
  drawFieldsOnPage(activePageIdx.value)
}
function cancelField() {
  if (currentField.value?.id && activePageIdx.value !== null) {
    drawFieldsOnPage(activePageIdx.value)
  }
  currentField.value = null
  tempSigUrl.value = null
  drawingSig.value = false
}

/** --- Save config & Sign PDF --- **/
function saveConfig() {
  const serial = pages.map((p) => ({
    uid: p.uid,
    pageNumber: p.pageNumber,
    pdfBase64: btoa(String.fromCharCode(...p.pdfBytes)),
    fields: p.fields.map((f) => ({
      ...f,
      sigBuffer: f.sigBuffer ? Array.from(new Uint8Array(f.sigBuffer)) : undefined,
    })),
  }))
  localStorage.setItem('pdfSignerConfigV5', JSON.stringify(serial))
  alert('Configuration saved')
}

/**
 * Map your CSS‑px rect into PDF points, with origin at bottom‑left
 */
function toPdfCoords(f: Field, pageH: number) {
  // convert width/height directly:
  const w = f.rect.width / SCALE
  const h = f.rect.height / SCALE

  // X is just CSS‑px → PDF‑pt
  const x = f.rect.x / SCALE

  // Y = (distance from top in CSS‑px)/SCALE, then flipped to bottom‑left origin
  const y = pageH - f.rect.y / SCALE - h

  return { x, y, w, h }
}

async function signPdf() {
  if (!pages.length) return

  const newPdf = await PDFDocument.create()
  const font = await newPdf.embedFont(StandardFonts.HelveticaBold)

  // Record only the first page’s width
  let stdW!: number

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]
    const src = await PDFDocument.load(p.pdfBytes)
    const [cop] = await newPdf.copyPages(src, [p.pageNumber - 1])

    if (i === 0) {
      stdW = cop.getWidth()
    } else {
      // set width to stdW, but leave height at its natural value
      cop.setSize(stdW, cop.getHeight())
    }

    newPdf.addPage(cop)
  }

  // Draw all your fields onto each page
  for (let idx = 0; idx < pages.length; idx++) {
    const p = pages[idx]
    const page = newPdf.getPage(idx)
    const H = page.getHeight() // now the true height of this page

    for (const f of p.fields) {
      const { x, y, w, h } = toPdfCoords(f, H)

      if (f.type === 'signature' && f.sigBuffer && f.sigType) {
        const img =
          f.sigType === 'png'
            ? await newPdf.embedPng(f.sigBuffer)
            : await newPdf.embedJpg(f.sigBuffer)
        page.drawImage(img, { x, y, width: w, height: h })
      }

      if (f.type === 'initial' && f.initialsText) {
        const txt = f.initialsText.trim()
        let size = Math.min(h * 0.7, 24)
        while (font.widthOfTextAtSize(txt, size) > w - 4 && size > 6) {
          size -= 0.5
        }
        const tw = font.widthOfTextAtSize(txt, size)
        const tx = x + (w - tw) / 2
        const ty = y + (h - size) / 2
        page.drawText(txt, { x: tx, y: ty, size, font, color: rgb(0, 0.5, 0) })
      }
    }
  }

  // Save & download as before...
  const out = await newPdf.save()
  const blob = new Blob([out], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'signed.pdf'
  a.click()
  window.open(url, '_blank')
}

/** --- Remove & Replace helpers --- **/
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
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)

  pages[idx].pdfBytes = bytes
  pages[idx].pageNumber = 1
  pages[idx].fields = []

  await generateThumbnail(idx)
  await renderPage(idx)
}
</script>

<style scoped>
.pdf-signer-container {
  display: flex;
  height: 100vh;
  font-family: sans-serif;
  background: #f5f5f5;
}
.col {
  padding: 1rem;
  height: 100%;
  box-sizing: border-box;
}
.thumbs-col {
  width: 15%;
  overflow-y: auto;
  border-right: 1px solid #ddd;
  background: white;
}
.thumb-wrapper {
  position: relative;
  margin-bottom: 0.5rem;
  text-align: center;
  cursor: pointer;
  border: 1px solid #eee;
  padding: 2px;
}
.thumb-wrapper:hover {
  border-color: #ccc;
}
.thumb {
  width: 100%;
  display: block;
}
.thumbs-footer {
  text-align: center;
  margin-top: 1rem;
}
.canvas-col {
  flex: 1 1 auto;
  overflow-y: auto;
  margin: 0 1rem;
  background: white;
  box-shadow: 0 0 8px rgba(0, 0, 0, 0.1);
}
.page-wrapper {
  margin-bottom: 2rem;
  padding: 10px;
  background: white;
  border: 1px solid #ddd;
}
.pdf-canvas {
  width: 100% !important;
  height: auto !important;
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.1);
  background: white;
  border: 1px solid #eee;
}
.toolbar-col {
  width: 15%;
  border-left: 1px solid #ddd;
  background: white;
}
.toolbar-col button {
  width: 100%;
  margin-bottom: 0.5rem;
  padding: 0.5rem;
  background: #f0f0f0;
  border: 1px solid #ddd;
  border-radius: 4px;
  cursor: pointer;
}
.toolbar-col button:hover {
  background: #e0e0e0;
}
.toolbar-col .disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.toolbar-col .active {
  background: #007bcc;
  color: white;
  border-color: #006bb3;
}
.upload-pdf-btn,
.add-doc-btn {
  display: inline-block;
  cursor: pointer;
  margin-top: 0.5rem;
  padding: 0.5rem;
  background: #f0f0f0;
  border-radius: 4px;
  border: 1px solid #ddd;
}
.upload-pdf-btn:hover,
.add-doc-btn:hover {
  background: #e0e0e0;
}
.hidden-input {
  display: none;
}
.field-panel {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: white;
  padding: 1rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  border-radius: 6px;
  z-index: 1000;
  max-width: 90%;
  border: 1px solid #ddd;
  display: none;
}
.field-panel.active {
  display: block;
}
.sig-config,
.initials-config {
  margin-bottom: 0.75rem;
}
.panel-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
}
.panel-actions button {
  flex: 1;
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  cursor: pointer;
}
.panel-actions button:first-child {
  background: #4caf50;
  color: white;
}
.panel-actions button:last-child {
  background: #f44336;
  color: white;
}
.draw-pad {
  border: 1px solid #ccc;
  width: 600px;
  height: 200px;
  margin-bottom: 0.5rem;
  background: white;
}
.preview-img {
  max-width: 200px;
  display: block;
  margin: 0.5rem auto;
  border: 1px solid #ddd;
}
.tooltip {
  position: fixed;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  pointer-events: none;
  z-index: 100;
  transform: translate(-50%, -100%);
}
/* Thumbnails overlay */
.thumb-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(200, 200, 200, 0.5);
  display: none;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 0.5rem;
}
.thumb-wrapper:hover .thumb-overlay {
  display: flex;
}
.overlay-btn {
  background: white;
  border: 1px solid #888;
  border-radius: 4px;
  padding: 0.25rem 0.5rem;
  cursor: pointer;
}
.overlay-btn:hover {
  background: #eee;
}
.replace-label {
  display: inline-flex;
  align-items: center;
  cursor: pointer;
}
.replace-label .hidden-input {
  display: none;
}
/* drop‑zone */
.initial-upload-container {
  height: 100%;
  display: flex;
  justify-content: center;
}
.drop-area {
  border: 2px dashed #ccc;
  border-radius: 8px;
  padding: 3rem 2rem;
  text-align: center;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  transition:
    background 0.2s,
    border-color 0.2s;
  width: 100%;
  background: #f5f2f2;
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
</style>

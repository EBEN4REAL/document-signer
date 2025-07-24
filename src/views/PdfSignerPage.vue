<template>
  <div class="pdf-signer-container">
    <!-- Left thumbnails & “Add PDF” -->
    <div class="col thumbs-col">
      <div>
        <div
          v-for="(p, idx) in pages"
          :key="p.uid"
          class="thumb-wrapper"
          @click="scrollToPage(idx)"
        >
          <img :src="p.thumbnailUrl" class="thumb" />
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

        <div class="thumbs-footer" v-if="pages.length">
          <label class="add-doc-btn">
            ➕ ADD DOCUMENTS
            <input
              type="file"
              accept="application/pdf"
              multiple
              class="hidden-input"
              @change="onAddPdfUpload"
            />
          </label>
        </div>
        <div v-else>No document uploaded yet.</div>
      </div>
    </div>

    <!-- Canvas area -->
    <div class="col canvas-col" ref="canvasCol">
      <div v-if="!pages.length" class="initial-upload-container">
        <div v-if="isLoading" class="loader">Loading PDF...</div>
        <label v-else class="drop-area" @dragover.prevent @drop.prevent="onDropDocuments">
          <div class="drop-icon">📄⬆️</div>
          <div class="drop-text">Add documents</div>
          <input
            type="file"
            accept="application/pdf"
            multiple
            class="hidden-input"
            @change="onPdfUpload"
          />
        </label>
      </div>

      <div
        v-for="(p, idx) in pages"
        :key="p.uid"
        class="page-wrapper"
      >
        <h4>Page {{ idx + 1 }}</h4>
        <canvas
          :ref="el => (pageCanvases[idx] = el as HTMLCanvasElement | null)"
          class="pdf-canvas"
          @dragover.prevent
          @drop="onDropField(idx, $event)"
        />

        <!-- Interactive overlays -->
        <div
          v-for="f in p.fields"
          :key="f.id"
          class="field-overlay"
          :class="f.type"
          :data-id="f.id"
          :style="{
            left: f.rect.x + 'px',
            top: f.rect.y + 'px',
            width: f.rect.width + 'px',
            height: f.rect.height + 'px'
          }"
          @mousedown.stop="f.editable && selectField(idx, f.id)"
        >
          <!-- Signature image if present -->
          <img
            v-if="f.type === 'signature' && f.sigBuffer"
            :src="getSigUrl(f)"
            class="sig-img"
          />
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
          draggable="true"
          @dragstart="e => onDragStart(e, 'signature')"
          @click="() => toggleMode('place-signature')"
        >
          <span class="drag-handle">⋮⋮</span>
          <span class="field-icon">✒️</span>
          <span class="field-label">Signature</span>
        </div>
        <div
          class="field-card"
          draggable="true"
          @dragstart="e => onDragStart(e, 'initial')"
          @click="() => toggleMode('place-initial')"
        >
          <span class="drag-handle">⋮⋮</span>
          <span class="field-icon">🔤</span>
          <span class="field-label">Initials</span>
        </div>
      </div>

      <hr />

      <button class="action-btn" @click="saveConfig">💾 Save Config</button>
      <button class="action-btn" @click="signPdf">🖋️ Sign PDF</button>
    </div>

    <!-- Editor Panel -->
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
            class="hidden-input"
            @change="onSigSelected"
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
          <input v-model="currentField.initialsText" maxlength="3" placeholder="EJ" />
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
import { ref, reactive, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import interact from 'interactjs'
import { v4 as uuidv4 } from 'uuid'
import type { PageViewport, PDFPageProxy } from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.js',
  import.meta.url
).toString()

/** --- Types --- **/
interface FieldRect { x: number; y: number; width: number; height: number }
interface Field {
  id: string
  type: 'signature' | 'initial'
  rect: FieldRect
  initialsText?: string
  sigBuffer?: ArrayBuffer
  sigType?: 'png' | 'jpg'
  editable: boolean
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
const pageCanvases = ref<(HTMLCanvasElement|null)[]>([])
const pageCtxs = ref<(CanvasRenderingContext2D|null)[]>([])
const pageImageDatas = ref<(ImageData|null)[]>([])
const renderTasks = ref<(RenderTask|null)[]>([])

const mode = ref<'idle'|'place-signature'|'place-initial'>('idle')
const canDraw = ref(true)

const isLoading = ref(false)

const currentField = ref<Field|null>(null)
const drawingSig = ref(false)
const tempSigUrl = ref<string|null>(null)
const sigInput = ref<HTMLInputElement|null>(null)
const drawPad = ref<HTMLCanvasElement|null>(null)
const canvasCol = ref<HTMLDivElement|null>(null)

/** --- Helpers & Constants --- **/
const PADDING = 6, SCALE = 1.25, DPR = window.devicePixelRatio || 1
const cloneBytes = (u:Uint8Array) => new Uint8Array(u)
const getSigUrl = (f:Field) =>
  f.sigBuffer
    ? URL.createObjectURL(new Blob([f.sigBuffer], { type: f.sigType==='png'?'image/png':'image/jpeg' }))
    : ''

// reset refs on pages.length change
watch(() => pages.length, len => {
  pageCanvases.value   = Array(len).fill(null)
  pageCtxs.value       = Array(len).fill(null)
  pageImageDatas.value = Array(len).fill(null)
  renderTasks.value    = Array(len).fill(null)
}, { immediate: true })

// load saved config on mount
onMounted(async () => {
  const raw = localStorage.getItem('pdfSignerConfigV5')
  if (!raw) return
  const saved = JSON.parse(raw) as Array<{
    uid:string, pageNumber:number, pdfBase64:string,
    fields:Array<Omit<Field,'sigBuffer'> & { sigBuffer?:number[] }>
  }>
  saved.forEach(s => {
    pages.push({
      uid: s.uid,
      pageNumber: s.pageNumber,
      pdfBytes: Uint8Array.from(atob(s.pdfBase64), c=>c.charCodeAt(0)),
      viewport: null,
      imageData: null,
      thumbnailUrl: '',
      fields: s.fields.map(f => ({
        ...f,
        sigBuffer: f.sigBuffer ? new Uint8Array(f.sigBuffer).buffer : undefined,
        editable: true
      }))
    })
  })
  canDraw.value = false
  await nextTick()
  await generateThumbnails()
  await nextTick()
  await renderAllPages()
})

/** --- precise DnD state --- **/
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
  anchorY: 0
})

/** --- Floating drag preview --- **/
let dragPreviewEl: HTMLDivElement | null = null

function onDocDragOver(e: DragEvent) {
  if (!dragPreviewEl) return
  dragPreviewEl.style.left = `${e.clientX - dragState.anchorX}px`
  dragPreviewEl.style.top  = `${e.clientY - dragState.anchorY}px`
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
function bytesToBase64(bytes:Uint8Array):string {
  let s = ''
  for (let i=0; i<bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

/** --- PDF upload & rendering --- **/
async function appendPdfs(files:FileList) {
  const valid = Array.from(files).filter(f=>f.size>0 && f.type==='application/pdf')
  for (const file of valid) {
    const buf = await file.arrayBuffer()
    const bytes = new Uint8Array(buf)
    const doc = await pdfjsLib.getDocument({ data: cloneBytes(bytes) }).promise
    for (let i=1; i<=doc.numPages; i++) {
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
        fields: []
      })
    }
  }
}

async function onPdfUpload(e: Event) {
  const inp = e.target as HTMLInputElement
  if (!inp.files?.length) return
  
  isLoading.value = true
  try {
    pages.splice(0)
    await appendPdfs(inp.files)
    inp.value = ''
    canDraw.value = true
    await nextTick()
    await generateThumbnails()
    await nextTick()
    await renderAllPages()
  } finally {
    isLoading.value = false
  }
}

async function onAddPdfUpload(e:Event) {
  const inp = e.target as HTMLInputElement
  if (!inp.files?.length) return
  await appendPdfs(inp.files)
  inp.value = ''
  canDraw.value = true
  await nextTick(); await generateThumbnails()
  await nextTick(); await renderAllPages()
}

async function onDropDocuments(e: DragEvent) {
  const files = e.dataTransfer?.files
  if (!files?.length) return
  
  isLoading.value = true
  try {
    pages.splice(0)
    await appendPdfs(files)
    canDraw.value = true
    await nextTick()
    await generateThumbnails()
    await nextTick()
    await renderAllPages()
  } finally {
    isLoading.value = false
  }
}

async function generateThumbnails() {
  for (let i=0; i<pages.length; i++) {
    const p = pages[i]
    const pdf = await pdfjsLib.getDocument({ data: cloneBytes(p.pdfBytes) }).promise
    const pg  = await pdf.getPage(p.pageNumber)
    const vp  = pg.getViewport({ scale: 0.22 })
    const off = document.createElement('canvas')
    off.width = vp.width; off.height = vp.height
    const ctx = off.getContext('2d')!
    await pg.render({ canvasContext:ctx, viewport:vp }).promise
    p.thumbnailUrl = off.toDataURL()
  }
}

/** --- Single thumbnail helper --- **/
async function generateThumbnail(idx:number) {
  const p = pages[idx]
  const pdf = await pdfjsLib.getDocument({ data: cloneBytes(p.pdfBytes) }).promise
  const pg  = await pdf.getPage(p.pageNumber)
  const vp  = pg.getViewport({ scale: 0.22 })
  const off = document.createElement('canvas')
  off.width = vp.width; off.height = vp.height
  const ctx = off.getContext('2d')!
  await pg.render({ canvasContext:ctx, viewport:vp }).promise
  p.thumbnailUrl = off.toDataURL()
}

async function renderAllPages() {
  for (let i=0; i<pages.length; i++) {
    await renderPage(i)
  }
  await nextTick()
  initInteractions()
}

async function renderPage(idx:number) {
  const canvas = pageCanvases.value[idx]
  if (!canvas) return
  const prev = renderTasks.value[idx]
  if (prev) try{ prev.cancel() }catch{}
  const p = pages[idx]
  const pdf = await pdfjsLib.getDocument({ data: cloneBytes(p.pdfBytes) }).promise
  const pg  = await pdf.getPage(p.pageNumber)
  const vp  = pg.getViewport({ scale: SCALE })
  p.viewport = vp

  canvas.width  = (vp.width  + PADDING*2)*DPR
  canvas.height = (vp.height + PADDING*2)*DPR
  canvas.style.width  = '100%'
  canvas.style.height = 'auto'

  const ctx = canvas.getContext('2d')!
  pageCtxs.value[idx] = ctx

  // draw PDF page
  ctx.setTransform(1,0,0,1,0,0)
  ctx.clearRect(0,0,canvas.width,canvas.height)
  ctx.setTransform(DPR,0,0,DPR,PADDING*DPR,PADDING*DPR)
  const task = pg.render({ canvasContext:ctx, viewport:vp })
  renderTasks.value[idx] = task
  await task.promise

  // capture for redraw if needed
  ctx.setTransform(1,0,0,1,0,0)
  pageImageDatas.value[idx] = ctx.getImageData(0,0,canvas.width,canvas.height)
}

/** --- interact.js overlays --- **/
function initInteractions() {
  interact('.field-overlay')
    .draggable({
      modifiers:[ interact.modifiers.restrictRect({ restriction:'.page-wrapper', endOnly:true }) ],
      listeners:{ move(evt){
        const el = evt.target as HTMLElement
        const id = el.dataset.id!
        const pageEl = el.closest('.page-wrapper')!
        const idx = Array.from(canvasCol.value!.children).indexOf(pageEl)
        const f = pages[idx].fields.find(x=>x.id===id)!
        f.rect.x += evt.dx; f.rect.y += evt.dy
        el.style.left = f.rect.x+'px'; el.style.top = f.rect.y+'px'
      }}
    })
    .resizable({
      edges:{ top:true,left:true,bottom:true,right:true },
      modifiers:[
        interact.modifiers.restrictEdges({ outer:'.page-wrapper' }),
        interact.modifiers.restrictSize({ min:{width:20,height:20} })
      ],
      listeners:{ move(evt){
        const el = evt.target as HTMLElement
        const id = el.dataset.id!
        const pageEl = el.closest('.page-wrapper')!
        const idx = Array.from(canvasCol.value!.children).indexOf(pageEl)
        const f = pages[idx].fields.find(x=>x.id===id)!
        f.rect.x      += evt.deltaRect.left
        f.rect.y      += evt.deltaRect.top
        f.rect.width  = evt.rect.width
        f.rect.height = evt.rect.height
        Object.assign(el.style, {
          left: f.rect.x+'px',
          top:  f.rect.y+'px',
          width:  f.rect.width+'px',
          height: f.rect.height+'px'
        })
      }}
    })
}

/** --- Toolbar drag & drop --- **/
function onDragStart(e: DragEvent, type: 'signature' | 'initial') {
  dragState.type = type
  dragState.boxW = type === 'signature' ? 150 : 60
  dragState.boxH = type === 'signature' ? 50  : 30

  const targetRect = (e.target as HTMLElement).getBoundingClientRect()
  dragState.anchorX = e.clientX - targetRect.left
  dragState.anchorY = e.clientY - targetRect.top

  // Build our visible floating preview
  cleanupDragPreview()
  dragPreviewEl = document.createElement('div')
  dragPreviewEl.style.position = 'fixed'
  dragPreviewEl.style.pointerEvents = 'none'
  dragPreviewEl.style.zIndex = '999999'
  dragPreviewEl.style.width = `${dragState.boxW}px`
  dragPreviewEl.style.height = `${dragState.boxH}px`
  dragPreviewEl.style.border = '2px dashed #007bcc'
  dragPreviewEl.style.background = 'rgba(0,123,204,0.08)'
  dragPreviewEl.style.boxSizing = 'border-box'
  document.body.appendChild(dragPreviewEl)

  // Use a transparent drag image so the browser one doesn’t interfere
  const dummy = document.createElement('canvas')
  dummy.width = dummy.height = 1
  e.dataTransfer?.setDragImage(dummy, 0, 0)

  e.dataTransfer?.setData('fieldType', type)
}

/**
 * Drop a new signature/initial box *exactly* at the mouse position on the canvas.
 */
function onDropField(idx: number, e: DragEvent) {
  e.preventDefault()

  const type = (e.dataTransfer?.getData('fieldType') as 'signature' | 'initial') || dragState.type
  if (!type) return

  const canvas = pageCanvases.value[idx]
  if (!canvas) return
  const vp = pages[idx].viewport
  if (!vp) return

  const wrapper = canvas.parentElement as HTMLElement

  const wrapperRect = wrapper.getBoundingClientRect()
  const canvasRect  = canvas.getBoundingClientRect()

  // Mouse position in wrapper coordinates
  const xInWrapper = e.clientX - wrapperRect.left
  const yInWrapper = e.clientY - wrapperRect.top

  // Canvas position inside wrapper
  const canvasLeftInWrapper = canvasRect.left - wrapperRect.left
  const canvasTopInWrapper  = canvasRect.top  - wrapperRect.top

  // Final overlay position (wrapper‑relative). **No PADDING here**
  const left = canvasLeftInWrapper + (xInWrapper - canvasLeftInWrapper) - dragState.anchorX
  const top  = canvasTopInWrapper  + (yInWrapper - canvasTopInWrapper)  - dragState.anchorY

  pages[idx].fields.push({
    id: uuidv4(),
    type,
    rect: {
      x: left,
      y: top,
      width: dragState.boxW,
      height: dragState.boxH
    },
    editable: false
  })

  cleanupDragPreview()
}



/** --- Select overlay to open editor panel --- **/
function selectField(pageIdx:number, fieldId:string) {
  const f = pages[pageIdx].fields.find(x=>x.id===fieldId)!
  currentField.value = { ...f }
  canDraw.value = false
}

/** --- Signature / Initials editor functions --- **/
function startDrawingSig() {
  drawingSig.value = true
  tempSigUrl.value = null
  nextTick(()=>{
    const c = drawPad.value!, ctx = c.getContext('2d')!
    // transparent background
    ctx.clearRect(0,0,c.width,c.height)
    c.onpointerdown = drawStart
    c.onpointermove = drawMove
    c.onpointerup   = drawEnd
    c.onpointerleave= drawEnd
  })
}

let drawing = false
function drawStart(ev:PointerEvent){
  drawing = true
  const ctx = drawPad.value!.getContext('2d')!
  ctx.beginPath()
  ctx.moveTo(ev.offsetX, ev.offsetY)
}
function drawMove(ev:PointerEvent){
  if(!drawing) return
  const ctx = drawPad.value!.getContext('2d')!
  ctx.lineWidth=2; ctx.lineCap='round'
  ctx.lineTo(ev.offsetX, ev.offsetY)
  ctx.stroke()
}
function drawEnd(){
  drawing = false
}

async function saveDrawn(){
  if(!currentField.value) return
  const blob = await new Promise<Blob>(res=>drawPad.value!.toBlob(b=>res(b!), 'image/png'))
  const buf = await blob.arrayBuffer()
  const idx = pages.findIndex(pg=>pg.fields.some(f=>f.id===currentField.value!.id))
  if(idx>=0){
    const f = pages[idx].fields.find(x=>x.id===currentField.value!.id)!
    f.sigBuffer = buf; f.sigType='png'
  }
  drawingSig.value = false
  tempSigUrl.value = null
}

function cancelDrawing(){
  drawingSig.value = false
  tempSigUrl.value = null
}

async function onSigSelected(e:Event){
  const file = (e.target as HTMLInputElement).files?.[0]
  if(!file || !currentField.value) return
  const buf = await file.arrayBuffer()
  currentField.value.sigBuffer = buf
  currentField.value.sigType   = file.type.includes('jpeg')?'jpg':'png'
  tempSigUrl.value = URL.createObjectURL(new Blob([buf],{type:file.type}))
  drawingSig.value = false
}

function clearSignature(){
  if(!currentField.value) return
  currentField.value.sigBuffer = undefined
  currentField.value.sigType   = undefined
  tempSigUrl.value = null
}

function applyField(){
  if(!currentField.value) return
  const idx = pages.findIndex(pg=>pg.fields.some(f=>f.id===currentField.value!.id))
  if(idx<0) return
  const list = pages[idx].fields
  const i = list.findIndex(f=>f.id===currentField.value!.id)
  if(i>=0){
    list.splice(i,1,{ ...currentField.value!, editable:true })
  }
  cancelField()
}

function cancelField(){
  currentField.value = null
  canDraw.value = true
}

/** --- Save config & require refresh --- **/
function saveConfig(){
  const serial = pages.map(p=>({
    uid: p.uid,
    pageNumber: p.pageNumber,
    pdfBase64: bytesToBase64(p.pdfBytes),
    fields: p.fields.map(f=>({
      id: f.id,
      type: f.type,
      rect: { ...f.rect },
      initialsText: f.initialsText,
      sigBuffer: f.sigBuffer ? Array.from(new Uint8Array(f.sigBuffer)) : undefined,
      sigType: f.sigType
    }))
  }))
  localStorage.setItem('pdfSignerConfigV5', JSON.stringify(serial))
  alert('Configuration saved – please refresh to re‑enable editing')
}

function scrollToPage(idx:number){
  const col = canvasCol.value!
  const wrapper = col.querySelectorAll<HTMLElement>('.page-wrapper')[idx]
  if(wrapper) wrapper.scrollIntoView({ behavior:'smooth', block:'start' })
}

function toggleMode(m:'place-signature'|'place-initial'){
  if(!canDraw.value) return
  mode.value = mode.value===m ? 'idle' : m
}

/** --- PDF Signing --- **/
async function signPdf() {
  if (!pages.length) return;

  isLoading.value = true;
  try {
    const newPdf = await PDFDocument.create();
    const font = await newPdf.embedFont(StandardFonts.HelveticaBold);

    // Load the source docs once per PageData (yes, duplicates are OK)
    const srcDocs = await Promise.all(pages.map(p => PDFDocument.load(p.pdfBytes)));

    // Copy pages in the order they appear in `pages`
    for (let i = 0; i < pages.length; i++) {
      const [cp] = await newPdf.copyPages(srcDocs[i], [pages[i].pageNumber - 1]);
      newPdf.addPage(cp);
    }

    const outPages = newPdf.getPages();
    let drawn = 0;

    for (let i = 0; i < pages.length; i++) {
      const pdfPage = outPages[i];
      for (const field of pages[i].fields) {
        const { x, y, w, h } = toPdfCoords(field, i);

        if (field.type === 'signature' && field.sigBuffer) {
          const img = field.sigType === 'png'
            ? await newPdf.embedPng(field.sigBuffer)
            : await newPdf.embedJpg(field.sigBuffer);
          pdfPage.drawImage(img, { x, y, width: w, height: h });
          drawn++;
        } else if (field.type === 'initial' && field.initialsText) {
          const txt = field.initialsText.trim();
          let size = Math.min(h * 0.7, 24);
          while (font.widthOfTextAtSize(txt, size) > w - 4 && size > 6) size -= 0.5;

          pdfPage.drawText(txt, {
            x: x + (w - font.widthOfTextAtSize(txt, size)) / 2,
            y: y + (h - size) / 2,
            size,
            font,
            color: rgb(0, 0.5, 0)
          });
          drawn++;
        }
      }
    }

    // Optional quick check (open devtools)
    console.log('Total fields drawn:', drawn);

    const pdfBytes = await newPdf.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `signed_${new Date().toISOString().slice(0, 10)}.pdf`;
    a.click();

    window.open(url, '_blank');
  } catch (error) {
    console.error('PDF signing error:', error);
    alert('Error generating signed PDF. Please try again.');
  } finally {
    isLoading.value = false;
  }
}



/** --- Remove & Replace --- **/
async function removePage(idx:number){
  pages.splice(idx,1)
  await nextTick(); await generateThumbnails(); await renderAllPages()
}

async function onReplacePdfUpload(idx:number,e:Event){
  const inp = e.target as HTMLInputElement
  if(!inp.files?.length) return
  const file = inp.files[0]; inp.value = ''
  const buf = await file.arrayBuffer(), bytes = new Uint8Array(buf)
  pages[idx].pdfBytes = bytes
  pages[idx].pageNumber = 1
  pages[idx].fields = []
  await generateThumbnail(idx); await renderAllPages()
}

function toPdfCoords(field: Field, pageIndex: number): { x: number, y: number, w: number, h: number } {
  const vp = pages[pageIndex].viewport
  const canvas = pageCanvases.value[pageIndex]
  if (!vp || !canvas) return { x: 0, y: 0, w: 0, h: 0 }

  // Real canvas pixel size (the pdf.js render target)
  const realW = canvas.width / DPR
  const realH = canvas.height / DPR

  const drawableW = realW - PADDING * 2
  const drawableH = realH - PADDING * 2

  const scaleX = vp.width  / drawableW
  const scaleY = vp.height / drawableH

  // Where is the canvas inside the wrapper?
  const wrapper = canvas.parentElement as HTMLElement
  const wrapperRect = wrapper.getBoundingClientRect()
  const canvasRect  = canvas.getBoundingClientRect()
  const canvasLeftInWrapper = canvasRect.left - wrapperRect.left
  const canvasTopInWrapper  = canvasRect.top  - wrapperRect.top

  // Convert overlay (wrapper-relative) -> canvas coords
  const xInCanvas = field.rect.x - canvasLeftInWrapper
  const yInCanvas = field.rect.y - canvasTopInWrapper

  // Only now apply the drawing padding to reach the pdf.js page area
  const x = (xInCanvas + PADDING) * scaleX
  const yTop = (yInCanvas + PADDING) * scaleY
  const w = field.rect.width  * scaleX
  const h = field.rect.height * scaleY

  // pdf-lib has bottom-left origin
  const y = vp.height - yTop - h

  return { x, y, w, h }
}


</script>

<style scoped>
.pdf-signer-container {
  display: flex;
  height: 100vh;
  background: #f5f5f5;
  font-family: sans-serif;
}
.col {
  padding: 1rem;
  box-sizing: border-box;
  height: 100%;
}
.thumbs-col {
  width: 15%;
  overflow-y: auto;
  background: white;
  border-right: 1px solid #ddd;
}
.thumb-wrapper {
  position: relative;
  margin-bottom: 0.5rem;
  cursor: pointer;
  border: 1px solid #eee;
}
.thumb-wrapper:hover {
  border-color: #ccc;
}
.thumb {
  width: 100%;
  display: block;
}
.thumb-overlay {
  position: absolute;
  inset: 0;
  background: rgba(200, 200, 200, 0.5);
  display: flex;
  gap: 0.5rem;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s;
}
.thumb-wrapper:hover .thumb-overlay {
  opacity: 1;
}
.overlay-btn {
  background: white;
  border: 1px solid #888;
  border-radius: 4px;
  padding: 0.25rem 0.5rem;
  cursor: pointer;
}
.hidden-input {
  display: none;
}
.thumbs-footer {
  text-align: center;
  margin-top: 1rem;
}
.canvas-col {
  flex: 1;
  overflow-y: auto;
  margin: 0 1rem;
  background: white;
  box-shadow: 0 0 8px rgba(0, 0, 0, 0.1);
}
.page-wrapper {
  position: relative;
  margin-bottom: 2rem;
  padding: 10px;
  background: white;
  border: 1px solid #ddd;
}
.pdf-canvas {
  width: 100% !important;
  height: auto !important;
  background: white;
  border: 1px solid #eee;
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.1);
}
.field-overlay {
  position: absolute;
  border: 2px dashed #007bcc;
  background: rgba(0, 123, 204, 0.1);
  box-sizing: border-box;
  cursor: move;
  touch-action: none;
}
/* Initials tooltip */
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
  top: 0; left: 0;
  width: 100%; height: 100%;
  object-fit: contain;
}
.sig-icon {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  font-size: 1.2em;
}
.loader {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  font-size: 1.2rem;
  color: #555;
}
.initial-text {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  font-size: 1em;
  color: #000;
}
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
  padding: 0.5rem;
  margin-bottom: 0.5rem;
  background: #f0f0f0;
  border: 1px solid #ddd;
  border-radius: 4px;
  cursor: pointer;
}
.action-btn:hover {
  background: #e0e0e0;
}
.action-btn:last-of-type {
  margin-bottom: 0;
}
.field-panel {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: white;
  padding: 1rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  border: 1px solid #ddd;
  border-radius: 6px;
  display: none;
  z-index: 1000;
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
/* Transparent drawing pad */
.draw-pad {
  border: 1px solid #ccc;
  background: transparent !important;
  width: 600px;
  height: 200px;
  margin-bottom: 0.5rem;
}
.preview-img {
  max-width: 200px;
  display: block;
  margin: 0.5rem auto;
  border: 1px solid #ddd;
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
  transition: background 0.2s, border-color 0.2s;
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

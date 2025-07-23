<template>
  <div class="pdf-signer-container">
    <div class="header-upload">
      <label class="upload-pdf-btn">
        📄 Upload PDF
        <input type="file" accept="application/pdf" multiple @change="onPdfUpload" class="hidden-input" />
      </label>
    </div>

    <div class="col thumbs-col">
      <div v-if="pages.length === 0" class="initial-upload">
        <p>No document loaded</p>
      </div>
      <div v-else>
        <div v-for="p in pages" :key="p.uid" class="thumb-wrapper">
          <img :src="p.thumbnailUrl" class="thumb" />
        </div>
        <div class="thumbs-footer">
          <label class="add-doc-btn">
            ➕ Add PDF
            <input type="file" accept="application/pdf" multiple @change="onPdfUpload" class="hidden-input" />
          </label>
        </div>
      </div>
    </div>

    <div class="col canvas-col">
      <div
        v-for="(p, idx) in pages"
        :key="p.uid"
        class="page-wrapper"
        @dragover.prevent
        @drop="onDropField(idx, $event)"
      >
        <h4>Page {{ idx + 1 }}</h4>
        <canvas
          :ref="el => (pageCanvases[idx] = el as HTMLCanvasElement | null)"
          class="pdf-canvas"
          @mousedown="e => onMouseDown(idx, e)"
          @mousemove="e => canDraw ? onMouseMove(idx, e) : null"
          @mouseup="e => onMouseUp(idx, e)"
          @click="e => onCanvasClick(idx, e)"
        />
        <div class="field-indicator" v-if="!canDraw && currentField && activePageIdx === idx">
          {{ currentField.type === 'signature' ? 'Signature' : 'Initials' }}
        </div>  
      </div>
    </div>

    <div class="col toolbar-col">
      <button
        :disabled="!canDraw"
        :class="{ active: mode === 'place-signature', disabled: !canDraw }"
        @click="toggleMode('place-signature')"
        draggable="true"
        @dragstart="e => onDragStart(e, 'signature')"
      >✒️ Place Signature</button>

      <button
        :disabled="!canDraw"
        :class="{ active: mode === 'place-initial', disabled: !canDraw }"
        @click="toggleMode('place-initial')"
        draggable="true"
        @dragstart="e => onDragStart(e, 'initial')"
      >🔤 Place Initial</button>

      <hr />
      <button @click="saveConfig">💾 Save Config</button>
      <button @click="signPdf">🖋️ Sign PDF</button>
    </div>

    <div v-if="currentField && !canDraw" class="field-panel active">
    <h3>{{ currentField.type === 'signature' ? 'Signature' : 'Initials' }}</h3>

    <div v-if="currentField.type === 'signature'" class="sig-config">
      <button @click="startDrawingSig">✏️ Draw Signature</button>
      <label class="upload-pdf-btn">
        📷 Upload Signature Image
        <input ref="sigInput" type="file" accept="image/png,image/jpeg" @change="onSigSelected" class="hidden-input" />
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
import { ref, reactive, onMounted, nextTick } from 'vue';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import type { PageViewport, PDFPageProxy } from 'pdfjs-dist';
import { v4 as uuidv4 } from 'uuid';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.js',
  import.meta.url
).toString();

/* ---------- Types ---------- */
interface FieldRect { x: number; y: number; width: number; height: number }
interface Field {
  id: string;
  type: 'signature' | 'initial';
  rect: FieldRect;
  initialsText?: string;
  sigBuffer?: ArrayBuffer;
  sigType?: 'png' | 'jpg';
}
interface PageData {
  uid: string;
  pageNumber: number;
  pdfBytes: Uint8Array;
  viewport: PageViewport | null;
  imageData: ImageData | null;
  thumbnailUrl: string;
  fields: Field[];
}
type RenderTask = ReturnType<PDFPageProxy['render']>;

/* ---------- State ---------- */
const pages = reactive<PageData[]>([]);

const pageCanvases     = ref<(HTMLCanvasElement | null)[]>([]);
const pageCtxs         = ref<(CanvasRenderingContext2D | null)[]>([]);
const pageImageDatas   = ref<(ImageData | null)[]>([]);
const renderTasks      = ref<(RenderTask | null)[]>([]);

const mode   = ref<'idle'|'place-signature'|'place-initial'>('idle');
const canDraw = ref(true);

const isSelecting   = ref(false);
const startX        = ref(0);
const startY        = ref(0);
const activePageIdx = ref<number | null>(null);

const currentField  = ref<Field | null>(null);
const drawingSig    = ref(false);
const tempSigUrl    = ref<string | null>(null);
const sigInput      = ref<HTMLInputElement | null>(null);
const drawPad       = ref<HTMLCanvasElement | null>(null);

/* ---------- Constants ---------- */
const PADDING = 6;
const SCALE   = 1.25;
const DPR     = window.devicePixelRatio || 1;

/* ---------- Helpers ---------- */
const cloneBytes = (u: Uint8Array) => new Uint8Array(u);
const getRatio   = (c: HTMLCanvasElement) => c.width / c.clientWidth;
const getSigUrl = (field: Field) => {
  if (!field.sigBuffer) return '';
  const type = field.sigType === 'png' ? 'image/png' : 'image/jpeg';
  return URL.createObjectURL(new Blob([field.sigBuffer], { type }));
};

/* ---------- Load saved ---------- */
onMounted(async () => {
  const raw = localStorage.getItem('pdfSignerConfigV5');
  if (raw) {
    const saved: Array<{ 
      uid:string; 
      pageNumber:number; 
      pdfBase64:string; 
      fields:Array<Omit<Field, 'sigBuffer'> & { sigBuffer?: number[] }> 
    }> = JSON.parse(raw);
    
    saved.forEach(s => {
      pages.push({
        uid: s.uid,
        pageNumber: s.pageNumber,
        pdfBytes: Uint8Array.from(atob(s.pdfBase64), c => c.charCodeAt(0)),
        viewport: null,
        imageData: null,
        thumbnailUrl: '',
        fields: s.fields.map(f => ({
          ...f,
          sigBuffer: f.sigBuffer ? new Uint8Array(f.sigBuffer).buffer : undefined
        }))
      });
    });
    
    canDraw.value = false;
    await nextTick();
    await generateThumbnails();
    await nextTick();
    await renderAllPages();
  }
});

/* ---------- Upload ---------- */
async function onPdfUpload(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files ?? []);
  if (!files.length) return;

  // Clear any previous
  pages.splice(0);

  for (const file of files) {
    const buf   = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const doc   = await pdfjsLib.getDocument({ data: cloneBytes(bytes) }).promise;
    for (let i = 1; i <= doc.numPages; i++) {
      pages.push({
        uid: uuidv4(),
        pageNumber: i,
        pdfBytes: bytes,
        viewport: null,
        imageData: null,
        thumbnailUrl: '',
        fields: []
      });
    }
  }

  canDraw.value = true;
  await nextTick();
  await generateThumbnails();
  await nextTick();
  await renderAllPages();
}

/* ---------- Thumbnails ---------- */
async function generateThumbnails() {
  for (let i = 0; i < pages.length; i++) {
    const p   = pages[i];
    const pdf = await pdfjsLib.getDocument({ data: cloneBytes(p.pdfBytes) }).promise;
    const pg  = await pdf.getPage(p.pageNumber);
    const vp  = pg.getViewport({ scale: 0.22 });

    const off = document.createElement('canvas');
    off.width = vp.width;
    off.height= vp.height;
    const ctx = off.getContext('2d')!;
    await pg.render({ canvasContext: ctx, viewport: vp }).promise;

    p.thumbnailUrl = off.toDataURL();
  }
}

/* ---------- Rendering ---------- */
async function renderAllPages() {
  for (let i = 0; i < pages.length; i++) {
    await renderPage(i);
  }
}

async function renderPage(idx: number) {
  const canvas = pageCanvases.value[idx];
  if (!canvas) return;

  const prev = renderTasks.value[idx];
  if (prev) { try { prev.cancel(); } catch {} }

  const p   = pages[idx];
  const pdf = await pdfjsLib.getDocument({ data: cloneBytes(p.pdfBytes) }).promise;
  const pg  = await pdf.getPage(p.pageNumber);
  const vp  = pg.getViewport({ scale: SCALE });
  p.viewport = vp;

  canvas.width  = (vp.width  + PADDING*2) * DPR;
  canvas.height = (vp.height + PADDING*2) * DPR;
  canvas.style.width  = '100%';
  canvas.style.height = 'auto';

  const ctx = canvas.getContext('2d')!;
  pageCtxs.value[idx] = ctx;

  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.setTransform(DPR,0,0,DPR,PADDING*DPR,PADDING*DPR);

  const task = pg.render({ canvasContext: ctx, viewport: vp });
  renderTasks.value[idx] = task;
  await task.promise;

  ctx.setTransform(1,0,0,1,0,0);
  pageImageDatas.value[idx] = ctx.getImageData(0,0,canvas.width,canvas.height);

  drawFieldsOnPage(idx);
}

function drawFieldsOnPage(idx: number) {
  const ctx = pageCtxs.value[idx];
  const img = pageImageDatas.value[idx];
  if (!ctx || !img) return;

  ctx.putImageData(img, 0, 0);

  pages[idx].fields.forEach(f => {
    const x = (f.rect.x + PADDING) * DPR;
    const y = (f.rect.y + PADDING) * DPR;
    const w = f.rect.width * DPR;
    const h = f.rect.height * DPR;

    ctx.save();
    
    // Draw the field box
    ctx.strokeStyle = f.type === 'signature' ? 'blue' : 'green';
    ctx.lineWidth = 2 * DPR;
    ctx.strokeRect(x, y, w, h);

    // Add centered signature icon for signature fields
    if (f.type === 'signature' && !f.sigBuffer) {
      const iconX = x + w / 2;
      const iconY = y + h / 2;
      ctx.font = `${Math.min(16, h/2) * DPR}px sans-serif`;
      ctx.fillStyle = 'blue';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🖋️', iconX, iconY); // Changed to pen icon
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }

    if (f.type === 'initial') {
      const labelX = x + w / 2;
      const labelY = y - 10 * DPR; // Position above the box
      ctx.font = `${10 * DPR}px sans-serif`;
      ctx.fillStyle = 'green';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('INITIALS', labelX, labelY);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }

    if (f.type === 'initial' && f.initialsText) {
      ctx.font = `${Math.min(14, h/2) * DPR}px sans-serif`;
      ctx.fillStyle = 'green';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(f.initialsText, x + w / 2, y + h / 2);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }

    if (f.type === 'signature' && !f.sigBuffer) {
      const iconX = x + w / 2;
      const iconY = y + h / 2;
      ctx.font = `${Math.min(16, h/2) * DPR}px sans-serif`;
      ctx.fillStyle = 'blue';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✍️', iconX, iconY); // Changed to writing hand emoji
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }

    if (f.type === 'signature' && f.sigBuffer && f.sigType) {
      const imgEl = new Image();
      imgEl.onload = () => {
        ctx.drawImage(imgEl, x, y, w, h);
        ctx.restore();
      };
      imgEl.src = getSigUrl(f);
    } else {
      ctx.restore();
    }
  });
}

/* ---------- Mode toggle ---------- */
function toggleMode(m: 'place-signature'|'place-initial') {
  if (!canDraw.value) return;
  mode.value = (mode.value === m) ? 'idle' : m;
}

/* ---------- Drag & Drop ---------- */
function onDragStart(e: DragEvent, type: 'signature'|'initial') {
  if (!canDraw.value) return;
  e.dataTransfer?.setData('fieldType', type);
}

function onDropField(idx: number, e: DragEvent) {
  if (!canDraw.value) return;
  const type = e.dataTransfer?.getData('fieldType') as 'signature'|'initial';
  if (!type) return;

  const canvas = pageCanvases.value[idx]!;
  const rect   = canvas.getBoundingClientRect();
  const ratio  = getRatio(canvas);

  const x = (e.clientX - rect.left - PADDING) * ratio;
  const y = (e.clientY - rect.top  - PADDING) * ratio;
  const w = type === 'signature' ? 150 : 60;
  const h = 50;

  pages[idx].fields.push({ 
    id: uuidv4(), 
    type, 
    rect: { x, y, width: w, height: h } 
  });
  drawFieldsOnPage(idx);
}

/* ---------- Mouse draw ---------- */
function onMouseDown(idx: number, e: MouseEvent) {
  if (!canDraw.value || mode.value === 'idle') return;
  const canvas = pageCanvases.value[idx]!;
  isSelecting.value = true;
  activePageIdx.value = idx;

  const rect = canvas.getBoundingClientRect();
  startX.value = (e.clientX - rect.left - PADDING) * getRatio(canvas);
  startY.value = (e.clientY - rect.top - PADDING) * getRatio(canvas);
}

function onMouseMove(idx: number, e: MouseEvent) {
  if (canDraw.value) {
    // Drawing mode
    if (!isSelecting.value || activePageIdx.value !== idx) return;

    const canvas = pageCanvases.value[idx]!;
    const ctx = pageCtxs.value[idx]!;
    const img = pageImageDatas.value[idx]!;
    const ratio = getRatio(canvas);

    ctx.putImageData(img, 0, 0);
    drawFieldsOnPage(idx);

    const rect = canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left - PADDING) * ratio;
    const cy = (e.clientY - rect.top - PADDING) * ratio;

    const x = Math.min(startX.value, cx);
    const y = Math.min(startY.value, cy);
    const w = Math.abs(cx - startX.value);
    const h = Math.abs(cy - startY.value);

    ctx.strokeStyle = 'red';
    ctx.lineWidth = 2 * DPR;
    ctx.strokeRect(x, y, w, h);
  }
}

function onMouseUp(idx: number, e: MouseEvent) {
  if (!isSelecting.value || activePageIdx.value !== idx) return;
  isSelecting.value = false;

  const canvas = pageCanvases.value[idx]!;
  const rect = canvas.getBoundingClientRect();
  const ratio = getRatio(canvas);

  const ex = (e.clientX - rect.left) * ratio - PADDING * DPR;
  const ey = (e.clientY - rect.top) * ratio - PADDING * DPR;

  const x = Math.min(startX.value, ex);
  const y = Math.min(startY.value, ey);
  const w = Math.abs(ex - startX.value);
  const h = Math.abs(ey - startY.value);
  if (w < 5 || h < 5) return;

  pages[idx].fields.push({
    id: uuidv4(),
    type: mode.value === 'place-signature' ? 'signature' : 'initial',
    rect: { 
      x: x / DPR,  // Convert back to CSS pixels
      y: y / DPR,
      width: w / DPR,
      height: h / DPR
    }
  });

  drawFieldsOnPage(idx);
}


function onCanvasClick(idx: number, e: MouseEvent) {
  if (canDraw.value) return;
  
  const canvas = pageCanvases.value[idx]!;
  const rect = canvas.getBoundingClientRect();
  const ratio = getRatio(canvas);
  
  // Calculate click position in canvas coordinates (accounting for padding and DPR)
  const cx = (e.clientX - rect.left) * ratio - PADDING * DPR;
  const cy = (e.clientY - rect.top) * ratio - PADDING * DPR;

  // Find which field was clicked (if any)
  const hit = pages[idx].fields.find(f => {
    // Field boundaries in canvas coordinates (with padding)
    const left = f.rect.x * DPR;
    const right = (f.rect.x + f.rect.width) * DPR;
    const top = f.rect.y * DPR;
    const bottom = (f.rect.y + f.rect.height) * DPR;
    
    return cx >= left && cx <= right && cy >= top && cy <= bottom;
  });

  if (hit) {
    currentField.value = { ...hit };
    activePageIdx.value = idx;
    tempSigUrl.value = hit.sigBuffer ? getSigUrl(hit) : null;
    drawingSig.value = false;
    
    // Focus the input field if it's an initials box
    if (hit.type === 'initial') {
      nextTick(() => {
        const input = document.querySelector('.initials-config input') as HTMLInputElement;
        input?.focus();
      });
    }
  }
}

/* ---------- Signature Handling ---------- */
async function onSigSelected(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file || !currentField.value) return;
  const buf = await file.arrayBuffer();
  currentField.value.sigBuffer = buf;
  currentField.value.sigType = file.type.includes('jpeg') ? 'jpg' : 'png';
  tempSigUrl.value = URL.createObjectURL(new Blob([buf], { type: file.type }));
  drawingSig.value = false;
}

function clearSignature() {
  if (!currentField.value) return;
  currentField.value.sigBuffer = undefined;
  currentField.value.sigType = undefined;
  tempSigUrl.value = null;
}

function startDrawingSig() {
  drawingSig.value = true;
  tempSigUrl.value = null;
  nextTick(() => {
    const c = drawPad.value!;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0,0,c.width,c.height);
    c.onpointerdown = drawStart;
    c.onpointermove = drawMove;
    c.onpointerup   = drawEnd;
    c.onpointerleave= drawEnd;
  });
}

let drawing = false;
function drawStart(ev: PointerEvent) {
  drawing = true;
  const ctx = drawPad.value!.getContext('2d')!;
  ctx.beginPath();
  ctx.moveTo(ev.offsetX, ev.offsetY);
}

function drawMove(ev: PointerEvent) {
  if (!drawing) return;
  const ctx = drawPad.value!.getContext('2d')!;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineTo(ev.offsetX, ev.offsetY);
  ctx.stroke();
}

function drawEnd() { drawing = false; }

async function saveDrawn() {
  if (!currentField.value) return;
  const blob = await new Promise<Blob>(res => drawPad.value!.toBlob(b => res(b!), 'image/png'));
  const buf = await blob.arrayBuffer();
  
  // Apply directly without showing panel
  const idx = activePageIdx.value;
  if (idx !== null) {
    const field = pages[idx].fields.find(f => f.id === currentField.value!.id);
    if (field) {
      field.sigBuffer = buf;
      field.sigType = 'png';
      drawFieldsOnPage(idx);
    }
  }
  
  // Close everything
  currentField.value = null;
  tempSigUrl.value = null;
  drawingSig.value = false;
}

function cancelDrawing() {
  drawingSig.value = false;
  tempSigUrl.value = null;
}

/* ---------- Field Management ---------- */
function applyField() {
  if (!currentField.value || activePageIdx.value === null) return;
  const list = pages[activePageIdx.value].fields;
  const i    = list.findIndex(f => f.id === currentField.value!.id);
  
  if (i >= 0) {
    list.splice(i, 1, { ...currentField.value });
  } else {
    if (currentField.value.type === 'initial' && !currentField.value.initialsText) {
      currentField.value.initialsText = prompt('Enter initials') || '';
    }
    list.push({ ...currentField.value });
  }
  
  currentField.value = null;
  tempSigUrl.value = null;
  drawingSig.value = false;
  drawFieldsOnPage(activePageIdx.value);
}

function cancelField() {
  if (currentField.value?.id) {
    const idx = activePageIdx.value;
    if (idx !== null) drawFieldsOnPage(idx);
  }
  currentField.value = null;
  tempSigUrl.value = null;
  drawingSig.value = false;
}

/* ---------- Save & Sign ---------- */
function saveConfig() {
  const serial = pages.map(p => ({
    uid: p.uid,
    pageNumber: p.pageNumber,
    pdfBase64: btoa(String.fromCharCode(...p.pdfBytes)),
    fields: p.fields.map(f => ({
      ...f,
      sigBuffer: f.sigBuffer ? Array.from(new Uint8Array(f.sigBuffer)) : undefined
    }))
  }));
  localStorage.setItem('pdfSignerConfigV5', JSON.stringify(serial));
  alert('Configuration saved');
}

function toPdfField(f: Field, pageHeight: number) {
  // CSS coords → PDF units:
  const x = (f.rect.x - PADDING) / SCALE;
  const y = pageHeight - ((f.rect.y + f.rect.height + PADDING) / SCALE);
  const w = f.rect.width / SCALE;
  const h = f.rect.height / SCALE;
  return { x, y, w, h };
}

async function signPdf() {
  if (!pages.length) return;
  const pdfDoc = await PDFDocument.load(pages[0].pdfBytes);
  // use a built‑in font so text actually shows
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  for (const p of pages) {
    const page = pdfDoc.getPage(p.pageNumber - 1);
    const pageH = page.getHeight();

    for (const f of p.fields) {
      const { x, y, w, h } = toPdfField(f, pageH);

      if (f.type === 'signature' && f.sigBuffer && f.sigType) {
        const img = f.sigType === 'png'
          ? await pdfDoc.embedPng(f.sigBuffer)
          : await pdfDoc.embedJpg(f.sigBuffer);
        page.drawImage(img, { x, y, width: w, height: h });
      }

      if (f.type === 'initial' && f.initialsText) {
        const text = f.initialsText.trim();
        // pick a font size that fits inside the box
        let size = Math.min(h * 0.7, 24);
        while (font.widthOfTextAtSize(text, size) > w - 4 && size > 6) {
          size -= 0.5;
        }
        // center horizontally
        const textWidth = font.widthOfTextAtSize(text, size);
        const tx = x + (w - textWidth) / 2;
        // center vertically
        const ty = y + (h - size) / 2;

        page.drawText(text, {
          x: tx,
          y: ty,
          size,
          font,
          color: rgb(0, 0.5, 0),
        });
      }
    }
  }

  const out = await pdfDoc.save();
  const blob = new Blob([out], { type: 'application/pdf' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'signed.pdf';
  a.click();
  window.open(url, '_blank');
}
</script>

<style scoped>
.pdf-signer-container { 
  display: flex; 
  height: 100vh; 
  font-family: sans-serif; 
  position: relative; 
  background: #f5f5f5;
}

.header-upload { 
  position: absolute; 
  top: 10px; 
  right: 20%; 
  z-index: 10; 
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
  box-shadow: 0 0 8px rgba(0,0,0,0.1);
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
  box-shadow: 0 0 4px rgba(0,0,0,0.1); 
  cursor: crosshair; 
  background: white;
  border: 1px solid #eee;
}

.toolbar-col { 
  width: 200px; 
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

.toolbar-col button.disabled { 
  opacity: 0.4; 
  cursor: not-allowed; 
}

.toolbar-col .active { 
  background: #007bcc; 
  color: white; 
  border-color: #006bb3;
}

.upload-pdf-btn, .add-doc-btn { 
  display: inline-block; 
  cursor: pointer; 
  margin-top: 0.5rem; 
  padding: 0.5rem;
  background: #f0f0f0;
  border-radius: 4px;
  border: 1px solid #ddd;
}

.upload-pdf-btn:hover, .add-doc-btn:hover {
  background: #e0e0e0;
}

.hidden-input { 
  display: none; 
}

.initial-upload { 
  text-align: center; 
  margin-top: 2rem; 
  color: #666;
}

/* Field editor */
.field-panel {
  position: fixed; 
  bottom: 20px; 
  left: 50%; 
  transform: translateX(-50%);
  background: white; 
  padding: 1rem; 
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  border-radius: 6px; 
  z-index: 1000; 
  max-width: 90%;
  border: 1px solid #ddd;
}

.sig-config, .initials-config { 
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
  background: #4CAF50;
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

.pdf-canvas {
  cursor: default;
}

.page-wrapper:hover .pdf-canvas {
  cursor: pointer;
}

.field-panel {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: white;
  padding: 1rem;
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  border-radius: 6px;
  z-index: 1000;
  max-width: 90%;
  border: 1px solid #ddd;
  display: none;
}

.field-panel.active {
  display: block;
}

/* Tooltip styles */
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

.initials-config input {
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  width: 100%;
  margin-top: 8px;
}
</style>



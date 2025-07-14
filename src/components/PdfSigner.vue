<template>
  <div class="pdf-signer">
    <h2>PDF Signature App</h2>

    <label>Select PDF:
      <input type="file" accept="application/pdf" @change="onPdfUpload" />
    </label>
    <br /><br />

    <canvas
      ref="pdfCanvas"
      class="border cursor-crosshair"
      @mousedown="startSelect"
      @mousemove="updateSelect"
      @mouseup="finishSelect"
    ></canvas>
    <br /><br />

    <h3>Upload Signature</h3>
    <input type="file" accept="image/png,image/jpeg" @change="onSigUpload" />

    <h3>Or Draw Signature</h3>
    <canvas ref="sigPad" width="300" height="100" class="border bg-white"></canvas>
    <button @click="saveDrawn">Use Drawn Signature</button>
    <button @click="clearSigPad">Clear</button>
    <br /><br />

    <button
      :disabled="!basePdfBuffer || !baseSigBuffer || !selectedRect"
      @click="saveField"
    >
      Save Field
    </button>

    <button
      :disabled="!basePdfBuffer || !baseSigBuffer || !selectedRect"
      @click="signPdf"
    >
      Sign PDF
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.js?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// state & refs
const pdfCanvas      = ref<HTMLCanvasElement | null>(null);
const sigPad         = ref<HTMLCanvasElement | null>(null);
const basePdfBuffer  = ref<ArrayBuffer | null>(null);
const baseSigBuffer  = ref<ArrayBuffer | null>(null);
const sigType        = ref<'png'|'jpg'|null>(null);
const basePageImage  = ref<ImageData | null>(null);
const viewport       = ref<PageViewport | null>(null);
const isSelecting    = ref(false);
const startX         = ref(0);
const startY         = ref(0);
const selectedRect   = ref<{ x:number; y:number; width:number; height:number }|null>(null);

// NEW: control whether user can draw fields
const selectionEnabled = ref(true);

interface Stored {
  pdfBase64:      string;
  selectedRect:   { x:number; y:number; width:number; height:number };
  sigBase64:      string;
  sigType:        'png'|'jpg';
  allowSelection: boolean;
}
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let b = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) b += String.fromCharCode(bytes[i]);
  return btoa(b);
}

// 1. PDF upload + render
async function onPdfUpload(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const buf = await file.arrayBuffer();
  basePdfBuffer.value = buf.slice(0);
  // new PDF => allow drawing again
  selectionEnabled.value = true;
  selectedRect.value = null;
  await renderPdf(buf);
}

async function renderPdf(buffer: ArrayBuffer) {
  const canvas = pdfCanvas.value!, ctx = canvas.getContext('2d')!;
  const workerBuf = buffer.slice(0);
  const pdf      = await pdfjsLib.getDocument({ data: workerBuf }).promise;
  const page: PDFPageProxy = await pdf.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  viewport.value = vp;
  canvas.width = vp.width; canvas.height = vp.height;
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  basePageImage.value = ctx.getImageData(0, 0, canvas.width, canvas.height);
}

// 2. Drag-to-select (guarded by selectionEnabled)
function startSelect(e: MouseEvent) {
  if (!selectionEnabled.value || !basePageImage.value) return;
  isSelecting.value = true;
  const r = pdfCanvas.value!.getBoundingClientRect();
  startX.value = e.clientX - r.left;
  startY.value = e.clientY - r.top;
}
function updateSelect(e: MouseEvent) {
  if (!isSelecting.value) return;
  const canvas = pdfCanvas.value!, ctx = canvas.getContext('2d')!;
  ctx.putImageData(basePageImage.value!, 0, 0);
  const r = canvas.getBoundingClientRect();
  const cx = e.clientX - r.left, cy = e.clientY - r.top;
  const x = Math.min(startX.value, cx), y = Math.min(startY.value, cy);
  const w = Math.abs(cx - startX.value), h = Math.abs(cy - startY.value);
  ctx.strokeStyle='red'; ctx.lineWidth=2;
  ctx.strokeRect(x, y, w, h);
}
function finishSelect(e: MouseEvent) {
  if (!isSelecting.value) return;
  isSelecting.value = false;
  const canvas = pdfCanvas.value!, r = canvas.getBoundingClientRect();
  const ex = e.clientX - r.left, ey = e.clientY - r.top;
  const x = Math.min(startX.value, ex), y = Math.min(startY.value, ey);
  const w = Math.abs(ex - startX.value), h = Math.abs(ey - startY.value);
  selectedRect.value = { x, y, width: w, height: h };
}

// 3a. Upload signature
async function onSigUpload(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  sigType.value = file.type === 'image/jpeg' ? 'jpg':'png';
  const buf = await file.arrayBuffer();
  baseSigBuffer.value = buf.slice(0);
}
// 3b. Draw signature
function clearSigPad() {
  const c = sigPad.value!, ctx = c.getContext('2d')!;
  ctx.clearRect(0,0,c.width,c.height);
  ctx.beginPath();
}
async function saveDrawn() {
  sigType.value = 'png';
  const c = sigPad.value!;
  const blob = await new Promise<Blob>(res => c.toBlob(b => res(b!)));
  baseSigBuffer.value = (await blob.arrayBuffer()).slice(0);
}

// mount: signature pad drawing + restore state
onMounted(() => {
  const c = sigPad.value!, ctx = c.getContext('2d')!;
  let drawing = false;
  c.addEventListener('pointerdown', ()=>{ drawing=true; ctx.beginPath(); });
  c.addEventListener('pointerup',   ()=>{ drawing=false; ctx.beginPath(); });
  c.addEventListener('pointermove',(e:PointerEvent)=>{
    if(!drawing) return;
    ctx.lineWidth=2; ctx.lineCap='round';
    ctx.lineTo(e.offsetX, e.offsetY); ctx.stroke();
  });

  const raw = localStorage.getItem('pdfSignatureData');
  if (!raw) return;
  try {
    const s = JSON.parse(raw) as Stored;
    // restore PDF
    const pdfBuf = Uint8Array.from(atob(s.pdfBase64), c=>c.charCodeAt(0)).buffer;
    basePdfBuffer.value = pdfBuf;
    // restore signature
    const sigBuf = Uint8Array.from(atob(s.sigBase64), c=>c.charCodeAt(0)).buffer;
    baseSigBuffer.value = sigBuf;
    sigType.value = s.sigType;
    selectedRect.value = s.selectedRect;
    // restore selectionEnabled
    selectionEnabled.value = s.allowSelection;
    // re-render
    renderPdf(pdfBuf).then(() => {
      const ctx2 = pdfCanvas.value!.getContext('2d')!;
      ctx2.strokeStyle='red'; ctx2.lineWidth=2;
      const r = s.selectedRect;
      ctx2.strokeRect(r.x, r.y, r.width, r.height);
    });
  } catch {}
});

// 4a. Save Field → disable further drawing
function saveField() {
  if (!basePdfBuffer.value || !baseSigBuffer.value || !selectedRect.value || !sigType.value) return;
  const pdfB = basePdfBuffer.value.slice(0);
  const sigB = baseSigBuffer.value.slice(0);
  const stored: Stored = {
    pdfBase64: arrayBufferToBase64(pdfB),
    selectedRect: selectedRect.value,
    sigBase64: arrayBufferToBase64(sigB),
    sigType: sigType.value,
    allowSelection: false
  };
  localStorage.setItem('pdfSignatureData', JSON.stringify(stored));
  selectionEnabled.value = false;
  alert('Field saved—drawing disabled');
}

// 4b. Sign PDF
async function signPdf() {
  if (!basePdfBuffer.value || !baseSigBuffer.value || !selectedRect.value || !viewport.value || !sigType.value) return;
  const pdfBuf = basePdfBuffer.value.slice(0);
  const sigBuf = baseSigBuffer.value.slice(0);

  const pdfDoc = await PDFDocument.load(pdfBuf);
  const page   = pdfDoc.getPages()[0];
  const img    = sigType.value === 'png'
    ? await pdfDoc.embedPng(sigBuf)
    : await pdfDoc.embedJpg(sigBuf);

  const { x,y,width,height } = selectedRect.value!;
  const pdfY = viewport.value.height - y - height;
  page.drawImage(img, { x, y: pdfY, width, height });

  const signed = await pdfDoc.save();
  const blob   = new Blob([signed], { type:'application/pdf' });
  window.open(URL.createObjectURL(blob), '_blank');
}
</script>

<style scoped>
.pdf-signer { max-width:600px; margin:auto; font-family:Arial,sans-serif; }
canvas { border:1px solid #ccc; margin-bottom:1rem; display:block; }
</style>

<template>
  <canvas
    ref="canvas"
    @mousedown="startSelect"
    @mousemove="updateSelect"
    @mouseup="finishSelect"
  />
</template>

<script setup lang="ts">
import {
  ref,
  watch,
  defineProps,
  defineEmits,
} from 'vue';
import type { Document, FieldDef } from '@/composables/usePdfSigner';
import * as pdfjsLib from 'pdfjs-dist';

const props = defineProps<{
  document: Document;
}>();

const emit = defineEmits<{
  (e: 'select-rect', rect: FieldDef['rect']): void;
}>();

const canvas = ref<HTMLCanvasElement | null>(null);
let pageImage: ImageData | null = null;
let isSelecting = false;
let startX = 0,
  startY = 0;

/** Render PDF page into canvas and store raw image */
async function renderPage() {
  const pdf = await pdfjsLib
    .getDocument({ data: props.document.buffer })
    .promise;
  const page = await pdf.getPage(1);
  const vp = props.document.viewport;
  const c = canvas.value!;
  c.width = vp.width;
  c.height = vp.height;
  const ctx = c.getContext('2d')!;
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  pageImage = ctx.getImageData(0, 0, c.width, c.height);
}

/** Helpers to track mouse drag and show rectangle */
function startSelect(e: MouseEvent) {
  if (!pageImage) return;
  isSelecting = true;
  const r = canvas.value!.getBoundingClientRect();
  startX = e.clientX - r.left;
  startY = e.clientY - r.top;
}

function updateSelect(e: MouseEvent) {
  if (!isSelecting || !pageImage) return;
  const c = canvas.value!,
    ctx = c.getContext('2d')!;
  ctx.putImageData(pageImage, 0, 0);
  const r = c.getBoundingClientRect();
  const cx = e.clientX - r.left,
    cy = e.clientY - r.top;
  const x = Math.min(startX, cx),
    y = Math.min(startY, cy),
    w = Math.abs(cx - startX),
    h = Math.abs(cy - startY);
  ctx.strokeStyle = 'red';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
}

function finishSelect(e: MouseEvent) {
  if (!isSelecting || !pageImage) return;
  isSelecting = false;
  const c = canvas.value!,
    r = c.getBoundingClientRect();
  const ex = e.clientX - r.left,
    ey = e.clientY - r.top;
  const x = Math.min(startX, ex),
    y = Math.min(startY, ey),
    w = Math.abs(ex - startX),
    h = Math.abs(ey - startY);
  emit('select-rect', { x, y, width: w, height: h });
}

watch(() => props.document.id, renderPage, { immediate: true });
</script>

<style scoped>
canvas {
  border: 1px solid #ccc;
  display: block;
  margin: 1rem 0;
}
</style>

<template>
  <div class="signature-library">
    <h3>Signature Library</h3>
    <div class="gallery">
      <div v-for="sig in signatures" :key="sig.id" class="sig-item">
        <img :src="sigUrl(sig)" alt="sig" width="100" />
        <p>{{ sig.name }}</p>
      </div>
    </div>

    <h4>Upload Signature/Initial</h4>
    <input type="file" accept="image/png, image/jpeg" @change="onUpload" />

    <h4>Or Draw</h4>
    <canvas ref="drawCanvas" width="300" height="100" class="draw-pad"></canvas>
    <button @click="saveDrawn">Save Drawing</button>
  </div>
</template>

<script setup lang="ts">
import {
  ref,
  onMounted,
  defineProps,
  defineEmits,
} from 'vue';
import type { Signature } from '@/composables/usePdfSigner';

defineProps<{ signatures: Signature[] }>();
const emit = defineEmits<{
  (
    e: 'save',
    payload: { buffer: ArrayBuffer; type: 'png' | 'jpg'; name: string }
  ): void;
}>();

const drawCanvas = ref<HTMLCanvasElement | null>(null);
let drawing = false;

/** Set up freehand drawing */
onMounted(() => {
  const c = drawCanvas.value!;
  const ctx = c.getContext('2d')!;
  c.addEventListener('pointerdown', () => {
    drawing = true;
    ctx.beginPath();
  });
  c.addEventListener('pointerup', () => {
    drawing = false;
    ctx.beginPath();
  });
  c.addEventListener('pointermove', (e: PointerEvent) => {
    if (!drawing) return;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineTo(e.offsetX, e.offsetY);
    ctx.stroke();
  });
});

/** Handle file upload */
async function onUpload(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const buf = await file.arrayBuffer();
  const type = file.type === 'image/jpeg' ? 'jpg' : 'png';
  const name = prompt('Name this signature/initial:') || file.name;
  emit('save', { buffer: buf, type, name });
}

/** Save the freehand drawing */
async function saveDrawn() {
  const c = drawCanvas.value!;
  const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!)));
  const buf = await blob.arrayBuffer();
  const name = prompt('Name this drawing:') || 'drawing';
  emit('save', { buffer: buf, type: 'png', name });
}

/** Create an object URL for display */
function sigUrl(sig: Signature) {
  const blob = new Blob(
    [sig.buffer],
    { type: sig.type === 'png' ? 'image/png' : 'image/jpeg' }
  );
  return URL.createObjectURL(blob);
}
</script>

<style scoped>
.signature-library {
  margin: 1rem 0;
}
.gallery {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin-bottom: 1rem;
}
.sig-item {
  text-align: center;
}
.draw-pad {
  border: 1px solid #ccc;
  display: block;
  margin: 0.5rem 0;
}
</style>

<template>
  <div class="col canvas-col">
    <!-- Empty state / dropzone -->
    <DropZone v-if="!pages.length" v-model:dragOver="localDragOver" :isLoading="isLoading"
      accept="application/pdf,image/*" multiple :disabled="layoutLocked" title="Add documents"
      subtitle="Click to upload or drag and drop files" @files="onDropzoneFiles"
      @update:dragOver="(v: boolean) => emit('update:isDragOver', v)" @rejected="onDropzoneRejected" />

    <!-- Pages -->
    <div v-for="(p, idx) in pages" :key="p.uid" class="page-wrapper" @dragover.prevent
      @drop="(e) => $emit('drop-field', idx, e)">
      <canvas :ref="(el) => mountCanvas(idx, el as unknown as HTMLCanvasElement | null)" class="pdf-canvas"
        @dragover.prevent @drop="(e) => $emit('drop-field', idx, e)" />
      <!-- Overlays -->
      <div v-for="f in p.fields" :key="f.id" class="field-overlay"
        :class="[f.type, { locked: layoutLocked, 'overlay-hidden': !props.overlaysReady }]" :data-id="f.id"
        :style="{
          left: f.rect.x + 'px',
          top: f.rect.y + 'px',
          width: f.rect.width + 'px',
          height: f.rect.height + 'px'
        }" @mousedown.stop="$emit('field-mousedown', idx, f.id)">
        <button v-if="!layoutLocked" class="field-delete" title="Remove field"
          @click.stop="$emit('field-delete', idx, f.id)">
          ✕
        </button>

        <!-- Signature image -->
        <img
          v-if="f.type === 'signature' && (f.sigPreviewUrl || f.sigBase64)"
          :src="f.sigPreviewUrl || `data:${f.sigType === 'jpg' ? 'image/jpeg' : 'image/png'};base64,${f.sigBase64}`"
          class="sig-img"
        />
        <span v-else-if="f.type === 'signature'" class="sig-icon">✒️</span>


        <span v-if="f.type === 'initial' && f.initialsText" class="initial-text">{{ f.initialsText }}</span>

        <div v-if="f.type === 'signature' && f.includeTimestamp && f.timestamp" class="timestamp-display-overlay">
          {{ formatSignedText(new Date(f.timestamp), signerName) }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { defineProps, defineEmits, ref, watch } from 'vue'
import type { PageData, Field } from '@/types'
import DropZone from './DropZone.vue';

const props = defineProps<{ 
  pages: PageData[]
  layoutLocked: boolean
  isLoading: boolean
  isDragOver: boolean
  overlaysReady: boolean
  signerName?: string
}>()

const emit = defineEmits<{
  (e: 'canvas-mounted', idx: number, canvas: HTMLCanvasElement): void
  (e: 'drop-field', pageIdx: number, ev: DragEvent): void
  (e: 'drop-documents', ev: DragEvent): void
  (e: 'field-mousedown', pageIdx: number, fieldId: string): void
  (e: 'field-delete', pageIdx: number, fieldId: string): void
  (e: 'update:isDragOver', v: boolean): void
}>()

// Keep a local v-model binding that mirrors your external isDragOver
const localDragOver = ref<boolean>(props.isDragOver)
// If a parent updates isDragOver externally, mirror it
// (optional; depends on how reactive your parent is)
watch(() => props.isDragOver, v => (localDragOver.value = v))

function onDropzoneFiles(files: FileList) {
  // Maintain your existing API: emit a pseudo DragEvent with dataTransfer.files
  const pseudoDrop = { dataTransfer: { files } } as unknown as DragEvent
  emit('drop-documents', pseudoDrop)
}

function onDropzoneRejected(reason: string) {
  // Hook for showing a toast or inline error if you add size/type rules
  console.warn('[dropzone rejected]', reason)
}

function mountCanvas(idx: number, el: Element | null) {
  if (el instanceof HTMLCanvasElement) emit('canvas-mounted', idx, el)
}

function getSigUrl(f: Field): string {
  if (!f.sigBase64) return ''
  const type = f.sigType === 'jpg' ? 'image/jpeg' : 'image/png'
  return URL.createObjectURL(new Blob([f.sigBase64], { type }))
}

function formatSignedText(date: Date, name = 'Signer') {
  const d = date.toLocaleDateString('en-US')
  const t = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()
  return `Electronically signed by ${name} ${d} at ${t}`
}
</script>

<style scoped>
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
  background: #fff;
  border: 1px solid #eee;
  box-shadow: 0 0 4px rgba(0, 0, 0, .1);
  border-radius: 6px;
}

/* Overlays (unchanged) */
.field-overlay {
  position: absolute;
  border: 2px dashed #6a2a86;
  background: rgba(106, 42, 134, .08);
  box-sizing: border-box;
  border-radius: 4px;
  cursor: pointer;
  touch-action: none;
  overflow: visible;
  z-index: 3;
}

.field-overlay.locked {
  border-style: solid;
}

.overlay-hidden {
  opacity: 0;
  pointer-events: none;
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
  box-shadow: 0 1px 2px rgba(0, 0, 0, .15);
}

.sig-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.sig-icon {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 1.1rem;
}

.initial-text {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 1rem;
  color: #000;
}

.timestamp-display-overlay {
  position: absolute;
  left: 50%;
  top: calc(100% + 4px);
  transform: translateX(-50%);
  white-space: nowrap;
  z-index: 4;
  pointer-events: none;
  width: max-content;
  font-size: 10px;
  color: #666;
  text-align: center;
  background: rgba(255, 255, 255, .92);
  padding: 2px 4px;
  border-radius: 2px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .1);
}
</style>

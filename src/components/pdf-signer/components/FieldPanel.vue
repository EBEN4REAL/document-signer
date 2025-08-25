<template>
  <div class="field-panel active">
    <div class="panel-header">
      <h3>{{ field.type === 'signature' ? 'Signature' : 'Initials' }}</h3>
      <button class="panel-close" @click="$emit('cancel')">✕</button>
    </div>

    <div v-if="field.type === 'signature'" class="sig-config">
      <!-- Timestamp option -->
      <div class="timestamp-option">
        <label class="checkbox-wrapper">
          <input
            type="checkbox"
            :checked="!!field.includeTimestamp"
            @change="onToggleTimestamp($event)"
          />
          <span class="checkbox-label">Include date and time stamp below signature</span>
        </label>
      </div>

      <div class="sig-actions">
        <button class="pill" @click="$emit('start-drawing')">✍ DRAW</button>
        <label class="pill">
          ⬆ UPLOAD
          <input
            type="file"
            accept="image/png,image/jpeg"
            class="hidden-input"
            @change="(e) => $emit('sig-selected', e)"
          />
        </label>
        <button class="pill" @click="$emit('clear-signature')">↺ CLEAR</button>
      </div>

      <!-- Draw pad -->
      <div class="sig-preview">
        <canvas
          v-if="drawingSig"
          ref="drawPad"
          class="draw-pad"
          width="600"
          height="200"
          @pointerdown="onStart"
          @pointermove="onMove"
          @pointerup="onEnd"
          @pointerleave="onEnd"
        ></canvas>

        <img
          v-else-if="field.sigBuffer"
          :src="sigUrl"
          class="preview-img"
        />

        <div v-else class="sig-placeholder">No signature yet. Draw or upload above.</div>
      </div>

      <div v-if="field.includeTimestamp" class="timestamp-preview">
        <small class="timestamp-label">Date/Time stamp will appear as:</small>
        <div class="timestamp-sample">{{ previewText }}</div>
      </div>

      <div class="draw-actions" v-if="drawingSig">
        <button class="pill faint success" @click="saveDrawn">✔ SAVE</button>
        <button class="pill faint danger" @click="$emit('cancel-drawing')">✖ CANCEL</button>
      </div>
    </div>

    <div v-else class="initials-config">
      <label class="initials-label">
        Initials
        <input
          :value="field.initialsText || ''"
          maxlength="3"
          placeholder="EJ"
          class="initials-input"
          @input="$emit('update-field', { initialsText: ($event.target as HTMLInputElement).value })"
        />
      </label>
    </div>

    <div class="panel-actions">
      <button class="pill success" @click="$emit('apply')">Apply</button>
      <button class="pill danger" @click="$emit('cancel')">Cancel</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, defineProps, defineEmits } from 'vue'
import type { Field } from '@/types'

const props = defineProps<{
  field: Field
  drawingSig: boolean
}>()

const emit = defineEmits<{
  (e: 'update-field', updates: Partial<Field>): void
  (e: 'start-drawing'): void
  (e: 'save-drawn', buf: ArrayBuffer): void
  (e: 'cancel-drawing'): void
  (e: 'sig-selected', ev: Event): void
  (e: 'clear-signature'): void
  (e: 'apply'): void
  (e: 'cancel'): void
}>()

const drawPad = ref<HTMLCanvasElement | null>(null)
let drawing = false
let ctx: CanvasRenderingContext2D | null = null

function onStart(ev: PointerEvent) {
  if (!drawPad.value) return
  if (!ctx) ctx = drawPad.value.getContext('2d')
  if (!ctx) return
  drawing = true
  ctx.beginPath()
  ctx.moveTo(ev.offsetX, ev.offsetY)
}
function onMove(ev: PointerEvent) {
  if (!drawing || !ctx) return
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.lineTo(ev.offsetX, ev.offsetY)
  ctx.stroke()
}
function onEnd() {
  drawing = false
}

async function saveDrawn() {
  if (!drawPad.value) return
  const blob = await new Promise<Blob>((resolve) =>
    drawPad.value!.toBlob((b) => resolve(b!), 'image/png')
  )
  const buf = await blob.arrayBuffer()
  emit('save-drawn', buf)
}

function onToggleTimestamp(e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  emit('update-field', {
    includeTimestamp: checked,
    timestamp: checked ? new Date() : undefined,
  })
}

const sigUrl = computed(() => {
  if (!props.field.sigBuffer) return ''
  const type = props.field.sigType === 'jpg' ? 'image/jpeg' : 'image/png'
  return URL.createObjectURL(new Blob([props.field.sigBuffer], { type }))
})

const previewText = computed(() => {
  const d = new Date()
  const datePart = d.toLocaleDateString('en-US')
  const timePart = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()
  return `Electronically signed by Oprah Winfrey ${datePart} at ${timePart}`
})
</script>

<style scoped>
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
  z-index: 1000;
  min-width: 640px;
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
.pill.success { border-color: #2e7d32; color: #2e7d32; }
.pill.danger { border-color: #c62828; color: #c62828; }
.pill.faint { background: #f7f7f7; border-color: #e1e1e1; color: #555; font-weight: 500; }

.sig-preview {
  background: #fff;
  border: 1px solid #e5e2e2;
  border-radius: 10px;
  padding: 0.75rem;
  max-height: 220px;
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.draw-pad {
  border: 1px solid #ccc;
  background: transparent !important;
  width: 600px;
  height: 200px;
  margin-bottom: 0.5rem;
  border-radius: 8px;
}
.preview-img { max-width: 100%; max-height: 200px; display: block; }

.timestamp-option { margin-bottom: 12px; }
.timestamp-preview {
  margin-top: 0.5rem;
  padding: 0.5rem;
  background: #f5f5f5;
  border-radius: 4px;
  border: 1px solid #e0e0e0;
}
.timestamp-label { display: block; margin-bottom: 0.25rem; color: #666; }
.timestamp-sample { font-size: 11px; color: #333; font-family: monospace; }

.initials-config { display: flex; flex-direction: column; gap: 0.5rem; }
.initials-label { display: flex; flex-direction: column; gap: 0.3rem; font-weight: 600; }
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
</style>

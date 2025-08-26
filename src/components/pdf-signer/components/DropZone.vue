<template>
  <div class="initial-upload-container">
    <div v-if="isLoading" class="loader">
      <slot name="loading">Loading PDF...</slot>
    </div>

    <label
      v-else
      :for="inputId"
      class="dropzone"
      :class="[{ 'drag-over': internalDragOver, disabled }, customClass]"
      role="button"
      tabindex="0"
      @dragover.prevent="onDragOver"
      @dragleave.prevent="onDragLeave"
      @drop.prevent="onDrop"
      @keydown.space.prevent="openPicker"
      @keydown.enter.prevent="openPicker"
    >
      <slot name="icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="dz-icon">
          <path d="M3 15a4 4 0 0 0 4 4h11a4 4 0 0 0 1-7.874A5 5 0 0 0 9 9.5c0 .168.006.335.02.5A4 4 0 0 0 3 15z" />
          <path d="M12 12v9" />
          <path d="m8 16 4-4 4 4" />
        </svg>
      </slot>

      <slot name="title">
        <h2 class="dz-title">{{ title }}</h2>
      </slot>

      <slot name="subtitle">
        <p class="dz-subtitle">{{ subtitle }}</p>
      </slot>
    </label>

    <input
      :id="inputId"
      ref="fileInput"
      type="file"
      class="visually-hidden-input"
      :accept="accept"
      :multiple="multiple"
      :disabled="disabled"
      @change="onChange"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, withDefaults, defineProps, defineEmits } from 'vue'

const props = withDefaults(defineProps<{
  accept?: string
  multiple?: boolean
  isLoading?: boolean
  disabled?: boolean
  /** Sync the drag-over visual state from parent if you want (v-model:dragOver) */
  dragOver?: boolean
  title?: string
  subtitle?: string
  customClass?: string
  /** Optional: reject files larger than this (in bytes) */
  maxBytes?: number
}>(), {
  accept: 'application/pdf,image/*',
  multiple: true,
  isLoading: false,
  disabled: false,
  title: 'Add documents',
  subtitle: 'Click to upload or drag and drop files'
})

const emit = defineEmits<{
  (e: 'update:dragOver', v: boolean): void
  (e: 'files', files: FileList): void
  (e: 'rejected', reason: string): void
}>()

const inputId = `dz-${Math.random().toString(36).slice(2)}`
const fileInput = ref<HTMLInputElement | null>(null)
const internalDragOver = ref(!!props.dragOver)

watch(() => props.dragOver, v => { if (v !== undefined) internalDragOver.value = !!v })
watch(internalDragOver, v => emit('update:dragOver', v))

function openPicker() {
  if (!props.disabled) fileInput.value?.click()
}
function onDragOver() { internalDragOver.value = true }
function onDragLeave() { internalDragOver.value = false }

function onDrop(e: DragEvent) {
  internalDragOver.value = false
  if (props.disabled) return
  const files = e.dataTransfer?.files
  if (!files?.length) return
  if (props.maxBytes) {
    for (const f of Array.from(files)) {
      if (f.size > props.maxBytes) {
        emit('rejected', `File too large: ${f.name}`)
        return
      }
    }
  }
  emit('files', files)
}

function onChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files?.length) return
  emit('files', input.files)
  input.value = '' // allow re-uploading same filename
}
</script>

<style scoped>
.initial-upload-container {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 360px;
}
.dropzone {
  width: 100%;
  min-height: 360px;
  border: 2px dashed #e5e7eb;
  border-radius: 12px;
  background: #fff;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; cursor: pointer;
  transition: border-color .15s, background .15s, box-shadow .15s;
  outline: none;
}
.dropzone.drag-over,
.dropzone:hover {
  border-color: #9ca3af;
  background: #fafafa;
}
.dropzone.disabled {
  opacity: .6;
  cursor: not-allowed;
}
.dz-icon { width: 48px; height: 48px; margin-bottom: 18px; color: #111; }
.dz-title { margin: 0 0 6px; font-size: 17px; line-height: 1.2; font-weight: 600; color: #424242; }
.dz-subtitle { margin: 0; font-size: 16px; color: #6b7280; }

/* Keep it focusable but visually hidden */
.visually-hidden-input {
  position: absolute !important;
  width: 1px !important; height: 1px !important;
  padding: 0 !important; margin: -1px !important; overflow: hidden !important;
  clip: rect(0, 0, 0, 0) !important; white-space: nowrap !important; border: 0 !important;
}
.loader { font-size: 1.1rem; color: #555; }
</style>

<template>
  <div class="col thumbs-col">
    <div class="thumbs-scroll">
      <div
        v-for="(p, idx) in pages"
        :key="p.uid"
        class="thumb-wrapper"
        @click="$emit('scroll-to-page', idx)"
      >
        <img :src="p.thumbnailUrl" class="thumb" />

        <!-- Hover overlay -->
        <div class="thumb-overlay improved">
          <button
            class="thumb-close"
            title="Remove page"
            @click.stop="$emit('remove-page', idx)"
          >
            ✕
          </button>

          <button
            class="thumb-replace-pill"
            title="Replace page"
            @click.stop="triggerReplace(idx)"
          >
            REPLACE
          </button>

          <input
            :ref="(el) => (replaceInputs[idx] = el as HTMLInputElement | null)"
            type="file"
            accept="application/pdf"
            class="hidden-input"
            @change="onReplacePdfUpload(idx, $event)"
          />
        </div>

        <div class="thumb-filename" :title="p.fileName">{{ p.fileName }}</div>
      </div>
    </div>

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
</template>

<script setup lang="ts">
import { ref, defineProps, defineEmits } from 'vue'
import type { PageData } from '@/types'

const props = defineProps<{
  pages: PageData[]
}>()

const emit = defineEmits<{
  (e: 'remove-page', idx: number): void
  (e: 'replace-page', idx: number, file: File): void
  (e: 'add-documents', files: FileList): void
  (e: 'scroll-to-page', idx: number): void
}>()

const replaceInputs = ref<(HTMLInputElement | null)[]>([])

function triggerReplace(idx: number) {
  replaceInputs.value[idx]?.click()
}

function onReplacePdfUpload(idx: number, e: Event) {
  const inp = e.target as HTMLInputElement
  const file = inp.files?.[0]
  if (!file) return
  emit('replace-page', idx, file)
  inp.value = ''
}

function onAddPdfUpload(e: Event) {
  const inp = e.target as HTMLInputElement
  if (!inp.files?.length) return
  emit('add-documents', inp.files)
  inp.value = ''
}
</script>

<style scoped>
.thumbs-col {
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
  padding-top: 0.75rem;
}

.thumb-wrapper {
  position: relative;
  margin-bottom: 0.75rem;
  cursor: pointer;
  border-radius: 6px;
  overflow: hidden;
}

.thumb {
  width: 100%;
  display: block;
}

/* overlay must be above the image */
.thumb-overlay.improved {
  position: absolute;
  inset: 0;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  opacity: 0;
  transition: opacity 0.15s ease-in-out;
  z-index: 2;
  pointer-events: none; /* keep clicks on buttons only */
}

.thumb-wrapper:hover .thumb-overlay.improved {
  opacity: 1;
  background: rgba(255, 255, 255, 0.6);
}

/* allow buttons to receive events */
.thumb-overlay.improved > * {
  pointer-events: auto;
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

.thumb-filename {
  font-size: 12px;
  color: #444;
  padding: 4px 6px;
  text-align: center;
  word-break: break-word;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>

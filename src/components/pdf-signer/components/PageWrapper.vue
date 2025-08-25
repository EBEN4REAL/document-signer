<template>
  <div class="page-wrapper">
    <canvas
      :ref="(el) => $emit('canvas-mounted', index, el as HTMLCanvasElement)"
      class="pdf-canvas"
      @dragover.prevent
      @drop="$emit('drop-field', $event)"
    />

    <FieldOverlay
      v-for="field in page.fields"
      :key="field.id"
      :field="field"
      :layoutLocked="layoutLocked"
      @mousedown="$emit('field-mousedown', field.id)"
      @delete="$emit('field-delete', field.id)"
    />
  </div>
</template>

<script setup lang="ts">
import FieldOverlay from './FieldOverlay.vue'
import type { PageData } from '@/types/index'

defineProps<{
  page: PageData
  index: number
  layoutLocked: boolean
}>()

defineEmits(['canvas-mounted', 'drop-field', 'field-mousedown', 'field-delete'])
</script>

<style scoped>
.page-wrapper {
  position: relative;
  margin-bottom: 2rem;
}

.pdf-canvas {
  width: 100% !important;
  height: auto !important;
  background: white;
  border: 1px solid #eee;
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.1);
}
</style>
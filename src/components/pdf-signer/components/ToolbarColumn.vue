<template>
  <div class="col toolbar-col">
    <div class="field-selector">
      <div
        class="field-card"
        :class="{ disabled: layoutLocked }"
        :draggable="!layoutLocked"
        @dragstart="(e) => $emit('drag-start', e, 'signature')"
      >
        <span class="drag-handle">⋮⋮</span>
        <span class="field-icon">✒️</span>
        <span class="field-label">Signature</span>
      </div>
      <div
        class="field-card"
        :class="{ disabled: layoutLocked }"
        :draggable="!layoutLocked"
        @dragstart="(e) => $emit('drag-start', e, 'initial')"
      >
        <span class="drag-handle">⋮⋮</span>
        <span class="field-icon">🔤</span>
        <span class="field-label">Initials</span>
      </div>
    </div>

    <hr />

    <button
      class="action-btn"
      :disabled="layoutLocked"
      :class="{ disabled: layoutLocked }"
      @click="$emit('save-config')"
    >
      💾 Save Config
    </button>
    <button class="action-btn primary" @click="$emit('sign-pdf')">Complete</button>
  </div>
</template>

<script setup lang="ts">

defineProps<{
  layoutLocked: boolean
}>()

defineEmits(['drag-start', 'save-config', 'sign-pdf'])
</script>

<style scoped>
.toolbar-col {
  display: flex;
  flex-direction: column;
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

.disabled {
  opacity: 0.4;
  cursor: not-allowed;
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
  padding: 0.65rem;
  margin-bottom: 0.5rem;
  background: #f0f0f0;
  border: 1px solid #ddd;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
}

.action-btn.primary {
  background: #3b0f5c;
  border-color: #3b0f5c;
  color: #fff;
}

.action-btn:hover {
  background: #e0e0e0;
}

.action-btn:last-of-type {
  margin-bottom: 0;
}
</style>
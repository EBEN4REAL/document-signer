<template>
  <header class="doc-header" :class="{ dirty: isDirty }">
    <div class="doc-title-wrap">
      <!-- Name input -->
      <input
        ref="documentNameInput"
        v-model="localValue"
        @keydown.enter.prevent="($event.currentTarget as HTMLInputElement)?.blur()"
        @blur="$emit('update:modelValue', localValue)"
        :aria-invalid="!!validationMsg"
        :placeholder="placeholder"
        class="doc-title-input"
        spellcheck="false"
        autocomplete="off"
        aria-label="Document name"
        :disabled="isLocked"
      />

      <!-- Clear name -->
      <button
        v-if="localValue"
        class="clear-btn"
        type="button"
        @click="clearName"
        title="Clear name"
        aria-label="Clear name"
      >
        ✕
      </button>
    </div>

    <div class="doc-meta" role="status" aria-live="polite">
      <span class="status-dot" :class="{ on: isDirty }" aria-hidden="true"></span>
      <span class="status-text">{{ isDirty ? 'Unsaved changes' : 'Saved' }}</span>
      <span v-if="validationMsg" class="status-error">{{ validationMsg }}</span>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref, defineProps, defineEmits, watch, computed } from 'vue'

const props = defineProps<{ modelValue: string, isLocked: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

// local proxy so v-model works
const localValue = ref(props.modelValue)
watch(() => props.modelValue, (v) => {
  if (v !== localValue.value) localValue.value = v
})

// simple UX bits
const placeholder = 'Untitled document'
const MAX_LEN = 120
const validationMsg = computed(() =>
  localValue?.value?.length > MAX_LEN ? `Keep it under ${MAX_LEN} characters` : ''
)
const isDirty = computed(() => localValue.value !== props.modelValue)

function clearName() {
  localValue.value = ''
  // do not emit immediately; user can type a new name or blur to persist
}
</script>

<style scoped>
:root {
  --header-bg: rgba(255,255,255,0.85);
  --header-border: rgba(0,0,0,0.06);
  --text-primary: #222;
  --text-secondary: #6b7280;
  --accent: #6a2a86; /* matches your field overlay purple */
  --error: #d14343;
}

@media (prefers-color-scheme: dark) {
  :root {
    --header-bg: rgba(17,17,17,0.6);
    --header-border: rgba(255,255,255,0.08);
    --text-primary: #e5e7eb;
    --text-secondary: #9ca3af;
  }
}

.doc-header {
  position: sticky;
  top: 0;
  z-index: 40;
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: .5rem 1rem;
  -webkit-backdrop-filter: saturate(140%) blur(8px);
  backdrop-filter: saturate(140%) blur(8px);
  border-bottom: 1px solid var(--header-border);
}

.doc-header.dirty {
  /* subtle tint when there are unsaved changes */
  box-shadow: inset 0 -2px 0 rgba(106,42,134,0.08);
}

.doc-title-wrap {
  display: flex;
  align-items: center;
  gap: .6rem;
  min-width: 0;
}

.doc-icon {
  width: 22px;
  height: 22px;
  color: var(--text-secondary);
  flex: 0 0 auto;
}

.doc-title-input {
  flex: 1 1 auto;
  min-width: 0;
  font-weight: 600;
  color: var(--text-primary);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 10px;
  padding: .45rem .7rem;
  font-size: 30px;
  line-height: 1.2;
  outline: none;
  transition: border-color .15s, box-shadow .15s, background .15s;
  text-overflow: ellipsis;
}

.doc-title-input::placeholder {
  color: var(--text-secondary);
  font-weight: 500;
}

.doc-title-input:focus {
  background: rgba(106,42,134,0.06);
  border-color: rgba(106,42,134,0.35);
  box-shadow: 0 0 0 3px rgba(106,42,134,0.18);
}

.doc-title-input[aria-invalid="true"] {
  border-color: var(--error);
  box-shadow: 0 0 0 3px rgba(209,67,67,.18);
}

.clear-btn {
  flex: 0 0 auto;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-secondary);
  width: 28px;
  height: 28px;
  border-radius: 7px;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: background .15s, color .15s;
}
.clear-btn:hover {
  background: rgba(0,0,0,0.05);
}
@media (prefers-color-scheme: dark) {
  .clear-btn:hover { background: rgba(255,255,255,0.06); }
}

.doc-meta {
  display: inline-flex;
  align-items: center;
  gap: .5rem;
  color: var(--text-secondary);
  font-size: .85rem;
  user-select: none;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #22c55e; /* saved */
  box-shadow: 0 0 0 2px rgba(34,197,94,0.15);
  transition: background .2s, box-shadow .2s;
}
.status-dot.on {
  background: #f59e0b; /* unsaved */
  box-shadow: 0 0 0 2px rgba(245,158,11,0.18);
}

.status-text { line-height: 1; }
.status-error {
  margin-left: .25rem;
  color: var(--error);
}
</style>

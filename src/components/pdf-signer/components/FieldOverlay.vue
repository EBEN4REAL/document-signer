<template>
  <div
    class="field-overlay"
    :class="[field.type, { locked: layoutLocked }]"
    :data-id="field.id"
    :style="fieldStyle"
    @mousedown.stop="$emit('mousedown', field.id)"
  >
    <button v-if="!layoutLocked" class="field-delete" @click.stop="$emit('delete')">✕</button>

    <SignatureField
      v-if="field.type === 'signature'"
      :field="field"
      :layoutLocked="layoutLocked"
    />
    
    <InitialsField
      v-else-if="field.type === 'initial'"
      :field="field"
    />

    <!-- Initials label for layout mode -->
    <div v-if="field.type === 'initial' && !layoutLocked" class="field-type-label">
      Initials
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import SignatureField from './SignatureField.vue'
import InitialsField from './InitialsField.vue'
import type { Field } from '@/types/index'

const props = defineProps<{
  field: Field
  layoutLocked: boolean
}>()

defineEmits(['mousedown', 'delete'])

const fieldStyle = computed(() => ({
  left: `${props?.field?.rect.x}px`,
  top: `${props?.field.rect.y}px`,
  width: `${props.field?.rect?.width}px`,
  height: `${props.field?.rect?.height}px`,
}))
</script>

<style scoped>
.field-overlay {
  position: absolute;
  border: 2px dashed #6a2a86;
  background: rgba(106, 42, 134, 0.08);
  box-sizing: border-box;
  border-radius: 4px;
  cursor: pointer;
  touch-action: none;
  overflow: visible;
}

.field-overlay.locked {
  border-style: solid;
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
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  z-index: 20;
}

.field-type-label {
  position: absolute;
  top: -18px;
  left: 50%;
  transform: translateX(-50%);
  background: #000;
  color: #fff;
  padding: 2px 6px;
  border-radius: 2px;
  font-size: 10px;
  white-space: nowrap;
}
</style>
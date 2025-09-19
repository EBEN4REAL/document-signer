<template>
  <div class="signature-field">
    <img v-if="field.sigBase64" :src="sigUrl" class="sig-img" />
    <span v-else class="sig-icon">✒️</span>

    <div
      v-if="field.includeTimestamp && field.timestamp"
      class="timestamp-display-overlay"
    >
      {{ formatSignedText(field.timestamp, signerName) }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { type Field } from '@/types/index'

const props = defineProps<{
  field: Field
  layoutLocked: boolean
}>()

const signerName = "Oprah Winfrey"

const sigUrl = computed(() => {
  if (!props.field.sigBase64) return ''
  return `data:${props.field.sigType === 'jpg' ? 'image/jpeg' : 'image/png'};base64,${props.field.sigBase64}`;
})

const formatSignedText = (date: Date, name: string) => {
  return `Electronically signed by ${name} ${date.toLocaleDateString('en-US')} at ${date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })}`
}
</script>

<style scoped>
.sig-img {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.sig-icon {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 1.2em;
}

.timestamp-display-overlay {
  position: absolute;
  left: 50%;
  top: calc(100% + 4px);
  transform: translateX(-50%);
  white-space: nowrap;
  z-index: 10;
  pointer-events: none;
  width: max-content;
  font-size: 10px;
  color: #666;
  text-align: center;
  background: rgba(255, 255, 255, 0.9);
  padding: 2px 4px;
  border-radius: 2px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}
</style>
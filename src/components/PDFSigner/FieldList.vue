<template>
  <div class="field-list">
    <h3>Fields to Sign</h3>
    <ul>
      <li v-for="f in fields" :key="f.id">
        <strong>{{ f.name }}</strong>
        ({{ f.type }}) — x:{{ f.rect.x }}, y:{{ f.rect.y }}, w:{{ f.rect.width }}, h:{{ f.rect.height }}
        <button @click="$emit('remove', f.id)">Remove</button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { defineProps, defineEmits } from 'vue';
import type { FieldDef } from '@/composables/usePdfSigner';

defineProps<{ fields: FieldDef[] }>();
defineEmits<{ (e: 'remove', id: string): void }>();
</script>

<style scoped>
.field-list {
  margin: 1rem 0;
}
.field-list ul {
  list-style: none;
  padding: 0;
}
.field-list li {
  margin-bottom: 0.5rem;
}
.field-list button {
  margin-left: 1rem;
}
</style>

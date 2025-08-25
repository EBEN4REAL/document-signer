<template>
  <span class="initial-text">
    {{ field.initialsText || 'Initials' }}
  </span>
</template>

<script setup lang="ts">
import { defineProps } from 'vue'
import type { Field } from '@/types/index'

defineProps<{
  field: Field
}>()
</script>

<style scoped>
.initial-text {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 1em;
  color: #000;
  font-weight: 600;
  text-align: center;
  width: 100%;
  padding: 0 4px;
  box-sizing: border-box;
}
</style>
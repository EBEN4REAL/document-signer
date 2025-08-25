import { ref, type Ref } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import type { Field, PageData } from '@/types'

export function useFieldManagement(pages: Ref<PageData[]>, layoutLocked: Ref<boolean>) {
  const currentField = ref<Field | null>(null)
  const drawingSig = ref(false)

  function removeField(pageIdx: number, fieldId: string) {
    if (layoutLocked.value) return
    const list = pages.value[pageIdx].fields
    const i = list.findIndex((f) => f.id === fieldId)
    if (i >= 0) list.splice(i, 1)
  }

  function selectField(pageIdx: number, fieldId: string) {
    const field = pages.value[pageIdx].fields.find((x) => x.id === fieldId)
    if (field) {
      currentField.value = { ...field }
    }
  }

  function applyField() {
    if (!currentField.value) return
    
    if (currentField.value.type === 'signature' && currentField.value.includeTimestamp) {
      currentField.value.timestamp = new Date()
    }
    
    const idx = pages.value.findIndex((pg) => pg.fields.some((f) => f.id === currentField.value!.id))
    if (idx < 0) return
    
    const list = pages.value[idx].fields
    const i = list.findIndex((f) => f.id === currentField.value!.id)
    if (i >= 0) {
      list.splice(i, 1, { ...currentField.value! })
    }
    
    cancelField()
  }

  function cancelField() {
    currentField.value = null
    drawingSig.value = false
  }

  return {
    currentField,
    drawingSig,
    removeField,
    selectField,
    applyField,
    cancelField
  }
}
import { ref, reactive, toValue, type MaybeRefOrGetter, type Ref } from 'vue'
import type { PageData } from '@/types'

// Define what the composable returns
export interface DragAndDropComposable {
  dragState: {
    type: 'signature' | 'initial' | null
    boxW: number
    boxH: number
    anchorX: number
    anchorY: number
  }
  isDragOver: Ref<boolean>
  onDragStart: (e: DragEvent, type: 'signature' | 'initial') => void
  onDropField: (pageIdx: number, e: DragEvent) => void
  cleanupDragPreview: () => void
}

export function useDragAndDrop(
  pages: MaybeRefOrGetter<PageData[]>,   // <-- accepts ref or array
  layoutLocked: Ref<boolean>,
  PADDING: number
): DragAndDropComposable {
  const isDragOver = ref(false)

  const dragState = reactive({
    type: null as 'signature' | 'initial' | null,
    boxW: 0,
    boxH: 0,
    anchorX: 0,
    anchorY: 0,
  })

  // floating preview element
  let dragPreviewEl: HTMLDivElement | null = null

  function onDragStart(e: DragEvent, type: 'signature' | 'initial') {
    if (layoutLocked.value) {
      e.preventDefault()
      return
    }

    dragState.type = type
    dragState.boxW = type === 'signature' ? 150 : 60
    dragState.boxH = 50

    const targetRect = (e.target as HTMLElement).getBoundingClientRect()
    dragState.anchorX = e.clientX - targetRect.left
    dragState.anchorY = e.clientY - targetRect.top

    cleanupDragPreview()

    dragPreviewEl = document.createElement('div')
    dragPreviewEl.style.position = 'fixed'
    dragPreviewEl.style.pointerEvents = 'none'
    dragPreviewEl.style.zIndex = '999999'
    dragPreviewEl.style.width = `${dragState.boxW}px`
    dragPreviewEl.style.height = `${dragState.boxH}px`
    dragPreviewEl.style.border = '2px dashed #6a2a86'
    dragPreviewEl.style.background = 'rgba(106, 42, 134, 0.08)'
    dragPreviewEl.style.boxSizing = 'border-box'
    document.body.appendChild(dragPreviewEl)

    // create a transparent dummy for drag image
    const dummy = document.createElement('canvas')
    dummy.width = dummy.height = 1
    e.dataTransfer?.setDragImage(dummy, 0, 0)

    e.dataTransfer?.setData('fieldType', type)
  }

  function onDropField(pageIdx: number, e: DragEvent) {
    if (layoutLocked.value) return
    e.preventDefault()

    const list = toValue(pages)
    const page = list[pageIdx]
    if (!page) return

    const type = (e.dataTransfer?.getData('fieldType') as 'signature' | 'initial') || dragState.type
    if (!type) return

    const canvas = document.querySelectorAll<HTMLCanvasElement>('.pdf-canvas')[pageIdx]
    if (!canvas) return

    const wrapper = canvas.parentElement as HTMLElement
    const wrapperRect = wrapper.getBoundingClientRect()
    const canvasRect = canvas.getBoundingClientRect()

    const xInWrapper = e.clientX - wrapperRect.left
    const yInWrapper = e.clientY - wrapperRect.top

    const canvasLeftInWrapper = canvasRect.left - wrapperRect.left
    const canvasTopInWrapper = canvasRect.top - wrapperRect.top

    const left = canvasLeftInWrapper + (xInWrapper - canvasLeftInWrapper) - dragState.anchorX
    const top = canvasTopInWrapper + (yInWrapper - canvasTopInWrapper) - dragState.anchorY

    // Clamp field inside page
    const innerW = canvasRect.width - PADDING * 2
    const innerH = canvasRect.height - PADDING * 2
    const minX = canvasLeftInWrapper + PADDING
    const minY = canvasTopInWrapper + PADDING
    const maxX = minX + innerW
    const maxY = minY + innerH

    const clampedX = Math.min(Math.max(left, minX), maxX - dragState.boxW)
    const clampedY = Math.min(Math.max(top, minY), maxY - dragState.boxH)

    // Push new field into page
    page.fields.push({
      id: crypto.randomUUID(),
      type,
      rect: {
        x: clampedX,
        y: clampedY,
        width: dragState.boxW,
        height: dragState.boxH,
      },
    })

    cleanupDragPreview()
  }

  function cleanupDragPreview() {
    if (dragPreviewEl) {
      dragPreviewEl.remove()
      dragPreviewEl = null
    }
    dragState.type = null
  }

  // Update floating preview during drag
  document.addEventListener('dragover', (e) => {
    if (!dragPreviewEl) return
    dragPreviewEl.style.left = `${e.clientX - dragState.anchorX}px`
    dragPreviewEl.style.top = `${e.clientY - dragState.anchorY}px`
  })
  document.addEventListener('dragend', cleanupDragPreview)
  document.addEventListener('drop', cleanupDragPreview)

  return {
    dragState,
    isDragOver,
    onDragStart,
    onDropField,
    cleanupDragPreview,
  }
}

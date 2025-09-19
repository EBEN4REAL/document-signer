// useIndexedDB.ts
import type { PageData, SavedConfig } from '@/types'
import { set as idbSet, get as idbGet } from 'idb-keyval'

export function useIndexedDB() {
  // ----------------- Save -----------------
  async function saveToIndexedDB(
    storageKey: string,
    config: SavedConfig
  ) {
    try {
      await idbSet(storageKey, config)
      return true
    } catch (err) {
      console.error('Failed to save to IndexedDB:', err)
      return false
    }
  }

  // ----------------- Load -----------------
  async function loadFromIndexedDB(storageKey: string) {
    try {
      const saved = await idbGet(storageKey)
      if (!saved) return null

      const typed = saved as SavedConfig

      const pages: PageData[] = typed.pages.map((s) => ({
        uid: s.uid,
        pageNumber: s.pageNumber,
        pdfBytes: base64ToBytes(s.pdfBase64),
        viewport: null,
        imageData: null,
        thumbnailUrl: '',
        fields: s.fields.map((f) => ({
          ...f,
          timestamp: f.timestamp ? new Date(f.timestamp) : undefined,
          sigPreviewUrl: f.sigBase64
            ? `data:${f.sigType === 'jpg' ? 'image/jpeg' : 'image/png'};base64,${f.sigBase64}`
            : undefined,
        })),
        fileName: s.fileName ?? '',
      }))

      return { documentName: typed.documentName, pages }
    } catch (error) {
      console.error('Error loading from IndexedDB:', error)
      return null
    }
  }

  // ----------------- Helpers -----------------
  function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }

  return {
    saveToIndexedDB,
    loadFromIndexedDB,
  }
}

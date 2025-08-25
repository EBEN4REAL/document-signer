import type { PageData, SavedConfig } from '@/types'
import { set as idbSet, get as idbGet } from 'idb-keyval'

export function useIndexedDB() {
  async function saveToIndexedDB(storageKey: string, nameKey: string, pages: PageData[], documentName: string) {
    const serial: SavedConfig = {
      pages: pages.map((p) => ({
        uid: p.uid,
        pageNumber: p.pageNumber,
        pdfBase64: bytesToBase64(p.pdfBytes),
        fileName: p.fileName,
        fields: p.fields.map((f) => ({
          id: f.id,
          type: f.type,
          rect: { ...f.rect },
          initialsText: f.initialsText,
          sigBuffer: f.sigBuffer ? Array.from(new Uint8Array(f.sigBuffer)) : undefined,
          sigType: f.sigType,
          includeTimestamp: f.includeTimestamp,
          timestamp: f.timestamp ? f.timestamp.toISOString() : undefined,
        })),
      })),
    }

    try {
      await idbSet(storageKey, serial)
      await idbSet(nameKey, documentName)
      return true
    } catch (err) {
      console.error('Failed to save to IndexedDB:', err)
      return false
    }
  }

  async function loadFromIndexedDB(storageKey: string, nameKey: string) {
    try {
      const savedName = await idbGet(nameKey)
      const saved = await idbGet(storageKey)
      
      if (!saved) return null

      const typed = saved as SavedConfig
      const documentName = typeof savedName === 'string' ? savedName : ''

      const pages: PageData[] = typed.pages.map((s) => ({
        uid: s.uid,
        pageNumber: s.pageNumber,
        pdfBytes: Uint8Array.from(atob(s.pdfBase64), (c) => c.charCodeAt(0)),
        viewport: null,
        imageData: null,
        thumbnailUrl: '',
        fields: s.fields.map((f) => ({
          ...f,
          sigBuffer: f.sigBuffer ? new Uint8Array(f.sigBuffer).buffer : undefined,
          timestamp: f.timestamp ? new Date(f.timestamp) : undefined,
        })),
        fileName: s.fileName ?? '',
      }))

      return { pages, documentName }
    } catch (error) {
      console.error('Error loading from IndexedDB:', error)
      return null
    }
  }

  function bytesToBase64(bytes: Uint8Array): string {
    let s = ''
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
    return btoa(s)
  }

  return {
    saveToIndexedDB,
    loadFromIndexedDB
  }
}
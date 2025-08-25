import type { PageViewport } from "pdfjs-dist"

export interface FieldRect {
  x: number
  y: number
  width: number
  height: number
}


export interface SavedConfig {
  pages: Array<{
    uid: string
    pageNumber: number
    pdfBase64: string
    fileName?: string
    fields: Array<{
      id: string
      type: 'signature' | 'initial'
      rect: FieldRect
      initialsText?: string
      sigBuffer?: number[]
      sigType?: 'png' | 'jpg'
      includeTimestamp?: boolean
      timestamp?: string
    }>
  }>
}

export interface Field {
  id: string
  type: 'signature' | 'initial'
  rect: FieldRect
  initialsText?: string
  sigBuffer?: ArrayBuffer
  sigType?: 'png' | 'jpg'
  includeTimestamp?: boolean
  timestamp?: Date
}

export interface PageData {
  uid: string
  pageNumber: number
  pdfBytes: Uint8Array
  viewport: PageViewport | null
  imageData: ImageData | null
  thumbnailUrl: string
  fields: Field[]
  fileName: string
}

export interface DragState {
  type: 'signature' | 'initial' | null
  boxW: number
  boxH: number
  anchorX: number
  anchorY: number
}
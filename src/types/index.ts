import type { PageViewport } from "pdfjs-dist"

export interface FieldRect {
  x: number
  y: number
  width: number
  height: number
}

// types.ts
export interface SavedConfig {
  documentName: string
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
      sigBase64?: string
      sigType?: 'png' | 'jpg'
      includeTimestamp?: boolean
      timestamp?: string
    }>
  }>
}


export interface Field {
  id: string
  type: "signature" | "initial"
  rect: FieldRect
  initialsText?: string

  sigBase64?: string
  sigType?: "png" | "jpg"
  includeTimestamp?: boolean
  timestamp?: Date   // 👈 runtime uses Date
  sigPreviewUrl?: string 
}



export interface PageData {
  uid: string
  pageNumber: number
  pdfBytes: Uint8Array
  viewport: any
  imageData: any
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
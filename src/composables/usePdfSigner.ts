import { ref } from 'vue';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import type { PageViewport } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.js?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface FieldDef {
  id: string;
  name: string;
  type: 'signature' | 'initial';
  page: number;
  rect: { x: number; y: number; width: number; height: number };
}

export interface Signature {
  id: string;
  name: string;
  type: 'png' | 'jpg';
  buffer: ArrayBuffer;
}

export interface Document {
  id: string;
  fileName: string;
  buffer: ArrayBuffer;
  viewport: PageViewport;
  fields: FieldDef[];
}

export function usePdfSigner() {
  const documents = ref<Document[]>([]);
  const signatures = ref<Signature[]>([]);
  const activeDocId = ref<string | null>(null);

  /** 1. Add a new PDF document, render first page viewport */
  async function addDocument(file: File) {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const page = await pdf.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const id = crypto.randomUUID();
    documents.value.push({
      id,
      fileName: file.name,
      buffer: buf,
      viewport: vp,
      fields: [],
    });
    activeDocId.value = id;
  }

  /** 2. Add a field definition to the active document */
  function selectField(
    rect: FieldDef['rect'],
    name: string,
    type: FieldDef['type']
  ) {
    const doc = documents.value.find((d) => d.id === activeDocId.value);
    if (doc) {
      doc.fields.push({
        id: crypto.randomUUID(),
        name,
        type,
        page: 1,
        rect,
      });
    }
  }

  /** 3. Remove a field from the active document */
  function removeField(fieldId: string) {
    const doc = documents.value.find((d) => d.id === activeDocId.value);
    if (doc) {
      doc.fields = doc.fields.filter((f) => f.id !== fieldId);
    }
  }

  /** 4. Save a signature/initial for reuse */
  function saveSignature(
    buffer: ArrayBuffer,
    type: 'png' | 'jpg',
    name: string
  ) {
    signatures.value.push({
      id: crypto.randomUUID(),
      name,
      type,
      buffer,
    });
  }

  /** 5. Export the signed PDF, drawing each field’s matching signature */
  async function exportSignedPdf(docId: string) {
    const doc = documents.value.find((d) => d.id === docId);
    if (!doc) return;
    const pdfDoc = await PDFDocument.load(doc.buffer);
    const page = pdfDoc.getPage(0);

    for (const f of doc.fields) {
      const sig = signatures.value.find((s) => s.name === f.name);
      if (!sig) continue;
      const img =
        sig.type === 'png'
          ? await pdfDoc.embedPng(sig.buffer)
          : await pdfDoc.embedJpg(sig.buffer);
      const { x, y, width, height } = f.rect;
      // PDF coords have origin at bottom-left
      const pdfY = doc.viewport.height - y - height;
      page.drawImage(img, { x, y: pdfY, width, height });
    }

    const signed = await pdfDoc.save();
    const blob = new Blob([signed], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `signed-${doc.fileName}`;
    a.click();
  }

  return {
    documents,
    signatures,
    activeDocId,
    addDocument,
    selectField,
    removeField,
    saveSignature,
    exportSignedPdf,
  };
}

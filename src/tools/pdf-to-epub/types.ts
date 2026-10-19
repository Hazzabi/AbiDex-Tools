/**
 * Contrato interno de la herramienta PDF → EPUB.
 * No se comparte con otras herramientas (GUIDELINES.md §R4).
 */

/** Opciones que la UI envía al worker. `buffer` viaja como transferible. */
export interface ConversionRequest {
  buffer: ArrayBuffer;
  title?: string;
  author?: string;
  language?: string;
}

export type ConversionStage = 'loading' | 'extracting' | 'packaging' | 'done';

/** Progreso reactivo: `percentage` es un entero de 0 a 100. */
export interface ConversionProgress {
  current: number;
  total: number;
  percentage: number;
  stage: ConversionStage;
}

/** Resultado que el worker devuelve al hilo principal. */
export interface ConversionResult {
  blob: Blob;
  title: string;
  author?: string;
  language: string;
  pages: number;
  chapters: number;
  headings: number;
  /** Párrafos `<p>` generados (sin contar títulos, listas ni figuras). */
  paragraphs: number;
  /** Listas `<ul>`/`<ol>` generadas. */
  lists: number;
  words: number;
  /** Imágenes incrustadas en el EPUB (sin contar la portada renderizada). */
  images: number;
  /** `true` si la primera hoja se ha renderizado como portada. */
  cover: boolean;
}

export type WorkerRequest = {
  type: 'convert';
  payload: ConversionRequest;
};

export type WorkerResponse =
  | { type: 'progress'; payload: ConversionProgress }
  | { type: 'done'; payload: ConversionResult }
  | { type: 'error'; payload: { message: string } };

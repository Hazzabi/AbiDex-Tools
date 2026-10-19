/**
 * Worker de conversión PDF → EPUB 3.
 *
 * Vive en su propio hilo (GUIDELINES.md §R2): `pdfjs-dist` extrae el texto y
 * las imágenes, las heurísticas de reflow agrupan líneas y párrafos en
 * capítulos definidos por encabezados (no por páginas), la primera hoja se
 * renderiza como portada y `jszip` construye el contenedor EPUB. Nada de esto
 * toca el DOM ni la red.
 */
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import JSZip from 'jszip';

import type {
  ConversionProgress,
  ConversionRequest,
  ConversionResult,
  ConversionStage,
  WorkerRequest,
  WorkerResponse,
} from './types';

// El worker de pdf.js se carga desde el bundle local: cero CDNs.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/**
 * Recursos estáticos de pdf.js (fuentes estándar, CMaps, wasm de JPX/JBIG2 e
 * ICC). `vite.config.ts` los copia a `assets/pdfjs/` en build y los sirve en
 * dev con un middleware, así que todo viaja con la app y sin conexión externa.
 */
const PDF_ASSETS_BASE = new URL(
  'assets/pdfjs/',
  new URL(import.meta.env.BASE_URL, self.location.origin),
).href;

/**
 * `pdfjs-dist` 6 inicializa su worker asumiendo `window` (hilo principal). Al
 * ejecutarse dentro de nuestro propio worker esa comprobación falla y pdf.js
 * cae a un "fake worker" que además emite mensajes de su protocolo por el
 * mismo canal que usamos nosotros. Para evitarlo creamos un worker anidado y
 * se lo pasamos explícitamente con `workerPort` (patrón oficial de pdf.js).
 */
function createPdfJsWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(pdfWorkerUrl, { type: 'module' });
  } catch {
    return null;
  }
}

const pdfJsWorker = createPdfJsWorker();
if (pdfJsWorker) {
  pdfjsLib.GlobalWorkerOptions.workerPort = pdfJsWorker;
}

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse) => void;
};

const NO_CONTENT_ERROR = 'PdfToEpub:no-content';
const EDGE_MARGIN = 0.08;
const MAX_TITLE_LENGTH = 300;
const MAX_AUTHOR_LENGTH = 200;
/** Presupuesto defensivo: a partir de aquí se ignoran imágenes nuevas. */
const MAX_IMAGES = 250;
/** Umbral de troceado cuando el PDF no tiene encabezados detectables. */
const FALLBACK_CHAPTER_WORDS = 900;
/** Alto objetivo en píxeles del render de portada. */
const COVER_TARGET_HEIGHT = 1440;

/* ------------------------------------------------------------------ *
 * Tipos internos
 * ------------------------------------------------------------------ */

interface MutableLine {
  parts: string[];
  xStart: number;
  xEnd: number;
  lastEnd: number;
  y: number;
  sizes: Map<number, number>;
}

interface TextLine {
  text: string;
  xStart: number;
  xEnd: number;
  y: number;
  fontSize: number;
  maxFontSize: number;
  charCount: number;
  topRatio: number;
  isEdge: boolean;
  keep: boolean;
}

interface PageText {
  pageNumber: number;
  lines: TextLine[];
}

type BlockType = 'h1' | 'h2' | 'h3' | 'p' | 'img';

interface Block {
  type: BlockType;
  text: string;
  /** Solo para `img`: ruta relativa dentro de OEBPS. */
  src?: string;
  alt?: string;
  /** Página del PDF de la que procede el bloque. */
  page: number;
}

interface Chapter {
  index: number;
  pageNumber: number;
  title: string;
  blocks: Block[];
}

/** Imagen ya codificada y lista para el contenedor EPUB. */
interface ImageAsset {
  href: string;
  mime: 'image/jpeg' | 'image/png';
  bytes: Uint8Array;
}

/** Imagen asociada a la página del PDF en la que aparece. */
interface PageImage {
  pageNumber: number;
  asset: ImageAsset;
}

/** Objetos de imagen según los devuelve pdf.js v6. */
interface RawImage {
  width: number;
  height: number;
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray;
  bitmap?: ImageBitmap;
}

interface TextItemLike {
  str: string;
  transform?: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
}

/* ------------------------------------------------------------------ *
 * Utilidades
 * ------------------------------------------------------------------ */

function report(
  current: number,
  total: number,
  percentage: number,
  stage: ConversionStage,
): void {
  const safeTotal = Math.max(1, total);
  const payload: ConversionProgress = {
    current: Math.max(0, Math.min(current, safeTotal)),
    total: safeTotal,
    percentage: Math.max(0, Math.min(100, Math.round(percentage))),
    stage,
  };
  ctx.postMessage({ type: 'progress', payload });
}

function createUuid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}

/** dcterms:modified exige `CCYY-MM-DDThh:mm:ssZ`, sin milisegundos. */
function modifiedTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncate(value: string, max: number): string {
  const text = cleanText(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function normalizeLanguage(value: string | undefined): string {
  const candidate = (value ?? '').trim();
  return /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(candidate) ? candidate : 'es';
}

function countWords(text: string): number {
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

function supportsOffscreenCanvas(): boolean {
  return typeof OffscreenCanvas === 'function';
}

/* ------------------------------------------------------------------ *
 * 1. Extracción: fragmentos de pdf.js → líneas legibles
 * ------------------------------------------------------------------ */

function effectiveFontSize(transform: number[], height?: number): number {
  const scaleX = Math.abs(transform[0] ?? 0);
  const scaleY = Math.abs(transform[3] ?? 0);
  const fromMatrix = Math.max(scaleX, scaleY);
  if (fromMatrix > 0.5) return fromMatrix;
  if (typeof height === 'number' && height > 0.5) return height;
  return 10;
}

function finalizeLine(line: MutableLine, pageHeight: number): TextLine | null {
  const text = cleanText(line.parts.join(''));
  if (!text) return null;

  // Tamaño dominante de la línea ponderado por caracteres (evita que una
  // letra capital aislada convierta todo el párrafo en un titular).
  let dominant = 0;
  let dominantChars = -1;
  let largest = 0;
  for (const [size, chars] of line.sizes) {
    if (chars > dominantChars) {
      dominantChars = chars;
      dominant = size;
    }
    if (size > largest) largest = size;
  }

  const fontSize = dominant || largest || 10;
  const topRatio =
    pageHeight > 0 ? Math.min(1, Math.max(0, (pageHeight - line.y) / pageHeight)) : 0;

  return {
    text,
    xStart: line.xStart,
    xEnd: line.xEnd,
    y: line.y,
    fontSize,
    maxFontSize: largest || fontSize,
    charCount: text.length,
    topRatio,
    isEdge: (topRatio < EDGE_MARGIN || topRatio > 1 - EDGE_MARGIN) && text.length <= 90,
    keep: true,
  };
}

function buildLines(items: readonly unknown[], pageHeight: number): TextLine[] {
  const lines: TextLine[] = [];
  let current: MutableLine | null = null;
  let pendingSpace = false;

  const flush = () => {
    if (!current) return;
    const line = finalizeLine(current, pageHeight);
    if (line) lines.push(line);
    current = null;
    pendingSpace = false;
  };

  for (const raw of items) {
    if (!raw || typeof raw !== 'object' || !('str' in raw)) continue;
    const item = raw as TextItemLike;
    const text = item.str;
    if (!text) continue;

    if (text.trim().length === 0) {
      // Espacio explícito del PDF: se materializa al añadir el siguiente fragmento.
      pendingSpace = true;
      continue;
    }

    const transform = item.transform ?? [];
    const size = effectiveFontSize(transform, item.height);
    const x = transform[4] ?? 0;
    const y = transform[5] ?? 0;
    const width =
      typeof item.width === 'number' && Number.isFinite(item.width)
        ? Math.abs(item.width)
        : text.length * size * 0.5;

    const tolerance = Math.max(1.5, size * 0.45);
    if (!current || Math.abs(current.y - y) > tolerance) flush();

    if (!current) {
      current = {
        parts: [],
        xStart: x,
        xEnd: x + width,
        lastEnd: x + width,
        y,
        sizes: new Map(),
      };
    }

    const previousText = current.parts.join('');
    const gap = x - current.lastEnd;
    const needsSpace =
      pendingSpace ||
      (previousText.length > 0 &&
        gap > size * 0.22 &&
        !/\s$/.test(previousText) &&
        !/^\s/.test(text));

    if (needsSpace && previousText.length > 0) current.parts.push(' ');

    current.parts.push(text);
    current.xStart = Math.min(current.xStart, x);
    current.xEnd = Math.max(current.xEnd, x + width);
    current.lastEnd = x + width;

    const chars = text.replace(/\s/g, '').length || text.length;
    current.sizes.set(size, (current.sizes.get(size) ?? 0) + chars);
    pendingSpace = false;

    if (item.hasEOL) flush();
  }

  flush();
  return lines;
}

/* ------------------------------------------------------------------ *
 * 2. Heurísticas: encabezados/pies repetidos y tamaño de cuerpo
 * ------------------------------------------------------------------ */

function normalizeEdgeKey(text: string): string {
  return text
    .toLocaleLowerCase('es')
    .replace(/\d+/g, '#')
    .replace(/\b[ivxlcdm]{1,7}\b/g, '#')
    .replace(/[^\p{L}\p{N}#]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Elimina numeración y cabeceras/pies que se repiten página tras página. */
function removeRepeatedEdgeLines(pages: PageText[]): void {
  const occurrences = new Map<string, Set<number>>();

  for (const page of pages) {
    for (const line of page.lines) {
      if (!line.isEdge) continue;
      const key = normalizeEdgeKey(line.text);
      if (!key || key.length > 80) continue;
      const pagesWithKey = occurrences.get(key) ?? new Set<number>();
      pagesWithKey.add(page.pageNumber);
      occurrences.set(key, pagesWithKey);
    }
  }

  const threshold = Math.max(2, Math.ceil(pages.length * 0.35));
  const repeated = new Set(
    [...occurrences.entries()]
      .filter(([, pagesWithKey]) => pagesWithKey.size >= threshold)
      .map(([key]) => key),
  );

  const pageNumberPattern = /^(p[áa]g(ina)?\.?\s*)?[#\s.\-–—]+$/i;

  for (const page of pages) {
    for (const line of page.lines) {
      if (!line.isEdge) continue;

      const key = normalizeEdgeKey(line.text);
      if (key && repeated.has(key)) {
        line.keep = false;
        continue;
      }

      const masked = line.text.replace(/\d+/g, '#').replace(/\b[ivxlcdm]{1,7}\b/gi, '#');
      if (line.text.length <= 12 && pageNumberPattern.test(masked)) {
        line.keep = false;
      }
    }
  }
}

/** Mediana ponderada por caracteres de los tamaños de fuente del cuerpo. */
function computeBodyFontSize(pages: PageText[]): number {
  const weights = new Map<number, number>();

  for (const page of pages) {
    for (const line of page.lines) {
      if (!line.keep || line.isEdge) continue;
      const size = Math.round(line.fontSize * 2) / 2;
      weights.set(size, (weights.get(size) ?? 0) + line.charCount);
    }
  }

  if (weights.size === 0) return 12;

  const entries = [...weights.entries()].sort((a, b) => a[0] - b[0]);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let accumulated = 0;

  for (const [size, weight] of entries) {
    accumulated += weight;
    if (accumulated >= total / 2) return size;
  }

  return entries[entries.length - 1][0];
}

function headingLevel(line: TextLine, bodySize: number): BlockType | null {
  const text = line.text.trim();
  if (!text || text.length > 180) return null;
  // Un titular no suele terminar en punto o coma, y una línea de cuerpo no
  // supera el 114 % del tamaño dominante del documento.
  if (/[.,;:]$/.test(text)) return null;

  const ratio = line.fontSize / Math.max(bodySize, 1);
  if (ratio >= 1.75) return 'h1';
  if (ratio >= 1.35) return 'h2';
  if (ratio >= 1.14) return 'h3';
  return null;
}

/* ------------------------------------------------------------------ *
 * 3. Reflow: líneas → bloques de párrafo y encabezado
 * ------------------------------------------------------------------ */

/** Bloque sin anclar todavía a una página concreta. */
type LooseBlock = Omit<Block, 'page'>;

function buildBlocks(lines: TextLine[], bodySize: number): LooseBlock[] {
  const blocks: LooseBlock[] = [];
  const active = lines.filter((line) => line.keep && line.text.length > 0);
  if (active.length === 0) return blocks;

  let maxWidth = 0;
  let leftMost = Number.POSITIVE_INFINITY;
  for (const line of active) {
    maxWidth = Math.max(maxWidth, line.xEnd - line.xStart);
    leftMost = Math.min(leftMost, line.xStart);
  }
  if (!Number.isFinite(leftMost)) leftMost = 0;

  let buffer = '';
  let previous: TextLine | null = null;

  const flush = () => {
    const text = cleanText(buffer);
    if (text) blocks.push({ type: 'p', text });
    buffer = '';
  };

  for (const line of active) {
    const level = headingLevel(line, bodySize);
    if (level) {
      flush();
      blocks.push({ type: level, text: cleanText(line.text) });
      previous = line;
      continue;
    }

    if (buffer && previous) {
      const gap = previous.y - line.y;
      const endsHyphenated = /-$/.test(buffer) && /^[a-záéíóúüñ]/.test(line.text);
      const indented = line.xStart - leftMost > bodySize * 0.75;
      const bigGap = gap > bodySize * 1.5;
      const previousShort =
        previous.xEnd - previous.xStart < maxWidth * 0.6 && gap > bodySize * 0.55;
      const outdented = line.xStart < previous.xStart - bodySize * 0.4;

      if (!endsHyphenated && (bigGap || indented || previousShort || outdented)) {
        flush();
      }
    }

    if (!buffer) {
      buffer = cleanText(line.text);
    } else if (/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]-$/.test(buffer) && /^[a-záéíóúüñ]/.test(line.text)) {
      // Palabra partida por guion al final de línea: se une sin espacio.
      buffer = `${buffer.slice(0, -1)}${cleanText(line.text)}`;
    } else {
      buffer = `${buffer} ${cleanText(line.text)}`;
    }

    previous = line;
  }

  flush();
  return blocks;
}

/* ------------------------------------------------------------------ *
 * 4. Imágenes incrustadas y portada
 * ------------------------------------------------------------------ */

/**
 * Convierte un objeto de imagen de pdf.js a bytes de imagen reflowable.
 * - `bitmap` (JPEG ya decodificado) → JPEG al 85 %.
 * - RGB 24 bpp → JPEG al 85 % (fotografías; el PNG dispara el tamaño del EPUB).
 * - GRAYSCALE 1 bpp y RGBA 32 bpp → PNG sin pérdida (texto binarizado / alpha).
 */
async function encodeImage(raw: RawImage): Promise<ImageAsset | null> {
  const { width, height } = raw;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
  if (width * height > 40_000_000) return null;
  if (!supportsOffscreenCanvas()) return null;

  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) return null;

  try {
    // Preferencia por datos crudos con `kind` (PNG sin pérdida para 1 bpp /
    // RGBA); el `bitmap` de pdf.js solo es necesario si no llegan datos.
    const kind = raw.kind;
    const data = raw.data;
    if (kind === undefined && raw.bitmap) {
      // Solo llegamos aquí si pdf.js entrega un ImageBitmap decodificado, sin
      // datos crudos. Elegimos formato por contenido: alpha o arte plano
      // (poca variedad de color, típico de escáner 1 bpp) → PNG; fotografía
      // continua → JPEG.
      context.drawImage(raw.bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, width, height).data;
      const unique = new Set<number>();
      let hasAlpha = false;
      const totalPixels = width * height;
      const stride = Math.max(1, Math.floor(totalPixels / 4096));
      for (let index = 0; index < totalPixels; index += stride) {
        const offset = index * 4;
        if (pixels[offset + 3] < 255) {
          hasAlpha = true;
          break;
        }
        unique.add((pixels[offset] << 16) | (pixels[offset + 1] << 8) | pixels[offset + 2]);
      }
      const asPng = hasAlpha || unique.size <= 16;
      const blob = await canvas.convertToBlob({
        type: asPng ? 'image/png' : 'image/jpeg',
        ...(asPng ? {} : { quality: 0.85 }),
      });
      return {
        href: '',
        mime: asPng ? 'image/png' : 'image/jpeg',
        bytes: new Uint8Array(await blob.arrayBuffer()),
      };
    }

    if (!data || kind === undefined) return null;

    const rgba = new Uint8ClampedArray(width * height * 4);
    if (kind === 1) {
      // GRAYSCALE_1BPP: filas empaquetadas a bits (1 = blanco, 0 = negro).
      const rowBytes = (width + 7) >> 3;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
          const value = bit ? 255 : 0;
          const offset = (y * width + x) * 4;
          rgba[offset] = value;
          rgba[offset + 1] = value;
          rgba[offset + 2] = value;
          rgba[offset + 3] = 255;
        }
      }
    } else if (kind === 2) {
      // RGB_24BPP.
      let source = 0;
      for (let target = 0; target < rgba.length; target += 4) {
        rgba[target] = data[source];
        rgba[target + 1] = data[source + 1];
        rgba[target + 2] = data[source + 2];
        rgba[target + 3] = 255;
        source += 3;
      }
    } else if (kind === 3) {
      // RGBA_32BPP: ya está listo.
      rgba.set(data.subarray(0, rgba.length));
    } else {
      return null;
    }

    context.putImageData(new ImageData(rgba, width, height), 0, 0);

    const asPng = kind === 1 || kind === 3;
    const blob = await canvas.convertToBlob({
      type: asPng ? 'image/png' : 'image/jpeg',
      ...(asPng ? {} : { quality: 0.85 }),
    });
    return {
      href: '',
      mime: asPng ? 'image/png' : 'image/jpeg',
      bytes: new Uint8Array(await blob.arrayBuffer()),
    };
  } catch {
    return null;
  } finally {
    // El bitmap de pdf.js es transferido y reutilizable: hay que liberarlo.
    if (raw.bitmap) raw.bitmap.close();
  }
}

/**
 * Resuelve el objeto de imagen referenciado por un operador de pintado.
 * Los objetos llegan por `objs` (por página) o `commonObjs` (compartidos)
 * mientras la lista de operadores se construye; se espera con timeout para
 * no colgar la conversión si un recurso nunca llega.
 */
function waitForImageObject(
  page: { objs: ImageObjectStore; commonObjs: ImageObjectStore },
  objId: string,
  timeoutMs = 8_000,
): Promise<RawImage | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: RawImage | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);

    for (const store of [page.objs, page.commonObjs]) {
      try {
        if (store.has(objId)) {
          finish((store.get(objId) as RawImage | null) ?? null);
          return;
        }
        store.get(objId, (data: unknown) => finish((data as RawImage | null) ?? null));
        return;
      } catch {
        continue;
      }
    }
    finish(null);
  });
}

interface ImageObjectStore {
  get(objId: string, callback?: (data: unknown) => void): unknown;
  has(objId: string): boolean;
}

const PAINT_IMAGE_OPS = new Set<number>([
  pdfjsLib.OPS.paintImageXObject,
  pdfjsLib.OPS.paintImageXObjectRepeat,
]);

/**
 * Extrae las imágenes de una página recorriendo su lista de operadores. Se
 * codifican a PNG/JPEG ANTES de que `page.cleanup()` cierre los bitmaps.
 */
async function collectPageImages(
  page: { objs: ImageObjectStore; commonObjs: ImageObjectStore },
  opList: { fnArray: ArrayLike<number>; argsArray: ArrayLike<ArrayLike<unknown>> },
  remainingQuota: number,
): Promise<ImageAsset[]> {
  const assets: ImageAsset[] = [];
  const fns = opList.fnArray;
  const args = opList.argsArray;

  for (let index = 0; index < fns.length && assets.length < remainingQuota; index += 1) {
    try {
      if (PAINT_IMAGE_OPS.has(fns[index])) {
        const objId = typeof args[index][0] === 'string' ? String(args[index][0]) : null;
        if (!objId) continue;
        const raw = await waitForImageObject(page, objId);
        const asset = raw ? await encodeImage(raw) : null;
        if (asset) assets.push(asset);
        continue;
      }

      if (fns[index] === pdfjsLib.OPS.paintInlineImageXObject) {
        const raw = (args[index][0] ?? null) as RawImage | null;
        const asset = raw ? await encodeImage(raw) : null;
        if (asset) assets.push(asset);
      }
    } catch {
      // Una imagen corrupta no debe abortar la conversión.
    }
  }

  return assets;
}

/** Renderiza la primera hoja del PDF: la portada del EPUB. */
interface RenderablePage {
  getViewport(options: { scale: number }): { width: number; height: number };
  render(options: Record<string, unknown>): { promise: PromiseLike<void> };
  cleanup(): void;
}

interface PdfDocumentLike {
  getPage(pageNumber: number): PromiseLike<RenderablePage>;
}

async function renderCover(pdf: PdfDocumentLike): Promise<ImageAsset | null> {
  if (!supportsOffscreenCanvas()) return null;

  let page: RenderablePage | null = null;
  try {
    page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    if (base.width <= 0 || base.height <= 0) return null;

    const scale = Math.min(3, COVER_TARGET_HEIGHT / base.height);
    const viewport = page.getViewport({ scale });
    const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return null;

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    const task = page.render({
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
      background: '#ffffff',
    });
    await task.promise;

    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.86 });
    return {
      href: 'images/cover.jpeg',
      mime: 'image/jpeg',
      bytes: new Uint8Array(await blob.arrayBuffer()),
    };
  } catch {
    return null;
  } finally {
    try {
      page?.cleanup();
    } catch {
      // cleanup best-effort.
    }
  }
}

/* ------------------------------------------------------------------ *
 * 5. Capitulación: los encabezados definen los capítulos, no las páginas
 * ------------------------------------------------------------------ */

function buildChapters(pages: PageText[], pageImages: PageImage[]): {
  chapters: Chapter[];
  headings: number;
  words: number;
  images: PageImage[];
} {
  removeRepeatedEdgeLines(pages);
  const bodySize = computeBodyFontSize(pages);

  // Flujo global de unidades: bloques de texto + imágenes de cada página (en
  // orden de operadores). Las imágenes se cuelgan al final del contenido de
  // su propia página, que es el orden de lectura en PDFs escaneados.
  const units: Block[] = [];
  const imagesByPage = new Map<number, Block[]>();
  let figureCount = 0;

  for (const image of pageImages) {
    figureCount += 1;
    const block: Block = {
      type: 'img',
      text: '',
      src: image.asset.href,
      alt: `Figura ${figureCount} (página ${image.pageNumber})`,
      page: image.pageNumber,
    };
    const list = imagesByPage.get(image.pageNumber) ?? [];
    list.push(block);
    imagesByPage.set(image.pageNumber, list);
  }

  for (const page of pages) {
    for (const loose of buildBlocks(page.lines, bodySize)) {
      units.push({ ...loose, page: page.pageNumber });
    }
    for (const block of imagesByPage.get(page.pageNumber) ?? []) {
      units.push(block);
    }
  }

  const headings = units.filter(
    (unit) => unit.type === 'h1' || unit.type === 'h2' || unit.type === 'h3',
  ).length;
  const words = units.reduce(
    (sum, unit) => sum + (unit.type === 'p' ? countWords(unit.text) : 0),
    0,
  );

  // Nivel "top" del documento: el primer nivel jerárquico que aparece. Solo
  // los encabezados de ese nivel abren capítulo.
  const topLevel: typeof units[number]['type'] | null =
    units.some((unit) => unit.type === 'h1')
      ? 'h1'
      : units.some((unit) => unit.type === 'h2')
        ? 'h2'
        : units.some((unit) => unit.type === 'h3')
          ? 'h3'
          : null;

  const chapters: Chapter[] = [];
  const firstPage = pages[0]?.pageNumber ?? 1;

  if (!topLevel) {
    // Sin encabezados detectables: se trocea por presupuesto de palabras al
    // terminar una página, para que el índice siga siendo navegable.
    let sectionIndex = 1;
    let currentBlocks: Block[] = [];
    let currentWords = 0;
    let chapterStart = firstPage;

    const close = () => {
      if (currentBlocks.length === 0) return;
      chapters.push({
        index: chapters.length + 1,
        pageNumber: chapterStart,
        title: `Sección ${sectionIndex}`,
        blocks: currentBlocks,
      });
      sectionIndex += 1;
      currentBlocks = [];
      currentWords = 0;
    };

    for (const page of pages) {
      const pageUnits = units.filter(
        (unit) => unit.page === page.pageNumber && unit.type === 'p',
      );
      if (pageUnits.length === 0) continue;
      if (currentBlocks.length === 0) chapterStart = page.pageNumber;
      currentBlocks.push(...pageUnits);
      currentWords += pageUnits.reduce((sum, unit) => sum + countWords(unit.text), 0);

      if (currentWords >= FALLBACK_CHAPTER_WORDS) close();
    }
    close();
  } else {
    // Reparto por encabezados del nivel top. El texto anterior al primero
    // (título, portada de texto, prólogo) forma su propio capítulo inicial.
    let title = 'Introducción';
    let chapterBlocks: Block[] = [];
    let chapterStart = firstPage;

    const close = () => {
      if (chapterBlocks.length === 0) return;
      chapters.push({
        index: chapters.length + 1,
        pageNumber: chapterStart,
        title,
        blocks: chapterBlocks,
      });
    };

    for (const unit of units) {
      const isBreak = unit.type === topLevel;

      if (chapterBlocks.length === 0) {
        chapterStart = unit.page;
        title = isBreak ? truncate(unit.text, 120) : 'Introducción';
      } else if (isBreak) {
        close();
        chapterBlocks = [];
        chapterStart = unit.page;
        title = truncate(unit.text, 120);
      }

      chapterBlocks.push(unit);
    }
    close();

    // Un capítulo sin párrafos ni imágenes es un encabezado huérfano (título
    // seguido de otro título): se fusiona con el siguiente conservando su
    // encabezado como bloque visual; el índice se queda con el segundo.
    for (let index = chapters.length - 1; index >= 0; index -= 1) {
      const chapter = chapters[index];
      const hasContent = chapter.blocks.some(
        (block) => block.type === 'p' || block.type === 'img',
      );
      if (hasContent) continue;

      const next = chapters[index + 1];
      const previous = chapters[index - 1];
      if (next) {
        next.blocks.unshift(...chapter.blocks);
        chapters.splice(index, 1);
      } else if (previous) {
        previous.blocks.push(...chapter.blocks);
        chapters.splice(index, 1);
      }
    }
  }

  return { chapters, headings, words, images: pageImages };
}

/* ------------------------------------------------------------------ *
 * 6. Generación de archivos EPUB 3
 * ------------------------------------------------------------------ */

function chapterXhtml(chapter: Chapter, language: string): string {
  const body = chapter.blocks
    .map((block) => {
      if (block.type === 'img') {
        const alt = escapeXml(block.alt ?? 'Figura');
        return `      <figure><img src="${block.src}" alt="${alt}" /></figure>`;
      }
      return `      <${block.type}>${escapeXml(block.text)}</${block.type}>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${language}" lang="${language}">
  <head>
    <meta charset="utf-8" />
    <title>${escapeXml(chapter.title)}</title>
    <link rel="stylesheet" type="text/css" href="style.css" />
  </head>
  <body>
    <section epub:type="chapter" id="chapter-${chapter.index}">
${body}
    </section>
  </body>
</html>
`;
}

function coverXhtml(language: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${language}" lang="${language}">
  <head>
    <meta charset="utf-8" />
    <title>Portada</title>
    <link rel="stylesheet" type="text/css" href="style.css" />
  </head>
  <body>
    <section epub:type="cover" id="cover">
      <img src="images/cover.jpeg" alt="Portada del libro" />
    </section>
  </body>
</html>
`;
}

function navigationXhtml(
  chapters: Chapter[],
  title: string,
  language: string,
  hasCover: boolean,
): string {
  const items = chapters
    .map(
      (chapter) =>
        `        <li><a href="${chapterFileName(chapter.index)}">${escapeXml(
          truncate(chapter.title, 110),
        )}</a></li>`,
    )
    .join('\n');

  const coverLandmark = hasCover
    ? `        <li><a epub:type="cover" href="cover.xhtml">Portada</a></li>\n`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${language}" lang="${language}">
  <head>
    <meta charset="utf-8" />
    <title>Índice</title>
    <link rel="stylesheet" type="text/css" href="style.css" />
  </head>
  <body>
    <nav epub:type="toc" id="toc" role="doc-toc">
      <h1>${escapeXml(truncate(title, 160))}</h1>
      <ol>
${items}
      </ol>
    </nav>
    <nav epub:type="landmarks" hidden="hidden">
      <h2>Marcas de navegación</h2>
      <ol>
${coverLandmark}        <li><a epub:type="bodymatter" href="${chapterFileName(chapters[0].index)}">Inicio del contenido</a></li>
      </ol>
    </nav>
  </body>
</html>
`;
}

function ncxXml(
  chapters: Chapter[],
  title: string,
  identifier: string,
  language: string,
): string {
  const navPoints = chapters
    .map(
      (chapter) => `    <navPoint id="navPoint-${chapter.index}" playOrder="${chapter.index}">
      <navLabel>
        <text>${escapeXml(truncate(chapter.title, 110))}</text>
      </navLabel>
      <content src="${chapterFileName(chapter.index)}" />
    </navPoint>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${language}">
  <head>
    <meta name="dtb:uid" content="${escapeXml(identifier)}" />
    <meta name="dtb:depth" content="1" />
    <meta name="dtb:totalPageCount" content="0" />
    <meta name="dtb:maxPageNumber" content="0" />
  </head>
  <docTitle>
    <text>${escapeXml(truncate(title, 160))}</text>
  </docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>
`;
}

function packageOpf(
  chapters: Chapter[],
  images: ImageAsset[],
  hasCover: boolean,
  options: {
    title: string;
    author?: string;
    language: string;
    identifier: string;
    modified: string,
  },
): string {
  const creator = options.author
    ? `    <dc:creator id="creator">${escapeXml(options.author)}</dc:creator>\n`
    : '';

  const manifestItems = [
    `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />`,
    `    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />`,
    `    <item id="style" href="style.css" media-type="text/css" />`,
    hasCover
      ? `    <item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml" />`
      : null,
    ...images.map((asset) => {
      const isCover = hasCover && asset.href === 'images/cover.jpeg';
      const properties = isCover ? ' properties="cover-image"' : '';
      return `    <item id="${manifestIdForHref(asset.href)}" href="${asset.href}" media-type="${asset.mime}"${properties} />`;
    }),
    ...chapters.map(
      (chapter) =>
        `    <item id="chapter-${chapter.index}" href="${chapterFileName(chapter.index)}" media-type="application/xhtml+xml" />`,
    ),
  ].filter((item): item is string => item !== null);

  const spineItems = [
    `    <itemref idref="nav" linear="no" />`,
    hasCover ? `    <itemref idref="cover-page" />` : null,
    ...chapters.map((chapter) => `    <itemref idref="chapter-${chapter.index}" />`),
  ].filter((item): item is string => item !== null);

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="${options.language}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">${escapeXml(options.identifier)}</dc:identifier>
    <dc:title>${escapeXml(options.title)}</dc:title>
    <dc:language>${options.language}</dc:language>
${creator}    <meta property="dcterms:modified">${options.modified}</meta>
  </metadata>
  <manifest>
${manifestItems.join('\n')}
  </manifest>
  <spine toc="ncx">
${spineItems.join('\n')}
  </spine>
</package>
`;
}

function manifestIdForHref(href: string): string {
  return `img-${href.replace(/[^0-9a-z]/gi, '-')}`;
}

function containerXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>
`;
}

function styleCss(): string {
  return `@charset "UTF-8";

/* Tipografía fluida y espaciado de párrafos para lectores EPUB 3. */
html {
  font-size: 100%;
}

body {
  margin: 0;
  padding: 5% 6%;
  font-family: Georgia, "Iowan Old Style", "Times New Roman", serif;
  font-size: 1em;
  line-height: 1.6;
  color: #111111;
  text-align: justify;
  hyphens: auto;
  word-wrap: break-word;
}

h1,
h2,
h3 {
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
  color: #0f172a;
  line-height: 1.25;
  text-align: left;
  margin: 1.8em 0 0.6em;
  page-break-after: avoid;
  break-after: avoid;
}

h1 {
  font-size: 1.6em;
}

h2 {
  font-size: 1.35em;
}

h3 {
  font-size: 1.15em;
}

p {
  margin: 0 0 0.85em;
  text-indent: 1.2em;
}

h1 + p,
h2 + p,
h3 + p,
section > p:first-child {
  text-indent: 0;
}

figure {
  margin: 1em 0;
  text-align: center;
  page-break-inside: avoid;
}

img {
  max-width: 100%;
  height: auto;
}

section[epub\\:type=\"cover\"] {
  text-align: center;
  margin: 0;
  padding: 0;
}

section[epub\\:type=\"cover\"] img {
  max-width: 100%;
}

nav ol {
  list-style: none;
  padding-left: 0;
}

nav li {
  margin: 0.45em 0;
}

nav a {
  color: #0f172a;
  text-decoration: none;
}
`;
}

function chapterFileName(index: number): string {
  return `chapter_${String(index).padStart(3, '0')}.xhtml`;
}

/* ------------------------------------------------------------------ *
 * 7. Orquestación
 * ------------------------------------------------------------------ */

async function packageEpub(
  chapters: Chapter[],
  images: PageImage[],
  cover: ImageAsset | null,
  options: { title: string; author?: string; language: string },
): Promise<Blob> {
  const identifier = `urn:uuid:${createUuid()}`;
  const modified = modifiedTimestamp(new Date());

  const zip = new JSZip();

  // El estándar exige `mimetype` como primera entrada y sin compresión.
  zip.file('mimetype', 'application/epub+zip', {
    compression: 'STORE',
    createFolders: false,
  });

  zip.file('META-INF/container.xml', containerXml(), { createFolders: false });
  zip.file(
    'OEBPS/content.opf',
    packageOpf(
      chapters,
      cover ? [...images.map((image) => image.asset), cover] : images.map((image) => image.asset),
      cover !== null,
      { ...options, identifier, modified },
    ),
    { createFolders: false },
  );

  if (cover) {
    zip.file('OEBPS/cover.xhtml', coverXhtml(options.language), { createFolders: false });
    zip.file(`OEBPS/${cover.href}`, cover.bytes, { createFolders: false });
  }

  for (const image of images) {
    zip.file(`OEBPS/${image.asset.href}`, image.asset.bytes, { createFolders: false });
  }

  zip.file('OEBPS/toc.ncx', ncxXml(chapters, options.title, identifier, options.language), {
    createFolders: false,
  });
  zip.file(
    'OEBPS/nav.xhtml',
    navigationXhtml(chapters, options.title, options.language, cover !== null),
    { createFolders: false },
  );
  zip.file('OEBPS/style.css', styleCss(), { createFolders: false });

  for (const chapter of chapters) {
    zip.file(`OEBPS/${chapterFileName(chapter.index)}`, chapterXhtml(chapter, options.language), {
      createFolders: false,
    });
  }

  let lastReported = 80;

  return zip.generateAsync(
    {
      type: 'blob',
      mimeType: 'application/epub+zip',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
      platform: 'UNIX',
    },
    (metadata) => {
      const percentage = 80 + metadata.percent * 0.18;
      if (Math.round(percentage) > lastReported) {
        lastReported = Math.round(percentage);
        report(chapters.length, Math.max(1, chapters.length), percentage, 'packaging');
      }
    },
  );
}

async function handleConvert(request: ConversionRequest): Promise<void> {
  const title = truncate(request.title ?? '', MAX_TITLE_LENGTH) || 'Documento sin título';
  const author = request.author ? truncate(request.author, MAX_AUTHOR_LENGTH) : undefined;
  const language = normalizeLanguage(request.language);

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(request.buffer),
    // Seguridad: los PDFs son datos no confiables (GUIDELINES.md §R5).
    disableFontFace: true,
    useSystemFonts: true,
    useWorkerFetch: false,
    // Recursos locales de pdf.js (fuentes/CMaps/wasm/ICC): todobundle local.
    cMapUrl: `${PDF_ASSETS_BASE}cmaps/`,
    standardFontDataUrl: `${PDF_ASSETS_BASE}standard_fonts/`,
    iccUrl: `${PDF_ASSETS_BASE}iccs/`,
    wasmUrl: `${PDF_ASSETS_BASE}wasm/`,
  });

  const pdf = await loadingTask.promise;
  const total = pdf.numPages;

  try {
    const pages: PageText[] = [];
    const pageImages: PageImage[] = [];
    let runningNumber = 0;
    report(0, total, 4, 'loading');

    // Extracción de texto + imágenes, página a página.
    for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const lines = buildLines(content.items, viewport.height);

      const assets = await collectPageImages(page, await page.getOperatorList(), MAX_IMAGES - runningNumber);
      for (const asset of assets) {
        runningNumber += 1;
        const extension = asset.mime === 'image/png' ? 'png' : 'jpeg';
        asset.href = `images/img_${String(runningNumber).padStart(4, '0')}.${extension}`;
        pageImages.push({ pageNumber, asset });
      }

      pages.push({ pageNumber, lines });
      try {
        page.cleanup();
      } catch {
        // cleanup best-effort: los bitmaps ya se han copiado a bytes.
      }

      report(pageNumber, total, 4 + (pageNumber / total) * 70, 'extracting');
    }

    const built = buildChapters(pages, pageImages);

    // PDF sin texto ni imágenes: no hay nada que publicar.
    if (built.chapters.length === 0 && built.images.length === 0) {
      throw new Error(NO_CONTENT_ERROR);
    }

    // PDF con solo imágenes (p. ej. escaneado): un capítulo único con las
    // figuras en orden de lectura.
    const chapters = built.chapters;
    if (chapters.length === 0) {
      const blocks = built.images.map((image, index) => ({
        type: 'img' as const,
        text: '',
        src: image.asset.href,
        alt: `Figura ${index + 1} (página ${image.pageNumber})`,
        page: image.pageNumber,
      }));
      chapters.push({ index: 1, pageNumber: 1, title: 'Ilustraciones', blocks });
    }

    report(total, total, 76, 'packaging');

    // Portada: primera hoja del PDF renderizada tal cual.
    const cover = await renderCover(pdf);
    report(total, total, 78, 'packaging');

    const blob = await packageEpub(chapters, built.images, cover, { title, author, language });

    report(total, total, 100, 'done');

    const result: ConversionResult = {
      blob,
      title,
      language,
      pages: total,
      chapters: chapters.length,
      headings: built.headings,
      words: built.words,
      images: built.images.length,
      cover: cover !== null,
      ...(author ? { author } : {}),
    };

    ctx.postMessage({ type: 'done', payload: result });
  } finally {
    // Destruye el documento (y libera el worker de pdf.js).
    await loadingTask.destroy();
    pdfJsWorker?.terminate();
  }
}

function toUserMessage(error: unknown): string {
  if (error instanceof Error) {
    switch (error.name) {
      case 'PasswordException':
        return 'El PDF está protegido con contraseña. Quítala antes de convertirlo.';
      case 'InvalidPDFException':
        return 'El archivo no es un PDF válido o está dañado.';
      case 'MissingPDFException':
        return 'No se han recibido datos del PDF.';
      default:
        break;
    }

    if (error.message === NO_CONTENT_ERROR) {
      return 'No se ha encontrado texto ni imágenes en el PDF. Es posible que el documento esté vacío o no sea legible.';
    }

    if (error instanceof RangeError || /memory|allocation/i.test(error.message)) {
      return 'El PDF es demasiado grande para la memoria disponible de la pestaña. Prueba con un archivo más pequeño.';
    }

    if (error.message) {
      return `No se ha podido convertir el PDF: ${error.message}`;
    }
  }

  return 'Ha ocurrido un error inesperado durante la conversión.';
}

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (!request || request.type !== 'convert') return;

  void handleConvert(request.payload).catch((error: unknown) => {
    ctx.postMessage({ type: 'error', payload: { message: toUserMessage(error) } });
  });
};

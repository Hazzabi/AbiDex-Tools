import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  RotateCcw,
  UploadCloud,
  X,
} from 'lucide-react';

import type {
  ConversionProgress,
  ConversionResult,
  ConversionStage,
  WorkerResponse,
} from './types';

/** Límite defensivo: por encima de esto la pestaña puede quedarse sin memoria. */
const MAX_FILE_BYTES = 150 * 1024 * 1024;

const STAGE_LABELS: Record<ConversionStage, string> = {
  loading: 'Leyendo el PDF…',
  extracting: 'Extrayendo texto…',
  packaging: 'Generando el EPUB…',
  done: 'Finalizando…',
};

const LANGUAGES = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'Inglés' },
  { value: 'pt', label: 'Portugués' },
  { value: 'fr', label: 'Francés' },
  { value: 'de', label: 'Alemán' },
  { value: 'it', label: 'Italiano' },
  { value: 'ca', label: 'Catalán' },
] as const;

type Status = 'idle' | 'converting' | 'done' | 'error';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function titleFromFileName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^.]+$/, '');
  const cleaned = withoutExtension.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || 'Documento sin título';
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

/**
 * Filtra mensajes ajenos al contrato de la herramienta. En modo fallback
 * pdf.js puede emitir mensajes de su propio protocolo por el canal del worker.
 */
function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { type?: unknown; payload?: unknown };
  if (candidate.type !== 'progress' && candidate.type !== 'done' && candidate.type !== 'error') {
    return false;
  }
  return typeof candidate.payload === 'object' && candidate.payload !== null;
}

interface StepHeaderProps {
  id: string;
  step: string;
  title: string;
  hint?: string;
}

function StepHeader({ id, step, title, hint }: StepHeaderProps) {
  return (
    <div className="mb-4 flex items-baseline gap-3">
      <span className="font-mono text-xs font-semibold tracking-widest text-crimson">{step}</span>
      <div>
        <h3 id={id} className="text-base font-semibold text-navy">
          {title}
        </h3>
        {hint ? <p className="mt-0.5 text-sm text-ink-muted">{hint}</p> : null}
      </div>
    </div>
  );
}

export function PdfToEpubView() {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [language, setLanguage] = useState('es');
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState<ConversionProgress | null>(null);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const releaseDownload = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const terminateWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  // Limpieza obligatoria: sin workers ni ObjectURL huérfanos (GUIDELINES.md §R2).
  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    },
    [],
  );

  const acceptFile = useCallback(
    (candidate: File) => {
      if (!isPdfFile(candidate)) {
        setError('El archivo debe ser un PDF (.pdf).');
        setStatus('error');
        return;
      }
      if (candidate.size === 0) {
        setError('El archivo está vacío.');
        setStatus('error');
        return;
      }
      if (candidate.size > MAX_FILE_BYTES) {
        setError(`El PDF supera el límite de ${formatBytes(MAX_FILE_BYTES)}.`);
        setStatus('error');
        return;
      }

      terminateWorker();
      releaseDownload();
      setResult(null);
      setProgress(null);
      setError(null);
      setStatus('idle');
      setFile(candidate);
      setTitle(titleFromFileName(candidate.name));
    },
    [releaseDownload, terminateWorker],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      const dropped = event.dataTransfer.files?.[0];
      if (dropped) acceptFile(dropped);
    },
    [acceptFile],
  );

  const handleConvert = useCallback(async () => {
    if (!file || status === 'converting') return;

    const cleanTitle = title.trim() || 'Documento sin título';

    terminateWorker();
    releaseDownload();
    setResult(null);
    setError(null);
    setStatus('converting');
    setProgress({ current: 0, total: 1, percentage: 0, stage: 'loading' });

    let buffer: ArrayBuffer;
    try {
      buffer = await file.arrayBuffer();
    } catch {
      setError('No se ha podido leer el archivo desde el disco.');
      setStatus('error');
      setProgress(null);
      return;
    }

    const worker = new Worker(new URL('./pdf-to-epub.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<unknown>) => {
      if (!isWorkerResponse(event.data)) return;
      const message = event.data;

      if (message.type === 'progress') {
        setProgress(message.payload);
        return;
      }

      if (message.type === 'done') {
        const url = URL.createObjectURL(message.payload.blob);
        objectUrlRef.current = url;
        setResult(message.payload);
        setStatus('done');
        setProgress(null);
        terminateWorker();
        return;
      }

      setError(message.payload.message);
      setStatus('error');
      setProgress(null);
      terminateWorker();
    };

    worker.onerror = () => {
      setError('El proceso de conversión se ha interrumpido de forma inesperada.');
      setStatus('error');
      setProgress(null);
      terminateWorker();
    };

    // El ArrayBuffer se transfiere (no se clona) para no duplicar memoria.
    worker.postMessage(
      {
        type: 'convert',
        payload: {
          buffer,
          title: cleanTitle,
          author: author.trim() || undefined,
          language,
        },
      },
      [buffer],
    );
  }, [author, file, language, releaseDownload, status, terminateWorker, title]);

  const handleCancel = useCallback(() => {
    terminateWorker();
    setProgress(null);
    setStatus('idle');
  }, [terminateWorker]);

  const handleDownload = useCallback(() => {
    if (!result || !objectUrlRef.current) return;
    const link = document.createElement('a');
    link.href = objectUrlRef.current;
    link.download = `${slugify(title) || 'documento'}.epub`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, [result, title]);

  const handleReset = useCallback(() => {
    terminateWorker();
    releaseDownload();
    setFile(null);
    setTitle('');
    setAuthor('');
    setLanguage('es');
    setProgress(null);
    setResult(null);
    setError(null);
    setStatus('idle');
    if (inputRef.current) inputRef.current.value = '';
  }, [releaseDownload, terminateWorker]);

  const isConverting = status === 'converting';
  const percentage = progress?.percentage ?? 0;
  const stageLabel = progress ? STAGE_LABELS[progress.stage] : 'Preparando…';

  const stats = useMemo(() => {
    if (!result) return [];
    return [
      { label: 'Páginas', value: result.pages.toLocaleString('es') },
      { label: 'Capítulos', value: result.chapters.toLocaleString('es') },
      { label: 'Encabezados', value: result.headings.toLocaleString('es') },
      { label: 'Párrafos', value: result.paragraphs.toLocaleString('es') },
      { label: 'Listas', value: result.lists.toLocaleString('es') },
      { label: 'Palabras', value: result.words.toLocaleString('es') },
      { label: 'Imágenes', value: result.images.toLocaleString('es') },
      { label: 'Portada', value: result.cover ? 'Generada' : '—' },
    ];
  }, [result]);

  return (
    <div className="pdf-to-epub-tool animate-fade space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-navy text-white">
            <FileText className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-xl font-semibold text-navy">PDF a EPUB</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-soft">
              Convierte un PDF basado en texto en un EPUB 3 reflowable que conserva su estructura:
              títulos y subtítulos, párrafos, listas y saltos de página, con imágenes incrustadas y
              portada generada desde la primera hoja.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-8 rounded-3xl border border-line bg-paper p-6 shadow-card sm:p-8">
        {/* 01 · Archivo */}
        <section aria-labelledby="pdf-epub-file-heading">
          <StepHeader
            id="pdf-epub-file-heading"
            step="01"
            title="Selecciona el PDF"
            hint="Arrastra el archivo, pégalo o búscalo en tu equipo."
          />

          <input
            ref={inputRef}
            id="pdf-epub-file"
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            disabled={isConverting}
            onChange={(event) => {
              const selected = event.target.files?.[0];
              if (selected) acceptFile(selected);
            }}
          />

          {file ? (
            <div className="flex items-center gap-4 rounded-2xl border border-line bg-white p-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-navy/5 text-navy">
                <FileText className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-navy" title={file.name}>
                  {file.name}
                </p>
                <p className="text-xs text-ink-muted">{formatBytes(file.size)}</p>
              </div>
              <button
                type="button"
                onClick={handleReset}
                disabled={isConverting}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink-soft transition hover:border-crimson hover:text-crimson disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Quitar el archivo seleccionado"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div
              role="button"
              tabIndex={isConverting ? -1 : 0}
              aria-label="Seleccionar un archivo PDF"
              aria-disabled={isConverting}
              onClick={() => {
                if (!isConverting) inputRef.current?.click();
              }}
              onKeyDown={(event) => {
                if (isConverting) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  inputRef.current?.click();
                }
              }}
              onDragEnter={(event) => {
                event.preventDefault();
                if (!isConverting) setIsDragging(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                if (!isConverting) {
                  event.dataTransfer.dropEffect = 'copy';
                  setIsDragging(true);
                }
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setIsDragging(false);
              }}
              onDrop={handleDrop}
              className={[
                'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors',
                isDragging
                  ? 'border-crimson bg-crimson/5'
                  : 'border-line-strong bg-white hover:border-navy',
                isConverting ? 'pointer-events-none opacity-50' : '',
              ].join(' ')}
            >
              <span
                className={[
                  'flex h-14 w-14 items-center justify-center rounded-2xl transition-colors',
                  isDragging ? 'bg-crimson text-white' : 'bg-navy/5 text-navy',
                ].join(' ')}
              >
                <UploadCloud className="h-6 w-6" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-semibold text-navy">
                  {isDragging ? 'Suelta el PDF aquí' : 'Arrastra tu PDF aquí'}
                </p>
                <p className="mt-1 text-sm text-ink-muted">
                  o <span className="font-medium text-crimson underline underline-offset-2">búscalo en tu equipo</span>
                </p>
              </div>
              <p className="text-xs text-ink-muted">
                Solo PDF · máx. {formatBytes(MAX_FILE_BYTES)}
              </p>
            </div>
          )}
        </section>

        {/* 02 · Metadatos */}
        <section aria-labelledby="pdf-epub-metadata-heading" className="border-t border-line pt-8">
          <StepHeader
            id="pdf-epub-metadata-heading"
            step="02"
            title="Metadatos del libro"
            hint="Se escribirán en el OPF del EPUB."
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="pdf-epub-title" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Título
              </label>
              <input
                id="pdf-epub-title"
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                disabled={isConverting}
                maxLength={300}
                placeholder="Título del libro"
                className="w-full rounded-xl border border-line-strong bg-white px-4 py-2.5 text-sm text-ink placeholder:text-ink-muted focus:border-navy disabled:cursor-not-allowed disabled:bg-line/40"
              />
            </div>

            <div>
              <label htmlFor="pdf-epub-author" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Autor <span className="font-normal normal-case text-ink-muted">(opcional)</span>
              </label>
              <input
                id="pdf-epub-author"
                type="text"
                value={author}
                onChange={(event) => setAuthor(event.target.value)}
                disabled={isConverting}
                maxLength={200}
                placeholder="Nombre y apellidos"
                className="w-full rounded-xl border border-line-strong bg-white px-4 py-2.5 text-sm text-ink placeholder:text-ink-muted focus:border-navy disabled:cursor-not-allowed disabled:bg-line/40"
              />
            </div>

            <div>
              <label htmlFor="pdf-epub-language" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Idioma
              </label>
              <select
                id="pdf-epub-language"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                disabled={isConverting}
                className="w-full rounded-xl border border-line-strong bg-white px-4 py-2.5 text-sm text-ink focus:border-navy disabled:cursor-not-allowed disabled:bg-line/40"
              >
                {LANGUAGES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* 03 · Conversión */}
        <section aria-labelledby="pdf-epub-run-heading" className="border-t border-line pt-8">
          <StepHeader
            id="pdf-epub-run-heading"
            step="03"
            title="Convierte y descarga"
            hint="El progreso se actualiza página a página."
          />

          {error ? (
            <div
              role="alert"
              className="mb-4 flex items-start gap-3 rounded-2xl border border-crimson/30 bg-crimson/5 p-4"
            >
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-crimson" aria-hidden="true" />
              <p className="text-sm leading-relaxed text-crimson-deep">{error}</p>
            </div>
          ) : null}

          {isConverting ? (
            <div className="mb-4 space-y-3 rounded-2xl border border-line bg-white p-4">
              <div className="flex items-center justify-between gap-4">
                <p className="flex items-center gap-2 text-sm font-medium text-navy">
                  <Loader2 className="h-4 w-4 animate-spin text-crimson" aria-hidden="true" />
                  {stageLabel}
                </p>
                <p className="font-mono text-sm font-semibold text-navy">{percentage}%</p>
              </div>

              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percentage}
                aria-label="Progreso de la conversión"
                className="h-2.5 w-full overflow-hidden rounded-full bg-line"
              >
                <div
                  className="lt-progress-stripes h-full rounded-full bg-crimson transition-[width] duration-300 ease-out"
                  style={{ width: `${Math.max(percentage, 4)}%` }}
                />
              </div>

              <p className="text-xs text-ink-muted">
                {progress
                  ? `Página ${Math.min(progress.current, progress.total)} de ${progress.total}`
                  : 'Preparando el documento…'}
              </p>
            </div>
          ) : null}

          {result ? (
            <div className="mb-4 rounded-2xl border border-navy/15 bg-navy/5 p-5">
              <p className="flex items-center gap-2 text-sm font-semibold text-navy">
                <CheckCircle2 className="h-5 w-5 text-crimson" aria-hidden="true" />
                EPUB generado correctamente
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {stats.map((stat) => (
                  <div key={stat.label} className="rounded-xl bg-white/80 px-3 py-2">
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                      {stat.label}
                    </dt>
                    <dd className="mt-0.5 font-mono text-sm font-semibold text-navy">
                      {stat.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleConvert}
              disabled={!file || isConverting}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-crimson px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-crimson-deep disabled:cursor-not-allowed disabled:bg-crimson/35"
            >
              {isConverting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <FileText className="h-4 w-4" aria-hidden="true" />
              )}
              {isConverting ? 'Convirtiendo…' : 'Convertir a EPUB'}
            </button>

            {isConverting ? (
              <button
                type="button"
                onClick={handleCancel}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-line-strong bg-white px-5 py-3 text-sm font-semibold text-ink transition-colors hover:border-crimson hover:text-crimson"
              >
                Cancelar
              </button>
            ) : null}

            {result ? (
              <>
                <button
                  type="button"
                  onClick={handleDownload}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-navy px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-navy-soft"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  Descargar EPUB
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-line-strong bg-white px-5 py-3 text-sm font-semibold text-ink transition-colors hover:border-navy"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  Convertir otro archivo
                </button>
              </>
            ) : null}
          </div>

          {!file ? (
            <p className="mt-3 text-xs text-ink-muted">
              Selecciona un PDF para habilitar la conversión.
            </p>
          ) : null}
        </section>
      </div>

      <p className="text-xs leading-relaxed text-ink-muted">
        Los PDFs escaneados no contienen texto editable: esta herramienta no aplica OCR, aunque los
        documentos donde cada página es una imagen guardan esas páginas intactas en el EPUB.
      </p>
    </div>
  );
}

export default PdfToEpubView;

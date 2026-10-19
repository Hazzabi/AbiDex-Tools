import { FileText } from 'lucide-react';

import type { ToolDefinition } from '../../types/tool';
import { PdfToEpubView } from './PdfToEpubView';

/**
 * Herramienta PDF → EPUB.
 * El `default export` es lo que descubre `src/core/registry.ts` (GUIDELINES.md §R4).
 */
export const pdfToEpubTool: ToolDefinition = {
  id: 'pdf-to-epub',
  name: 'PDF a EPUB',
  description:
    'Transforma un PDF de texto en un EPUB 3 reflowable con títulos, párrafos, listas e índice.',
  category: 'documents',
  icon: FileText,
  component: PdfToEpubView,
};

export default pdfToEpubTool;

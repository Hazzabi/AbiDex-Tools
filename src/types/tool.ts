import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * Categorías disponibles en el hub. Añadir una nueva implica actualizar
 * este mapa (y solo este mapa) para que el dashboard la ofrezca.
 */
export const TOOL_CATEGORIES = {
  documents: 'Documentos',
  media: 'Multimedia',
  crypto: 'Criptografía',
  text: 'Texto',
  data: 'Datos',
  utilities: 'Utilidades',
} as const;

export type ToolCategory = keyof typeof TOOL_CATEGORIES;

export const TOOL_CATEGORY_ORDER: readonly ToolCategory[] = [
  'documents',
  'media',
  'text',
  'data',
  'crypto',
  'utilities',
];

/**
 * Contrato público del hub. Ver GUIDELINES.md §R3: los campos obligatorios
 * no se renombran, no se hacen opcionales y no cambian de tipo.
 *
 * Añadir campos opcionales es retrocompatible; modificar los existentes no.
 */
export interface ToolDefinition {
  /** Identificador único y estable, en kebab-case. Ej: 'pdf-to-epub'. */
  id: string;
  /** Nombre legible mostrado en el dashboard. */
  name: string;
  /** Explicación breve, en una frase, de para qué sirve. */
  description: string;
  /** Categoría del hub a la que pertenece. */
  category: ToolCategory;
  /** Icono de lucide-react. */
  icon: LucideIcon;
  /** Componente React que renderiza la vista completa de la herramienta. */
  component: ComponentType;
}

/** Datos derivados que el dashboard usa para agrupar y filtrar. */
export interface ToolCategoryGroup {
  category: ToolCategory;
  label: string;
  tools: readonly ToolDefinition[];
}

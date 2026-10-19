import {
  TOOL_CATEGORIES,
  TOOL_CATEGORY_ORDER,
  type ToolCategory,
  type ToolCategoryGroup,
  type ToolDefinition,
} from '../types/tool';

/**
 * Registro central de herramientas.
 *
 * Cada carpeta bajo `src/tools/` que exporte por defecto un `ToolDefinition`
 * en su `index.ts` se descubre automáticamente. No hay que tocar este archivo
 * para añadir una herramienta nueva (ver GUIDELINES.md §R4).
 */
type ToolModule = { default?: ToolDefinition };

const discovered = import.meta.glob<ToolModule>('../tools/*/index.ts', { eager: true });

function fail(source: string, reason: string): never {
  throw new Error(
    `[registry] Herramienta inválida en ${source}: ${reason}. Revisa GUIDELINES.md §R3.`,
  );
}

function validateTool(candidate: unknown, source: string): ToolDefinition {
  if (!candidate || typeof candidate !== 'object') {
    fail(source, 'el módulo no exporta un ToolDefinition por defecto');
  }

  const tool = candidate as Partial<ToolDefinition>;

  if (typeof tool.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tool.id)) {
    fail(source, "el campo 'id' debe ser un string en kebab-case");
  }
  if (typeof tool.name !== 'string' || tool.name.trim().length === 0) {
    fail(source, "el campo 'name' es obligatorio");
  }
  if (typeof tool.description !== 'string' || tool.description.trim().length === 0) {
    fail(source, "el campo 'description' es obligatorio");
  }
  if (typeof tool.category !== 'string' || !(tool.category in TOOL_CATEGORIES)) {
    fail(source, `el campo 'category' no es una categoría válida (${Object.keys(TOOL_CATEGORIES).join(', ')})`);
  }
  if (tool.icon == null || (typeof tool.icon !== 'function' && typeof tool.icon !== 'object')) {
    fail(source, "el campo 'icon' debe ser un componente de lucide-react");
  }
  if (
    tool.component == null ||
    (typeof tool.component !== 'function' && typeof tool.component !== 'object')
  ) {
    fail(source, "el campo 'component' debe ser un componente React");
  }

  return tool as ToolDefinition;
}

const byId = new Map<string, ToolDefinition>();

for (const [source, module] of Object.entries(discovered)) {
  const tool = validateTool(module.default, source);

  if (byId.has(tool.id)) {
    fail(source, `el id '${tool.id}' ya está registrado por otra herramienta`);
  }

  byId.set(tool.id, tool);
}

/** Lista inmutable de herramientas registradas, ordenada por nombre. */
export const tools: readonly ToolDefinition[] = Object.freeze(
  [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'es')),
);

/** Busca una herramienta por su id. Devuelve `undefined` si no existe. */
export function getToolById(id: string): ToolDefinition | undefined {
  return byId.get(id);
}

/** Categorías que tienen al menos una herramienta, en orden de presentación. */
export function getUsedCategories(): readonly ToolCategory[] {
  const used = new Set(tools.map((tool) => tool.category));
  return TOOL_CATEGORY_ORDER.filter((category) => used.has(category));
}

/** Herramientas agrupadas por categoría para vistas alternativas del dashboard. */
export function getToolsByCategory(): readonly ToolCategoryGroup[] {
  return getUsedCategories().map((category) => ({
    category,
    label: TOOL_CATEGORIES[category],
    tools: tools.filter((tool) => tool.category === category),
  }));
}

/** Búsqueda simple y local sobre nombre, descripción, id y categoría. */
export function searchTools(query: string): readonly ToolDefinition[] {
  const term = query.trim().toLocaleLowerCase('es');
  if (!term) return tools;

  return tools.filter((tool) => {
    const haystack = [tool.name, tool.description, tool.id, TOOL_CATEGORIES[tool.category]]
      .join(' ')
      .toLocaleLowerCase('es');
    return haystack.includes(term);
  });
}

export { TOOL_CATEGORIES };

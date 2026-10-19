import { ArrowLeft } from 'lucide-react';

import { TOOL_CATEGORIES, type ToolDefinition } from '../types/tool';

interface ToolScreenProps {
  tool: ToolDefinition;
}

/** Contenedor común de cualquier herramienta: navegación de vuelta + vista. */
export function ToolScreen({ tool }: ToolScreenProps) {
  const ToolView = tool.component;

  return (
    <div className="animate-rise space-y-8">
      <div className="space-y-4">
        <a
          href="#/"
          className="inline-flex w-fit items-center gap-2 rounded-lg text-sm font-semibold text-ink-soft transition-colors hover:text-crimson"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Todas las herramientas
        </a>

        <nav aria-label="Ruta de navegación" className="flex items-center gap-2 text-xs text-ink-muted">
          <span>{TOOL_CATEGORIES[tool.category]}</span>
          <span aria-hidden="true">/</span>
          <span className="font-semibold text-navy">{tool.name}</span>
        </nav>
      </div>

      <ToolView />
    </div>
  );
}

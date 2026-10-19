import { ArrowUpRight } from 'lucide-react';

import { tools } from '../core/registry';
import { TOOL_CATEGORIES } from '../types/tool';

/**
 * Portada del índice: el título, la firma y los enlaces a las herramientas.
 * Nada de discursos de producto; lo importante está en las fichas.
 */
export function Dashboard() {
  return (
    <div className="animate-rise space-y-12">
      <section className="max-w-2xl space-y-4">
        <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          AbiDex-Tools
        </h1>
        <p className="text-base leading-relaxed text-ink-soft sm:text-lg">
          Herramientas creadas por Hazzabi para la comodidad de su vida.
        </p>
      </section>

      <section aria-label="Herramientas">
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => (
            <li key={tool.id}>
              <a
                href={`#/tools/${tool.id}`}
                className="group flex h-full flex-col rounded-2xl border border-line bg-white p-5 transition-all hover:-translate-y-0.5 hover:border-navy hover:shadow-card-hover"
              >
                <div className="flex items-start justify-between">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-navy/5 text-navy transition-colors group-hover:bg-navy group-hover:text-white">
                    <tool.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <ArrowUpRight
                    className="h-4 w-4 text-ink-muted transition-colors group-hover:text-crimson"
                    aria-hidden="true"
                  />
                </div>
                <h2 className="mt-4 text-base font-semibold text-navy">{tool.name}</h2>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-soft">
                  {tool.description}
                </p>
                <span className="mt-4 inline-flex w-fit items-center rounded-full border border-line px-2.5 py-1 text-[11px] font-semibold text-ink-soft">
                  {TOOL_CATEGORIES[tool.category]}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

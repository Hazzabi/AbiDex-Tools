import { tools } from '../core/registry';

export function AppFooter() {
  return (
    <footer className="border-t border-line bg-white">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-5 py-6 text-xs text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p>AbiDex-Tools · Herramientas de Hazzabi</p>
        <p className="font-mono">
          v0.3.0 · {tools.length} {tools.length === 1 ? 'herramienta' : 'herramientas'}
        </p>
      </div>
    </footer>
  );
}

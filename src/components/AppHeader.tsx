export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/75">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-5 py-3.5 sm:px-8">
        <a
          href="#/"
          className="flex items-center gap-3 rounded-xl py-1 pr-2 transition-opacity hover:opacity-90"
          aria-label="AbiDex-Tools, ir al inicio"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-navy text-sm font-bold text-white">
            A
          </span>
          <span className="text-sm font-bold tracking-tight text-navy">AbiDex-Tools</span>
          <span className="text-[11px] font-medium text-ink-muted">por Hazzabi</span>
        </a>
      </div>
    </header>
  );
}

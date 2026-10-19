import { useEffect, useMemo, useState } from 'react';

import { AppFooter } from './components/AppFooter';
import { AppHeader } from './components/AppHeader';
import { Dashboard } from './components/Dashboard';
import { ToolScreen } from './components/ToolScreen';
import { getToolById } from './core/registry';

/** Rutas soportadas: `#/` (dashboard) y `#/tools/<id>`. */
function parseToolId(hash: string): string | null {
  const match = /^#\/tools\/([a-z0-9-]+)\/?$/.exec(hash);
  return match ? match[1] : null;
}

export default function App() {
  const [toolId, setToolId] = useState(() => parseToolId(window.location.hash));

  useEffect(() => {
    const onHashChange = () => {
      setToolId(parseToolId(window.location.hash));
      window.scrollTo({ top: 0 });
    };

    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const activeTool = useMemo(() => (toolId ? getToolById(toolId) : undefined), [toolId]);

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <button
        type="button"
        className="lt-skip-link"
        onClick={() => document.getElementById('main')?.focus()}
      >
        Saltar al contenido
      </button>

      <AppHeader />

      <main
        id="main"
        className="mx-auto w-full max-w-6xl flex-1 px-5 py-10 sm:px-8 sm:py-14"
        tabIndex={-1}
      >
        {activeTool ? <ToolScreen tool={activeTool} /> : <Dashboard />}
      </main>

      <AppFooter />
    </div>
  );
}

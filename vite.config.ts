import { existsSync, mkdirSync, copyFileSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { defineConfig, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Publica los recursos estáticos de pdf.js (fuentes estándar, CMaps, wasm e
 * ICC) bajo `/assets/pdfjs/`: en build se copian a `dist/` y en dev/preview se
 * sirven desde node_modules con un middleware. Plugin propio para no añadir
 * dependencias con vulnerabilidades conocidas (GUIDELINES.md §R5).
 */
function pdfjsStaticAssets(): Plugin {
  const PREFIX = '/assets/pdfjs/';
  // Origen: node_modules/pdfjs-dist/<dir>/ → destino: assets/pdfjs/<dir>/
  const DIRS = ['standard_fonts', 'cmaps', 'iccs', 'wasm'];

  const resolveAsset = (url: string): { file: string; type: string } | null => {
    // En dev, connect monta el prefijo y entrega `req.url` sin él; en preview
    // llega completo. Se aceptan ambas formas.
    let pathname = decodeURIComponent(url.split('?')[0]);
    if (pathname.startsWith(PREFIX)) pathname = pathname.slice(PREFIX.length);
    const [dir, ...rest] = pathname.split('/').filter(Boolean);
    if (!DIRS.includes(dir) || rest.length !== 1) return null;

    const file = join(process.cwd(), 'node_modules', 'pdfjs-dist', dir, ...rest);
    if (!file.startsWith(join(process.cwd(), 'node_modules', 'pdfjs-dist')) || !existsSync(file)) {
      return null;
    }
    const extension = rest[0].split('.').pop()?.toLowerCase() ?? '';
    const type =
      extension === 'wasm'
        ? 'application/wasm'
        : extension === 'js'
          ? 'text/javascript'
          : 'application/octet-stream';
    return { file, type };
  };

  const serve = (middlewares: Connect.Server): void => {
    middlewares.use(PREFIX, (req, res, next) => {
      const request = req as { url?: string };
      const response = res as {
        setHeader(name: string, value: string): void;
        end(data: Buffer): void;
      };

      const found = resolveAsset(request.url ?? '');
      if (!found) {
        next();
        return;
      }
      try {
        response.setHeader('Content-Type', found.type);
        response.end(readFileSync(found.file));
      } catch {
        next();
      }
    });
  };

  return {
    name: 'abidex-pdfjs-static-assets',
    configureServer(server) {
      serve(server.middlewares);
    },
    configurePreviewServer(server) {
      serve(server.middlewares);
    },
    closeBundle() {
      const outDir = join(process.cwd(), 'dist', 'assets', 'pdfjs');
      for (const dir of DIRS) {
        const source = join(process.cwd(), 'node_modules', 'pdfjs-dist', dir);
        const target = join(outDir, dir);
        if (!existsSync(source)) continue;
        mkdirSync(target, { recursive: true });
        for (const name of readdirSync(source)) {
          copyFileSync(join(source, name), join(target, posix.basename(name)));
        }
      }
    },
  };
}

// AbiDex-Tools es una SPA 100 % estática: no hay backend ni variables de entorno.
export default defineConfig({
  plugins: [react(), tailwindcss(), pdfjsStaticAssets()],
  // Los workers de las herramientas se empaquetan como módulos ES.
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    // pdfjs-dist y jszip viven en el chunk del worker, no en el bundle inicial.
    chunkSizeWarningLimit: 1200,
  },
});

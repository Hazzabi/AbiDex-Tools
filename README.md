# AbiDex-Tools

Herramientas creadas por **Hazzabi** para la comodidad de su vida. 🧰

Nada de servidores, nada de cuentas, nada de "sube tu archivo y reza". Todo lo que haces aquí ocurre directamente en tu navegador: arrastras un archivo, le das a un botón y te bajas el resultado. Fin.

---

## 🚀 Demo en Vercel

> **Enlace:** `https://abidex-tools.vercel.app/` — *(pendiente de confirmar tras el primer despliegue; este hueco queda reservado para la URL que genere Vercel)*

---

## ¿Qué hay dentro?

De momento una sola herramienta, pero es de las buenas:

### 📕 PDF → EPUB

Convierte un PDF basado en texto en un libro electrónico **EPUB 3** de verdad (no un ZIP de páginas sueltas):

- **Capítulos de verdad.** Detecta los encabezados del documento por tamaño tipográfico y separa capítulos ahí, no uno por página. El índice se lee como un libro, no como un contador.
- **Imágenes.** Las imágenes incrustadas en el PDF (fotos, ilustraciones, grises) salen en el EPUB donde tocan, con su `<figure>` y todo.
- **Portada.** La primera hoja del PDF se renderiza directa como portada del EPUB.
- **Reflow propio.** Une palabras partidas por guion, recompone párrafos, elimina cabeceras/pies/números de página repetidos y respeta acentos.
- **Salida estándar.** EPUB 3 con `mimetype` primero y sin comprimir, OPF, NAV + NCX, XHTML válido… listo para tu e-reader o para Kindle.

**Limitación honesta:** no hace OCR. Si el PDF es un escaneo, no hay texto editable que reconstruir (aunque las hojas-que-son-imágenes sí se conservan).

---

## ¿Cómo está hecho?

Arquitectura de plugins con un registro central: cada herramienta vive en su carpeta bajo `src/tools/` y se autoregistra, así que añadir una nueva es copiar una carpeta y escribir un `index.ts`. Cero toques al núcleo.

- **Vite 7 + React 19 + TypeScript** con Tailwind CSS 4 (tokens en CSS, sin config de mil líneas).
- **Trabajo pesado en Web Workers**: pdf.js y la conversión corren fuera del hilo principal, la UI nunca se congela.
- **Montserrat empaquetada en local** y favicons SVG: una vez cargada la app, no hace falta conexión.
- **Seguridad por defecto**: `isEvalSupported: false`, XML escapado, límites de tamaño, workers que se terminan al cancelar/cerrar.

Más detalles técnicos (reglas del proyecto, validación de estándares, cómo añadir herramientas) en [`GUIDELINES.md`](./GUIDELINES.md) y el histórico en [`CHANGELOG.md`](./CHANGELOG.md).

---

## Ponerla en marcha

```bash
npm install
npm run dev        # desarrollo
npm run build      # build de producción → dist/
npm run preview    # probar el build
```

Requisitos: Node.js ≥ 22.13 (lo exige `pdfjs-dist` 6) y npm ≥ 10. No hace falta configurar nada: es una SPA estática.

---

## Publicarla en Vercel

1. Sube este repo a GitHub (ya está).
2. Importa el repo en [Vercel](https://vercel.com/import) → framework **Vite**, build `npm run build`, sin variables de entorno.
3. Copia la URL del despliegue y pégala en el apartado **Demo en Vercel** de arriba. ✅

---

## Roadmap

Más herramientas a medida que hagan falta, cada una en su carpeta y sin romper nada:

- [x] PDF → EPUB
- [ ] (la próxima que toque Hazzabi)

---

# Documentación técnica

## Estado del proyecto

| Versión | Estado | Herramientas |
| --- | --- | --- |
| `0.2.0` | Beta | PDF → EPUB (capítulos por encabezados, imágenes y portada) |
| `0.1.0` | Beta inicial (reemplazada) | PDF → EPUB básico |

## Filosofía

1. **Cero backend.** No existe una API propia ni un servidor de conversión. El build es un conjunto de archivos estáticos.
2. **Cero telemetría.** No se envía analítica, ni eventos, ni identificadores. No hay cookies ni almacenamiento remoto.
3. **Privacidad total.** Los documentos se leen con `File.arrayBuffer()` y se procesan en memoria del navegador.
4. **Offline primero.** Fuentes, iconos, estilos, librerías y los recursos internos de pdf.js se empaquetan con la aplicación. Una vez cargada, no necesita red.
5. **Modularidad real.** Cada herramienta vive en su propia carpeta bajo `src/tools/` y se registra automáticamente. El núcleo no conoce los detalles de ninguna herramienta.

## Arquitectura

```
┌──────────────────────────────────────────────────────────────┐
│                         Navegador                            │
│                                                              │
│  React SPA (hilo principal)                                  │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐  │
│  │  Dashboard   │──▶│  Registry    │──▶│  ToolDefinition  │  │
│  │  fichas      │   │  auto-glob   │   │  icon/component  │  │
│  └──────────────┘   └──────────────┘   └──────────────────┘  │
│                                              │               │
│                                              ▼               │
│                                    ┌──────────────────┐      │
│                                    │ PdfToEpubView    │      │
│                                    │ drag & drop      │      │
│                                    └────────┬─────────┘      │
│                                             │ postMessage    │
│                                             ▼                │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Web Worker dedicado                                    │  │
│  │  pdfjs-dist → texto + imágenes por página              │  │
│  │               → heurísticas de reflow y capitulación   │  │
│  │               → portada (OffscreenCanvas)               │  │
│  │  jszip     → EPUB 3 (mimetype, OPF, NAV, NCX, XHTML)   │  │
│  └────────────────────────────────────────────────────────┘  │
│                                             │ Blob           │
│                                             ▼                │
│                                    URL.createObjectURL       │
└──────────────────────────────────────────────────────────────┘
```

### Capas

| Carpeta | Responsabilidad |
| --- | --- |
| `src/core/` | Registro central y utilidades del hub. No importa dependencias de herramientas. |
| `src/types/` | Contratos compartidos, incluido `ToolDefinition`. |
| `src/components/` | Shell de la aplicación, portada del índice y piezas de UI compartidas. |
| `src/tools/<id>/` | Código, worker, tipos y estilos de una herramienta. Aislada del resto. |

El registro usa `import.meta.glob('../tools/*/index.ts')`: **añadir una carpeta con un `index.ts` que exporte por defecto un `ToolDefinition` basta para que aparezca en el dashboard**. No hay que tocar el núcleo.

## Stack

- **Vite 7** + **React 19** + **TypeScript 5.9**
- **Tailwind CSS 4** con tokens de diseño en `src/index.css` (`@theme`)
- **Montserrat Variable** empaquetada localmente con `@fontsource-variable/montserrat` (sin Google Fonts)
- **lucide-react** para iconografía
- **pdfjs-dist 6** para texto, imágenes y render de portada (con fuentes estándar, CMaps, wasm e ICC empaquetados en `assets/pdfjs/` por un plugin propio de Vite)
- **jszip** para construir el contenedor EPUB
- **Web Workers** nativos con `type: "module"` (y worker anidado de pdf.js vía `workerPort`)

## Catálogo: PDF → EPUB

**Cómo funciona**

- Extrae texto página a página con `pdfjs-dist` dentro de un worker.
- Agrupa fragmentos en líneas y detecta tamaño de fuente dominante.
- Reflow: une líneas cortadas, respeta guiones de partición y separa párrafos por espaciado, sangría y líneas cortas.
- Detecta encabezados por escala tipográfica y genera `h1`, `h2`, `h3`.
- Los capítulos se delimitan por los **encabezados del primer nivel usado** en el documento (no página a página); si no hay encabezados, se trocea por presupuesto de palabras al cambiar de página.
- Elimina encabezados, pies y números de página repetidos.
- Extrae las **imágenes incrustadas** de cada página (JPEG `DCTDecode`, RGB, escala de grises 1 bpp, XObjects en línea) y las incrusta en el flujo del capítulo de su página: RGB/JPEG → JPEG (85 %), 1 bpp/RGBA → PNG.
- Renderiza la **primera hoja del PDF como portada** (`cover.xhtml` + `cover-image` en el manifest) con la escala de pdf.js.
- Genera la tabla de contenidos NAV + NCX con los títulos de capítulo reales.
- Construye el ZIP respetando el orden y la compresión del estándar EPUB 3.

**Qué no hace (limitaciones honestas)**

- **No aplica OCR.** Un PDF escaneado no conserva el texto editable; si el PDF solo contiene imágenes, la herramienta reúne esas páginas en un capítulo único con su portada.
- No conserva tablas complejas como tablas de datos (una captura de la página sí queda como imagen), ni columnas múltiples, ni fórmulas.
- Las máscaras de imagen de 1 bit (`paintImageMaskXObject`, transparencias) no se exportan; sí se exportan las XObjects de imagen normales.
- No replica el diseño visual original: el EPUB es texto reflowable.
- No abre PDFs protegidos con contraseña ni con DRM.
- La heurística de párrafos y títulos es aproximada; revisa el resultado en tu lector.

## Privacidad y seguridad

- No hay `fetch`, `XMLHttpRequest`, WebSocket ni balizas hacia dominios externos.
- La fuente Montserrat se sirve desde el propio bundle; no se contacta con Google Fonts.
- `pdfjs-dist` se configura con su worker **local** (`?url` de Vite) y sin CDN.
- Los PDFs se tratan como datos no confiables: `isEvalSupported: false`, sin inyección de HTML y escapado XML de todo el texto extraído.
- Los `ObjectURL` se revocan al reemplazar el resultado o desmontar la vista.
- El worker se termina al cancelar o desmontar para liberar memoria.

### CSP recomendada en producción

```text
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self';
worker-src 'self' blob:;
connect-src 'self';
object-src 'none';
base-uri 'self';
form-action 'none';
```

## Estructura del repositorio

```text
.
├── README.md
├── CHANGELOG.md
├── GUIDELINES.md          # Reglas obligatorias antes de modificar código
├── index.html
├── package.json
├── vite.config.ts         # Incluye el plugin que publica los assets de pdf.js
├── tsconfig*.json
└── src
    ├── main.tsx
    ├── App.tsx
    ├── index.css          # Tailwind + tokens de diseño + Montserrat
    ├── components
    │   ├── AppHeader.tsx
    │   ├── AppFooter.tsx
    │   └── Dashboard.tsx
    ├── core
    │   └── registry.ts
    ├── types
    │   └── tool.ts
    └── tools
        └── pdf-to-epub
            ├── index.ts                  # ToolDefinition
            ├── PdfToEpubView.tsx         # UI de la herramienta
            ├── pdf-to-epub.worker.ts     # Conversión pesada
            └── types.ts                  # Contrato worker ↔ UI
```

## Añadir una herramienta

1. Crea `src/tools/mi-herramienta/index.ts`.
2. Exporta por defecto un objeto que cumpla `ToolDefinition`:

```ts
import { Wrench } from 'lucide-react';
import type { ToolDefinition } from '../../types/tool';
import { MiHerramientaView } from './MiHerramientaView';

const tool: ToolDefinition = {
  id: 'mi-herramienta',
  name: 'Mi herramienta',
  description: 'Qué resuelve, en una frase.',
  category: 'utilities',
  icon: Wrench,
  component: MiHerramientaView,
};

export default tool;
```

3. Mantén cualquier dependencia pesada o específica dentro de la carpeta de la herramienta.
4. Si hay procesamiento pesado, usa un worker dentro de esa carpeta.
5. Actualiza `README.md` (catálogo) y `CHANGELOG.md`.
6. Ejecuta `npm run typecheck && npm run build`.

El dashboard se actualiza solo.

## Validación EPUB

Para comprobar el estándar en local, exporta un EPUB y ejecuta [EPUBCheck](https://github.com/w3c/epubcheck):

```bash
epubcheck mi-libro.epub
```

La app no incluye EPUBCheck (requiere Java) para mantener el build ligero y sin binarios.

## Contribuir

Antes de cualquier cambio, lee **[GUIDELINES.md](./GUIDELINES.md)**. Las reglas de privacidad, aislamiento por herramienta y validación EPUB 3 son inmutables.

Los cambios relevantes se registran en **[CHANGELOG.md](./CHANGELOG.md)** siguiendo *Keep a Changelog* y versionado semántico.

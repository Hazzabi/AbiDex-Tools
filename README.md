# AbiDex-Tools

Herramientas creadas por **Hazzabi** para la comodidad de su vida. 🧰

---

## 🚀 Demo en Vercel

> **Enlace:** `https://abi-dex-tools.vercel.app/`

---

## ¿Qué hay dentro?

De momento una sola herramienta, pero es de las buenas:

### 📕 PDF → EPUB

Convierte un PDF basado en texto en un libro electrónico **EPUB 3** de verdad (no un ZIP de páginas sueltas):

- **Capítulos de verdad.** Detecta los encabezados del documento por tamaño tipográfico y por el peso real de la fuente (una negrita que no cambia de tamaño también es un subtítulo) y separa capítulos ahí, no uno por página. El índice se lee como un libro, no como un contador.
- **Estructura respetada.** Títulos, subtítulos, párrafos y listas (con viñeta o numeradas) llegan al EPUB como `<h1>/<h2>/<h3>`, `<p>`, `<ul>` y `<ol>`, no como un chorizo de texto.
- **Saltos de página visibles.** El EPUB marca dónde terminaba cada hoja del PDF (`epub:type="pagebreak"`), para que te sitúes igual que en el original.
- **Dos columnas, en orden.** Los PDFs maquetados a columnas se reordenan con cortes recursivos, así se leen columna a columna en vez de intercalar líneas.
- **Imágenes.** Las imágenes incrustadas en el PDF (fotos, ilustraciones, grises) salen en el EPUB donde tocan, con su `<figure>` y todo.
- **Portada.** La primera hoja del PDF se renderiza directa como portada del EPUB.
- **Reflow propio.** Une palabras partidas por guion, recompone párrafos por interlineado y sangría, elimina cabeceras/pies/números de página repetidos y respeta acentos.
- **Salida estándar.** EPUB 3 con `mimetype` primero y sin comprimir, OPF, NAV + NCX, XHTML válido… listo para tu e-reader o para Kindle.

**Limitaciones honestas:** no hace OCR (si el PDF es un escaneo no hay texto editable que reconstruir, aunque las hojas-que-son-imágenes sí se conservan) y las listas con guion (`-`, `–`, `—`) se mantienen como texto, porque en castellano el guion largo abre los diálogos.

---

## ¿Cómo está hecho?

Arquitectura de plugins con un registro central: cada herramienta vive en su carpeta bajo `src/tools/` y se autoregistra, así que añadir una nueva es copiar una carpeta y escribir un `index.ts`. Cero toques al núcleo.

- **Vite 7 + React 19 + TypeScript** con Tailwind CSS 4 (tokens en CSS, sin config de mil líneas).
- **Trabajo pesado en Web Workers**: pdf.js y la conversión corren fuera del hilo principal, la UI nunca se congela.
- **Montserrat empaquetada en local** y favicons SVG: una vez cargada la app, no hace falta conexión.
- **Seguridad por defecto**: `isEvalSupported: false`, XML escapado, límites de tamaño, workers que se terminan al cancelar/cerrar.

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

Importa el repo en [Vercel](https://vercel.com/import) → framework **Vite**, build `npm run build`, sin variables de entorno. El despliegue queda publicado en el enlace de arriba. ✅

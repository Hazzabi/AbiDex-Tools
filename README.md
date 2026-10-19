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


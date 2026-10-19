# Changelog

Todos los cambios relevantes de este proyecto se documentan en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el proyecto sigue [Versionado Semántico](https://semver.org/lang/es/).

## [0.3.0] - 2026-10-19

Tercera versión: la conversión ya no aplana el texto. El EPUB conserva la jerarquía real del
documento (títulos, subtítulos, párrafos y listas) y los saltos de página.

### Added

- **Análisis tipográfico real**: además del tamaño de fuente se lee el estilo verdadero de cada
  fuente (`bold`/`black` de pdf.js en `commonObjs`) para reconocer titulares que no cambian de
  tamaño. Las fuentes se esperan con timeout y se cachean, de modo que la primera página no pierde
  la negrita mientras pdf.js todavía las envía.
- **Escalera de tamaños adaptativa**: los tamaños distintos presentes en el documento se ordenan de
  mayor a menor y se mapean a `h1`, `h2`, `h3`… Un documento con 18/14/12 pt produce tres niveles
  reales en lugar de aproximaciones por proporción fija.
- **Párrafos por interlineado**: el interlineado base se calcula como el hueco entre líneas **más
  frecuente** (moda) y se corta párrafo cuando una línea se separa claramente de él. Se suman dos
  señales más: primera línea con sangría y, en texto justificado, renglón corto de cierre.
- **Listas**: se detectan viñetas (`•`, `·`, `▪`, `■`, `◆`, `‣`…) y numeraciones (`1.`, `2)`, `a)`,
  `iv.`) y se generan `<ul>`/`<ol>` reales, uniendo los renglones de continuación por su sangría
  colgante y descartando falsos positivos como fechas al inicio de frase.
- **Saltos de página**: cada hoja cerrada deja un marcador `<div class="page-break"
  epub:type="pagebreak" role="doc-pagebreak" id="page-N">` con su número, para que se vea dónde
  terminaba cada página del PDF original.
- **Orden de lectura por XY-cut**: se reordena cada página con cortes recursivos horizontales
  (secciones) y verticales (columnas), así los PDFs a dos columnas se leen columna a columna en
  lugar de línea a línea intercalada. Un grupo nuevo (columna o sección) nunca continúa el párrafo
  del anterior.
- **Nuevas estadísticas**: párrafos y listas generadas, junto a las ya existentes.

### Changed

- Las líneas de una misma fila separadas por un hueco horizontal grande (otra columna o celda) ya no
  se fusionan: cada una es un segmento con su posición real.
- El CSS del EPUB incorpora estilos para listas y para el separador de salto de página, y evita la
  sangría de primera línea tras un título, una lista o una figura.

### Fixed

- Las líneas de continuación de una lista (sangría colgante) ya no se interpretan como un párrafo
  nuevo.
- Un titular partido en dos renglones ya no abre dos capítulos: se une al encabezado anterior.

### Known limitations

- Las listas con guion (`-`, `–`, `—`) no se consideran listas, porque en castellano el guion largo
  abre los diálogos; se mantienen como texto.

---

## [0.2.0] - 2026-10-19

Segunda versión: el EPUB por fin se lee como un libro y el proyecto pasa a llamarse AbiDex-Tools.

### Added

- **Capitulación semántica**: los capítulos ahora se delimitan por los encabezados del primer nivel tipográfico detectado en el documento (h1, o h2/h3 si no hay superiores) en lugar de uno por página.
  - El texto anterior al primer encabezado (portadas de texto, prólogos) forma su propio capítulo inicial.
  - Los encabezados huérfanos (un título seguido inmediatamente de otro) se fusionan con el capítulo siguiente sin perder texto.
  - Sin encabezados detectables, el texto se trocea en secciones por presupuesto de palabras (~900) al cambiar de página.
- **Imágenes incrustadas**: se extraen los XObjects de imagen de cada página desde la lista de operadores de pdf.js (`paintImageXObject`, `paintImageXObjectRepeat`, `paintInlineImageXObject`) y se incrustan en el capítulo de su página con `<figure>` y `alt`.
  - JPEG decodificado y RGB 24 bpp → JPEG (calidad 85 %); escala de grises 1 bpp y RGBA → PNG sin pérdida.
  - Codificación con `OffscreenCanvas` dentro del worker; límite defensivo de 250 imágenes.
- **Portada**: la primera hoja del PDF se renderiza con la escala de pdf.js a JPEG y se inserteda como `cover.xhtml` (primer elemento del spine), con `properties="cover-image"` en el manifest y la marca `epub:type="cover"` en landmarks.
- Recursos internos de pdf.js (fuentes estándar, CMaps, wasm de JPX/JBIG2, ICC) copiados a `assets/pdfjs` por un plugin propio de Vite, para que la portada se renderice con fidelidad sin recursos remotos.
- Estadísticas nuevas en la ficha de resultado: imágenes incrustadas y estado de la portada.

### Changed

- **Identidad**: el proyecto pasa de "LocalToolbox" a **AbiDex-Tools** (paquete npm `abidex-tools`, favicon, título y metadatos).
- **Portada del índice**: se retiran los discursos de producto (privacidad, telemetría) y la búsqueda; ahora solo muestra el título, la descripción "Herramientas creadas por Hazzabi para la comodidad de su vida." y las fichas de herramientas.
- Encabezado y pie simplificados: marca "AbiDex-Tools · por Hazzabi" sin proclamaciones.
- Textos de la herramienta neutralizados (sin menciones a backend/telemetría en la interfaz).

### Fixed

- El número de páginas ya no genera capítulos fantasmas ni índices interminables.

---

## [0.1.0] - 2026-10-19

Primera versión funcional de LocalToolbox y de la herramienta PDF → EPUB.

### Added

- Documentación base del repositorio:
  - `README.md` con filosofía, arquitectura, inicio rápido, catálogo y limitaciones.
  - `CHANGELOG.md` con el histórico de versiones.
  - `GUIDELINES.md` con las reglas inmutables del proyecto.
- Sistema de diseño con Tailwind CSS 4:
  - Fondo blanco puro, azul marino (`#0F172A` / `#1E293B`), rojo (`#DC2626` / `#E11D48`) y carbón (`#09090B`).
  - Tipografía Montserrat Variable empaquetada localmente, sin llamadas a Google Fonts.
  - Tokens de color, foco accesible y animaciones respetuosas con `prefers-reduced-motion`.
- Arquitectura Plugin/Registry:
  - Contrato `ToolDefinition` en `src/types/tool.ts`.
  - Registro central con autodescubrimiento en `src/core/registry.ts`.
  - Validación de IDs duplicados y campos obligatorios al iniciar.
- Shell SPA:
  - Header minimalista con indicador de privacidad.
  - Dashboard con buscador, filtro por categorías y tarjetas de herramientas.
  - Navegación por hash compatible con el botón atrás del navegador.
  - Estado vacío para búsquedas sin resultados.
- Herramienta **PDF → EPUB**:
  - Zona de Drag & Drop y selector de archivo con validación de tipo y tamaño.
  - Formulario de metadatos (título, autor, idioma) con valores derivados del archivo.
  - Conversión en Web Worker dedicado con `pdfjs-dist` 6 y `jszip`.
  - Extracción de texto página a página y envío de progreso reactivo al hilo principal.
  - Reflow de líneas, unión de palabras cortadas por guion y detección de párrafos.
  - Detección de encabezados por escala tipográfica (`h1`, `h2`, `h3`).
  - Eliminación heurística de encabezados, pies y números de página repetidos.
  - Generación de EPUB 3:
    - `mimetype` como primer archivo y sin compresión (`STORE`).
    - `META-INF/container.xml`.
    - `OEBPS/content.opf` con metadatos Dublin Core, manifiesto y spine.
    - `OEBPS/nav.xhtml` y `OEBPS/toc.ncx`.
    - `OEBPS/style.css` con tipografía fluida.
    - Un `chapter_*.xhtml` válido por página.
  - Barra de progreso accesible, estados de éxito/error y descarga mediante `URL.createObjectURL`.
  - Cancelación de la conversión y limpieza de workers y ObjectURLs.

### Security

- Procesamiento exclusivamente local; sin backend, sin telemetría y sin CDNs.
- `pdfjs-dist` configurado con su worker local y `isEvalSupported: false`.
- Todo el texto extraído se escapa antes de insertarse en XHTML.
- Validación de tamaño máximo de archivo y de firma/tipo PDF.

### Known limitations

- Sin OCR: los PDFs escaneados no producen texto.
- No se conservan imágenes, tablas complejas, columnas ni maquetación original.
- Los PDFs cifrados o con DRM no son compatibles.
- La detección de títulos y párrafos es heurística y puede requerir revisión manual.

---

<!--
Plantilla para próximas versiones:

## [X.Y.Z] - AAAA-MM-DD

### Added
### Changed
### Deprecated
### Removed
### Fixed
### Security
-->

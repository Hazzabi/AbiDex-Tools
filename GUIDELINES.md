# GUIDELINES — Reglas del proyecto AbiDex-Tools

> **Documento de lectura obligatoria.** Cualquier persona o agente que modifique este repositorio debe leerlo completo antes de tocar código, configuración o documentación. Si una propuesta entra en conflicto con estas reglas, la propuesta se rechaza o se debate primero en una issue; no se implementa de forma silenciosa.

---

## 1. Reglas inmutables

Estas reglas no son preferencias de estilo. Son restricciones de producto y seguridad.

### R1. Cero backend y cero APIs externas

- Prohibido añadir llamadas `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon` o equivalentes hacia servicios externos.
- Prohibidos CDNs, Google Fonts, Google Analytics, Sentry, mapas de calor, píxeles de seguimiento y cualquier SDK que reporte datos.
- Prohibidas variables de entorno con endpoints, claves o tokens.
- El build debe ser estático y funcionar servido desde un simple servidor de archivos.
- Las dependencias se empaquetan localmente. Las fuentes también.
- En desarrollo, la única conexión permitida es el WebSocket de HMR de Vite contra `localhost`.

**Excepción documentada:** un enlace externo abierto por decisión explícita del usuario (`<a href>`), que no ejecuta código ni envía datos automáticamente. Nunca debe usarse para cargar recursos.

### R2. El procesamiento pesado siempre va a un Web Worker

- PDF, ZIP, cifrado, vídeo, imágenes grandes, parseo masivo o cualquier tarea de más de ~16 ms va a un worker dedicado.
- El hilo principal solo gestiona estado de React, eventos, accesibilidad y descarga.
- Se debe enviar progreso cuando la tarea dure más de un segundo.
- Los `ArrayBuffer` se transfieren con la lista de transferibles cuando sea posible, para evitar copias.
- Cada worker se termina al cancelar o desmontar. No dejar workers huérfanos.
- Los `ObjectURL` se revocan explícitamente.

### R3. La interfaz `ToolDefinition` no se rompe

`src/types/tool.ts` es un contrato público del hub. Los campos obligatorios no se renombran, no se hacen opcionales y no cambian de tipo sin una migración coordinada de todas las herramientas.

```ts
export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  icon: LucideIcon;
  component: ComponentType;
}
```

- `id`: único, `kebab-case`, estable. Cambiarlo rompe enlaces y favoritos.
- `name`: visible y corto.
- `description`: una frase, sin marketing.
- `category`: una de las categorías declaradas en `TOOL_CATEGORIES`.
- `icon`: componente de Lucide, sin wrappers que rompan el tipo.
- `component`: componente React que renderiza la herramienta completa, sin depender del estado del dashboard.

Se pueden añadir campos **opcionales** de forma retrocompatible, pero no modificar los existentes.

### R4. Aislamiento estricto por herramienta

- Todo el código específico vive en `src/tools/<tool-id>/`.
- Una herramienta no importa código de otra herramienta.
- Las dependencias específicas (por ejemplo `pdfjs-dist`, `jszip`) se importan solo dentro de su carpeta.
- Los estilos específicos usan un prefijo/clase raíz único (`pdf-to-epub-tool`) y nunca selectores globales, `body`, `html`, `*` o overrides de Tailwind compartido.
- No se escriben estilos en `document.head` ni se inyectan CSS desde workers.
- El estado de una herramienta no se filtra al dashboard ni a otras herramientas.
- Los componentes compartidos van en `src/components/` solo si son realmente genéricos.

### R5. Validación estricta de estándares

- **EPUB 3:** el paquete debe superar EPUBCheck. No se acepta "abre en mi lector" como validación.
- **XHTML:** XML bien formado, namespaces correctos, etiquetas cerradas, atributos entre comillas, entidades escapadas.
- **PDF:** no se confía en el contenido. Texto tratado como datos, nunca como HTML.
- **ZIP/EPUB:** `mimetype` es el primer archivo y se almacena sin compresión.
- Cualquier nuevo formato (DOCX, CBZ, etc.) debe declarar su especificación y añadir una estrategia de validación.

---

## 2. Contrato del worker

Cada herramienta con worker define su contrato en `types.ts` dentro de su carpeta. No se comparten tipos de worker entre herramientas.

### Mensajes

```ts
// UI → worker
{ type: 'convert', payload: { buffer: ArrayBuffer, /* opciones */ } }

// worker → UI
{ type: 'progress', payload: { current: number, total: number, percentage: number } }
{ type: 'done', payload: { /* resultado */ } }
{ type: 'error', payload: { message: string } }
```

Reglas:

- `percentage` es un entero entre `0` y `100`.
- `current` y `total` son números enteros; `total >= 1`.
- El worker nunca lanza una excepción sin capturar: envuelve el trabajo en `try/catch` y responde `error` con un mensaje apto para UI.
- Los errores técnicos se traducen a mensajes comprensibles (PDF corrupto, cifrado, sin texto, memoria…).
- El worker no accede al DOM ni a `window`.
- El worker no importa componentes React.

---

## 3. Privacidad y seguridad

### Datos

- No se persisten documentos en `localStorage`, IndexedDB ni Cache Storage salvo petición explícita del usuario y consentimiento claro.
- No se registran nombres de archivo, contenido, metadatos ni tamaños en consola en producción.
- Los nombres de archivo mostrados se escapan siempre en React (nunca `dangerouslySetInnerHTML`).

### PDFs no confiables

- `isEvalSupported: false`.
- No habilitar `enableXfa` salvo revisión de seguridad.
- No cargar `standardFontDataUrl`, `cMapUrl` ni `wasmUrl` desde red. Si se necesitan, se empaquetan localmente.
- El texto extraído se escapa para XML (`&`, `<`, `>`, `"`, `'`) antes de escribir XHTML.
- No se ejecuta JavaScript embebido del PDF.

### Dependencias

- Antes de añadir una dependencia: comprobar mantenimiento, licencia, tamaño y superficie de ataque.
- `npm audit` no debe reportar vulnerabilidades altas o críticas.
- No se aceptan dependencias que hagan telemetría por defecto.
- Los lockfiles se commitean.

---

## 4. Diseño y UI

### Tokens

| Token | Valor | Uso |
| --- | --- | --- |
| `navy` | `#0F172A` | estructura, títulos, navegación |
| `navy-soft` | `#1E293B` | acentos secundarios, hover oscuro |
| `crimson` | `#DC2626` | CTA, estado activo, badges |
| `crimson-strong` | `#E11D48` | acentos de alerta puntuales |
| `ink` | `#09090B` | texto principal, bordes, iconos |
| `paper` | `#FFFFFF` | fondo |
| `line` | `#E4E4E7` | bordes finos |

- Tipografía: **Montserrat Variable** local, fallback geométrico `sans-serif`.
- Espaciado amplio; evitar densidad excesiva.
- Sin gradientes llamativos, sin sombras pesadas, sin glassmorphism.
- El rojo se reserva para acción/estado, no para decoración masiva.
- Contraste mínimo **WCAG AA**.
- Foco visible en todos los elementos interactivos.

### Componentes

- Reutilizar `AppHeader`, `AppFooter` y los patrones del dashboard.
- Botón primario: fondo rojo, texto blanco, hover más oscuro, `disabled` atenuado.
- Botón secundario: borde `ink/15`, fondo blanco.
- Tarjetas: borde fino, `rounded-2xl`, hover sutil, sin saltos de layout.
- No introducir una librería de componentes UI sin justificarlo.

### Accesibilidad

- Todo control tiene etiqueta accesible (`label`, `aria-label` o texto visible).
- Drag & Drop debe funcionar también con teclado y con `<input type="file">`.
- Progreso con `role="progressbar"`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax` y texto.
- Errores anunciados con `role="alert"`.
- No transmitir información solo por color.
- Respetar `prefers-reduced-motion`.

---

## 5. Rendimiento

- Evitar re-renders por progreso excesivo: el worker puede emitir como máximo ~1 actualización por página y ~1 % del empaquetado.
- No crear un worker por render. Crear al iniciar la acción, guardar en `useRef`, terminar al acabar/cancelar/desmontar.
- Transferir buffers, no clonarlos.
- Limitar el tamaño de archivo de entrada y mostrar un error claro si se supera.
- Evitar cargar `pdfjs-dist` o `jszip` en el bundle inicial: deben quedar en el chunk del worker.
- No usar `dangerouslySetInnerHTML` para contenido de usuario.

---

## 6. Convenciones de código

- TypeScript estricto. Prohibido `any` implícito; evitar `as` innecesarios.
- Componentes y tipos en `PascalCase`; funciones y variables en `camelCase`; constantes en `UPPER_SNAKE_CASE`.
- IDs de herramientas en `kebab-case`.
- Preferir funciones puras y helpers pequeños.
- Comentarios solo donde la intención no es obvia (heurísticas, formato EPUB, límites).
- Textos de UI en español; identificadores en inglés.
- No dejar `console.log` en producción. Los errores del worker se comunican por mensaje.
- Formateo consistente con el resto del repositorio (2 espacios, comillas simples, punto y coma).

### Estructura de una herramienta

```text
src/tools/mi-herramienta/
├── index.ts                  # ToolDefinition (default export)
├── MiHerramientaView.tsx     # UI
├── mi-herramienta.worker.ts  # Si hay trabajo pesado
├── mi-herramienta.ts         # Lógica pura testeable (opcional)
├── types.ts                  # Contrato interno
└── README.md                 # Notas específicas (opcional)
```

---

## 7. Proceso de cambio

1. Leer este documento y el README.
2. Comprobar que el cambio respeta R1–R5.
3. Implementar con tests manuales reproducibles.
4. Ejecutar:
   ```bash
   npm run typecheck
   npm run build
   ```
5. Si se toca EPUB, validar el resultado con EPUBCheck.
6. Actualizar `CHANGELOG.md` en `[Unreleased]` o en la versión correspondiente.
7. Actualizar `README.md` si cambia el catálogo, la arquitectura o los comandos.
8. Versionado semántico:
   - **MAJOR:** ruptura de `ToolDefinition`, del formato de datos o de la API pública.
   - **MINOR:** nueva herramienta o funcionalidad retrocompatible.
   - **PATCH:** corrección o refactor interno sin cambio funcional.

### Commits sugeridos

```text
feat(pdf-to-epub): agrupar párrafos por sangría
fix(registry): validar IDs duplicados
docs(guidelines): aclarar límites de memoria
```

---

## 8. Checklist de revisión (Definition of Done)

- [ ] No hay llamadas de red ni telemetría.
- [ ] El procesamiento pesado está en un worker y envía progreso.
- [ ] `ToolDefinition` sigue intacto.
- [ ] La herramienta está aislada en su carpeta y no filtra estilos/estado.
- [ ] El worker y los ObjectURLs se limpian correctamente.
- [ ] Entradas inválidas (tipo, tamaño, PDF corrupto/cifrado) muestran errores claros.
- [ ] Teclado, foco, labels y `aria-*` funcionan.
- [ ] El diseño respeta blanco, azul marino, rojo y carbón.
- [ ] `npm run typecheck` pasa.
- [ ] `npm run build` pasa.
- [ ] EPUB generado validado con EPUBCheck (si aplica).
- [ ] `CHANGELOG.md` y `README.md` actualizados.
- [ ] Sin `console.log`, `debugger` ni TODOs sin issue.

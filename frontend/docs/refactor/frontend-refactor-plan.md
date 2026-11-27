# Plan de refactor del frontend: de demo a producción

Autor: Orquestador (Opus 5.5) · 2026-11-24
Alcance: `bfa-digital/src`. Las decisiones de estilo visual las define Gemini Neon en `ui-style-spec.md` (mismo directorio). Este plan cubre estado, integración con la API, rutas, contratos y lógica.

---

## 0. Diagnóstico general

| Área | Estado actual | Problema |
|---|---|---|
| Estado del servidor | Mezcla de 3 modelos: `adminStore` (zustand y fetch a mano), `useQuery` solo en el builder y `useEffect` con `setInterval` en las rutas | Caché duplicada, polling manual, `loading`/`error` globales compartidos por todas las pantallas |
| Auth | Un solo `authStore.token` para el staff **y** para el participante | Al validar un token de participante se pisa el JWT del admin en la misma pestaña o navegador. El interceptor hace logout ante **403** y redirige con `window.location` |
| Contratos | DTOs con nombres en español del backend mapeados a mano en cada store, `any` por todas partes, `ImageResourceDTO` con 15 alias de campo | Nada valida los datos que llegan, los mappers son frágiles |
| Restos de la demo | `App.tsx`, `screens/participant.tsx`, `admin-screens.tsx`, `admin-layout.tsx`, `login.tsx` (screen) sin uso; `simulationActive`/`tickSimulation`; `subtests: ['figuras','desplazamiento','espacial']` y `group: 'BFA - General'` hardcodeados; `adminService.getBackups/createBackup` simulados; contraseña `defaultPassword123!` en `createUser`; `roleId` hardcodeado 1..4; `console.log` del usuario en `app.tsx`; `TanStackRouterDevtools` también en producción | Comportamiento falso visible para el usuario y riesgo de seguridad |
| UX de errores | ~30 `alert()`/`confirm()` | No es aceptable en producción |
| Builder | `instrument-builder.tsx`, 3073 líneas. Clonar una versión dispara cientos de requests secuenciales desde el navegador | Imposible de mantener y no atómico (una falla a mitad deja datos corruptos) |

---

## 1. Actores y procesos

| Actor | Procesos principales | Rutas actuales |
|---|---|---|
| **Aplicador** | Crear sesión → configurar subtests → asignar participantes → distribuir accesos → abrir → monitorear en vivo → registrar incidencias → cerrar | `/app/sesiones`, `/nueva`, `/$id`, `/$id/asignaciones`, `/app/participantes` |
| **Participante** | Ingresar código → bienvenida → lista de subtests → instrucciones → responder ítems → finalizar subtest → resumen → finalizar evaluación | `/evaluacion/acceso`, `/evaluacion/$token/*` |
| **Psicólogo/Coordinador** | Crear test → versión → subtests → ítems/opciones/imágenes → claves y reglas → baremos → aprobar/publicar; calificar intentos; revisión manual; resultados | `/app/instrumentos/*`, `/app/calificaciones`, `/app/revision-manual`, `/app/resultados/*` |
| **Consultor** | Resultados agregados y reportes | `/app/dashboard-resultados`, `/app/reportes` |
| **Admin** | Usuarios, roles/permisos, auditoría, respaldos, catálogos | `/app/usuarios`, `/roles`, `/auditoria`, `/respaldos`, catálogos |

Prioridad del refactor (pedido del usuario): **P1 Sesiones**, **P2 Aplicación al participante**, **P3 Motor de creación de tests**. El resto queda en P4 (limpieza transversal).

---

## 2. Fundaciones transversales (F). Van antes que todo lo demás

### F1. Capa de datos única con TanStack Query
- Eliminar `adminStore` como caché del servidor. Zustand queda **solo** para estado de cliente: el draft del runner y las preferencias de UI.
- Estructura nueva:
  ```
  src/api/
    client.ts            // axios + interceptores (reemplaza axios.ts)
    errors.ts            // ApiError normalizado { status, code, message, details, correlationId }
    schemas/             // zod: un archivo por dominio (session.ts, assignment.ts, instrument.ts, runtime.ts…)
    endpoints/           // funciones puras tipadas por dominio (sessions.ts, participants.ts, instruments.ts, runtime.ts…)
  src/features/<dominio>/
    queries.ts           // queryOptions + keys (factory)
    mutations.ts         // useMutation con invalidaciones explícitas
    components/…
  ```
- Query keys con factory (`sessionKeys.detail(id)`, `sessionKeys.assignments(id)`), etc.
- Los loaders de TanStack Router usan `queryClient.ensureQueryData` para que no haya pantallas vacías mientras se hace el fetch.
- `QueryClient` con defaults de producción: `retry` en 0 para 4xx y hasta 2 para red, `staleTime` por dominio y `refetchOnWindowFocus` solo en el monitor.
- Validar cada respuesta con zod en `endpoints/*`. Si el parseo falla, se registra y se devuelve un `ApiError` legible. Los mappers de dominio (español → camelCase) viven junto al schema, en un solo lugar.

### F2. Auth separada por audiencia
- `staffAuth` (persistido, JWT de staff) y `participantAuth` (sessionStorage, ligado al `assignmentId`).
- Dos instancias de axios (`staffClient`, `participantClient`), cada una con su interceptor.
- Interceptor: **401** → limpiar sesión y redirigir con `router.navigate` (no `window.location`), guardando `redirect`. **403** → toast o pantalla `/no-autorizado`, **sin logout**.
- Leer `expiresAt` del login para programar un aviso "sesión por expirar" y un logout limpio.
- Hidratar `/auth/me` en `beforeLoad` de `/app` (no confiar solo en el storage).
- Permisos: guards de ruta basados en **permisos** (`hasPermission`), no en `roles[0]`. Hoy `role = user.roles[0]` ignora a los usuarios con varios roles. La navegación lateral se filtra por permiso.

### F3. UX de errores y feedback
- `sonner` para resultados de mutaciones, `<ConfirmDialog>` para acciones destructivas y `<ErrorState>`, `<EmptyState>` y skeletons ya presentes en `ui/` para las pantallas.
- Error boundary por ruta (`errorComponent`) y `notFoundComponent`.
- Prohibido `alert`/`confirm`/`console.log` (regla de lint).

### F4. Formularios
- `react-hook-form` + `zod` (ya instalados) en todos los formularios: sesión, participante, usuario, catálogos e ítems del builder. Validación inline, sin validaciones imperativas con `alert`.

### F5. Limpieza
- Borrar `App.tsx`, `screens/participant.tsx`, `screens/admin-screens.tsx`, `admin-layout.tsx`, `screens/login.tsx` y `imports/pasted_text` tras verificar que no tienen imports.
- Quitar MUI/emotion si no se usan (verificar con grep), además de `react-slick`, `react-responsive-masonry`, `canvas-confetti` y otras dependencias de Figma Make que no estén en uso.
- Renombrar el package (`@figma/my-make-file` → `bfa-digital`) y agregar los scripts `typecheck`, `lint`, `test`.
- Devtools solo con `import.meta.env.DEV`.
- Tooling: ESLint + `tsc --noEmit` en CI, Vitest + Testing Library + MSW para tests de features.

---

## 3. P1: Gestión de sesiones (aplicador)

### Modelo de estados (fuente: backend)
```
Sesión:      PROGRAMADA ──activar──▶ ABIERTA ──cerrar──▶ CERRADA
                 │                      │
                 └──────cancelar────────┴──▶ CANCELADA (terminal)
Asignación:  ASIGNADO → EN_PROGRESO → COMPLETADO | ANULADO | EXPIRADO
Intento:     NO_INICIADO → EN_PROGRESO → COMPLETADO | INTERRUMPIDO | ANULADO
```

### Bugs actuales a corregir
1. **Crítico:** "Pausar" llama a `/cancelar`, que deja la sesión en CANCELADA (terminal), y "Reanudar" llama a `/activar`, que exige PROGRAMADA, así que falla. El frontend inventa los estados `PAUSADA`/`ACTIVA`/`FINALIZADA`.
   → Usar los enums reales del backend. Eliminar "Pausar" hasta que exista en el backend (ver §6, B1). "Cancelar" pasa a ser una acción destructiva con confirmación.
2. El estado de la asignación en el frontend (`GENERADO/ACTIVO/VENCIDO/REVOCADO`) no coincide con el enum del backend (`EstadoAsignacion`). Hoy `SessionAssignmentDto` lo traduce a texto libre. → Tipar como unión literal validada por zod y acordar el contrato con el backend.
3. El token crudo se guarda en `localStorage` (`generatedTokens`) y se pierde en otro dispositivo, porque el monitor muestra `id-***`. → El token solo se muestra **una vez** al generarlo (modal con copiar, QR e imprimir). Si se pierde, se usa la acción **"Regenerar acceso"** (B2). Nunca se persiste en el cliente.
4. Las incidencias solo existen en el `localStorage` del navegador que las creó. → Hace falta un endpoint de listado (B3) y la vista lo consume.
5. Los subtests y el grupo están hardcodeados en `fetchSessions`. → Usar los datos reales (B4: `GET /sesiones/{id}` con detalle).
6. La creación de la sesión hace N+2 requests secuenciales y no es atómica. Si falla una asignación, la sesión queda a medias. → Wizard con pasos persistidos en el servidor (la sesión se crea como PROGRAMADA en el paso 1 y los pasos siguientes la editan) o un endpoint compuesto (B5). Recomiendo el wizard persistido, que es más simple y reanudable.

### Diseño de pantallas y flujos
- `/app/sesiones`: tabla con filtros (estado, fecha, versión), búsqueda y paginación del servidor cuando exista. Acciones por fila según el estado.
- `/app/sesiones/nueva`: wizard de 4 pasos → **Datos** (nombre, código autogenerado editable, ventana inicio/fin, ubicación) → **Instrumento** (test → versión PUBLICADO únicamente → subtests con orden, tiempo y aleatorización, con valores tomados de la versión) → **Participantes** (selección múltiple con filtros por carrera, cohorte y grupo, y "agregar todo el grupo") → **Revisión**. Al finalizar se muestra la hoja de accesos (§ tokens).
- `/app/sesiones/$id`: una sola página con pestañas **Monitor | Participantes y accesos | Incidencias | Configuración**. Hoy asignaciones es otra ruta: se mantiene como ruta hija para tener deep-link, pero se presenta como pestaña.
  - Monitor: `useQuery` con `refetchInterval` de 5 s **solo si** la sesión está ABIERTA y la pestaña es visible. KPIs derivados con `select`.
  - Acciones de sesión, `useSessionTransitions(session)` → `{ canOpen, canClose, canCancel }` derivado de una tabla de transiciones única, compartida por botones y menús.
  - Acciones por participante: anular o revocar acceso, regenerar acceso, nota de incidencia, ver respuestas y calificar (deep-link a `/app/calificaciones?attemptId=`).
- Hoja de accesos: imprimible/exportable con nombre, código y enlace `/evaluacion/{assignmentId}-{token}` (y QR, sin dependencias nuevas salvo aprobación).

### Contratos frontend (zod)
`Session { id, code, name, description?, status: EstadoSesion, scheduledStart, scheduledEnd, location?, versionTest: {id, testName, number}, subtests: SessionSubtest[], counts: {...} }`
`Assignment { assignmentId, attemptId|null, participant:{id, code, name}, assignmentStatus, attemptState, currentSubtest?:{id,name}, progress:0..100, lastActivityAt?: ISO, tokenExpiresAt?: ISO }`

---

## 4. P2: Aplicación al participante (runner)

### Problemas actuales
- `getItem` descarga **todos** los ítems del subtest en cada navegación y busca por ordinal.
- Solo se soporta `OPCION_UNICA`. Los tipos `OPCION_MULTIPLE`, `VERDADERO_FALSO`, `NUMERICA` y `TEXTO_ABIERTO` existen en el modelo pero no tienen UI.
- El cronómetro es 100 % cliente (`timeLeft` en localStorage): se reinicia al volver a instrucciones y se puede manipular. `timeUsedSeconds: 1` está hardcodeado y `finishSubtest` envía 0.
- `answers` usa como key `slug-itemId` y es global: si un participante entra en el mismo navegador que otro, se mezclan las respuestas (no se limpia por `assignmentId`).
- Con la cola offline se bloquea la finalización mediante `alert`. Si se acaba el tiempo con respuestas pendientes, el subtest no se finaliza nunca.
- La URL contiene el token crudo (`/evaluacion/{id-token}/…`) en todas las rutas, así que queda en el historial y en los logs.
- No hay guard de orden: se puede entrar por URL a un subtest COMPLETADO o saltarse el orden.
- El estado `PAUSADA` que verifica el layout no existe en el backend.

### Diseño objetivo
- **Entrada:** `/evaluacion/acceso?code=` → valida → guarda el JWT de participante en `participantAuth` → `router.navigate('/evaluacion/sesion')`. El token deja de estar en la URL (si llega por enlace, se canjea y se reemplaza con `replace`).
- **Máquina de estados del runner** (reducer puro, testeable, en `features/runtime/machine.ts`):
  `validando → bienvenida → listaSubtests → instrucciones(s) → respondiendo(s, i) → finalizandoSubtest(s) → listaSubtests → resumen → finalizando → completada`
  con estados laterales `bloqueado(sesionCerrada|accesoRevocado|expirado)` y `sinConexion`.
- **Datos:** una query `runtime.evaluation` (`/evaluacion-participante/yo`) como fuente de verdad del estado por subtest, y una query por subtest con **todos** sus ítems (`/intentos/{a}/subtests/{s}/items`). La navegación entre ítems es local e instantánea, porque no hay fetch por ítem. Imágenes con prefetch del siguiente ítem (`AuthenticatedImage` con caché por URL en Query).
- **Ruta de ítem:** `/evaluacion/subtests/$subtestId/items/$ordinal` (ordinal numérico, validado con `params.parse`). Un guard en `beforeLoad` redirige si el subtest no está habilitado o ya está completado.
- **Respuestas:** store zustand `runtimeDraft` con key `assignmentId` (`answers[itemId] = AnswerValue`), donde `AnswerValue` es una unión discriminada por `TipoRespuesta`. Cola de sincronización con reintentos con backoff, idempotente por `itemId`. Se vacía con `bulk-sync`. Se limpia al completar o al cambiar de asignación.
- **Renderers por tipo de respuesta:** `OptionSingle`, `OptionMulti`, `TrueFalse`, `Numeric`, `OpenText` registrados en un mapa `TipoRespuesta → componente`. Teclado: A–D/1–4 seleccionan y ←/→ navegan.
- **Tiempo:** el servidor es la autoridad. `iniciar subtest` debe devolver `startedAt` y `timeLimitSeconds` (B6). El cliente calcula `deadline = startedAt + limit` y muestra la cuenta regresiva desde allí, así que recargar la página no reinicia el tiempo. Al llegar el deadline: flush de la cola → finalizar (aunque falle la cola, el backend cierra por tiempo). `timeUsedSeconds` por ítem se mide de verdad con los timestamps de entrada y salida.
- **Mapa de ítems** del subtest (respondidos, pendientes, actual) y resumen previo a finalizar con los ítems sin responder.
- **Modo examen:** advertencia en `beforeunload`, bloqueo de menú contextual y arrastre en recursos (ya existe), sin enlaces de salida durante `respondiendo`.

---

## 5. P3: Motor de creación de tests

### Problema central
El modelo del backend es granular (Test → Versión → Subtest → Ítem → Opción → Imagen, más ReglaCalificación → ClaveRespuesta, más Baremo → Rango) y el builder lo recorre con una request por entidad. Ya existe un endpoint de borrador agregado, **`POST /test-versions/{id}/configuration`** (`VersionConfigurationRequest` con `draftId`, `status` EXISTING/CREATED/UPDATED/DELETED y anidamiento completo hasta la clave de respuesta), pero se usa solo parcialmente: el guardado de ítems (`saveItemDraft`), las reglas, las claves y la clonación de versión (`CreateVersionDialog`, ~200 líneas de requests en cascada) siguen yendo entidad por entidad.

### Diseño objetivo: "documento de versión"
- Un solo modelo de cliente, el **`VersionDocument`**: el árbol completo de la versión (subtests → ítems → opciones → imágenes → clave), cada nodo con `{ id?, draftId, status }`. Es exactamente la forma de `VersionConfigurationRequest`.
- **Carga:** un solo `GET` del documento (B7: `GET /test-versions/{id}/configuration`; mientras no exista, se arma con un adaptador que hace las llamadas actuales en paralelo, encapsulado en un solo archivo para borrarlo después).
- **Edición:** store zustand por versión abierta (`builderStore`) con reducer de operaciones (`addSubtest`, `moveItem`, `setCorrectOption`, `attachImage`…), `dirty` por nodo, undo/redo simple y autosave del borrador en `localStorage` por `versionId` para no perder trabajo.
- **Guardado:** un solo `POST /configuration` con el diff (los nodos con status ≠ EXISTING). Las imágenes nuevas se suben antes como recursos (`resourceId`) y el documento solo las referencia (B8: endpoint de subida de recurso suelto, si no existe).
- **Validación en cliente** con zod sobre el documento: cada ítem de opción tiene ≥2 opciones y exactamente 1 correcta en OPCION_UNICA, códigos únicos por nivel, tiempos > 0, etc. El panel de "problemas" lista errores por nodo y bloquea "Aprobar/Publicar".
- **Clave de respuesta integrada:** en el editor de ítem, marcar la opción correcta *es* la clave. La regla `CLAVE_ITEM` del subtest se crea implícitamente. El usuario no ve "reglas", "estrategias" ni IDs salvo en modo avanzado.
- **Plantillas por tipo de ítem** (BFA: comparación de imágenes, desplazamiento, espacial): preconfiguran `tipoItem`, `tipoRespuesta`, el número de opciones y el layout de imágenes.
- **Versionado:** las versiones PUBLICADO y RETIRADO (y las que no estén en BORRADOR, porque el backend exige BORRADOR para guardar) son de solo lectura en la UI. "Nueva versión desde…" usa un endpoint de clonación del servidor (B9: `POST /test-versions/{id}/clone`). Mientras no exista, se usa `GET` del documento → remapear ids a `draftId` → `POST /configuration` en la versión nueva, que son 2 requests en lugar de cientos.
- **Flujo de publicación:** BORRADOR → (validación OK) Aprobar → Publicar, con un diálogo de revisión que muestra el conteo de subtests, ítems y claves, y las advertencias. Las sesiones solo pueden elegir versiones PUBLICADO.
- **Vista previa como participante:** reutiliza los renderers del runner (§4) en modo `preview` sin API. Es la razón de que los renderers sean componentes puros.
- **Descomposición del archivo de 3073 líneas:**
  ```
  features/instruments/
    document/ (types.ts, schema.ts, reducer.ts, diff.ts, adapters.ts)
    builder/  (BuilderLayout, OutlineTree, SubtestPanel, ItemEditor, OptionList, ImageField, AnswerKeyField, ProblemsPanel, PublishDialog)
    baremos/  (BaremoEditor, RangeTable)
    versions/ (VersionList, NewVersionDialog)
    preview/  (PreviewRunner)
  ```

---

## 6. Dependencias del backend (a coordinar; fuera del alcance de este refactor)

| ID | Necesidad | Bloquea |
|---|---|---|
| B1 | **Decidido: sí hay pausa.** Spec en `psycho-form/docs/backend-pausa-sesion-prompt.md` (estado `PAUSADA`, `/pausar`, `/reanudar`, tiempo congelado, 409 `SESION_PAUSADA`). Incluye B6 | §3 bug 1. El frontend se implementa contra ese contrato; hasta que el backend esté listo, el botón queda oculto tras un feature flag |
| B2 | `POST /sesiones/{id}/asignaciones/{aid}/regenerar-token` **Implementado en `434fdb6`** (corrección `f35da19`). | Tokens sin persistencia en el cliente |
| B3 | `GET /sesiones/{id}/incidencias` **Implementado en `ba6618a`.** | Bitácora real |
| B4 | `GET /sesiones/{id}` ya existe, pero **no** trae los subtests configurados (`sesion_subtest`) ni el nombre del test y de la versión. Hace falta incluirlos o exponer `GET /sesiones/{id}/subtests` **Implementado en `5bd6adc`.** | Al reanudar el wizard se pierde la configuración de subtests guardada, y el detalle muestra "Versión #id" |
| B5 | (opcional) creación compuesta de sesión | Alternativa al wizard persistido |
| B6 | `startedAt`/`deadline` en iniciar subtest y en `/yo` | Cronómetro autoritativo |
| B7 | `GET /test-versions/{id}/configuration` (documento completo) **Implementado en `db8a7ea`.** | Carga del builder en 1 request |
| B8 | Subida de imagen como recurso suelto que devuelve `resourceId` **Implementado en `42a8bf6`** (corrección `7adeaa9`: reintento concurrente). | Guardado atómico del documento |
| B9 | `POST /test-versions/{id}/clone` **Implementado en `c2bccba`** (corrección `0e17456`: recursos de imagen compartidos). | Clonación atómica |
| B10 | Paginación y filtros en `/participantes`, `/sesiones`, `/auditoria` **Implementado en `69d0ce8`.** | Tablas de producción |
| B11 | Contratos de enum coherentes en `SessionAssignmentDto` (`status`/`state`) **Implementado en `0967e41`.** | Tipado estricto |
| B12 | **Prompt listo:** `psycho-form/docs/backend-permisos-claves-intentos-prompt.md` (B12 a B14). Al implementarse, el frontend debe sumar `SESION_LEER` e `INSTRUMENTO_CATALOGO_LEER` en `routePermissions.ts` y en el paso Instrumento del wizard. Seed RBAC: el rol Aplicador no tiene lectura de tests (`GET /tests`), que hace falta para elegir instrumento al crear una sesión. El rol Psicólogo no tiene `SESION_*` ni `PARTICIPANTE_LEER` (pendiente de decisión del usuario) **Implementado en `1950923`.** | Wizard de sesión (S-03) para Aplicador |
| B13 | Borrar la clave de respuesta vía `/configuration`: hoy un `AnswerKeyDraft` con `DELETED` se ignora **Implementado en `22a331f`.** | Quitar la clave de un ítem en el builder |
| B14 | Fuente de intentos para Psicólogo/Consultor que no dependa de `GET /sesiones` (p. ej. `GET /attempts?status=COMPLETADO`) **Implementado en `83a06bd`.** | Calificaciones y resultados individuales por rol |
| B15 | **Prompt listo** (mismo archivo). `PUT /sesiones/{id}/subtests` debe borrar los subtests omitidos y `GET /sesiones/{id}` debe exponerlos (B4). Mientras tanto, el wizard bloquea el desmarcado de subtests ya guardados **Implementado en `ac260e3`** (correcciones `2f86f60`: el reemplazo es opt-in con `?mode=replace`; `c49dd35`: los conservados se reubican tras los enviados). | Quitar subtests de una sesión programada |
| B16 | **Prompt listo** (mismo archivo). `PUT /participantes/{id}` **Implementado en `6f2f803`** (sin `correo`: no existe en el modelo). | Edición de participantes (cierre de S-05) |
| B17 | `GET /sesiones/{id}/asignaciones` (`SessionAssignmentDto`, permiso `SESION_LEER`): hoy `ParticipantAnswerService.bulkSyncAnswers` devuelve rechazos `RECHAZADA` solo en la respuesta síncrona al participante sin persistirlos ni exponerlos al staff. Agregar campos opcionales aditivos `rejectedAnswersCount` (`Integer`) y `rejectedAnswers` (`[{ itemId, code, rejectedAt }]`) en `SessionAssignmentDto` para visibilidad en tiempo real en el monitor **Implementado en `863ffd4`.** | Indicador en vivo de respuestas rechazadas en `SessionMonitorTab` |
| B18 | **Prompt listo** (`psycho-form/docs/backend-permisos-claves-intentos-prompt.md`). Las restricciones SQL de orden son únicas e inmediatas. El guardado agregado necesita aplicar reordenamientos de registros existentes sin colisiones dentro de la transacción **Implementado en `fcad1ba`** (corrección `edb76fb`: códigos diferidos). | Guardar permutaciones de posiciones ya ocupadas |
| B19 | **Prompt listo** (`psycho-form/docs/backend-permisos-claves-intentos-prompt.md`). `GET /reports/{id}/file` (`REPORTE_EXPORTAR`) que devuelva el binario con `Content-Disposition`. Hoy `/reports` solo registra `ReporteGenerado` con `rutaAlmacenamiento` **Implementado en `84f90e1`** (corrección `9920f53`). | Descargar reportes desde `/app/reportes` (el helper `src/api/download.ts` ya existe) |
| B20 | **Prompt listo** (`psycho-form/docs/backend-permisos-claves-intentos-prompt.md`). `Idempotency-Key` en POST/PUT de imágenes, expuesta como `uploadKey` junto con `originalFileName`, `sizeBytes` y `sha256` en `clone-template` **Implementado en `cd2a5c7`** (correcciones `2b621ce`: clave aislada por usuario y operación; `f9d1c6a`: PUT por ID concurrente). | Confirmar subidas o PUT inciertos sin abrir el conflicto manual `UNCERTAIN_IMAGE_OPERATION` (F3-FIX-7b) |
| B21 | **Prompt listo** (mismo archivo). `GET /evaluacion-participante/yo` en solo lectura para una asignación `COMPLETADO` (hoy devuelve 409 `ASIGNACION_NO_OPERABLE`) **Implementado en `eb6411a`** (corrección `92e5e0b`: `finishedAt`). | Confirmar la entrega tras recargar o perder la red al finalizar (hoy el frontend usa un marcador en `sessionStorage`, F2-FIX-9) |
| B22 | **Prompt listo** (mismo archivo). Calificar las claves de `OPCION_MULTIPLE`, `NUMERICA` y `TEXTO_ABIERTO` (`ClaveSimpleScoringService` solo compara `opcionCorrecta`) **Implementado en `e474c8d`** (corrección `e109fa8`). | Publicar esas claves sin revisión manual (hoy se bloquean con `UNSUPPORTED_SCORING_KEY`, F3-FIX-9) |
| B23 | **Prompt listo** (mismo archivo). Crear los registros de revisión manual al calificar y aplicar el puntaje resuelto al resultado oficial **Implementado en `6e8dd40`** (correcciones `8d3bfd2`, `3add011`, `0077089`, `55d094e`). | Bandeja de revisión manual útil (hoy se muestra el aviso `PendingServerSupportNotice`) |

### 6.1 Ajustes pendientes en el frontend por cada B implementado

Rama backend `feat/backend-dependencias-frontend`. Inventario y estado: `psycho-form/docs/backend-dependencias-inventario.md`. Todos los cambios del backend son aditivos salvo donde se indica.

**P1**
- **B22** (`e474c8d`, `e109fa8`): relajar `UNSUPPORTED_SCORING_KEY` en `src/features/instruments/document/schema.ts` (~l. 440-465) para `OPCION_MULTIPLE` con `expectedText` de códigos (mayúsculas, separados por coma), `NUMERICA` con `expectedNumber` (+ `numericTolerance`) y `TEXTO_ABIERTO` con `expectedText` sin revisión manual. Ajustar `schema.test.ts` y `UnsupportedScoringKey.test.tsx`. Ojo: `OPCION_MULTIPLE` con solo `correctOption` exige marcar exactamente esa opción. El detalle del resultado marca como correctas las mismas opciones que usa la calificación.
- **B23** (`6e8dd40` + correcciones): quitar `PendingServerSupportNotice` de la bandeja de revisión manual y del detalle del resultado. `GET /manual-review/pending` devuelve también `status: "OBSERVADO"` (mostrar badge y permitir resolver otra vez). En el detalle, `isCorrect` llega `null` mientras `requiresManualReview` es true. Resolver puede responder 409 (intento sin resultado) y 400 (puntaje negativo, nulo al aprobar o mayor que el máximo). Los intentos calificados antes de B23 entran en la bandeja tras la migración `20261126000800`.
- **B13** (`22a331f`): el builder puede quitar la clave enviando `answerKey.status = DELETED` con `id` (`document/adapters.ts`, `reconcileDocumentAfterPass1`). Borrar la opción correcta sin tocar la clave da 400.
- **B18** (`fcad1ba`, `edb76fb`): el builder puede dejar de bloquear intercambios y rotaciones de posiciones ocupadas (subtests, ítems, opciones, imágenes y subtests de sesión) y borrar y recrear un elemento con el mismo código en un solo guardado. Un duplicado real llega como 409 `CONFLICT`.

**P2**
- **B12** (`1950923`): `store/permissions.ts`: añadir `INSTRUMENTO_CATALOGO_LEER`, `SESION_LEER` y `TEST_LEER` como códigos; `TEST_LEER` = [TEST_LEER, TEST_CREAR, TEST_PUBLICAR], `SESION_LEER` = [SESION_LEER, SESION_APLICAR, SESION_CREAR] (hoy el guard de sesiones, `permissions.ts:36`, no incluye `SESION_LEER`), nueva `INSTRUMENTO_CATALOGO_LEER` = [INSTRUMENTO_CATALOGO_LEER, ...TEST_LEER]. Paso Instrumento del wizard (`wizard-queries.ts`): `/tests`, `/versions` y `/subtests` con `INSTRUMENTO_CATALOGO_LEER`; el Aplicador solo ve versiones PUBLICADO (404 en las demás) y no pide ítems ni opciones (403). `/app/sesiones/nueva` sigue con `SESION_CREAR` y `/app/instrumentos` con `TEST_LEER`.
- **B14** (`83a06bd`): `api/schemas/results.ts` (`AttemptSummaryWireSchema` + `PageResponse`) y `api/endpoints/results.ts` (`listAttempts` → `GET /attempts` con `status`, `scored`, `sessionId`, `versionTestId`, `participantCode`, `from`, `to`, `page`, `size` ≤ 100 y `sort` en `finalizadoEn|iniciadoEn|participantCode`). `features/results/attempts-source.ts` (~l. 261): reemplazar el adaptador basado en sesiones por la API, con permisos [RESULTADO_VER, CALIFICACION_EJECUTAR]. `pendingManualReviews` cuenta PENDIENTE y OBSERVADO.
- **B15** (`ac260e3`, `2f86f60`, `c49dd35`): **cambio de contrato opt-in.** Sin parámetro, `PUT /sesiones/{id}/subtests` sigue conservando los omitidos (comportamiento actual) y los reubica después de las posiciones enviadas, así que la respuesta puede traer más filas que las enviadas. Con `?mode=replace` borra los omitidos (lista vacía = todos). Cuando el wizard se inicialice con los subtests guardados (B4), enviar `mode=replace`, quitar el bloqueo de `lockedIds`/`savedSubtestIds` y los avisos «Quitar subtests guardados aún no está disponible» (`step-subtests.tsx`, `subtest-rows.ts`), y avisar de que guardar reemplaza la configuración. La respuesta sale ordenada por `numeroOrden`.
- **B4** (`5bd6adc`): `api/schemas/sessions.ts`: mapear `testId`, `testName`, `versionNumber` y `subtests[]` (`subtestId`, `code`, `name`, `order`, `timeLimitSeconds`, `randomizeItems`, `randomizeOptions`). `SessionDetailLayout.tsx` muestra el nombre del test y la versión en lugar de «Versión #id». Al reanudar el wizard (`?sessionId`), precargar los subtests y dejar de usar `wizardVersionLookupQuery`.
- **B16** (`6f2f803`): `api/endpoints/academic.ts`: `updateParticipant(id, input)` → `PUT /participantes/{id}`, parseado con `ParticipantSchema`. Body `{firstNames, lastNames, code? (igual al actual u omitido), fechaNacimiento? (YYYY-MM-DD | null), sexoId?, carreraId?, cohorteId?, grupoAcademicoId?}`. Semántica de PUT completo: un catálogo omitido o null se limpia, así que el formulario reenvía todos los campos. Permiso `PARTICIPANTE_MODIFICAR`. No hay `correo` (no existe en el modelo).
- **B21** (`eb6411a`, `92e5e0b`): el runtime confirma la entrega con `GET /yo` y `attemptStatus: "COMPLETADO"`, también con la sesión cerrada, en lugar del marcador de `sessionStorage`. Una asignación completada no trae ítems. Campo nuevo `finishedAt` (`serverDateTime.nullish()` en `runtime.ts`).
- **B2** (`434fdb6`, `f35da19`): `api/endpoints/sessions.ts`: `regenerateAssignmentToken(sessionId, assignmentId, ttlHours?)` → `POST /sesiones/{id}/asignaciones/{aid}/regenerar-token`, parseado con `AssignedParticipantWireSchema` y armado con `buildAccessCode`. `SessionAccessTab.tsx` (~l. 123): botón «Regenerar código» en lugar del aviso de B2. Errores 409 `SESION_FINALIZADA` y `ASIGNACION_NO_OPERABLE`. Regenerar no interrumpe a un participante con JWT vigente.
- **B19** (`84f90e1`, `9920f53`): `api/endpoints/reports.ts`: `downloadReport(id)` → `GET /reports/{id}/file` con `responseType: "blob"` y `filenameFromDisposition` (patrón de `backups.ts`). `ReportsPage.tsx`: acción Descargar y retirar el aviso de endpoint pendiente. `ReportFormDialog.tsx` (~l. 105) y el fixture `reports.json`: rutas `reports/...` sin barra inicial (con `/` inicial da 404). **Pendiente fuera del frontend:** nadie sube hoy los binarios al storage, así que en uso real la descarga dará 404 hasta que exista ese flujo; 503 si el storage no está disponible.

**P3**
- **B10** (`69d0ce8`): participantes (`academic.ts`, `participants/queries.ts`, `participants-page.tsx`): enviar `q`, `estado`, `sexoId`, `carreraId`, `cohorteId`, `grupoAcademicoId` y `sort` al servidor; el orden por defecto pasa a `apellidos`. `wizard-queries.ts`: `PARTICIPANT_PAGE_SIZE = 200` daba 400 (máximo 100) y ahora se recorta a 100; bajar a 100 o pasar a búsqueda paginada (`step-participants.tsx`, `AddParticipantsDialog.tsx`). Sesiones (`sessions.ts`, `SessionsListPage.tsx`): `estado`, `versionTestId`, `testId`, `q`, `from`, `to`; con `page` la respuesta es `PageResponse` (sin `page`, el array de siempre). Auditoría (`admin.ts` `normalizeAuditQueryParams`, `audit-page.tsx`): quitar la restricción de enviar `entity` y `entityId` juntos; filtros independientes `action`, `userId`/`actorId`, `from`, `to`; con `page`, `PageResponse`.
- **B20** (`cd2a5c7`, `2b621ce`): `Idempotency-Key` de 1 a 64 caracteres `[A-Za-z0-9_-]` (un UUID cumple; otro formato, vacía o solo espacios da 400: si no hay clave, omitir el header), aislada por usuario y operación: para reintentar, reusar la misma clave en la misma operación. Hoy el frontend no envía el header: generar un UUID aparte, no usar `uploadSlotKey` de `reconcile.ts`. `schemas/instruments.ts`: campos opcionales `originalFileName`, `sizeBytes`, `sha256` y `uploadKey` en `SubtestCloneImageTemplateWireSchema`; `sha256` y `uploadKey` en `ItemImageWireSchema`; `uploadKey` en `UploadedImageWireSchema`. `endpoints/instruments.ts`: header `Idempotency-Key` (UUID) en `uploadItemImage`, `uploadOptionImage`, `replaceItemImage` y `replaceOptionImage`. `document/types.ts`, `adapters.ts`, `sent.ts` y `reconcile.ts`: propagar la identidad para resolver subidas inciertas sin `UNCERTAIN_IMAGE_OPERATION`.
- **B8** (`42a8bf6`, `7adeaa9`): un reintento concurrente con la misma clave devuelve el recurso ganador. `uploadImageResource(file, altText?, idempotencyKey?)` → `POST /images/resources` (`{resourceId, storagePath, mimeType, originalFileName, sizeBytes, sha256, uploadKey}`). Subir las imágenes nuevas antes de `saveVersionConfiguration` y enviarlas como `ImageDraft{status: "CREATED", resourceId}`. Un `resourceId` inexistente da 400.
- **B3** (`ba6618a`): `schemas/sessions.ts` y `endpoints/sessions.ts`: `GET /sesiones/{id}/incidencias` → `[{id, participantId, participantName, text, recordedAt, recordedBy}]`, ya ordenado. `SessionIncidencesTab.tsx` e `incidenceLog.tsx` cargan el historial del servidor en lugar de la memoria. `IncidenceForm.tsx` muestra los 400 nuevos (texto vacío o de más de 1000 caracteres, participante no asignado).
- **B17** (`863ffd4`): `AssignmentWireSchema` ya declara `rejectedAnswersCount` y `rejectedAnswers`. `SessionMonitorTab.tsx` muestra el contador y la lista (máximo 20, los más recientes; «y N más» si hay más).
- **B11** (`0967e41`): `status` y `state` no tienen valores nuevos; el monitor (`SessionMonitorTab.tsx`, `model.ts` `toAttemptStatus`, `LinkStatusBadge.tsx`) deja de recibir combinaciones engañosas. Opcional: añadir `assignmentStatus` y `attemptStatus` (enum crudo) a `AssignmentWireSchema` y actualizar `__fixtures__/sessions/assignments.json`.
- **B7** (`db8a7ea`): `endpoints/instruments.ts`: `getVersionConfiguration(versionId)` → `GET /test-versions/{id}/configuration` (`{version, subtests: SubtestCloneTemplate[]}`). `document/adapters.ts` (~l. 370): una sola llamada en lugar de `Promise.all(getSubtestCloneTemplate)`; `clone-template` queda para `ReuseSubtestDialog.tsx`. El documento se puede reenviar tal cual a `POST /configuration` (acepta los nombres `source*`).
- **B9** (`c2bccba`, `0e17456`): el clon comparte los archivos de imagen con el origen; reemplazar o borrar una imagen en el clon solo cambia el vínculo. `NewVersionDialog.tsx` → `POST /test-versions/{id}/clone` con `{versionNumber}` (409 si el número se repite, 404 si el origen no existe). Retirar el plan de clonación del cliente (`VersionClonePlan`, `CloneRulePlanItem`, `CloneBaremoPlanItem`, `IncompleteVersionCloneError`, `cloneVersionFromSource`, `buildCloneConfiguration` en `adapters.ts` ~l. 199-260). La copia del servidor incluye reglas, claves de conjunto, dimensiones, matriz y baremos (antes `omittedRules`/`omittedBaremos`).

**No bloqueantes de las revisiones (frontend):** el wizard corta a las 50 páginas de participantes (más de 5.000 quedan fuera); `IncidenceForm.tsx` no limita a 1000 caracteres; el builder aún deshabilita quitar claves guardadas, bloquea intercambios de orden y mantiene `UNSUPPORTED_SCORING_KEY`; `PendingServerSupportNotice` sigue en bandeja y detalle; `runtime.ts` no transforma `finishedAt`.

**Huecos detectados para un B nuevo (backend):** reenviar el documento de B7 reactiva elementos `INACTIVO` (el guardado fuerza `ACTIVO`). `AnswerKeyTemplate`/`AnswerKeyDraft` no exponen ni escriben `usa_conjunto_opciones` ni las opciones del conjunto (el builder no puede crear claves de conjunto vía `/configuration`; B9 sí las clona). Las rúbricas de evaluación no se clonan. Falta el flujo que suba los binarios de reportes (B19).

Todo lo de §3 a §5 tiene una variante "puente" que funciona con la API actual, encapsulada en `api/endpoints/*` o `document/adapters.ts`, para no bloquear el frontend.

---

## 7. Fases y tareas atómicas (para delegar)

Convención: cada tarea tiene **entrada**, **salida**, **criterio de aceptación**. `S` = Sonnet 5.5 (secuencial), `G` = Gemini Hydrogen (swarm paralelizable), `N` = Gemini Neon (estilo).

**Fase 0: Fundaciones (bloqueante)**
- F-01 S · Tooling: eslint, typecheck, vitest, MSW, scripts y rename del package. *AC:* `npm run typecheck && npm run lint && npm test` en verde.
- F-02 S · `api/client.ts`, `errors.ts`, clientes staff y participante, interceptores 401/403. *AC:* tests con MSW de 401 → redirect y 403 → sin logout.
- F-03 S · Auth: `staffAuth`/`participantAuth`, hidratación de `/auth/me` y guards por permiso. *AC:* login de participante en otra pestaña no afecta la del staff.
- F-04 N · Aplicar los tokens de `ui-style-spec.md` en `theme.css` y crear los componentes `StatusBadge`, `PageHeader`, `ConfirmDialog`, `DataTable`. *AC:* cero colores crudos en los componentes base.
- F-05 G (swarm) · Schemas zod + endpoints por dominio: sessions, participants, catalogs, runtime, instruments, results, admin. *AC:* cada endpoint tipado, sin `any`, con test de parseo con fixtures reales.
- F-06 S · Limpieza de código muerto y dependencias (tras F-05).

**Fase 1: Sesiones**
- S-01 S · `features/sessions/queries|mutations`, tabla de transiciones y `useSessionTransitions`. *AC:* tests unitarios de transiciones contra los enums del backend.
- S-02 S · Lista de sesiones con filtros.
- S-03 S · Wizard de creación (persistido) con RHF+zod.
- S-04 S · Detalle con pestañas: monitor con polling condicional, accesos (token una sola vez, hoja de accesos) e incidencias.
- S-05 S · Participantes: lista, alta y edición con RHF y asignación masiva por grupo.

**Fase 2: Runner**
- R-01 S · Máquina de estados del runner y tests exhaustivos (reducer puro).
- R-02 S · `runtimeDraft` store con key por asignación, cola de sincronización con backoff y tests.
- R-03 G (swarm) · Renderers por `TipoRespuesta` (5, independientes) + navegación por teclado. *AC:* storybook-like en `/dev/renderers` solo en DEV, o tests de RTL.
- R-04 S · Rutas nuevas sin token en la URL, guards de orden y cronómetro por deadline.
- R-05 N · Estilo de modo examen según la spec.

**Fase 3: Builder**
- B-01 S · `VersionDocument` (types, schema, reducer, diff) y tests (diff → `VersionConfigurationRequest`).
- B-02 S · Adaptador de carga puente y `builderStore` con autosave.
- B-03 G (swarm) · Componentes del builder (OutlineTree, ItemEditor, OptionList, ImageField, AnswerKeyField, BaremoEditor), cada uno contra el contrato del reducer.
- B-04 S · Guardado agregado de la estructura, panel de validación y flujo de aprobación y publicación. El adaptador usa llamadas separadas para metadatos, reglas nuevas, imágenes pendientes y baremos, según los endpoints disponibles.
- B-05 S · Nueva versión desde una versión existente mediante el adaptador puente y vista previa con los renderers de R-03. La clonación completa requiere los endpoints de creación, configuración y los recursos asociados. Si un paso falla tras crear la versión, el editor abre el borrador parcial y muestra el error.
- B-06 S · Borrar `instrument-builder.tsx`.

**Fase 4: Resto** (resultados, calificación, revisión manual, reportes, admin, catálogos): migrar a Query + RHF, quitar los simulados de respaldos (o esconderlos tras un feature flag hasta que el backend responda) y eliminar la contraseña hardcodeada (generar una temporal en el backend o pedirla en el formulario).

**Validación:** al cerrar cada fase, revisión de GPT 6.2 (dictamen APROBADO / CAMBIOS REQUERIDOS) contra este documento. Para el cierre de la fase 3, el usuario indicó que se hicieran únicamente comprobaciones locales.

---

## 7b. Backlog de auditoría asignado a fases (re-auditoría GPT 6.2, Fase 0)

Hallazgos en código legacy que su fase **reemplaza** (no se parchean en Fase 0, pero el criterio de aceptación de la fase los incluye):

| Fase | Hallazgo |
|---|---|
| F1 (sesiones) | `adminStore` acepta escrituras tardías de la cuenta saliente → se elimina (Query con claves por sesión). `/app/sesiones/$id/asignaciones` no renderiza porque el padre no tiene `Outlet` → pestañas. `/app/sesiones/nueva` con guard `SESION_CREAR`. Agregar y revocar requieren `SESION_APLICAR`. Participantes no debe esperar a los catálogos para listar. Reemplazar `confirm()` nativos |
| F2 (runner) | Las escrituras tras `await` deben verificar la asignación y el intento de origen. Cancelar los efectos de la ruta anterior. Revocar las URL `blob:` creadas. Avisar cuando se descarta la cola de otro participante. El `catch` de `routes/evaluacion/$token.tsx` debe ignorar `STALE_PARTICIPANT`. Mostrar `rejectedAnswers` al participante y al monitor. Si `bulk-sync` falla entero con 4xx, no dejar la cola en offline para siempre. Acotar el reintento de `SUBTEST_NO_INICIADO`. Fechas de `runtime.ts` con `serverDateTime` (conventions §10): startedAt, pausedAt, iniciadoEn, finalizadoEn, ultimaActividadEn, respondidoEn |
| F3 (builder) | `/scoring/strategies` exige `CALIFICACION_CONFIGURAR`: condicionar la consulta y los controles de escritura por permiso. Fechas de `instruments.ts` con `serverDateTime` (creadoEn, aprobadoEn, publicadoEn, fechaCreacion) |
| F4 (resto) | `/app/revision-manual` usa una URL vieja (`GET /manual-review/pending` admite `RESULTADO_VER`). `/app/dashboard-resultados` llama `/resultados/dashboard` (no existe; usar `/analytics/results` y `/dashboard/overview`). `/app/reportes` llama `/reportes/descargar` (no existe) y tiene acciones sin el permiso `REPORTE_EXPORTAR`. Calificaciones y resultados dependen de `/sesiones` (B14). Feedback de error en Descargar respaldo y Exportar PDF. F-06 (dependencias sin uso). **Decisión del orquestador:** `/app/carga-imagenes` se retira, porque la carga de imágenes de ítems y opciones vive en el builder de la Fase 3. La ruta redirige a `/app/instrumentos` y se quita el enlace de `InstrumentList.tsx`. **Calificar desde el Monitor:** el Monitor ya envía `?sessionId&attemptId`. La nueva pantalla de calificación (sobre B14 `GET /attempts`) debe abrir ese intento directamente. El puente provisional en `calificaciones.tsx`/`adminStore` deja abiertos estos casos de la auditoría de Fase 1 (re-verificación 4): falta reintentar cuando falla la lista de sesiones; «Actualizar» y «Calificar» se habilitan antes de validar la sesión elegida desde la caché; una respuesta tardía de `fetchSessions` desincroniza el selector. Se resuelven al reemplazar la pantalla, no parcheando la legacy. Fechas de `academic.ts`, `admin.ts` y `results.ts` con `serverDateTime` (`fechaNacimiento` es solo fecha: no aplicar) |

## 8. Riesgos
- Las dependencias del backend (§6) pueden atrasar la limpieza de los adaptadores puente. Se mitiga encapsulándolos.
- Migrar el runner en medio de un ciclo de aplicación real: se libera detrás de la ruta nueva y la vieja se mantiene una iteración.
- Datos existentes con estados que el frontend no conoce: zod con `catch` hacia `DESCONOCIDO` y un badge neutral, sin crashear.

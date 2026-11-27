# Inventario backend B1–B23 (Paso 0)

Rama: `feat/backend-dependencias-frontend` (desde `refactor/frontend-produccion`, `fed3397`).
Base: `./mvnw test` → 239 tests, 0 fallos.
Rutas relativas a `psycho-form/psychoform/src/main/java/com/uam/psychoform/`, salvo que se indique otra cosa.

| ID | Estado inicial | Estado final | Commits | Evidencia inicial | Spec |
|---|---|---|---|---|---|
| B1 | **HECHO** | **HECHO (previo)** | — | `SessionController.java:56-73` (`/pausar`, `/reanudar`, `/pausas`); `SesionAplicacionService.java:69-167` (transiciones, cierre de pausa en `cerrar`/`cancelar`, auditoría `SESION_PAUSADA`/`SESION_REANUDADA`); `SessionWriteGuard.java:36-39` + `SesionPausadaException.java:4` (409 `SESION_PAUSADA`, `SESION_NO_ABIERTA`, `SESION_FINALIZADA`); migraciones `20261124000100/200`; tests `SesionAplicacionServiceTest`, `ParticipantRuntimePausaWebTest`, `PausaSesionSchemaIntegrationTest` | `backend-pausa-sesion-prompt.md` |
| B2 | PENDIENTE | **IMPLEMENTADO** | `434fdb6`, `f35da19` | No hay ruta de regeneración en `SessionController.java`; el token solo se emite en `ParticipantRuntimeService.java:81-115` | `backend-sesiones-instrumentos-prompt.md` §B2 |
| B3 | PARCIAL | **IMPLEMENTADO** | `ba6618a` | `POST /sesiones/{id}/incidencias` existe (`SessionController.java:116`) y guarda en `auditoria` con acción `INCIDENCIA_SESION` (`ParticipantRuntimeService.java:267-276`); no hay `GET` | §B3 |
| B4 | PENDIENTE | **IMPLEMENTADO** | `5bd6adc` | `SessionManagementService.java:51-55` devuelve la entidad sin subtests ni nombres | prompt existente §B15.4 + §B4 |
| B5 | DESCARTADO | **DESCARTADO** | — | Opcional; el wizard persistido cubre el flujo | — |
| B6 | **HECHO** | **HECHO (previo)** | — | `SubtestTimingService.java:35-146` (tiempo efectivo descontando pausas, gracia 5 s); `ParticipantRuntimeController.java:64-68` (`startedAt`, `timeLimitSeconds`, `remainingSeconds`, `paused`, `serverNow` al iniciar); `ParticipantEvaluationView.java:137,186-192` (`/yo`: `sessionStatus`, `pausedAt`, timing por subtest); `TiempoAgotadoException`; test `SubtestTimingServiceTest` | `backend-pausa-sesion-prompt.md` §7 |
| B7 | PENDIENTE | **IMPLEMENTADO** | `db8a7ea` | Solo `POST /test-versions/{id}/configuration` (`InstrumentController.java:57`); el builder arma el documento con `clone-template` por subtest | §B7 |
| B8 | PENDIENTE | **IMPLEMENTADO** | `42a8bf6`, `7adeaa9` | Las subidas siempre cuelgan de un ítem/opción (`InstrumentController.java:170-213`); `ImageDraft.resourceId` ya existe en `VersionConfigurationRequest.java:33` | §B8 |
| B9 | PENDIENTE (puente) | **IMPLEMENTADO** | `c2bccba`, `0e17456` | `GET /subtests/{id}/clone-template` (`InstrumentController.java:88`) es el puente del frontend; no hay clonación de versión en el servidor | §B9 |
| B10 | PARCIAL | **IMPLEMENTADO** | `69d0ce8` | `/participantes` pagina sin filtros (`ParticipantController.java:25-30`); `/sesiones` usa `findAll()` (`SessionManagementService.java:47`); `/auditoria` solo filtra con `entity`+`entityId` juntos (`AuditController.java:18-27`) | §B10 |
| B11 | PARCIAL | **IMPLEMENTADO** | `0967e41` | `SessionAssignmentDto.java` documenta los enums, pero `ParticipantRuntimeService.java:278-355` los deriva a mano: asignación `ANULADO` con intento `COMPLETADO` sale `VENCIDO`; token vencido sin intento sale `GENERADO`; un `NO_INICIADO` saldría `no_iniciado` | §B11 |
| B12 | PENDIENTE | **IMPLEMENTADO** | `1950923` | `SecurityPermissions.java:29` (`TEST_LEER` ignora `PERM_TEST_LEER`), `:36` (`SESION_LEER` ignora `PERM_SESION_LEER`); no existe `INSTRUMENTO_CATALOGO_LEER` | `backend-permisos-claves-intentos-prompt.md` §B12 |
| B13 | PENDIENTE | **IMPLEMENTADO** | `22a331f` | `InstrumentAdminService.java:641` ignora `answerKey.status == DELETED` | idem §B13 |
| B14 | PENDIENTE | **IMPLEMENTADO** | `83a06bd` | `ResultController.java` no tiene `GET /attempts` | idem §B14 |
| B15 | PENDIENTE | **IMPLEMENTADO** | `ac260e3`, `2f86f60`, `c49dd35` | `SessionManagementService.java:84-91` solo hace upsert | idem §B15 |
| B16 | PENDIENTE | **IMPLEMENTADO (sin correo)** | `6f2f803` | `ParticipantController.java` sin `PUT` | idem §B16 |
| B17 | PENDIENTE | **IMPLEMENTADO** | `863ffd4` | `ParticipantAnswerService.java:120` devuelve `RECHAZADA` solo en la respuesta del bulk-sync; no se persiste | §B17 |
| B18 | PENDIENTE | **IMPLEMENTADO** | `fcad1ba`, `edb76fb` | `UNIQUE` inmediatos en `supabase/migrations/20260621000100_create_bfa_schema.sql:274,317,347,359,370` | idem §B18 |
| B19 | PENDIENTE | **IMPLEMENTADO** | `84f90e1`, `9920f53` | `ReportController.java` sin `/reports/{id}/file` | idem §B19 |
| B20 | PARCIAL | **IMPLEMENTADO** | `cd2a5c7`, `2b621ce`, `f9d1c6a` | `RecursoMultimedia` ya guarda `nombreArchivo`, `tamanoBytes`, `hashIntegridad` (`InstrumentImageService.java:254`), pero `SubtestCloneTemplateDTO.ImageTemplate` (l. 24) no los expone; sin `Idempotency-Key` | idem §B20 |
| B21 | PENDIENTE | **IMPLEMENTADO** | `eb6411a`, `92e5e0b` | `ParticipantAccessService.java:107-111` responde 409 `ASIGNACION_NO_OPERABLE` también en lectura para `COMPLETADO` | idem §B21 |
| B22 | PENDIENTE | **IMPLEMENTADO** | `e474c8d`, `e109fa8` | `ClaveSimpleScoringService.java:150` solo compara `opcionCorrecta` | idem §B22 |
| B23 | PENDIENTE | **IMPLEMENTADO** | `6e8dd40`, `8d3bfd2`, `3add011`, `0077089`, `55d094e` | `ClaveSimpleScoringService.java:157-160` cuenta pendientes sin crear `RevisionManualRespuesta`; `ManualReviewService.java:63-78` no recalcula el resultado | idem §B23 |

## Dictámenes GPT 6.2

| Prioridad | Ronda | Dictamen | Bloqueantes y corrección |
|---|---|---|---|
| P1 | revisión | CAMBIOS REQUERIDOS | 6: OBSERVADO fuera de la bandeja, ítem pendiente marcado incorrecto, subtest sin recalcular, intentos históricos sin revisiones, clave distinta en el detalle, código reutilizado → 409 (`edb76fb`, `8d3bfd2`, `e109fa8`, `3add011`, `0077089`) |
| P1 | re-check 1 | CAMBIOS REQUERIDOS | 1: la dimensión histórica conservaba el aporte automático (`55d094e`) |
| P1 | re-check 2 | **APROBADO** | — |
| P2 | revisión | CAMBIOS REQUERIDOS | 2: el vencimiento del enlace cortaba un JWT vigente (`f35da19`); el PUT de subtests borraba lo que el wizard promete conservar (`2f86f60`) |
| P2 | re-check 1 | CAMBIOS REQUERIDOS | 1: el wizard reanudado chocaba con la posición de un subtest conservado (`c49dd35`) |
| P2 | re-check 2 | **APROBADO** | — |
| P3 | revisión | CAMBIOS REQUERIDOS | 3: el clon borraba imágenes compartidas (`0e17456`); Idempotency-Key global (`2b621ce`); reintento concurrente → 409 (`7adeaa9`) |
| P3 | re-check 1 | CAMBIOS REQUERIDOS | 1: PUT por ID concurrente → 409/404 (`f9d1c6a`) |
| P3 | re-check 2 | **APROBADO** | — |

Verificación final en `f9d1c6a`: `./mvnw test` 537 tests, 0 fallos (BD limpia con todas las migraciones); `pnpm test` 1367 OK y `pnpm build` OK; migraciones `20261126000100`–`000800` aplicadas a la BD dev y backend arrancado con `ddl-auto=validate`.

Desviaciones respecto de los prompts: B16 sin `correo` (no existe en el modelo); B15 con reemplazo opt-in (`?mode=replace`) para no romper el wizard vigente; B5 descartado.

## Plan de ejecución

Nota: B12 usa `20261126000300` en lugar del `20261125000100` de su prompt. Con este último quedaría fuera de orden respecto de migraciones ya aplicadas.

Cada tarea usa una BD aislada (`mkdb.sh <db> <migrations>`, con `BFA_DB_URL`). Eso permite paralelizar en worktrees las tareas que tocan servicios distintos.

| Prioridad | Tarea | B | Servicio principal | Migración reservada |
|---|---|---|---|---|
| P1 | T1 → T2 (secuencial) | B22 → B23 | `ClaveSimpleScoringService`, `ManualReviewService` | `20261126000200_revision_manual_unica.sql` (si hace falta) |
| P1 | T3 (en paralelo con T1/T2) | B13 + B18 | `InstrumentAdminService` | `20261126000100_orden_deferrable.sql` |
| P2 | T4 | B12 | `SecurityPermissions`, `InstrumentController`/servicio de catálogo | `20261126000300_rbac_catalogo_y_supervision.sql` |
| P2 | T5 | B14 | nuevo `AttemptQueryService` (reporting) | `20261126000400_idx_intento_estado_fin.sql` |
| P2 | T6 | B15 + B4 | `SessionManagementService` | — |
| P2 | T7 | B16 | `ParticipanteService` | — |
| P2 | T8 | B21 + B2 | `ParticipantAccessService`, `ParticipantRuntimeService` | — |
| P2 | T9 | B19 | `ReportRegistryService` | — |
| P3 | T10 | B3 + B17 + B11 | `ParticipantRuntimeService` (monitor), `ParticipantAnswerService` | `20261126000500_respuesta_rechazada.sql` |
| P3 | T11 | B20 + B8 | `InstrumentImageService`, `ItemImageStorageService` | `20261126000600_recurso_clave_subida.sql` |
| P3 | T12 | B7 + B9 | `InstrumentAdminService` (versión) | — |
| P3 | T13 | B10 | `ParticipanteService`, `SessionManagementService`, `AuditLogService` | — |

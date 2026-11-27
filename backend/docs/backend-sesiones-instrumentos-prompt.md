# Tarea backend: sesiones, monitor e instrumentos (B2–B4, B7–B11, B17)

Proyecto: `psycho-form/psychoform` (Spring Boot, JPA, PostgreSQL; migraciones en `psycho-form/supabase/migrations`).
Las redactó el Orquestador a partir de `bfa-digital/docs/refactor/frontend-refactor-plan.md` §6 y del contrato zod de `bfa-digital/src/api/schemas/`.

Reglas comunes:
- Errores con el envelope `ApiResponse.error(code, message)` de `GlobalExceptionHandler`: 400 validación, 403 permiso, 404 no encontrado, 409 conflicto de estado.
- Fechas `LocalDateTime` en UTC sin offset (`conventions-api.md` §10).
- **Los cambios de respuesta son aditivos.** Ningún campo existente cambia de nombre, de tipo ni de semántica. Los schemas del frontend son `.loose()` y toleran campos nuevos.
- B5 (creación compuesta de sesión) queda **descartado**: el wizard persistido ya cubre el flujo.

---

## B2. Regenerar el token de acceso de una asignación

### Problema
El token crudo solo se devuelve al crear la asignación (`ParticipantRuntimeService.assignParticipant`). Si el aplicador lo pierde, porque recargó o cambió de equipo, no hay forma de volver a entregarlo. El frontend no persiste tokens (`SessionAccessTab.tsx:123` muestra «requiere soporte del backend (B2)»).

### Cambios
1. `POST /sesiones/{id}/asignaciones/{assignmentId}/regenerar-token`, `@PreAuthorize(SESION_APLICAR)`. Body opcional `{ "ttlHours": Integer? }` (1–72, por defecto 8, `@Valid`).
2. Respuesta: la misma forma que la asignación, `AssignedParticipant { assignmentId, rawToken, expiresAt }`. El frontend la parsea con `AssignedParticipantWireSchema`.
3. Reglas, dentro de la transacción y con `asignaciones.findByIdForUpdate`:
   - La asignación no existe o pertenece a otra sesión → 404.
   - Sesión `CERRADA` o `CANCELADA` → 409 `SESION_FINALIZADA`.
   - Asignación `ANULADO` o `COMPLETADO` → 409 `ASIGNACION_NO_OPERABLE`.
   - Si no, genera un token nuevo (`tokenService.generateRawToken()` + `hash`), reemplaza `tokenAccesoHash`, fija `tokenExpiraEn = now + ttl`, pone `intentosAcceso = 0` y, si estaba `EXPIRADO`, la devuelve a `ASIGNADO`. El intento en curso **no** se toca.
   - El token anterior deja de validar en `POST /acceso-participante/validar` porque el hash cambió. Las sesiones JWT de participante ya emitidas siguen vigentes hasta su expiración, para no cortar a quien está respondiendo.
4. Auditar con `recordTrusted` la acción `ASIGNACION_TOKEN_REGENERADO` (entidad `asignacion_test`, `{sesionId, expiresAt}`), **sin** el token.

### Tests
- Regenerar → 200; el token viejo da 4xx en `validar` y el nuevo valida.
- Asignación de otra sesión → 404.
- Asignación `COMPLETADO` o `ANULADO` → 409 `ASIGNACION_NO_OPERABLE`.
- Sesión `CERRADA` → 409 `SESION_FINALIZADA`.
- Asignación `EXPIRADO` → vuelve a `ASIGNADO`.
- Sin `SESION_APLICAR` (p. ej. Psicólogo con `SESION_LEER`) → 403.

---

## B3. Listar las incidencias de una sesión

### Problema
`POST /sesiones/{id}/incidencias` guarda la incidencia como fila de `auditoria` (acción `INCIDENCIA_SESION`, entidad `sesion_aplicacion`), pero no hay lectura. La bitácora del detalle (`incidenceLog.tsx`) vive solo en memoria y se pierde al salir.

### Cambios
1. `GET /sesiones/{id}/incidencias`, `@PreAuthorize(SESION_LEER)`. Si la sesión no existe → 404.
2. Respuesta: `[{ id, participantId, participantName, text, recordedAt, recordedBy }]`, ordenada por `recordedAt` ascendente.
   - `id`: `auditoria_id`. `recordedAt`: `creado_en`. `recordedBy`: nombre del usuario que registró, o null.
   - `participantId` y `text` salen del JSON `valor_nuevo` (parsear con `ObjectMapper`). `participantName` es null si el participante ya no existe.
   - Sin N+1: una query por sesión y una carga en lote de los participantes.
3. Endurecer el `POST`: construir `valor_nuevo` con `ObjectMapper` en lugar del escape manual (`json(...)`). Validar `text` no vacío (≤ 1000) → 400, y que `participantId`, si viene, esté asignado a la sesión → 400.

### Tests
- Registrar 2 incidencias y listarlas → 2, en orden, con texto, participante y autor.
- Texto con comillas, barras y saltos de línea → se guarda y se lee igual.
- Sesión inexistente → 404. Consultor sin `SESION_LEER` → 403.

---

## B4. Detalle de sesión con subtests y nombres

### Problema
`GET /sesiones/{id}` devuelve la entidad sin la configuración de `sesion_subtest` ni el nombre del test y de la versión. Al reanudar el wizard se pierde la configuración guardada, y el detalle muestra «Versión #id».

### Cambios
Se implementa junto con B15 (mismo servicio). Solo en `GET /sesiones/{id}`, no en la lista, para evitar N+1. Se agregan al `EntityView` actual:
- `testId`, `testName` (`TestPsicologico.nombre…`) y `versionNumber` (`VersionTest.numeroVersion`).
- `subtests: [{ subtestId, code, name, order, timeLimitSeconds, randomizeItems, randomizeOptions }]`, ordenados por `order`. `timeLimitSeconds` es el de `sesion_subtest`; si es null, el del subtest.

### Tests
- Detalle con 2 subtests configurados → los 2, ordenados, con código y nombre.
- Sesión sin subtests → `subtests: []`.
- La lista `GET /sesiones` no cambia de forma.

---

## B7. Documento de configuración de una versión en un request

### Problema
El builder arma el documento con `GET /test-versions/{id}/subtests` y un `GET /subtests/{id}/clone-template` por subtest: N+1 requests y lecturas no atómicas.

### Cambios
1. `GET /test-versions/{id}/configuration`, `@PreAuthorize(TEST_LEER)` (el mismo guard que `clone-template`, porque incluye claves).
2. Respuesta: `{ version: <EntityView de VersionTest>, subtests: SubtestCloneTemplateDTO[] }`, con los subtests ordenados por `order` y la misma forma que hoy devuelve `clone-template`, incluidos los campos de B20 si ya existen. Los `source*Id` son los ids reales, para que el frontend reutilice su adaptador.
3. Lectura en una transacción `readOnly` y con consultas en lote por versión (subtests, ítems, opciones, imágenes, claves), sin N+1. Extraer el armado de `clone-template` a un método común para no duplicarlo.
4. Versión inexistente → 404.

### Tests
- Versión con 2 subtests, ítems, opciones, imágenes y claves → el documento completo, igual al de `clone-template` por subtest.
- Versión inexistente → 404. Aplicador (solo catálogo) → 403.

---

## B8. Subida de imagen como recurso suelto

### Problema
Cada subida cuelga de un ítem o una opción ya persistidos. Un ítem nuevo con imagen obliga a guardar primero el ítem y después subir, en dos pasos no atómicos. `ImageDraft.resourceId` ya existe en `/configuration`, pero no hay cómo obtener un `resourceId` sin vincularlo.

### Cambios
Se implementa junto con B20 (mismo servicio de imágenes).
1. `POST /images/resources` (multipart: `file`, `altText?`), `@PreAuthorize(TEST_CREAR)`, con el header opcional `Idempotency-Key` (B20).
2. Mismas validaciones que las subidas actuales (tipo MIME, tamaño). Guarda solo `RecursoMultimedia`, sin `ImagenItem` ni `ImagenOpcion`.
3. Respuesta: `{ resourceId, storagePath, mimeType, originalFileName, sizeBytes, sha256, uploadKey }`.
4. `/configuration` ya acepta `ImageDraft{status: CREATED, resourceId}`. Verificar con un test que vincula un recurso suelto a un ítem nuevo en el mismo request. Si `resourceId` no existe → 400 en lugar de 404/500.
5. La limpieza de recursos huérfanos queda fuera de alcance (anotarlo).

### Tests
- Subir un recurso suelto → 200 con `resourceId`; no se crea `ImagenItem`.
- `/configuration` con un ítem nuevo y una imagen `CREATED` con ese `resourceId` → queda vinculada.
- Tipo no permitido → 400. Sin `TEST_CREAR` → 403. Repetir con la misma `Idempotency-Key` → mismo `resourceId`.

---

## B9. Clonar una versión en el servidor

### Problema
Hoy el frontend clona leyendo `clone-template` de cada subtest y reenviando todo a `/configuration` de una versión nueva. Si falla a mitad de camino, queda una versión incompleta.

### Cambios
1. `POST /test-versions/{id}/clone`, `@PreAuthorize(TEST_CREAR)`. Body `{ "versionNumber": String }` (obligatorio, único por test → 409 si se repite).
2. En **una** transacción crea una `VersionTest` nueva en `BORRADOR` del mismo test, con `creadoPor`/`creadoEn` del actor actual, los mismos campos generales y la misma estrategia de calificación. Copia en profundidad subtests, ítems, opciones, imágenes (filas nuevas que **reutilizan** el mismo `RecursoMultimedia`), claves de respuesta y reglas de calificación de esos subtests, remapeando `opcionCorrecta` a la opción copiada. Los baremos solo se copian si su modelo lo permite sin ambigüedad; si no, se anota.
3. El origen puede estar en cualquier estado. Si no existe → 404.
4. Respuesta: el `EntityView` de la versión nueva, igual que `POST /tests/{id}/versions`.
5. Cualquier excepción → rollback completo. No debe quedar una versión parcial.

### Tests
- Clonar una versión publicada → `BORRADOR` nueva con los mismos conteos de subtests, ítems, opciones, imágenes y claves, y `opcionCorrecta` apuntando a opciones de la copia.
- `GET /test-versions/{nueva}/configuration` (B7) equivale al origen salvo los ids.
- `versionNumber` repetido → 409, sin filas nuevas.
- Sin `TEST_CREAR` → 403.

---

## B10. Paginación y filtros en `/participantes`, `/sesiones` y `/auditoria`

### Problema
El frontend recorre todas las páginas de `/participantes` y filtra en cliente (`wizard-queries.ts:20`, `AddParticipantsDialog.tsx:80`). `/sesiones` usa `findAll()`. `/auditoria` solo filtra si llegan `entity` y `entityId` juntos (`audit-page.tsx:47`).

### Cambios (compatibles)
1. `GET /participantes` (ya devuelve `PageResponse`): agregar filtros opcionales `q` (ILIKE sobre código, nombres, apellidos y correo), `estado`, `carreraId`, `cohorteId`, `grupoAcademicoId` y `sort` (por defecto `apellidos,asc`; lista blanca de campos). `size` máx. 100.
2. `GET /sesiones`: filtros opcionales `estado`, `versionTestId`, `q` (código o nombre), `from`/`to` (sobre `inicioProgramado`). **Sin `page`, la respuesta sigue siendo un array**, como hoy. Con `page` (y `size`, por defecto 20, máx. 100), devuelve `PageResponse`. Orden por defecto `inicioProgramado,desc`.
3. `GET /auditoria`: filtros opcionales e independientes `entity`, `entityId`, `action`, `userId`, `from`/`to`. Sin `page`, array (compatible). Con `page`, `PageResponse` ordenado por `creadoEn,desc`.
4. Implementar con `Specification` o JPQL con parámetros, nunca concatenando strings. Validar `sort` contra la lista blanca → 400.

### Tests
- Cada filtro por separado y combinados. `q` sin distinguir mayúsculas.
- `/sesiones` y `/auditoria` sin `page` → array con la forma actual; con `page` → `PageResponse` con `totalElements` correcto.
- `sort` no permitido → 400. `size=500` → se limita a 100.

---

## B11. Enums coherentes en `SessionAssignmentDto`

### Problema
`getAssignmentsForSession` deriva `status` (enlace) y `state` (intento) con condicionales sueltos:
- Asignación `ANULADO` con intento `COMPLETADO` (revocar no anula un intento completado) → `status = VENCIDO` en lugar de `REVOCADO`.
- Token vencido sin intento → `GENERADO`, porque `EXPIRADO` solo se marca al intentar acceder.
- `state` es `estado.toLowerCase()`: un `NO_INICIADO` saldría `no_iniciado`, fuera del contrato.

### Cambios (compatibles: mismos campos y mismos valores posibles)
1. Extraer una función pura `AssignmentStatusMapper` (estática y testeable) que reciba `EstadoAsignacion`, `tokenExpiraEn`, el intento (nullable) y `now`:
   - `status` ∈ `GENERADO|ACTIVO|VENCIDO|REVOCADO`: `ANULADO` → `REVOCADO` (siempre gana); intento `EN_PROGRESO`/`INTERRUMPIDO` → `ACTIVO`; intento `COMPLETADO`, asignación `COMPLETADO`/`EXPIRADO` o token vencido → `VENCIDO`; si no → `GENERADO`.
   - `state` ∈ `no-iniciado|en-progreso|completado|interrumpido|anulado`, por mapeo explícito de `EstadoIntento` (`NO_INICIADO`→`no-iniciado`, …). Sin intento: `anulado` si la asignación es `ANULADO`; si no, `no-iniciado`.
2. Campos **aditivos** con los nombres canónicos del backend: `assignmentStatus` (`EstadoAsignacion.name()`) y `attemptStatus` (`EstadoIntento.name()` o null).
3. No cambiar `lastActivity` ni `tokenExpiraEn` (el frontend ya normaliza el centinela `"Nunca"`).

### Tests
- Tabla parametrizada con todas las combinaciones de estado de asignación × intento (incluidos null y token vencido) → `status`/`state` esperados y siempre dentro de los conjuntos documentados.
- `GET /sesiones/{id}/asignaciones` incluye `assignmentStatus` y `attemptStatus`.

---

## B17. Rechazos de respuestas visibles en el monitor

### Problema
`ParticipantAnswerService.bulkSyncAnswers` devuelve `RECHAZADA` por ítem (p. ej. `TIEMPO_AGOTADO`, tipo incompatible, ítem inexistente) solo en la respuesta al participante. No se persisten ni llegan al staff.

### Cambios
1. Migración `20261126000500_respuesta_rechazada.sql` (idempotente):
   ```sql
   CREATE TABLE IF NOT EXISTS respuesta_rechazada (
     respuesta_rechazada_id BIGSERIAL PRIMARY KEY,
     intento_id BIGINT NOT NULL REFERENCES intento_test(intento_id) ON DELETE CASCADE,
     item_id BIGINT NOT NULL,
     codigo VARCHAR(60) NOT NULL,
     rechazado_en TIMESTAMP NOT NULL,
     veces INTEGER NOT NULL DEFAULT 1,
     CONSTRAINT uq_respuesta_rechazada UNIQUE (intento_id, item_id, codigo)
   );
   ```
   Verificar los nombres reales de la PK y la FK de `intento_test` en el schema. `item_id` sin FK porque puede ser un ítem inexistente. Actualizar `recrear_postgresql.sql` si refleja el schema completo.
2. Entidad `RespuestaRechazada` + repositorio, registrados donde lo exijan `DomainEntityRegistryTest` y `FullDomainMappingTest`.
3. En `bulkSyncAnswers`, por cada `RECHAZADA` hacer upsert (`veces + 1`, `rechazado_en = now`) en la misma transacción del lote, que no aborta. Una respuesta luego `GUARDADA` para el mismo ítem **no** borra el rechazo: es bitácora.
4. `SessionAssignmentDto` + `rejectedAnswersCount` (Integer, filas distintas) y `rejectedAnswers: [{ itemId, code, rejectedAt }]` (como máximo 20, las más recientes). Se cargan con una query por sesión, sin N+1.

### Tests
- Bulk-sync con 1 rechazo y 1 guardada → 1 fila; repetir el mismo rechazo → sigue 1 fila con `veces = 2`.
- `GET /sesiones/{id}/asignaciones` → `rejectedAnswersCount = 1` y `rejectedAnswers[0].code` correcto. Una asignación sin rechazos → `0` y `[]`.
- `SchemaValidationIntegrationTest` en verde.

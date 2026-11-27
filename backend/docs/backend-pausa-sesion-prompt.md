# Tarea backend: pausa y reanudación de sesiones de aplicación

Proyecto: `psycho-form/psychoform` (Spring Boot, JPA, PostgreSQL vía migraciones en `psycho-form/supabase/migrations`).
Objetivo: permitir que el aplicador **pause** una sesión ABIERTA y la **reanude**, congelando el tiempo de los subtests en curso, sin perder respuestas. Hoy no existe: el frontend usaba `/cancelar` como "pausa", y eso deja la sesión en CANCELADA, que es un estado terminal.

## 1. Máquina de estados resultante

```
PROGRAMADA --activar--> ABIERTA --pausar--> PAUSADA --reanudar--> ABIERTA
ABIERTA | PAUSADA --cerrar--> CERRADA      (terminal)
PROGRAMADA | ABIERTA | PAUSADA --cancelar--> CANCELADA   (terminal)
```
Cualquier otra transición → 409.

## 2. Base de datos (migración nueva: `20261124000100_pausa_sesion.sql`)

1. `ALTER TYPE estado_sesion_aplicacion ADD VALUE IF NOT EXISTS 'PAUSADA' AFTER 'ABIERTA';`
   Va en una migración **propia**, sin usar el valor en la misma transacción. Lo siguiente va en `20261124000200_pausa_sesion_tabla.sql`.
2. Tabla de historial de pausas:
   ```sql
   CREATE TABLE pausa_sesion (
     pausa_sesion_id BIGSERIAL PRIMARY KEY,
     sesion_aplicacion_id BIGINT NOT NULL REFERENCES sesion_aplicacion(sesion_aplicacion_id) ON DELETE CASCADE,
     pausado_en TIMESTAMP NOT NULL,
     reanudado_en TIMESTAMP,
     pausado_por UUID REFERENCES usuario(usuario_id),
     reanudado_por UUID REFERENCES usuario(usuario_id),
     motivo VARCHAR(300),
     CONSTRAINT ck_pausa_fechas CHECK (reanudado_en IS NULL OR reanudado_en >= pausado_en)
   );
   CREATE INDEX idx_pausa_sesion_sesion ON pausa_sesion(sesion_aplicacion_id);
   -- como máximo una pausa abierta por sesión
   CREATE UNIQUE INDEX ux_pausa_sesion_abierta ON pausa_sesion(sesion_aplicacion_id) WHERE reanudado_en IS NULL;
   ```
3. Actualizar `recrear_postgresql.sql` (y `seed.sql`, si enumera estados) para que reflejen ambos cambios.
4. Revisar `20261122000200_integridad_dominio.sql`: si algún trigger o función compara estados de sesión (`'ABIERTA'`), tratar `PAUSADA` igual que `ABIERTA` en todo lo que **no** sea escribir respuestas.

## 3. Modelo JPA

- `EstadoSesionAplicacion`: agregar `PAUSADA` (orden: `PROGRAMADA, ABIERTA, PAUSADA, CERRADA, CANCELADA`).
- Nueva entidad `assessment/model/PausaSesion` + `assessment/repository/PausaSesionRepository` con:
  - `Optional<PausaSesion> findFirstBySesionAplicacionIdAndReanudadoEnIsNull(Long sesionId)`
  - `List<PausaSesion> findBySesionAplicacionIdOrderByPausadoEnAsc(Long sesionId)`
- Registrar la entidad donde lo exijan `DomainEntityRegistryTest` y `FullDomainMappingTest`.
- Aprovechar para poblar `sesion_aplicacion.inicio_real` en `abrir` (si es null) y `fin_real` en `cerrar` y `cancelar`. Hoy nunca se setean.

## 4. Servicio de ciclo de vida (`SesionAplicacionService`)

- `pausar(Long sesionId, String motivo)`: requiere ABIERTA → PAUSADA, crea `PausaSesion(pausadoEn=now, pausadoPor=actor, motivo)`.
- `reanudar(Long sesionId)`: requiere PAUSADA → ABIERTA, cierra la pausa abierta (`reanudadoEn=now, reanudadoPor=actor`).
- `cerrar`: aceptar origen ABIERTA **o** PAUSADA. Si estaba PAUSADA, cerrar la pausa abierta con `reanudadoEn=now`.
- `cancelar`: si estaba PAUSADA, cerrar la pausa abierta igual que en `cerrar`.
- Todas con `@PreAuthorize(SecurityPermissions.SESION_APLICAR)`, `@Transactional` y bloqueo `findByIdForUpdate` (como hoy).
- Auditar con `AuditLogService.recordTrusted` los eventos `SESION_PAUSADA` y `SESION_REANUDADA` (entidad `sesion_aplicacion`, incluir el motivo).
- Usar `Clock` inyectado (como `ParticipantRuntimeService`) para que sea testeable.

## 5. Endpoints (`SessionController`)

| Método | Ruta | Body | Respuesta |
|---|---|---|---|
| POST | `/sesiones/{id}/pausar` | `{ "motivo": string? (≤300) }` | sesión actualizada (mismo `EntityView` que `/activar`) |
| POST | `/sesiones/{id}/reanudar` | — | sesión actualizada |
| GET | `/sesiones/{id}/pausas` | — | `[{ id, pausadoEn, reanudadoEn, pausadoPor, motivo }]` (permiso `SESION_LEER`) |

La vista de sesión (lista y detalle) debe exponer `estado` (incluido `PAUSADA`) y `pausadoEn` (inicio de la pausa abierta, o null).

## 6. Efecto sobre el participante (`ParticipantAccessService`, `ParticipantRuntimeService`, `ParticipantRuntimeController`)

Regla: **con la sesión PAUSADA, el participante puede leer pero no escribir.**

1. `grantParticipantAccess` (`POST /acceso-participante/validar`): aceptar ABIERTA **o** PAUSADA, para que el participante pueda entrar y ver la pantalla "sesión pausada".
2. Separar `validateRuntimeAccess` en dos:
   - `validateRuntimeRead(...)`: permite ABIERTA y PAUSADA. La usa `GET /evaluacion-participante/yo` y `GET /intentos/{a}/subtests/{s}/items`.
   - `validateRuntimeWrite(...)`: permite solo ABIERTA. La usan `iniciar` intento, `iniciar`/`finalizar` subtest, `PUT respuesta`, `bulk-sync` y `finalizar` intento.
3. Con PAUSADA, las escrituras lanzan una excepción nueva `SesionPausadaException`, que `GlobalExceptionHandler` mapea a **HTTP 409** con `ApiResponse.error("SESION_PAUSADA", "La sesión está pausada por el aplicador")`. El código `SESION_PAUSADA` es contrato: el frontend lo usa para mostrar la pantalla de pausa y reencolar respuestas.
4. Para distinguir el resto de los casos en el frontend, usar también códigos específicos en lugar del genérico `CONFLICT`: `SESION_NO_ABIERTA` (PROGRAMADA), `SESION_FINALIZADA` (CERRADA/CANCELADA), `TOKEN_EXPIRADO`, `ASIGNACION_NO_OPERABLE`.

## 7. Tiempo congelado durante la pausa (imprescindible)

El tiempo de un subtest en curso **no debe correr** mientras la sesión está pausada.

- Definir en un servicio (p. ej. `SubtestTimingService`):
  ```
  segundosPausados(sesionId, desde, hasta) = Σ overlap([pausadoEn, coalesce(reanudadoEn, hasta)], [desde, hasta])
  transcurridoEfectivo(intentoSubtest, now) = (now - iniciadoEn) - segundosPausados(sesion, iniciadoEn, now)
  restante = max(0, tiempoLimiteSegundos(sesion_subtest) - transcurridoEfectivo)   // null si no hay límite
  ```
- Exponer por subtest, en `GET /evaluacion-participante/yo` (`SubtestPayload`) y en la respuesta de `POST /intentos/{a}/subtests/{s}/iniciar`:
  `startedAt` (ISO), `timeLimitSeconds`, `remainingSeconds`, `paused` (boolean), `serverNow` (ISO).
  En el nivel raíz de `/yo`: `sessionStatus` (ya existe, ahora puede ser `PAUSADA`) y `pausedAt`.
- `finishSubtest`: calcular y guardar `tiempo_usado_segundos = min(transcurridoEfectivo, límite)` en el servidor. Ignorar el valor que manda el cliente o usarlo solo como dato informativo.
- Respuestas fuera de tiempo: si `restante == 0` (más una gracia de 5 s), rechazar `PUT respuesta` con 409 `TIEMPO_AGOTADO` y permitir solo `finalizar` subtest.

## 8. Monitor del aplicador

- `GET /sesiones/{id}/asignaciones` (`SessionAssignmentDto`): sin cambios de forma, pero `state` y `lastActivity` deben seguir siendo correctos durante la pausa. No marcar como `interrumpido` a quienes estén inactivos por la pausa.

## 9. Tests obligatorios

- Unit/servicio: todas las transiciones válidas e inválidas de §1, incluido doble `pausar` (409) y `reanudar` sin pausa (409).
- Unicidad: no puede haber dos pausas abiertas (índice parcial).
- Runtime: con PAUSADA, `/yo` y `GET items` → 200; `PUT respuesta`, `bulk-sync`, `iniciar`/`finalizar` subtest y `finalizar` intento → 409 `SESION_PAUSADA`.
- Timing con `Clock` fijo: subtest de 600 s iniciado a t0, pausa de t0+100 a t0+400, consulta en t0+500 → `remainingSeconds = 400`. Pausa iniciada **antes** de `iniciadoEn` y pausa todavía abierta (overlap parcial).
- `cerrar` desde PAUSADA cierra la pausa abierta.
- `SchemaValidationIntegrationTest` en verde con las migraciones nuevas.

## 10. Fuera de alcance

- Pausa por participante individual (solo por sesión completa).
- WebSockets/SSE: el frontend hace polling de `/yo` cada 5 s durante la pausa.

## Contrato que consumirá el frontend (resumen)

```
POST /sesiones/{id}/pausar   { motivo? }      -> Session
POST /sesiones/{id}/reanudar                  -> Session
GET  /sesiones/{id}/pausas                    -> Pausa[]
Session.estado ∈ PROGRAMADA|ABIERTA|PAUSADA|CERRADA|CANCELADA ; Session.pausadoEn?
/yo: sessionStatus, pausedAt?, subtests[].{startedAt?, timeLimitSeconds?, remainingSeconds?, paused, serverNow}
Errores 409 code: SESION_PAUSADA | SESION_NO_ABIERTA | SESION_FINALIZADA | TIEMPO_AGOTADO | TOKEN_EXPIRADO | ASIGNACION_NO_OPERABLE
```
Al terminar, reportar los archivos modificados, las migraciones creadas y el resultado de `./mvnw test`.

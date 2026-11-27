# Convenciones F-05: schemas y endpoints tipados

Las fija el orquestador. Son obligatorias para todas las instancias del enjambre.

## Archivos por dominio `<d>`
- `src/api/schemas/<d>.ts`: schemas zod 4 del **wire** (JSON tal como lo devuelve el backend) y transform al **modelo de dominio** del frontend.
- `src/api/endpoints/<d>.ts`: funciones async puras que llaman a la API. No usan hooks ni stores.
- `src/api/schemas/__fixtures__/<d>/*.json`: fixtures reales. Se obtienen leyendo los DTO, records y `EntityView` del backend en `psycho-form/psychoform/src/main/java/com/uam/psychoform/**`. **Nunca inventes campos**: si no puedes determinar la forma real, márcalo en `bloqueos_o_dudas`.
- `src/api/endpoints/<d>.test.ts`: tests vitest con MSW (`src/test/msw/server.ts`; usa `server.use(...)` dentro del test) que cubren parseo OK, parseo con campo desconocido (se tolera) y error del envelope.

## Reglas
1. Cliente: `import { staffClient, participantClient } from "../client"`. Errores: `import { ApiError, unwrap } from "../errors"`. Patrón:
   ```ts
   export async function listSessions(): Promise<Session[]> {
     const res = await staffClient.get<ApiEnvelope<unknown>>("/sesiones");
     return parseOrThrow(SessionListWire, unwrap(res), "GET /sesiones");
   }
   ```
2. `parseOrThrow(schema, data, ctx)` vive en `src/api/schemas/parse.ts`. Si la falla de parseo lanza `ApiError({ status: 0, code: "CONTRACT_MISMATCH", message })` con `console.error` del issue en DEV. **Ya existe** (lo escribió el orquestador). Impórtalo con `import { parseOrThrow } from "../schemas/parse"` y no lo modifiques.
3. Wire: los objetos usan `z.object({...}).passthrough()` o `.loose()` (zod 4) para tolerar campos extra. Los enums de estado incluyen `"DESCONOCIDO"` como miembro y usan fallback: `z.enum([..., "DESCONOCIDO"]).catch("DESCONOCIDO")`. Sin ese miembro no compila en zod 4. Se aplica **solo** a campos de estado.
4. Dominio: camelCase en inglés, IDs **number** (o string UUID para participante y usuario), fechas como `string` ISO (no `Date`) y sin `any`. Exporta los tipos con `export type X = z.output<typeof XSchema>`.
5. Enums canónicos (del backend, no inventar):
   - Sesión: `PROGRAMADA | ABIERTA | PAUSADA | CERRADA | CANCELADA` (PAUSADA llega con la spec de backend en curso; inclúyela igual).
   - Asignación: el backend manda `status` con `GENERADO|ACTIVO|VENCIDO|REVOCADO` y `state` con `no-iniciado|en-progreso|completado|interrumpido|anulado` (ver `SessionAssignmentDto`). Modela ambos tal cual, como `linkStatus` y `attemptState`.
   - Intento/subtest: `NO_INICIADO | EN_PROGRESO | COMPLETADO | INTERRUMPIDO | ANULADO`.
   - Versión: `BORRADOR | EN_REVISION | APROBADO | PUBLICADO | RETIRADO` (fuente: `EstadoVersionTest.java`; el `types.ts` legacy está mal).
6. (Histórico, F-05) Los servicios legacy (`*Service.ts`, `participantMappers.ts`) y las pantallas viejas se eliminaron en F-06; `types.ts` conserva solo los DTOs de auth.
7. Cada instancia toca **solo** sus archivos `<d>`. Prohibido editar `client.ts`, `errors.ts`, `package.json` o configs.
8. ESLint estricto aplica a `src/api/schemas/**` y `src/api/endpoints/**` (sin `any` ni vars sin usar). Verifica con `npx eslint src/api/schemas/<d>.ts src/api/endpoints/<d>.ts` y `npx vitest run src/api/endpoints/<d>.test.ts`. El typecheck global (`npm run typecheck`) debe seguir en verde.
9. Query keys: el prefijo `runtime` (p. ej. `['runtime', 'evaluation', assignmentId]`) está reservado para los datos del participante. `resetAccountScopedState` (logout/401/cambio de cuenta de staff) elimina todas las queries y mutations cuya key NO empiece por `runtime`; nunca uses ese prefijo para datos de staff.

## 10. Fechas y horas del backend (UTC sin zona)
- El backend usa `Clock.systemUTC()` y `LocalDateTime`. Toda fecha y hora **sin offset** que viaja en la API es **hora de pared UTC**.
- **Lectura:** usar el schema `serverDateTime` de `src/api/schemas/datetime.ts`. Si el string no trae offset, le agrega `Z` y lo normaliza a ISO con zona. El código de UI nunca hace `new Date(stringDelBackend)` sobre un valor crudo.
- **Escritura:** `toServerDateTime(date)` devuelve `YYYY-MM-DDTHH:mm:ss` en UTC, sin `Z`. Los `<input type="datetime-local">` se interpretan en la zona del navegador y se convierten con esta función antes de enviarse.
- **Mostrar:** siempre en la zona local del navegador, con los formatters existentes.

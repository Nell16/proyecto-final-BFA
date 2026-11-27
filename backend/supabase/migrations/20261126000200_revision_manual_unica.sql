-- B23: una sola revision manual por respuesta.
-- La calificacion crea la revision PENDIENTE de cada respuesta con revision manual y debe ser idempotente
-- al recalificar. UNIQUE (respuesta_id, regla_calificacion_id) no lo garantiza cuando regla_calificacion_id
-- es NULL (revisiones creadas a mano), por eso se agrega un indice unico solo por respuesta.

-- Deduplica antes de crear el indice: conserva una fila por respuesta, prefiriendo la ya REVISADO y,
-- despues, la mas reciente. Las filas de revision_rubrica_respuesta de las eliminadas caen en cascada.
DELETE FROM revision_manual_respuesta r
USING (
    SELECT revision_manual_respuesta_id,
           ROW_NUMBER() OVER (
               PARTITION BY respuesta_id
               ORDER BY (estado = 'REVISADO') DESC, creado_en DESC, revision_manual_respuesta_id DESC
           ) AS posicion
    FROM revision_manual_respuesta
) d
WHERE r.revision_manual_respuesta_id = d.revision_manual_respuesta_id
  AND d.posicion > 1;

CREATE UNIQUE INDEX IF NOT EXISTS ux_revision_manual_respuesta_unica
    ON revision_manual_respuesta(respuesta_id);

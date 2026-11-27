-- B23: backfill de revisiones manuales de intentos ya calificados.
-- Los resultados calificados antes de B23 tienen calificaciones pendientes de revision manual
-- (calificacion_respuesta.requiere_revision_manual = TRUE) sin fila en revision_manual_respuesta, asi que nunca
-- entraban en la bandeja y la interfaz oculta recalificar. Se crea una revision PENDIENTE por cada respuesta en esa
-- situacion. Idempotente: no toca respuestas que ya tienen revision (en cualquier estado) y es compatible con el
-- indice unico ux_revision_manual_respuesta_unica (una revision por respuesta).
INSERT INTO revision_manual_respuesta (respuesta_id, regla_calificacion_id, estado, creado_en)
SELECT DISTINCT ON (c.respuesta_id)
       c.respuesta_id,
       c.regla_calificacion_id,
       'PENDIENTE',
       CURRENT_TIMESTAMP
FROM calificacion_respuesta c
WHERE c.requiere_revision_manual = TRUE
  AND NOT EXISTS (
      SELECT 1
      FROM revision_manual_respuesta rm
      WHERE rm.respuesta_id = c.respuesta_id
  )
ORDER BY c.respuesta_id, c.calificacion_respuesta_id DESC;

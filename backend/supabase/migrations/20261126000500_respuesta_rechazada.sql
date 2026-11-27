-- B17: bitacora de respuestas rechazadas por bulk-sync (TIEMPO_AGOTADO, tipo incompatible, item inexistente...).
-- Hasta ahora solo se devolvian al participante; con esta tabla el monitor de sesion las muestra al staff.
-- Una fila por (intento, item, codigo): repetir el mismo rechazo incrementa "veces" (upsert ON CONFLICT en el
-- backend). La UNIQUE NO es DEFERRABLE porque ON CONFLICT no admite restricciones diferibles. item_id no tiene FK
-- porque el rechazo puede ser, justamente, por un item inexistente. Idempotente.
CREATE TABLE IF NOT EXISTS respuesta_rechazada (
    respuesta_rechazada_id BIGSERIAL PRIMARY KEY,
    intento_id BIGINT NOT NULL REFERENCES intento_test(intento_id) ON DELETE CASCADE,
    item_id BIGINT NOT NULL,
    codigo VARCHAR(60) NOT NULL,
    rechazado_en TIMESTAMP NOT NULL,
    veces INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_respuesta_rechazada UNIQUE (intento_id, item_id, codigo)
);

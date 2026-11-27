-- B14: indice compuesto para filtrar y ordenar intentos por estado y fecha de finalizacion.
CREATE INDEX IF NOT EXISTS idx_intento_estado_fin
    ON intento_test(estado, finalizado_en);

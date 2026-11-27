-- Pausa y reanudacion de sesiones de aplicacion (2/2): historial de pausas.
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

-- Como maximo una pausa abierta por sesion.
CREATE UNIQUE INDEX ux_pausa_sesion_abierta ON pausa_sesion(sesion_aplicacion_id) WHERE reanudado_en IS NULL;

COMMENT ON TABLE pausa_sesion IS
'Historial de pausas de una sesion de aplicacion. Una fila con reanudado_en NULL es la pausa en curso.';

-- Una pausa no cambia de sesion, inicio, autor ni motivo; solo se cierra
-- (reanudado_en / reanudado_por). Mismo patron que 20261122000200_integridad_dominio.sql.
CREATE TRIGGER tg_pausa_sesion_columnas_fijas BEFORE UPDATE ON pausa_sesion
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_columnas_fijas('sesion_aplicacion_id', 'pausado_en', 'pausado_por', 'motivo');

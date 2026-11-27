-- ============================================================
-- DIAGNOSTICO DE INTEGRIDAD DEL DOMINIO DE APLICACION
-- ============================================================
-- Migracion solo aditiva: crea funciones auxiliares y una vista de diagnostico.
-- No modifica ni borra datos. La migracion siguiente
-- (20261122000200_integridad_dominio.sql) invoca fn_bfa_prevalidar_integridad()
-- y se detiene si encuentra datos historicos incompatibles; esta vista queda
-- disponible para revisarlos y corregirlos manualmente antes de reintentar.

-- ============================================================
-- FUNCIONES AUXILIARES DE ALCANCE
-- ============================================================

CREATE OR REPLACE FUNCTION fn_bfa_version_de_item(p_item_id BIGINT)
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
    SELECT s.version_test_id
    FROM item i
    JOIN subtest s ON s.subtest_id = i.subtest_id
    WHERE i.item_id = p_item_id
$$;

CREATE OR REPLACE FUNCTION fn_bfa_sesion_de_intento(p_intento_id BIGINT)
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
    SELECT a.sesion_aplicacion_id
    FROM intento_test it
    JOIN asignacion_test a ON a.asignacion_id = it.asignacion_id
    WHERE it.intento_id = p_intento_id
$$;

CREATE OR REPLACE FUNCTION fn_bfa_version_de_intento(p_intento_id BIGINT)
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
    SELECT sa.version_test_id
    FROM intento_test it
    JOIN asignacion_test a ON a.asignacion_id = it.asignacion_id
    JOIN sesion_aplicacion sa ON sa.sesion_aplicacion_id = a.sesion_aplicacion_id
    WHERE it.intento_id = p_intento_id
$$;

-- Un alcance de configuracion (version obligatoria, subtest e item opcionales)
-- cubre un item cuando el item pertenece a la version y, si se informan,
-- al subtest y al item indicados. Es la regla comun para reglas y rubricas.
CREATE OR REPLACE FUNCTION fn_bfa_alcance_cubre_item(
    p_version_test_id BIGINT,
    p_subtest_id BIGINT,
    p_item_id BIGINT,
    p_item_objetivo_id BIGINT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM item i
        JOIN subtest s ON s.subtest_id = i.subtest_id
        WHERE i.item_id = p_item_objetivo_id
          AND s.version_test_id = p_version_test_id
          AND (p_subtest_id IS NULL OR i.subtest_id = p_subtest_id)
          AND (p_item_id IS NULL OR i.item_id = p_item_id)
    )
$$;

CREATE OR REPLACE FUNCTION fn_bfa_regla_cubre_item(p_regla_calificacion_id BIGINT, p_item_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM regla_calificacion r
        WHERE r.regla_calificacion_id = p_regla_calificacion_id
          AND fn_bfa_alcance_cubre_item(r.version_test_id, r.subtest_id, r.item_id, p_item_id)
    )
$$;

CREATE OR REPLACE FUNCTION fn_bfa_criterio_cubre_item(p_criterio_rubrica_id BIGINT, p_item_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM criterio_rubrica c
        JOIN rubrica_evaluacion ru ON ru.rubrica_id = c.rubrica_id
        WHERE c.criterio_rubrica_id = p_criterio_rubrica_id
          AND fn_bfa_alcance_cubre_item(ru.version_test_id, ru.subtest_id, ru.item_id, p_item_id)
    )
$$;

-- Compatibilidad del almacenamiento de una respuesta con el tipo de respuesta
-- del item. Devuelve NULL si es valida o el motivo del problema.
-- Una respuesta vacia (sin texto, numero ni selecciones) siempre es valida.
-- El texto en blanco ('' o espacios) se trata como ausencia de texto para no
-- rechazar clientes que envian cadenas vacias en items de seleccion.
CREATE OR REPLACE FUNCTION fn_bfa_problema_respuesta(p_respuesta_id BIGINT)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN x.tiene_texto AND x.tipo <> 'TEXTO_ABIERTO'
            THEN format('respuesta de texto no permitida para items %s', x.tipo)
        WHEN x.tiene_numero AND x.tipo <> 'NUMERICA'
            THEN format('respuesta numerica no permitida para items %s', x.tipo)
        WHEN x.selecciones > 0 AND x.tipo NOT IN ('OPCION_UNICA', 'OPCION_MULTIPLE', 'VERDADERO_FALSO')
            THEN format('opciones seleccionadas no permitidas para items %s', x.tipo)
        WHEN x.selecciones > 1 AND x.tipo IN ('OPCION_UNICA', 'VERDADERO_FALSO')
            THEN format('items %s admiten a lo sumo una opcion seleccionada (hay %s)', x.tipo, x.selecciones)
    END
    FROM (
        SELECT
            i.tipo_respuesta::TEXT AS tipo,
            NULLIF(btrim(r.respuesta_texto_abierto), '') IS NOT NULL AS tiene_texto,
            r.respuesta_numerica IS NOT NULL AS tiene_numero,
            (
                SELECT count(*)
                FROM opcion_seleccionada_respuesta o
                WHERE o.respuesta_id = r.respuesta_id
            ) AS selecciones
        FROM respuesta_item r
        JOIN item i ON i.item_id = r.item_id
        WHERE r.respuesta_id = p_respuesta_id
    ) x
$$;

-- ============================================================
-- VISTA DE DIAGNOSTICO
-- ============================================================

CREATE OR REPLACE VIEW diagnostico_integridad_dominio AS
SELECT
    'SESION_VERSION_NO_PUBLICADA'::TEXT AS regla,
    'sesion_aplicacion'::TEXT AS tabla,
    sa.sesion_aplicacion_id::TEXT AS fila_id,
    format('version %s en estado %s', v.version_test_id, v.estado) AS detalle
FROM sesion_aplicacion sa
JOIN version_test v ON v.version_test_id = sa.version_test_id
WHERE v.estado NOT IN ('PUBLICADO', 'RETIRADO')

UNION ALL
SELECT
    'INTENTO_SUBTEST_FUERA_DE_SESION',
    'intento_subtest',
    ist.intento_subtest_id::TEXT,
    format('intento %s, sesion_subtest %s, subtest %s', ist.intento_id, ist.sesion_subtest_id, ist.subtest_id)
FROM intento_subtest ist
LEFT JOIN sesion_subtest ss ON ss.sesion_subtest_id = ist.sesion_subtest_id
WHERE ss.subtest_id IS DISTINCT FROM ist.subtest_id
   OR ss.sesion_aplicacion_id IS DISTINCT FROM fn_bfa_sesion_de_intento(ist.intento_id)

UNION ALL
SELECT
    'INTENTO_ULTIMO_SUBTEST_FUERA_DE_SESION',
    'intento_test',
    it.intento_id::TEXT,
    format('ultimo_subtest %s', it.ultimo_subtest_id)
FROM intento_test it
WHERE it.ultimo_subtest_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM sesion_subtest ss
      WHERE ss.sesion_aplicacion_id = fn_bfa_sesion_de_intento(it.intento_id)
        AND ss.subtest_id = it.ultimo_subtest_id
  )

UNION ALL
SELECT
    'RESPUESTA_ITEM_FUERA_DE_SESION',
    'respuesta_item',
    r.respuesta_id::TEXT,
    format('intento %s, item %s, subtest %s', r.intento_id, r.item_id, i.subtest_id)
FROM respuesta_item r
JOIN item i ON i.item_id = r.item_id
WHERE NOT EXISTS (
    SELECT 1
    FROM sesion_subtest ss
    WHERE ss.sesion_aplicacion_id = fn_bfa_sesion_de_intento(r.intento_id)
      AND ss.subtest_id = i.subtest_id
)

UNION ALL
SELECT
    'RESPUESTA_INTENTO_SUBTEST_INCONSISTENTE',
    'respuesta_item',
    r.respuesta_id::TEXT,
    format('intento %s/%s, subtest item %s/intento_subtest %s', r.intento_id, ist.intento_id, i.subtest_id, ist.subtest_id)
FROM respuesta_item r
JOIN item i ON i.item_id = r.item_id
JOIN intento_subtest ist ON ist.intento_subtest_id = r.intento_subtest_id
WHERE ist.intento_id <> r.intento_id
   OR ist.subtest_id <> i.subtest_id

UNION ALL
SELECT
    'RESPUESTA_TIPO_INCOMPATIBLE',
    'respuesta_item',
    r.respuesta_id::TEXT,
    fn_bfa_problema_respuesta(r.respuesta_id)
FROM respuesta_item r
WHERE fn_bfa_problema_respuesta(r.respuesta_id) IS NOT NULL

UNION ALL
SELECT
    'CLAVE_FUERA_DE_ALCANCE_REGLA',
    'clave_respuesta',
    c.clave_respuesta_id::TEXT,
    format('regla %s, item %s', c.regla_calificacion_id, c.item_id)
FROM clave_respuesta c
WHERE NOT fn_bfa_regla_cubre_item(c.regla_calificacion_id, c.item_id)

UNION ALL
SELECT
    'MATRIZ_FUERA_DE_ALCANCE',
    'opcion_puntaje_dimension',
    opd.opcion_puntaje_dimension_id::TEXT,
    format('regla %s, opcion %s, dimension %s', opd.regla_calificacion_id, opd.opcion_id, opd.dimension_resultado_id)
FROM opcion_puntaje_dimension opd
JOIN regla_calificacion r ON r.regla_calificacion_id = opd.regla_calificacion_id
JOIN opcion_item o ON o.opcion_id = opd.opcion_id
JOIN dimension_resultado d ON d.dimension_resultado_id = opd.dimension_resultado_id
WHERE NOT fn_bfa_regla_cubre_item(opd.regla_calificacion_id, o.item_id)
   OR d.version_test_id <> r.version_test_id

UNION ALL
SELECT
    'RESULTADO_DIMENSION_FUERA_DE_VERSION',
    'resultado_dimension',
    rd.resultado_dimension_id::TEXT,
    format('resultado %s, dimension %s, baremo %s', rd.resultado_id, rd.dimension_resultado_id, rd.baremo_id)
FROM resultado_dimension rd
JOIN resultado res ON res.resultado_id = rd.resultado_id
JOIN dimension_resultado d ON d.dimension_resultado_id = rd.dimension_resultado_id
LEFT JOIN baremo b ON b.baremo_id = rd.baremo_id
WHERE d.version_test_id IS DISTINCT FROM fn_bfa_version_de_intento(res.intento_id)
   OR (rd.baremo_id IS NOT NULL AND (
        b.version_test_id <> d.version_test_id
        OR (b.dimension_resultado_id IS NOT NULL AND b.dimension_resultado_id <> rd.dimension_resultado_id)
   ))

UNION ALL
SELECT
    'CALIFICACION_INCONSISTENTE',
    'calificacion_respuesta',
    cr.calificacion_respuesta_id::TEXT,
    format('resultado %s, respuesta %s, regla %s, dimension %s, opcion %s',
        cr.resultado_id, cr.respuesta_id, cr.regla_calificacion_id, cr.dimension_resultado_id, cr.opcion_id)
FROM calificacion_respuesta cr
JOIN resultado res ON res.resultado_id = cr.resultado_id
JOIN respuesta_item r ON r.respuesta_id = cr.respuesta_id
WHERE r.intento_id <> res.intento_id
   OR (cr.regla_calificacion_id IS NOT NULL AND NOT fn_bfa_regla_cubre_item(cr.regla_calificacion_id, r.item_id))
   OR (cr.dimension_resultado_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM dimension_resultado d
        WHERE d.dimension_resultado_id = cr.dimension_resultado_id
          AND d.version_test_id = fn_bfa_version_de_item(r.item_id)
   ))
   OR (cr.opcion_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM opcion_item o
        WHERE o.opcion_id = cr.opcion_id AND o.item_id = r.item_id
   ))

UNION ALL
SELECT
    'REVISION_MANUAL_FUERA_DE_ALCANCE',
    'revision_manual_respuesta',
    rm.revision_manual_respuesta_id::TEXT,
    format('respuesta %s, regla %s', rm.respuesta_id, rm.regla_calificacion_id)
FROM revision_manual_respuesta rm
JOIN respuesta_item r ON r.respuesta_id = rm.respuesta_id
WHERE rm.regla_calificacion_id IS NOT NULL
  AND NOT fn_bfa_regla_cubre_item(rm.regla_calificacion_id, r.item_id)

UNION ALL
SELECT
    'REVISION_RUBRICA_INCONSISTENTE',
    'revision_rubrica_respuesta',
    rr.revision_rubrica_respuesta_id::TEXT,
    format('revision %s, criterio %s, nivel %s', rr.revision_manual_respuesta_id, rr.criterio_rubrica_id, rr.nivel_criterio_rubrica_id)
FROM revision_rubrica_respuesta rr
JOIN revision_manual_respuesta rm ON rm.revision_manual_respuesta_id = rr.revision_manual_respuesta_id
JOIN respuesta_item r ON r.respuesta_id = rm.respuesta_id
LEFT JOIN nivel_criterio_rubrica n ON n.nivel_criterio_rubrica_id = rr.nivel_criterio_rubrica_id
WHERE NOT fn_bfa_criterio_cubre_item(rr.criterio_rubrica_id, r.item_id)
   OR (rr.nivel_criterio_rubrica_id IS NOT NULL AND n.criterio_rubrica_id <> rr.criterio_rubrica_id);

COMMENT ON VIEW diagnostico_integridad_dominio IS
'Lista filas que violan las reglas de integridad de alcance, tipo de respuesta y sesion aplicadas desde 20261122000200. Solo lectura: no corrige ni borra datos.';

-- ============================================================
-- PREVALIDACION
-- ============================================================

CREATE OR REPLACE FUNCTION fn_bfa_prevalidar_integridad()
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_resumen TEXT;
    v_detalle TEXT;
BEGIN
    SELECT
        string_agg(format('%s=%s', regla, total), ', ' ORDER BY regla),
        string_agg(format('%s (%s): %s filas, ejemplos %s', regla, tabla, total, muestras), E'\n' ORDER BY regla)
    INTO v_resumen, v_detalle
    FROM (
        SELECT
            regla,
            tabla,
            count(*) AS total,
            array_to_string((array_agg(fila_id ORDER BY fila_id))[1:5], ', ') AS muestras
        FROM diagnostico_integridad_dominio
        GROUP BY regla, tabla
    ) d;

    IF v_resumen IS NOT NULL THEN
        RAISE EXCEPTION 'Datos historicos incompatibles con la integridad del dominio: %', v_resumen
            USING ERRCODE = 'check_violation',
                  DETAIL = v_detalle,
                  HINT = 'Revise SELECT * FROM diagnostico_integridad_dominio y corrija los datos manualmente; la migracion no borra ni normaliza datos.';
    END IF;
END;
$$;

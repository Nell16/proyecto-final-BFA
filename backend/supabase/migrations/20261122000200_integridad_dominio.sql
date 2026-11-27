-- ============================================================
-- INTEGRIDAD DEL DOMINIO DE APLICACION Y CONTENIDO OFICIAL
-- ============================================================
-- Preserva el modelo test -> version -> subtest -> item, una version por sesion
-- y un intento por asignacion. Agrega:
--   1. Coherencia de alcance entre intento, sesion, subtest, item, configuracion
--      de calificacion y resultados (FK compuestas donde la estructura lo permite
--      y triggers puntuales donde haria falta cambiar columnas usadas por JPA).
--   2. Compatibilidad del almacenamiento de respuestas con el tipo de respuesta,
--      validada de forma diferida para respetar el patron del backend: guardar
--      respuesta, borrar selecciones y reinsertarlas en la misma transaccion.
--   3. Inmutabilidad del contenido de versiones PUBLICADO/RETIRADO, compatible
--      con el orden de escrituras de VersionTestService.publishVersion.
--   4. Conjunto exacto de opciones correctas (aditivo, convive con la clave
--      singular opcion_correcta_id).
-- Todos los errores usan SQLSTATE de clase 23 (integridad).
-- Requiere 20261122000100_diagnostico_integridad_dominio.sql.

-- Impide escrituras entre el diagnóstico y la instalación de los triggers.
-- Ejecutar esta migración dentro de una transacción.
BEGIN;

LOCK TABLE version_test, subtest, item, opcion_item, dimension_resultado,
    regla_calificacion, clave_respuesta, opcion_puntaje_dimension, baremo, rubrica_evaluacion,
    criterio_rubrica, nivel_criterio_rubrica, sesion_aplicacion, sesion_subtest, asignacion_test,
    intento_test, intento_subtest, respuesta_item, opcion_seleccionada_respuesta,
    resultado, resultado_dimension, calificacion_respuesta, revision_manual_respuesta,
    revision_rubrica_respuesta
    IN SHARE ROW EXCLUSIVE MODE;

SELECT fn_bfa_prevalidar_integridad();

-- ============================================================
-- RESTRICCIONES DECLARATIVAS (FK COMPUESTAS)
-- ============================================================

-- intento_subtest.subtest_id debe ser el subtest de su sesion_subtest.
ALTER TABLE sesion_subtest
    ADD CONSTRAINT uq_sesion_subtest_id_subtest UNIQUE (sesion_subtest_id, subtest_id);

ALTER TABLE intento_subtest
    ADD CONSTRAINT fk_intento_subtest_sesion_subtest_subtest
        FOREIGN KEY (sesion_subtest_id, subtest_id)
        REFERENCES sesion_subtest(sesion_subtest_id, subtest_id) ON DELETE RESTRICT;

-- respuesta_item.intento_subtest_id (opcional) debe pertenecer al mismo intento.
ALTER TABLE intento_subtest
    ADD CONSTRAINT uq_intento_subtest_id_intento UNIQUE (intento_subtest_id, intento_id);

ALTER TABLE respuesta_item
    ADD CONSTRAINT fk_respuesta_intento_subtest_intento
        FOREIGN KEY (intento_subtest_id, intento_id)
        REFERENCES intento_subtest(intento_subtest_id, intento_id) ON DELETE CASCADE;

-- El nivel aplicado en una revision de rubrica debe pertenecer a su criterio.
ALTER TABLE nivel_criterio_rubrica
    ADD CONSTRAINT uq_nivel_criterio_id UNIQUE (criterio_rubrica_id, nivel_criterio_rubrica_id);

ALTER TABLE revision_rubrica_respuesta
    ADD CONSTRAINT fk_revision_rubrica_nivel_criterio
        FOREIGN KEY (criterio_rubrica_id, nivel_criterio_rubrica_id)
        REFERENCES nivel_criterio_rubrica(criterio_rubrica_id, nivel_criterio_rubrica_id) ON DELETE RESTRICT;

-- ============================================================
-- CONJUNTO EXACTO DE OPCIONES CORRECTAS
-- ============================================================
-- Politica de convivencia:
--   * usa_conjunto_opciones = FALSE (valor por defecto, el que escribe el backend
--     actual): la clave se interpreta como hasta ahora (opcion_correcta_id,
--     texto, numero o revision manual) y no puede tener filas en
--     clave_respuesta_opcion.
--   * usa_conjunto_opciones = TRUE: la respuesta correcta es exactamente el
--     conjunto de filas de clave_respuesta_opcion (al menos una), solo para items
--     OPCION_MULTIPLE; opcion_correcta_id, texto_esperado y
--     valor_numerico_esperado deben ser NULL para que ningun evaluador de clave
--     singular la interprete parcialmente.
--   * El conjunto se congela junto con la version (ver contenido oficial).
-- La interpretacion (coincidencia exacta, puntaje parcial, etc.) corresponde a
-- la estrategia de calificacion del backend; la base solo garantiza integridad.

ALTER TABLE clave_respuesta
    ADD COLUMN usa_conjunto_opciones BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE clave_respuesta
    ADD CONSTRAINT uq_clave_respuesta_id_item UNIQUE (clave_respuesta_id, item_id);

ALTER TABLE clave_respuesta
    DROP CONSTRAINT ck_clave_tipo;

ALTER TABLE clave_respuesta
    ADD CONSTRAINT ck_clave_tipo CHECK (
        opcion_correcta_id IS NOT NULL
        OR texto_esperado IS NOT NULL
        OR valor_numerico_esperado IS NOT NULL
        OR requiere_revision_manual = TRUE
        OR usa_conjunto_opciones = TRUE
    );

ALTER TABLE clave_respuesta
    ADD CONSTRAINT ck_clave_conjunto_exclusivo CHECK (
        usa_conjunto_opciones = FALSE
        OR (opcion_correcta_id IS NULL AND texto_esperado IS NULL AND valor_numerico_esperado IS NULL)
    );

CREATE TABLE clave_respuesta_opcion (
    clave_respuesta_id BIGINT NOT NULL,
    item_id BIGINT NOT NULL,
    opcion_id BIGINT NOT NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (clave_respuesta_id, opcion_id),
    FOREIGN KEY (clave_respuesta_id, item_id)
        REFERENCES clave_respuesta(clave_respuesta_id, item_id) ON DELETE CASCADE,
    FOREIGN KEY (item_id, opcion_id)
        REFERENCES opcion_item(item_id, opcion_id) ON DELETE RESTRICT
);

CREATE INDEX idx_clave_respuesta_opcion_opcion ON clave_respuesta_opcion(item_id, opcion_id);

COMMENT ON TABLE clave_respuesta_opcion IS
'Conjunto exacto de opciones correctas de una clave con usa_conjunto_opciones = TRUE (items OPCION_MULTIPLE). Convive con la clave singular opcion_correcta_id, que queda NULL en estas claves.';

COMMENT ON COLUMN clave_respuesta.usa_conjunto_opciones IS
'TRUE: la respuesta correcta es exactamente el conjunto en clave_respuesta_opcion. FALSE (por defecto): clave singular historica.';

-- ============================================================
-- FUNCIONES DE SOPORTE
-- ============================================================

-- Indica si una version tiene contenido oficial congelado. Bloquea la fila de
-- la version en modo compartido para serializar con publicaciones concurrentes
-- (VersionTestService toma FOR UPDATE sobre la version antes de escribir).
CREATE OR REPLACE FUNCTION fn_bfa_version_congelada(p_version_test_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
    v_estado estado_version_test;
BEGIN
    IF p_version_test_id IS NULL THEN
        RETURN FALSE;
    END IF;
    SELECT estado INTO v_estado
    FROM version_test
    WHERE version_test_id = p_version_test_id
    FOR SHARE;
    RETURN COALESCE(v_estado IN ('PUBLICADO', 'RETIRADO'), FALSE);
END;
$$;

-- Resuelve la version propietaria de una fila de contenido de instrumento.
CREATE OR REPLACE FUNCTION fn_bfa_version_de_contenido(p_tabla TEXT, p_fila JSONB)
RETURNS BIGINT
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    CASE p_tabla
        WHEN 'subtest', 'dimension_resultado', 'regla_calificacion', 'baremo', 'rubrica_evaluacion' THEN
            RETURN (p_fila->>'version_test_id')::BIGINT;
        WHEN 'item' THEN
            RETURN (SELECT s.version_test_id FROM subtest s
                    WHERE s.subtest_id = (p_fila->>'subtest_id')::BIGINT);
        WHEN 'opcion_item', 'imagen_item' THEN
            RETURN fn_bfa_version_de_item((p_fila->>'item_id')::BIGINT);
        WHEN 'imagen_opcion' THEN
            RETURN (SELECT fn_bfa_version_de_item(o.item_id) FROM opcion_item o
                    WHERE o.opcion_id = (p_fila->>'opcion_id')::BIGINT);
        WHEN 'clave_respuesta', 'opcion_puntaje_dimension' THEN
            RETURN (SELECT r.version_test_id FROM regla_calificacion r
                    WHERE r.regla_calificacion_id = (p_fila->>'regla_calificacion_id')::BIGINT);
        WHEN 'clave_respuesta_opcion' THEN
            RETURN (SELECT r.version_test_id FROM clave_respuesta c
                    JOIN regla_calificacion r ON r.regla_calificacion_id = c.regla_calificacion_id
                    WHERE c.clave_respuesta_id = (p_fila->>'clave_respuesta_id')::BIGINT);
        WHEN 'rango_baremo' THEN
            RETURN (SELECT b.version_test_id FROM baremo b
                    WHERE b.baremo_id = (p_fila->>'baremo_id')::BIGINT);
        WHEN 'criterio_rubrica' THEN
            RETURN (SELECT ru.version_test_id FROM rubrica_evaluacion ru
                    WHERE ru.rubrica_id = (p_fila->>'rubrica_id')::BIGINT);
        WHEN 'nivel_criterio_rubrica' THEN
            RETURN (SELECT ru.version_test_id FROM criterio_rubrica c
                    JOIN rubrica_evaluacion ru ON ru.rubrica_id = c.rubrica_id
                    WHERE c.criterio_rubrica_id = (p_fila->>'criterio_rubrica_id')::BIGINT);
        ELSE
            RAISE EXCEPTION 'Tabla de contenido no soportada: %', p_tabla;
    END CASE;
END;
$$;

-- ============================================================
-- INMUTABILIDAD DEL CONTENIDO OFICIAL
-- ============================================================
-- Las versiones PUBLICADO/RETIRADO no admiten altas, bajas ni cambios en su
-- contenido. Las actualizaciones sin cambios reales (flush de JPA con los
-- mismos valores) se permiten. Las versiones APROBADO siguen siendo escribibles
-- en SQL porque publishVersion publica reglas y baremos antes de cambiar la
-- version a PUBLICADO.

CREATE OR REPLACE FUNCTION tg_bfa_proteger_contenido_oficial()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND to_jsonb(NEW) = to_jsonb(OLD) THEN
        RETURN NEW;
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE')
       AND fn_bfa_version_congelada(fn_bfa_version_de_contenido(TG_TABLE_NAME, to_jsonb(OLD))) THEN
        RAISE EXCEPTION 'Contenido oficial inmutable: % pertenece a una version publicada o retirada', TG_TABLE_NAME
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE')
       AND fn_bfa_version_congelada(fn_bfa_version_de_contenido(TG_TABLE_NAME, to_jsonb(NEW))) THEN
        RAISE EXCEPTION 'Contenido oficial inmutable: % pertenece a una version publicada o retirada', TG_TABLE_NAME
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DO $$
DECLARE
    v_tabla TEXT;
BEGIN
    FOREACH v_tabla IN ARRAY ARRAY[
        'subtest', 'dimension_resultado', 'item', 'opcion_item', 'imagen_item', 'imagen_opcion',
        'regla_calificacion', 'clave_respuesta', 'clave_respuesta_opcion', 'opcion_puntaje_dimension',
        'baremo', 'rango_baremo', 'rubrica_evaluacion', 'criterio_rubrica', 'nivel_criterio_rubrica'
    ] LOOP
        EXECUTE format(
            'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I '
            'FOR EACH ROW EXECUTE FUNCTION tg_bfa_proteger_contenido_oficial()',
            'tg_' || v_tabla || '_contenido_oficial',
            v_tabla
        );
    END LOOP;
END;
$$;

-- Metadatos de recursos enlazados a contenido oficial. El borrado ya esta
-- impedido por las FK ON DELETE RESTRICT de imagen_item/imagen_opcion.
CREATE OR REPLACE FUNCTION tg_bfa_proteger_recurso_oficial()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF to_jsonb(NEW) = to_jsonb(OLD) THEN
        RETURN NEW;
    END IF;
    IF EXISTS (
        SELECT 1 FROM imagen_item ii
        WHERE ii.recurso_id = OLD.recurso_id
          AND fn_bfa_version_congelada(fn_bfa_version_de_item(ii.item_id))
    ) OR EXISTS (
        SELECT 1 FROM imagen_opcion io
        JOIN opcion_item o ON o.opcion_id = io.opcion_id
        WHERE io.recurso_id = OLD.recurso_id
          AND fn_bfa_version_congelada(fn_bfa_version_de_item(o.item_id))
    ) THEN
        RAISE EXCEPTION 'Contenido oficial inmutable: recurso_multimedia % esta enlazado a una version publicada o retirada', OLD.recurso_id
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_recurso_multimedia_contenido_oficial
    BEFORE UPDATE ON recurso_multimedia
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_proteger_recurso_oficial();

-- Transiciones de la propia version:
--   PUBLICADO -> PUBLICADO (sin cambios) o RETIRADO, cambiando solo estado.
--   RETIRADO  -> sin cambios.
--   No se borran versiones PUBLICADO/RETIRADO.
-- Retirar no modifica reglas, baremos ni rubricas: la configuracion historica
-- conserva sus estados.
CREATE OR REPLACE FUNCTION tg_bfa_proteger_version_oficial()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.estado IN ('PUBLICADO', 'RETIRADO') THEN
            RAISE EXCEPTION 'Contenido oficial inmutable: no se elimina la version % en estado %', OLD.version_test_id, OLD.estado
                USING ERRCODE = 'restrict_violation';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.estado = 'RETIRADO' AND to_jsonb(NEW) <> to_jsonb(OLD) THEN
        RAISE EXCEPTION 'Contenido oficial inmutable: la version % esta retirada', OLD.version_test_id
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.estado = 'PUBLICADO' AND (
        NEW.estado NOT IN ('PUBLICADO', 'RETIRADO')
        OR to_jsonb(NEW) - 'estado' <> to_jsonb(OLD) - 'estado'
    ) THEN
        RAISE EXCEPTION 'Contenido oficial inmutable: la version publicada % solo puede pasar a RETIRADO', OLD.version_test_id
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_version_test_contenido_oficial
    BEFORE UPDATE OR DELETE ON version_test
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_proteger_version_oficial();

-- ============================================================
-- COLUMNAS DE PERTENENCIA FIJAS
-- ============================================================
-- Reasignar una fila a otro padre podria invalidar relaciones ya validadas.
-- El backend nunca cambia estas columnas (las actualizaciones completas de JPA
-- reescriben el mismo valor, lo cual se permite).

CREATE OR REPLACE FUNCTION tg_bfa_columnas_fijas()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_columna TEXT;
BEGIN
    FOREACH v_columna IN ARRAY TG_ARGV LOOP
        IF to_jsonb(NEW)->v_columna IS DISTINCT FROM to_jsonb(OLD)->v_columna THEN
            RAISE EXCEPTION 'La columna %.% no puede modificarse', TG_TABLE_NAME, v_columna
                USING ERRCODE = 'restrict_violation';
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_subtest_columnas_fijas BEFORE UPDATE ON subtest
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_columnas_fijas('version_test_id');
CREATE TRIGGER tg_dimension_resultado_columnas_fijas BEFORE UPDATE ON dimension_resultado
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_columnas_fijas('version_test_id');
CREATE TRIGGER tg_regla_calificacion_columnas_fijas BEFORE UPDATE ON regla_calificacion
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_columnas_fijas('version_test_id');
CREATE TRIGGER tg_clave_respuesta_opcion_columnas_fijas BEFORE UPDATE ON clave_respuesta_opcion
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_columnas_fijas('clave_respuesta_id');
CREATE TRIGGER tg_baremo_columnas_fijas BEFORE UPDATE ON baremo
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_columnas_fijas('version_test_id');
CREATE TRIGGER tg_rubrica_evaluacion_columnas_fijas BEFORE UPDATE ON rubrica_evaluacion
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_columnas_fijas('version_test_id');
CREATE TRIGGER tg_criterio_rubrica_columnas_fijas BEFORE UPDATE ON criterio_rubrica
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_columnas_fijas('rubrica_id');
CREATE TRIGGER tg_sesion_subtest_columnas_fijas BEFORE UPDATE ON sesion_subtest
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_columnas_fijas('sesion_aplicacion_id', 'version_test_id');
CREATE TRIGGER tg_asignacion_test_columnas_fijas BEFORE UPDATE ON asignacion_test
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_columnas_fijas('sesion_aplicacion_id');
CREATE TRIGGER tg_intento_test_columnas_fijas BEFORE UPDATE ON intento_test
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_columnas_fijas('asignacion_id');
CREATE TRIGGER tg_intento_subtest_columnas_fijas BEFORE UPDATE ON intento_subtest
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_columnas_fijas('intento_id', 'sesion_subtest_id', 'subtest_id');
CREATE TRIGGER tg_respuesta_item_columnas_fijas BEFORE UPDATE ON respuesta_item
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_columnas_fijas('intento_id', 'item_id');
CREATE TRIGGER tg_resultado_columnas_fijas BEFORE UPDATE ON resultado
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_columnas_fijas('intento_id');
CREATE TRIGGER tg_revision_manual_respuesta_columnas_fijas BEFORE UPDATE ON revision_manual_respuesta
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_columnas_fijas('respuesta_id');

-- ============================================================
-- SESIONES: VERSION PUBLICADA Y CONFIGURACION APLICADA
-- ============================================================

-- Una sesion solo se crea (o cambia de version) sobre una version PUBLICADO, y
-- no cambia de version una vez que tiene asignaciones. Asi el contenido usado
-- por respuestas reales siempre esta congelado.
CREATE OR REPLACE FUNCTION tg_bfa_validar_sesion_version()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.version_test_id = OLD.version_test_id THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND EXISTS (
        SELECT 1 FROM asignacion_test a WHERE a.sesion_aplicacion_id = OLD.sesion_aplicacion_id
    ) THEN
        RAISE EXCEPTION 'La sesion % ya tiene asignaciones y no puede cambiar de version', OLD.sesion_aplicacion_id
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM version_test v
        WHERE v.version_test_id = NEW.version_test_id
          AND v.estado = 'PUBLICADO'
    ) THEN
        RAISE EXCEPTION 'La sesion requiere una version PUBLICADO (version %)', NEW.version_test_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_sesion_aplicacion_version
    BEFORE INSERT OR UPDATE OF version_test_id ON sesion_aplicacion
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_validar_sesion_version();

-- Una sesion con intentos ya fue aplicada: sus subtests no se agregan, quitan ni
-- reconfiguran. Antes del primer intento (PROGRAMADA con o sin asignaciones) se
-- permite configurar libremente, como hace SessionManagementService.
CREATE OR REPLACE FUNCTION tg_bfa_proteger_sesion_aplicada()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_sesiones BIGINT[] := ARRAY[]::BIGINT[];
BEGIN
    IF TG_OP = 'UPDATE' AND to_jsonb(NEW) = to_jsonb(OLD) THEN
        RETURN NEW;
    END IF;
    IF TG_OP <> 'INSERT' THEN
        v_sesiones := array_append(v_sesiones, OLD.sesion_aplicacion_id);
    END IF;
    IF TG_OP <> 'DELETE' THEN
        v_sesiones := array_append(v_sesiones, NEW.sesion_aplicacion_id);
    END IF;
    IF EXISTS (
        SELECT 1
        FROM asignacion_test a
        JOIN intento_test it ON it.asignacion_id = a.asignacion_id
        WHERE a.sesion_aplicacion_id = ANY (v_sesiones)
    ) THEN
        RAISE EXCEPTION 'La sesion ya tiene intentos: no se reconfiguran sus subtests'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_sesion_subtest_sesion_aplicada
    BEFORE INSERT OR UPDATE OR DELETE ON sesion_subtest
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_proteger_sesion_aplicada();

-- ============================================================
-- ALCANCE DE INTENTOS Y RESPUESTAS
-- ============================================================

CREATE OR REPLACE FUNCTION tg_bfa_validar_intento_subtest()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- El subtest coincide con sesion_subtest por FK; aqui se exige la sesion.
    IF NOT EXISTS (
        SELECT 1 FROM sesion_subtest ss
        WHERE ss.sesion_subtest_id = NEW.sesion_subtest_id
          AND ss.sesion_aplicacion_id = fn_bfa_sesion_de_intento(NEW.intento_id)
    ) THEN
        RAISE EXCEPTION 'intento_subtest: la sesion_subtest % no pertenece a la sesion del intento %', NEW.sesion_subtest_id, NEW.intento_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_intento_subtest_alcance
    BEFORE INSERT ON intento_subtest
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_validar_intento_subtest();

CREATE OR REPLACE FUNCTION tg_bfa_validar_intento_ultimo_subtest()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.ultimo_subtest_id IS NULL
       OR (TG_OP = 'UPDATE' AND NEW.ultimo_subtest_id IS NOT DISTINCT FROM OLD.ultimo_subtest_id) THEN
        RETURN NEW;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM asignacion_test a
        JOIN sesion_subtest ss ON ss.sesion_aplicacion_id = a.sesion_aplicacion_id
        WHERE a.asignacion_id = NEW.asignacion_id
          AND ss.subtest_id = NEW.ultimo_subtest_id
    ) THEN
        RAISE EXCEPTION 'intento_test: el subtest % no esta configurado en la sesion del intento %', NEW.ultimo_subtest_id, NEW.intento_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_intento_test_alcance
    BEFORE INSERT OR UPDATE OF ultimo_subtest_id ON intento_test
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_validar_intento_ultimo_subtest();

-- respuesta_item: el item debe pertenecer a un subtest configurado en la sesion
-- del intento (por FK de sesion_subtest, eso implica la version de la sesion).
-- Si intento_subtest_id se informa, debe ser del mismo intento (FK compuesta) y
-- del mismo subtest del item. NULL sigue permitido para el backend actual.
CREATE OR REPLACE FUNCTION tg_bfa_validar_respuesta_alcance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_subtest_id BIGINT;
BEGIN
    SELECT i.subtest_id INTO v_subtest_id FROM item i WHERE i.item_id = NEW.item_id;

    -- FOR KEY SHARE impide quitar o reasignar la sesion_subtest mientras la
    -- transaccion que guarda la respuesta sigue abierta.
    PERFORM 1
    FROM sesion_subtest ss
    WHERE ss.sesion_aplicacion_id = fn_bfa_sesion_de_intento(NEW.intento_id)
      AND ss.subtest_id = v_subtest_id
    FOR KEY SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'respuesta_item: el item % no pertenece a un subtest configurado en la sesion del intento %', NEW.item_id, NEW.intento_id
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.intento_subtest_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM intento_subtest ist
        WHERE ist.intento_subtest_id = NEW.intento_subtest_id
          AND ist.subtest_id = v_subtest_id
    ) THEN
        RAISE EXCEPTION 'respuesta_item: el intento_subtest % no corresponde al subtest del item %', NEW.intento_subtest_id, NEW.item_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_respuesta_item_alcance
    BEFORE INSERT OR UPDATE OF intento_subtest_id ON respuesta_item
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_validar_respuesta_alcance();

-- ============================================================
-- ALMACENAMIENTO POR TIPO DE RESPUESTA (DIFERIDO)
-- ============================================================
-- Se valida al confirmar la transaccion (DEFERRABLE INITIALLY DEFERRED) porque
-- ParticipantAnswerService actualiza la respuesta, borra sus selecciones y las
-- reinserta, y Hibernate puede emitir las inserciones antes que los borrados.
-- Una escritura en el padre serializa los cambios de las selecciones, incluso
-- en REPEATABLE READ, donde un bloqueo sin escritura permite validar dos
-- cambios concurrentes contra instantáneas antiguas.

CREATE OR REPLACE FUNCTION tg_bfa_validar_almacenamiento_respuesta()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_problema TEXT;
BEGIN
    IF TG_TABLE_NAME = 'opcion_seleccionada_respuesta' THEN
        -- La validación diferida que dispara este UPDATE no vuelve a escribir.
        UPDATE respuesta_item SET es_final = es_final WHERE respuesta_id = NEW.respuesta_id;
    ELSE
        PERFORM 1 FROM respuesta_item WHERE respuesta_id = NEW.respuesta_id FOR NO KEY UPDATE;
    END IF;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    v_problema := fn_bfa_problema_respuesta(NEW.respuesta_id);
    IF v_problema IS NOT NULL THEN
        RAISE EXCEPTION 'respuesta_item %: %', NEW.respuesta_id, v_problema
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER tg_respuesta_item_almacenamiento
    AFTER INSERT OR UPDATE ON respuesta_item
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_validar_almacenamiento_respuesta();

CREATE CONSTRAINT TRIGGER tg_opcion_seleccionada_respuesta_almacenamiento
    AFTER INSERT OR UPDATE ON opcion_seleccionada_respuesta
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_validar_almacenamiento_respuesta();

-- ============================================================
-- ALCANCE DE CONFIGURACION DE CALIFICACION
-- ============================================================

CREATE OR REPLACE FUNCTION tg_bfa_validar_clave_alcance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT fn_bfa_regla_cubre_item(NEW.regla_calificacion_id, NEW.item_id) THEN
        RAISE EXCEPTION 'clave_respuesta: el item % esta fuera del alcance de la regla %', NEW.item_id, NEW.regla_calificacion_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_clave_respuesta_alcance
    BEFORE INSERT OR UPDATE ON clave_respuesta
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_validar_clave_alcance();

CREATE OR REPLACE FUNCTION tg_bfa_validar_matriz_alcance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT fn_bfa_regla_cubre_item(
        NEW.regla_calificacion_id,
        (SELECT o.item_id FROM opcion_item o WHERE o.opcion_id = NEW.opcion_id)
    ) THEN
        RAISE EXCEPTION 'opcion_puntaje_dimension: la opcion % esta fuera del alcance de la regla %', NEW.opcion_id, NEW.regla_calificacion_id
            USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM dimension_resultado d
        JOIN regla_calificacion r ON r.version_test_id = d.version_test_id
        WHERE d.dimension_resultado_id = NEW.dimension_resultado_id
          AND r.regla_calificacion_id = NEW.regla_calificacion_id
    ) THEN
        RAISE EXCEPTION 'opcion_puntaje_dimension: la dimension % no pertenece a la version de la regla %', NEW.dimension_resultado_id, NEW.regla_calificacion_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_opcion_puntaje_dimension_alcance
    BEFORE INSERT OR UPDATE ON opcion_puntaje_dimension
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_validar_matriz_alcance();

-- Coherencia diferida entre usa_conjunto_opciones y clave_respuesta_opcion:
-- permite insertar la clave y luego sus opciones en la misma transaccion.
CREATE OR REPLACE FUNCTION tg_bfa_validar_conjunto_clave()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_clave_id BIGINT := CASE WHEN TG_OP = 'DELETE' THEN OLD.clave_respuesta_id ELSE NEW.clave_respuesta_id END;
    v_usa_conjunto BOOLEAN;
    v_tipo tipo_respuesta;
    v_opciones INT;
BEGIN
    IF TG_TABLE_NAME = 'clave_respuesta_opcion' THEN
        -- Dos borrados concurrentes no pueden dejar vacía la clave de conjunto.
        UPDATE clave_respuesta SET usa_conjunto_opciones = usa_conjunto_opciones
        WHERE clave_respuesta_id = v_clave_id;
    END IF;
    SELECT c.usa_conjunto_opciones, i.tipo_respuesta
    INTO v_usa_conjunto, v_tipo
    FROM clave_respuesta c
    JOIN item i ON i.item_id = c.item_id
    WHERE c.clave_respuesta_id = v_clave_id
    FOR NO KEY UPDATE OF c;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    SELECT count(*) INTO v_opciones
    FROM clave_respuesta_opcion cro
    WHERE cro.clave_respuesta_id = v_clave_id;

    IF v_usa_conjunto AND v_opciones = 0 THEN
        RAISE EXCEPTION 'clave_respuesta %: usa_conjunto_opciones requiere al menos una opcion en clave_respuesta_opcion', v_clave_id
            USING ERRCODE = 'check_violation';
    END IF;
    IF NOT v_usa_conjunto AND v_opciones > 0 THEN
        RAISE EXCEPTION 'clave_respuesta %: tiene opciones de conjunto pero usa_conjunto_opciones es FALSE', v_clave_id
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_usa_conjunto AND v_tipo <> 'OPCION_MULTIPLE' THEN
        RAISE EXCEPTION 'clave_respuesta %: el conjunto de opciones correctas solo aplica a items OPCION_MULTIPLE', v_clave_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER tg_clave_respuesta_conjunto
    AFTER INSERT OR UPDATE ON clave_respuesta
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_validar_conjunto_clave();

CREATE CONSTRAINT TRIGGER tg_clave_respuesta_opcion_conjunto
    AFTER INSERT OR UPDATE OR DELETE ON clave_respuesta_opcion
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_validar_conjunto_clave();

-- ============================================================
-- ALCANCE DE RESULTADOS Y REVISIONES
-- ============================================================

CREATE OR REPLACE FUNCTION tg_bfa_validar_resultado_dimension()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_version_id BIGINT;
BEGIN
    SELECT fn_bfa_version_de_intento(res.intento_id) INTO v_version_id
    FROM resultado res WHERE res.resultado_id = NEW.resultado_id;

    IF NOT EXISTS (
        SELECT 1 FROM dimension_resultado d
        WHERE d.dimension_resultado_id = NEW.dimension_resultado_id
          AND d.version_test_id = v_version_id
    ) THEN
        RAISE EXCEPTION 'resultado_dimension: la dimension % no pertenece a la version del intento', NEW.dimension_resultado_id
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.baremo_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM baremo b
        WHERE b.baremo_id = NEW.baremo_id
          AND b.version_test_id = v_version_id
          AND (b.dimension_resultado_id IS NULL OR b.dimension_resultado_id = NEW.dimension_resultado_id)
    ) THEN
        RAISE EXCEPTION 'resultado_dimension: el baremo % no corresponde a la version o dimension del resultado', NEW.baremo_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_resultado_dimension_alcance
    BEFORE INSERT OR UPDATE ON resultado_dimension
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_validar_resultado_dimension();

CREATE OR REPLACE FUNCTION tg_bfa_validar_calificacion_respuesta()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_intento_id BIGINT;
    v_item_id BIGINT;
BEGIN
    SELECT r.intento_id, r.item_id INTO v_intento_id, v_item_id
    FROM respuesta_item r WHERE r.respuesta_id = NEW.respuesta_id;

    IF v_intento_id IS DISTINCT FROM (SELECT res.intento_id FROM resultado res WHERE res.resultado_id = NEW.resultado_id) THEN
        RAISE EXCEPTION 'calificacion_respuesta: la respuesta % no pertenece al intento del resultado %', NEW.respuesta_id, NEW.resultado_id
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.regla_calificacion_id IS NOT NULL AND NOT fn_bfa_regla_cubre_item(NEW.regla_calificacion_id, v_item_id) THEN
        RAISE EXCEPTION 'calificacion_respuesta: la regla % no cubre el item %', NEW.regla_calificacion_id, v_item_id
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.dimension_resultado_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM dimension_resultado d
        WHERE d.dimension_resultado_id = NEW.dimension_resultado_id
          AND d.version_test_id = fn_bfa_version_de_item(v_item_id)
    ) THEN
        RAISE EXCEPTION 'calificacion_respuesta: la dimension % no pertenece a la version del item %', NEW.dimension_resultado_id, v_item_id
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.opcion_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM opcion_item o WHERE o.opcion_id = NEW.opcion_id AND o.item_id = v_item_id
    ) THEN
        RAISE EXCEPTION 'calificacion_respuesta: la opcion % no pertenece al item %', NEW.opcion_id, v_item_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_calificacion_respuesta_alcance
    BEFORE INSERT OR UPDATE ON calificacion_respuesta
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_validar_calificacion_respuesta();

CREATE OR REPLACE FUNCTION tg_bfa_validar_revision_manual()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.regla_calificacion_id IS NOT NULL AND NOT fn_bfa_regla_cubre_item(
        NEW.regla_calificacion_id,
        (SELECT r.item_id FROM respuesta_item r WHERE r.respuesta_id = NEW.respuesta_id)
    ) THEN
        RAISE EXCEPTION 'revision_manual_respuesta: la regla % no cubre el item de la respuesta %', NEW.regla_calificacion_id, NEW.respuesta_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_revision_manual_respuesta_alcance
    BEFORE INSERT OR UPDATE ON revision_manual_respuesta
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_validar_revision_manual();

CREATE OR REPLACE FUNCTION tg_bfa_validar_revision_rubrica()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- El nivel pertenece al criterio por FK compuesta; aqui se exige el alcance.
    IF NOT fn_bfa_criterio_cubre_item(
        NEW.criterio_rubrica_id,
        (SELECT r.item_id
         FROM revision_manual_respuesta rm
         JOIN respuesta_item r ON r.respuesta_id = rm.respuesta_id
         WHERE rm.revision_manual_respuesta_id = NEW.revision_manual_respuesta_id)
    ) THEN
        RAISE EXCEPTION 'revision_rubrica_respuesta: la rubrica del criterio % no cubre el item revisado', NEW.criterio_rubrica_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_revision_rubrica_respuesta_alcance
    BEFORE INSERT OR UPDATE ON revision_rubrica_respuesta
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_validar_revision_rubrica();

-- ============================================================
-- REVALIDACION ANTE CAMBIOS DE PADRES
-- ============================================================
-- Cambios permitidos en versiones no congeladas que podrian invalidar filas
-- dependientes ya validadas.

-- regla_calificacion: cambio de alcance (subtest/item).
CREATE OR REPLACE FUNCTION tg_bfa_revalidar_regla()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.subtest_id IS NOT DISTINCT FROM OLD.subtest_id AND NEW.item_id IS NOT DISTINCT FROM OLD.item_id THEN
        RETURN NULL;
    END IF;
    IF EXISTS (
        SELECT 1 FROM clave_respuesta c
        WHERE c.regla_calificacion_id = NEW.regla_calificacion_id
          AND NOT fn_bfa_regla_cubre_item(NEW.regla_calificacion_id, c.item_id)
    ) OR EXISTS (
        SELECT 1 FROM opcion_puntaje_dimension opd
        JOIN opcion_item o ON o.opcion_id = opd.opcion_id
        WHERE opd.regla_calificacion_id = NEW.regla_calificacion_id
          AND NOT fn_bfa_regla_cubre_item(NEW.regla_calificacion_id, o.item_id)
    ) OR EXISTS (
        SELECT 1 FROM calificacion_respuesta cr
        JOIN respuesta_item r ON r.respuesta_id = cr.respuesta_id
        WHERE cr.regla_calificacion_id = NEW.regla_calificacion_id
          AND NOT fn_bfa_regla_cubre_item(NEW.regla_calificacion_id, r.item_id)
    ) OR EXISTS (
        SELECT 1 FROM revision_manual_respuesta rm
        JOIN respuesta_item r ON r.respuesta_id = rm.respuesta_id
        WHERE rm.regla_calificacion_id = NEW.regla_calificacion_id
          AND NOT fn_bfa_regla_cubre_item(NEW.regla_calificacion_id, r.item_id)
    ) THEN
        RAISE EXCEPTION 'regla_calificacion %: el nuevo alcance deja claves, matriz o calificaciones fuera de alcance', NEW.regla_calificacion_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER tg_regla_calificacion_revalidar
    AFTER UPDATE OF subtest_id, item_id ON regla_calificacion
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_revalidar_regla();

-- rubrica_evaluacion: cambio de alcance (subtest/item).
CREATE OR REPLACE FUNCTION tg_bfa_revalidar_rubrica()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.subtest_id IS NOT DISTINCT FROM OLD.subtest_id AND NEW.item_id IS NOT DISTINCT FROM OLD.item_id THEN
        RETURN NULL;
    END IF;
    IF EXISTS (
        SELECT 1
        FROM revision_rubrica_respuesta rr
        JOIN criterio_rubrica c ON c.criterio_rubrica_id = rr.criterio_rubrica_id
        JOIN revision_manual_respuesta rm ON rm.revision_manual_respuesta_id = rr.revision_manual_respuesta_id
        JOIN respuesta_item r ON r.respuesta_id = rm.respuesta_id
        WHERE c.rubrica_id = NEW.rubrica_id
          AND NOT fn_bfa_criterio_cubre_item(rr.criterio_rubrica_id, r.item_id)
    ) THEN
        RAISE EXCEPTION 'rubrica_evaluacion %: el nuevo alcance deja revisiones fuera de alcance', NEW.rubrica_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER tg_rubrica_evaluacion_revalidar
    AFTER UPDATE OF subtest_id, item_id ON rubrica_evaluacion
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_revalidar_rubrica();

-- item: el backend puede reasignar un item a otro subtest de la misma version
-- en borrador (saveConfiguration). Se exige misma version, que no haya
-- respuestas y que claves/matriz sigan en alcance. El tipo de respuesta no
-- cambia si hay respuestas o si contradice un conjunto de opciones correctas.
CREATE OR REPLACE FUNCTION tg_bfa_revalidar_item()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.subtest_id IS DISTINCT FROM OLD.subtest_id THEN
        IF (SELECT s.version_test_id FROM subtest s WHERE s.subtest_id = NEW.subtest_id)
           IS DISTINCT FROM (SELECT s.version_test_id FROM subtest s WHERE s.subtest_id = OLD.subtest_id) THEN
            RAISE EXCEPTION 'item %: no puede moverse a un subtest de otra version', NEW.item_id
                USING ERRCODE = 'restrict_violation';
        END IF;
        IF EXISTS (SELECT 1 FROM respuesta_item r WHERE r.item_id = NEW.item_id) THEN
            RAISE EXCEPTION 'item %: tiene respuestas y no puede cambiar de subtest', NEW.item_id
                USING ERRCODE = 'restrict_violation';
        END IF;
        IF EXISTS (
            SELECT 1 FROM clave_respuesta c
            WHERE c.item_id = NEW.item_id
              AND NOT fn_bfa_regla_cubre_item(c.regla_calificacion_id, c.item_id)
        ) OR EXISTS (
            SELECT 1 FROM opcion_puntaje_dimension opd
            JOIN opcion_item o ON o.opcion_id = opd.opcion_id
            WHERE o.item_id = NEW.item_id
              AND NOT fn_bfa_regla_cubre_item(opd.regla_calificacion_id, o.item_id)
        ) THEN
            RAISE EXCEPTION 'item %: el cambio de subtest deja claves o matriz fuera del alcance de su regla', NEW.item_id
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    IF NEW.tipo_respuesta IS DISTINCT FROM OLD.tipo_respuesta THEN
        IF EXISTS (SELECT 1 FROM respuesta_item r WHERE r.item_id = NEW.item_id) THEN
            RAISE EXCEPTION 'item %: tiene respuestas y no puede cambiar de tipo de respuesta', NEW.item_id
                USING ERRCODE = 'restrict_violation';
        END IF;
        IF NEW.tipo_respuesta <> 'OPCION_MULTIPLE' AND EXISTS (
            SELECT 1 FROM clave_respuesta c
            WHERE c.item_id = NEW.item_id AND c.usa_conjunto_opciones
        ) THEN
            RAISE EXCEPTION 'item %: tiene un conjunto de opciones correctas y debe seguir siendo OPCION_MULTIPLE', NEW.item_id
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER tg_item_revalidar
    AFTER UPDATE OF subtest_id, tipo_respuesta ON item
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_revalidar_item();

-- opcion_item: el backend puede reasignar una opcion a otro item en borrador.
-- Claves, selecciones y conjuntos ya lo impiden por FK compuesta; aqui se
-- exige misma version y se revalidan matriz y calificaciones.
CREATE OR REPLACE FUNCTION tg_bfa_revalidar_opcion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.item_id IS NOT DISTINCT FROM OLD.item_id THEN
        RETURN NULL;
    END IF;
    IF fn_bfa_version_de_item(NEW.item_id) IS DISTINCT FROM fn_bfa_version_de_item(OLD.item_id) THEN
        RAISE EXCEPTION 'opcion_item %: no puede moverse a un item de otra version', NEW.opcion_id
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF EXISTS (
        SELECT 1 FROM opcion_puntaje_dimension opd
        WHERE opd.opcion_id = NEW.opcion_id
          AND NOT fn_bfa_regla_cubre_item(opd.regla_calificacion_id, NEW.item_id)
    ) OR EXISTS (
        SELECT 1 FROM calificacion_respuesta cr
        WHERE cr.opcion_id = NEW.opcion_id
    ) THEN
        RAISE EXCEPTION 'opcion_item %: el cambio de item deja matriz o calificaciones inconsistentes', NEW.opcion_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER tg_opcion_item_revalidar
    AFTER UPDATE OF item_id ON opcion_item
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_revalidar_opcion();

-- baremo: cambio de dimension con resultados ya asociados.
CREATE OR REPLACE FUNCTION tg_bfa_revalidar_baremo()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.dimension_resultado_id IS NOT NULL
       AND NEW.dimension_resultado_id IS DISTINCT FROM OLD.dimension_resultado_id
       AND EXISTS (
           SELECT 1 FROM resultado_dimension rd
           WHERE rd.baremo_id = NEW.baremo_id
             AND rd.dimension_resultado_id <> NEW.dimension_resultado_id
       ) THEN
        RAISE EXCEPTION 'baremo %: el cambio de dimension deja resultados inconsistentes', NEW.baremo_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER tg_baremo_revalidar
    AFTER UPDATE OF dimension_resultado_id ON baremo
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_revalidar_baremo();

COMMENT ON FUNCTION tg_bfa_proteger_contenido_oficial() IS
'Bloquea altas, bajas y cambios del contenido de versiones PUBLICADO/RETIRADO. Las actualizaciones sin cambios se permiten.';

COMMENT ON FUNCTION tg_bfa_validar_almacenamiento_respuesta() IS
'Validacion diferida: OPCION_UNICA y VERDADERO_FALSO admiten a lo sumo una seleccion, OPCION_MULTIPLE varias; texto solo en TEXTO_ABIERTO y numero solo en NUMERICA. La respuesta vacia es valida.';

COMMIT;
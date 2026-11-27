-- ============================================================
-- B18 (fix): RESTRICCIONES UNIQUE DE CODIGO DEFERRABLE INITIALLY DEFERRED
-- ============================================================
-- Permite reutilizar un codigo dentro del arbol de configuracion al borrar
-- un elemento y crear otro con el mismo codigo en la misma transaccion
-- (por ejemplo en POST /test-versions/{id}/configuration), ya que Hibernate
-- ejecuta los INSERT antes que los DELETE. La validacion de unicidad se
-- pospone hasta el COMMIT, manteniendo 409 CONFLICT ante duplicados reales.
--
-- Alcance: solo tablas del arbol de configuracion de instrumentos.
-- No se modifican UNIQUE fuera de este arbol (test, version_test, catalogos,
-- sesiones, seguridad, etc.).
-- Nota sobre FKs y baremo:
--   * Ninguna de estas UNIQUE de codigo es referenciada por una FK (las FKs
--     apuntan a las PK o a las UNIQUE compuestas de IDs). Aun asi el bloque
--     verifica en pg_constraint que no exista FK dependiente antes de alterar.
--   * baremo usa indices unicos parciales (uq_baremo_dimension_codigo y
--     uq_baremo_total_codigo con clausula WHERE); PostgreSQL no soporta
--     DEFERRABLE en indices parciales, por lo que no aplica aqui.

DO $$
DECLARE
    v_spec RECORD;
    v_conname TEXT;
    v_ya_deferrable BOOLEAN;
    v_tiene_fk BOOLEAN;
BEGIN
    FOR v_spec IN
        SELECT *
        FROM (VALUES
            ('subtest',                'version_test_id',     'codigo_subtest',   'uq_subtest_version_codigo'),
            ('dimension_resultado',    'version_test_id',     'codigo_dimension', 'uq_dimension_version_codigo'),
            ('item',                   'subtest_id',          'codigo_item',      'uq_item_subtest_codigo'),
            ('opcion_item',            'item_id',             'codigo_opcion',    'uq_opcion_item_codigo'),
            ('rubrica_evaluacion',     'version_test_id',     'codigo_rubrica',   'uq_rubrica_version_codigo'),
            ('criterio_rubrica',       'rubrica_id',          'codigo_criterio',  'uq_criterio_rubrica_codigo'),
            ('nivel_criterio_rubrica', 'criterio_rubrica_id', 'codigo_nivel',     'uq_nivel_criterio_codigo')
        ) AS t(tabla, col1, col2, nuevo_nombre)
    LOOP
        SELECT EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class cl ON cl.oid = c.conrelid
            JOIN pg_namespace ns ON ns.oid = cl.relnamespace
            WHERE ns.nspname = 'public'
              AND cl.relname = v_spec.tabla
              AND c.contype = 'u'
              AND c.condeferrable
              AND c.condeferred
              AND (
                  SELECT array_agg(a.attname::text ORDER BY u.ord)
                  FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
                  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum
              ) = ARRAY[v_spec.col1, v_spec.col2]
        ) INTO v_ya_deferrable;

        IF v_ya_deferrable THEN
            CONTINUE;
        END IF;

        SELECT EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class cl ON cl.oid = c.conrelid
            JOIN pg_namespace ns ON ns.oid = cl.relnamespace
            JOIN pg_constraint fk ON fk.confrelid = cl.oid AND fk.contype = 'f'
            WHERE ns.nspname = 'public'
              AND cl.relname = v_spec.tabla
              AND c.contype = 'u'
              AND (
                  SELECT array_agg(a.attname::text ORDER BY u.ord)
                  FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
                  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum
              ) = ARRAY[v_spec.col1, v_spec.col2]
              AND fk.confkey = c.conkey
        ) INTO v_tiene_fk;

        IF v_tiene_fk THEN
            RAISE NOTICE 'Se omite %.% porque es referenciada por una FK', v_spec.tabla, v_spec.nuevo_nombre;
            CONTINUE;
        END IF;

        FOR v_conname IN
            SELECT c.conname
            FROM pg_constraint c
            JOIN pg_class cl ON cl.oid = c.conrelid
            JOIN pg_namespace ns ON ns.oid = cl.relnamespace
            WHERE ns.nspname = 'public'
              AND cl.relname = v_spec.tabla
              AND c.contype = 'u'
              AND (
                  c.conname = v_spec.nuevo_nombre
                  OR (
                      SELECT array_agg(a.attname::text ORDER BY u.ord)
                      FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
                      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum
                  ) = ARRAY[v_spec.col1, v_spec.col2]
              )
        LOOP
            EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', v_spec.tabla, v_conname);
        END LOOP;

        EXECUTE format(
            'ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (%I, %I) DEFERRABLE INITIALLY DEFERRED',
            v_spec.tabla,
            v_spec.nuevo_nombre,
            v_spec.col1,
            v_spec.col2
        );
    END LOOP;
END;
$$;

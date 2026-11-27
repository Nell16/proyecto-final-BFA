-- ============================================================
-- B18: RESTRICCIONES UNIQUE DE ORDEN DEFERRABLE INITIALLY DEFERRED
-- ============================================================
-- Permite intercambiar o rotar posiciones ocupadas dentro de una misma
-- transaccion (por ejemplo en POST /test-versions/{id}/configuration),
-- posponiendo la validacion de unicidad hasta el COMMIT.

DO $$
DECLARE
    v_spec RECORD;
    v_conname TEXT;
    v_ya_deferrable BOOLEAN;
BEGIN
    FOR v_spec IN
        SELECT *
        FROM (VALUES
            ('subtest',        'version_test_id',      'numero_orden', 'uq_subtest_version_orden'),
            ('item',           'subtest_id',           'numero_orden', 'uq_item_subtest_orden'),
            ('imagen_item',    'item_id',              'numero_orden', 'uq_imagen_item_orden'),
            ('opcion_item',    'item_id',              'numero_orden', 'uq_opcion_item_orden'),
            ('imagen_opcion',  'opcion_id',            'numero_orden', 'uq_imagen_opcion_orden'),
            ('sesion_subtest', 'sesion_aplicacion_id', 'numero_orden', 'uq_sesion_subtest_orden')
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

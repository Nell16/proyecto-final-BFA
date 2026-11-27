-- Sesion de demostracion: un aspirante presenta el BFA real.
SET search_path = public, extensions;

DELETE FROM asignacion_test WHERE asignacion_id IN (10001,10002);
DELETE FROM sesion_aplicacion WHERE sesion_aplicacion_id IN (101,102);
DELETE FROM participante WHERE codigo_participante = 'ASP-2026-001';

INSERT INTO participante (participante_id, codigo_participante, nombres, apellidos, fecha_nacimiento,
                          sexo_id, carrera_id, cohorte_id, grupo_academico_id, estado, creado_en)
SELECT 'c0000000-0000-4000-8000-000000000001'::uuid, 'ASP-2026-001', 'Ana Lucia', 'Mendoza Rivas', DATE '2006-03-18',
       (SELECT sexo_id FROM catalogo_sexo ORDER BY sexo_id LIMIT 1),
       (SELECT carrera_id FROM carrera ORDER BY carrera_id LIMIT 1),
       (SELECT cohorte_id FROM cohorte ORDER BY cohorte_id DESC LIMIT 1),
       (SELECT grupo_academico_id FROM grupo_academico ORDER BY grupo_academico_id LIMIT 1),
       'ACTIVO', now() AT TIME ZONE 'UTC';

INSERT INTO sesion_aplicacion (sesion_aplicacion_id, version_test_id, codigo_sesion, nombre_sesion, descripcion,
                               inicio_programado, fin_programado, inicio_real, ubicacion, estado, creado_por, creado_en)
SELECT s.id, s.ver, s.cod, s.nom, s.des,
       (now() AT TIME ZONE 'UTC') - interval '10 minutes', (now() AT TIME ZONE 'UTC') + interval '6 hours',
       (now() AT TIME ZONE 'UTC') - interval '8 minutes', 'Laboratorio de Computo 2', 'ABIERTA',
       (SELECT usuario_id FROM usuario WHERE nombre_usuario='aplicador'), (now() AT TIME ZONE 'UTC') - interval '1 hour'
FROM (VALUES
 (101, 101, 'S-DEMO-BFA', 'BFA - Demostracion con aspirante', 'Sesion abierta para demostrar la aplicacion real del BFA.'),
 (102, 102, 'S-DEMO-WEILL', 'Weill - Demostracion con aspirante', 'Sesion abierta para demostrar la aplicacion del test no verbal de Weill.')
) AS s(id, ver, cod, nom, des);

INSERT INTO sesion_subtest (sesion_subtest_id, sesion_aplicacion_id, version_test_id, subtest_id, numero_orden, tiempo_limite_segundos)
SELECT sa.sesion_aplicacion_id * 10 + s.numero_orden, sa.sesion_aplicacion_id, sa.version_test_id,
       s.subtest_id, s.numero_orden, s.tiempo_limite_segundos
FROM sesion_aplicacion sa JOIN subtest s ON s.version_test_id = sa.version_test_id
WHERE sa.sesion_aplicacion_id IN (101,102);

INSERT INTO asignacion_test (asignacion_id, sesion_aplicacion_id, participante_id, evaluador_id, token_acceso_hash,
                             token_expira_en, intentos_acceso, edad_registrada_aplicacion, sexo_id_aplicacion,
                             carrera_id_aplicacion, cohorte_id_aplicacion, grupo_academico_id_aplicacion, asignado_en, estado)
SELECT a.id, a.ses, p.participante_id, (SELECT usuario_id FROM usuario WHERE nombre_usuario='aplicador'),
       crypt(a.tok, gen_salt('bf', 10)), (now() AT TIME ZONE 'UTC') + interval '30 days', 0,
       date_part('year', age(CURRENT_DATE, p.fecha_nacimiento))::smallint,
       p.sexo_id, p.carrera_id, p.cohorte_id, p.grupo_academico_id,
       (now() AT TIME ZONE 'UTC') - interval '1 hour', 'ASIGNADO'
FROM participante p, (VALUES (10001, 101, 'ASPIRANTE2026'), (10002, 102, 'WEILL2026')) AS a(id, ses, tok)
WHERE p.codigo_participante = 'ASP-2026-001';

DO $$ DECLARE v RECORD; BEGIN
  FOR v IN SELECT c.table_name, c.column_name, pg_get_serial_sequence(c.table_name, c.column_name) AS seq
           FROM information_schema.columns c WHERE c.table_schema='public' AND c.column_default LIKE 'nextval(%' LOOP
    EXECUTE format('SELECT setval(%L, COALESCE((SELECT max(%I) FROM %I),0)+1, false)', v.seq, v.column_name, v.table_name);
  END LOOP; END $$;

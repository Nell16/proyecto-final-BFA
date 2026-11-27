-- Weill (version 103, borrador): permite subir las 60 laminas antes de publicar.
-- Retira la version 102 sin imagenes. Luego: subir imagenes (API) y correr 04_publicar_weill.sql
SET search_path = public, extensions;
UPDATE version_test SET estado='RETIRADO' WHERE version_test_id=102 AND estado='PUBLICADO';
DELETE FROM test WHERE test_id IN (103);


-- 1. TESTS
INSERT INTO test (test_id, codigo_test, nombre_test, descripcion, creado_por, estado, creado_en)
SELECT t.id, t.cod, t.nom, t.des, (SELECT usuario_id FROM usuario WHERE nombre_usuario='psicologa'), 'ACTIVO', date_trunc('day', now() AT TIME ZONE 'UTC') - interval '30 days'
FROM (VALUES
  (103, 'WEILL-NV', 'Test No Verbal de Inteligencia (Pierre Gilles Weill)', 'Prueba no verbal Forma A: 60 reactivos de completamiento de figuras, cada uno con ocho opciones graficas. Clave y baremos tomados de la Tabla de Calificaciones de Weill.')
) AS t(id, cod, nom, des);

-- 2. VERSIONES
INSERT INTO version_test (version_test_id, test_id, estrategia_calificacion_id, numero_version, estado,
                          instrucciones_generales, tiempo_limite_segundos, aprobado_por, aprobado_en, creado_por, creado_en)
SELECT v.id, v.test, (SELECT estrategia_calificacion_id FROM estrategia_calificacion WHERE codigo='CLAVE_SIMPLE'), v.num, 'BORRADOR', v.instr, v.t, (SELECT usuario_id FROM usuario WHERE nombre_usuario='psicologa'), date_trunc('day', now() AT TIME ZONE 'UTC') - interval '20 days', (SELECT usuario_id FROM usuario WHERE nombre_usuario='psicologa'), date_trunc('day', now() AT TIME ZONE 'UTC') - interval '30 days'
FROM (VALUES
  (103, 103, 'Forma A', 'Observe la figura incompleta de cada recuadro y elija, entre las ocho opciones numeradas, la que completa correctamente el dibujo. Marque una sola respuesta por ejercicio.', 1800)
) AS v(id, test, num, instr, t);

-- 3. SUBTESTS
INSERT INTO subtest (subtest_id, version_test_id, estrategia_calificacion_id, codigo_subtest, nombre_subtest,
                     descripcion, instrucciones, numero_orden, tiempo_limite_segundos)
SELECT s.id, s.ver, (SELECT estrategia_calificacion_id FROM estrategia_calificacion WHERE codigo='CLAVE_SIMPLE'), s.cod, s.nom, s.des, s.ins, s.ord, s.t FROM (VALUES
  (1031, 103, 'NV', 'Prueba no verbal, Forma A', 'Completamiento de figuras con ocho alternativas graficas.', 'Elija el numero de la opcion que completa la figura. Un punto por acierto.', 1, 1800)
) AS s(id, ver, cod, nom, des, ins, ord, t);

-- 4. ITEMS Y OPCIONES
INSERT INTO item (item_id, subtest_id, codigo_item, tipo_item, tipo_respuesta, enunciado, numero_orden, puntaje_base)
SELECT 1031000+n, 1031, 'NV-'||lpad(n::text,2,'0'), 'SOLO_IMAGEN', 'OPCION_UNICA', 'Elija la opcion que completa la figura (ejercicio '||n||').', n, 1.00 FROM generate_series(1,60) n;

INSERT INTO opcion_item (opcion_id, item_id, codigo_opcion, texto_opcion, numero_orden)
SELECT (1031000+n)*10+j, 1031000+n, j::text, j::text, j FROM generate_series(1,60) n, generate_series(1,8) j;

-- 5. DIMENSIONES, REGLAS Y CLAVES
INSERT INTO dimension_resultado (dimension_resultado_id, version_test_id, subtest_id, codigo_dimension, nombre_dimension, descripcion, orden_presentacion, puntaje_minimo, puntaje_maximo, creado_en)
SELECT s.subtest_id, s.version_test_id, s.subtest_id, s.codigo_subtest, s.nombre_subtest, 'Puntaje directo de ' || s.nombre_subtest, s.numero_orden, 0, (SELECT count(*) FROM item i WHERE i.subtest_id = s.subtest_id), date_trunc('day', now() AT TIME ZONE 'UTC') - interval '25 days'
FROM subtest s  WHERE s.version_test_id IN (103);

INSERT INTO regla_calificacion (regla_calificacion_id, version_test_id, subtest_id, estrategia_calificacion_id, tipo_regla, prioridad, activa, estado, parametros, observacion, creado_por, creado_en, aprobado_por, aprobado_en)
SELECT s.subtest_id, s.version_test_id, s.subtest_id, (SELECT estrategia_calificacion_id FROM estrategia_calificacion WHERE codigo='CLAVE_SIMPLE'), 'CLAVE_ITEM', 1, TRUE, 'PUBLICADO',
       jsonb_build_object('puntaje_por_acierto', 1, 'omitida_cuenta_como', 'INCORRECTA'),
       'Un punto por acierto en ' || s.nombre_subtest, (SELECT usuario_id FROM usuario WHERE nombre_usuario='psicologa'), date_trunc('day', now() AT TIME ZONE 'UTC') - interval '25 days', (SELECT usuario_id FROM usuario WHERE nombre_usuario='psicologa'), date_trunc('day', now() AT TIME ZONE 'UTC') - interval '20 days'
FROM subtest s  WHERE s.version_test_id IN (103);

INSERT INTO clave_respuesta (clave_respuesta_id, regla_calificacion_id, item_id, opcion_correcta_id, puntaje, creado_por, creado_en)
SELECT 1031000+n, 1031, 1031000+n, (1031000+n)*10+substr('287456844732287456844732287456844732287456844732287456844732',n,1)::int, 1.00, (SELECT usuario_id FROM usuario WHERE nombre_usuario='psicologa'), date_trunc('day', now() AT TIME ZONE 'UTC') - interval '25 days' FROM generate_series(1,60) n;

INSERT INTO opcion_puntaje_dimension (opcion_puntaje_dimension_id, regla_calificacion_id, opcion_id, dimension_resultado_id, puntaje, peso, activa, creado_en)
SELECT c.clave_respuesta_id, c.regla_calificacion_id, c.opcion_correcta_id, i.subtest_id, 1.00, 1.0000, TRUE, date_trunc('day', now() AT TIME ZONE 'UTC') - interval '25 days'
FROM clave_respuesta c JOIN item i ON i.item_id = c.item_id  WHERE i.subtest_id IN (1031);

-- 6. BAREMOS
INSERT INTO baremo (baremo_id, version_test_id, dimension_resultado_id, codigo_baremo, nombre, descripcion, grupo_normativo, criterio_edad_minima, criterio_edad_maxima, vigente_desde, estado, creado_por, creado_en, aprobado_por, aprobado_en)
SELECT b.id, b.ver, b.dim, b.cod, b.nom, b.des, b.grp, b.emin, b.emax, (date_trunc('day', now() AT TIME ZONE 'UTC') - interval '1 year')::date, 'PUBLICADO', (SELECT usuario_id FROM usuario WHERE nombre_usuario='psicologa'), date_trunc('day', now() AT TIME ZONE 'UTC') - interval '25 days', (SELECT usuario_id FROM usuario WHERE nombre_usuario='psicologa'), date_trunc('day', now() AT TIME ZONE 'UTC') - interval '20 days'
FROM (VALUES
(1031,103,1031,'BAR-WEILL-UN','Baremo Weill - universitarios','Tabla de Calificaciones de Weill, columna UN (universitarios), con la equivalencia percentil-CI de Wechsler 1955.','Baremos Weill, columna UN (universitarios)',17,60)) AS b(id, ver, dim, cod, nom, des, grp, emin, emax);

INSERT INTO rango_baremo (rango_baremo_id, baremo_id, puntaje_minimo, puntaje_maximo, percentil, categoria, interpretacion, recomendacion, orden) VALUES
(103101, 1031, 0, 34, 1, 'Muy bajo', 'Percentil 1 del grupo normativo. CI equivalente aproximado (Wechsler 1955): 65', 'Reforzamiento y reevaluacion.', 1),
(103102, 1031, 35, 39, 5, 'Muy bajo', 'Percentil 5 del grupo normativo. CI equivalente aproximado (Wechsler 1955): 75', 'Reforzamiento y reevaluacion.', 2),
(103103, 1031, 40, 41, 10, 'Bajo', 'Percentil 10 del grupo normativo. CI equivalente aproximado (Wechsler 1955): 81', 'Acompanamiento academico.', 3),
(103104, 1031, 42, 43, 20, 'Bajo', 'Percentil 20 del grupo normativo. CI equivalente aproximado (Wechsler 1955): 87', 'Acompanamiento academico.', 4),
(103105, 1031, 44, 45, 25, 'Bajo', 'Percentil 25 del grupo normativo. CI equivalente aproximado (Wechsler 1955): 90', 'Acompanamiento academico.', 5),
(103106, 1031, 46, 48, 30, 'Medio bajo', 'Percentil 30 del grupo normativo. CI equivalente aproximado (Wechsler 1955): 92', 'Seguimiento opcional.', 6),
(103107, 1031, 49, 50, 40, 'Medio bajo', 'Percentil 40 del grupo normativo. CI equivalente aproximado (Wechsler 1955): 96', 'Seguimiento opcional.', 7),
(103108, 1031, 51, 52, 50, 'Medio', 'Percentil 50 del grupo normativo. CI equivalente aproximado (Wechsler 1955): 100', 'Sin acciones adicionales.', 8),
(103109, 1031, 53, 53, 60, 'Medio', 'Percentil 60 del grupo normativo. CI equivalente aproximado (Wechsler 1955): 104', 'Sin acciones adicionales.', 9),
(103110, 1031, 54, 54, 70, 'Medio alto', 'Percentil 70 del grupo normativo. CI equivalente aproximado (Wechsler 1955): 108', 'Sin acciones adicionales.', 10),
(103111, 1031, 55, 55, 75, 'Medio alto', 'Percentil 75 del grupo normativo. CI equivalente aproximado (Wechsler 1955): 110', 'Sin acciones adicionales.', 11),
(103112, 1031, 56, 56, 80, 'Medio alto', 'Percentil 80 del grupo normativo. CI equivalente aproximado (Wechsler 1955): 113', 'Sin acciones adicionales.', 12),
(103113, 1031, 57, 60, 90, 'Alto', 'Percentil 90 del grupo normativo. CI equivalente aproximado (Wechsler 1955): 119', 'Perfil destacado.', 13);


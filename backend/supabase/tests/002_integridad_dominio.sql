begin;

select plan(106);

-- Los triggers diferidos se fuerzan al final de cada sentencia salvo en las
-- pruebas que emulan el patron transaccional del backend, que difieren
-- explicitamente y vuelven a IMMEDIATE para disparar la validacion.
set constraints all immediate;

-- ============================================================
-- ESTRUCTURA
-- ============================================================

select has_table('public', 'clave_respuesta_opcion', 'Existe la tabla de conjuntos de opciones correctas');
select has_column('public', 'clave_respuesta', 'usa_conjunto_opciones', 'La clave declara si usa conjunto de opciones');
select has_view('public', 'diagnostico_integridad_dominio', 'Existe la vista de diagnostico de integridad');

-- ============================================================
-- FIXTURE: DOS INSTRUMENTOS Y TRES VERSIONES (V1 y V2 se publican, V3 queda en borrador)
-- ============================================================

insert into usuario (usuario_id, nombre_usuario, correo, hash_contrasena, nombre_completo) values
('00000000-0000-0000-0000-0000000000a1', 'psicologo_prueba', 'psicologo@prueba.local', 'x', 'Psicologo Prueba');

insert into participante (participante_id, codigo_participante, nombres, apellidos) values
('00000000-0000-0000-0000-0000000000b1', 'P-001', 'Ana', 'Uno'),
('00000000-0000-0000-0000-0000000000b2', 'P-002', 'Luis', 'Dos');

insert into test (test_id, codigo_test, nombre_test) values
(9001, 'T-UNO', 'Instrumento uno'),
(9002, 'T-DOS', 'Instrumento dos');

insert into version_test (version_test_id, test_id, estrategia_calificacion_id, numero_version) values
(9101, 9001, (select estrategia_calificacion_id from estrategia_calificacion where codigo = 'CLAVE_SIMPLE'), '1'),
(9102, 9002, (select estrategia_calificacion_id from estrategia_calificacion where codigo = 'CLAVE_SIMPLE'), '1'),
(9103, 9001, (select estrategia_calificacion_id from estrategia_calificacion where codigo = 'CLAVE_SIMPLE'), '3');

insert into subtest (subtest_id, version_test_id, codigo_subtest, nombre_subtest, numero_orden) values
(9201, 9101, 'S11', 'Subtest 1.1', 1),
(9202, 9101, 'S12', 'Subtest 1.2', 2),
(9203, 9101, 'S13', 'Subtest 1.3', 3),
(9211, 9102, 'S21', 'Subtest 2.1', 1),
(9212, 9102, 'S22', 'Subtest 2.2', 2),
(9221, 9103, 'S31', 'Subtest 3.1', 1);

insert into item (item_id, subtest_id, codigo_item, tipo_item, tipo_respuesta, numero_orden) values
(9301, 9201, 'UNICA', 'SOLO_TEXTO', 'OPCION_UNICA', 1),
(9302, 9201, 'MULT', 'SOLO_TEXTO', 'OPCION_MULTIPLE', 2),
(9303, 9201, 'VF', 'SOLO_TEXTO', 'VERDADERO_FALSO', 3),
(9304, 9201, 'TEXTO', 'SOLO_TEXTO', 'TEXTO_ABIERTO', 4),
(9305, 9201, 'NUM', 'SOLO_TEXTO', 'NUMERICA', 5),
(9306, 9202, 'I12', 'SOLO_TEXTO', 'OPCION_UNICA', 1),
(9307, 9203, 'I13', 'SOLO_TEXTO', 'OPCION_UNICA', 1),
(9311, 9211, 'I21', 'SOLO_TEXTO', 'OPCION_UNICA', 1),
(9312, 9211, 'I2M', 'SOLO_TEXTO', 'OPCION_MULTIPLE', 2),
(9313, 9212, 'I22', 'SOLO_TEXTO', 'OPCION_UNICA', 1),
(9321, 9221, 'I31', 'SOLO_TEXTO', 'OPCION_UNICA', 1);

insert into opcion_item (opcion_id, item_id, codigo_opcion, numero_orden) values
(9401, 9301, 'A', 1), (9402, 9301, 'B', 2),
(9403, 9302, 'A', 1), (9404, 9302, 'B', 2), (9405, 9302, 'C', 3),
(9406, 9303, 'V', 1), (9407, 9303, 'F', 2),
(9408, 9304, 'X', 1),
(9409, 9306, 'A', 1),
(9410, 9307, 'A', 1),
(9411, 9311, 'A', 1), (9412, 9311, 'B', 2),
(9413, 9312, 'A', 1), (9414, 9312, 'B', 2), (9415, 9312, 'C', 3),
(9416, 9313, 'A', 1),
(9421, 9321, 'A', 1);

insert into dimension_resultado (dimension_resultado_id, version_test_id, codigo_dimension, nombre_dimension, orden_presentacion) values
(9501, 9101, 'D1', 'Dimension uno', 1),
(9502, 9102, 'D2', 'Dimension dos', 1);

insert into regla_calificacion (regla_calificacion_id, version_test_id, subtest_id, item_id, estrategia_calificacion_id, tipo_regla) values
(9601, 9101, null, null, (select estrategia_calificacion_id from estrategia_calificacion where codigo = 'CLAVE_SIMPLE'), 'CLAVE_ITEM'),
(9602, 9101, 9202, null, (select estrategia_calificacion_id from estrategia_calificacion where codigo = 'CLAVE_SIMPLE'), 'CLAVE_ITEM'),
(9611, 9102, null, null, (select estrategia_calificacion_id from estrategia_calificacion where codigo = 'CLAVE_SIMPLE'), 'CLAVE_ITEM'),
(9612, 9102, 9211, null, (select estrategia_calificacion_id from estrategia_calificacion where codigo = 'CLAVE_SIMPLE'), 'CLAVE_ITEM'),
(9621, 9103, null, null, (select estrategia_calificacion_id from estrategia_calificacion where codigo = 'CLAVE_SIMPLE'), 'CLAVE_ITEM');

insert into clave_respuesta (clave_respuesta_id, regla_calificacion_id, item_id, opcion_correcta_id) values
(9701, 9601, 9301, 9401),
(9711, 9612, 9311, 9411);

insert into opcion_puntaje_dimension (opcion_puntaje_dimension_id, regla_calificacion_id, opcion_id, dimension_resultado_id, puntaje) values
(9801, 9601, 9401, 9501, 1);

insert into baremo (baremo_id, version_test_id, dimension_resultado_id, codigo_baremo, nombre) values
(9901, 9101, 9501, 'B1', 'Baremo uno'),
(9902, 9102, 9502, 'B2', 'Baremo dos');

insert into rango_baremo (rango_baremo_id, baremo_id, puntaje_minimo, puntaje_maximo, categoria, orden) values
(9951, 9901, 0, 10, 'MEDIO', 1);

insert into rubrica_evaluacion (rubrica_id, version_test_id, subtest_id, item_id, codigo_rubrica, nombre) values
(10001, 9101, 9201, 9304, 'RU1', 'Rubrica texto'),
(10002, 9102, null, null, 'RU2', 'Rubrica version dos');

insert into criterio_rubrica (criterio_rubrica_id, rubrica_id, codigo_criterio, nombre, puntaje_maximo, orden) values
(10101, 10001, 'C1', 'Criterio uno', 2, 1),
(10102, 10002, 'C2', 'Criterio dos', 2, 1);

insert into nivel_criterio_rubrica (nivel_criterio_rubrica_id, criterio_rubrica_id, codigo_nivel, nombre, puntaje, orden) values
(10201, 10101, 'N1', 'Nivel uno', 1, 1),
(10202, 10102, 'N2', 'Nivel dos', 1, 1);

insert into recurso_multimedia (recurso_id, nombre_archivo, ruta_almacenamiento, tipo_mime) values
(10301, 'enlazada.png', 'privado/enlazada.png', 'image/png'),
(10302, 'libre.png', 'privado/libre.png', 'image/png');

insert into imagen_item (imagen_item_id, item_id, recurso_id) values
(10401, 9301, 10301);

-- ============================================================
-- ALCANCE DE CONFIGURACION (VERSIONES EN BORRADOR)
-- ============================================================

select throws_like(
    $$insert into clave_respuesta (clave_respuesta_id, regla_calificacion_id, item_id, opcion_correcta_id) values (9790, 9601, 9311, 9411)$$,
    '%fuera del alcance de la regla%',
    'Una clave no puede usar un item de otra version que su regla'
);
select throws_like(
    $$insert into clave_respuesta (clave_respuesta_id, regla_calificacion_id, item_id, opcion_correcta_id) values (9791, 9602, 9301, 9401)$$,
    '%fuera del alcance de la regla%',
    'Una clave no puede usar un item fuera del subtest de su regla'
);
select lives_ok(
    $$insert into clave_respuesta (clave_respuesta_id, regla_calificacion_id, item_id, opcion_correcta_id) values (9702, 9602, 9306, 9409)$$,
    'Una clave dentro del subtest de su regla es valida'
);
select throws_like(
    $$insert into opcion_puntaje_dimension (opcion_puntaje_dimension_id, regla_calificacion_id, opcion_id, dimension_resultado_id) values (9890, 9601, 9411, 9501)$$,
    '%fuera del alcance de la regla%',
    'La matriz no acepta opciones de otra version que la regla'
);
select throws_like(
    $$insert into opcion_puntaje_dimension (opcion_puntaje_dimension_id, regla_calificacion_id, opcion_id, dimension_resultado_id) values (9891, 9601, 9402, 9502)$$,
    '%no pertenece a la version de la regla%',
    'La matriz no acepta dimensiones de otra version que la regla'
);
select lives_ok(
    $$insert into opcion_puntaje_dimension (opcion_puntaje_dimension_id, regla_calificacion_id, opcion_id, dimension_resultado_id) values (9802, 9601, 9402, 9501)$$,
    'Una fila de matriz opcion-regla-dimension coherente es valida'
);
select throws_like(
    $$update regla_calificacion set subtest_id = 9212 where regla_calificacion_id = 9612$$,
    '%nuevo alcance deja claves%',
    'Cambiar el alcance de una regla no puede dejar claves fuera de alcance'
);
select throws_like(
    $$update item set subtest_id = 9211, numero_orden = 50 where item_id = 9307$$,
    '%otra version%',
    'Un item no puede moverse a un subtest de otra version'
);
select lives_ok(
    $$update item set subtest_id = 9211, numero_orden = 10 where item_id = 9313$$,
    'Un item en borrador puede moverse dentro de su version'
);
select throws_like(
    $$update criterio_rubrica set rubrica_id = 10002 where criterio_rubrica_id = 10101$$,
    '%no puede modificarse%',
    'Un criterio no cambia de rubrica'
);
select throws_like(
    $$update subtest set version_test_id = 9102 where subtest_id = 9203$$,
    '%no puede modificarse%',
    'Un subtest no cambia de version'
);

-- ============================================================
-- CONJUNTO EXACTO DE OPCIONES CORRECTAS
-- ============================================================

select lives_ok(
    $$set constraints all deferred;
      insert into clave_respuesta (clave_respuesta_id, regla_calificacion_id, item_id, usa_conjunto_opciones) values (9712, 9611, 9312, true);
      insert into clave_respuesta_opcion (clave_respuesta_id, item_id, opcion_id) values (9712, 9312, 9413), (9712, 9312, 9414);
      set constraints all immediate$$,
    'Una clave OPCION_MULTIPLE puede declarar un conjunto exacto de opciones'
);
select results_eq(
    $$select opcion_id from clave_respuesta_opcion where clave_respuesta_id = 9712 order by opcion_id$$,
    array[9413::bigint, 9414::bigint],
    'El conjunto conserva exactamente las opciones declaradas'
);
select throws_like(
    $$set constraints all deferred;
      insert into clave_respuesta (clave_respuesta_id, regla_calificacion_id, item_id, usa_conjunto_opciones) values (9713, 9612, 9312, true);
      update clave_respuesta_opcion set clave_respuesta_id = 9713 where clave_respuesta_id = 9712;
      set constraints all immediate$$,
    '%clave_respuesta_id no puede modificarse%',
    'Trasladar opciones no puede dejar vacia la clave de origen'
);
select throws_like(
    $$set constraints all deferred;
      insert into clave_respuesta (clave_respuesta_id, regla_calificacion_id, item_id, usa_conjunto_opciones) values (9713, 9612, 9312, true);
      set constraints all immediate$$,
    '%requiere al menos una opcion%',
    'Una clave de conjunto requiere al menos una opcion'
);
select throws_like(
    $$set constraints all deferred;
      insert into clave_respuesta (clave_respuesta_id, regla_calificacion_id, item_id, opcion_correcta_id) values (9714, 9612, 9312, 9413);
      insert into clave_respuesta_opcion (clave_respuesta_id, item_id, opcion_id) values (9714, 9312, 9414);
      set constraints all immediate$$,
    '%usa_conjunto_opciones es FALSE%',
    'Una clave singular no puede tener filas de conjunto'
);
select throws_like(
    $$insert into clave_respuesta (clave_respuesta_id, regla_calificacion_id, item_id, opcion_correcta_id, usa_conjunto_opciones) values (9716, 9612, 9312, 9413, true)$$,
    '%ck_clave_conjunto_exclusivo%',
    'Una clave de conjunto no informa opcion_correcta_id'
);
select throws_ok(
    $$insert into clave_respuesta_opcion (clave_respuesta_id, item_id, opcion_id) values (9712, 9312, 9411)$$,
    '23503',
    null,
    'El conjunto solo admite opciones del item de la clave'
);
select throws_like(
    $$set constraints all deferred;
      insert into clave_respuesta (clave_respuesta_id, regla_calificacion_id, item_id, usa_conjunto_opciones) values (9715, 9611, 9311, true);
      insert into clave_respuesta_opcion (clave_respuesta_id, item_id, opcion_id) values (9715, 9311, 9411);
      set constraints all immediate$$,
    '%solo aplica a items OPCION_MULTIPLE%',
    'El conjunto de opciones correctas solo aplica a items OPCION_MULTIPLE'
);
select throws_like(
    $$update item set tipo_respuesta = 'OPCION_UNICA' where item_id = 9312$$,
    '%debe seguir siendo OPCION_MULTIPLE%',
    'Un item con conjunto de opciones no cambia a seleccion unica'
);
select results_eq(
    $$select opcion_correcta_id, usa_conjunto_opciones from clave_respuesta where clave_respuesta_id = 9701$$,
    $$values (9401::bigint, false)$$,
    'La clave singular historica se conserva sin cambios'
);

-- ============================================================
-- PUBLICACION CON EL ORDEN DE ESCRITURAS DEL BACKEND
-- ============================================================

select lives_ok(
    $$update version_test set estado = 'APROBADO', aprobado_por = '00000000-0000-0000-0000-0000000000a1', aprobado_en = now() where version_test_id = 9101;
      update regla_calificacion set estado = 'PUBLICADO', aprobado_por = '00000000-0000-0000-0000-0000000000a1', aprobado_en = now()
       where version_test_id = 9101 and activa and estado <> 'RETIRADO';
      update baremo set estado = 'PUBLICADO', aprobado_por = '00000000-0000-0000-0000-0000000000a1', aprobado_en = now()
       where version_test_id = 9101 and estado <> 'RETIRADO';
      update version_test set estado = 'PUBLICADO', publicado_en = now() where version_test_id = 9101$$,
    'Se publica V1 aprobando, publicando reglas y baremos y luego la version'
);
select lives_ok(
    $$update version_test set estado = 'APROBADO', aprobado_por = '00000000-0000-0000-0000-0000000000a1', aprobado_en = now() where version_test_id = 9102;
      update regla_calificacion set estado = 'PUBLICADO', aprobado_por = '00000000-0000-0000-0000-0000000000a1', aprobado_en = now()
       where version_test_id = 9102 and activa and estado <> 'RETIRADO';
      update baremo set estado = 'PUBLICADO', aprobado_por = '00000000-0000-0000-0000-0000000000a1', aprobado_en = now()
       where version_test_id = 9102 and estado <> 'RETIRADO';
      update version_test set estado = 'PUBLICADO', publicado_en = now() where version_test_id = 9102$$,
    'Se publica V2 con el mismo orden de escrituras'
);

-- ============================================================
-- INMUTABILIDAD DEL CONTENIDO OFICIAL
-- ============================================================

select throws_like($$update item set enunciado = 'otro' where item_id = 9301$$,
    '%Contenido oficial inmutable%', 'No se edita un item publicado');
select throws_like($$insert into opcion_item (opcion_id, item_id, codigo_opcion, numero_orden) values (9490, 9301, 'Z', 9)$$,
    '%Contenido oficial inmutable%', 'No se agregan opciones a un item publicado');
select throws_like($$delete from opcion_item where opcion_id = 9402$$,
    '%Contenido oficial inmutable%', 'No se borran opciones publicadas');
select throws_like($$update regla_calificacion set parametros = '{"x": 1}' where regla_calificacion_id = 9601$$,
    '%Contenido oficial inmutable%', 'No se editan parametros de reglas publicadas');
select throws_like($$update regla_calificacion set estado = 'RETIRADO' where regla_calificacion_id = 9601$$,
    '%Contenido oficial inmutable%', 'No se cambia el estado de reglas de una version publicada');
select throws_like($$insert into clave_respuesta (clave_respuesta_id, regla_calificacion_id, item_id, opcion_correcta_id) values (9792, 9601, 9303, 9406)$$,
    '%Contenido oficial inmutable%', 'No se agregan claves a una version publicada');
select throws_like($$delete from clave_respuesta_opcion where clave_respuesta_id = 9712 and opcion_id = 9414$$,
    '%Contenido oficial inmutable%', 'No se modifica un conjunto de opciones publicado');
select throws_like($$update opcion_puntaje_dimension set puntaje = 5 where opcion_puntaje_dimension_id = 9801$$,
    '%Contenido oficial inmutable%', 'No se modifica la matriz publicada');
select throws_like($$update dimension_resultado set nombre_dimension = 'otra' where dimension_resultado_id = 9501$$,
    '%Contenido oficial inmutable%', 'No se editan dimensiones publicadas');
select throws_like($$update baremo set nombre = 'otro' where baremo_id = 9901$$,
    '%Contenido oficial inmutable%', 'No se editan baremos publicados');
select throws_like($$insert into rango_baremo (rango_baremo_id, baremo_id, puntaje_minimo, puntaje_maximo, categoria, orden) values (9952, 9901, 20, 30, 'ALTO', 2)$$,
    '%Contenido oficial inmutable%', 'No se agregan rangos a baremos publicados');
select throws_like($$update criterio_rubrica set nombre = 'otro' where criterio_rubrica_id = 10101$$,
    '%Contenido oficial inmutable%', 'No se editan criterios de rubricas publicadas');
select throws_like($$delete from nivel_criterio_rubrica where nivel_criterio_rubrica_id = 10201$$,
    '%Contenido oficial inmutable%', 'No se borran niveles de rubricas publicadas');
select throws_like($$insert into subtest (subtest_id, version_test_id, codigo_subtest, nombre_subtest, numero_orden) values (9204, 9101, 'S14', 'Nuevo', 4)$$,
    '%Contenido oficial inmutable%', 'No se agregan subtests a una version publicada');
select throws_like($$insert into imagen_item (imagen_item_id, item_id, recurso_id) values (10402, 9303, 10302)$$,
    '%Contenido oficial inmutable%', 'No se enlazan imagenes a items publicados');
select throws_like($$update recurso_multimedia set ruta_almacenamiento = 'privado/otra.png' where recurso_id = 10301$$,
    '%Contenido oficial inmutable%', 'No se cambian metadatos de recursos enlazados a contenido publicado');
select lives_ok($$update recurso_multimedia set ruta_almacenamiento = 'privado/libre-2.png' where recurso_id = 10302$$,
    'Un recurso no enlazado a contenido oficial sigue siendo editable');
select lives_ok($$update item set enunciado = enunciado, numero_orden = numero_orden where item_id = 9301$$,
    'Una actualizacion sin cambios (flush JPA) sobre contenido publicado se permite');
select lives_ok($$update item set enunciado = 'editable' where item_id = 9321$$,
    'El contenido de una version en borrador sigue siendo editable');
select throws_like($$update version_test set instrucciones_generales = 'nuevas' where version_test_id = 9101$$,
    '%solo puede pasar a RETIRADO%', 'No se editan atributos de una version publicada');
select throws_like($$update version_test set estado = 'BORRADOR' where version_test_id = 9101$$,
    '%solo puede pasar a RETIRADO%', 'Una version publicada no vuelve a borrador');
select throws_like($$delete from version_test where version_test_id = 9101$$,
    '%no se elimina la version%', 'No se elimina una version publicada');

-- ============================================================
-- SESIONES, ASIGNACIONES E INTENTOS
-- ============================================================

select throws_like(
    $$insert into sesion_aplicacion (sesion_aplicacion_id, version_test_id, codigo_sesion, nombre_sesion, inicio_programado) values (11090, 9103, 'SES-X', 'Borrador', now())$$,
    '%requiere una version PUBLICADO%',
    'No se crean sesiones sobre versiones en borrador'
);

insert into sesion_aplicacion (sesion_aplicacion_id, version_test_id, codigo_sesion, nombre_sesion, inicio_programado) values
(11001, 9101, 'SES-1', 'Sesion uno', now()),
(11002, 9102, 'SES-2', 'Sesion dos', now()),
(11003, 9101, 'SES-3', 'Sesion sin intentos', now());

insert into sesion_subtest (sesion_subtest_id, sesion_aplicacion_id, version_test_id, subtest_id, numero_orden) values
(11101, 11001, 9101, 9201, 1),
(11102, 11001, 9101, 9202, 2),
(11111, 11002, 9102, 9211, 1);

insert into asignacion_test (asignacion_id, sesion_aplicacion_id, participante_id, evaluador_id, token_acceso_hash, token_expira_en) values
(11201, 11001, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'hash-1', now() + interval '1 day'),
(11202, 11002, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'hash-2', now() + interval '1 day'),
(11203, 11003, '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 'hash-3', now() + interval '1 day'),
(11204, 11001, '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 'hash-4', now() + interval '1 day');

select throws_like(
    $$insert into intento_test (intento_id, asignacion_id, ultimo_subtest_id) values (11301, 11201, 9203)$$,
    '%no esta configurado en la sesion%',
    'Un intento nuevo rechaza un ultimo subtest que no pertenece a la sesion'
);
select lives_ok(
    $$insert into intento_test (intento_id, asignacion_id, estado, ultimo_subtest_id) values (11301, 11201, 'EN_PROGRESO', 9201)$$,
    'Un intento nuevo admite un ultimo subtest valido'
);

insert into intento_test (intento_id, asignacion_id, estado) values
(11302, 11202, 'EN_PROGRESO'),
(11304, 11204, 'EN_PROGRESO');

insert into intento_subtest (intento_subtest_id, intento_id, sesion_subtest_id, subtest_id) values
(11402, 11302, 11111, 9211),
(11404, 11304, 11101, 9201);

insert into respuesta_item (respuesta_id, intento_id, item_id) values
(11510, 11302, 9311);

select lives_ok(
    $$insert into intento_subtest (intento_subtest_id, intento_id, sesion_subtest_id, subtest_id) values (11401, 11301, 11101, 9201)$$,
    'Un intento_subtest coherente con intento, sesion y subtest es valido'
);
select throws_like(
    $$insert into intento_subtest (intento_subtest_id, intento_id, sesion_subtest_id, subtest_id) values (11490, 11301, 11111, 9211)$$,
    '%no pertenece a la sesion del intento%',
    'Un intento_subtest no usa sesion_subtest de otra sesion'
);
select throws_ok(
    $$insert into intento_subtest (intento_subtest_id, intento_id, sesion_subtest_id, subtest_id) values (11491, 11301, 11101, 9202)$$,
    '23503',
    null,
    'El subtest del intento_subtest debe coincidir con su sesion_subtest'
);
select throws_like(
    $$update intento_test set ultimo_subtest_id = 9203 where intento_id = 11301$$,
    '%no esta configurado en la sesion%',
    'El ultimo subtest del intento debe estar configurado en su sesion'
);
select lives_ok(
    $$update intento_test set ultimo_subtest_id = 9201 where intento_id = 11301$$,
    'El ultimo subtest configurado en la sesion es valido'
);

-- ============================================================
-- ALCANCE DE RESPUESTAS
-- ============================================================

select lives_ok(
    $$insert into respuesta_item (respuesta_id, intento_id, item_id) values (11501, 11301, 9301)$$,
    'Una respuesta a un item de un subtest de la sesion es valida (intento_subtest NULL)'
);
select throws_like(
    $$insert into respuesta_item (respuesta_id, intento_id, item_id) values (11590, 11301, 9307)$$,
    '%no pertenece a un subtest configurado en la sesion%',
    'No se responde un item de un subtest no configurado en la sesion'
);
select throws_like(
    $$insert into respuesta_item (respuesta_id, intento_id, item_id) values (11591, 11301, 9311)$$,
    '%no pertenece a un subtest configurado en la sesion%',
    'No se responde un item de otra version'
);
select throws_ok(
    $$insert into respuesta_item (respuesta_id, intento_id, item_id, intento_subtest_id) values (11592, 11301, 9303, 11404)$$,
    '23503',
    null,
    'El intento_subtest de una respuesta debe ser del mismo intento'
);
select throws_like(
    $$insert into respuesta_item (respuesta_id, intento_id, item_id, intento_subtest_id) values (11593, 11301, 9306, 11401)$$,
    '%no corresponde al subtest del item%',
    'El intento_subtest de una respuesta debe ser del subtest del item'
);
select lives_ok(
    $$insert into respuesta_item (respuesta_id, intento_id, item_id, intento_subtest_id) values (11502, 11301, 9302, 11401)$$,
    'Una respuesta con intento_subtest coherente es valida'
);
select throws_like(
    $$update respuesta_item set item_id = 9302 where respuesta_id = 11501$$,
    '%no puede modificarse%',
    'Una respuesta no cambia de item'
);

-- ============================================================
-- ALMACENAMIENTO POR TIPO DE RESPUESTA
-- ============================================================

select throws_like(
    $$update respuesta_item set respuesta_texto_abierto = 'hola' where respuesta_id = 11501$$,
    '%respuesta de texto no permitida%',
    'Un item de opcion unica no guarda texto'
);
select lives_ok(
    $$update respuesta_item set respuesta_texto_abierto = '  ' where respuesta_id = 11501;
      update respuesta_item set respuesta_texto_abierto = null where respuesta_id = 11501$$,
    'El texto en blanco se trata como respuesta vacia'
);
select throws_like(
    $$insert into respuesta_item (respuesta_id, intento_id, item_id, respuesta_numerica) values (11503, 11301, 9304, 5)$$,
    '%respuesta numerica no permitida%',
    'Un item de texto abierto no guarda numero'
);
select lives_ok(
    $$insert into respuesta_item (respuesta_id, intento_id, item_id, respuesta_texto_abierto) values (11503, 11301, 9304, 'respuesta abierta')$$,
    'Un item de texto abierto guarda texto'
);
select lives_ok(
    $$insert into respuesta_item (respuesta_id, intento_id, item_id, respuesta_numerica) values (11504, 11301, 9305, 3.5)$$,
    'Un item numerico guarda numero'
);
select throws_like(
    $$insert into opcion_seleccionada_respuesta (respuesta_id, item_id, opcion_id) values (11503, 9304, 9408)$$,
    '%opciones seleccionadas no permitidas%',
    'Un item de texto abierto no guarda selecciones'
);
select lives_ok(
    $$insert into respuesta_item (respuesta_id, intento_id, item_id) values (11505, 11301, 9303)$$,
    'Una respuesta vacia es valida'
);
select throws_like(
    $$insert into opcion_seleccionada_respuesta (respuesta_id, item_id, opcion_id) values (11501, 9301, 9401), (11501, 9301, 9402)$$,
    '%a lo sumo una opcion%',
    'Opcion unica admite a lo sumo una seleccion'
);
select throws_like(
    $$insert into opcion_seleccionada_respuesta (respuesta_id, item_id, opcion_id) values (11505, 9303, 9406), (11505, 9303, 9407)$$,
    '%a lo sumo una opcion%',
    'Verdadero/falso admite a lo sumo una seleccion'
);
select lives_ok(
    $$insert into opcion_seleccionada_respuesta (respuesta_id, item_id, opcion_id) values (11502, 9302, 9403), (11502, 9302, 9404), (11502, 9302, 9405)$$,
    'Opcion multiple admite varias selecciones'
);
select lives_ok(
    $$insert into opcion_seleccionada_respuesta (respuesta_id, item_id, opcion_id) values (11501, 9301, 9401)$$,
    'Opcion unica admite una seleccion'
);
select lives_ok(
    $$set constraints all deferred;
      update respuesta_item set respondido_en = current_timestamp where respuesta_id = 11501;
      insert into opcion_seleccionada_respuesta (respuesta_id, item_id, opcion_id) values (11501, 9301, 9402);
      delete from opcion_seleccionada_respuesta where respuesta_id = 11501 and opcion_id = 9401;
      set constraints all immediate$$,
    'Patron del backend: insertar la nueva seleccion antes de borrar la anterior es valido al confirmar'
);
select results_eq(
    $$select opcion_id from opcion_seleccionada_respuesta where respuesta_id = 11501$$,
    array[9402::bigint],
    'Tras el reemplazo queda solo la nueva seleccion'
);
select lives_ok(
    $$set constraints all deferred;
      delete from opcion_seleccionada_respuesta where respuesta_id = 11501;
      insert into opcion_seleccionada_respuesta (respuesta_id, item_id, opcion_id) values (11501, 9301, 9402);
      set constraints all immediate$$,
    'Patron del backend: borrar y reinsertar la misma seleccion es valido'
);
select throws_like(
    $$set constraints all deferred;
      insert into opcion_seleccionada_respuesta (respuesta_id, item_id, opcion_id) values (11501, 9301, 9401);
      set constraints all immediate$$,
    '%a lo sumo una opcion%',
    'Si la seleccion anterior no se borra, la validacion diferida rechaza la transaccion'
);

-- ============================================================
-- RECONFIGURACION DE SESIONES APLICADAS
-- ============================================================

select throws_like($$update sesion_aplicacion set version_test_id = 9102 where sesion_aplicacion_id = 11001$$,
    '%ya tiene asignaciones%', 'Una sesion con asignaciones no cambia de version');
select throws_like($$insert into sesion_subtest (sesion_subtest_id, sesion_aplicacion_id, version_test_id, subtest_id, numero_orden) values (11103, 11001, 9101, 9203, 3)$$,
    '%ya tiene intentos%', 'No se agregan subtests a una sesion con intentos');
select throws_like($$update sesion_subtest set tiempo_limite_segundos = 60 where sesion_subtest_id = 11101$$,
    '%ya tiene intentos%', 'No se reconfiguran subtests de una sesion con intentos');
select throws_like($$delete from sesion_subtest where sesion_subtest_id = 11102$$,
    '%ya tiene intentos%', 'No se quitan subtests de una sesion con intentos');
select lives_ok(
    $$insert into sesion_subtest (sesion_subtest_id, sesion_aplicacion_id, version_test_id, subtest_id, numero_orden) values (11121, 11003, 9101, 9201, 1);
      update sesion_subtest set tiempo_limite_segundos = 120 where sesion_subtest_id = 11121$$,
    'Una sesion con asignaciones pero sin intentos sigue siendo configurable'
);
select throws_like($$update asignacion_test set sesion_aplicacion_id = 11003 where asignacion_id = 11201$$,
    '%no puede modificarse%', 'Una asignacion no cambia de sesion');
select throws_like($$update intento_test set asignacion_id = 11203 where intento_id = 11301$$,
    '%no puede modificarse%', 'Un intento no cambia de asignacion');

-- ============================================================
-- RESULTADOS, CALIFICACIONES Y REVISIONES
-- ============================================================

insert into resultado (resultado_id, intento_id) values (11601, 11301);

select throws_like(
    $$insert into resultado_dimension (resultado_dimension_id, resultado_id, dimension_resultado_id) values (11690, 11601, 9502)$$,
    '%no pertenece a la version del intento%',
    'Un resultado no usa dimensiones de otra version'
);
select throws_like(
    $$insert into resultado_dimension (resultado_dimension_id, resultado_id, dimension_resultado_id, baremo_id) values (11691, 11601, 9501, 9902)$$,
    '%no corresponde a la version o dimension%',
    'Un resultado no usa baremos de otra version'
);
select lives_ok(
    $$insert into resultado_dimension (resultado_dimension_id, resultado_id, dimension_resultado_id, baremo_id, rango_baremo_id) values (11602, 11601, 9501, 9901, 9951)$$,
    'Un resultado por dimension con baremo de su version es valido'
);
select throws_like(
    $$insert into calificacion_respuesta (calificacion_respuesta_id, resultado_id, respuesta_id) values (11790, 11601, 11510)$$,
    '%no pertenece al intento del resultado%',
    'Una calificacion no usa respuestas de otro intento'
);
select throws_like(
    $$insert into calificacion_respuesta (calificacion_respuesta_id, resultado_id, respuesta_id, regla_calificacion_id) values (11791, 11601, 11501, 9611)$$,
    '%no cubre el item%',
    'Una calificacion no usa reglas de otra version'
);
select throws_like(
    $$insert into calificacion_respuesta (calificacion_respuesta_id, resultado_id, respuesta_id, opcion_id) values (11792, 11601, 11501, 9403)$$,
    '%no pertenece al item%',
    'Una calificacion no usa opciones de otro item'
);
select lives_ok(
    $$insert into calificacion_respuesta (calificacion_respuesta_id, resultado_id, respuesta_id, regla_calificacion_id, dimension_resultado_id, opcion_id) values (11701, 11601, 11501, 9601, 9501, 9401)$$,
    'Una calificacion coherente con respuesta, regla, dimension y opcion es valida'
);
select throws_like(
    $$insert into revision_manual_respuesta (revision_manual_respuesta_id, respuesta_id, regla_calificacion_id) values (11890, 11501, 9602)$$,
    '%no cubre el item de la respuesta%',
    'Una revision manual no usa reglas fuera del alcance del item'
);
select lives_ok(
    $$insert into revision_manual_respuesta (revision_manual_respuesta_id, respuesta_id, regla_calificacion_id) values (11801, 11503, 9601)$$,
    'Una revision manual con regla en alcance es valida'
);
select throws_like(
    $$insert into revision_rubrica_respuesta (revision_rubrica_respuesta_id, revision_manual_respuesta_id, criterio_rubrica_id, puntaje_asignado) values (11990, 11801, 10102, 1)$$,
    '%no cubre el item revisado%',
    'Una revision de rubrica no usa criterios de otra version'
);
select throws_ok(
    $$insert into revision_rubrica_respuesta (revision_rubrica_respuesta_id, revision_manual_respuesta_id, criterio_rubrica_id, nivel_criterio_rubrica_id, puntaje_asignado) values (11991, 11801, 10101, 10202, 1)$$,
    '23503',
    null,
    'El nivel de una revision de rubrica pertenece a su criterio'
);
select lives_ok(
    $$insert into revision_rubrica_respuesta (revision_rubrica_respuesta_id, revision_manual_respuesta_id, criterio_rubrica_id, nivel_criterio_rubrica_id, puntaje_asignado) values (11901, 11801, 10101, 10201, 1)$$,
    'Una revision de rubrica coherente es valida'
);

-- ============================================================
-- DIAGNOSTICO DE DATOS HISTORICOS
-- ============================================================

select results_eq('select count(*)::integer from diagnostico_integridad_dominio', array[0],
    'Los datos validos no generan diagnosticos');
select lives_ok('select fn_bfa_prevalidar_integridad()', 'La prevalidacion pasa con datos validos');

-- Simula una fila historica previa a la migracion (sin el trigger de alcance).
alter table clave_respuesta disable trigger tg_clave_respuesta_alcance;
insert into clave_respuesta (clave_respuesta_id, regla_calificacion_id, item_id, opcion_correcta_id) values (9793, 9621, 9311, 9411);
alter table clave_respuesta enable trigger tg_clave_respuesta_alcance;

select results_eq(
    $$select regla || ':' || fila_id from diagnostico_integridad_dominio$$,
    array['CLAVE_FUERA_DE_ALCANCE_REGLA:9793'],
    'El diagnostico identifica la fila historica incompatible sin modificarla'
);
select throws_like('select fn_bfa_prevalidar_integridad()',
    '%CLAVE_FUERA_DE_ALCANCE_REGLA=1%',
    'La prevalidacion se detiene ante datos historicos incompatibles');

delete from clave_respuesta where clave_respuesta_id = 9793;

-- ============================================================
-- RETIRO DE VERSIONES
-- ============================================================

select lives_ok($$update version_test set estado = 'RETIRADO' where version_test_id = 9101$$,
    'Una version publicada puede retirarse');
select results_eq(
    $$select count(*)::integer from regla_calificacion where version_test_id = 9101 and estado = 'PUBLICADO'$$,
    array[2],
    'Retirar la version no modifica la configuracion historica'
);
select throws_like($$update version_test set estado = 'PUBLICADO' where version_test_id = 9101$$,
    '%esta retirada%', 'Una version retirada no cambia');
select throws_like(
    $$insert into sesion_aplicacion (sesion_aplicacion_id, version_test_id, codigo_sesion, nombre_sesion, inicio_programado) values (11091, 9101, 'SES-R', 'Retirada', now())$$,
    '%requiere una version PUBLICADO%',
    'No se crean sesiones nuevas sobre versiones retiradas'
);
select lives_ok($$update respuesta_item set respuesta_texto_abierto = 'actualizada' where respuesta_id = 11503$$,
    'Las sesiones existentes siguen registrando respuestas tras el retiro');

select * from finish();
rollback;

package com.uam.psychoform.instrument;

import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Siembra por SQL el contenido completo de una version (B7/B9): 2 subtests, items de opcion unica, multiple con
 * conjunto de varias opciones correctas, abierto, numerico y con revision manual, imagenes de items y opciones
 * (recursos compartidos), reglas de calificacion, claves, matriz opcion-dimension, dimension y baremo con rangos.
 */
public final class InstrumentVersionFixture {
    private InstrumentVersionFixture() {
    }

    public record Seed(long versionId, long recursoItemId, long recursoOpcionId) {
    }

    public static UUID createUser(JdbcTemplate jdbc, String prefix) {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        return jdbc.queryForObject("insert into usuario (nombre_usuario, correo, hash_contrasena, nombre_completo) "
                + "values (?, ?, 'x', 'Usuario fixture') returning usuario_id", UUID.class,
                prefix + "-" + suffix, prefix + "-" + suffix + "@test.local");
    }

    public static long createTest(JdbcTemplate jdbc, String prefix) {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        return jdbc.queryForObject("insert into test (codigo_test, nombre_test) values (?, ?) returning test_id",
                Long.class, prefix + "-" + suffix, "Test " + prefix + " " + suffix);
    }

    public static long createDraftVersion(JdbcTemplate jdbc, long testId, String number) {
        return jdbc.queryForObject("insert into version_test (test_id, numero_version, estado, "
                + "instrucciones_generales, tiempo_limite_segundos, permite_aleatorizar_subtests, "
                + "permite_aleatorizar_items, estrategia_calificacion_id) "
                + "values (?, ?, 'BORRADOR', 'Instrucciones generales', 3600, true, true, "
                + "(select min(estrategia_calificacion_id) from estrategia_calificacion)) "
                + "returning version_test_id", Long.class, testId, number);
    }

    /** Pasa la version a PUBLICADO (despues de sembrar: el contenido publicado es inmutable). */
    public static void publish(JdbcTemplate jdbc, long versionId, UUID approverId) {
        jdbc.update("update version_test set estado = 'PUBLICADO', aprobado_por = ?, aprobado_en = now(), "
                + "publicado_en = now() where version_test_id = ?", approverId, versionId);
    }

    public static Seed seedFullContent(JdbcTemplate jdbc, long versionId) {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        long resItem = resource(jdbc, "item-" + suffix);
        long resOption = resource(jdbc, "opcion-" + suffix);
        long strategy = jdbc.queryForObject("select min(estrategia_calificacion_id) from estrategia_calificacion",
                Long.class);

        long s1 = subtest(jdbc, versionId, "S1", 1);
        long s2 = subtest(jdbc, versionId, "S2", 2);
        long dim = jdbc.queryForObject("insert into dimension_resultado (version_test_id, subtest_id, "
                + "codigo_dimension, nombre_dimension, descripcion, orden_presentacion, puntaje_minimo, "
                + "puntaje_maximo) values (?, ?, 'DIM-1', 'Dimension 1', 'desc', 1, 0, 10) "
                + "returning dimension_resultado_id", Long.class, versionId, s1);
        long ruleS1 = rule(jdbc, versionId, s1, strategy, 1);
        long ruleS2 = rule(jdbc, versionId, s2, strategy, 1);
        rule(jdbc, versionId, null, strategy, 2);

        long i1 = item(jdbc, s1, "I1", "TEXTO_E_IMAGEN", "OPCION_UNICA", 1);
        long i1a = option(jdbc, i1, "A", 1);
        long i1b = option(jdbc, i1, "B", 2);
        jdbc.update("insert into imagen_item (item_id, recurso_id, rol_imagen, numero_orden, texto_alternativo) "
                + "values (?, ?, 'ENUNCIADO', 1, 'figura del item')", i1, resItem);
        jdbc.update("insert into imagen_opcion (opcion_id, recurso_id, numero_orden, texto_alternativo) "
                + "values (?, ?, 1, 'figura de la opcion')", i1a, resOption);
        jdbc.update("insert into clave_respuesta (regla_calificacion_id, item_id, opcion_correcta_id, puntaje, "
                + "requiere_revision_manual) values (?, ?, ?, 2, false)", ruleS1, i1, i1a);
        jdbc.update("insert into opcion_puntaje_dimension (regla_calificacion_id, opcion_id, "
                + "dimension_resultado_id, puntaje, peso) values (?, ?, ?, 1.5, 1)", ruleS1, i1a, dim);
        jdbc.update("insert into opcion_puntaje_dimension (regla_calificacion_id, opcion_id, "
                + "dimension_resultado_id, puntaje, peso) values (?, ?, ?, 0, 2)", ruleS1, i1b, dim);

        long i2 = item(jdbc, s1, "I2", "SOLO_TEXTO", "OPCION_MULTIPLE", 2);
        long i2a = option(jdbc, i2, "A", 1);
        option(jdbc, i2, "B", 2);
        long i2c = option(jdbc, i2, "C", 3);
        jdbc.update("insert into imagen_opcion (opcion_id, recurso_id, numero_orden, texto_alternativo) "
                + "values (?, ?, 1, 'figura de la opcion C')", i2c, resOption);
        long keyI2 = jdbc.queryForObject("insert into clave_respuesta (regla_calificacion_id, item_id, puntaje, "
                + "requiere_revision_manual, usa_conjunto_opciones) values (?, ?, 3, false, true) "
                + "returning clave_respuesta_id", Long.class, ruleS1, i2);
        for (long optionId : new long[] { i2a, i2c }) {
            jdbc.update("insert into clave_respuesta_opcion (clave_respuesta_id, item_id, opcion_id) "
                    + "values (?, ?, ?)", keyI2, i2, optionId);
        }

        long i3 = item(jdbc, s2, "I3", "SOLO_TEXTO", "TEXTO_ABIERTO", 1);
        jdbc.update("insert into clave_respuesta (regla_calificacion_id, item_id, texto_esperado, puntaje, "
                + "requiere_revision_manual) values (?, ?, 'respuesta esperada', 1, false)", ruleS2, i3);
        long i4 = item(jdbc, s2, "I4", "SOLO_TEXTO", "NUMERICA", 2);
        jdbc.update("insert into clave_respuesta (regla_calificacion_id, item_id, valor_numerico_esperado, "
                + "tolerancia_numerica, puntaje, requiere_revision_manual) values (?, ?, 3.5, 0.5, 1, false)",
                ruleS2, i4);
        long i5 = item(jdbc, s2, "I5", "SOLO_TEXTO", "OPCION_MULTIPLE", 3);
        option(jdbc, i5, "A", 1);
        option(jdbc, i5, "B", 2);
        jdbc.update("insert into clave_respuesta (regla_calificacion_id, item_id, puntaje, "
                + "requiere_revision_manual) values (?, ?, 1, true)", ruleS2, i5);

        long baremo = jdbc.queryForObject("insert into baremo (version_test_id, dimension_resultado_id, "
                + "codigo_baremo, nombre, descripcion, grupo_normativo, criterio_edad_minima, "
                + "criterio_edad_maxima, vigente_desde, vigente_hasta) values (?, ?, 'BAR-1', 'Baremo 1', 'desc', "
                + "'General', 18, 30, date '2026-01-01', date '2026-12-31') returning baremo_id", Long.class,
                versionId, dim);
        jdbc.update("insert into rango_baremo (baremo_id, puntaje_minimo, puntaje_maximo, percentil, categoria, "
                + "interpretacion, recomendacion, orden) values (?, 0, 5, 25, 'BAJO', 'interp bajo', 'rec', 1)",
                baremo);
        jdbc.update("insert into rango_baremo (baremo_id, puntaje_minimo, puntaje_maximo, percentil, categoria, "
                + "interpretacion, recomendacion, orden) values (?, 6, 10, 75, 'ALTO', 'interp alto', 'rec', 2)",
                baremo);
        return new Seed(versionId, resItem, resOption);
    }

    /** Agrega un subtest con {@code itemCount} items de opcion unica (2 opciones y clave cada uno). */
    public static void addSubtest(JdbcTemplate jdbc, long versionId, String code, int order, int itemCount) {
        long strategy = jdbc.queryForObject("select min(estrategia_calificacion_id) from estrategia_calificacion",
                Long.class);
        long subtestId = subtest(jdbc, versionId, code, order);
        long ruleId = rule(jdbc, versionId, subtestId, strategy, 1);
        for (int n = 1; n <= itemCount; n++) {
            long itemId = item(jdbc, subtestId, "X" + n, "SOLO_TEXTO", "OPCION_UNICA", n);
            long a = option(jdbc, itemId, "A", 1);
            option(jdbc, itemId, "B", 2);
            jdbc.update("insert into clave_respuesta (regla_calificacion_id, item_id, opcion_correcta_id, puntaje, "
                    + "requiere_revision_manual) values (?, ?, ?, 1, false)", ruleId, itemId, a);
        }
    }

    private static long resource(JdbcTemplate jdbc, String name) {
        return jdbc.queryForObject("insert into recurso_multimedia (nombre_archivo, ruta_almacenamiento, tipo_mime, "
                + "tamano_bytes, hash_integridad) values (?, ?, 'image/png', 10, ?) returning recurso_id",
                Long.class, name + ".png", "test-fixture/" + name + ".png", "hash-" + name);
    }

    private static long subtest(JdbcTemplate jdbc, long versionId, String code, int order) {
        return jdbc.queryForObject("insert into subtest (version_test_id, estrategia_calificacion_id, codigo_subtest, "
                + "nombre_subtest, descripcion, instrucciones, numero_orden, tiempo_limite_segundos, "
                + "permite_aleatorizar_items, permite_aleatorizar_opciones, es_obligatorio) "
                + "values (?, (select min(estrategia_calificacion_id) from estrategia_calificacion), ?, ?, "
                + "'descripcion', 'instrucciones', ?, 600, true, true, true) returning subtest_id", Long.class,
                versionId, code, "Subtest " + code, order);
    }

    private static long rule(JdbcTemplate jdbc, long versionId, Long subtestId, long strategy, int priority) {
        return jdbc.queryForObject("insert into regla_calificacion (version_test_id, subtest_id, "
                + "estrategia_calificacion_id, tipo_regla, prioridad, parametros, observacion) "
                + "values (?, ?, ?, 'CLAVE_ITEM', ?, '{\"k\": 1}'::jsonb, 'obs') returning regla_calificacion_id",
                Long.class, versionId, subtestId, strategy, priority);
    }

    private static long item(JdbcTemplate jdbc, long subtestId, String code, String type, String responseType,
            int order) {
        return jdbc.queryForObject("insert into item (subtest_id, codigo_item, tipo_item, tipo_respuesta, enunciado, "
                + "instruccion, numero_orden, puntaje_base, tiempo_limite_segundos, es_obligatorio, "
                + "es_confidencial) values (?, ?, ?::tipo_item, ?::tipo_respuesta, ?, 'instruccion', ?, 2.5, 60, "
                + "true, false) returning item_id", Long.class, subtestId, code, type, responseType,
                "Enunciado " + code, order);
    }

    private static long option(JdbcTemplate jdbc, long itemId, String code, int order) {
        return jdbc.queryForObject("insert into opcion_item (item_id, codigo_opcion, texto_opcion, numero_orden, "
                + "valor_ordinal) values (?, ?, ?, ?, ?) returning opcion_id", Long.class, itemId, code,
                "Opcion " + code, order, order);
    }
}

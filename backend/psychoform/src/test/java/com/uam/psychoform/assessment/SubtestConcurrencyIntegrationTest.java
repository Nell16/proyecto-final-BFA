package com.uam.psychoform.assessment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.uam.psychoform.assessment.service.ParticipantAccessService.ParticipantAccess;
import com.uam.psychoform.assessment.service.ParticipantAnswerService;
import com.uam.psychoform.assessment.service.ParticipantConflictException;
import com.uam.psychoform.assessment.service.ParticipantRuntimeService;
import com.uam.psychoform.assessment.service.TiempoAgotadoException;
import com.uam.psychoform.assessment.service.ExpiredSubtestCloser;
import com.uam.psychoform.assessment.service.SubtestClosingService;
import com.uam.psychoform.assessment.repository.IntentoSubtestRepository;
import com.uam.psychoform.assessment.repository.IntentoTestRepository;
import jakarta.persistence.EntityManager;
import java.time.Clock;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Carreras reales entre dos transacciones PostgreSQL sobre el mismo intento:
 * PUT respuesta vs finalizar subtest (ambos ordenes) y la confirmacion del cierre por tiempo agotado.
 * Los datos se siembran con session_replication_role = replica (omite FK/triggers solo durante la siembra y la
 * limpieza); las operaciones bajo prueba corren con triggers e integridad activos.
 */
@SpringBootTest
class SubtestConcurrencyIntegrationTest {
    private static final long ESPERA_BLOQUEO_MS = 700;

    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    PlatformTransactionManager txManager;
    @Autowired
    ParticipantAnswerService answers;
    @Autowired
    ParticipantRuntimeService runtime;
    @Autowired
    IntentoSubtestRepository intentoSubtests;
    @Autowired
    IntentoTestRepository intentos;
    @Autowired
    SubtestClosingService closing;
    @Autowired
    EntityManager entityManager;
    @Autowired
    Clock clock;

    private Escenario escenario;

    private record Escenario(long sesionId, long subtestId, long itemRespondidoId, long itemOmitidoId,
            long sesionSubtestId, long asignacionId, UUID participanteId, long intentoId, long intentoSubtestId) {
        ParticipantAccess access() {
            return new ParticipantAccess(asignacionId, participanteId);
        }
    }

    private Escenario sembrar(Integer limiteSegundos, long iniciadoHaceSegundos) {
        return new TransactionTemplate(txManager).execute(status -> {
            jdbc.execute("set local session_replication_role = replica");
            String sufijo = UUID.randomUUID().toString().substring(0, 8);
            long subtestId = id("insert into subtest (version_test_id, codigo_subtest, nombre_subtest, numero_orden) "
                    + "values (-1, ?, 'tmp', 1) returning subtest_id", "ST-" + sufijo);
            long item1 = id("insert into item (subtest_id, codigo_item, tipo_item, tipo_respuesta, numero_orden, estado) "
                    + "values (?, ?, 'SOLO_TEXTO', 'TEXTO_ABIERTO', 1, 'ACTIVO') returning item_id", subtestId, "I1-" + sufijo);
            long item2 = id("insert into item (subtest_id, codigo_item, tipo_item, tipo_respuesta, numero_orden, estado) "
                    + "values (?, ?, 'SOLO_TEXTO', 'TEXTO_ABIERTO', 2, 'ACTIVO') returning item_id", subtestId, "I2-" + sufijo);
            long sesionId = id("insert into sesion_aplicacion (version_test_id, codigo_sesion, nombre_sesion, "
                    + "inicio_programado, estado) values (-1, ?, 'tmp', now(), 'ABIERTA') returning sesion_aplicacion_id",
                    "TEST-CONC-" + sufijo);
            long sesionSubtestId = id("insert into sesion_subtest (sesion_aplicacion_id, version_test_id, subtest_id, "
                    + "numero_orden, tiempo_limite_segundos) values (?, -1, ?, 1, ?) returning sesion_subtest_id",
                    sesionId, subtestId, limiteSegundos);
            UUID participanteId = UUID.randomUUID();
            long asignacionId = id("insert into asignacion_test (sesion_aplicacion_id, participante_id, evaluador_id, "
                    + "token_acceso_hash, token_expira_en, estado) values (?, ?, ?, 'x', "
                    + "(now() at time zone 'utc') + interval '1 day', 'EN_PROGRESO') returning asignacion_id",
                    sesionId, participanteId, UUID.randomUUID());
            long intentoId = id("insert into intento_test (asignacion_id, estado, iniciado_en, ultima_actividad_en) "
                    + "values (?, 'EN_PROGRESO', now() at time zone 'utc', now() at time zone 'utc') returning intento_id",
                    asignacionId);
            long intentoSubtestId = id("insert into intento_subtest (intento_id, sesion_subtest_id, subtest_id, "
                    + "iniciado_en, estado) values (?, ?, ?, (now() at time zone 'utc') - make_interval(secs => ?), "
                    + "'EN_PROGRESO') returning intento_subtest_id",
                    intentoId, sesionSubtestId, subtestId, iniciadoHaceSegundos);
            return new Escenario(sesionId, subtestId, item1, item2, sesionSubtestId, asignacionId, participanteId,
                    intentoId, intentoSubtestId);
        });
    }

    private long id(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }

    @AfterEach
    void limpiar() {
        if (escenario == null) {
            return;
        }
        Escenario e = escenario;
        new TransactionTemplate(txManager).executeWithoutResult(status -> {
            jdbc.execute("set local session_replication_role = replica");
            jdbc.update("delete from opcion_seleccionada_respuesta where respuesta_id in "
                    + "(select respuesta_id from respuesta_item where intento_id = ?)", e.intentoId());
            jdbc.update("delete from respuesta_item where intento_id = ?", e.intentoId());
            jdbc.update("delete from intento_subtest where intento_id = ?", e.intentoId());
            jdbc.update("delete from intento_test where intento_id = ?", e.intentoId());
            jdbc.update("delete from asignacion_test where asignacion_id = ?", e.asignacionId());
            jdbc.update("delete from sesion_subtest where sesion_subtest_id = ?", e.sesionSubtestId());
            jdbc.update("delete from pausa_sesion where sesion_aplicacion_id = ?", e.sesionId());
            jdbc.update("delete from sesion_aplicacion where sesion_aplicacion_id = ?", e.sesionId());
            jdbc.update("delete from opcion_item where item_id in (select item_id from item where subtest_id = ?)",
                    e.subtestId());
            jdbc.update("delete from item where subtest_id = ?", e.subtestId());
            jdbc.update("delete from subtest where subtest_id = ?", e.subtestId());
        });
    }

    private ParticipantAnswerService.SaveAnswerCommand respuesta(String texto) {
        return new ParticipantAnswerService.SaveAnswerCommand(escenario.intentoId(), escenario.itemRespondidoId(),
                List.of(), texto, null, null);
    }

    /**
     * Ejecuta `primera` en una transaccion que retiene el bloqueo del intento; mientras sigue abierta lanza
     * `segunda` en otro hilo, comprueba que queda bloqueada y recien entonces confirma la primera.
     */
    private <T> CompletableFuture<T> conPrimeraRetenida(Runnable primera, Supplier<T> segunda) {
        CompletableFuture<T>[] resultado = new CompletableFuture[1];
        new TransactionTemplate(txManager).executeWithoutResult(status -> {
            primera.run();
            resultado[0] = CompletableFuture.supplyAsync(segunda);
            try {
                Thread.sleep(ESPERA_BLOQUEO_MS);
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
            }
            assertThat(resultado[0]).as("la segunda operacion debe esperar el bloqueo del intento").isNotDone();
        });
        return resultado[0];
    }

    private List<Map<String, Object>> respuestasEnBd() {
        return jdbc.queryForList("select item_id, respuesta_texto_abierto, intento_subtest_id from respuesta_item "
                + "where intento_id = ? order by item_id", escenario.intentoId());
    }

    private String estadoSubtest() {
        return jdbc.queryForObject("select estado::text from intento_subtest where intento_subtest_id = ?",
                String.class, escenario.intentoSubtestId());
    }

    @Test
    void putPrimeroYFinalizarDespues_laRespuestaQuedaYElOmitidoSeEntregaVacio() throws Exception {
        escenario = sembrar(null, 10);

        CompletableFuture<Object> finalizar = conPrimeraRetenida(
                () -> answers.saveAnswer(escenario.access(), respuesta("antes del cierre")),
                () -> runtime.finishSubtest(escenario.access(), escenario.intentoId(), escenario.subtestId(), 0));
        finalizar.get(10, TimeUnit.SECONDS);

        assertThat(estadoSubtest()).isEqualTo("COMPLETADO");
        List<Map<String, Object>> filas = respuestasEnBd();
        assertThat(filas).hasSize(2);
        assertThat(filas.get(0).get("item_id")).isEqualTo(escenario.itemRespondidoId());
        assertThat(filas.get(0).get("respuesta_texto_abierto")).isEqualTo("antes del cierre");
        assertThat(filas.get(1).get("item_id")).isEqualTo(escenario.itemOmitidoId());
        assertThat(filas.get(1).get("respuesta_texto_abierto")).isNull();
        assertThat(filas.get(1).get("intento_subtest_id")).isEqualTo(escenario.intentoSubtestId());
    }

    @Test
    void finalizarPrimeroYPutDespues_elPutSeRechazaYNoSeGuardaNadaTardio() {
        escenario = sembrar(null, 10);

        CompletableFuture<Object> put = conPrimeraRetenida(
                () -> runtime.finishSubtest(escenario.access(), escenario.intentoId(), escenario.subtestId(), 0),
                () -> answers.saveAnswer(escenario.access(), respuesta("tardia")));

        assertThatThrownBy(() -> put.get(10, TimeUnit.SECONDS))
                .hasCauseInstanceOf(ParticipantConflictException.class)
                .cause().extracting(e -> ((ParticipantConflictException) e).getCode())
                .isEqualTo(ParticipantAnswerService.SUBTEST_FINALIZADO);
        assertThat(estadoSubtest()).isEqualTo("COMPLETADO");
        // Ambos items quedan como respuestas vacias: el texto tardio no se guardo.
        assertThat(respuestasEnBd()).hasSize(2)
                .allSatisfy(fila -> assertThat(fila.get("respuesta_texto_abierto")).isNull());
    }

    @Test
    void putConTiempoAgotadoResponde409PeroConfirmaLaEntregaDelSubtest() {
        escenario = sembrar(600, 700);

        assertThatThrownBy(() -> answers.saveAnswer(escenario.access(), respuesta("tardia")))
                .isInstanceOf(TiempoAgotadoException.class);

        // El cierre se confirmo pese a la excepcion (noRollbackFor).
        assertThat(estadoSubtest()).isEqualTo("COMPLETADO");
        assertThat(jdbc.queryForObject("select tiempo_usado_segundos from intento_subtest where intento_subtest_id = ?",
                Integer.class, escenario.intentoSubtestId())).isEqualTo(600);
        assertThat(respuestasEnBd()).hasSize(2)
                .allSatisfy(fila -> assertThat(fila.get("respuesta_texto_abierto")).isNull());
    }

    @Test
    void bulkSyncConTiempoAgotadoNoAbortaYEntregaElSubtest() {
        escenario = sembrar(600, 700);

        var resultado = answers.bulkSyncAnswers(escenario.access(),
                new ParticipantAnswerService.BulkSyncAnswersCommand(escenario.intentoId(), List.of(respuesta("tardia"))));

        assertThat(resultado).singleElement().satisfies(r -> {
            assertThat(r.status()).isEqualTo(ParticipantAnswerService.RESULTADO_RECHAZADA);
            assertThat(r.code()).isEqualTo("TIEMPO_AGOTADO");
        });
        assertThat(estadoSubtest()).isEqualTo("COMPLETADO");
        assertThat(respuestasEnBd()).hasSize(2);
    }

    @Test
    void elCierreAutomaticoEsperaUnaPausaEnCursoYLaDescuenta() throws Exception {
        // 606 s brutos con limite 600: sin la pausa estaria vencido (> 605).
        escenario = sembrar(600, 606);
        // El cierre automatico esta desactivado en el perfil de test: se instancia con los beans reales.
        ExpiredSubtestCloser closer = new ExpiredSubtestCloser(intentoSubtests, intentos, closing, txManager, clock,
                entityManager);

        // Transaccion de "pausar" (como SesionAplicacionService.pausar): FOR UPDATE de la sesion + pausa a los
        // 604 s efectivos, todavia sin confirmar mientras corre el cierre automatico.
        CompletableFuture<Integer> cierre = conPrimeraRetenida(() -> {
            jdbc.queryForList("select 1 from sesion_aplicacion where sesion_aplicacion_id = ? for update",
                    escenario.sesionId());
            jdbc.update("insert into pausa_sesion (sesion_aplicacion_id, pausado_en) values "
                    + "(?, (now() at time zone 'utc') - interval '2 second')", escenario.sesionId());
            jdbc.update("update sesion_aplicacion set estado = 'PAUSADA' where sesion_aplicacion_id = ?",
                    escenario.sesionId());
        }, () -> closer.cerrarExpirados(soloEscenario()));

        assertThat(cierre.get(10, TimeUnit.SECONDS)).as("subtests cerrados").isZero();
        assertThat(estadoSubtest()).isEqualTo("EN_PROGRESO");
        assertThat(respuestasEnBd()).isEmpty();
    }

    /** El job real se acota al intento sembrado: la base puede tener otros datos que no deben tocarse. */
    private java.util.function.Predicate<IntentoSubtestRepository.CierreCandidato> soloEscenario() {
        long intentoId = escenario.intentoId();
        return candidato -> candidato.getIntentoId() == intentoId;
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = { "CERRADA", "CANCELADA" })
    void elCierreAutomaticoNoEntregaIntentosDeSesionesTerminadas(String estadoTerminal) {
        escenario = sembrar(600, 700); // vencido por tiempo, pero la sesion termino antes
        jdbc.update("update sesion_aplicacion set estado = ?::estado_sesion_aplicacion where sesion_aplicacion_id = ?",
                estadoTerminal, escenario.sesionId());
        ExpiredSubtestCloser closer = new ExpiredSubtestCloser(intentoSubtests, intentos, closing, txManager, clock,
                entityManager);

        assertThat(closer.cerrarExpirados(soloEscenario())).isZero();
        assertThat(estadoSubtest()).isEqualTo("EN_PROGRESO");
        assertThat(respuestasEnBd()).isEmpty();
    }

    @org.junit.jupiter.api.Test
    void elCierreAutomaticoEntregaUnSubtestVencidoDeUnaSesionAbierta() {
        escenario = sembrar(600, 700);
        ExpiredSubtestCloser closer = new ExpiredSubtestCloser(intentoSubtests, intentos, closing, txManager, clock,
                entityManager);

        assertThat(closer.cerrarExpirados(soloEscenario())).isEqualTo(1);
        assertThat(estadoSubtest()).isEqualTo("COMPLETADO");
        assertThat(respuestasEnBd()).hasSize(2)
                .allSatisfy(fila -> assertThat(fila.get("respuesta_texto_abierto")).isNull());
    }

    @org.junit.jupiter.api.Test
    void bulkSyncConItemsInvalidosConservaLasRespuestasValidasDelLote() {
        escenario = sembrar(null, 10);
        long inexistente = Long.MAX_VALUE;
        var lote = List.of(
                respuesta("valida"),
                new ParticipantAnswerService.SaveAnswerCommand(escenario.intentoId(), inexistente, List.of(), "x", null, null),
                new ParticipantAnswerService.SaveAnswerCommand(escenario.intentoId(), escenario.itemOmitidoId(),
                        List.of(inexistente), null, null, null));

        var resultado = answers.bulkSyncAnswers(escenario.access(),
                new ParticipantAnswerService.BulkSyncAnswersCommand(escenario.intentoId(), lote));

        assertThat(resultado).extracting(ParticipantAnswerService.BulkSyncResult::status, ParticipantAnswerService.BulkSyncResult::code)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple("GUARDADA", null),
                        org.assertj.core.groups.Tuple.tuple("RECHAZADA", ParticipantAnswerService.ITEM_NO_ENCONTRADO),
                        org.assertj.core.groups.Tuple.tuple("RECHAZADA", ParticipantAnswerService.OPCION_INVALIDA));
        // La transaccion del lote se confirmo: la respuesta valida quedo guardada.
        assertThat(respuestasEnBd()).singleElement()
                .satisfies(fila -> assertThat(fila.get("respuesta_texto_abierto")).isEqualTo("valida"));
    }

    @org.junit.jupiter.api.Test
    void bulkSyncRechazaPorItemLasRespuestasIncompatiblesSinRevertirElLote() {
        escenario = sembrar(null, 10);
        // Item OPCION_UNICA con dos opciones, en el mismo subtest del escenario (lo borra la limpieza).
        long[] ids = new TransactionTemplate(txManager).execute(status -> {
            jdbc.execute("set local session_replication_role = replica");
            long item = id("insert into item (subtest_id, codigo_item, tipo_item, tipo_respuesta, numero_orden, estado) "
                    + "values (?, ?, 'SOLO_TEXTO', 'OPCION_UNICA', 3, 'ACTIVO') returning item_id",
                    escenario.subtestId(), "I3-" + UUID.randomUUID().toString().substring(0, 8));
            long a = id("insert into opcion_item (item_id, codigo_opcion, numero_orden) values (?, 'A', 1) "
                    + "returning opcion_id", item);
            long b = id("insert into opcion_item (item_id, codigo_opcion, numero_orden) values (?, 'B', 2) "
                    + "returning opcion_id", item);
            long numerico = id("insert into item (subtest_id, codigo_item, tipo_item, tipo_respuesta, numero_orden, estado) "
                    + "values (?, ?, 'SOLO_TEXTO', 'NUMERICA', 4, 'ACTIVO') returning item_id",
                    escenario.subtestId(), "I3-" + UUID.randomUUID().toString().substring(0, 8));
            return new long[] { item, a, b, numerico };
        });
        long intentoId = escenario.intentoId();
        var lote = List.of(
                respuesta("valida"),
                new ParticipantAnswerService.SaveAnswerCommand(intentoId, null, List.of(), "x", null, null),
                new ParticipantAnswerService.SaveAnswerCommand(intentoId, ids[0], List.of(ids[1], ids[2]), null, null, null),
                new ParticipantAnswerService.SaveAnswerCommand(intentoId, ids[0], List.of(ids[1]), "texto", null, null),
                new ParticipantAnswerService.SaveAnswerCommand(intentoId, escenario.itemOmitidoId(), List.of(),
                        null, new java.math.BigDecimal("3"), null),
                // Tabulacion en OPCION_UNICA: btrim del trigger no la quita, asi que es texto incompatible.
                new ParticipantAnswerService.SaveAnswerCommand(intentoId, ids[0], List.of(), "\t", null, null),
                new ParticipantAnswerService.SaveAnswerCommand(intentoId, ids[0], List.of(ids[1]), null, null, -1),
                new ParticipantAnswerService.SaveAnswerCommand(intentoId, ids[3], List.of(), null,
                        new java.math.BigDecimal("99999999.99995"), null),
                new ParticipantAnswerService.SaveAnswerCommand(intentoId, escenario.itemOmitidoId(), List.of(),
                        "a\u0000b", null, null),
                new ParticipantAnswerService.SaveAnswerCommand(intentoId, ids[0], List.of(ids[1], ids[1]), null, null, null),
                // Exponentes extremos: se evaluan sin redondear (sin ArithmeticException ni agotar memoria).
                new ParticipantAnswerService.SaveAnswerCommand(intentoId, ids[3], List.of(), null,
                        new java.math.BigDecimal("1E+999999999"), null),
                new ParticipantAnswerService.SaveAnswerCommand(intentoId, ids[3], List.of(), null,
                        new java.math.BigDecimal("1E-2147483647"), null),
                ParticipantAnswerService.SaveAnswerCommand.invalida(intentoId, ids[0]),
                // Redondea a cero: se persiste 0.0000, no el original de escala 20000 que PostgreSQL rechazaria.
                new ParticipantAnswerService.SaveAnswerCommand(intentoId, ids[3], List.of(), null,
                        new java.math.BigDecimal("1E-20000"), null));

        var resultado = answers.bulkSyncAnswers(escenario.access(),
                new ParticipantAnswerService.BulkSyncAnswersCommand(intentoId, lote));

        assertThat(resultado).extracting(ParticipantAnswerService.BulkSyncResult::status, ParticipantAnswerService.BulkSyncResult::code)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple("GUARDADA", null),
                        org.assertj.core.groups.Tuple.tuple("RECHAZADA", ParticipantAnswerService.ITEM_NO_ENCONTRADO),
                        org.assertj.core.groups.Tuple.tuple("RECHAZADA", ParticipantAnswerService.RESPUESTA_INVALIDA),
                        org.assertj.core.groups.Tuple.tuple("RECHAZADA", ParticipantAnswerService.RESPUESTA_INVALIDA),
                        org.assertj.core.groups.Tuple.tuple("RECHAZADA", ParticipantAnswerService.RESPUESTA_INVALIDA),
                        org.assertj.core.groups.Tuple.tuple("RECHAZADA", ParticipantAnswerService.RESPUESTA_INVALIDA),
                        org.assertj.core.groups.Tuple.tuple("RECHAZADA", ParticipantAnswerService.RESPUESTA_INVALIDA),
                        org.assertj.core.groups.Tuple.tuple("RECHAZADA", ParticipantAnswerService.RESPUESTA_INVALIDA),
                        org.assertj.core.groups.Tuple.tuple("RECHAZADA", ParticipantAnswerService.RESPUESTA_INVALIDA),
                        org.assertj.core.groups.Tuple.tuple("RECHAZADA", ParticipantAnswerService.OPCION_INVALIDA),
                        org.assertj.core.groups.Tuple.tuple("RECHAZADA", ParticipantAnswerService.RESPUESTA_INVALIDA),
                        org.assertj.core.groups.Tuple.tuple("GUARDADA", null),
                        org.assertj.core.groups.Tuple.tuple("RECHAZADA", ParticipantAnswerService.RESPUESTA_INVALIDA),
                        org.assertj.core.groups.Tuple.tuple("GUARDADA", null));
        // La transaccion se confirmo (el trigger diferido no la revirtio): quedan la respuesta valida y la numerica.
        assertThat(respuestasEnBd()).extracting(fila -> fila.get("respuesta_texto_abierto"))
                .containsExactlyInAnyOrder("valida", null);
        assertThat(jdbc.queryForObject("select respuesta_numerica from respuesta_item where intento_id = ? "
                + "and item_id = ?", java.math.BigDecimal.class, intentoId, ids[3])).isEqualByComparingTo("0");
    }
}

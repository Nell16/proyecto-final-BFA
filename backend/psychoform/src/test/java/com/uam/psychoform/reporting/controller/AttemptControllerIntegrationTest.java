package com.uam.psychoform.reporting.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.uam.psychoform.PsychoformApplication;
import com.uam.psychoform.security.service.JwtService;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(classes = PsychoformApplication.class)
@AutoConfigureMockMvc
class AttemptControllerIntegrationTest {

    @Autowired
    MockMvc mvc;

    @Autowired
    JwtService jwt;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    PlatformTransactionManager txManager;

    private SeededData seeded;

    private record SeededData(
            UUID evaluatorId,
            List<UUID> participantIds,
            long testId,
            long version1Id,
            long version2Id,
            long subtestId,
            List<Long> itemIds,
            long session1Id,
            long session2Id,
            List<Long> attemptIds,
            long scoredAttemptId,
            long scoredResultId,
            long unscoredCompletedAttemptId,
            long inProgressAttemptId,
            long interruptedOtherVersionAttemptId) {
    }

    @AfterEach
    void cleanup() {
        if (seeded == null) {
            return;
        }
        SeededData s = seeded;
        seeded = null;
        new TransactionTemplate(txManager).executeWithoutResult(status -> {
            jdbc.execute("set local session_replication_role = replica");
            if (!s.attemptIds().isEmpty()) {
                String placeholders = String.join(",", s.attemptIds().stream().map(id -> "?").toList());
                Object[] args = s.attemptIds().toArray();
                jdbc.update("delete from revision_manual_respuesta where respuesta_id in "
                        + "(select respuesta_id from respuesta_item where intento_id in (" + placeholders + "))", args);
                jdbc.update("delete from respuesta_item where intento_id in (" + placeholders + ")", args);
                jdbc.update("delete from resultado where intento_id in (" + placeholders + ")", args);
                jdbc.update("delete from intento_test where intento_id in (" + placeholders + ")", args);
            }
            jdbc.update("delete from asignacion_test where sesion_aplicacion_id in (?, ?)",
                    s.session1Id(), s.session2Id());
            jdbc.update("delete from sesion_subtest where sesion_aplicacion_id in (?, ?)",
                    s.session1Id(), s.session2Id());
            jdbc.update("delete from sesion_aplicacion where sesion_aplicacion_id in (?, ?)",
                    s.session1Id(), s.session2Id());
            jdbc.update("delete from item where subtest_id = ?", s.subtestId());
            jdbc.update("delete from subtest where subtest_id = ?", s.subtestId());
            jdbc.update("delete from version_test where version_test_id in (?, ?)",
                    s.version1Id(), s.version2Id());
            jdbc.update("delete from test where test_id = ?", s.testId());
            for (UUID participantId : s.participantIds()) {
                jdbc.update("delete from participante where participante_id = ?", participantId);
            }
            jdbc.update("delete from usuario where usuario_id = ?", s.evaluatorId());
        });
    }

    @Test
    void consultorConResultadoVerObtiene200YResumenConRevisionesPendientes() throws Exception {
        seeded = seedScenario();

        mvc.perform(get("/attempts")
                        .param("sessionId", String.valueOf(seeded.session1Id()))
                        .param("scored", "true")
                        .header("Authorization", bearer(Set.of("RESULTADO_VER"), Set.of("CONSULTOR_REPORTES"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.totalElements").value(1))
                .andExpect(jsonPath("$.data.content[0].attemptId").value(seeded.scoredAttemptId()))
                .andExpect(jsonPath("$.data.content[0].status").value("COMPLETADO"))
                .andExpect(jsonPath("$.data.content[0].startedAt").value("2026-11-26T09:00:00"))
                .andExpect(jsonPath("$.data.content[0].finishedAt").value("2026-11-26T09:30:00"))
                .andExpect(jsonPath("$.data.content[0].totalTimeSeconds").value(1800))
                .andExpect(jsonPath("$.data.content[0].participant.id").value(seeded.participantIds().get(0).toString()))
                .andExpect(jsonPath("$.data.content[0].participant.code").value(org.hamcrest.Matchers.startsWith("P-A-")))
                .andExpect(jsonPath("$.data.content[0].participant.fullName").value("Ana Lopez"))
                .andExpect(jsonPath("$.data.content[0].session.id").value(seeded.session1Id()))
                .andExpect(jsonPath("$.data.content[0].session.name").value("Sesion Uno"))
                .andExpect(jsonPath("$.data.content[0].version.id").value(seeded.version1Id()))
                .andExpect(jsonPath("$.data.content[0].version.testName").value("BFA Inventario"))
                .andExpect(jsonPath("$.data.content[0].version.number").value("1.0"))
                .andExpect(jsonPath("$.data.content[0].scored").value(true))
                .andExpect(jsonPath("$.data.content[0].resultId").value(seeded.scoredResultId()))
                .andExpect(jsonPath("$.data.content[0].pendingManualReviews").value(2));
    }

    @Test
    void psicologoConCalificacionEjecutarObtiene200YSinToken401() throws Exception {
        seeded = seedScenario();

        mvc.perform(get("/attempts")
                        .param("sessionId", String.valueOf(seeded.session1Id()))
                        .header("Authorization", bearer(Set.of("CALIFICACION_EJECUTAR"), Set.of("PSICOLOGO_COORDINADOR"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.totalElements").value(3));

        mvc.perform(get("/attempts"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));
    }

    @Test
    void aplicadorSinPermisosRecibe403() throws Exception {
        seeded = seedScenario();

        mvc.perform(get("/attempts")
                        .header("Authorization", bearer(
                                Set.of("SESION_CREAR", "SESION_APLICAR", "PARTICIPANTE_LEER"),
                                Set.of("APLICADOR"))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    @Test
    void scoredFalseExcluyeIntentosConResultado() throws Exception {
        seeded = seedScenario();

        mvc.perform(get("/attempts")
                        .param("scored", "false")
                        .param("versionTestId", String.valueOf(seeded.version1Id()))
                        .header("Authorization", bearer(Set.of("CALIFICACION_EJECUTAR"), Set.of("PSICOLOGO_COORDINADOR"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalElements").value(2))
                .andExpect(jsonPath("$.data.content[*].attemptId", org.hamcrest.Matchers.containsInAnyOrder(
                        (int) seeded.unscoredCompletedAttemptId(),
                        (int) seeded.inProgressAttemptId())))
                .andExpect(jsonPath("$.data.content[*].attemptId", org.hamcrest.Matchers.not(
                        org.hamcrest.Matchers.hasItem((int) seeded.scoredAttemptId()))))
                .andExpect(jsonPath("$.data.content[*].scored", org.hamcrest.Matchers.everyItem(org.hamcrest.Matchers.is(false))));
    }

    @Test
    void filtrosCombinadosPaginacionYOrdenamiento() throws Exception {
        seeded = seedScenario();

        // Filtros combinados: sessionId + versionTestId + status + scored + participantCode + rango from/to
        mvc.perform(get("/attempts")
                        .param("status", "COMPLETADO")
                        .param("scored", "false")
                        .param("sessionId", String.valueOf(seeded.session1Id()))
                        .param("versionTestId", String.valueOf(seeded.version1Id()))
                        .param("participantCode", "p-b-")
                        .param("from", "2026-11-26T10:00:00")
                        .param("to", "2026-11-26T12:00:00Z")
                        .header("Authorization", bearer(Set.of("RESULTADO_VER"), Set.of("CONSULTOR_REPORTES"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalElements").value(1))
                .andExpect(jsonPath("$.data.content[0].attemptId").value(seeded.unscoredCompletedAttemptId()))
                .andExpect(jsonPath("$.data.content[0].scored").value(false))
                .andExpect(jsonPath("$.data.content[0].resultId").doesNotExist());

        // Paginacion sobre los 4 intentos sembrados (filtrados por test via version1 + version2 o participantCode)
        // Ordenado por participantCode,asc: A (scored), B (unscoredCompleted), C (inProgress), D (interrupted)
        mvc.perform(get("/attempts")
                        .param("participantCode", "P-")
                        .param("page", "0")
                        .param("size", "2")
                        .param("sort", "participantCode,asc")
                        .header("Authorization", bearer(Set.of("RESULTADO_VER"), Set.of("CONSULTOR_REPORTES"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.number").value(0))
                .andExpect(jsonPath("$.data.size").value(2))
                .andExpect(jsonPath("$.data.numberOfElements").value(2))
                .andExpect(jsonPath("$.data.totalElements").value(4))
                .andExpect(jsonPath("$.data.totalPages").value(2))
                .andExpect(jsonPath("$.data.first").value(true))
                .andExpect(jsonPath("$.data.last").value(false))
                .andExpect(jsonPath("$.data.content[0].attemptId").value(seeded.scoredAttemptId()))
                .andExpect(jsonPath("$.data.content[1].attemptId").value(seeded.unscoredCompletedAttemptId()));

        mvc.perform(get("/attempts")
                        .param("participantCode", "P-")
                        .param("page", "1")
                        .param("size", "2")
                        .param("sort", "participantCode,asc")
                        .header("Authorization", bearer(Set.of("RESULTADO_VER"), Set.of("CONSULTOR_REPORTES"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.number").value(1))
                .andExpect(jsonPath("$.data.numberOfElements").value(2))
                .andExpect(jsonPath("$.data.totalElements").value(4))
                .andExpect(jsonPath("$.data.first").value(false))
                .andExpect(jsonPath("$.data.last").value(true))
                .andExpect(jsonPath("$.data.content[0].attemptId").value(seeded.inProgressAttemptId()))
                .andExpect(jsonPath("$.data.content[1].attemptId").value(seeded.interruptedOtherVersionAttemptId()));

        // size > 100 se limita a 100
        mvc.perform(get("/attempts")
                        .param("size", "250")
                        .param("sort", "iniciadoEn,asc")
                        .header("Authorization", bearer(Set.of("RESULTADO_VER"), Set.of("CONSULTOR_REPORTES"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.size").value(100));
    }

    @Test
    void parametrosInvalidosDevuelven400() throws Exception {
        String auth = bearer(Set.of("RESULTADO_VER"), Set.of("CONSULTOR_REPORTES"));

        mvc.perform(get("/attempts").param("status", "INEXISTENTE").header("Authorization", auth))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("BAD_REQUEST"));

        mvc.perform(get("/attempts").param("sort", "totalTimeSeconds,desc").header("Authorization", auth))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("BAD_REQUEST"));

        mvc.perform(get("/attempts").param("sort", "finalizadoEn,lateral").header("Authorization", auth))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("BAD_REQUEST"));

        mvc.perform(get("/attempts").param("from", "no-es-fecha").header("Authorization", auth))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("BAD_REQUEST"));

        mvc.perform(get("/attempts").param("page", "-1").header("Authorization", auth))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("BAD_REQUEST"));

        mvc.perform(get("/attempts").param("size", "0").header("Authorization", auth))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("BAD_REQUEST"));
    }

    @Test
    void indiceCompuestoEstadoFinalizadoExisteEnPostgres() {
        Long count = jdbc.queryForObject(
                "select count(*) from pg_indexes where tablename = 'intento_test' and indexname = 'idx_intento_estado_fin'",
                Long.class);
        assertThat(count).isEqualTo(1L);
    }

    private SeededData seedScenario() {
        return new TransactionTemplate(txManager).execute(status -> {
            String suffix = UUID.randomUUID().toString().substring(0, 8);
            UUID evaluatorId = UUID.randomUUID();
            jdbc.update(
                    "insert into usuario (usuario_id, nombre_usuario, correo, hash_contrasena, nombre_completo) "
                            + "values (?, ?, ?, 'hash', 'Evaluador B14')",
                    evaluatorId, "eval_" + suffix, "eval_" + suffix + "@uam.edu");

            long testId = jdbc.queryForObject(
                    "insert into test (codigo_test, nombre_test) values (?, 'BFA Inventario') returning test_id",
                    Long.class, "B14-" + suffix);

            long estrategiaId = jdbc.queryForObject(
                    "select estrategia_calificacion_id from estrategia_calificacion limit 1", Long.class);
            Timestamp approvedAt = Timestamp.valueOf(LocalDateTime.of(2026, 11, 25, 10, 0));
            long version1Id = jdbc.queryForObject(
                    "insert into version_test (test_id, estrategia_calificacion_id, numero_version, estado, "
                            + "aprobado_por, aprobado_en, publicado_en) "
                            + "values (?, ?, '1.0', 'BORRADOR', ?, ?, ?) returning version_test_id",
                    Long.class, testId, estrategiaId, evaluatorId, approvedAt, approvedAt);
            long version2Id = jdbc.queryForObject(
                    "insert into version_test (test_id, estrategia_calificacion_id, numero_version, estado, "
                            + "aprobado_por, aprobado_en, publicado_en) "
                            + "values (?, ?, '2.0', 'BORRADOR', ?, ?, ?) returning version_test_id",
                    Long.class, testId, estrategiaId, evaluatorId, approvedAt, approvedAt);

            long subtestId = jdbc.queryForObject(
                    "insert into subtest (version_test_id, codigo_subtest, nombre_subtest, numero_orden) "
                            + "values (?, 'SUB-1', 'Subtest 1', 1) returning subtest_id",
                    Long.class, version1Id);

            List<Long> itemIds = new ArrayList<>();
            for (int i = 1; i <= 3; i++) {
                long itemId = jdbc.queryForObject(
                        "insert into item (subtest_id, codigo_item, tipo_item, tipo_respuesta, enunciado, numero_orden) "
                                + "values (?, ?, 'SOLO_TEXTO', 'TEXTO_ABIERTO', ?, ?) returning item_id",
                        Long.class, subtestId, "IT-" + i, "Pregunta " + i, i);
                itemIds.add(itemId);
            }

            jdbc.update("update version_test set estado = 'PUBLICADO' where version_test_id in (?, ?)",
                    version1Id, version2Id);

            long session1Id = jdbc.queryForObject(
                    "insert into sesion_aplicacion (version_test_id, codigo_sesion, nombre_sesion, inicio_programado) "
                            + "values (?, ?, 'Sesion Uno', ?) returning sesion_aplicacion_id",
                    Long.class, version1Id, "SES1-" + suffix,
                    Timestamp.valueOf(LocalDateTime.of(2026, 11, 26, 8, 0)));
            jdbc.update(
                    "insert into sesion_subtest (sesion_aplicacion_id, version_test_id, subtest_id, numero_orden) "
                            + "values (?, ?, ?, 1)",
                    session1Id, version1Id, subtestId);
            long session2Id = jdbc.queryForObject(
                    "insert into sesion_aplicacion (version_test_id, codigo_sesion, nombre_sesion, inicio_programado) "
                            + "values (?, ?, 'Sesion Dos', ?) returning sesion_aplicacion_id",
                    Long.class, version2Id, "SES2-" + suffix,
                    Timestamp.valueOf(LocalDateTime.of(2026, 11, 26, 8, 30)));

            UUID p1 = insertParticipant("P-A-" + suffix, "Ana", "Lopez");
            UUID p2 = insertParticipant("P-B-" + suffix, "Bruno", "Diaz");
            UUID p3 = insertParticipant("P-C-" + suffix, "Carla", "Mendez");
            UUID p4 = insertParticipant("P-D-" + suffix, "Diego", "Ruiz");
            List<UUID> participantIds = List.of(p1, p2, p3, p4);

            long a1 = insertAssignment(session1Id, p1, evaluatorId, "TOK1-" + suffix, "COMPLETADO");
            long a2 = insertAssignment(session1Id, p2, evaluatorId, "TOK2-" + suffix, "COMPLETADO");
            long a3 = insertAssignment(session1Id, p3, evaluatorId, "TOK3-" + suffix, "EN_PROGRESO");
            long a4 = insertAssignment(session2Id, p4, evaluatorId, "TOK4-" + suffix, "COMPLETADO");

            long scoredAttemptId = insertAttempt(a1,
                    LocalDateTime.of(2026, 11, 26, 9, 0),
                    LocalDateTime.of(2026, 11, 26, 9, 30),
                    "COMPLETADO", 1800);
            long unscoredCompletedAttemptId = insertAttempt(a2,
                    LocalDateTime.of(2026, 11, 26, 10, 0),
                    LocalDateTime.of(2026, 11, 26, 11, 0),
                    "COMPLETADO", 3600);
            long inProgressAttemptId = insertAttempt(a3,
                    LocalDateTime.of(2026, 11, 26, 12, 0),
                    null,
                    "EN_PROGRESO", null);
            long interruptedOtherVersionAttemptId = insertAttempt(a4,
                    LocalDateTime.of(2026, 11, 26, 13, 0),
                    LocalDateTime.of(2026, 11, 26, 13, 15),
                    "INTERRUMPIDO", 900);

            long scoredResultId = jdbc.queryForObject(
                    "insert into resultado (intento_id, calculado_en, calculado_por, puntaje_total_directo, "
                            + "cantidad_items, cantidad_correctas, cantidad_incorrectas, cantidad_pendientes_revision, "
                            + "requiere_revision_manual, estado) "
                            + "values (?, ?, ?, 10.00, 3, 1, 0, 2, true, 'CALCULADO') returning resultado_id",
                    Long.class, scoredAttemptId, Timestamp.valueOf(LocalDateTime.of(2026, 11, 26, 9, 35)), evaluatorId);

            long resp1 = insertResponse(scoredAttemptId, itemIds.get(0));
            long resp2 = insertResponse(scoredAttemptId, itemIds.get(1));
            long resp3 = insertResponse(scoredAttemptId, itemIds.get(2));

            // 2 no revisadas (PENDIENTE y OBSERVADO) + 1 REVISADO => pendingManualReviews = 2
            jdbc.update("insert into revision_manual_respuesta (respuesta_id, estado) values (?, 'PENDIENTE')", resp1);
            jdbc.update("insert into revision_manual_respuesta (respuesta_id, estado) values (?, 'OBSERVADO')", resp2);
            jdbc.update(
                    "insert into revision_manual_respuesta (respuesta_id, estado, puntaje_asignado, revisado_por, revisado_en) "
                            + "values (?, 'REVISADO', 5.00, ?, ?)",
                    resp3, evaluatorId, Timestamp.valueOf(LocalDateTime.of(2026, 11, 26, 9, 40)));

            return new SeededData(
                    evaluatorId,
                    participantIds,
                    testId,
                    version1Id,
                    version2Id,
                    subtestId,
                    itemIds,
                    session1Id,
                    session2Id,
                    List.of(scoredAttemptId, unscoredCompletedAttemptId, inProgressAttemptId,
                            interruptedOtherVersionAttemptId),
                    scoredAttemptId,
                    scoredResultId,
                    unscoredCompletedAttemptId,
                    inProgressAttemptId,
                    interruptedOtherVersionAttemptId);
        });
    }

    private UUID insertParticipant(String code, String firstNames, String lastNames) {
        UUID id = UUID.randomUUID();
        jdbc.update(
                "insert into participante (participante_id, codigo_participante, nombres, apellidos) "
                        + "values (?, ?, ?, ?)",
                id, code, firstNames, lastNames);
        return id;
    }

    private long insertAssignment(long sessionId, UUID participantId, UUID evaluatorId, String tokenHash, String state) {
        return jdbc.queryForObject(
                "insert into asignacion_test (sesion_aplicacion_id, participante_id, evaluador_id, "
                        + "token_acceso_hash, token_expira_en, estado) "
                        + "values (?, ?, ?, ?, ?, cast(? as estado_asignacion)) returning asignacion_id",
                Long.class, sessionId, participantId, evaluatorId, tokenHash,
                Timestamp.valueOf(LocalDateTime.of(2026, 11, 27, 0, 0)), state);
    }

    private long insertAttempt(long assignmentId, LocalDateTime startedAt, LocalDateTime finishedAt, String state,
            Integer totalSeconds) {
        return jdbc.queryForObject(
                "insert into intento_test (asignacion_id, iniciado_en, finalizado_en, estado, tiempo_total_segundos) "
                        + "values (?, ?, ?, cast(? as estado_intento), ?) returning intento_id",
                Long.class,
                assignmentId,
                startedAt == null ? null : Timestamp.valueOf(startedAt),
                finishedAt == null ? null : Timestamp.valueOf(finishedAt),
                state,
                totalSeconds);
    }

    private long insertResponse(long attemptId, long itemId) {
        return jdbc.queryForObject(
                "insert into respuesta_item (intento_id, item_id, respuesta_texto_abierto, requiere_revision_manual) "
                        + "values (?, ?, 'Respuesta', true) returning respuesta_id",
                Long.class, attemptId, itemId);
    }

    private String bearer(Set<String> permissions, Set<String> roles) {
        return "Bearer " + jwt.emitir(UUID.randomUUID(), "usuario_b14", permissions, roles);
    }
}

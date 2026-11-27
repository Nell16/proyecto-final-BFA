package com.uam.psychoform.assessment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.uam.psychoform.PsychoformApplication;
import com.uam.psychoform.assessment.service.ParticipantAccessService.ParticipantAccess;
import com.uam.psychoform.assessment.service.ParticipantAnswerService;
import com.uam.psychoform.security.service.JwtService;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * Monitor de sesion (B3, B11, B17) sobre la BD real. Transaccional: los datos se revierten al terminar.
 */
@SpringBootTest(classes = PsychoformApplication.class)
@AutoConfigureMockMvc
@Transactional
class SessionMonitorIntegrationTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    @Autowired
    MockMvc mvc;

    @Autowired
    JwtService jwt;

    @Autowired
    JdbcTemplate jdbc;

    private UUID userId;
    private long versionId;
    private long sessionId;
    private UUID participantA;
    private UUID participantB;
    private long assignmentA;
    private long assignmentB;
    private long subtestId;
    private long itemId;
    private long sessionSubtestId;

    @Autowired
    ParticipantAnswerService answers;

    @BeforeEach
    void seed() {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        userId = jdbc.queryForObject("insert into usuario (nombre_usuario, correo, hash_contrasena, nombre_completo) "
                + "values (?, ?, 'x', 'Aplicador Monitor') returning usuario_id", UUID.class,
                "mon-" + suffix, "mon-" + suffix + "@test.local");
        long estrategiaId = id("select estrategia_calificacion_id from estrategia_calificacion "
                + "where codigo = 'CLAVE_SIMPLE'");
        long testId = id("insert into test (codigo_test, nombre_test) values (?, ?) returning test_id",
                "MON-" + suffix, "Test monitor " + suffix);
        versionId = id("insert into version_test (test_id, estrategia_calificacion_id, numero_version, estado) "
                + "values (?, ?, '1.0', 'BORRADOR') returning version_test_id", testId, estrategiaId);
        long subtestId = id("insert into subtest (version_test_id, codigo_subtest, nombre_subtest, numero_orden) "
                + "values (?, 'SUB-1', 'Subtest 1', 1) returning subtest_id", versionId);
        itemId = id("insert into item (subtest_id, codigo_item, tipo_item, tipo_respuesta, enunciado, numero_orden) "
                + "values (?, 'IT-1', 'SOLO_TEXTO', 'TEXTO_ABIERTO', 'Pregunta', 1) returning item_id", subtestId);
        jdbc.update("update version_test set estado = 'PUBLICADO', aprobado_por = ?, aprobado_en = now(), "
                + "publicado_en = now() where version_test_id = ?", userId, versionId);
        sessionId = id("insert into sesion_aplicacion (version_test_id, codigo_sesion, nombre_sesion, "
                + "inicio_programado, estado) values (?, ?, ?, now(), 'ABIERTA') "
                + "returning sesion_aplicacion_id", versionId, "SES-" + suffix, "Sesion " + suffix);
        sessionSubtestId = id("insert into sesion_subtest (sesion_aplicacion_id, version_test_id, subtest_id, "
                + "numero_orden) values (?, ?, ?, 1) returning sesion_subtest_id", sessionId, versionId, subtestId);
        this.subtestId = subtestId;
        participantA = insertParticipant("PA-" + suffix, "Ana", "Perez");
        participantB = insertParticipant("PB-" + suffix, "Beto", "Gomez");
        assignmentA = insertAssignment(sessionId, participantA, "ASIGNADO", LocalDateTime.now().plusHours(8));
        assignmentB = insertAssignment(sessionId, participantB, "ASIGNADO", LocalDateTime.now().plusHours(8));
    }

    // ---- B3 ----

    @Test
    void registraDosIncidenciasYLasListaEnOrdenConTextoParticipanteYAutor() throws Exception {
        postIncidence(participantA, "Primera incidencia");
        postIncidence(null, "Segunda incidencia, sin participante");

        mvc.perform(get("/sesiones/{id}/incidencias", sessionId).header("Authorization", bearer("SESION_LEER")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.data[0].text").value("Primera incidencia"))
                .andExpect(jsonPath("$.data[0].participantId").value(participantA.toString()))
                .andExpect(jsonPath("$.data[0].participantName").value("Ana Perez"))
                .andExpect(jsonPath("$.data[0].recordedBy").value("Aplicador Monitor"))
                .andExpect(jsonPath("$.data[0].recordedAt").isNotEmpty())
                .andExpect(jsonPath("$.data[0].id").isNumber())
                .andExpect(jsonPath("$.data[1].text").value("Segunda incidencia, sin participante"))
                .andExpect(jsonPath("$.data[1].participantId").doesNotExist())
                .andExpect(jsonPath("$.data[1].participantName").doesNotExist());
    }

    @Test
    void textoConComillasBarrasYSaltosDeLineaSeGuardaYSeLeeIgual() throws Exception {
        String text = "Dijo \"alto\" \\ barra\ny salto\r\ncon tab\t y unicode: ñ";
        postIncidence(participantA, text);

        mvc.perform(get("/sesiones/{id}/incidencias", sessionId).header("Authorization", bearer("SESION_LEER")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].text").value(text));
    }

    @Test
    void listarIncidenciasDeSesionInexistenteEs404() throws Exception {
        mvc.perform(get("/sesiones/{id}/incidencias", 999_999_999L).header("Authorization", bearer("SESION_LEER")))
                .andExpect(status().isNotFound());
    }

    @Test
    void consultorSinSesionLeerNoPuedeListarIncidencias() throws Exception {
        mvc.perform(get("/sesiones/{id}/incidencias", sessionId)
                .header("Authorization", bearer("RESULTADO_VER")))
                .andExpect(status().isForbidden());
    }

    @Test
    void incidenciaConTextoVacioOMuyLargoEs400() throws Exception {
        for (String text : new String[] { "", "   ", "x".repeat(1001) }) {
            mvc.perform(post("/sesiones/{id}/incidencias", sessionId).header("Authorization", bearer("SESION_APLICAR"))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(JSON.writeValueAsString(Map.of("text", text))))
                    .andExpect(status().isBadRequest());
        }
        mvc.perform(post("/sesiones/{id}/incidencias", sessionId).header("Authorization", bearer("SESION_APLICAR"))
                .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void incidenciaConParticipanteNoAsignadoALaSesionEs400() throws Exception {
        mvc.perform(post("/sesiones/{id}/incidencias", sessionId).header("Authorization", bearer("SESION_APLICAR"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(Map.of("participantId", UUID.randomUUID().toString(),
                        "text", "ajeno"))))
                .andExpect(status().isBadRequest());
    }

    // ---- B17 ----

    @Test
    void bulkSyncPersisteElRechazoUnaSolaVezYLoCuentaAlRepetirlo() {
        long attempt = startedAttempt(assignmentA);
        long missingItem = 987_654_321L;

        var first = bulkSync(attempt, participantA, assignmentA, saveCmd(attempt, itemId), saveCmd(attempt, missingItem));

        assertThat(first).extracting(ParticipantAnswerService.BulkSyncResult::status)
                .containsExactly("GUARDADA", "RECHAZADA");
        assertThat(rejectionRows(attempt)).isEqualTo(1);
        assertThat(rejectionVeces(attempt, missingItem)).isEqualTo(1);

        bulkSync(attempt, participantA, assignmentA, saveCmd(attempt, itemId), saveCmd(attempt, missingItem));

        assertThat(rejectionRows(attempt)).isEqualTo(1);
        assertThat(rejectionVeces(attempt, missingItem)).isEqualTo(2);
    }

    @Test
    void monitorMuestraConteoYRechazosRecientesYVacioSiNoHay() throws Exception {
        long attempt = startedAttempt(assignmentA);
        bulkSync(attempt, participantA, assignmentA, saveCmd(attempt, 987_654_321L));

        mvc.perform(get("/sesiones/{id}/asignaciones", sessionId).header("Authorization", bearer("SESION_LEER")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[?(@.assignmentId==" + assignmentA + ")].rejectedAnswersCount").value(1))
                .andExpect(jsonPath("$.data[?(@.assignmentId==" + assignmentA + ")].rejectedAnswers[0].code")
                        .value("ITEM_NO_ENCONTRADO"))
                .andExpect(jsonPath("$.data[?(@.assignmentId==" + assignmentA + ")].rejectedAnswers[0].itemId")
                        .value(987_654_321))
                .andExpect(jsonPath("$.data[?(@.assignmentId==" + assignmentA + ")].rejectedAnswers[0].rejectedAt")
                        .isNotEmpty())
                .andExpect(jsonPath("$.data[?(@.assignmentId==" + assignmentB + ")].rejectedAnswersCount").value(0))
                .andExpect(jsonPath("$.data[?(@.assignmentId==" + assignmentB + ")].rejectedAnswers").isArray())
                .andExpect(jsonPath("$.data[?(@.assignmentId==" + assignmentB + ")].rejectedAnswers[0]").isEmpty());
    }

    @Test
    void monitorLimitaA20RechazosLosMasRecientesPeroCuentaTodos() throws Exception {
        long attempt = startedAttempt(assignmentA);
        for (int i = 1; i <= 25; i++) {
            jdbc.update("insert into respuesta_rechazada (intento_id, item_id, codigo, rechazado_en) "
                    + "values (?, ?, 'ITEM_NO_ENCONTRADO', ?)", attempt, 1000L + i,
                    Timestamp.valueOf(LocalDateTime.of(2026, 11, 26, 10, 0, 0).plusMinutes(i)));
        }

        mvc.perform(get("/sesiones/{id}/asignaciones", sessionId).header("Authorization", bearer("SESION_LEER")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[?(@.assignmentId==" + assignmentA + ")].rejectedAnswersCount").value(25))
                .andExpect(jsonPath("$.data[?(@.assignmentId==" + assignmentA + ")].rejectedAnswers.length()")
                        .value(20))
                .andExpect(jsonPath("$.data[?(@.assignmentId==" + assignmentA + ")].rejectedAnswers[0].itemId")
                        .value(1025))
                .andExpect(jsonPath("$.data[?(@.assignmentId==" + assignmentA + ")].rejectedAnswers[19].itemId")
                        .value(1006));
    }

    // ---- B11 ----

    @Test
    void asignacionesIncluyenEstadosCrudosYEstadosCoherentes() throws Exception {
        // A: anulada con intento COMPLETADO. B: token vencido sin intento (sigue ASIGNADO en BD).
        long attemptA = id("insert into intento_test (asignacion_id, estado, iniciado_en, finalizado_en) "
                + "values (?, 'COMPLETADO', now() at time zone 'utc', now() at time zone 'utc') returning intento_id",
                assignmentA);
        jdbc.update("update asignacion_test set estado = 'ANULADO' where asignacion_id = ?", assignmentA);
        jdbc.update("update asignacion_test set token_expira_en = ? where asignacion_id = ?",
                Timestamp.valueOf(LocalDateTime.now().minusHours(2)), assignmentB);

        mvc.perform(get("/sesiones/{id}/asignaciones", sessionId).header("Authorization", bearer("SESION_LEER")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[?(@.assignmentId==" + assignmentA + ")].attemptId").value((int) attemptA))
                .andExpect(jsonPath("$.data[?(@.assignmentId==" + assignmentA + ")].status").value("REVOCADO"))
                .andExpect(jsonPath("$.data[?(@.assignmentId==" + assignmentA + ")].state").value("completado"))
                .andExpect(jsonPath("$.data[?(@.assignmentId==" + assignmentA + ")].assignmentStatus")
                        .value("ANULADO"))
                .andExpect(jsonPath("$.data[?(@.assignmentId==" + assignmentA + ")].attemptStatus")
                        .value("COMPLETADO"))
                .andExpect(jsonPath("$.data[?(@.assignmentId==" + assignmentB + ")].status").value("VENCIDO"))
                .andExpect(jsonPath("$.data[?(@.assignmentId==" + assignmentB + ")].state").value("no-iniciado"))
                .andExpect(jsonPath("$.data[?(@.assignmentId==" + assignmentB + ")].assignmentStatus")
                        .value("ASIGNADO"))
                .andExpect(jsonPath("$.data[?(@.assignmentId==" + assignmentB + ")].attemptStatus").value(
                        org.hamcrest.Matchers.contains((Object) null)));
    }

    // ---- helpers ----

    private long startedAttempt(long assignmentId) {
        long attempt = id("insert into intento_test (asignacion_id, estado, iniciado_en, ultima_actividad_en) "
                + "values (?, 'EN_PROGRESO', now() at time zone 'utc', now() at time zone 'utc') returning intento_id",
                assignmentId);
        jdbc.update("insert into intento_subtest (intento_id, sesion_subtest_id, subtest_id, iniciado_en, estado) "
                + "values (?, ?, ?, now() at time zone 'utc', 'EN_PROGRESO')", attempt, sessionSubtestId, subtestId);
        return attempt;
    }

    private static ParticipantAnswerService.SaveAnswerCommand saveCmd(long attemptId, long item) {
        return new ParticipantAnswerService.SaveAnswerCommand(attemptId, item, List.of(), "respuesta", null, null);
    }

    private List<ParticipantAnswerService.BulkSyncResult> bulkSync(long attemptId, UUID participant, long assignment,
            ParticipantAnswerService.SaveAnswerCommand... commands) {
        return answers.bulkSyncAnswers(new ParticipantAccess(assignment, participant),
                new ParticipantAnswerService.BulkSyncAnswersCommand(attemptId, List.of(commands)));
    }

    private int rejectionRows(long attemptId) {
        return jdbc.queryForObject("select count(*) from respuesta_rechazada where intento_id = ?", Integer.class,
                attemptId);
    }

    private int rejectionVeces(long attemptId, long item) {
        return jdbc.queryForObject("select veces from respuesta_rechazada where intento_id = ? and item_id = ?",
                Integer.class, attemptId, item);
    }


    private void postIncidence(UUID participantId, String text) throws Exception {
        Map<String, Object> body = new java.util.LinkedHashMap<>();
        if (participantId != null) {
            body.put("participantId", participantId.toString());
        }
        body.put("text", text);
        mvc.perform(post("/sesiones/{id}/incidencias", sessionId).header("Authorization", bearer("SESION_APLICAR"))
                .contentType(MediaType.APPLICATION_JSON).content(JSON.writeValueAsString(body)))
                .andExpect(status().isOk());
    }

    private UUID insertParticipant(String code, String firstNames, String lastNames) {
        UUID id = UUID.randomUUID();
        jdbc.update("insert into participante (participante_id, codigo_participante, nombres, apellidos) "
                + "values (?, ?, ?, ?)", id, code, firstNames, lastNames);
        return id;
    }

    private long insertAssignment(long session, UUID participantId, String state, LocalDateTime tokenExpiresAt) {
        return id("insert into asignacion_test (sesion_aplicacion_id, participante_id, evaluador_id, "
                + "token_acceso_hash, token_expira_en, estado) "
                + "values (?, ?, ?, ?, ?, cast(? as estado_asignacion)) returning asignacion_id",
                session, participantId, userId, UUID.randomUUID().toString().replace("-", ""),
                Timestamp.valueOf(tokenExpiresAt), state);
    }

    private long id(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }

    /** El token lleva el usuario sembrado, para que la auditoria resuelva el autor. */
    private String bearer(String permission) {
        return "Bearer " + jwt.emitir(userId, "monitor", Set.of(permission), Set.of("ROL_PRUEBA"));
    }
}

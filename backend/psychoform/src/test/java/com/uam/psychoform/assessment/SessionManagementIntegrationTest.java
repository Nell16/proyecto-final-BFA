package com.uam.psychoform.assessment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.uam.psychoform.PsychoformApplication;
import com.uam.psychoform.assessment.dto.SessionSubtestRequest;
import com.uam.psychoform.security.service.JwtService;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(classes = PsychoformApplication.class)
@AutoConfigureMockMvc
class SessionManagementIntegrationTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    @Autowired
    MockMvc mvc;

    @Autowired
    JwtService jwt;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    PlatformTransactionManager txManager;

    private Scenario scenario;

    private record Scenario(UUID userId, long testId, long versionId, List<Long> subtestIds, long sessionId,
            long otherTestId, long otherVersionId) {
    }

    @AfterEach
    void cleanup() {
        if (scenario == null) {
            return;
        }
        Scenario s = scenario;
        new TransactionTemplate(txManager).executeWithoutResult(status -> {
            jdbc.execute("set local session_replication_role = replica");
            jdbc.update("delete from sesion_subtest where sesion_aplicacion_id = ?", s.sessionId());
            jdbc.update("delete from sesion_aplicacion where sesion_aplicacion_id = ?", s.sessionId());
            jdbc.update("delete from subtest where version_test_id in (?, ?)", s.versionId(), s.otherVersionId());
            jdbc.update("delete from version_test where version_test_id in (?, ?)", s.versionId(), s.otherVersionId());
            jdbc.update("delete from test where test_id in (?, ?)", s.testId(), s.otherTestId());
            jdbc.update("delete from usuario where usuario_id = ?", s.userId());
        });
    }

    @Test
    void replaceModeOmittingSavedOneDeletesItAndReturnsSortedResult() throws Exception {
        scenario = seed("PROGRAMADA");

        List<SessionSubtestRequest> initial = List.of(
                new SessionSubtestRequest(scenario.subtestIds().get(1), 2, 300, true, false),
                new SessionSubtestRequest(scenario.subtestIds().get(0), 1, null, false, true));

        mvc.perform(put("/sesiones/{id}/subtests", scenario.sessionId())
                .header("Authorization", bearer("SESION_CREAR"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(initial)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.data[0].subtestId").value(scenario.subtestIds().get(0)))
                .andExpect(jsonPath("$.data[0].numeroOrden").value(1))
                .andExpect(jsonPath("$.data[1].subtestId").value(scenario.subtestIds().get(1)))
                .andExpect(jsonPath("$.data[1].numeroOrden").value(2));

        List<SessionSubtestRequest> replaced = List.of(
                new SessionSubtestRequest(scenario.subtestIds().get(1), 1, 450, false, false));

        mvc.perform(put("/sesiones/{id}/subtests?mode=replace", scenario.sessionId())
                .header("Authorization", bearer("SESION_CREAR"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(replaced)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].subtestId").value(scenario.subtestIds().get(1)))
                .andExpect(jsonPath("$.data[0].numeroOrden").value(1))
                .andExpect(jsonPath("$.data[0].tiempoLimiteSegundos").value(450));

        Integer count = jdbc.queryForObject("select count(*) from sesion_subtest where sesion_aplicacion_id = ?",
                Integer.class, scenario.sessionId());
        assertThat(count).isEqualTo(1);
    }

    @Test
    void replaceModeWithEmptyListDeletesAllSavedSubtests() throws Exception {
        scenario = seed("PROGRAMADA");

        List<SessionSubtestRequest> initial = List.of(
                new SessionSubtestRequest(scenario.subtestIds().get(0), 1, 300, false, false),
                new SessionSubtestRequest(scenario.subtestIds().get(1), 2, 300, false, false));

        mvc.perform(put("/sesiones/{id}/subtests", scenario.sessionId())
                .header("Authorization", bearer("SESION_CREAR"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(initial)))
                .andExpect(status().isOk());

        mvc.perform(put("/sesiones/{id}/subtests?mode=replace", scenario.sessionId())
                .header("Authorization", bearer("SESION_CREAR"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("[]"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data").isArray())
                .andExpect(jsonPath("$.data.length()").value(0));

        Integer count = jdbc.queryForObject("select count(*) from sesion_subtest where sesion_aplicacion_id = ?",
                Integer.class, scenario.sessionId());
        assertThat(count).isZero();
    }

    @Test
    void withoutModeOmittingSavedSubtestKeepsItAndUpsertsTheRest() throws Exception {
        scenario = seed("PROGRAMADA");

        List<SessionSubtestRequest> initial = List.of(
                new SessionSubtestRequest(scenario.subtestIds().get(0), 1, 300, false, false),
                new SessionSubtestRequest(scenario.subtestIds().get(1), 2, 600, false, false));
        mvc.perform(put("/sesiones/{id}/subtests", scenario.sessionId())
                .header("Authorization", bearer("SESION_CREAR"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(initial)))
                .andExpect(status().isOk());

        List<SessionSubtestRequest> partial = List.of(
                new SessionSubtestRequest(scenario.subtestIds().get(1), 2, 450, false, false));
        mvc.perform(put("/sesiones/{id}/subtests", scenario.sessionId())
                .header("Authorization", bearer("SESION_CREAR"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(partial)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.data[0].subtestId").value(scenario.subtestIds().get(1)))
                .andExpect(jsonPath("$.data[0].numeroOrden").value(2))
                .andExpect(jsonPath("$.data[0].tiempoLimiteSegundos").value(450))
                .andExpect(jsonPath("$.data[1].subtestId").value(scenario.subtestIds().get(0)))
                .andExpect(jsonPath("$.data[1].numeroOrden").value(3));

        Integer count = jdbc.queryForObject("select count(*) from sesion_subtest where sesion_aplicacion_id = ?",
                Integer.class, scenario.sessionId());
        assertThat(count).isEqualTo(2);
        assertThat(subtestOrderInSession(scenario.subtestIds().get(0))).isEqualTo(3);
        assertThat(subtestOrderInSession(scenario.subtestIds().get(1))).isEqualTo(2);

        mvc.perform(put("/sesiones/{id}/subtests", scenario.sessionId())
                .header("Authorization", bearer("SESION_CREAR"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("[]"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(0));
        count = jdbc.queryForObject("select count(*) from sesion_subtest where sesion_aplicacion_id = ?",
                Integer.class, scenario.sessionId());
        assertThat(count).isEqualTo(2);
        assertThat(subtestOrderInSession(scenario.subtestIds().get(0))).isEqualTo(3);
        assertThat(subtestOrderInSession(scenario.subtestIds().get(1))).isEqualTo(2);
    }

    @Test
    void wizardResumeUncheckingFirstSubtestRelocatesKeptOneAfterSentOnes() throws Exception {
        scenario = seed("PROGRAMADA");
        long a = scenario.subtestIds().get(0);
        long b = scenario.subtestIds().get(1);

        putSubtests(List.of(
                new SessionSubtestRequest(a, 1, 300, false, false),
                new SessionSubtestRequest(b, 2, 600, false, false)))
                .andExpect(status().isOk());

        // El wizard reanudado desmarca A y reenvia solo B con order 1.
        putSubtests(List.of(new SessionSubtestRequest(b, 1, 600, false, false)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.data[0].subtestId").value(b))
                .andExpect(jsonPath("$.data[0].numeroOrden").value(1))
                .andExpect(jsonPath("$.data[1].subtestId").value(a))
                .andExpect(jsonPath("$.data[1].numeroOrden").value(2));

        assertThat(subtestOrderInSession(b)).isEqualTo(1);
        assertThat(subtestOrderInSession(a)).isEqualTo(2);
    }

    @Test
    void upsertKeepsKeptSubtestsAfterSentOnesPreservingTheirRelativeOrder() throws Exception {
        scenario = seed("PROGRAMADA");
        long a = scenario.subtestIds().get(0);
        long b = scenario.subtestIds().get(1);
        long c = insertThirdSubtest();

        putSubtests(List.of(
                new SessionSubtestRequest(a, 1, 300, false, false),
                new SessionSubtestRequest(b, 2, 600, false, false),
                new SessionSubtestRequest(c, 3, 120, false, false)))
                .andExpect(status().isOk());

        // Se envian C y B (C primero); A se conserva y queda al final.
        putSubtests(List.of(
                new SessionSubtestRequest(c, 1, 120, false, false),
                new SessionSubtestRequest(b, 2, 600, false, false)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(3))
                .andExpect(jsonPath("$.data[0].subtestId").value(c))
                .andExpect(jsonPath("$.data[0].numeroOrden").value(1))
                .andExpect(jsonPath("$.data[1].subtestId").value(b))
                .andExpect(jsonPath("$.data[1].numeroOrden").value(2))
                .andExpect(jsonPath("$.data[2].subtestId").value(a))
                .andExpect(jsonPath("$.data[2].numeroOrden").value(3));

        assertThat(subtestOrderInSession(c)).isEqualTo(1);
        assertThat(subtestOrderInSession(b)).isEqualTo(2);
        assertThat(subtestOrderInSession(a)).isEqualTo(3);
    }

    @Test
    void upsertWithSeveralKeptSubtestsKeepsTheirRelativeOrder() throws Exception {
        scenario = seed("PROGRAMADA");
        long a = scenario.subtestIds().get(0);
        long b = scenario.subtestIds().get(1);
        long c = insertThirdSubtest();

        putSubtests(List.of(
                new SessionSubtestRequest(a, 1, 300, false, false),
                new SessionSubtestRequest(b, 2, 600, false, false),
                new SessionSubtestRequest(c, 3, 120, false, false)))
                .andExpect(status().isOk());

        putSubtests(List.of(new SessionSubtestRequest(c, 1, 120, false, false)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(3))
                .andExpect(jsonPath("$.data[0].subtestId").value(c))
                .andExpect(jsonPath("$.data[1].subtestId").value(a))
                .andExpect(jsonPath("$.data[1].numeroOrden").value(2))
                .andExpect(jsonPath("$.data[2].subtestId").value(b))
                .andExpect(jsonPath("$.data[2].numeroOrden").value(3));
    }

    @Test
    void replaceModeWithSingleSubtestLeavesOnlyThatOneAtItsOrder() throws Exception {
        scenario = seed("PROGRAMADA");
        long a = scenario.subtestIds().get(0);
        long b = scenario.subtestIds().get(1);

        putSubtests(List.of(
                new SessionSubtestRequest(a, 1, 300, false, false),
                new SessionSubtestRequest(b, 2, 600, false, false)))
                .andExpect(status().isOk());

        mvc.perform(put("/sesiones/{id}/subtests?mode=replace", scenario.sessionId())
                .header("Authorization", bearer("SESION_CREAR"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(List.of(new SessionSubtestRequest(b, 1, 600, false, false)))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].subtestId").value(b))
                .andExpect(jsonPath("$.data[0].numeroOrden").value(1));

        Integer count = jdbc.queryForObject("select count(*) from sesion_subtest where sesion_aplicacion_id = ?",
                Integer.class, scenario.sessionId());
        assertThat(count).isEqualTo(1);
        assertThat(subtestOrderInSession(b)).isEqualTo(1);
    }

    @Test
    void unknownModeReturns400AndChangesNothing() throws Exception {
        scenario = seed("PROGRAMADA");

        List<SessionSubtestRequest> payload = List.of(
                new SessionSubtestRequest(scenario.subtestIds().get(0), 1, 300, false, false));
        for (String mode : List.of("foo", "REPLACE", "")) {
            mvc.perform(put("/sesiones/{id}/subtests", scenario.sessionId())
                    .param("mode", mode)
                    .header("Authorization", bearer("SESION_CREAR"))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(JSON.writeValueAsString(payload)))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error.code").value("BAD_REQUEST"));
        }
        Integer count = jdbc.queryForObject("select count(*) from sesion_subtest where sesion_aplicacion_id = ?",
                Integer.class, scenario.sessionId());
        assertThat(count).isZero();
    }

    @Test
    void swapTwoExistingSubtestsOrdersInSinglePutReturns200AndFinalOrder() throws Exception {
        scenario = seed("PROGRAMADA");

        List<SessionSubtestRequest> initial = List.of(
                new SessionSubtestRequest(scenario.subtestIds().get(0), 1, 300, false, false),
                new SessionSubtestRequest(scenario.subtestIds().get(1), 2, 600, false, false));

        mvc.perform(put("/sesiones/{id}/subtests", scenario.sessionId())
                .header("Authorization", bearer("SESION_CREAR"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(initial)))
                .andExpect(status().isOk());

        List<SessionSubtestRequest> swapped = List.of(
                new SessionSubtestRequest(scenario.subtestIds().get(0), 2, 300, false, false),
                new SessionSubtestRequest(scenario.subtestIds().get(1), 1, 600, false, false));

        mvc.perform(put("/sesiones/{id}/subtests", scenario.sessionId())
                .header("Authorization", bearer("SESION_CREAR"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(swapped)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.data[0].subtestId").value(scenario.subtestIds().get(1)))
                .andExpect(jsonPath("$.data[0].numeroOrden").value(1))
                .andExpect(jsonPath("$.data[1].subtestId").value(scenario.subtestIds().get(0)))
                .andExpect(jsonPath("$.data[1].numeroOrden").value(2));

        assertThat(subtestOrderInSession(scenario.subtestIds().get(0))).isEqualTo(2);
        assertThat(subtestOrderInSession(scenario.subtestIds().get(1))).isEqualTo(1);
    }

    @Test
    void duplicateSubtestIdOrOrderReturns400() throws Exception {
        scenario = seed("PROGRAMADA");

        List<SessionSubtestRequest> duplicateSubtest = List.of(
                new SessionSubtestRequest(scenario.subtestIds().get(0), 1, 300, false, false),
                new SessionSubtestRequest(scenario.subtestIds().get(0), 2, 300, false, false));

        mvc.perform(put("/sesiones/{id}/subtests", scenario.sessionId())
                .header("Authorization", bearer("SESION_CREAR"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(duplicateSubtest)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error.code").value("BAD_REQUEST"));

        List<SessionSubtestRequest> duplicateOrder = List.of(
                new SessionSubtestRequest(scenario.subtestIds().get(0), 1, 300, false, false),
                new SessionSubtestRequest(scenario.subtestIds().get(1), 1, 300, false, false));

        mvc.perform(put("/sesiones/{id}/subtests", scenario.sessionId())
                .header("Authorization", bearer("SESION_CREAR"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(duplicateOrder)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error.code").value("BAD_REQUEST"));
    }

    @Test
    void invalidOrderOrTimeLimitReturns400() throws Exception {
        scenario = seed("PROGRAMADA");

        List<SessionSubtestRequest> zeroOrder = List.of(
                new SessionSubtestRequest(scenario.subtestIds().get(0), 0, 300, false, false));

        mvc.perform(put("/sesiones/{id}/subtests", scenario.sessionId())
                .header("Authorization", bearer("SESION_CREAR"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(zeroOrder)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("BAD_REQUEST"));

        List<SessionSubtestRequest> zeroTimeLimit = List.of(
                new SessionSubtestRequest(scenario.subtestIds().get(0), 1, 0, false, false));

        mvc.perform(put("/sesiones/{id}/subtests", scenario.sessionId())
                .header("Authorization", bearer("SESION_CREAR"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(zeroTimeLimit)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("BAD_REQUEST"));
    }

    @Test
    void replaceSubtestsOnNonProgramadaSessionReturns409() throws Exception {
        scenario = seed("ABIERTA");

        List<SessionSubtestRequest> payload = List.of(
                new SessionSubtestRequest(scenario.subtestIds().get(0), 1, 300, false, false));

        mvc.perform(put("/sesiones/{id}/subtests", scenario.sessionId())
                .header("Authorization", bearer("SESION_CREAR"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(payload)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error.code").value("CONFLICT"));
    }

    @Test
    void replaceSubtestsWithoutPermissionReturns403() throws Exception {
        scenario = seed("PROGRAMADA");

        mvc.perform(put("/sesiones/{id}/subtests", scenario.sessionId())
                .header("Authorization", bearer("SESION_APLICAR"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("[]"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    @Test
    void getSessionDetailIncludesTestVersionAndOrderedSubtestsWithFallbackTimeLimit() throws Exception {
        scenario = seed("PROGRAMADA");

        List<SessionSubtestRequest> payload = List.of(
                new SessionSubtestRequest(scenario.subtestIds().get(0), 2, 500, true, false),
                new SessionSubtestRequest(scenario.subtestIds().get(1), 1, null, false, true));

        mvc.perform(put("/sesiones/{id}/subtests", scenario.sessionId())
                .header("Authorization", bearer("SESION_CREAR"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(payload)))
                .andExpect(status().isOk());

        String expectedTestName = jdbc.queryForObject("select nombre_test from test where test_id = ?",
                String.class, scenario.testId());

        mvc.perform(get("/sesiones/{id}", scenario.sessionId())
                .header("Authorization", bearer("SESION_APLICAR")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.id").value(scenario.sessionId()))
                .andExpect(jsonPath("$.data.codigoSesion").isNotEmpty())
                .andExpect(jsonPath("$.data.nombreSesion").isNotEmpty())
                .andExpect(jsonPath("$.data.estado").value("PROGRAMADA"))
                .andExpect(jsonPath("$.data.inicioProgramado").isNotEmpty())
                .andExpect(jsonPath("$.data.versionTestId").value(scenario.versionId()))
                .andExpect(jsonPath("$.data.testId").value(scenario.testId()))
                .andExpect(jsonPath("$.data.testName").value(expectedTestName))
                .andExpect(jsonPath("$.data.versionNumber").value("1.0"))
                .andExpect(jsonPath("$.data.subtests.length()").value(2))
                .andExpect(jsonPath("$.data.subtests[0].subtestId").value(scenario.subtestIds().get(1)))
                .andExpect(jsonPath("$.data.subtests[0].code").value("SUB-2"))
                .andExpect(jsonPath("$.data.subtests[0].name").value("Subtest Dos"))
                .andExpect(jsonPath("$.data.subtests[0].order").value(1))
                .andExpect(jsonPath("$.data.subtests[0].timeLimitSeconds").value(240))
                .andExpect(jsonPath("$.data.subtests[0].randomizeItems").value(false))
                .andExpect(jsonPath("$.data.subtests[0].randomizeOptions").value(true))
                .andExpect(jsonPath("$.data.subtests[1].subtestId").value(scenario.subtestIds().get(0)))
                .andExpect(jsonPath("$.data.subtests[1].code").value("SUB-1"))
                .andExpect(jsonPath("$.data.subtests[1].name").value("Subtest Uno"))
                .andExpect(jsonPath("$.data.subtests[1].order").value(2))
                .andExpect(jsonPath("$.data.subtests[1].timeLimitSeconds").value(500))
                .andExpect(jsonPath("$.data.subtests[1].randomizeItems").value(true))
                .andExpect(jsonPath("$.data.subtests[1].randomizeOptions").value(false));
    }

    @Test
    void getSessionDetailWithoutSubtestsReturnsEmptyList() throws Exception {
        scenario = seed("PROGRAMADA");

        mvc.perform(get("/sesiones/{id}", scenario.sessionId())
                .header("Authorization", bearer("SESION_APLICAR")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.testId").value(scenario.testId()))
                .andExpect(jsonPath("$.data.versionNumber").value("1.0"))
                .andExpect(jsonPath("$.data.subtests").isArray())
                .andExpect(jsonPath("$.data.subtests.length()").value(0));
    }

    @Test
    void listSessionsRemainsUnchangedWithoutDetailFields() throws Exception {
        scenario = seed("PROGRAMADA");

        mvc.perform(get("/sesiones")
                .header("Authorization", bearer("SESION_APLICAR")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data[?(@.id == " + scenario.sessionId() + ")].versionTestId")
                        .value(org.hamcrest.Matchers.contains((int) scenario.versionId())))
                .andExpect(jsonPath("$.data[?(@.id == " + scenario.sessionId() + ")].testId").isEmpty())
                .andExpect(jsonPath("$.data[?(@.id == " + scenario.sessionId() + ")].testName").isEmpty())
                .andExpect(jsonPath("$.data[?(@.id == " + scenario.sessionId() + ")].versionNumber").isEmpty())
                .andExpect(jsonPath("$.data[?(@.id == " + scenario.sessionId() + ")].subtests").isEmpty());
    }

    @Test
    void getSessionDetailNotFoundReturns404() throws Exception {
        mvc.perform(get("/sesiones/{id}", 999_999_999L)
                .header("Authorization", bearer("SESION_APLICAR")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("NOT_FOUND"));
    }

    private Scenario seed(String sessionState) {
        return new TransactionTemplate(txManager).execute(status -> {
            String suffix = UUID.randomUUID().toString().substring(0, 8);
            UUID userId = jdbc.queryForObject(
                    "insert into usuario (nombre_usuario, correo, hash_contrasena, nombre_completo) "
                            + "values (?, ?, 'hash', 'Test User') returning usuario_id",
                    UUID.class, "usr-" + suffix, "usr-" + suffix + "@test.local");
            long estrategiaId = jdbc.queryForObject(
                    "select estrategia_calificacion_id from estrategia_calificacion where codigo = 'CLAVE_SIMPLE'",
                    Long.class);
            long testId = id("insert into test (codigo_test, nombre_test) values (?, ?) returning test_id",
                    "TST-" + suffix, "Test " + suffix);
            long versionId = id(
                    "insert into version_test (test_id, estrategia_calificacion_id, numero_version, estado, "
                            + "permite_aleatorizar_items) "
                            + "values (?, ?, '1.0', 'BORRADOR', true) returning version_test_id",
                    testId, estrategiaId);
            long sub1 = id(
                    "insert into subtest (version_test_id, codigo_subtest, nombre_subtest, numero_orden, tiempo_limite_segundos) "
                            + "values (?, 'SUB-1', 'Subtest Uno', 1, 180) returning subtest_id",
                    versionId);
            long sub2 = id(
                    "insert into subtest (version_test_id, codigo_subtest, nombre_subtest, numero_orden, tiempo_limite_segundos) "
                            + "values (?, 'SUB-2', 'Subtest Dos', 2, 240) returning subtest_id",
                    versionId);
            jdbc.update(
                    "update version_test set estado = 'PUBLICADO', aprobado_por = ?, aprobado_en = now(), "
                            + "publicado_en = now() where version_test_id = ?",
                    userId, versionId);
            long sessionId = id(
                    "insert into sesion_aplicacion (version_test_id, codigo_sesion, nombre_sesion, inicio_programado, estado) "
                            + "values (?, ?, ?, now(), ?::estado_sesion_aplicacion) returning sesion_aplicacion_id",
                    versionId, "SES-" + suffix, "Sesion " + suffix, sessionState);
            long otherTestId = id("insert into test (codigo_test, nombre_test) values (?, ?) returning test_id",
                    "OTH-" + suffix, "Otro " + suffix);
            long otherVersionId = id(
                    "insert into version_test (test_id, numero_version, estado) values (?, '1.0', 'BORRADOR') "
                            + "returning version_test_id",
                    otherTestId);
            return new Scenario(userId, testId, versionId, List.of(sub1, sub2), sessionId, otherTestId, otherVersionId);
        });
    }

    private long id(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }

    /** La version del seed ya esta publicada (contenido inmutable), asi que el trigger se desactiva solo aqui. */
    private long insertThirdSubtest() {
        return new TransactionTemplate(txManager).execute(status -> {
            jdbc.execute("set local session_replication_role = replica");
            return id(
                    "insert into subtest (version_test_id, codigo_subtest, nombre_subtest, numero_orden, "
                            + "tiempo_limite_segundos) values (?, 'SUB-3', 'Subtest Tres', 3, 120) "
                            + "returning subtest_id",
                    scenario.versionId());
        });
    }

    private org.springframework.test.web.servlet.ResultActions putSubtests(List<SessionSubtestRequest> body)
            throws Exception {
        return mvc.perform(put("/sesiones/{id}/subtests", scenario.sessionId())
                .header("Authorization", bearer("SESION_CREAR"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(body)));
    }

    private Integer subtestOrderInSession(long subtestId) {
        return jdbc.queryForObject(
                "select numero_orden from sesion_subtest where sesion_aplicacion_id = ? and subtest_id = ?",
                Integer.class, scenario.sessionId(), subtestId);
    }

    private String bearer(String permission) {
        return "Bearer " + jwt.emitir(UUID.randomUUID(), "coord", Set.of(permission), Set.of("ADMINISTRADOR"));
    }
}

package com.uam.psychoform.instrument;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.uam.psychoform.PsychoformApplication;
import com.uam.psychoform.security.service.JwtService;
import jakarta.persistence.EntityManager;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/** B7: GET /test-versions/{id}/configuration. Transaccional: los datos sembrados se revierten. */
@SpringBootTest(classes = PsychoformApplication.class,
        properties = "spring.jpa.properties.hibernate.generate_statistics=true")
@AutoConfigureMockMvc
@Transactional
class InstrumentVersionConfigurationIntegrationTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    @Autowired
    MockMvc mvc;

    @Autowired
    JwtService jwt;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    EntityManager em;

    private UUID creatorId;
    private long testId;

    @BeforeEach
    void seed() {
        creatorId = InstrumentVersionFixture.createUser(jdbc, "b7");
        testId = InstrumentVersionFixture.createTest(jdbc, "B7");
    }

    @Test
    void devuelveElDocumentoCompletoIgualAlCloneTemplateDeCadaSubtest() throws Exception {
        long versionId = InstrumentVersionFixture.createDraftVersion(jdbc, testId, "1.0");
        InstrumentVersionFixture.seedFullContent(jdbc, versionId);
        InstrumentVersionFixture.publish(jdbc, versionId, creatorId);

        JsonNode document = readJson("/test-versions/" + versionId + "/configuration", token(Set.of("TEST_LEER")));

        assertThat(document.at("/data/version/id").asLong()).isEqualTo(versionId);
        assertThat(document.at("/data/version/estado").asText()).isEqualTo("PUBLICADO");
        assertThat(document.at("/data/version/numeroVersion").asText()).isEqualTo("1.0");
        JsonNode subtests = document.at("/data/subtests");
        assertThat(subtests).hasSize(2);
        assertThat(subtests.get(0).get("code").asText()).isEqualTo("S1");
        assertThat(subtests.get(1).get("code").asText()).isEqualTo("S2");
        assertThat(subtests.get(0).get("items")).hasSize(2);
        assertThat(subtests.get(1).get("items")).hasSize(3);
        JsonNode firstItem = subtests.get(0).get("items").get(0);
        assertThat(firstItem.get("images")).hasSize(1);
        assertThat(firstItem.get("options").get(0).get("images")).hasSize(1);
        assertThat(firstItem.get("answerKey").get("correctOptionSourceId").asLong())
                .isEqualTo(firstItem.get("options").get(0).get("sourceOptionId").asLong());

        for (JsonNode subtest : subtests) {
            JsonNode cloneTemplate = readJson("/subtests/" + subtest.get("sourceSubtestId").asLong() + "/clone-template",
                    token(Set.of("TEST_LEER")));
            assertThat(subtest).isEqualTo(cloneTemplate.get("data"));
        }
    }

    @Test
    void versionSinSubtestsDevuelveLaListaVacia() throws Exception {
        long versionId = InstrumentVersionFixture.createDraftVersion(jdbc, testId, "1.0");

        mvc.perform(get("/test-versions/{id}/configuration", versionId)
                .header("Authorization", token(Set.of("TEST_LEER"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.version.id").value(versionId))
                .andExpect(jsonPath("$.data.subtests.length()").value(0));
    }

    @Test
    void versionInexistenteDevuelve404() throws Exception {
        mvc.perform(get("/test-versions/{id}/configuration", 999_999_999L)
                .header("Authorization", token(Set.of("TEST_LEER"))))
                .andExpect(status().isNotFound());
    }

    @Test
    void aplicadorConSoloCatalogoRecibe403() throws Exception {
        long versionId = InstrumentVersionFixture.createDraftVersion(jdbc, testId, "1.0");
        Set<String> permissions = Set.copyOf(jdbc.queryForList(
                "select p.codigo_permiso from rol r join rol_permiso rp on rp.rol_id = r.rol_id "
                        + "join permiso p on p.permiso_id = rp.permiso_id where r.nombre_rol = 'APLICADOR'",
                String.class));
        assertThat(permissions).contains("INSTRUMENTO_CATALOGO_LEER").doesNotContain("TEST_LEER");

        mvc.perform(get("/test-versions/{id}/configuration", versionId).header("Authorization", token(permissions)))
                .andExpect(status().isForbidden());
    }

    @Test
    void sinTokenDevuelve401() throws Exception {
        mvc.perform(get("/test-versions/{id}/configuration", 1L)).andExpect(status().isUnauthorized());
    }

    @Test
    void elDocumentoSeReenviaTalCualAUnaVersionBorradorYLaConfiguracionQuedaIgual() throws Exception {
        long versionId = InstrumentVersionFixture.createDraftVersion(jdbc, testId, "1.0");
        InstrumentVersionFixture.seedFullContent(jdbc, versionId);
        String reader = token(Set.of("TEST_LEER"));
        String creator = token(Set.of("TEST_CREAR", "CALIFICACION_CONFIGURAR"));

        String before = readRaw("/test-versions/" + versionId + "/configuration", reader);
        String rowsBefore = rowSignature(versionId);

        mvc.perform(post("/test-versions/{id}/configuration", versionId).header("Authorization", creator)
                .contentType(MediaType.APPLICATION_JSON).content(JSON.readTree(before).toString()))
                .andExpect(status().isOk());
        em.flush();
        em.clear();

        String after = readRaw("/test-versions/" + versionId + "/configuration", reader);
        assertThat(JSON.readTree(after).get("data")).isEqualTo(JSON.readTree(before).get("data"));
        assertThat(rowSignature(versionId)).isEqualTo(rowsBefore);
    }

    @Test
    void laCantidadDeConsultasNoCrecePorSubtest() throws Exception {
        long small = InstrumentVersionFixture.createDraftVersion(jdbc, testId, "1.0");
        InstrumentVersionFixture.seedFullContent(jdbc, small);
        long large = InstrumentVersionFixture.createDraftVersion(jdbc, testId, "2.0");
        InstrumentVersionFixture.seedFullContent(jdbc, large);
        InstrumentVersionFixture.addSubtest(jdbc, large, "S3", 3, 3);
        InstrumentVersionFixture.addSubtest(jdbc, large, "S4", 4, 3);
        String reader = token(Set.of("TEST_LEER"));
        Statistics statistics = em.getEntityManagerFactory().unwrap(SessionFactory.class).getStatistics();

        em.clear();
        statistics.clear();
        JsonNode smallDocument = readJson("/test-versions/" + small + "/configuration", reader);
        long smallQueries = statistics.getPrepareStatementCount();

        em.clear();
        statistics.clear();
        JsonNode largeDocument = readJson("/test-versions/" + large + "/configuration", reader);
        long largeQueries = statistics.getPrepareStatementCount();

        assertThat(smallDocument.at("/data/subtests")).hasSize(2);
        assertThat(largeDocument.at("/data/subtests")).hasSize(4);
        assertThat(largeQueries).isEqualTo(smallQueries);
        assertThat(largeQueries).isLessThanOrEqualTo(10);
    }

    private JsonNode readJson(String path, String token) throws Exception {
        return JSON.readTree(readRaw(path, token));
    }

    private String readRaw(String path, String token) throws Exception {
        return mvc.perform(get(path).header("Authorization", token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    /** Conteos y claves de la version para comprobar que reenviar el documento no crea ni borra filas. */
    private String rowSignature(long versionId) {
        List<String> parts = jdbc.queryForList("""
                select 'subtest:' || count(*) from subtest where version_test_id = ?
                union all select 'item:' || count(*) from item i join subtest s on s.subtest_id = i.subtest_id
                    where s.version_test_id = ?
                union all select 'opcion:' || count(*) from opcion_item o join item i on i.item_id = o.item_id
                    join subtest s on s.subtest_id = i.subtest_id where s.version_test_id = ?
                union all select 'clave:' || count(*) from clave_respuesta c
                    join regla_calificacion r on r.regla_calificacion_id = c.regla_calificacion_id
                    where r.version_test_id = ?
                union all select 'conjunto:' || count(*) from clave_respuesta_opcion cro
                    join clave_respuesta c on c.clave_respuesta_id = cro.clave_respuesta_id
                    join regla_calificacion r on r.regla_calificacion_id = c.regla_calificacion_id
                    where r.version_test_id = ?
                union all select 'imagen_item:' || count(*) from imagen_item ii join item i on i.item_id = ii.item_id
                    join subtest s on s.subtest_id = i.subtest_id where s.version_test_id = ?
                union all select 'imagen_opcion:' || count(*) from imagen_opcion io
                    join opcion_item o on o.opcion_id = io.opcion_id join item i on i.item_id = o.item_id
                    join subtest s on s.subtest_id = i.subtest_id where s.version_test_id = ?
                """, String.class, versionId, versionId, versionId, versionId, versionId, versionId, versionId);
        return String.join(",", parts);
    }

    private String token(Set<String> permissions) {
        return "Bearer " + jwt.emitir(creatorId, "usuario-b7", permissions, Set.of("ROL_PRUEBA"));
    }
}

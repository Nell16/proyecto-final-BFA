package com.uam.psychoform.instrument;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.uam.psychoform.PsychoformApplication;
import com.uam.psychoform.security.service.JwtService;
import java.util.HashMap;
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

/** B9: POST /test-versions/{id}/clone. Transaccional: los datos sembrados se revierten. */
@SpringBootTest(classes = PsychoformApplication.class,
        properties = "spring.jpa.properties.hibernate.generate_statistics=true")
@AutoConfigureMockMvc
@Transactional
class InstrumentVersionCloneIntegrationTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    @Autowired
    MockMvc mvc;

    @Autowired
    JwtService jwt;

    @Autowired
    JdbcTemplate jdbc;

    private UUID creatorId;
    private long testId;

    @BeforeEach
    void seed() {
        creatorId = InstrumentVersionFixture.createUser(jdbc, "b9");
        testId = InstrumentVersionFixture.createTest(jdbc, "B9");
    }

    @Test
    void clonarUnaVersionPublicadaCreaUnBorradorEquivalenteSalvoLosIds() throws Exception {
        long sourceId = publishedSource();
        long resourcesBefore = count("select count(*) from recurso_multimedia");
        List<String> sourceDump = dump(sourceId);
        JsonNode sourceConfiguration = configuration(sourceId);

        String body = mvc.perform(post("/test-versions/{id}/clone", sourceId).header("Authorization", creator())
                .contentType(MediaType.APPLICATION_JSON).content("{\"versionNumber\":\"2.0\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.estado").value("BORRADOR"))
                .andExpect(jsonPath("$.data.numeroVersion").value("2.0"))
                .andExpect(jsonPath("$.data.testId").value(testId))
                .andExpect(jsonPath("$.data.creadoPorId").value(creatorId.toString()))
                .andExpect(jsonPath("$.data.aprobadoPor").doesNotExist())
                .andExpect(jsonPath("$.data.publicadoEn").doesNotExist())
                .andReturn().getResponse().getContentAsString();
        long cloneId = JSON.readTree(body).at("/data/id").asLong();
        assertThat(cloneId).isNotEqualTo(sourceId);

        // Misma configuracion salvo ids (GET /configuration de B7).
        JsonNode cloneConfiguration = configuration(cloneId);
        assertThat(cloneConfiguration.at("/data/version/estado").asText()).isEqualTo("BORRADOR");
        assertThat(cloneConfiguration.at("/data/version/instruccionesGenerales").asText())
                .isEqualTo(sourceConfiguration.at("/data/version/instruccionesGenerales").asText());
        assertThat(cloneConfiguration.at("/data/version/estrategiaCalificacionId"))
                .isEqualTo(sourceConfiguration.at("/data/version/estrategiaCalificacionId"));
        assertThat(cloneConfiguration.at("/data/subtests")).hasSize(2);
        assertThat(withoutIds(cloneConfiguration.at("/data/subtests")))
                .isEqualTo(withoutIds(sourceConfiguration.at("/data/subtests")));
        // Ids nuevos: ninguna fila del origen se reutiliza.
        assertThat(cloneConfiguration.at("/data/subtests/0/sourceSubtestId"))
                .isNotEqualTo(sourceConfiguration.at("/data/subtests/0/sourceSubtestId"));

        // Dimensiones, reglas, claves con su conjunto de opciones, matriz y baremos tambien equivalentes.
        List<String> cloneDump = dump(cloneId);
        assertThat(cloneDump).isEqualTo(sourceDump);
        assertThat(cloneDump).anyMatch(line -> line.startsWith("clave|S1|I2|") && line.contains("|true|A,C|"));
        assertThat(cloneDump).anyMatch(line -> line.startsWith("rango|BAR-1|"));
        assertThat(cloneDump).anyMatch(line -> line.startsWith("opd|"));

        // Las imagenes reutilizan el mismo recurso: no se crean recursos nuevos.
        assertThat(count("select count(*) from recurso_multimedia")).isEqualTo(resourcesBefore);
        assertThat(cloneDump).anyMatch(line -> line.startsWith("imagen_item|S1|I1|"));
        assertThat(cloneDump).anyMatch(line -> line.startsWith("imagen_opcion|S1|I2|C|"));

        // Todo lo copiado cuelga de la version nueva: reglas en BORRADOR y claves apuntando a opciones de la copia.
        assertThat(jdbc.queryForList("select distinct estado::text from regla_calificacion where version_test_id = ?",
                String.class, cloneId)).containsExactly("BORRADOR");
        assertThat(count("select count(*) from clave_respuesta c join item i on i.item_id = c.item_id "
                + "join subtest s on s.subtest_id = i.subtest_id join regla_calificacion r "
                + "on r.regla_calificacion_id = c.regla_calificacion_id "
                + "where r.version_test_id = ? and s.version_test_id <> r.version_test_id", cloneId)).isZero();
        assertThat(count("select count(*) from clave_respuesta c join regla_calificacion r "
                + "on r.regla_calificacion_id = c.regla_calificacion_id join opcion_item o "
                + "on o.opcion_id = c.opcion_correcta_id join item i on i.item_id = o.item_id "
                + "join subtest s on s.subtest_id = i.subtest_id "
                + "where r.version_test_id = ? and s.version_test_id <> ?", cloneId, cloneId)).isZero();
        assertThat(count("select count(*) from clave_respuesta_opcion cro join clave_respuesta c "
                + "on c.clave_respuesta_id = cro.clave_respuesta_id join regla_calificacion r "
                + "on r.regla_calificacion_id = c.regla_calificacion_id join opcion_item o "
                + "on o.opcion_id = cro.opcion_id join item i on i.item_id = o.item_id "
                + "join subtest s on s.subtest_id = i.subtest_id "
                + "where r.version_test_id = ? and s.version_test_id <> ?", cloneId, cloneId)).isZero();

        // El origen publicado queda intacto.
        assertThat(dump(sourceId)).isEqualTo(sourceDump);
        assertThat(jdbc.queryForObject("select estado::text from version_test where version_test_id = ?",
                String.class, sourceId)).isEqualTo("PUBLICADO");
    }

    @Test
    void clonarUnaVersionBorradorTambienFunciona() throws Exception {
        long sourceId = InstrumentVersionFixture.createDraftVersion(jdbc, testId, "1.0");
        InstrumentVersionFixture.seedFullContent(jdbc, sourceId);

        String body = mvc.perform(post("/test-versions/{id}/clone", sourceId).header("Authorization", creator())
                .contentType(MediaType.APPLICATION_JSON).content("{\"versionNumber\":\"1.1\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        long cloneId = JSON.readTree(body).at("/data/id").asLong();

        assertThat(dump(cloneId)).isEqualTo(dump(sourceId));
        assertThat(withoutIds(configuration(cloneId).at("/data/subtests")))
                .isEqualTo(withoutIds(configuration(sourceId).at("/data/subtests")));
    }

    @Test
    void clonarUnaVersionSinContenidoCreaUnBorradorVacio() throws Exception {
        long sourceId = InstrumentVersionFixture.createDraftVersion(jdbc, testId, "1.0");

        mvc.perform(post("/test-versions/{id}/clone", sourceId).header("Authorization", creator())
                .contentType(MediaType.APPLICATION_JSON).content("{\"versionNumber\":\"1.1\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.estado").value("BORRADOR"));
    }

    @Test
    void numeroDeVersionRepetidoDevuelve409SinFilasNuevas() throws Exception {
        long sourceId = publishedSource();
        long other = InstrumentVersionFixture.createDraftVersion(jdbc, testId, "3.0");
        long versionsBefore = count("select count(*) from version_test");
        long subtestsBefore = count("select count(*) from subtest");
        long itemsBefore = count("select count(*) from item");
        long keysBefore = count("select count(*) from clave_respuesta");

        for (String duplicated : List.of("1.0", "3.0")) {
            mvc.perform(post("/test-versions/{id}/clone", sourceId).header("Authorization", creator())
                    .contentType(MediaType.APPLICATION_JSON).content("{\"versionNumber\":\"" + duplicated + "\"}"))
                    .andExpect(status().isConflict());
        }

        assertThat(other).isPositive();
        assertThat(count("select count(*) from version_test")).isEqualTo(versionsBefore);
        assertThat(count("select count(*) from subtest")).isEqualTo(subtestsBefore);
        assertThat(count("select count(*) from item")).isEqualTo(itemsBefore);
        assertThat(count("select count(*) from clave_respuesta")).isEqualTo(keysBefore);
    }

    @Test
    void versionOrigenInexistenteDevuelve404() throws Exception {
        mvc.perform(post("/test-versions/{id}/clone", 999_999_999L).header("Authorization", creator())
                .contentType(MediaType.APPLICATION_JSON).content("{\"versionNumber\":\"2.0\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void sinTestCrearDevuelve403() throws Exception {
        long sourceId = publishedSource();
        long versionsBefore = count("select count(*) from version_test");
        String reader = "Bearer " + jwt.emitir(creatorId, "lector", Set.of("TEST_LEER"), Set.of("ROL_PRUEBA"));

        mvc.perform(post("/test-versions/{id}/clone", sourceId).header("Authorization", reader)
                .contentType(MediaType.APPLICATION_JSON).content("{\"versionNumber\":\"2.0\"}"))
                .andExpect(status().isForbidden());

        assertThat(count("select count(*) from version_test")).isEqualTo(versionsBefore);
    }

    @Test
    void numeroDeVersionVacioODemasiadoLargoDevuelve400() throws Exception {
        long sourceId = publishedSource();
        for (String body : List.of("{\"versionNumber\":\"\"}", "{\"versionNumber\":\"   \"}", "{}",
                "{\"versionNumber\":\"" + "x".repeat(31) + "\"}")) {
            mvc.perform(post("/test-versions/{id}/clone", sourceId).header("Authorization", creator())
                    .contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isBadRequest());
        }
    }

    private long publishedSource() {
        long sourceId = InstrumentVersionFixture.createDraftVersion(jdbc, testId, "1.0");
        InstrumentVersionFixture.seedFullContent(jdbc, sourceId);
        InstrumentVersionFixture.publish(jdbc, sourceId, creatorId);
        return sourceId;
    }

    private JsonNode configuration(long versionId) throws Exception {
        return JSON.readTree(mvc.perform(get("/test-versions/{id}/configuration", versionId)
                .header("Authorization", creator()))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
    }

    private String creator() {
        return "Bearer " + jwt.emitir(creatorId, "usuario-b9", Set.of("TEST_CREAR", "TEST_LEER"),
                Set.of("ROL_PRUEBA"));
    }

    private long count(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }

    /** Copia del arbol sin ids propios: la clave correcta se expresa con el codigo de la opcion, no con su id. */
    private static JsonNode withoutIds(JsonNode subtests) {
        JsonNode copy = subtests.deepCopy();
        for (JsonNode subtest : copy) {
            ((ObjectNode) subtest).remove("sourceSubtestId");
            for (JsonNode item : subtest.get("items")) {
                ((ObjectNode) item).remove("sourceItemId");
                Map<Long, String> codeByOptionId = new HashMap<>();
                for (JsonNode option : item.get("options")) {
                    codeByOptionId.put(option.get("sourceOptionId").asLong(), option.get("code").asText());
                    ((ObjectNode) option).remove("sourceOptionId");
                    for (JsonNode image : option.get("images")) {
                        ((ObjectNode) image).remove("sourceImageId");
                    }
                }
                for (JsonNode image : item.get("images")) {
                    ((ObjectNode) image).remove("sourceImageId");
                }
                JsonNode key = item.get("answerKey");
                if (key != null && !key.isNull()) {
                    ObjectNode keyNode = (ObjectNode) key;
                    keyNode.remove("sourceAnswerKeyId");
                    keyNode.remove("sourceRuleId");
                    JsonNode correct = keyNode.remove("correctOptionSourceId");
                    keyNode.put("correctOptionCode",
                            correct == null || correct.isNull() ? null : codeByOptionId.get(correct.asLong()));
                }
            }
        }
        return copy;
    }

    /** Volcado sin ids de lo que el documento de B7 no expone: reglas, claves (con conjunto), matriz y baremos. */
    private List<String> dump(long versionId) {
        List<String> lines = new java.util.ArrayList<>();
        lines.addAll(jdbc.queryForList("""
                select 'regla|' || coalesce(s.codigo_subtest, '-') || '|' || coalesce(i.codigo_item, '-') || '|'
                    || r.tipo_regla || '|' || r.prioridad || '|' || r.activa || '|' || r.estado || '|'
                    || r.parametros::text || '|' || coalesce(r.observacion, '-')
                from regla_calificacion r
                left join subtest s on s.subtest_id = r.subtest_id
                left join item i on i.item_id = r.item_id
                where r.version_test_id = ? order by 1
                """, String.class, versionId));
        lines.addAll(jdbc.queryForList("""
                select 'clave|' || s.codigo_subtest || '|' || i.codigo_item || '|' || coalesce(oc.codigo_opcion, '-')
                    || '|' || coalesce(c.texto_esperado, '-') || '|' || coalesce(c.valor_numerico_esperado::text, '-')
                    || '|' || coalesce(c.tolerancia_numerica::text, '-') || '|' || c.puntaje || '|'
                    || c.requiere_revision_manual || '|' || c.usa_conjunto_opciones || '|'
                    || coalesce((select string_agg(o2.codigo_opcion, ',' order by o2.codigo_opcion)
                                 from clave_respuesta_opcion cro
                                 join opcion_item o2 on o2.opcion_id = cro.opcion_id
                                 where cro.clave_respuesta_id = c.clave_respuesta_id), '-')
                    || '|' || coalesce(rs.codigo_subtest, '-') || '|' || coalesce(ri.codigo_item, '-')
                from clave_respuesta c
                join regla_calificacion r on r.regla_calificacion_id = c.regla_calificacion_id
                left join subtest rs on rs.subtest_id = r.subtest_id
                left join item ri on ri.item_id = r.item_id
                join item i on i.item_id = c.item_id
                join subtest s on s.subtest_id = i.subtest_id
                left join opcion_item oc on oc.opcion_id = c.opcion_correcta_id
                where r.version_test_id = ? order by 1
                """, String.class, versionId));
        lines.addAll(jdbc.queryForList("""
                select 'dimension|' || d.codigo_dimension || '|' || coalesce(s.codigo_subtest, '-') || '|'
                    || d.nombre_dimension || '|' || d.orden_presentacion || '|' || coalesce(d.puntaje_minimo::text, '-')
                    || '|' || coalesce(d.puntaje_maximo::text, '-') || '|' || d.activa
                from dimension_resultado d left join subtest s on s.subtest_id = d.subtest_id
                where d.version_test_id = ? order by 1
                """, String.class, versionId));
        lines.addAll(jdbc.queryForList("""
                select 'opd|' || si.codigo_subtest || '|' || i.codigo_item || '|' || o.codigo_opcion || '|'
                    || d.codigo_dimension || '|' || p.puntaje || '|' || p.peso || '|' || p.activa
                from opcion_puntaje_dimension p
                join regla_calificacion r on r.regla_calificacion_id = p.regla_calificacion_id
                join opcion_item o on o.opcion_id = p.opcion_id
                join item i on i.item_id = o.item_id
                join subtest si on si.subtest_id = i.subtest_id
                join dimension_resultado d on d.dimension_resultado_id = p.dimension_resultado_id
                where r.version_test_id = ? order by 1
                """, String.class, versionId));
        lines.addAll(jdbc.queryForList("""
                select 'baremo|' || b.codigo_baremo || '|' || coalesce(d.codigo_dimension, '-') || '|' || b.nombre
                    || '|' || coalesce(b.grupo_normativo, '-') || '|' || coalesce(b.criterio_edad_minima::text, '-')
                    || '|' || coalesce(b.criterio_edad_maxima::text, '-') || '|' || coalesce(b.vigente_desde::text, '-')
                    || '|' || coalesce(b.vigente_hasta::text, '-') || '|' || b.estado
                from baremo b left join dimension_resultado d on d.dimension_resultado_id = b.dimension_resultado_id
                where b.version_test_id = ? order by 1
                """, String.class, versionId));
        lines.addAll(jdbc.queryForList("""
                select 'rango|' || b.codigo_baremo || '|' || g.orden || '|' || g.puntaje_minimo || '|'
                    || g.puntaje_maximo || '|' || coalesce(g.percentil::text, '-') || '|' || g.categoria || '|'
                    || coalesce(g.interpretacion, '-') || '|' || coalesce(g.recomendacion, '-')
                from rango_baremo g join baremo b on b.baremo_id = g.baremo_id
                where b.version_test_id = ? order by 1
                """, String.class, versionId));
        lines.addAll(jdbc.queryForList("""
                select 'imagen_item|' || s.codigo_subtest || '|' || i.codigo_item || '|' || ii.rol_imagen || '|'
                    || ii.numero_orden || '|' || coalesce(ii.texto_alternativo, '-') || '|' || ii.recurso_id
                from imagen_item ii join item i on i.item_id = ii.item_id join subtest s on s.subtest_id = i.subtest_id
                where s.version_test_id = ? order by 1
                """, String.class, versionId));
        lines.addAll(jdbc.queryForList("""
                select 'imagen_opcion|' || s.codigo_subtest || '|' || i.codigo_item || '|' || o.codigo_opcion || '|'
                    || io.numero_orden || '|' || coalesce(io.texto_alternativo, '-') || '|' || io.recurso_id
                from imagen_opcion io join opcion_item o on o.opcion_id = io.opcion_id
                join item i on i.item_id = o.item_id join subtest s on s.subtest_id = i.subtest_id
                where s.version_test_id = ? order by 1
                """, String.class, versionId));
        return lines;
    }
}

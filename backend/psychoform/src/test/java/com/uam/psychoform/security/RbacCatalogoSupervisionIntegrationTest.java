package com.uam.psychoform.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.uam.psychoform.PsychoformApplication;
import com.uam.psychoform.security.service.JwtService;
import java.util.List;
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
 * B12: permisos de solo catalogo (Aplicador) y de supervision (Psicologo/Coordinador).
 * Los tokens llevan exactamente los permisos que la migracion asigna a cada rol en la BD.
 * El test es transaccional: los datos se revierten (las versiones PUBLICADO son inmutables y no se podrian borrar).
 */
@SpringBootTest(classes = PsychoformApplication.class)
@AutoConfigureMockMvc
@Transactional
class RbacCatalogoSupervisionIntegrationTest {
    @Autowired
    MockMvc mvc;

    @Autowired
    JwtService jwt;

    @Autowired
    JdbcTemplate jdbc;

    private String publishedCode;
    private String draftOnlyCode;
    private long publishedTestId;
    private long draftOnlyTestId;
    private long publishedVersionId;
    private long draftVersionOfPublishedTestId;
    private long draftOnlyVersionId;
    private long subtestId;
    private long itemId;

    @BeforeEach
    void seed() {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        UUID approverId = jdbc.queryForObject("insert into usuario (nombre_usuario, correo, hash_contrasena, nombre_completo) "
                + "values (?, ?, 'x', 'Aprobador B12') returning usuario_id", UUID.class,
                "b12-" + suffix, "b12-" + suffix + "@test.local");
        publishedCode = "PUB-" + suffix;
        draftOnlyCode = "DRF-" + suffix;
        publishedTestId = id("insert into test (codigo_test, nombre_test) values (?, ?) returning test_id",
                publishedCode, "Test publicado " + suffix);
        draftOnlyTestId = id("insert into test (codigo_test, nombre_test) values (?, ?) returning test_id",
                draftOnlyCode, "Test borrador " + suffix);
        publishedVersionId = id("insert into version_test (test_id, numero_version, estado) values (?, '1.0', 'BORRADOR') "
                + "returning version_test_id", publishedTestId);
        draftVersionOfPublishedTestId = id("insert into version_test (test_id, numero_version, estado) values (?, '2.0', 'BORRADOR') "
                + "returning version_test_id", publishedTestId);
        draftOnlyVersionId = id("insert into version_test (test_id, numero_version, estado) values (?, '1.0', 'BORRADOR') "
                + "returning version_test_id", draftOnlyTestId);
        subtestId = id("insert into subtest (version_test_id, codigo_subtest, nombre_subtest, numero_orden) "
                + "values (?, 'SUB-1', 'Subtest 1', 1) returning subtest_id", publishedVersionId);
        id("insert into subtest (version_test_id, codigo_subtest, nombre_subtest, numero_orden) "
                + "values (?, 'SUB-1', 'Subtest borrador', 1) returning subtest_id", draftVersionOfPublishedTestId);
        itemId = id("insert into item (subtest_id, codigo_item, tipo_item, tipo_respuesta, enunciado, numero_orden) "
                + "values (?, 'IT-1', 'SOLO_TEXTO', 'OPCION_UNICA', 'Pregunta confidencial', 1) returning item_id", subtestId);
        id("insert into opcion_item (item_id, codigo_opcion, texto_opcion, numero_orden) "
                + "values (?, 'OPT-1', 'Opcion confidencial', 1) returning opcion_id", itemId);
        // Se publica al final: una version PUBLICADO es inmutable y ya no admite subtests, items ni opciones.
        jdbc.update("update version_test set estado = 'PUBLICADO', aprobado_por = ?, aprobado_en = now(), "
                + "publicado_en = now(), estrategia_calificacion_id = "
                + "(select min(estrategia_calificacion_id) from estrategia_calificacion) where version_test_id = ?",
                approverId, publishedVersionId);
    }

    @Test
    void aplicadorListaSoloTestsConVersionPublicada() throws Exception {
        mvc.perform(get("/tests").header("Authorization", bearer("APLICADOR")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[?(@.codigoTest=='" + publishedCode + "')]").isNotEmpty())
                .andExpect(jsonPath("$.data[?(@.codigoTest=='" + draftOnlyCode + "')]").isEmpty());
    }

    @Test
    void aplicadorVeSoloVersionesPublicadas() throws Exception {
        mvc.perform(get("/tests/{id}/versions", publishedTestId).header("Authorization", bearer("APLICADOR")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].id").value(publishedVersionId))
                .andExpect(jsonPath("$.data[0].estado").value("PUBLICADO"));
        mvc.perform(get("/tests/{id}/versions", draftOnlyTestId).header("Authorization", bearer("APLICADOR")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(0));
    }

    @Test
    void aplicadorListaSubtestsDeVersionPublicadaSinItemsNiOpcionesNiClaves() throws Exception {
        String body = mvc.perform(get("/test-versions/{id}/subtests", publishedVersionId)
                .header("Authorization", bearer("APLICADOR")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].id").value(subtestId))
                .andExpect(jsonPath("$.data[0].codigoSubtest").value("SUB-1"))
                .andExpect(jsonPath("$.data[0].items").doesNotExist())
                .andExpect(jsonPath("$.data[0].opciones").doesNotExist())
                .andExpect(jsonPath("$.data[0].claves").doesNotExist())
                .andReturn().getResponse().getContentAsString();
        assertThat(body).doesNotContain("Pregunta confidencial").doesNotContain("Opcion confidencial")
                .doesNotContain("IT-1").doesNotContain("OPT-1");
    }

    @Test
    void aplicadorRecibe404EnSubtestsDeVersionNoPublicada() throws Exception {
        mvc.perform(get("/test-versions/{id}/subtests", draftOnlyVersionId).header("Authorization", bearer("APLICADOR")))
                .andExpect(status().isNotFound());
        mvc.perform(get("/test-versions/{id}/subtests", draftVersionOfPublishedTestId)
                .header("Authorization", bearer("APLICADOR")))
                .andExpect(status().isNotFound());
        mvc.perform(get("/test-versions/{id}/subtests", 999_999_999L).header("Authorization", bearer("APLICADOR")))
                .andExpect(status().isNotFound());
    }

    @Test
    void aplicadorNoAccedeAItemsOpcionesClavesNiClonado() throws Exception {
        String token = bearer("APLICADOR");
        mvc.perform(get("/subtests/{id}/items", subtestId).header("Authorization", token))
                .andExpect(status().isForbidden());
        mvc.perform(get("/subtests/{id}/clone-template", subtestId).header("Authorization", token))
                .andExpect(status().isForbidden());
        mvc.perform(get("/items/{id}/options", itemId).header("Authorization", token))
                .andExpect(status().isForbidden());
        mvc.perform(get("/items/{id}/answer-key", itemId).header("Authorization", token))
                .andExpect(status().isForbidden());
    }

    @Test
    void psicologoConTestLeerVeBorradoresYTodosLosTests() throws Exception {
        String token = bearer("PSICOLOGO_COORDINADOR");
        mvc.perform(get("/tests").header("Authorization", token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[?(@.codigoTest=='" + draftOnlyCode + "')]").isNotEmpty())
                .andExpect(jsonPath("$.data[?(@.codigoTest=='" + publishedCode + "')]").isNotEmpty());
        mvc.perform(get("/tests/{id}/versions", publishedTestId).header("Authorization", token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2));
        mvc.perform(get("/test-versions/{id}/subtests", draftOnlyVersionId).header("Authorization", token))
                .andExpect(status().isOk());
        mvc.perform(get("/subtests/{id}/items", subtestId).header("Authorization", token))
                .andExpect(status().isOk());
    }

    @Test
    void psicologoSuperivisaPeroNoOperaSesiones() throws Exception {
        String token = bearer("PSICOLOGO_COORDINADOR");
        mvc.perform(get("/sesiones").header("Authorization", token)).andExpect(status().isOk());
        mvc.perform(get("/participantes").header("Authorization", token)).andExpect(status().isOk());

        long sessionId = 999_999_999L;
        mvc.perform(get("/sesiones/{id}/asignaciones", sessionId).header("Authorization", token))
                .andExpect(status().isOk());
        mvc.perform(get("/sesiones/{id}/pausas", sessionId).header("Authorization", token))
                .andExpect(status().isNotFound());

        mvc.perform(post("/sesiones/{id}/activar", sessionId).header("Authorization", token))
                .andExpect(status().isForbidden());
        mvc.perform(post("/sesiones/{id}/pausar", sessionId).header("Authorization", token)
                .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isForbidden());
        mvc.perform(post("/sesiones/{id}/reanudar", sessionId).header("Authorization", token))
                .andExpect(status().isForbidden());
        mvc.perform(post("/sesiones/{id}/cerrar", sessionId).header("Authorization", token))
                .andExpect(status().isForbidden());
        mvc.perform(post("/sesiones/{id}/cancelar", sessionId).header("Authorization", token))
                .andExpect(status().isForbidden());
        mvc.perform(post("/sesiones/{id}/asignaciones", sessionId).header("Authorization", token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"participantId\":\"" + UUID.randomUUID() + "\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(post("/sesiones/{id}/asignaciones/{a}/revocar", sessionId, 1L).header("Authorization", token))
                .andExpect(status().isForbidden());
        mvc.perform(post("/sesiones/{id}/incidencias", sessionId).header("Authorization", token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"participantId\":\"" + UUID.randomUUID() + "\",\"text\":\"incidencia\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void psicologoNoRecibeSesionCrearNiAplicar() {
        Set<String> permissions = permissionsOf("PSICOLOGO_COORDINADOR");
        assertThat(permissions).contains("SESION_LEER", "PARTICIPANTE_LEER", "INSTRUMENTO_CATALOGO_LEER", "TEST_LEER");
        assertThat(permissions).doesNotContain("SESION_CREAR", "SESION_APLICAR");
    }

    @Test
    void aplicadorRecibeSoloCatalogoSinTestLeer() {
        Set<String> permissions = permissionsOf("APLICADOR");
        assertThat(permissions).contains("INSTRUMENTO_CATALOGO_LEER", "SESION_CREAR", "SESION_APLICAR");
        assertThat(permissions).doesNotContain("TEST_LEER", "TEST_CREAR", "TEST_PUBLICAR");
    }

    @Test
    void administradorRecibeLosPermisosNuevos() {
        assertThat(permissionsOf("ADMINISTRADOR")).contains("INSTRUMENTO_CATALOGO_LEER", "SESION_LEER", "TEST_LEER");
    }

    @Test
    void consultorSigueSinAccesoAlCatalogoNiALasSesiones() throws Exception {
        String token = bearer("CONSULTOR_REPORTES");
        assertThat(permissionsOf("CONSULTOR_REPORTES")).doesNotContain("INSTRUMENTO_CATALOGO_LEER", "SESION_LEER");
        mvc.perform(get("/tests").header("Authorization", token)).andExpect(status().isForbidden());
        mvc.perform(get("/tests/{id}/versions", publishedTestId).header("Authorization", token))
                .andExpect(status().isForbidden());
        mvc.perform(get("/test-versions/{id}/subtests", publishedVersionId).header("Authorization", token))
                .andExpect(status().isForbidden());
        mvc.perform(get("/sesiones").header("Authorization", token)).andExpect(status().isForbidden());
    }

    @Test
    void testLeerExplicitoDaLecturaCompletaDeInstrumentos() throws Exception {
        String token = "Bearer " + jwt.emitir(UUID.randomUUID(), "lector", Set.of("TEST_LEER"), Set.of("ROL_PRUEBA"));
        mvc.perform(get("/tests/{id}/versions", publishedTestId).header("Authorization", token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2));
        mvc.perform(get("/subtests/{id}/items", subtestId).header("Authorization", token))
                .andExpect(status().isOk());
    }

    @Test
    void sesionLeerExplicitoPermiteListarSesiones() throws Exception {
        String token = "Bearer " + jwt.emitir(UUID.randomUUID(), "lector", Set.of("SESION_LEER"), Set.of("ROL_PRUEBA"));
        mvc.perform(get("/sesiones").header("Authorization", token)).andExpect(status().isOk());
        mvc.perform(post("/sesiones/{id}/activar", 1L).header("Authorization", token))
                .andExpect(status().isForbidden());
    }

    private long id(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }

    private Set<String> permissionsOf(String roleName) {
        return Set.copyOf(jdbc.queryForList(
                "select p.codigo_permiso from rol r join rol_permiso rp on rp.rol_id = r.rol_id "
                        + "join permiso p on p.permiso_id = rp.permiso_id where r.nombre_rol = ?",
                String.class, roleName));
    }

    private String bearer(String roleName) {
        return "Bearer " + jwt.emitir(UUID.randomUUID(), "usuario-" + roleName.toLowerCase(), permissionsOf(roleName),
                Set.of(roleName));
    }
}

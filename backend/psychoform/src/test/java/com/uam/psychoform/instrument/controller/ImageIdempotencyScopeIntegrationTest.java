package com.uam.psychoform.instrument.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.uam.psychoform.PsychoformApplication;
import com.uam.psychoform.security.service.JwtService;
import com.uam.psychoform.storage.ObjectStorageService;
import com.uam.psychoform.storage.StoredObject;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * B8/B20: la Idempotency-Key se acota por usuario que sube y por tipo de operacion. La misma clave con otro usuario o
 * en otra operacion es una subida nueva; con el mismo usuario y operacion y otro archivo es 409.
 */
@SpringBootTest(classes = PsychoformApplication.class)
@AutoConfigureMockMvc
class ImageIdempotencyScopeIntegrationTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    @Autowired
    MockMvc mvc;

    @Autowired
    JwtService jwt;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    PlatformTransactionManager txManager;

    @MockitoBean
    ObjectStorageService storage;

    private UUID userA;
    private UUID userB;
    private long testId;
    private long versionId;
    private long subtestId;
    private long itemId;
    private long optionId;

    @BeforeEach
    void seed() {
        reset(storage);
        when(storage.putObject(anyString(), anyString(), any()))
                .thenAnswer(inv -> new StoredObject(inv.getArgument(0), "etag"));
        new TransactionTemplate(txManager).executeWithoutResult(status -> {
            String suffix = UUID.randomUUID().toString().substring(0, 8);
            userA = user("scopea_" + suffix);
            userB = user("scopeb_" + suffix);
            testId = id("insert into test (codigo_test, nombre_test) values (?, ?) returning test_id",
                    "SCOPE-" + suffix, "Test scope " + suffix);
            versionId = id("insert into version_test (test_id, numero_version, estado) values (?, '1.0', 'BORRADOR') "
                    + "returning version_test_id", testId);
            subtestId = id("insert into subtest (version_test_id, codigo_subtest, nombre_subtest, numero_orden) "
                    + "values (?, 'SUB-1', 'Subtest 1', 1) returning subtest_id", versionId);
            itemId = id("insert into item (subtest_id, codigo_item, tipo_item, tipo_respuesta, enunciado, "
                    + "numero_orden) values (?, 'IT-1', 'TEXTO_E_IMAGEN', 'OPCION_UNICA', 'Pregunta', 1) "
                    + "returning item_id", subtestId);
            optionId = id("insert into opcion_item (item_id, codigo_opcion, texto_opcion, numero_orden) "
                    + "values (?, 'OPT-1', 'Opcion 1', 1) returning opcion_id", itemId);
        });
    }

    @AfterEach
    void cleanup() {
        new TransactionTemplate(txManager).executeWithoutResult(status -> {
            jdbc.update("delete from imagen_item where item_id = ?", itemId);
            jdbc.update("delete from imagen_opcion where opcion_id = ?", optionId);
            jdbc.update("delete from recurso_multimedia where subido_por in (?, ?)", userA, userB);
            jdbc.update("delete from opcion_item where opcion_id = ?", optionId);
            jdbc.update("delete from item where item_id = ?", itemId);
            jdbc.update("delete from subtest where subtest_id = ?", subtestId);
            jdbc.update("delete from version_test where version_test_id = ?", versionId);
            jdbc.update("delete from test where test_id = ?", testId);
            jdbc.update("delete from usuario where usuario_id in (?, ?)", userA, userB);
        });
    }

    @Test
    void dosUsuariosConLaMismaClaveObtienenRecursosDistintos() throws Exception {
        String key = "same-" + UUID.randomUUID();
        MockMultipartFile file = png("a.png", "contenido-compartido");

        JsonNode first = ok(loose(file, key, userA));
        JsonNode second = ok(loose(file, key, userB));

        assertThat(second.path("resourceId").asLong()).isNotEqualTo(first.path("resourceId").asLong());
        assertThat(second.path("storagePath").asText()).isNotEqualTo(first.path("storagePath").asText());
        assertThat(second.path("uploadKey").asText()).isEqualTo(key);
        verify(storage, times(2)).putObject(anyString(), anyString(), any());
        assertThat(jdbc.queryForObject("select subido_por from recurso_multimedia where recurso_id = ?", UUID.class,
                second.path("resourceId").asLong())).isEqualTo(userB);
    }

    @Test
    void dosUsuariosConLaMismaClaveYOtroArchivoNoSeVenEntreSiNiRecibenConflicto() throws Exception {
        String key = "same-" + UUID.randomUUID();

        JsonNode first = ok(loose(png("a.png", "archivo-de-a"), key, userA));
        JsonNode second = ok(loose(png("b.png", "archivo-de-b"), key, userB));

        assertThat(second.path("resourceId").asLong()).isNotEqualTo(first.path("resourceId").asLong());
        assertThat(second.path("sha256").asText()).isNotEqualTo(first.path("sha256").asText());
    }

    @Test
    void laMismaClaveEnSubidaVinculadaYSueltaDelMismoUsuarioNoSeCruza() throws Exception {
        String key = "cross-" + UUID.randomUUID();
        MockMultipartFile file = png("a.png", "mismo-archivo");

        JsonNode looseUpload = ok(loose(file, key, userA));
        JsonNode itemUpload = ok(multipart("/items/{id}/images", itemId).file(file).param("order", "1")
                .contentType(MediaType.MULTIPART_FORM_DATA).header("Idempotency-Key", key)
                .header("Authorization", bearer(userA)));
        JsonNode optionUpload = ok(multipart("/options/{id}/images", optionId).file(file).param("order", "1")
                .contentType(MediaType.MULTIPART_FORM_DATA).header("Idempotency-Key", key)
                .header("Authorization", bearer(userA)));

        assertThat(itemUpload.path("resourceId").asLong()).isNotEqualTo(looseUpload.path("resourceId").asLong());
        assertThat(optionUpload.path("resourceId").asLong()).isNotIn(looseUpload.path("resourceId").asLong(),
                itemUpload.path("resourceId").asLong());
        assertThat(itemUpload.path("storagePath").asText()).startsWith("test-config/items/");
        assertThat(optionUpload.path("storagePath").asText()).startsWith("test-config/options/");
        verify(storage, times(3)).putObject(anyString(), anyString(), any());
    }

    @Test
    void laMismaClaveEnLaMismaImagenDeItemPorDosUsuariosCreaDosRecursos() throws Exception {
        String key = "item-" + UUID.randomUUID();
        MockMultipartFile file = png("a.png", "archivo");

        JsonNode first = ok(multipart("/items/{id}/images", itemId).file(file).param("order", "1")
                .contentType(MediaType.MULTIPART_FORM_DATA).header("Idempotency-Key", key)
                .header("Authorization", bearer(userA)));
        JsonNode second = ok(multipart("/items/{id}/images", itemId).file(file).param("order", "2")
                .contentType(MediaType.MULTIPART_FORM_DATA).header("Idempotency-Key", key)
                .header("Authorization", bearer(userB)));

        assertThat(second.path("resourceId").asLong()).isNotEqualTo(first.path("resourceId").asLong());
        assertThat(second.path("imageLinkId").asLong()).isNotEqualTo(first.path("imageLinkId").asLong());
        assertThat(second.path("order").asInt()).isEqualTo(2);
    }

    @Test
    void reintentoIdenticoDelMismoUsuarioYOperacionDevuelveElMismoRecurso() throws Exception {
        String key = "retry-" + UUID.randomUUID();
        MockMultipartFile file = png("a.png", "mismo-archivo");

        JsonNode first = ok(loose(file, key, userA));
        JsonNode second = ok(loose(file, key, userA));

        assertThat(second.path("resourceId").asLong()).isEqualTo(first.path("resourceId").asLong());
        assertThat(second.path("storagePath").asText()).isEqualTo(first.path("storagePath").asText());
        assertThat(second.path("uploadKey").asText()).isEqualTo(key);
        verify(storage, times(1)).putObject(anyString(), anyString(), any());
        assertThat(count("select count(*) from recurso_multimedia where subido_por = ?", userA)).isEqualTo(1);
    }

    @Test
    void laMismaClaveMismoUsuarioYOperacionConOtroArchivoDevuelve409() throws Exception {
        String key = "conflict-" + UUID.randomUUID();
        ok(loose(png("a.png", "primero"), key, userA));

        mvc.perform(loose(png("b.png", "segundo"), key, userA))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("CONFLICT"));

        verify(storage, times(1)).putObject(anyString(), anyString(), any());
    }

    @Test
    void laClaveSeValidaAntesDeSubirNada() throws Exception {
        for (String invalid : List.of("k".repeat(65), "con espacio", "con.punto", "con:dos")) {
            mvc.perform(loose(png("a.png", "x"), invalid, userA))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error.code").value("BAD_REQUEST"));
        }
        // Un UUID y una clave de exactamente 64 caracteres son validas.
        ok(loose(png("a.png", "x"), UUID.randomUUID().toString(), userA));
        ok(loose(png("b.png", "y"), "k".repeat(64), userA));
    }

    private org.springframework.test.web.servlet.request.MockMultipartHttpServletRequestBuilder loose(
            MockMultipartFile file, String key, UUID user) {
        var builder = multipart("/images/resources").file(file).contentType(MediaType.MULTIPART_FORM_DATA)
                .header("Authorization", bearer(user));
        return key == null ? builder : builder.header("Idempotency-Key", key);
    }

    private JsonNode ok(org.springframework.test.web.servlet.RequestBuilder request)
            throws Exception {
        String body = mvc.perform(request).andExpect(status().isOk()).andReturn().getResponse()
                .getContentAsString();
        return JSON.readTree(body).path("data");
    }

    private static MockMultipartFile png(String name, String content) {
        return new MockMultipartFile("file", name, "image/png", content.getBytes());
    }

    private UUID user(String username) {
        UUID id = UUID.randomUUID();
        jdbc.update("insert into usuario (usuario_id, nombre_usuario, correo, hash_contrasena, nombre_completo) "
                + "values (?, ?, ?, 'hash', 'Editor scope')", id, username, username + "@uam.edu");
        return id;
    }

    private long id(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }

    private long count(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }

    private String bearer(UUID user) {
        return "Bearer " + jwt.emitir(user, "editor", Set.of("TEST_CREAR"), Set.of("PSICOLOGO_COORDINADOR"));
    }
}

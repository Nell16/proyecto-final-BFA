package com.uam.psychoform.instrument.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.uam.psychoform.PsychoformApplication;
import com.uam.psychoform.storage.ObjectStorageService;
import com.uam.psychoform.storage.StoredObject;
import com.uam.psychoform.security.service.JwtService;
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

@SpringBootTest(classes = PsychoformApplication.class)
@AutoConfigureMockMvc
class InstrumentImageB20IntegrationTest {
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

    private Scenario scenario;

    private record Scenario(UUID userId, long testId, long versionId, long subtestId, long itemId, long optionId) {
    }

    @BeforeEach
    void setupStorage() {
        reset(storage);
        when(storage.putObject(anyString(), anyString(), any()))
                .thenAnswer(inv -> new StoredObject(inv.getArgument(0), "etag"));
    }

    @AfterEach
    void cleanup() {
        if (scenario == null) {
            return;
        }
        Scenario s = scenario;
        new TransactionTemplate(txManager).executeWithoutResult(status -> {
            jdbc.update("delete from imagen_item where item_id = ?", s.itemId());
            jdbc.update("delete from imagen_opcion where opcion_id = ?", s.optionId());
            jdbc.update("delete from recurso_multimedia where subido_por = ?", s.userId());
            jdbc.update("delete from opcion_item where opcion_id = ?", s.optionId());
            jdbc.update("delete from item where item_id = ?", s.itemId());
            jdbc.update("delete from subtest where subtest_id = ?", s.subtestId());
            jdbc.update("delete from version_test where version_test_id = ?", s.versionId());
            jdbc.update("delete from test where test_id = ?", s.testId());
            jdbc.update("delete from usuario where usuario_id = ?", s.userId());
        });
    }

    @Test
    void postWithSameIdempotencyKeyReturnsSameResourceWithoutDuplicatingStorageOrRows() throws Exception {
        scenario = seedDraft();
        String key = "b20-post-" + UUID.randomUUID();
        byte[] pngBytes = "png-payload-1".getBytes();
        MockMultipartFile file = new MockMultipartFile("file", "stimulus.png", "image/png", pngBytes);

        String firstBody = mvc.perform(multipart("/items/{id}/images", scenario.itemId())
                .file(file)
                .param("order", "1")
                .param("altText", "Estimulo")
                .param("role", "ENUNCIADO")
                .contentType(MediaType.MULTIPART_FORM_DATA)
                .header("Idempotency-Key", key)
                .header("Authorization", bearer("TEST_CREAR")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.uploadKey").value(key))
                .andReturn()
                .getResponse()
                .getContentAsString();

        String secondBody = mvc.perform(multipart("/items/{id}/images", scenario.itemId())
                .file(file)
                .param("order", "1")
                .param("altText", "Estimulo")
                .param("role", "ENUNCIADO")
                .contentType(MediaType.MULTIPART_FORM_DATA)
                .header("Idempotency-Key", key)
                .header("Authorization", bearer("TEST_CREAR")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.uploadKey").value(key))
                .andReturn()
                .getResponse()
                .getContentAsString();

        JsonNode first = JSON.readTree(firstBody).path("data");
        JsonNode second = JSON.readTree(secondBody).path("data");
        assertThat(second.path("resourceId").asLong()).isEqualTo(first.path("resourceId").asLong());
        assertThat(second.path("imageLinkId").asLong()).isEqualTo(first.path("imageLinkId").asLong());

        verify(storage, times(1)).putObject(anyString(), anyString(), any());
        Integer imageLinks = jdbc.queryForObject("select count(*) from imagen_item where item_id = ?",
                Integer.class, scenario.itemId());
        assertThat(imageLinks).isEqualTo(1);
    }

    @Test
    void postWithSameIdempotencyKeyAndDifferentFileReturns409() throws Exception {
        scenario = seedDraft();
        String key = "b20-conflict-" + UUID.randomUUID();
        MockMultipartFile first = new MockMultipartFile("file", "a.png", "image/png", "first".getBytes());
        MockMultipartFile second = new MockMultipartFile("file", "b.png", "image/png", "second".getBytes());

        mvc.perform(multipart("/items/{id}/images", scenario.itemId())
                .file(first)
                .param("order", "1")
                .contentType(MediaType.MULTIPART_FORM_DATA)
                .header("Idempotency-Key", key)
                .header("Authorization", bearer("TEST_CREAR")))
                .andExpect(status().isOk());

        mvc.perform(multipart("/items/{id}/images", scenario.itemId())
                .file(second)
                .param("order", "1")
                .contentType(MediaType.MULTIPART_FORM_DATA)
                .header("Idempotency-Key", key)
                .header("Authorization", bearer("TEST_CREAR")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error.code").value("CONFLICT"));

        verify(storage, times(1)).putObject(anyString(), anyString(), any());
    }

    @Test
    void cloneTemplateAndItemImagesExposeMetadataAndUpdatedPutUploadKey() throws Exception {
        scenario = seedDraft();
        String itemKey = "b20-item-" + UUID.randomUUID();
        String optionKey = "b20-opt-" + UUID.randomUUID();
        String putKey = "b20-put-" + UUID.randomUUID();

        MockMultipartFile itemFile = new MockMultipartFile("file", "item-1.png", "image/png", "item-bytes".getBytes());
        MockMultipartFile optFile = new MockMultipartFile("file", "opt-1.webp", "image/webp", "opt-bytes".getBytes());
        MockMultipartFile replacementFile = new MockMultipartFile("file", "item-2.jpg", "image/jpeg",
                "replaced-bytes".getBytes());

        String itemUploadBody = mvc.perform(multipart("/items/{id}/images", scenario.itemId())
                .file(itemFile)
                .param("order", "1")
                .param("altText", "Item img")
                .contentType(MediaType.MULTIPART_FORM_DATA)
                .header("Idempotency-Key", itemKey)
                .header("Authorization", bearer("TEST_CREAR")))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        long itemImageId = JSON.readTree(itemUploadBody).path("data").path("imageLinkId").asLong();

        mvc.perform(multipart("/options/{id}/images", scenario.optionId())
                .file(optFile)
                .param("order", "1")
                .param("altText", "Option img")
                .contentType(MediaType.MULTIPART_FORM_DATA)
                .header("Idempotency-Key", optionKey)
                .header("Authorization", bearer("TEST_CREAR")))
                .andExpect(status().isOk());

        mvc.perform(get("/subtests/{id}/clone-template", scenario.subtestId())
                .header("Authorization", bearer("TEST_LEER")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].images[0].originalFileName").value("item-1.png"))
                .andExpect(jsonPath("$.data.items[0].images[0].sizeBytes").value(10))
                .andExpect(jsonPath("$.data.items[0].images[0].sha256").isNotEmpty())
                .andExpect(jsonPath("$.data.items[0].images[0].uploadKey").value(itemKey))
                .andExpect(jsonPath("$.data.items[0].options[0].images[0].originalFileName").value("opt-1.webp"))
                .andExpect(jsonPath("$.data.items[0].options[0].images[0].sizeBytes").value(9))
                .andExpect(jsonPath("$.data.items[0].options[0].images[0].sha256").isNotEmpty())
                .andExpect(jsonPath("$.data.items[0].options[0].images[0].uploadKey").value(optionKey));

        mvc.perform(get("/items/{itemId}/images", scenario.itemId())
                .header("Authorization", bearer("TEST_LEER")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].uploadKey").value(itemKey))
                .andExpect(jsonPath("$.data[0].sha256").isNotEmpty());

        mvc.perform(multipart("/items/{itemId}/images/{imageId}", scenario.itemId(), itemImageId)
                .file(replacementFile)
                .param("altText", "Reemplazo")
                .param("role", "ENUNCIADO")
                .contentType(MediaType.MULTIPART_FORM_DATA)
                .with(req -> {
                    req.setMethod("PUT");
                    return req;
                })
                .header("Idempotency-Key", putKey)
                .header("Authorization", bearer("TEST_CREAR")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.uploadKey").value(putKey));

        mvc.perform(get("/subtests/{id}/clone-template", scenario.subtestId())
                .header("Authorization", bearer("TEST_LEER")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].images[0].originalFileName").value("item-2.jpg"))
                .andExpect(jsonPath("$.data.items[0].images[0].sizeBytes").value(14))
                .andExpect(jsonPath("$.data.items[0].images[0].uploadKey").value(putKey));

        mvc.perform(get("/items/{itemId}/images", scenario.itemId())
                .header("Authorization", bearer("TEST_LEER")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].uploadKey").value(putKey));
    }

    @Test
    void invalidMimeReturns400AndUnauthorizedUserReturns403() throws Exception {
        scenario = seedDraft();
        MockMultipartFile invalid = new MockMultipartFile("file", "bad.txt", "text/plain", "bad".getBytes());

        mvc.perform(multipart("/items/{id}/images", scenario.itemId())
                .file(invalid)
                .contentType(MediaType.MULTIPART_FORM_DATA)
                .header("Authorization", bearer("TEST_CREAR")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("BAD_REQUEST"));

        MockMultipartFile valid = new MockMultipartFile("file", "ok.png", "image/png", "ok".getBytes());
        mvc.perform(multipart("/items/{id}/images", scenario.itemId())
                .file(valid)
                .contentType(MediaType.MULTIPART_FORM_DATA)
                .header("Authorization", bearer("TEST_LEER")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    private Scenario seedDraft() {
        return new TransactionTemplate(txManager).execute(status -> {
            String suffix = UUID.randomUUID().toString().substring(0, 8);
            UUID userId = UUID.randomUUID();
            jdbc.update(
                    "insert into usuario (usuario_id, nombre_usuario, correo, hash_contrasena, nombre_completo) "
                            + "values (?, ?, ?, 'hash', 'Editor B20')",
                    userId, "b20_" + suffix, "b20_" + suffix + "@uam.edu");
            long testId = id("insert into test (codigo_test, nombre_test) values (?, ?) returning test_id",
                    "B20-" + suffix, "Test B20 " + suffix);
            long versionId = id(
                    "insert into version_test (test_id, numero_version, estado) values (?, '1.0', 'BORRADOR') "
                            + "returning version_test_id",
                    testId);
            long subtestId = id(
                    "insert into subtest (version_test_id, codigo_subtest, nombre_subtest, numero_orden) "
                            + "values (?, 'SUB-1', 'Subtest 1', 1) returning subtest_id",
                    versionId);
            long itemId = id(
                    "insert into item (subtest_id, codigo_item, tipo_item, tipo_respuesta, enunciado, numero_orden) "
                            + "values (?, 'IT-1', 'TEXTO_E_IMAGEN', 'OPCION_UNICA', 'Pregunta', 1) returning item_id",
                    subtestId);
            long optionId = id(
                    "insert into opcion_item (item_id, codigo_opcion, texto_opcion, numero_orden) "
                            + "values (?, 'OPT-1', 'Opcion 1', 1) returning opcion_id",
                    itemId);
            return new Scenario(userId, testId, versionId, subtestId, itemId, optionId);
        });
    }

    private long id(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }

    private String bearer(String permission) {
        return "Bearer " + jwt.emitir(scenario.userId(), "editor", Set.of(permission),
                Set.of("PSICOLOGO_COORDINADOR"));
    }
}

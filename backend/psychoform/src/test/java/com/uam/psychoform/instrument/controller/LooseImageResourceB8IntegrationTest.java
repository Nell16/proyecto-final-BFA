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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.uam.psychoform.PsychoformApplication;
import com.uam.psychoform.instrument.dto.VersionConfigurationRequest;
import com.uam.psychoform.instrument.dto.VersionConfigurationRequest.DraftStatus;
import com.uam.psychoform.instrument.dto.VersionConfigurationRequest.ImageDraft;
import com.uam.psychoform.instrument.dto.VersionConfigurationRequest.ItemDraft;
import com.uam.psychoform.instrument.dto.VersionConfigurationRequest.OptionDraft;
import com.uam.psychoform.instrument.dto.VersionConfigurationRequest.SubtestDraft;
import com.uam.psychoform.instrument.model.TipoItem;
import com.uam.psychoform.instrument.model.TipoRespuesta;
import com.uam.psychoform.security.service.JwtService;
import com.uam.psychoform.storage.ObjectStorageService;
import com.uam.psychoform.storage.StoredObject;
import java.math.BigDecimal;
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
class LooseImageResourceB8IntegrationTest {
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

    private record Scenario(UUID userId, long testId, long versionId) {
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
            jdbc.update("""
                    delete from imagen_opcion where opcion_id in (
                        select opcion_id from opcion_item where item_id in (
                            select item_id from item where subtest_id in (
                                select subtest_id from subtest where version_test_id = ?
                            )
                        )
                    )
                    """, s.versionId());
            jdbc.update("""
                    delete from imagen_item where item_id in (
                        select item_id from item where subtest_id in (
                            select subtest_id from subtest where version_test_id = ?
                        )
                    )
                    """, s.versionId());
            jdbc.update("delete from recurso_multimedia where subido_por = ?", s.userId());
            jdbc.update("""
                    delete from opcion_item where item_id in (
                        select item_id from item where subtest_id in (
                            select subtest_id from subtest where version_test_id = ?
                        )
                    )
                    """, s.versionId());
            jdbc.update("""
                    delete from item where subtest_id in (
                        select subtest_id from subtest where version_test_id = ?
                    )
                    """, s.versionId());
            jdbc.update("delete from subtest where version_test_id = ?", s.versionId());
            jdbc.update("delete from version_test where version_test_id = ?", s.versionId());
            jdbc.update("delete from test where test_id = ?", s.testId());
            jdbc.update("delete from usuario where usuario_id = ?", s.userId());
        });
    }

    @Test
    void looseUploadCreatesOnlyResourceAndLinksViaVersionConfiguration() throws Exception {
        scenario = seedDraftVersion();
        String itemKey = "b8-item-" + UUID.randomUUID();
        String optionKey = "b8-opt-" + UUID.randomUUID();

        MockMultipartFile itemFile = new MockMultipartFile("file", "estimulo.png", "image/png", "item-img".getBytes());
        MockMultipartFile optFile = new MockMultipartFile("file", "opcion.webp", "image/webp", "opt-img".getBytes());

        String itemResourceBody = mvc.perform(multipart("/images/resources")
                .file(itemFile)
                .param("altText", "Estimulo suelto")
                .contentType(MediaType.MULTIPART_FORM_DATA)
                .header("Idempotency-Key", itemKey)
                .header("Authorization", bearer("TEST_CREAR")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.resourceId").isNumber())
                .andExpect(jsonPath("$.data.storagePath").isNotEmpty())
                .andExpect(jsonPath("$.data.mimeType").value("image/png"))
                .andExpect(jsonPath("$.data.originalFileName").value("estimulo.png"))
                .andExpect(jsonPath("$.data.sizeBytes").value(8))
                .andExpect(jsonPath("$.data.sha256").isNotEmpty())
                .andExpect(jsonPath("$.data.uploadKey").value(itemKey))
                .andReturn()
                .getResponse()
                .getContentAsString();
        long itemResourceId = JSON.readTree(itemResourceBody).path("data").path("resourceId").asLong();

        // Repeated upload with same Idempotency-Key returns same resourceId without duplicating storage or DB row
        String repeatedBody = mvc.perform(multipart("/images/resources")
                .file(itemFile)
                .contentType(MediaType.MULTIPART_FORM_DATA)
                .header("Idempotency-Key", itemKey)
                .header("Authorization", bearer("TEST_CREAR")))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        assertThat(JSON.readTree(repeatedBody).path("data").path("resourceId").asLong()).isEqualTo(itemResourceId);

        Integer itemLinksBefore = jdbc.queryForObject("select count(*) from imagen_item where recurso_id = ?",
                Integer.class, itemResourceId);
        Integer optionLinksBefore = jdbc.queryForObject("select count(*) from imagen_opcion where recurso_id = ?",
                Integer.class, itemResourceId);
        assertThat(itemLinksBefore).isZero();
        assertThat(optionLinksBefore).isZero();

        String optionResourceBody = mvc.perform(multipart("/images/resources")
                .file(optFile)
                .contentType(MediaType.MULTIPART_FORM_DATA)
                .header("Idempotency-Key", optionKey)
                .header("Authorization", bearer("TEST_CREAR")))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        long optionResourceId = JSON.readTree(optionResourceBody).path("data").path("resourceId").asLong();

        verify(storage, times(2)).putObject(anyString(), anyString(), any());

        ImageDraft itemImgDraft = new ImageDraft(null, "tmp-img-1", null, itemResourceId, DraftStatus.CREATED, 1,
                "Estimulo suelto", "ENUNCIADO");
        ImageDraft optImgDraft = new ImageDraft(null, "tmp-opt-img-1", null, optionResourceId, DraftStatus.CREATED, 1,
                "Opcion suelta", null);
        OptionDraft optDraft = new OptionDraft(null, "tmp-opt-1", null, DraftStatus.CREATED, "A", "Opcion A", 1,
                BigDecimal.ONE, List.of(optImgDraft));
        ItemDraft itemDraft = new ItemDraft(null, "tmp-item-1", null, DraftStatus.CREATED, "IT-1",
                TipoItem.TEXTO_E_IMAGEN, TipoRespuesta.OPCION_UNICA, "Pregunta", null, 1, BigDecimal.ONE, null,
                true, true, List.of(itemImgDraft), List.of(optDraft), null);
        SubtestDraft subtestDraft = new SubtestDraft(null, "tmp-sub-1", null, DraftStatus.CREATED, "SUB-1",
                "Subtest 1", null, null, 1, null, false, false, true, null, List.of(itemDraft));

        String configResponse = mvc.perform(post("/test-versions/{id}/configuration", scenario.versionId())
                .header("Authorization", bearer("TEST_CREAR"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(new VersionConfigurationRequest(List.of(subtestDraft)))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andReturn()
                .getResponse()
                .getContentAsString();
        JsonNode savedSubtests = JSON.readTree(configResponse).path("data");
        long subtestId = savedSubtests.get(0).path("id").asLong();

        mvc.perform(get("/subtests/{id}/clone-template", subtestId)
                .header("Authorization", bearer("TEST_LEER")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].images[0].resourceId").value(itemResourceId))
                .andExpect(jsonPath("$.data.items[0].images[0].originalFileName").value("estimulo.png"))
                .andExpect(jsonPath("$.data.items[0].images[0].uploadKey").value(itemKey))
                .andExpect(jsonPath("$.data.items[0].options[0].images[0].resourceId").value(optionResourceId))
                .andExpect(jsonPath("$.data.items[0].options[0].images[0].originalFileName").value("opcion.webp"))
                .andExpect(jsonPath("$.data.items[0].options[0].images[0].uploadKey").value(optionKey));
    }

    @Test
    void looseUploadConflictInvalidMimeUnauthorizedAndMissingResourceIdInConfiguration() throws Exception {
        scenario = seedDraftVersion();
        String key = "b8-conflict-" + UUID.randomUUID();

        MockMultipartFile first = new MockMultipartFile("file", "a.png", "image/png", "first".getBytes());
        MockMultipartFile second = new MockMultipartFile("file", "b.png", "image/png", "second".getBytes());
        MockMultipartFile invalid = new MockMultipartFile("file", "bad.txt", "text/plain", "bad".getBytes());

        mvc.perform(multipart("/images/resources")
                .file(first)
                .contentType(MediaType.MULTIPART_FORM_DATA)
                .header("Idempotency-Key", key)
                .header("Authorization", bearer("TEST_CREAR")))
                .andExpect(status().isOk());

        mvc.perform(multipart("/images/resources")
                .file(second)
                .contentType(MediaType.MULTIPART_FORM_DATA)
                .header("Idempotency-Key", key)
                .header("Authorization", bearer("TEST_CREAR")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("CONFLICT"));

        mvc.perform(multipart("/images/resources")
                .file(invalid)
                .contentType(MediaType.MULTIPART_FORM_DATA)
                .header("Authorization", bearer("TEST_CREAR")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("BAD_REQUEST"));

        mvc.perform(multipart("/images/resources")
                .file(first)
                .contentType(MediaType.MULTIPART_FORM_DATA)
                .header("Authorization", bearer("TEST_LEER")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));

        ImageDraft missingImg = new ImageDraft(null, "tmp-img-missing", null, 999_999_999L, DraftStatus.CREATED, 1,
                "Inexistente", "ENUNCIADO");
        ItemDraft itemDraft = new ItemDraft(null, "tmp-item-missing", null, DraftStatus.CREATED, "IT-ERR",
                TipoItem.TEXTO_E_IMAGEN, TipoRespuesta.TEXTO_ABIERTO, "Pregunta", null, 1, BigDecimal.ONE, null,
                true, true, List.of(missingImg), List.of(), null);
        SubtestDraft subtestDraft = new SubtestDraft(null, "tmp-sub-missing", null, DraftStatus.CREATED, "SUB-ERR",
                "Subtest error", null, null, 1, null, false, false, true, null, List.of(itemDraft));

        mvc.perform(post("/test-versions/{id}/configuration", scenario.versionId())
                .header("Authorization", bearer("TEST_CREAR"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(new VersionConfigurationRequest(List.of(subtestDraft)))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("BAD_REQUEST"));

        Integer persistedSubtests = jdbc.queryForObject(
                "select count(*) from subtest where version_test_id = ?", Integer.class, scenario.versionId());
        assertThat(persistedSubtests).isZero();
    }

    private Scenario seedDraftVersion() {
        return new TransactionTemplate(txManager).execute(status -> {
            String suffix = UUID.randomUUID().toString().substring(0, 8);
            UUID userId = UUID.randomUUID();
            jdbc.update(
                    "insert into usuario (usuario_id, nombre_usuario, correo, hash_contrasena, nombre_completo) "
                            + "values (?, ?, ?, 'hash', 'Editor B8')",
                    userId, "b8_" + suffix, "b8_" + suffix + "@uam.edu");
            long testId = jdbc.queryForObject(
                    "insert into test (codigo_test, nombre_test) values (?, ?) returning test_id",
                    Long.class, "B8-" + suffix, "Test B8 " + suffix);
            long versionId = jdbc.queryForObject(
                    "insert into version_test (test_id, numero_version, estado) values (?, '1.0', 'BORRADOR') "
                            + "returning version_test_id",
                    Long.class, testId);
            return new Scenario(userId, testId, versionId);
        });
    }

    private String bearer(String permission) {
        return "Bearer " + jwt.emitir(scenario.userId(), "editor", Set.of(permission),
                Set.of("PSICOLOGO_COORDINADOR"));
    }
}

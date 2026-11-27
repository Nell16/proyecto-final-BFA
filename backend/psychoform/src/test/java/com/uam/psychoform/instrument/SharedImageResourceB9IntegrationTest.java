package com.uam.psychoform.instrument;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.uam.psychoform.PsychoformApplication;
import com.uam.psychoform.security.service.JwtService;
import com.uam.psychoform.storage.ObjectStorageService;
import com.uam.psychoform.storage.StoredObject;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
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
 * B9: las versiones clonadas comparten el {@code RecursoMultimedia} con la original. Reemplazar o eliminar una imagen
 * en la copia solo cambia el vinculo; el recurso y su objeto se borran (tras el commit) unicamente al perder su ultima
 * referencia. No es transaccional: las peticiones confirman de verdad y todo se limpia al final.
 */
@SpringBootTest(classes = PsychoformApplication.class)
@AutoConfigureMockMvc
class SharedImageResourceB9IntegrationTest {
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

    private final List<UUID> users = new ArrayList<>();
    private final List<Long> tests = new ArrayList<>();
    private final List<Long> fixtureResources = new ArrayList<>();

    private record Seeded(UUID userId, long sourceId, InstrumentVersionFixture.Seed seed) {
    }

    @BeforeEach
    void setupStorage() {
        reset(storage);
        when(storage.putObject(anyString(), anyString(), any()))
                .thenAnswer(inv -> new StoredObject(inv.getArgument(0), "etag"));
    }

    @AfterEach
    void cleanup() {
        new TransactionTemplate(txManager).executeWithoutResult(status -> {
            for (Long testId : tests) {
                jdbc.update("delete from test where test_id = ?", testId);
            }
            for (UUID userId : users) {
                jdbc.update("delete from recurso_multimedia where subido_por = ?", userId);
            }
            for (Long resourceId : fixtureResources) {
                jdbc.update("delete from recurso_multimedia where recurso_id = ?", resourceId);
            }
            for (UUID userId : users) {
                jdbc.update("delete from auditoria where usuario_id = ?", userId);
                jdbc.update("delete from usuario where usuario_id = ?", userId);
            }
        });
    }

    @Test
    void reemplazarLaImagenDeUnItemEnLaCopiaConservaRecursoYObjetoDeLaOriginal() throws Exception {
        Seeded src = seed(false);
        long cloneId = clone(src);
        long cloneItem = itemId(cloneId, "I1");
        long cloneImage = jdbc.queryForObject("select imagen_item_id from imagen_item where item_id = ?",
                Long.class, cloneItem);

        mvc.perform(put(src.userId(), "/items/{itemId}/images/{imageId}", cloneItem, cloneImage, "nuevo-item.png", "image/png",
                "item-nuevo"))
                .andExpect(status().isOk());

        verify(storage, never()).deleteObject(anyString());
        assertThat(resourceExists(src.seed().recursoItemId())).isTrue();
        assertThat(jdbc.queryForObject("select recurso_id from imagen_item where item_id = ?", Long.class,
                itemId(src.sourceId(), "I1"))).isEqualTo(src.seed().recursoItemId());
        assertThat(jdbc.queryForObject("select recurso_id from imagen_item where imagen_item_id = ?", Long.class,
                cloneImage)).isNotEqualTo(src.seed().recursoItemId());
    }

    @Test
    void reemplazarLaImagenDeUnaOpcionEnLaCopiaConservaRecursoYObjetoDeLaOriginal() throws Exception {
        Seeded src = seed(false);
        long cloneId = clone(src);
        long cloneOption = optionId(cloneId, "I1", "A");
        long cloneImage = jdbc.queryForObject("select imagen_opcion_id from imagen_opcion where opcion_id = ?",
                Long.class, cloneOption);

        mvc.perform(put(src.userId(), "/options/{optionId}/images/{imageId}", cloneOption, cloneImage, "nueva-opcion.png",
                "image/png", "opcion-nueva"))
                .andExpect(status().isOk());

        verify(storage, never()).deleteObject(anyString());
        assertThat(resourceExists(src.seed().recursoOpcionId())).isTrue();
        assertThat(jdbc.queryForObject("select recurso_id from imagen_opcion where opcion_id = ?", Long.class,
                optionId(src.sourceId(), "I1", "A"))).isEqualTo(src.seed().recursoOpcionId());
        assertThat(jdbc.queryForObject("select recurso_id from imagen_opcion where imagen_opcion_id = ?",
                Long.class, cloneImage)).isNotEqualTo(src.seed().recursoOpcionId());
    }

    @Test
    void eliminarLaImagenEnLaCopiaConservaRecursoYObjetoDeLaOriginal() throws Exception {
        Seeded src = seed(false);
        long cloneId = clone(src);
        long cloneImage = jdbc.queryForObject("select imagen_item_id from imagen_item where item_id = ?",
                Long.class, itemId(cloneId, "I1"));

        mvc.perform(delete("/items/images/{imageId}", cloneImage).header("Authorization", bearer(src.userId())))
                .andExpect(status().isOk());

        verify(storage, never()).deleteObject(anyString());
        assertThat(resourceExists(src.seed().recursoItemId())).isTrue();
        assertThat(count("select count(*) from imagen_item where item_id = ?", itemId(cloneId, "I1"))).isZero();
        assertThat(count("select count(*) from imagen_item where item_id = ?", itemId(src.sourceId(), "I1")))
                .isEqualTo(1);
    }

    @Test
    void eliminarLaUltimaReferenciaBorraRecursoYObjetoDespuesDelCommit() throws Exception {
        Seeded src = seed(false);
        long cloneId = clone(src);
        long resource = src.seed().recursoItemId();
        String path = jdbc.queryForObject("select ruta_almacenamiento from recurso_multimedia where recurso_id = ?",
                String.class, resource);
        long cloneImage = jdbc.queryForObject("select imagen_item_id from imagen_item where item_id = ?",
                Long.class, itemId(cloneId, "I1"));
        long sourceImage = jdbc.queryForObject("select imagen_item_id from imagen_item where item_id = ?",
                Long.class, itemId(src.sourceId(), "I1"));
        AtomicReference<Boolean> committedWhenDeleted = new AtomicReference<>();
        org.mockito.Mockito.doAnswer(inv -> {
            // Otra conexion: si el borrado ya esta confirmado, la fila no existe.
            committedWhenDeleted.set(!resourceExists(resource));
            return null;
        }).when(storage).deleteObject(anyString());

        mvc.perform(delete("/items/images/{imageId}", cloneImage).header("Authorization", bearer(src.userId())))
                .andExpect(status().isOk());
        verify(storage, never()).deleteObject(anyString());
        assertThat(resourceExists(resource)).isTrue();

        mvc.perform(delete("/items/images/{imageId}", sourceImage).header("Authorization", bearer(src.userId())))
                .andExpect(status().isOk());

        verify(storage, times(1)).deleteObject(path);
        assertThat(committedWhenDeleted.get()).as("el objeto se borra despues del commit").isTrue();
        assertThat(resourceExists(resource)).isFalse();
    }

    @Test
    void reemplazarLaUltimaReferenciaBorraElObjetoAnteriorDespuesDelCommit() throws Exception {
        Seeded src = seed(false);
        long resource = src.seed().recursoItemId();
        String path = jdbc.queryForObject("select ruta_almacenamiento from recurso_multimedia where recurso_id = ?",
                String.class, resource);
        long item = itemId(src.sourceId(), "I1");
        long image = jdbc.queryForObject("select imagen_item_id from imagen_item where item_id = ?", Long.class,
                item);
        AtomicReference<Boolean> committedWhenDeleted = new AtomicReference<>();
        org.mockito.Mockito.doAnswer(inv -> {
            committedWhenDeleted.set(!resourceExists(resource));
            return null;
        }).when(storage).deleteObject(anyString());

        mvc.perform(put(src.userId(), "/items/{itemId}/images/{imageId}", item, image, "otro.png", "image/png", "otro-item"))
                .andExpect(status().isOk());

        verify(storage, times(1)).deleteObject(path);
        assertThat(committedWhenDeleted.get()).isTrue();
        assertThat(resourceExists(resource)).isFalse();
    }

    /** La version origen se deja en BORRADOR: el contenido publicado es inmutable y no se podria limpiar al final. */
    private Seeded seed(boolean publish) {
        UUID userId = InstrumentVersionFixture.createUser(jdbc, "b9img");
        long testId = InstrumentVersionFixture.createTest(jdbc, "B9IMG");
        users.add(userId);
        tests.add(testId);
        return new TransactionTemplate(txManager).execute(status -> {
            long versionId = InstrumentVersionFixture.createDraftVersion(jdbc, testId, "1.0");
            InstrumentVersionFixture.Seed seed = InstrumentVersionFixture.seedFullContent(jdbc, versionId);
            if (publish) {
                InstrumentVersionFixture.publish(jdbc, versionId, userId);
            }
            fixtureResources.add(seed.recursoItemId());
            fixtureResources.add(seed.recursoOpcionId());
            return new Seeded(userId, versionId, seed);
        });
    }

    private long clone(Seeded src) throws Exception {
        String body = mvc.perform(post("/test-versions/{id}/clone", src.sourceId())
                .header("Authorization", bearer(src.userId()))
                .contentType(MediaType.APPLICATION_JSON).content("{\"versionNumber\":\"2.0\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode data = JSON.readTree(body).path("data");
        return data.path("id").asLong();
    }

    private org.springframework.test.web.servlet.request.MockMultipartHttpServletRequestBuilder put(UUID userId,
            String template, long ownerId, long imageId, String fileName, String mime, String content) {
        return multipart(template, ownerId, imageId)
                .file(new MockMultipartFile("file", fileName, mime, content.getBytes()))
                .contentType(MediaType.MULTIPART_FORM_DATA)
                .with(req -> {
                    req.setMethod("PUT");
                    return req;
                })
                .header("Authorization", bearer(userId));
    }

    private long itemId(long versionId, String code) {
        return jdbc.queryForObject("select i.item_id from item i join subtest s on s.subtest_id = i.subtest_id "
                + "where s.version_test_id = ? and i.codigo_item = ?", Long.class, versionId, code);
    }

    private long optionId(long versionId, String itemCode, String optionCode) {
        return jdbc.queryForObject("select o.opcion_id from opcion_item o join item i on i.item_id = o.item_id "
                + "join subtest s on s.subtest_id = i.subtest_id where s.version_test_id = ? and i.codigo_item = ? "
                + "and o.codigo_opcion = ?", Long.class, versionId, itemCode, optionCode);
    }

    private boolean resourceExists(long resourceId) {
        return count("select count(*) from recurso_multimedia where recurso_id = ?", resourceId) > 0;
    }

    private long count(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }

    private String bearer(UUID userId) {
        return "Bearer " + jwt.emitir(userId, "editor-b9img", Set.of("TEST_CREAR", "TEST_LEER"),
                Set.of("ROL_PRUEBA"));
    }
}

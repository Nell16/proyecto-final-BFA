package com.uam.psychoform.instrument.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.uam.psychoform.PsychoformApplication;
import com.uam.psychoform.security.service.JwtService;
import com.uam.psychoform.storage.ObjectStorageService;
import com.uam.psychoform.storage.StoredObject;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
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
 * B20: dos PUT simultaneos por ID sobre la misma imagen (de item o de opcion). La primera se retiene durante la subida
 * a storage con el bloqueo de la version tomado; la segunda espera ese bloqueo. Al liberarse debe operar sobre el estado
 * ya confirmado (no sobre el vinculo leido antes del bloqueo): nunca 404/409 por la carrera. No es transaccional: las
 * peticiones confirman de verdad.
 */
@SpringBootTest(classes = PsychoformApplication.class)
@AutoConfigureMockMvc
class ImageReplaceByIdRaceIntegrationTest {
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

    private record Scenario(UUID userId, long testId, long versionId, long subtestId, long itemId, long optionId,
            long itemImageId, long optionImageId) {
    }

    private record Result(int status, String body) {
    }

    @BeforeEach
    void seed() {
        reset(storage);
        scenario = new TransactionTemplate(txManager).execute(status -> {
            String suffix = UUID.randomUUID().toString().substring(0, 8);
            UUID userId = UUID.randomUUID();
            jdbc.update("insert into usuario (usuario_id, nombre_usuario, correo, hash_contrasena, nombre_completo) "
                    + "values (?, ?, ?, 'hash', 'Editor race id')", userId, "raceid_" + suffix,
                    "raceid_" + suffix + "@uam.edu");
            long testId = id("insert into test (codigo_test, nombre_test) values (?, ?) returning test_id",
                    "RID-" + suffix, "Test race id " + suffix);
            long versionId = id("insert into version_test (test_id, numero_version, estado) values (?, '1.0', "
                    + "'BORRADOR') returning version_test_id", testId);
            long subtestId = id("insert into subtest (version_test_id, codigo_subtest, nombre_subtest, numero_orden) "
                    + "values (?, 'SUB-1', 'Subtest 1', 1) returning subtest_id", versionId);
            long itemId = id("insert into item (subtest_id, codigo_item, tipo_item, tipo_respuesta, enunciado, "
                    + "numero_orden) values (?, 'IT-1', 'TEXTO_E_IMAGEN', 'OPCION_UNICA', 'Pregunta', 1) "
                    + "returning item_id", subtestId);
            long optionId = id("insert into opcion_item (item_id, codigo_opcion, texto_opcion, numero_orden) "
                    + "values (?, 'OPT-1', 'Opcion 1', 1) returning opcion_id", itemId);
            long itemImageId = id("insert into imagen_item (item_id, recurso_id, numero_orden) values (?, ?, 1) "
                    + "returning imagen_item_id", itemId, initialResource(userId, "item"));
            long optionImageId = id("insert into imagen_opcion (opcion_id, recurso_id, numero_orden) values (?, ?, 1) "
                    + "returning imagen_opcion_id", optionId, initialResource(userId, "opcion"));
            return new Scenario(userId, testId, versionId, subtestId, itemId, optionId, itemImageId, optionImageId);
        });
    }

    @AfterEach
    void cleanup() {
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
    void putPorIdDeItemConLaMismaClaveYElMismoArchivoDevuelveElMismoRecursoEnAmbas() throws Exception {
        sameKeySameFile(false);
    }

    @Test
    void putPorIdDeOpcionConLaMismaClaveYElMismoArchivoDevuelveElMismoRecursoEnAmbas() throws Exception {
        sameKeySameFile(true);
    }

    @Test
    void putPorIdDeItemSinClaveYArchivosDistintosDa200EnAmbasYQuedaElDeLaUltima() throws Exception {
        noKeyDifferentFiles(false);
    }

    @Test
    void putPorIdDeOpcionSinClaveYArchivosDistintosDa200EnAmbasYQuedaElDeLaUltima() throws Exception {
        noKeyDifferentFiles(true);
    }

    @Test
    void unaClaveSoloConEspaciosDa400EnLosPutPorId() throws Exception {
        for (String blank : new String[] { "   ", " " }) {
            Result item = put(false, new MockMultipartFile("file", "a.png", "image/png", "a".getBytes()), blank);
            Result option = put(true, new MockMultipartFile("file", "a.png", "image/png", "a".getBytes()), blank);
            assertThat(item.status()).as(item.body()).isEqualTo(400);
            assertThat(option.status()).as(option.body()).isEqualTo(400);
        }
        verify(storage, times(0)).putObject(anyString(), anyString(), any());
    }

    private void sameKeySameFile(boolean option) throws Exception {
        String key = "race-id-" + UUID.randomUUID();
        byte[] content = "mismo-archivo-concurrente".getBytes();
        Race race = new Race();
        race.stubStorage();

        Result[] results = race.run(
                () -> put(option, new MockMultipartFile("file", "c.png", "image/png", content), key),
                () -> put(option, new MockMultipartFile("file", "c.png", "image/png", content), key));

        assertThat(results[0].status()).as(results[0].body()).isEqualTo(200);
        assertThat(results[1].status()).as(results[1].body()).isEqualTo(200);
        JsonNode a = JSON.readTree(results[0].body()).path("data");
        JsonNode b = JSON.readTree(results[1].body()).path("data");
        assertThat(b.path("resourceId").asLong()).isEqualTo(a.path("resourceId").asLong());
        assertThat(b.path("imageLinkId").asLong()).isEqualTo(a.path("imageLinkId").asLong());
        assertThat(a.path("uploadKey").asText()).isEqualTo(key);
        assertThat(b.path("uploadKey").asText()).isEqualTo(key);
        // La segunda reutilizo el recurso ganador: una sola subida a storage y el vinculo apunta a ese recurso.
        verify(storage, times(1)).putObject(anyString(), anyString(), any());
        assertThat(linkedResourceId(option)).isEqualTo(a.path("resourceId").asLong());
    }

    private void noKeyDifferentFiles(boolean option) throws Exception {
        byte[] first = "archivo-primera-peticion".getBytes();
        byte[] last = "archivo-ultima-peticion".getBytes();
        Race race = new Race();
        race.stubStorage();

        Result[] results = race.run(
                () -> put(option, new MockMultipartFile("file", "p.png", "image/png", first), null),
                () -> put(option, new MockMultipartFile("file", "u.png", "image/png", last), null));

        assertThat(results[0].status()).as(results[0].body()).isEqualTo(200);
        assertThat(results[1].status()).as(results[1].body()).isEqualTo(200);
        // La segunda se serializo tras la primera: el vinculo conserva el archivo de la ultima peticion.
        String linkedHash = jdbc.queryForObject("select r.hash_integridad from recurso_multimedia r join "
                + (option ? "imagen_opcion l on l.recurso_id = r.recurso_id where l.imagen_opcion_id = ?"
                        : "imagen_item l on l.recurso_id = r.recurso_id where l.imagen_item_id = ?"),
                String.class, option ? scenario.optionImageId() : scenario.itemImageId());
        assertThat(linkedHash).isEqualTo(sha256(last));
        assertThat(JSON.readTree(results[1].body()).path("data").path("hash").asText()).isEqualTo(sha256(last));
        verify(storage, times(2)).putObject(anyString(), anyString(), any());
    }

    /**
     * Retiene la primera peticion dentro de storage.putObject (con el bloqueo de la version tomado), espera a que la
     * segunda este bloqueada en PostgreSQL esperandolo y entonces libera a la primera.
     */
    private final class Race {
        private final CountDownLatch firstInStorage = new CountDownLatch(1);
        private final CountDownLatch release = new CountDownLatch(1);
        private final AtomicInteger puts = new AtomicInteger();

        void stubStorage() {
            when(storage.putObject(anyString(), anyString(), any())).thenAnswer(inv -> {
                if (puts.incrementAndGet() == 1) {
                    firstInStorage.countDown();
                    if (!release.await(30, TimeUnit.SECONDS)) {
                        throw new IllegalStateException("la segunda peticion nunca llego a esperar el bloqueo");
                    }
                }
                return new StoredObject(inv.getArgument(0), "etag");
            });
        }

        Result[] run(Callable<Result> first, Callable<Result> second) throws Exception {
            ExecutorService pool = Executors.newFixedThreadPool(2);
            try {
                Future<Result> one = pool.submit(first);
                assertThat(firstInStorage.await(20, TimeUnit.SECONDS)).as("la primera llego a storage").isTrue();
                Future<Result> two = pool.submit(second);
                try {
                    awaitBlockedOnLock();
                } finally {
                    release.countDown();
                }
                return new Result[] { one.get(30, TimeUnit.SECONDS), two.get(30, TimeUnit.SECONDS) };
            } finally {
                release.countDown();
                pool.shutdownNow();
            }
        }

        private void awaitBlockedOnLock() throws InterruptedException {
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
            while (System.nanoTime() < deadline) {
                Long waiting = jdbc.queryForObject("select count(*) from pg_stat_activity "
                        + "where datname = current_database() and wait_event_type = 'Lock'", Long.class);
                if (waiting != null && waiting > 0) {
                    return;
                }
                Thread.sleep(50);
            }
            throw new IllegalStateException("la segunda peticion no se bloqueo esperando la version");
        }
    }

    private long linkedResourceId(boolean option) {
        return jdbc.queryForObject(option
                ? "select recurso_id from imagen_opcion where imagen_opcion_id = ?"
                : "select recurso_id from imagen_item where imagen_item_id = ?", Long.class,
                option ? scenario.optionImageId() : scenario.itemImageId());
    }

    private Result put(boolean option, MockMultipartFile file, String key) throws Exception {
        var request = option
                ? multipart("/options/{optionId}/images/{imageId}", scenario.optionId(), scenario.optionImageId())
                : multipart("/items/{itemId}/images/{imageId}", scenario.itemId(), scenario.itemImageId());
        request.file(file).contentType(MediaType.MULTIPART_FORM_DATA).with(req -> {
            req.setMethod("PUT");
            return req;
        }).header("Authorization", "Bearer " + jwt.emitir(scenario.userId(), "editor", Set.of("TEST_CREAR"),
                Set.of("PSICOLOGO_COORDINADOR")));
        if (key != null) {
            request.header("Idempotency-Key", key);
        }
        var response = mvc.perform(request).andReturn().getResponse();
        return new Result(response.getStatus(), response.getContentAsString());
    }

    private long initialResource(UUID userId, String scope) {
        return id("insert into recurso_multimedia (nombre_archivo, ruta_almacenamiento, tipo_mime, tamano_bytes, "
                + "hash_integridad, subido_por) values ('inicial.png', ?, 'image/png', 1, ?, ?) "
                + "returning recurso_id", "test-config/seed/" + scope + "/" + UUID.randomUUID(),
                "hash-inicial-" + UUID.randomUUID(), userId);
    }

    private long id(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }

    private static String sha256(byte[] bytes) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }
}

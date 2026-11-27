package com.uam.psychoform.instrument.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.uam.psychoform.PsychoformApplication;
import com.uam.psychoform.instrument.service.ImageUploadKeys;
import com.uam.psychoform.security.service.JwtService;
import com.uam.psychoform.storage.ObjectStorageService;
import com.uam.psychoform.storage.StoredObject;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * B8/B20: reintento concurrente con la misma Idempotency-Key. Ambas peticiones consultan antes de que exista la fila;
 * el indice unico deja pasar a una y la perdedora debe devolver el recurso ganador (mismo hash) o 409 (otro hash), y
 * borrar el objeto que habia subido. No es transaccional: las peticiones confirman de verdad.
 */
@SpringBootTest(classes = PsychoformApplication.class)
@AutoConfigureMockMvc
class ImageIdempotencyRaceIntegrationTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    @Autowired
    MockMvc mvc;

    @Autowired
    JwtService jwt;

    @Autowired
    JdbcTemplate jdbc;

    @MockitoBean
    ObjectStorageService storage;

    private UUID user;

    @BeforeEach
    void seed() {
        reset(storage);
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        user = UUID.randomUUID();
        jdbc.update("insert into usuario (usuario_id, nombre_usuario, correo, hash_contrasena, nombre_completo) "
                + "values (?, ?, ?, 'hash', 'Editor race')", user, "race_" + suffix, "race_" + suffix + "@uam.edu");
    }

    @AfterEach
    void cleanup() {
        jdbc.update("delete from recurso_multimedia where subido_por = ?", user);
        jdbc.update("delete from usuario where usuario_id = ?", user);
    }

    @Test
    void dosPeticionesSimultaneasConLaMismaClaveDevuelvenElMismoRecursoYElPerdedorBorraSuObjeto() throws Exception {
        String key = "race-" + UUID.randomUUID();
        byte[] content = "contenido-concurrente".getBytes();
        // Las dos suben a storage despues de consultar y antes de insertar: ambas pasan la consulta por clave.
        CyclicBarrier bothQueried = new CyclicBarrier(2);
        AtomicInteger puts = new AtomicInteger();
        when(storage.putObject(anyString(), anyString(), any())).thenAnswer(inv -> {
            if (puts.incrementAndGet() <= 2) {
                bothQueried.await(15, TimeUnit.SECONDS);
            }
            return new StoredObject(inv.getArgument(0), "etag");
        });

        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            List<Future<Result>> futures = new ArrayList<>();
            for (int i = 0; i < 2; i++) {
                Callable<Result> request = () -> upload(key, content);
                futures.add(pool.submit(request));
            }
            Result first = futures.get(0).get(30, TimeUnit.SECONDS);
            Result second = futures.get(1).get(30, TimeUnit.SECONDS);

            assertThat(first.status()).as(first.body()).isEqualTo(200);
            assertThat(second.status()).as(second.body()).isEqualTo(200);
            JsonNode a = JSON.readTree(first.body()).path("data");
            JsonNode b = JSON.readTree(second.body()).path("data");
            assertThat(a.path("resourceId").asLong()).isEqualTo(b.path("resourceId").asLong());
            assertThat(a.path("storagePath").asText()).isEqualTo(b.path("storagePath").asText());
            assertThat(a.path("uploadKey").asText()).isEqualTo(key);
            assertThat(b.path("uploadKey").asText()).isEqualTo(key);

            // Una sola fila; el objeto de la perdedora se borro y el de la ganadora se conserva.
            assertThat(count("select count(*) from recurso_multimedia where subido_por = ?", user)).isEqualTo(1);
            verify(storage, times(2)).putObject(anyString(), anyString(), any());
            ArgumentCaptor<String> deleted = ArgumentCaptor.forClass(String.class);
            verify(storage, times(1)).deleteObject(deleted.capture());
            assertThat(deleted.getValue()).isNotEqualTo(a.path("storagePath").asText());
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void siElGanadorTieneOtroHashElPerdedorRecibe409YBorraSuObjeto() throws Exception {
        String key = "race-" + UUID.randomUUID();
        String scoped = ImageUploadKeys.scoped(user, ImageUploadKeys.Operation.LOOSE, key);
        // Simula la carrera: entre la consulta y el insert otra peticion confirma un recurso con esa clave.
        when(storage.putObject(anyString(), anyString(), any())).thenAnswer(inv -> {
            insertWinner(3, "hash-de-otro-archivo", scoped);
            return new StoredObject(inv.getArgument(0), "etag");
        });

        Result loser = upload(key, "mi-archivo".getBytes());

        assertThat(loser.status()).as(loser.body()).isEqualTo(409);
        assertThat(count("select count(*) from recurso_multimedia where clave_subida = ?", scoped)).isEqualTo(1);
        verify(storage, atLeastOnce()).deleteObject(anyString());
        verify(storage, never()).deleteObject("test-config/resources/ganador.png");
    }

    @Test
    void siElGanadorTieneElMismoHashElPerdedorRecibeElRecursoConfirmado() throws Exception {
        String key = "race-" + UUID.randomUUID();
        byte[] content = "mismo-archivo".getBytes();
        String scoped = ImageUploadKeys.scoped(user, ImageUploadKeys.Operation.LOOSE, key);
        when(storage.putObject(anyString(), anyString(), any())).thenAnswer(inv -> {
            insertWinner(content.length, sha256(content), scoped);
            return new StoredObject(inv.getArgument(0), "etag");
        });

        Result loser = upload(key, content);

        assertThat(loser.status()).as(loser.body()).isEqualTo(200);
        JsonNode data = JSON.readTree(loser.body()).path("data");
        assertThat(data.path("storagePath").asText()).isEqualTo("test-config/resources/ganador.png");
        assertThat(data.path("uploadKey").asText()).isEqualTo(key);
        assertThat(data.path("resourceId").asLong()).isEqualTo(jdbc.queryForObject(
                "select recurso_id from recurso_multimedia where clave_subida = ?", Long.class, scoped));
        assertThat(count("select count(*) from recurso_multimedia where clave_subida = ?", scoped)).isEqualTo(1);
        verify(storage, never()).deleteObject("test-config/resources/ganador.png");
    }

    /**
     * Confirma la fila "ganadora" desde OTRO hilo, y por tanto otra conexion y otra transaccion: el hilo de la
     * peticion tiene una transaccion abierta y un insert en ella no seria una carrera.
     */
    private void insertWinner(long size, String hash, String scopedKey) throws Exception {
        java.util.concurrent.CompletableFuture.runAsync(() -> jdbc.update(
                "insert into recurso_multimedia (nombre_archivo, ruta_almacenamiento, tipo_mime, tamano_bytes, "
                        + "hash_integridad, clave_subida, subido_por) "
                        + "values ('ganador.png', 'test-config/resources/ganador.png', 'image/png', ?, ?, ?, ?)",
                size, hash, scopedKey, user)).get(15, TimeUnit.SECONDS);
    }

    private record Result(int status, String body) {
    }

    private Result upload(String key, byte[] content) throws Exception {
        var response = mvc.perform(multipart("/images/resources")
                .file(new MockMultipartFile("file", "concurrente.png", "image/png", content))
                .contentType(MediaType.MULTIPART_FORM_DATA)
                .header("Idempotency-Key", key)
                .header("Authorization", "Bearer " + jwt.emitir(user, "editor", Set.of("TEST_CREAR"),
                        Set.of("PSICOLOGO_COORDINADOR"))))
                .andReturn().getResponse();
        return new Result(response.getStatus(), response.getContentAsString());
    }

    private static String sha256(byte[] bytes) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }

    private long count(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }
}

package com.uam.psychoform.assessment.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.uam.psychoform.PsychoformApplication;
import com.uam.psychoform.security.service.JwtService;
import jakarta.persistence.EntityManagerFactory;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(classes = PsychoformApplication.class)
@AutoConfigureMockMvc
class SessionListFilterIntegrationTest {

    @Autowired
    MockMvc mvc;

    @Autowired
    JwtService jwt;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    PlatformTransactionManager txManager;

    @Autowired
    EntityManagerFactory emf;

    private SeededData seeded;

    private record SeededData(String tag, UUID userId, long test1Id, long test2Id, long version1Id, long version2Id,
            List<Long> sessionIds) {
    }

    @AfterEach
    void cleanup() {
        if (seeded == null) {
            return;
        }
        SeededData s = seeded;
        seeded = null;
        new TransactionTemplate(txManager).executeWithoutResult(status -> {
            jdbc.execute("set local session_replication_role = replica");
            for (Long sid : s.sessionIds()) {
                jdbc.update("delete from sesion_aplicacion where sesion_aplicacion_id = ?", sid);
            }
            jdbc.update("delete from version_test where version_test_id in (?, ?)", s.version1Id(), s.version2Id());
            jdbc.update("delete from test where test_id in (?, ?)", s.test1Id(), s.test2Id());
            jdbc.update("delete from usuario where usuario_id = ?", s.userId());
        });
    }

    @Test
    void withoutPageReturnsArrayWithFiltersAndDefaultOrder() throws Exception {
        seeded = seed();
        String auth = bearer();

        // Without page -> JSON array, filtered by q (case-insensitive) and ordered by inicioProgramado,desc
        mvc.perform(get("/sesiones")
                .param("q", seeded.tag().toLowerCase())
                .header("Authorization", auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data").isArray())
                .andExpect(jsonPath("$.data.length()").value(3))
                .andExpect(jsonPath("$.data[0].id").value(seeded.sessionIds().get(2)))
                .andExpect(jsonPath("$.data[1].id").value(seeded.sessionIds().get(1)))
                .andExpect(jsonPath("$.data[2].id").value(seeded.sessionIds().get(0)))
                .andExpect(jsonPath("$.data[0].versionTestId").value(seeded.version2Id()))
                .andExpect(jsonPath("$.data[0].testId").doesNotExist())
                .andExpect(jsonPath("$.data[0].subtests").doesNotExist());

        // Filter by estado
        mvc.perform(get("/sesiones")
                .param("q", seeded.tag())
                .param("estado", "ABIERTA")
                .header("Authorization", auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").isArray())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].id").value(seeded.sessionIds().get(1)));

        // Filter by versionTestId and testId
        mvc.perform(get("/sesiones")
                .param("q", seeded.tag())
                .param("versionTestId", String.valueOf(seeded.version1Id()))
                .header("Authorization", auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2));

        mvc.perform(get("/sesiones")
                .param("q", seeded.tag())
                .param("testId", String.valueOf(seeded.test2Id()))
                .header("Authorization", auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].id").value(seeded.sessionIds().get(2)));

        // Filter by date range from/to (date-only and ISO datetime)
        mvc.perform(get("/sesiones")
                .param("q", seeded.tag())
                .param("from", "2026-11-10")
                .param("to", "2026-11-15")
                .header("Authorization", auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].id").value(seeded.sessionIds().get(1)));
    }

    @Test
    void withPageReturnsPageResponseClampsSizeAndAvoidsNPlusOne() throws Exception {
        seeded = seed();
        String auth = bearer();

        Statistics stats = emf.unwrap(SessionFactory.class).getStatistics();
        stats.setStatisticsEnabled(true);
        stats.clear();
        try {
            mvc.perform(get("/sesiones")
                    .param("q", seeded.tag())
                    .param("page", "0")
                    .param("size", "2")
                    .param("sort", "codigoSesion,asc")
                    .header("Authorization", auth))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.data.content.length()").value(2))
                    .andExpect(jsonPath("$.data.number").value(0))
                    .andExpect(jsonPath("$.data.size").value(2))
                    .andExpect(jsonPath("$.data.totalElements").value(3))
                    .andExpect(jsonPath("$.data.totalPages").value(2))
                    .andExpect(jsonPath("$.data.first").value(true))
                    .andExpect(jsonPath("$.data.last").value(false))
                    .andExpect(jsonPath("$.data.content[0].id").value(seeded.sessionIds().get(0)))
                    .andExpect(jsonPath("$.data.content[1].id").value(seeded.sessionIds().get(1)));
            assertThat(stats.getPrepareStatementCount()).isLessThanOrEqualTo(2L);
        } finally {
            stats.setStatisticsEnabled(false);
        }

        // size=500 clamped to 100
        mvc.perform(get("/sesiones")
                .param("q", seeded.tag())
                .param("page", "0")
                .param("size", "500")
                .header("Authorization", auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.size").value(100))
                .andExpect(jsonPath("$.data.totalElements").value(3));
    }

    @Test
    void invalidSortEnumDateOrPaginationReturns400() throws Exception {
        String auth = bearer();

        mvc.perform(get("/sesiones").param("sort", "ubicacion,asc").header("Authorization", auth))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("BAD_REQUEST"));

        mvc.perform(get("/sesiones").param("estado", "DESCONOCIDO").header("Authorization", auth))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("BAD_REQUEST"));

        mvc.perform(get("/sesiones").param("from", "fecha-mala").header("Authorization", auth))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("BAD_REQUEST"));

        mvc.perform(get("/sesiones").param("page", "-1").header("Authorization", auth))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("BAD_REQUEST"));

        mvc.perform(get("/sesiones").param("page", "0").param("size", "0").header("Authorization", auth))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("BAD_REQUEST"));
    }

    private SeededData seed() {
        return new TransactionTemplate(txManager).execute(status -> {
            String tag = "SB10" + UUID.randomUUID().toString().replace("-", "").substring(0, 6).toUpperCase();
            UUID userId = jdbc.queryForObject(
                    "insert into usuario (nombre_usuario, correo, hash_contrasena, nombre_completo) "
                            + "values (?, ?, 'hash', 'User B10') returning usuario_id",
                    UUID.class, "usr-" + tag, "usr-" + tag + "@test.local");
            long estrategiaId = jdbc.queryForObject(
                    "select estrategia_calificacion_id from estrategia_calificacion limit 1", Long.class);
            long test1Id = jdbc.queryForObject(
                    "insert into test (codigo_test, nombre_test) values (?, ?) returning test_id",
                    Long.class, "T1-" + tag, "Test 1 " + tag);
            long test2Id = jdbc.queryForObject(
                    "insert into test (codigo_test, nombre_test) values (?, ?) returning test_id",
                    Long.class, "T2-" + tag, "Test 2 " + tag);
            long version1Id = jdbc.queryForObject(
                    "insert into version_test (test_id, estrategia_calificacion_id, numero_version, estado) "
                            + "values (?, ?, '1.0', 'BORRADOR') returning version_test_id",
                    Long.class, test1Id, estrategiaId);
            long version2Id = jdbc.queryForObject(
                    "insert into version_test (test_id, estrategia_calificacion_id, numero_version, estado) "
                            + "values (?, ?, '1.0', 'BORRADOR') returning version_test_id",
                    Long.class, test2Id, estrategiaId);
            jdbc.update(
                    "update version_test set estado = 'PUBLICADO', aprobado_por = ?, aprobado_en = now(), "
                            + "publicado_en = now() where version_test_id in (?, ?)",
                    userId, version1Id, version2Id);

            long s1 = insertSession(version1Id, tag + "-01", "Sesion Alpha " + tag,
                    LocalDateTime.of(2026, 11, 5, 9, 0), "PROGRAMADA", userId);
            long s2 = insertSession(version1Id, tag + "-02", "Sesion Beta " + tag,
                    LocalDateTime.of(2026, 11, 12, 14, 0), "ABIERTA", userId);
            long s3 = insertSession(version2Id, tag + "-03", "Sesion Gamma " + tag,
                    LocalDateTime.of(2026, 11, 20, 16, 0), "CERRADA", userId);

            return new SeededData(tag, userId, test1Id, test2Id, version1Id, version2Id, List.of(s1, s2, s3));
        });
    }

    private long insertSession(long versionId, String code, String name, LocalDateTime start, String estado,
            UUID userId) {
        return jdbc.queryForObject(
                "insert into sesion_aplicacion (version_test_id, codigo_sesion, nombre_sesion, inicio_programado, estado, creado_por) "
                        + "values (?, ?, ?, ?, cast(? as estado_sesion_aplicacion), ?) returning sesion_aplicacion_id",
                Long.class, versionId, code, name, Timestamp.valueOf(start), estado, userId);
    }

    private String bearer() {
        return "Bearer " + jwt.emitir(UUID.randomUUID(), "sup", Set.of("SESION_LEER"), Set.of("PSICOLOGO_COORDINADOR"));
    }
}

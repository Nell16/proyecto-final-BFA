package com.uam.psychoform.audit.controller;

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
class AuditListFilterIntegrationTest {

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

    private record SeededData(String tag, UUID user1Id, UUID user2Id, List<Long> auditIds) {
    }

    @AfterEach
    void cleanup() {
        if (seeded == null) {
            return;
        }
        SeededData s = seeded;
        seeded = null;
        new TransactionTemplate(txManager).executeWithoutResult(status -> {
            for (Long id : s.auditIds()) {
                jdbc.update("delete from auditoria where auditoria_id = ?", id);
            }
            jdbc.update("delete from usuario where usuario_id in (?, ?)", s.user1Id(), s.user2Id());
        });
    }

    @Test
    void withoutPageReturnsCompatibleArrayAndSupportsIndependentAndCombinedFilters() throws Exception {
        seeded = seed();
        String auth = bearer();

        // Independent entity filter + compatible shape with nested usuario (or null)
        mvc.perform(get("/auditoria")
                .param("entity", "entidad_a_" + seeded.tag())
                .header("Authorization", auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data").isArray())
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.data[0].id").value(seeded.auditIds().get(1)))
                .andExpect(jsonPath("$.data[0].usuario.id").value(seeded.user2Id().toString()))
                .andExpect(jsonPath("$.data[0].usuario.nombreUsuario").value("aud2_" + seeded.tag()))
                .andExpect(jsonPath("$.data[0].usuario.hashContrasena").doesNotExist())
                .andExpect(jsonPath("$.data[1].id").value(seeded.auditIds().get(0)))
                .andExpect(jsonPath("$.data[1].usuario.id").value(seeded.user1Id().toString()));

        // Independent entityId filter without entity
        mvc.perform(get("/auditoria")
                .param("entityId", "ENT-" + seeded.tag() + "-99")
                .header("Authorization", auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").isArray())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].id").value(seeded.auditIds().get(2)))
                .andExpect(jsonPath("$.data[0].usuario").isEmpty());

        // Independent action filter
        mvc.perform(get("/auditoria")
                .param("action", "ACT_B_" + seeded.tag())
                .header("Authorization", auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2));

        // Independent userId / actorId filter
        mvc.perform(get("/auditoria")
                .param("userId", seeded.user1Id().toString())
                .header("Authorization", auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].id").value(seeded.auditIds().get(0)));

        mvc.perform(get("/auditoria")
                .param("actorId", seeded.user2Id().toString())
                .header("Authorization", auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].id").value(seeded.auditIds().get(1)));

        // Date range + combined filters
        mvc.perform(get("/auditoria")
                .param("action", "ACT_B_" + seeded.tag())
                .param("from", "2026-10-15T00:00:00")
                .param("to", "2026-10-25T23:59:59Z")
                .header("Authorization", auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].id").value(seeded.auditIds().get(2)));
    }

    @Test
    void withPageReturnsPageResponseClampsSizeAndAvoidsNPlusOne() throws Exception {
        seeded = seed();
        String auth = bearer();

        Statistics stats = emf.unwrap(SessionFactory.class).getStatistics();
        stats.setStatisticsEnabled(true);
        stats.clear();
        try {
            mvc.perform(get("/auditoria")
                    .param("from", "2026-10-01")
                    .param("to", "2026-10-30")
                    .param("entity", "entidad_a_" + seeded.tag())
                    .param("page", "0")
                    .param("size", "1")
                    .header("Authorization", auth))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.data.content.length()").value(1))
                    .andExpect(jsonPath("$.data.number").value(0))
                    .andExpect(jsonPath("$.data.size").value(1))
                    .andExpect(jsonPath("$.data.totalElements").value(2))
                    .andExpect(jsonPath("$.data.totalPages").value(2))
                    .andExpect(jsonPath("$.data.first").value(true))
                    .andExpect(jsonPath("$.data.last").value(false))
                    .andExpect(jsonPath("$.data.content[0].id").value(seeded.auditIds().get(1)));
            assertThat(stats.getPrepareStatementCount()).isLessThanOrEqualTo(2L);
        } finally {
            stats.setStatisticsEnabled(false);
        }

        // size=500 clamped to 100
        mvc.perform(get("/auditoria")
                .param("entity", "entidad_a_" + seeded.tag())
                .param("page", "0")
                .param("size", "500")
                .header("Authorization", auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.size").value(100))
                .andExpect(jsonPath("$.data.totalElements").value(2));
    }

    @Test
    void invalidSortUuidDatesOrPaginationReturns400() throws Exception {
        String auth = bearer();

        mvc.perform(get("/auditoria").param("sort", "valorNuevo,desc").header("Authorization", auth))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("BAD_REQUEST"));

        mvc.perform(get("/auditoria").param("userId", "no-es-uuid").header("Authorization", auth))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("BAD_REQUEST"));

        mvc.perform(get("/auditoria")
                .param("userId", UUID.randomUUID().toString())
                .param("actorId", UUID.randomUUID().toString())
                .header("Authorization", auth))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("BAD_REQUEST"));

        mvc.perform(get("/auditoria").param("to", "bad-date").header("Authorization", auth))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("BAD_REQUEST"));

        mvc.perform(get("/auditoria").param("page", "-1").header("Authorization", auth))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("BAD_REQUEST"));

        mvc.perform(get("/auditoria").param("page", "0").param("size", "0").header("Authorization", auth))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("BAD_REQUEST"));
    }

    private SeededData seed() {
        return new TransactionTemplate(txManager).execute(status -> {
            String tag = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
            UUID u1 = insertUser("aud1_" + tag, "Auditor Uno");
            UUID u2 = insertUser("aud2_" + tag, "Auditor Dos");

            long a1 = insertAudit(u1, "ACT_A_" + tag, "entidad_a_" + tag, "ENT-" + tag + "-1",
                    LocalDateTime.of(2026, 10, 5, 10, 0));
            long a2 = insertAudit(u2, "ACT_B_" + tag, "entidad_a_" + tag, "ENT-" + tag + "-2",
                    LocalDateTime.of(2026, 10, 10, 12, 0));
            long a3 = insertAudit(null, "ACT_B_" + tag, "entidad_b_" + tag, "ENT-" + tag + "-99",
                    LocalDateTime.of(2026, 10, 20, 15, 0));

            return new SeededData(tag, u1, u2, List.of(a1, a2, a3));
        });
    }

    private UUID insertUser(String username, String fullName) {
        return jdbc.queryForObject(
                "insert into usuario (nombre_usuario, correo, hash_contrasena, nombre_completo) "
                        + "values (?, ?, 'hash', ?) returning usuario_id",
                UUID.class, username, username + "@test.local", fullName);
    }

    private long insertAudit(UUID userId, String action, String entity, String entityId, LocalDateTime createdAt) {
        return jdbc.queryForObject(
                "insert into auditoria (usuario_id, accion, entidad, entidad_id, valor_nuevo, direccion_ip, creado_en) "
                        + "values (?, ?, ?, ?, '{\"ok\":true}'::jsonb, '127.0.0.1', ?) returning auditoria_id",
                Long.class, userId, action, entity, entityId, Timestamp.valueOf(createdAt));
    }

    private String bearer() {
        return "Bearer " + jwt.emitir(UUID.randomUUID(), "admin", Set.of("AUDITORIA_VER"), Set.of("ADMINISTRADOR"));
    }
}

package com.uam.psychoform.academic.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.uam.psychoform.PsychoformApplication;
import com.uam.psychoform.security.service.JwtService;
import jakarta.persistence.EntityManagerFactory;
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
class ParticipantFilterPaginationIntegrationTest {

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

    private record Catalogs(short sexo1, short sexo2, short carrera1, short carrera2, short cohorte1, short cohorte2,
            short grupo1, short grupo2) {
    }

    private record SeededData(String tag, Catalogs catalogs, List<UUID> participantIds) {
    }

    @AfterEach
    void cleanup() {
        if (seeded == null) {
            return;
        }
        SeededData s = seeded;
        seeded = null;
        new TransactionTemplate(txManager).executeWithoutResult(status -> {
            for (UUID id : s.participantIds()) {
                jdbc.update("delete from participante where participante_id = ?", id);
            }
            jdbc.update("delete from grupo_academico where grupo_academico_id in (?, ?)",
                    s.catalogs().grupo1(), s.catalogs().grupo2());
            jdbc.update("delete from cohorte where cohorte_id in (?, ?)",
                    s.catalogs().cohorte1(), s.catalogs().cohorte2());
            jdbc.update("delete from carrera where carrera_id in (?, ?)",
                    s.catalogs().carrera1(), s.catalogs().carrera2());
            jdbc.update("delete from catalogo_sexo where sexo_id in (?, ?)",
                    s.catalogs().sexo1(), s.catalogs().sexo2());
        });
    }

    @Test
    void filtersIndividuallyCombinedCaseInsensitiveAndClampsSizeWithoutNPlusOne() throws Exception {
        seeded = seed();
        String auth = bearer();

        // q case-insensitive over codigo, nombres, apellidos (using tag prefix to isolate from any other rows)
        mvc.perform(get("/participantes")
                .param("q", seeded.tag().toLowerCase())
                .header("Authorization", auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalElements").value(4))
                .andExpect(jsonPath("$.data.content[0].apellidos").value("Alvarez " + seeded.tag()))
                .andExpect(jsonPath("$.data.content[1].apellidos").value("Benitez " + seeded.tag()))
                .andExpect(jsonPath("$.data.content[2].apellidos").value("Castro " + seeded.tag()))
                .andExpect(jsonPath("$.data.content[3].apellidos").value("Zamora " + seeded.tag()));

        // q matching nombres ignoring case
        mvc.perform(get("/participantes")
                .param("q", "mArIa")
                .param("carreraId", String.valueOf(seeded.catalogs().carrera1()))
                .header("Authorization", auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalElements").value(1))
                .andExpect(jsonPath("$.data.content[0].codigoParticipante").value("B10-" + seeded.tag() + "-2"));

        // estado filter
        mvc.perform(get("/participantes")
                .param("q", seeded.tag())
                .param("estado", "INACTIVO")
                .header("Authorization", auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalElements").value(1))
                .andExpect(jsonPath("$.data.content[0].codigoParticipante").value("B10-" + seeded.tag() + "-4"));

        // individual catalog filters: sexoId, cohorteId, grupoAcademicoId
        mvc.perform(get("/participantes")
                .param("q", seeded.tag())
                .param("sexoId", String.valueOf(seeded.catalogs().sexo2()))
                .header("Authorization", auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalElements").value(2));

        mvc.perform(get("/participantes")
                .param("q", seeded.tag())
                .param("cohorteId", String.valueOf(seeded.catalogs().cohorte2()))
                .header("Authorization", auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalElements").value(2));

        mvc.perform(get("/participantes")
                .param("q", seeded.tag())
                .param("grupoAcademicoId", String.valueOf(seeded.catalogs().grupo1()))
                .header("Authorization", auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalElements").value(2));

        // combined filters
        mvc.perform(get("/participantes")
                .param("q", seeded.tag())
                .param("estado", "ACTIVO")
                .param("sexoId", String.valueOf(seeded.catalogs().sexo1()))
                .param("carreraId", String.valueOf(seeded.catalogs().carrera1()))
                .param("cohorteId", String.valueOf(seeded.catalogs().cohorte1()))
                .param("grupoAcademicoId", String.valueOf(seeded.catalogs().grupo1()))
                .header("Authorization", auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalElements").value(1))
                .andExpect(jsonPath("$.data.content[0].codigoParticipante").value("B10-" + seeded.tag() + "-1"));

        // custom sort + pagination + no N+1
        Statistics stats = emf.unwrap(SessionFactory.class).getStatistics();
        stats.setStatisticsEnabled(true);
        stats.clear();
        try {
            mvc.perform(get("/participantes")
                    .param("q", seeded.tag())
                    .param("page", "0")
                    .param("size", "2")
                    .param("sort", "codigoParticipante,desc")
                    .header("Authorization", auth))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.data.totalElements").value(4))
                    .andExpect(jsonPath("$.data.totalPages").value(2))
                    .andExpect(jsonPath("$.data.content[0].codigoParticipante").value("B10-" + seeded.tag() + "-4"))
                    .andExpect(jsonPath("$.data.content[1].codigoParticipante").value("B10-" + seeded.tag() + "-3"));
            assertThat(stats.getPrepareStatementCount()).isLessThanOrEqualTo(2L);
        } finally {
            stats.setStatisticsEnabled(false);
        }

        // size=500 clamped to 100
        mvc.perform(get("/participantes")
                .param("q", seeded.tag())
                .param("size", "500")
                .header("Authorization", auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.size").value(100));
    }

    @Test
    void invalidSortOrEnumReturns400() throws Exception {
        String auth = bearer();

        mvc.perform(get("/participantes")
                .param("sort", "correo,asc")
                .header("Authorization", auth))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("BAD_REQUEST"));

        mvc.perform(get("/participantes")
                .param("estado", "BLOQUEADO")
                .header("Authorization", auth))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("BAD_REQUEST"));
    }

    private SeededData seed() {
        return new TransactionTemplate(txManager).execute(status -> {
            String tag = "T" + UUID.randomUUID().toString().replace("-", "").substring(0, 8).toUpperCase();
            short sexo1 = jdbc.queryForObject(
                    "insert into catalogo_sexo (codigo, nombre, estado) values (?, ?, 'ACTIVO') returning sexo_id",
                    Short.class, "S1-" + tag, "Sexo 1 " + tag);
            short sexo2 = jdbc.queryForObject(
                    "insert into catalogo_sexo (codigo, nombre, estado) values (?, ?, 'ACTIVO') returning sexo_id",
                    Short.class, "S2-" + tag, "Sexo 2 " + tag);
            short carrera1 = jdbc.queryForObject(
                    "insert into carrera (codigo_carrera, nombre_carrera, estado) values (?, ?, 'ACTIVO') returning carrera_id",
                    Short.class, "C1-" + tag, "Carrera 1 " + tag);
            short carrera2 = jdbc.queryForObject(
                    "insert into carrera (codigo_carrera, nombre_carrera, estado) values (?, ?, 'ACTIVO') returning carrera_id",
                    Short.class, "C2-" + tag, "Carrera 2 " + tag);
            short cohorte1 = jdbc.queryForObject(
                    "insert into cohorte (codigo_cohorte, nombre_cohorte, estado) values (?, ?, 'ACTIVO') returning cohorte_id",
                    Short.class, "H1-" + tag, "Cohorte 1 " + tag);
            short cohorte2 = jdbc.queryForObject(
                    "insert into cohorte (codigo_cohorte, nombre_cohorte, estado) values (?, ?, 'ACTIVO') returning cohorte_id",
                    Short.class, "H2-" + tag, "Cohorte 2 " + tag);
            short grupo1 = jdbc.queryForObject(
                    "insert into grupo_academico (carrera_id, codigo_grupo, nombre_grupo, estado) values (?, ?, ?, 'ACTIVO') returning grupo_academico_id",
                    Short.class, carrera1, "G1-" + tag, "Grupo 1 " + tag);
            short grupo2 = jdbc.queryForObject(
                    "insert into grupo_academico (carrera_id, codigo_grupo, nombre_grupo, estado) values (?, ?, ?, 'ACTIVO') returning grupo_academico_id",
                    Short.class, carrera2, "G2-" + tag, "Grupo 2 " + tag);

            UUID p1 = insertParticipant("B10-" + tag + "-1", "Carlos", "Benitez " + tag, sexo1, carrera1, cohorte1,
                    grupo1, "ACTIVO");
            UUID p2 = insertParticipant("B10-" + tag + "-2", "Maria", "Alvarez " + tag, sexo2, carrera1, cohorte1,
                    grupo1, "ACTIVO");
            UUID p3 = insertParticipant("B10-" + tag + "-3", "Luis", "Zamora " + tag, sexo1, carrera2, cohorte2,
                    grupo2, "ACTIVO");
            UUID p4 = insertParticipant("B10-" + tag + "-4", "Elena", "Castro " + tag, sexo2, carrera2, cohorte2,
                    grupo2, "INACTIVO");

            return new SeededData(
                    tag,
                    new Catalogs(sexo1, sexo2, carrera1, carrera2, cohorte1, cohorte2, grupo1, grupo2),
                    List.of(p1, p2, p3, p4));
        });
    }

    private UUID insertParticipant(String code, String nombres, String apellidos, short sexoId, short carreraId,
            short cohorteId, short grupoId, String estado) {
        UUID id = UUID.randomUUID();
        jdbc.update(
                "insert into participante (participante_id, codigo_participante, nombres, apellidos, "
                        + "sexo_id, carrera_id, cohorte_id, grupo_academico_id, estado) "
                        + "values (?, ?, ?, ?, ?, ?, ?, ?, cast(? as estado_general))",
                id, code, nombres, apellidos, sexoId, carreraId, cohorteId, grupoId, estado);
        return id;
    }

    private String bearer() {
        return "Bearer " + jwt.emitir(UUID.randomUUID(), "coord", Set.of("PARTICIPANTE_LEER"), Set.of("APLICADOR"));
    }
}

package com.uam.psychoform.academic.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.uam.psychoform.PsychoformApplication;
import com.uam.psychoform.academic.dto.ParticipantRequest;
import com.uam.psychoform.academic.dto.ParticipantUpdateRequest;
import com.uam.psychoform.security.service.JwtService;
import java.time.LocalDate;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(classes = PsychoformApplication.class)
@AutoConfigureMockMvc
class ParticipantUpdateIntegrationTest {
    private static final ObjectMapper JSON = new ObjectMapper().registerModule(new JavaTimeModule());

    @Autowired
    private MockMvc mvc;

    @Autowired
    private JwtService jwt;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private PlatformTransactionManager txManager;

    private SeededData seeded;

    private record CatalogIds(short sexoId, short carreraId, short cohorteId, short grupoId) {
    }

    private record SeededData(UUID participantId, String code, CatalogIds initialCatalogs, CatalogIds updatedCatalogs) {
    }

    @AfterEach
    void cleanup() {
        if (seeded == null) {
            return;
        }
        SeededData data = seeded;
        new TransactionTemplate(txManager).executeWithoutResult(status -> {
            jdbc.update("delete from participante where participante_id = ?", data.participantId());
            deleteCatalogs(data.initialCatalogs());
            deleteCatalogs(data.updatedCatalogs());
        });
    }

    private void deleteCatalogs(CatalogIds catalogs) {
        jdbc.update("delete from grupo_academico where grupo_academico_id = ?", catalogs.grupoId());
        jdbc.update("delete from cohorte where cohorte_id = ?", catalogs.cohorteId());
        jdbc.update("delete from carrera where carrera_id = ?", catalogs.carreraId());
        jdbc.update("delete from catalogo_sexo where sexo_id = ?", catalogs.sexoId());
    }

    @Test
    void validUpdateWithPermissionChangesFieldsAndKeepsCode() throws Exception {
        seeded = seed();
        var payload = new ParticipantUpdateRequest(
                null,
                "María Elena",
                "Gómez Ruiz",
                LocalDate.of(2002, 5, 14),
                seeded.updatedCatalogs().sexoId(),
                seeded.updatedCatalogs().carreraId(),
                seeded.updatedCatalogs().cohorteId(),
                seeded.updatedCatalogs().grupoId());

        mvc.perform(put("/participantes/{id}", seeded.participantId())
                .header("Authorization", bearer("APLICADOR", Set.of("PARTICIPANTE_MODIFICAR")))
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(payload)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.id").value(seeded.participantId().toString()))
                .andExpect(jsonPath("$.data.codigoParticipante").value(seeded.code()))
                .andExpect(jsonPath("$.data.nombres").value("María Elena"))
                .andExpect(jsonPath("$.data.apellidos").value("Gómez Ruiz"))
                .andExpect(jsonPath("$.data.fechaNacimiento").value("2002-05-14"))
                .andExpect(jsonPath("$.data.sexoId").value((int) seeded.updatedCatalogs().sexoId()))
                .andExpect(jsonPath("$.data.carreraId").value((int) seeded.updatedCatalogs().carreraId()))
                .andExpect(jsonPath("$.data.cohorteId").value((int) seeded.updatedCatalogs().cohorteId()))
                .andExpect(jsonPath("$.data.grupoAcademicoId").value((int) seeded.updatedCatalogs().grupoId()))
                .andExpect(jsonPath("$.data.estado").value("ACTIVO"))
                .andExpect(jsonPath("$.data.actualizadoEn").isNotEmpty());

        var row = jdbc.queryForMap(
                "select codigo_participante, nombres, apellidos, fecha_nacimiento, sexo_id, carrera_id, cohorte_id, grupo_academico_id "
                        + "from participante where participante_id = ?",
                seeded.participantId());
        assertThat(row.get("codigo_participante")).isEqualTo(seeded.code());
        assertThat(row.get("nombres")).isEqualTo("María Elena");
        assertThat(row.get("apellidos")).isEqualTo("Gómez Ruiz");
        assertThat(((Number) row.get("sexo_id")).shortValue()).isEqualTo(seeded.updatedCatalogs().sexoId());
        assertThat(((Number) row.get("carrera_id")).shortValue()).isEqualTo(seeded.updatedCatalogs().carreraId());
        assertThat(((Number) row.get("cohorte_id")).shortValue()).isEqualTo(seeded.updatedCatalogs().cohorteId());
        assertThat(((Number) row.get("grupo_academico_id")).shortValue()).isEqualTo(seeded.updatedCatalogs().grupoId());
    }

    @Test
    void sameCodeInBodyIsAccepted() throws Exception {
        seeded = seed();
        var payload = new ParticipantUpdateRequest(
                seeded.code(),
                "Ana Sofía",
                "Pérez",
                null,
                null,
                null,
                null,
                null);

        mvc.perform(put("/participantes/{id}", seeded.participantId())
                .header("Authorization", bearer("ADMINISTRADOR", Set.of("PARTICIPANTE_MODIFICAR")))
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(payload)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.codigoParticipante").value(seeded.code()))
                .andExpect(jsonPath("$.data.nombres").value("Ana Sofía"));
    }

    @Test
    void distinctCodeReturns400AndDoesNotModifyParticipant() throws Exception {
        seeded = seed();
        var payload = new ParticipantUpdateRequest(
                "OTRO-COD",
                "Nuevo Nombre",
                "Nuevo Apellido",
                null,
                null,
                null,
                null,
                null);

        mvc.perform(put("/participantes/{id}", seeded.participantId())
                .header("Authorization", bearer("APLICADOR", Set.of("PARTICIPANTE_MODIFICAR")))
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(payload)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error.code").value("BAD_REQUEST"));

        String persistedName = jdbc.queryForObject(
                "select nombres from participante where participante_id = ?",
                String.class,
                seeded.participantId());
        assertThat(persistedName).isEqualTo("Nombre Inicial");
    }

    @Test
    void blankRequiredFieldsReturn400ValidationError() throws Exception {
        seeded = seed();
        var payload = new ParticipantUpdateRequest(
                null,
                "   ",
                "",
                null,
                null,
                null,
                null,
                null);

        mvc.perform(put("/participantes/{id}", seeded.participantId())
                .header("Authorization", bearer("APLICADOR", Set.of("PARTICIPANTE_MODIFICAR")))
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(payload)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));
    }

    @Test
    void missingParticipantReturns404() throws Exception {
        var payload = new ParticipantUpdateRequest(
                null,
                "Nombre",
                "Apellido",
                null,
                null,
                null,
                null,
                null);

        mvc.perform(put("/participantes/{id}", UUID.randomUUID())
                .header("Authorization", bearer("APLICADOR", Set.of("PARTICIPANTE_MODIFICAR")))
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(payload)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error.code").value("NOT_FOUND"));
    }

    @Test
    void nonexistentCatalogMatchesCreationStatus() throws Exception {
        seeded = seed();
        short nonexistentSexoId = 32000;

        var createRequest = new ParticipantRequest(
                "P-NEW-" + UUID.randomUUID().toString().substring(0, 8),
                "Nombre",
                "Apellido",
                null,
                nonexistentSexoId,
                null,
                null,
                null);
        MvcResult createResult = mvc.perform(post("/participantes")
                .header("Authorization", bearer("APLICADOR", Set.of("PARTICIPANTE_CREAR")))
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(createRequest)))
                .andReturn();

        var updateRequest = new ParticipantUpdateRequest(
                null,
                "Nombre",
                "Apellido",
                null,
                nonexistentSexoId,
                null,
                null,
                null);
        MvcResult updateResult = mvc.perform(put("/participantes/{id}", seeded.participantId())
                .header("Authorization", bearer("APLICADOR", Set.of("PARTICIPANTE_MODIFICAR")))
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(updateRequest)))
                .andReturn();

        assertThat(createResult.getResponse().getStatus()).isEqualTo(409);
        assertThat(updateResult.getResponse().getStatus()).isEqualTo(createResult.getResponse().getStatus());
        assertThat(JSON.readTree(updateResult.getResponse().getContentAsString()).path("error").path("code").asText())
                .isEqualTo(JSON.readTree(createResult.getResponse().getContentAsString()).path("error").path("code").asText());
    }

    @Test
    void withoutModifyPermissionReturns403AndUnauthenticatedReturns401() throws Exception {
        seeded = seed();
        String body = JSON.writeValueAsString(new ParticipantUpdateRequest(
                null,
                "Nombre",
                "Apellido",
                null,
                null,
                null,
                null,
                null));

        mvc.perform(put("/participantes/{id}", seeded.participantId())
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));

        mvc.perform(put("/participantes/{id}", seeded.participantId())
                .header("Authorization", bearer("CONSULTOR_REPORTES", Set.of("PARTICIPANTE_LEER", "RESULTADO_VER")))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));

        mvc.perform(put("/participantes/{id}", seeded.participantId())
                .header("Authorization", bearer("OTRO", Set.of("PARTICIPANTE_CREAR")))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    private SeededData seed() {
        return new TransactionTemplate(txManager).execute(status -> {
            CatalogIds initial = insertCatalogs("A");
            CatalogIds updated = insertCatalogs("B");
            UUID participantId = UUID.randomUUID();
            String code = "PB16-" + participantId.toString().substring(0, 8);
            jdbc.update(
                    "insert into participante (participante_id, codigo_participante, nombres, apellidos, fecha_nacimiento, "
                            + "sexo_id, carrera_id, cohorte_id, grupo_academico_id, estado) "
                            + "values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVO')",
                    participantId,
                    code,
                    "Nombre Inicial",
                    "Apellido Inicial",
                    LocalDate.of(2000, 1, 10),
                    initial.sexoId(),
                    initial.carreraId(),
                    initial.cohorteId(),
                    initial.grupoId());
            return new SeededData(participantId, code, initial, updated);
        });
    }

    private CatalogIds insertCatalogs(String tag) {
        String suffix = tag + UUID.randomUUID().toString().substring(0, 6);
        short sexoId = jdbc.queryForObject(
                "insert into catalogo_sexo (codigo, nombre, estado) values (?, ?, 'ACTIVO') returning sexo_id",
                Short.class,
                "SX-" + suffix,
                "Sexo " + suffix);
        short carreraId = jdbc.queryForObject(
                "insert into carrera (codigo_carrera, nombre_carrera, estado) values (?, ?, 'ACTIVO') returning carrera_id",
                Short.class,
                "CR-" + suffix,
                "Carrera " + suffix);
        short cohorteId = jdbc.queryForObject(
                "insert into cohorte (codigo_cohorte, nombre_cohorte, estado) values (?, ?, 'ACTIVO') returning cohorte_id",
                Short.class,
                "CH-" + suffix,
                "Cohorte " + suffix);
        short grupoId = jdbc.queryForObject(
                "insert into grupo_academico (carrera_id, codigo_grupo, nombre_grupo, estado) "
                        + "values (?, ?, ?, 'ACTIVO') returning grupo_academico_id",
                Short.class,
                carreraId,
                "GR-" + suffix,
                "Grupo " + suffix);
        return new CatalogIds(sexoId, carreraId, cohorteId, grupoId);
    }

    private String bearer(String role, Set<String> permissions) {
        return "Bearer " + jwt.emitir(UUID.randomUUID(), "usuario", permissions, Set.of(role));
    }
}

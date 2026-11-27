package com.uam.psychoform.assessment.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.uam.psychoform.academic.model.Participante;
import com.uam.psychoform.assessment.model.AsignacionTest;
import com.uam.psychoform.assessment.model.EstadoAsignacion;
import com.uam.psychoform.assessment.model.EstadoSesionAplicacion;
import com.uam.psychoform.assessment.model.SesionAplicacion;
import com.uam.psychoform.assessment.repository.AsignacionTestRepository;
import com.uam.psychoform.assessment.service.ParticipantAccessService;
import com.uam.psychoform.assessment.service.ParticipantAccessService.ParticipantAccess;
import com.uam.psychoform.assessment.service.ParticipantAnswerService;
import com.uam.psychoform.assessment.service.ParticipantEvaluationView;
import com.uam.psychoform.assessment.service.ParticipantJwtService;
import com.uam.psychoform.assessment.service.ParticipantRuntimeService;
import com.uam.psychoform.assessment.service.SubtestTimingService;
import com.uam.psychoform.controller.GlobalExceptionHandler;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/** B21: lectura del estado final de una asignacion COMPLETADO. */
class ParticipantRuntimeCompletadoWebTest {
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-06-24T12:00:00Z"), ZoneOffset.UTC);

    private MockMvc mvc(EstadoAsignacion estadoAsignacion, EstadoSesionAplicacion estadoSesion,
            LocalDateTime tokenExpiraEn) {
        UUID participantId = UUID.randomUUID();
        Participante participante = new Participante();
        participante.setId(participantId);
        SesionAplicacion sesion = new SesionAplicacion();
        sesion.setId(10L);
        sesion.setEstado(estadoSesion);
        AsignacionTest asignacion = new AsignacionTest();
        asignacion.setId(77L);
        asignacion.setParticipante(participante);
        asignacion.setSesionAplicacion(sesion);
        asignacion.setEstado(estadoAsignacion);
        asignacion.setTokenExpiraEn(tokenExpiraEn);
        AsignacionTestRepository asignaciones = mock(AsignacionTestRepository.class);
        when(asignaciones.findByIdForUpdate(77L)).thenReturn(Optional.of(asignacion));

        ParticipantJwtService jwt = mock(ParticipantJwtService.class);
        when(jwt.requireAccess(any())).thenReturn(new ParticipantAccess(77L, participantId));
        var access = new ParticipantAccessService(asignaciones, null, null, null, CLOCK);
        ParticipantEvaluationView evaluation = mock(ParticipantEvaluationView.class);
        when(evaluation.getEvaluationPayload(77L)).thenReturn(new ParticipantEvaluationView.EvaluationPayload(
                5L, 77L, 10L, "Ana", "Sesion", estadoSesion.name(), null, "COMPLETADO", List.of(),
                java.time.OffsetDateTime.parse("2026-06-24T11:58:00Z")));
        var controller = new ParticipantRuntimeController(jwt, mock(ParticipantRuntimeService.class), access,
                mock(ParticipantAnswerService.class), evaluation, mock(SubtestTimingService.class));
        return MockMvcBuilders.standaloneSetup(controller).setControllerAdvice(new GlobalExceptionHandler()).build();
    }

    private MockMvc mvc(EstadoAsignacion estadoAsignacion, EstadoSesionAplicacion estadoSesion) {
        return mvc(estadoAsignacion, estadoSesion, LocalDateTime.now(CLOCK).plusHours(1));
    }

    @Test
    void yoConAsignacionCompletadaResponde200ConEstadoFinal() throws Exception {
        mvc(EstadoAsignacion.COMPLETADO, EstadoSesionAplicacion.ABIERTA)
                .perform(get("/evaluacion-participante/yo")).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.attemptStatus").value("COMPLETADO"))
                .andExpect(jsonPath("$.data.finishedAt").value("2026-06-24T11:58:00Z"));
    }

    @Test
    void yoConAsignacionCompletadaYSesionCerradaOCanceladaResponde200() throws Exception {
        for (var estado : List.of(EstadoSesionAplicacion.CERRADA, EstadoSesionAplicacion.CANCELADA)) {
            mvc(EstadoAsignacion.COMPLETADO, estado).perform(get("/evaluacion-participante/yo"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.data.attemptStatus").value("COMPLETADO"));
        }
    }

    @Test
    void yoConSesionCerradaYAsignacionNoCompletadaSigueEn409SesionFinalizada() throws Exception {
        mvc(EstadoAsignacion.EN_PROGRESO, EstadoSesionAplicacion.CERRADA).perform(get("/evaluacion-participante/yo"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("SESION_FINALIZADA"));
    }

    @Test
    void escriturasConAsignacionCompletadaResponden409AsignacionNoOperable() throws Exception {
        MockMvc mvc = mvc(EstadoAsignacion.COMPLETADO, EstadoSesionAplicacion.ABIERTA);
        String json = MediaType.APPLICATION_JSON_VALUE;
        var requests = List.of(
                post("/evaluacion-participante/iniciar").contentType(json).content("{\"assignmentId\":77}"),
                post("/intentos/1/subtests/2/iniciar"),
                put("/intentos/1/items/3/respuesta").contentType(json).content("{\"itemId\":3}"),
                post("/intentos/1/respuestas/bulk-sync").contentType(json).content("[{\"itemId\":3}]"),
                post("/intentos/1/subtests/2/finalizar").contentType(json).content("{\"timeSeconds\":5}"),
                post("/intentos/1/finalizar").contentType(json).content("{\"timeSeconds\":5}"));
        for (var request : requests) {
            mvc.perform(request).andExpect(status().isConflict())
                    .andExpect(jsonPath("$.error.code").value("ASIGNACION_NO_OPERABLE"));
        }
    }

    @Test
    void itemsDeUnIntentoCompletadoSiguenEn409AsignacionNoOperable() throws Exception {
        mvc(EstadoAsignacion.COMPLETADO, EstadoSesionAplicacion.ABIERTA)
                .perform(get("/intentos/1/subtests/2/items")).andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("ASIGNACION_NO_OPERABLE"));
    }

    @Test
    void yoConAsignacionAnuladaOExpiradaResponde409() throws Exception {
        for (var estado : List.of(EstadoAsignacion.ANULADO, EstadoAsignacion.EXPIRADO)) {
            mvc(estado, EstadoSesionAplicacion.ABIERTA).perform(get("/evaluacion-participante/yo"))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.error.code").value("ASIGNACION_NO_OPERABLE"));
        }
    }

    @Test
    void yoConAsignacionCompletadaYEnlaceVencidoResponde200PorqueMandaElJwt() throws Exception {
        mvc(EstadoAsignacion.COMPLETADO, EstadoSesionAplicacion.CERRADA, LocalDateTime.now(CLOCK).minusMinutes(1))
                .perform(get("/evaluacion-participante/yo")).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.attemptStatus").value("COMPLETADO"));
    }
}

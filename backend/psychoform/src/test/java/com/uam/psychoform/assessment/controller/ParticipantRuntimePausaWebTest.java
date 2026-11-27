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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class ParticipantRuntimePausaWebTest {
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-06-24T12:00:00Z"), ZoneOffset.UTC);
    private MockMvc mvc;
    private ParticipantEvaluationView evaluation;

    @BeforeEach
    void setUp() {
        UUID participantId = UUID.randomUUID();
        Participante participante = new Participante();
        participante.setId(participantId);
        SesionAplicacion sesion = new SesionAplicacion();
        sesion.setId(10L);
        sesion.setEstado(EstadoSesionAplicacion.PAUSADA);
        AsignacionTest asignacion = new AsignacionTest();
        asignacion.setId(77L);
        asignacion.setParticipante(participante);
        asignacion.setSesionAplicacion(sesion);
        asignacion.setEstado(EstadoAsignacion.EN_PROGRESO);
        asignacion.setTokenExpiraEn(LocalDateTime.now(CLOCK).plusHours(1));
        AsignacionTestRepository asignaciones = mock(AsignacionTestRepository.class);
        when(asignaciones.findByIdForUpdate(77L)).thenReturn(Optional.of(asignacion));

        ParticipantJwtService jwt = mock(ParticipantJwtService.class);
        when(jwt.requireAccess(any())).thenReturn(new ParticipantAccess(77L, participantId));
        var access = new ParticipantAccessService(asignaciones, null, null, null, CLOCK);
        evaluation = mock(ParticipantEvaluationView.class);
        when(evaluation.getEvaluationPayload(77L)).thenReturn(new ParticipantEvaluationView.EvaluationPayload(
                null, 77L, 10L, "Ana", "Sesion", "PAUSADA", null, "NO_INICIADO", List.of()));
        when(evaluation.getScopedSubtestPayload(any(), org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.anyLong())).thenReturn(null);

        var controller = new ParticipantRuntimeController(jwt, mock(ParticipantRuntimeService.class), access,
                mock(ParticipantAnswerService.class), evaluation, mock(SubtestTimingService.class));
        mvc = MockMvcBuilders.standaloneSetup(controller).setControllerAdvice(new GlobalExceptionHandler()).build();
    }

    @Test
    void lecturaConSesionPausadaResponde200() throws Exception {
        mvc.perform(get("/evaluacion-participante/yo")).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.sessionStatus").value("PAUSADA"));
        mvc.perform(get("/intentos/1/subtests/2/items")).andExpect(status().isOk());
    }

    @Test
    void escriturasConSesionPausadaResponden409SesionPausada() throws Exception {
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
                    .andExpect(jsonPath("$.error.code").value("SESION_PAUSADA"));
        }
    }
}

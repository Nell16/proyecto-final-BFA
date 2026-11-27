package com.uam.psychoform.assessment.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.uam.psychoform.academic.model.Participante;
import com.uam.psychoform.assessment.model.AsignacionTest;
import com.uam.psychoform.assessment.model.EstadoAsignacion;
import com.uam.psychoform.assessment.model.EstadoSesionAplicacion;
import com.uam.psychoform.assessment.model.IntentoTest;
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
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/**
 * B2: el vencimiento del enlace de la asignacion solo se comprueba al canjearlo. Con un JWT de participante vigente,
 * las escrituras del runtime siguen funcionando aunque el enlace regenerado (TTL menor) ya haya vencido.
 */
class ParticipantRuntimeEnlaceVencidoWebTest {
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-06-24T12:00:00Z"), ZoneOffset.UTC);

    private MockMvc mvc(EstadoAsignacion estado, LocalDateTime enlaceExpiraEn) {
        UUID participantId = UUID.randomUUID();
        Participante participante = new Participante();
        participante.setId(participantId);
        SesionAplicacion sesion = new SesionAplicacion();
        sesion.setId(10L);
        sesion.setEstado(EstadoSesionAplicacion.ABIERTA);
        AsignacionTest asignacion = new AsignacionTest();
        asignacion.setId(77L);
        asignacion.setParticipante(participante);
        asignacion.setSesionAplicacion(sesion);
        asignacion.setEstado(estado);
        asignacion.setTokenExpiraEn(enlaceExpiraEn);
        AsignacionTestRepository asignaciones = mock(AsignacionTestRepository.class);
        when(asignaciones.findByIdForUpdate(77L)).thenReturn(Optional.of(asignacion));

        ParticipantJwtService jwt = mock(ParticipantJwtService.class);
        when(jwt.requireAccess(any())).thenReturn(new ParticipantAccess(77L, participantId));
        var access = new ParticipantAccessService(asignaciones, null, null, null, CLOCK);
        ParticipantRuntimeService runtime = mock(ParticipantRuntimeService.class);
        IntentoTest intento = new IntentoTest();
        intento.setId(1L);
        when(runtime.startOrResumeAttempt(any(), any(), anyString())).thenReturn(intento);
        var controller = new ParticipantRuntimeController(jwt, runtime, access, mock(ParticipantAnswerService.class),
                mock(ParticipantEvaluationView.class), mock(SubtestTimingService.class));
        return MockMvcBuilders.standaloneSetup(controller).setControllerAdvice(new GlobalExceptionHandler()).build();
    }

    @Test
    void escrituraConEnlaceRegeneradoYaVencidoPeroJwtVigenteResponde200() throws Exception {
        // Enlace regenerado con TTL de 1 h, intentos reiniciados y estado ASIGNADO; dos horas despues sigue operable.
        mvc(EstadoAsignacion.ASIGNADO, LocalDateTime.now(CLOCK).minusHours(1))
                .perform(post("/evaluacion-participante/iniciar").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"assignmentId\":77}"))
                .andExpect(status().isOk());
    }

    @Test
    void escrituraConAsignacionAnuladaYJwtVigenteResponde409AsignacionNoOperable() throws Exception {
        mvc(EstadoAsignacion.ANULADO, LocalDateTime.now(CLOCK).plusHours(1))
                .perform(post("/evaluacion-participante/iniciar").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"assignmentId\":77}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("ASIGNACION_NO_OPERABLE"));
    }
}

package com.uam.psychoform.assessment.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.uam.psychoform.assessment.service.ParticipantConflictException;
import com.uam.psychoform.assessment.service.ParticipantRuntimeService;
import com.uam.psychoform.assessment.service.ParticipantRuntimeService.AssignedParticipant;
import com.uam.psychoform.assessment.service.SessionManagementService;
import com.uam.psychoform.assessment.service.SesionAplicacionService;
import com.uam.psychoform.controller.GlobalExceptionHandler;
import jakarta.persistence.EntityNotFoundException;
import java.time.Duration;
import java.time.LocalDateTime;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/** B2: POST /sesiones/{id}/asignaciones/{assignmentId}/regenerar-token. */
class SessionControllerRegenerateTokenWebTest {
    private static final String URL = "/sesiones/10/asignaciones/77/regenerar-token";

    private final ParticipantRuntimeService runtime = mock(ParticipantRuntimeService.class);
    private final MockMvc mvc = MockMvcBuilders
            .standaloneSetup(new SessionController(mock(SessionManagementService.class),
                    mock(SesionAplicacionService.class), runtime))
            .setControllerAdvice(new GlobalExceptionHandler()).build();

    @Test
    void sinBodyUsaOchoHorasYDevuelveLaFormaDeLaAsignacion() throws Exception {
        LocalDateTime expiresAt = LocalDateTime.parse("2026-06-24T20:00:00");
        when(runtime.regenerateAssignmentToken(10L, 77L, Duration.ofHours(8)))
                .thenReturn(new AssignedParticipant(77L, "tok", expiresAt));

        mvc.perform(post(URL)).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.assignmentId").value(77))
                .andExpect(jsonPath("$.data.rawToken").value("tok"))
                .andExpect(jsonPath("$.data.expiresAt").exists());
    }

    @Test
    void ttlHoursDelBodyEsRespetado() throws Exception {
        when(runtime.regenerateAssignmentToken(eq(10L), eq(77L), any()))
                .thenReturn(new AssignedParticipant(77L, "tok", LocalDateTime.now()));

        mvc.perform(post(URL).contentType(MediaType.APPLICATION_JSON).content("{\"ttlHours\":24}"))
                .andExpect(status().isOk());

        verify(runtime).regenerateAssignmentToken(10L, 77L, Duration.ofHours(24));
    }

    @Test
    void ttlHoursFueraDeRangoEs400() throws Exception {
        for (String body : new String[] { "{\"ttlHours\":0}", "{\"ttlHours\":73}" }) {
            mvc.perform(post(URL).contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isBadRequest());
        }
        verify(runtime, never()).regenerateAssignmentToken(any(), any(), any());
    }

    @Test
    void mapeaNoEncontradoYConflictosDelServicio() throws Exception {
        when(runtime.regenerateAssignmentToken(10L, 77L, Duration.ofHours(8)))
                .thenThrow(new EntityNotFoundException("x"))
                .thenThrow(new ParticipantConflictException(ParticipantConflictException.SESION_FINALIZADA, "x"))
                .thenThrow(new ParticipantConflictException(ParticipantConflictException.ASIGNACION_NO_OPERABLE, "x"));

        mvc.perform(post(URL)).andExpect(status().isNotFound());
        mvc.perform(post(URL)).andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("SESION_FINALIZADA"));
        mvc.perform(post(URL)).andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("ASIGNACION_NO_OPERABLE"));
    }

    @Test
    void elEndpointRequierePermisoSesionAplicar() throws Exception {
        var method = SessionController.class.getMethod("regenerateToken", Long.class, Long.class,
                SessionController.RegenerateTokenRequest.class);
        org.assertj.core.api.Assertions
                .assertThat(method.getAnnotation(org.springframework.security.access.prepost.PreAuthorize.class).value())
                .isEqualTo("hasAuthority('PERM_SESION_APLICAR')");
    }
}

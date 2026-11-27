package com.uam.psychoform.assessment.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.uam.psychoform.academic.model.Participante;
import com.uam.psychoform.assessment.model.AsignacionTest;
import com.uam.psychoform.assessment.model.EstadoAsignacion;
import com.uam.psychoform.assessment.model.EstadoSesionAplicacion;
import com.uam.psychoform.assessment.model.SesionAplicacion;
import com.uam.psychoform.assessment.repository.AsignacionTestRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

/** B2: tras regenerar, el token anterior deja de validar y el nuevo valida (hash real, sin mocks de token). */
class ParticipantTokenRegenerationFlowTest {
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-06-24T12:00:00Z"), ZoneOffset.UTC);

    @Test
    void elTokenViejoDaErrorYElNuevoValida() {
        var tokens = new ParticipantTokenService(new BCryptPasswordEncoder(4));
        var asignaciones = mock(AsignacionTestRepository.class);
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
        asignacion.setEstado(EstadoAsignacion.ASIGNADO);
        String viejo = tokens.generateRawToken();
        asignacion.setTokenAccesoHash(tokens.hash(viejo));
        asignacion.setTokenExpiraEn(LocalDateTime.now(CLOCK).plusHours(1));
        asignacion.setIntentosAcceso(0);
        when(asignaciones.findByIdForUpdate(77L)).thenReturn(Optional.of(asignacion));

        var runtime = new ParticipantRuntimeService(null, null, asignaciones, null, null, null, null, tokens, null,
                mock(com.uam.psychoform.audit.service.AuditLogService.class), CLOCK, null, null, null, null);
        var access = new ParticipantAccessService(asignaciones, null, tokens, null, CLOCK);
        assertThat(access.grantParticipantAccess(77L, viejo).assignmentId()).isEqualTo(77L);

        var regenerado = runtime.regenerateAssignmentToken(10L, 77L, Duration.ofHours(8));

        assertThat(regenerado.rawToken()).isNotEqualTo(viejo);
        assertThatThrownBy(() -> access.grantParticipantAccess(77L, viejo))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(access.grantParticipantAccess(77L, regenerado.rawToken()).assignmentId()).isEqualTo(77L);
    }
}

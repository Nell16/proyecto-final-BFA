package com.uam.psychoform.assessment.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.uam.psychoform.security.service.JwtService;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

class ParticipantJwtServiceTest {
    private static final LocalDateTime EXPIRES = LocalDateTime.of(2026, 6, 24, 12, 0);
    private final JwtService jwt = Mockito.mock(JwtService.class);
    private final ParticipantJwtService service = new ParticipantJwtService(jwt);

    @Test
    void issueNoIncluyePermisoInternoDeRegistroDeRespuestas() {
        UUID participantId = UUID.randomUUID();
        when(jwt.emitir(Mockito.eq(participantId), Mockito.eq("participant-assignment:77"), Mockito.anySet(),
                Mockito.eq(Set.of("PARTICIPANTE")), Mockito.eq(EXPIRES.toInstant(ZoneOffset.UTC)))).thenReturn("token");

        assertThat(service.issue(participantId, 77L, EXPIRES)).isEqualTo("token");

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Set<String>> permissions = ArgumentCaptor.forClass(Set.class);
        verify(jwt).emitir(Mockito.eq(participantId), Mockito.eq("participant-assignment:77"), permissions.capture(),
                Mockito.eq(Set.of("PARTICIPANTE")), Mockito.eq(EXPIRES.toInstant(ZoneOffset.UTC)));
        assertThat(permissions.getValue()).isEmpty();
    }

    @Test
    void requireAccessExtraeAsignacionYParticipanteDelBearer() {
        UUID participantId = UUID.randomUUID();
        when(jwt.validar("token")).thenReturn(new JwtService.JwtPrincipal(participantId,
                "participant-assignment:77", Set.of(), Set.of("PARTICIPANTE"), 1L));

        ParticipantAccessService.ParticipantAccess access = service.requireAccess("Bearer token");

        assertThat(access.assignmentId()).isEqualTo(77L);
        assertThat(access.participantId()).isEqualTo(participantId);
    }

    @Test
    void jwtEmitidoVenceEnElInstanteDelTokenDeLaAsignacion() {
        Clock clock = Clock.fixed(Instant.parse("2026-06-24T00:00:00Z"), ZoneOffset.UTC);
        com.uam.psychoform.security.JwtProperties props = new com.uam.psychoform.security.JwtProperties();
        props.setSecret("01234567890123456789012345678901");
        JwtService real = new JwtService(props, clock);
        ParticipantJwtService svc = new ParticipantJwtService(real);
        UUID participantId = UUID.randomUUID();

        String token = svc.issue(participantId, 77L, EXPIRES);

        assertThat(real.validar(token).expiresAtEpochSecond()).isEqualTo(EXPIRES.toEpochSecond(ZoneOffset.UTC));
    }

    @Test
    void siElJwtVenceEntreElFiltroYElControladorRespondeTokenExpirado() {
        com.uam.psychoform.security.JwtProperties props = new com.uam.psychoform.security.JwtProperties();
        props.setSecret("01234567890123456789012345678901");
        // Emitido y validado por el filtro un segundo antes de exp; el controlador lo revalida ya vencido.
        Instant exp = Instant.parse("2026-06-24T12:00:00Z");
        JwtService alEmitir = new JwtService(props, Clock.fixed(exp.minusSeconds(3600), ZoneOffset.UTC));
        JwtService enElFiltro = new JwtService(props, Clock.fixed(exp.minusSeconds(1), ZoneOffset.UTC));
        JwtService enElControlador = new JwtService(props, Clock.fixed(exp, ZoneOffset.UTC));
        String token = new ParticipantJwtService(alEmitir).issue(UUID.randomUUID(), 77L,
                LocalDateTime.ofInstant(exp, ZoneOffset.UTC));
        assertThat(new ParticipantJwtService(enElFiltro).requireAccess("Bearer " + token).assignmentId()).isEqualTo(77L);

        org.assertj.core.api.Assertions.assertThatThrownBy(
                () -> new ParticipantJwtService(enElControlador).requireAccess("Bearer " + token))
                .isInstanceOf(ParticipantConflictException.class)
                .extracting(e -> ((ParticipantConflictException) e).getCode()).isEqualTo("TOKEN_EXPIRADO");
    }
}

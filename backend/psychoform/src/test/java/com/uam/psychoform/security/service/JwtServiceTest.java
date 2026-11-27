package com.uam.psychoform.security.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class JwtServiceTest {
    @Test
    void emiteYValidaUnTokenConPermisos() {
        JwtService service = new JwtService("01234567890123456789012345678901", Clock.fixed(Instant.parse("2026-06-24T00:00:00Z"), ZoneOffset.UTC));
        UUID id = UUID.randomUUID();
        String token = service.emitir(id, "ana", Set.of("TEST_CREAR"), Set.of("PSICOLOGO_COORDINADOR"));
        assertThat(service.validar(token).usuarioId()).isEqualTo(id);
        assertThat(service.validar(token).permisos()).containsExactly("TEST_CREAR");
    }

    @Test
    void rechazaUnTokenManipulado() {
        JwtService service = new JwtService("01234567890123456789012345678901", Clock.systemUTC());
        String token = service.emitir(UUID.randomUUID(), "ana", Set.of(), Set.of());
        assertThatThrownBy(() -> service.validar(token + "x")).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void rechazaUnTokenVencido() {
        JwtService issuer = new JwtService("01234567890123456789012345678901", Clock.fixed(Instant.parse("2026-06-24T00:00:00Z"), ZoneOffset.UTC));
        JwtService validator = new JwtService("01234567890123456789012345678901", Clock.fixed(Instant.parse("2026-06-24T08:00:01Z"), ZoneOffset.UTC));
        String token = issuer.emitir(UUID.randomUUID(), "ana", Set.of(), Set.of());
        assertThatThrownBy(() -> validator.validar(token)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void firmaValidaYVencidoLanzaJwtExpiredExceptionConRoles() {
        JwtService issuer = new JwtService("01234567890123456789012345678901", Clock.fixed(Instant.parse("2026-06-24T00:00:00Z"), ZoneOffset.UTC));
        JwtService validator = new JwtService("01234567890123456789012345678901", Clock.fixed(Instant.parse("2026-06-24T08:00:01Z"), ZoneOffset.UTC));
        String token = issuer.emitir(UUID.randomUUID(), "p", Set.of(), Set.of("PARTICIPANTE"));
        assertThatThrownBy(() -> validator.validar(token)).isInstanceOf(JwtExpiredException.class)
                .satisfies(e -> assertThat(((JwtExpiredException) e).roles()).containsExactly("PARTICIPANTE"));
    }

    @Test
    void firmaInvalidaYVencidoNoLanzaJwtExpiredException() {
        JwtService issuer = new JwtService("01234567890123456789012345678901", Clock.fixed(Instant.parse("2026-06-24T00:00:00Z"), ZoneOffset.UTC));
        JwtService validator = new JwtService("abcdefghijklmnopqrstuvwxyz012345", Clock.fixed(Instant.parse("2026-06-24T08:00:01Z"), ZoneOffset.UTC));
        String token = issuer.emitir(UUID.randomUUID(), "p", Set.of(), Set.of("PARTICIPANTE"));
        assertThatThrownBy(() -> validator.validar(token)).isInstanceOf(IllegalArgumentException.class)
                .isNotInstanceOf(JwtExpiredException.class);
    }

    @Test
    void emitirConExpiresAtRespetaElVencimiento() {
        Instant now = Instant.parse("2026-06-24T00:00:00Z");
        JwtService service = new JwtService("01234567890123456789012345678901", Clock.fixed(now, ZoneOffset.UTC));
        Instant exp = now.plusSeconds(120);
        String token = service.emitir(UUID.randomUUID(), "p", Set.of(), Set.of(), exp);
        assertThat(service.validar(token).expiresAtEpochSecond()).isEqualTo(exp.getEpochSecond());
        assertThatThrownBy(() -> service.emitir(UUID.randomUUID(), "p", Set.of(), Set.of(), now))
                .isInstanceOf(IllegalArgumentException.class);
    }
}

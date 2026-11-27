package com.uam.psychoform.assessment.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.uam.psychoform.assessment.model.EstadoAsignacion;
import com.uam.psychoform.assessment.model.EstadoIntento;
import java.time.LocalDateTime;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/** B11: matriz completa asignacion x intento (incluido sin intento) x token vigente/vencido. */
class AssignmentStatusMapperTest {
    private static final LocalDateTime NOW = LocalDateTime.of(2026, 11, 26, 12, 0);
    private static final Set<String> STATUS = Set.of("GENERADO", "ACTIVO", "VENCIDO", "REVOCADO");
    private static final Set<String> STATE = Set.of("no-iniciado", "en-progreso", "completado", "interrumpido",
            "anulado");

    @ParameterizedTest(name = "{0} / intento {1} / token {2} -> {3} / {4}")
    @CsvSource({
            "ASIGNADO, SIN_INTENTO, FUTURO, GENERADO, no-iniciado",
            "ASIGNADO, SIN_INTENTO, VENCIDO, VENCIDO, no-iniciado",
            "ASIGNADO, NO_INICIADO, FUTURO, GENERADO, no-iniciado",
            "ASIGNADO, NO_INICIADO, VENCIDO, VENCIDO, no-iniciado",
            "ASIGNADO, EN_PROGRESO, FUTURO, ACTIVO, en-progreso",
            "ASIGNADO, EN_PROGRESO, VENCIDO, ACTIVO, en-progreso",
            "ASIGNADO, COMPLETADO, FUTURO, VENCIDO, completado",
            "ASIGNADO, COMPLETADO, VENCIDO, VENCIDO, completado",
            "ASIGNADO, INTERRUMPIDO, FUTURO, ACTIVO, interrumpido",
            "ASIGNADO, INTERRUMPIDO, VENCIDO, ACTIVO, interrumpido",
            "ASIGNADO, ANULADO, FUTURO, REVOCADO, anulado",
            "ASIGNADO, ANULADO, VENCIDO, REVOCADO, anulado",
            "EN_PROGRESO, SIN_INTENTO, FUTURO, GENERADO, no-iniciado",
            "EN_PROGRESO, SIN_INTENTO, VENCIDO, VENCIDO, no-iniciado",
            "EN_PROGRESO, NO_INICIADO, FUTURO, GENERADO, no-iniciado",
            "EN_PROGRESO, NO_INICIADO, VENCIDO, VENCIDO, no-iniciado",
            "EN_PROGRESO, EN_PROGRESO, FUTURO, ACTIVO, en-progreso",
            "EN_PROGRESO, EN_PROGRESO, VENCIDO, ACTIVO, en-progreso",
            "EN_PROGRESO, COMPLETADO, FUTURO, VENCIDO, completado",
            "EN_PROGRESO, COMPLETADO, VENCIDO, VENCIDO, completado",
            "EN_PROGRESO, INTERRUMPIDO, FUTURO, ACTIVO, interrumpido",
            "EN_PROGRESO, INTERRUMPIDO, VENCIDO, ACTIVO, interrumpido",
            "EN_PROGRESO, ANULADO, FUTURO, REVOCADO, anulado",
            "EN_PROGRESO, ANULADO, VENCIDO, REVOCADO, anulado",
            "COMPLETADO, SIN_INTENTO, FUTURO, VENCIDO, no-iniciado",
            "COMPLETADO, SIN_INTENTO, VENCIDO, VENCIDO, no-iniciado",
            "COMPLETADO, NO_INICIADO, FUTURO, VENCIDO, no-iniciado",
            "COMPLETADO, NO_INICIADO, VENCIDO, VENCIDO, no-iniciado",
            "COMPLETADO, EN_PROGRESO, FUTURO, ACTIVO, en-progreso",
            "COMPLETADO, EN_PROGRESO, VENCIDO, ACTIVO, en-progreso",
            "COMPLETADO, COMPLETADO, FUTURO, VENCIDO, completado",
            "COMPLETADO, COMPLETADO, VENCIDO, VENCIDO, completado",
            "COMPLETADO, INTERRUMPIDO, FUTURO, ACTIVO, interrumpido",
            "COMPLETADO, INTERRUMPIDO, VENCIDO, ACTIVO, interrumpido",
            "COMPLETADO, ANULADO, FUTURO, REVOCADO, anulado",
            "COMPLETADO, ANULADO, VENCIDO, REVOCADO, anulado",
            "ANULADO, SIN_INTENTO, FUTURO, REVOCADO, anulado",
            "ANULADO, SIN_INTENTO, VENCIDO, REVOCADO, anulado",
            "ANULADO, NO_INICIADO, FUTURO, REVOCADO, no-iniciado",
            "ANULADO, NO_INICIADO, VENCIDO, REVOCADO, no-iniciado",
            "ANULADO, EN_PROGRESO, FUTURO, REVOCADO, en-progreso",
            "ANULADO, EN_PROGRESO, VENCIDO, REVOCADO, en-progreso",
            "ANULADO, COMPLETADO, FUTURO, REVOCADO, completado",
            "ANULADO, COMPLETADO, VENCIDO, REVOCADO, completado",
            "ANULADO, INTERRUMPIDO, FUTURO, REVOCADO, interrumpido",
            "ANULADO, INTERRUMPIDO, VENCIDO, REVOCADO, interrumpido",
            "ANULADO, ANULADO, FUTURO, REVOCADO, anulado",
            "ANULADO, ANULADO, VENCIDO, REVOCADO, anulado",
            "EXPIRADO, SIN_INTENTO, FUTURO, VENCIDO, no-iniciado",
            "EXPIRADO, SIN_INTENTO, VENCIDO, VENCIDO, no-iniciado",
            "EXPIRADO, NO_INICIADO, FUTURO, VENCIDO, no-iniciado",
            "EXPIRADO, NO_INICIADO, VENCIDO, VENCIDO, no-iniciado",
            "EXPIRADO, EN_PROGRESO, FUTURO, ACTIVO, en-progreso",
            "EXPIRADO, EN_PROGRESO, VENCIDO, ACTIVO, en-progreso",
            "EXPIRADO, COMPLETADO, FUTURO, VENCIDO, completado",
            "EXPIRADO, COMPLETADO, VENCIDO, VENCIDO, completado",
            "EXPIRADO, INTERRUMPIDO, FUTURO, ACTIVO, interrumpido",
            "EXPIRADO, INTERRUMPIDO, VENCIDO, ACTIVO, interrumpido",
            "EXPIRADO, ANULADO, FUTURO, REVOCADO, anulado",
            "EXPIRADO, ANULADO, VENCIDO, REVOCADO, anulado"
    })
    void matrizCompletaDeEstados(EstadoAsignacion assignment, String attempt, String token, String expectedStatus,
            String expectedState) {
        EstadoIntento attemptState = "SIN_INTENTO".equals(attempt) ? null : EstadoIntento.valueOf(attempt);
        LocalDateTime expiresAt = "VENCIDO".equals(token) ? NOW.minusMinutes(1) : NOW.plusHours(1);

        var mapped = AssignmentStatusMapper.map(assignment, expiresAt, attemptState, NOW);

        assertThat(mapped.status()).isEqualTo(expectedStatus);
        assertThat(mapped.state()).isEqualTo(expectedState);
    }

    @Test
    void siempreDevuelveValoresDentroDeLosEnumsDelContrato() {
        for (EstadoAsignacion assignment : EstadoAsignacion.values()) {
            for (EstadoIntento attempt : withNull()) {
                for (LocalDateTime expiresAt : new LocalDateTime[] { null, NOW.minusDays(1), NOW, NOW.plusDays(1) }) {
                    var mapped = AssignmentStatusMapper.map(assignment, expiresAt, attempt, NOW);
                    assertThat(mapped.status()).isIn(STATUS);
                    assertThat(mapped.state()).isIn(STATE);
                }
            }
        }
    }

    @Test
    void asignacionAnuladaConIntentoCompletadoEsRevocadaPeroConservaElEstadoCompletado() {
        var mapped = AssignmentStatusMapper.map(EstadoAsignacion.ANULADO, NOW.plusHours(1), EstadoIntento.COMPLETADO,
                NOW);

        assertThat(mapped.status()).isEqualTo("REVOCADO");
        assertThat(mapped.state()).isEqualTo("completado");
    }

    @Test
    void tokenVencidoSinIntentoEsVencidoAunqueLaAsignacionSigaAsignada() {
        var mapped = AssignmentStatusMapper.map(EstadoAsignacion.ASIGNADO, NOW.minusSeconds(1), null, NOW);

        assertThat(mapped.status()).isEqualTo("VENCIDO");
        assertThat(mapped.state()).isEqualTo("no-iniciado");
    }

    @Test
    void tokenQueVenceJustoAhoraSigueVigenteIgualQueLaValidacionDeAcceso() {
        assertThat(AssignmentStatusMapper.linkStatus(EstadoAsignacion.ASIGNADO, NOW, null, NOW)).isEqualTo("GENERADO");
    }

    @Test
    void sinFechaDeVencimientoElTokenNoSeConsideraVencido() {
        assertThat(AssignmentStatusMapper.linkStatus(EstadoAsignacion.ASIGNADO, null, null, NOW))
                .isEqualTo("GENERADO");
    }

    @Test
    void intentoNoIniciadoSalePorGuionYNoPorGuionBajo() {
        assertThat(AssignmentStatusMapper.attemptState(EstadoAsignacion.EN_PROGRESO, EstadoIntento.NO_INICIADO))
                .isEqualTo("no-iniciado");
    }

    @Test
    void intentoActivoConservaActivoAunqueElTokenYaHayaVencido() {
        assertThat(AssignmentStatusMapper.linkStatus(EstadoAsignacion.EN_PROGRESO, NOW.minusHours(5),
                EstadoIntento.EN_PROGRESO, NOW)).isEqualTo("ACTIVO");
    }

    private static EstadoIntento[] withNull() {
        EstadoIntento[] values = EstadoIntento.values();
        EstadoIntento[] all = new EstadoIntento[values.length + 1];
        System.arraycopy(values, 0, all, 1, values.length);
        return all;
    }
}

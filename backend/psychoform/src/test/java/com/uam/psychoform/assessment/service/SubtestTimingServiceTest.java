package com.uam.psychoform.assessment.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.uam.psychoform.assessment.model.EstadoIntento;
import com.uam.psychoform.assessment.model.EstadoSesionAplicacion;
import com.uam.psychoform.assessment.model.IntentoSubtest;
import com.uam.psychoform.assessment.model.PausaSesion;
import com.uam.psychoform.assessment.model.SesionAplicacion;
import com.uam.psychoform.assessment.model.SesionSubtest;
import com.uam.psychoform.assessment.repository.IntentoSubtestRepository;
import com.uam.psychoform.assessment.repository.PausaSesionRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

class SubtestTimingServiceTest {
    private static final Instant T0_INSTANT = Instant.parse("2026-06-24T12:00:00Z");
    private static final LocalDateTime T0 = LocalDateTime.ofInstant(T0_INSTANT, ZoneOffset.UTC);

    private final IntentoSubtestRepository intentoSubtests = Mockito.mock(IntentoSubtestRepository.class);
    private final PausaSesionRepository pausas = Mockito.mock(PausaSesionRepository.class);

    private SubtestTimingService serviceAt(long segundosDesdeT0) {
        return new SubtestTimingService(intentoSubtests, pausas,
                Clock.fixed(T0_INSTANT.plusSeconds(segundosDesdeT0), ZoneOffset.UTC));
    }

    private static PausaSesion pausa(long desde, Long hasta) {
        PausaSesion pausa = new PausaSesion();
        pausa.setPausadoEn(T0.plusSeconds(desde));
        pausa.setReanudadoEn(hasta == null ? null : T0.plusSeconds(hasta));
        return pausa;
    }

    private IntentoSubtest intentoSubtest(Integer limite, EstadoSesionAplicacion estadoSesion) {
        SesionAplicacion sesion = new SesionAplicacion();
        sesion.setId(10L);
        sesion.setEstado(estadoSesion);
        SesionSubtest sesionSubtest = new SesionSubtest();
        sesionSubtest.setSesionAplicacion(sesion);
        sesionSubtest.setTiempoLimiteSegundos(limite);
        IntentoSubtest is = new IntentoSubtest();
        is.setId(1L);
        is.setSesionSubtest(sesionSubtest);
        is.setEstado(EstadoIntento.EN_PROGRESO);
        is.setIniciadoEn(T0);
        when(intentoSubtests.findById(1L)).thenReturn(Optional.of(is));
        return is;
    }

    @Test
    void pausaIntermediaDescuentaDelRestante() {
        intentoSubtest(600, EstadoSesionAplicacion.ABIERTA);
        when(pausas.findBySesionAplicacionIdOrderByPausadoEnAsc(10L)).thenReturn(List.of(pausa(100, 400L)));

        var timing = serviceAt(500).forAttemptSubtest(1L);

        assertThat(timing.remainingSeconds()).isEqualTo(400);
        assertThat(timing.effectiveElapsedSeconds()).isEqualTo(200);
        assertThat(timing.timeLimitSeconds()).isEqualTo(600);
        assertThat(timing.paused()).isFalse();
        assertThat(timing.startedAt().toInstant()).isEqualTo(T0_INSTANT);
        assertThat(timing.serverNow().toInstant()).isEqualTo(T0_INSTANT.plusSeconds(500));
    }

    @Test
    void pausaIniciadaAntesDelInicioSoloCuentaElSolape() {
        IntentoSubtest is = intentoSubtest(600, EstadoSesionAplicacion.ABIERTA);
        List<PausaSesion> lista = List.of(pausa(-50, 50L));

        assertThat(SubtestTimingService.transcurridoEfectivo(is.getIniciadoEn(), T0.plusSeconds(100), lista))
                .isEqualTo(50);
        assertThat(SubtestTimingService.segundosPausados(lista, T0, T0.plusSeconds(100))).isEqualTo(50);
    }

    @Test
    void pausaAbiertaCongelaElTiempoYMarcaPausado() {
        intentoSubtest(600, EstadoSesionAplicacion.PAUSADA);
        when(pausas.findBySesionAplicacionIdOrderByPausadoEnAsc(10L)).thenReturn(List.of(pausa(200, null)));

        var timing = serviceAt(300).forAttemptSubtest(1L);

        assertThat(timing.effectiveElapsedSeconds()).isEqualTo(200);
        assertThat(timing.remainingSeconds()).isEqualTo(400);
        assertThat(timing.paused()).isTrue();
    }

    @Test
    void sinLimiteRemainingEsNull() {
        intentoSubtest(null, EstadoSesionAplicacion.ABIERTA);
        when(pausas.findBySesionAplicacionIdOrderByPausadoEnAsc(10L)).thenReturn(List.of());

        var timing = serviceAt(300).forAttemptSubtest(1L);

        assertThat(timing.remainingSeconds()).isNull();
        assertThat(timing.timeLimitSeconds()).isNull();
        assertThat(timing.effectiveElapsedSeconds()).isEqualTo(300);
    }

    @Test
    void restanteNuncaEsNegativoYSubtestCompletadoUsaFinalizadoEn() {
        IntentoSubtest is = intentoSubtest(100, EstadoSesionAplicacion.ABIERTA);
        when(pausas.findBySesionAplicacionIdOrderByPausadoEnAsc(10L)).thenReturn(List.of());
        assertThat(serviceAt(500).forAttemptSubtest(1L).remainingSeconds()).isZero();

        is.setEstado(EstadoIntento.COMPLETADO);
        is.setFinalizadoEn(T0.plusSeconds(40));
        var timing = serviceAt(500).forAttemptSubtest(1L);
        assertThat(timing.remainingSeconds()).isEqualTo(60);
        assertThat(timing.paused()).isFalse();
    }

    @Test
    void intervaloInvalidoDevuelveCero() {
        assertThat(SubtestTimingService.segundosPausados(List.of(pausa(0, 100L)), T0.plusSeconds(10), T0)).isZero();
    }

    @Test
    void elContadorNoOscilaConFraccionesDeSegundoDuranteUnaPausaAbierta() {
        java.util.List<PausaSesion> lista = java.util.List.of(pausaEn(T0.plusNanos(100_800_000_000L), null));
        long primera = SubtestTimingService.transcurridoEfectivo(T0, T0.plusNanos(101_200_000_000L), lista);
        long segunda = SubtestTimingService.transcurridoEfectivo(T0, T0.plusNanos(101_900_000_000L), lista);

        assertThat(primera).isEqualTo(100);
        assertThat(segunda).isEqualTo(100);
    }

    @Test
    void variasPausasConFraccionesNoAcumulanErrorDeTruncado() {
        // Tres pausas de 0,6 s = 1,8 s pausados; 10 s brutos -> 8,2 s efectivos -> 8.
        java.util.List<PausaSesion> lista = java.util.List.of(
                pausaEn(T0.plusNanos(1_000_000_000L), T0.plusNanos(1_600_000_000L)),
                pausaEn(T0.plusNanos(3_000_000_000L), T0.plusNanos(3_600_000_000L)),
                pausaEn(T0.plusNanos(5_000_000_000L), T0.plusNanos(5_600_000_000L)));

        assertThat(SubtestTimingService.transcurridoEfectivo(T0, T0.plusSeconds(10), lista)).isEqualTo(8);
    }

    private static PausaSesion pausaEn(LocalDateTime desde, LocalDateTime hasta) {
        PausaSesion pausa = new PausaSesion();
        pausa.setPausadoEn(desde);
        pausa.setReanudadoEn(hasta);
        return pausa;
    }
}

package com.uam.psychoform.assessment.service;

import com.uam.psychoform.assessment.model.EstadoIntento;
import com.uam.psychoform.assessment.model.EstadoSesionAplicacion;
import com.uam.psychoform.assessment.model.IntentoSubtest;
import com.uam.psychoform.assessment.model.PausaSesion;
import com.uam.psychoform.assessment.model.SesionAplicacion;
import com.uam.psychoform.assessment.repository.IntentoSubtestRepository;
import com.uam.psychoform.assessment.repository.PausaSesionRepository;
import jakarta.persistence.EntityNotFoundException;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Calculo de tiempo efectivo de subtests descontando las pausas de la sesion. */
@Service
@Transactional(readOnly = true)
public class SubtestTimingService {
    public static final int GRACIA_SEGUNDOS = 5;

    private final IntentoSubtestRepository intentoSubtests;
    private final PausaSesionRepository pausas;
    private final Clock clock;

    public SubtestTimingService(IntentoSubtestRepository intentoSubtests, PausaSesionRepository pausas, Clock clock) {
        this.intentoSubtests = intentoSubtests;
        this.pausas = pausas;
        this.clock = clock;
    }

    public static long segundosPausados(List<PausaSesion> pausas, LocalDateTime desde, LocalDateTime hasta) {
        return duracionPausada(pausas, desde, hasta).getSeconds();
    }

    /**
     * Suma exacta (con fracciones de segundo) del solape de cada pausa con [desde, hasta]. Se trunca a segundos
     * solo al final, para que el contador no oscile durante una pausa abierta ni acumule error entre pausas.
     */
    static Duration duracionPausada(List<PausaSesion> pausas, LocalDateTime desde, LocalDateTime hasta) {
        if (!hasta.isAfter(desde)) {
            return Duration.ZERO;
        }
        Duration total = Duration.ZERO;
        for (PausaSesion pausa : pausas) {
            LocalDateTime fin = pausa.getReanudadoEn() == null ? hasta : pausa.getReanudadoEn();
            LocalDateTime from = pausa.getPausadoEn().isAfter(desde) ? pausa.getPausadoEn() : desde;
            LocalDateTime to = fin.isBefore(hasta) ? fin : hasta;
            if (to.isAfter(from)) {
                total = total.plus(Duration.between(from, to));
            }
        }
        return total;
    }

    public static long transcurridoEfectivo(LocalDateTime iniciadoEn, LocalDateTime hasta, List<PausaSesion> pausas) {
        return duracionEfectiva(iniciadoEn, hasta, pausas).getSeconds();
    }

    /** Tiempo efectivo exacto (sin truncar): usar para comparar contra limites, p. ej. la gracia de TIEMPO_AGOTADO. */
    public static Duration duracionEfectiva(LocalDateTime iniciadoEn, LocalDateTime hasta, List<PausaSesion> pausas) {
        if (!hasta.isAfter(iniciadoEn)) {
            return Duration.ZERO;
        }
        Duration efectivo = Duration.between(iniciadoEn, hasta).minus(duracionPausada(pausas, iniciadoEn, hasta));
        return efectivo.isNegative() ? Duration.ZERO : efectivo;
    }

    /** Segundos efectivos del subtest hasta `now` (o hasta finalizadoEn si ya esta completado). */
    public long effectiveElapsedSeconds(IntentoSubtest intentoSubtest, LocalDateTime now, List<PausaSesion> pausas) {
        if (intentoSubtest.getIniciadoEn() == null) {
            return 0;
        }
        return transcurridoEfectivo(intentoSubtest.getIniciadoEn(), hasta(intentoSubtest, now), pausas);
    }

    /** Tiempo efectivo exacto hasta `now` (o finalizadoEn) cargando las pausas de la sesion. */
    public Duration effectiveElapsed(IntentoSubtest intentoSubtest, LocalDateTime now, Long sesionId) {
        if (intentoSubtest.getIniciadoEn() == null) {
            return Duration.ZERO;
        }
        return duracionEfectiva(intentoSubtest.getIniciadoEn(), hasta(intentoSubtest, now), loadPausas(sesionId));
    }

    /** Segundos efectivos hasta `now` cargando las pausas de la sesion. */
    public long effectiveElapsedSeconds(IntentoSubtest intentoSubtest, LocalDateTime now, Long sesionId) {
        return effectiveElapsedSeconds(intentoSubtest, now, loadPausas(sesionId));
    }

    public List<PausaSesion> loadPausas(Long sesionId) {
        return pausas.findBySesionAplicacionIdOrderByPausadoEnAsc(sesionId);
    }

    public SubtestTiming forAttemptSubtest(long intentoSubtestId) {
        IntentoSubtest intentoSubtest = intentoSubtests.findById(intentoSubtestId)
                .orElseThrow(() -> new EntityNotFoundException("Intento de subtest no encontrado: " + intentoSubtestId));
        SesionAplicacion sesion = intentoSubtest.getSesionSubtest().getSesionAplicacion();
        return forAttemptSubtest(intentoSubtest, sesion.getEstado(), loadPausas(sesion.getId()));
    }

    public SubtestTiming forAttemptSubtest(IntentoSubtest intentoSubtest, EstadoSesionAplicacion estadoSesion,
            List<PausaSesion> pausas) {
        LocalDateTime now = LocalDateTime.now(clock);
        Integer limit = intentoSubtest.getSesionSubtest() == null ? null
                : intentoSubtest.getSesionSubtest().getTiempoLimiteSegundos();
        return compute(intentoSubtest, limit, estadoSesion, pausas, now);
    }

    /** Variante para subtests aun no iniciados (sin IntentoSubtest). */
    public SubtestTiming notStarted(Integer limit) {
        return new SubtestTiming(null, limit, null, false, toOffset(LocalDateTime.now(clock)), null);
    }

    private SubtestTiming compute(IntentoSubtest intentoSubtest, Integer limit, EstadoSesionAplicacion estadoSesion,
            List<PausaSesion> pausas, LocalDateTime now) {
        OffsetDateTime serverNow = toOffset(now);
        if (intentoSubtest.getIniciadoEn() == null) {
            return new SubtestTiming(null, limit, null, false, serverNow, null);
        }
        long elapsed = transcurridoEfectivo(intentoSubtest.getIniciadoEn(), hasta(intentoSubtest, now), pausas);
        Integer remaining = limit == null ? null : (int) Math.max(0, limit - elapsed);
        boolean paused = estadoSesion == EstadoSesionAplicacion.PAUSADA
                && intentoSubtest.getEstado() == EstadoIntento.EN_PROGRESO;
        return new SubtestTiming(toOffset(intentoSubtest.getIniciadoEn()), limit, remaining, paused, serverNow,
                elapsed);
    }

    private static LocalDateTime hasta(IntentoSubtest intentoSubtest, LocalDateTime now) {
        return intentoSubtest.getEstado() == EstadoIntento.COMPLETADO && intentoSubtest.getFinalizadoEn() != null
                ? intentoSubtest.getFinalizadoEn()
                : now;
    }

    private OffsetDateTime toOffset(LocalDateTime value) {
        return value.atZone(clock.getZone()).toOffsetDateTime();
    }

    public OffsetDateTime toOffsetDateTime(LocalDateTime value) {
        return value == null ? null : toOffset(value);
    }

    public record SubtestTiming(OffsetDateTime startedAt, Integer timeLimitSeconds, Integer remainingSeconds,
            boolean paused, OffsetDateTime serverNow, Long effectiveElapsedSeconds) {
    }
}

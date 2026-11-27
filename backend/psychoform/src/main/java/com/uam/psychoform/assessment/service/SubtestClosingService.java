package com.uam.psychoform.assessment.service;

import com.uam.psychoform.assessment.model.EstadoIntento;
import com.uam.psychoform.assessment.model.IntentoSubtest;
import com.uam.psychoform.assessment.model.RespuestaItem;
import com.uam.psychoform.assessment.repository.IntentoSubtestRepository;
import com.uam.psychoform.assessment.repository.RespuestaItemRepository;
import com.uam.psychoform.instrument.model.Item;
import com.uam.psychoform.instrument.repository.ItemLookupRepository;
import com.uam.psychoform.security.model.EstadoGeneral;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Cierre de un subtest "tal como estaba": lo marca COMPLETADO, calcula el tiempo usado en el servidor y registra
 * una respuesta vacia (sin opciones, texto ni numero) por cada item activo que el participante no respondio, de modo
 * que el subtest queda entregado completo y los omitidos cuentan como respuestas sin acierto al calificar.
 *
 * El llamador debe tener el intento bloqueado (FOR UPDATE) en la transaccion en curso: es el mismo bloqueo que toman
 * PUT respuesta, bulk-sync, finalizar subtest y finalizar intento, asi que el cierre no se intercala con un guardado.
 */
@Service
public class SubtestClosingService {
    private final IntentoSubtestRepository intentoSubtests;
    private final RespuestaItemRepository respuestas;
    private final ItemLookupRepository items;
    private final SubtestTimingService timing;

    public SubtestClosingService(IntentoSubtestRepository intentoSubtests, RespuestaItemRepository respuestas,
            ItemLookupRepository items, SubtestTimingService timing) {
        this.intentoSubtests = intentoSubtests;
        this.respuestas = respuestas;
        this.items = items;
        this.timing = timing;
    }

    /** true si el subtest tiene limite y su tiempo efectivo (sin pausas) supera limite + gracia. */
    public boolean tiempoAgotado(IntentoSubtest intentoSubtest, Long sesionId, LocalDateTime now) {
        Integer limite = limite(intentoSubtest);
        if (limite == null || intentoSubtest.getIniciadoEn() == null) {
            return false;
        }
        Duration efectivo = timing.effectiveElapsed(intentoSubtest, now, sesionId);
        return efectivo.compareTo(Duration.ofSeconds((long) limite + SubtestTimingService.GRACIA_SEGUNDOS)) > 0;
    }

    /** Cierra el subtest si sigue EN_PROGRESO; si ya estaba cerrado no hace nada (idempotente). */
    @Transactional(propagation = Propagation.MANDATORY)
    public void cerrar(IntentoSubtest intentoSubtest, Long sesionId, LocalDateTime now) {
        if (intentoSubtest.getEstado() != EstadoIntento.EN_PROGRESO) {
            return;
        }
        long efectivo = timing.effectiveElapsed(intentoSubtest, now, sesionId).getSeconds();
        Integer limite = limite(intentoSubtest);
        long usado = limite == null ? efectivo : Math.min(efectivo, limite);
        intentoSubtest.setEstado(EstadoIntento.COMPLETADO);
        intentoSubtest.setFinalizadoEn(now);
        intentoSubtest.setTiempoUsadoSegundos((int) Math.min(usado, Integer.MAX_VALUE));
        intentoSubtests.save(intentoSubtest);
        registrarOmitidos(intentoSubtest, now);
    }

    private void registrarOmitidos(IntentoSubtest intentoSubtest, LocalDateTime now) {
        if (intentoSubtest.getSubtest() == null) {
            return;
        }
        Long intentoId = intentoSubtest.getIntento().getId();
        Set<Long> respondidos = respuestas.findByIntentoId(intentoId).stream()
                .map(respuesta -> respuesta.getItem().getId())
                .collect(Collectors.toSet());
        for (Item item : items.findBySubtestIdAndEstadoOrderByNumeroOrdenAsc(intentoSubtest.getSubtest().getId(),
                EstadoGeneral.ACTIVO)) {
            if (respondidos.contains(item.getId())) {
                continue;
            }
            RespuestaItem vacia = new RespuestaItem();
            vacia.setIntento(intentoSubtest.getIntento());
            vacia.setIntentoSubtest(intentoSubtest);
            vacia.setItem(item);
            vacia.setRespondidoEn(now);
            vacia.setEsFinal(true);
            vacia.setRequiereRevisionManual(false);
            respuestas.save(vacia);
        }
    }

    private static Integer limite(IntentoSubtest intentoSubtest) {
        return intentoSubtest.getSesionSubtest() == null ? null
                : intentoSubtest.getSesionSubtest().getTiempoLimiteSegundos();
    }
}

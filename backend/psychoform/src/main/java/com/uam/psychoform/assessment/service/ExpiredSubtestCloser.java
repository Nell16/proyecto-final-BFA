package com.uam.psychoform.assessment.service;

import com.uam.psychoform.assessment.model.EstadoIntento;
import com.uam.psychoform.assessment.model.EstadoSesionAplicacion;
import com.uam.psychoform.assessment.model.IntentoSubtest;
import com.uam.psychoform.assessment.model.SesionAplicacion;
import com.uam.psychoform.assessment.repository.IntentoSubtestRepository;
import com.uam.psychoform.assessment.repository.IntentoTestRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import java.time.Clock;
import java.time.LocalDateTime;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Entrega por tiempo agotado aunque el cliente no vuelva a llamar (navegador cerrado, sin conexion, etc.): cierra
 * cada subtest EN_PROGRESO cuyo tiempo efectivo supero limite + gracia, tal como estaba, con respuestas vacias para
 * los items omitidos. Las pausas se descuentan, asi que una sesion PAUSADA no vence. Cada subtest se procesa en su
 * propia transaccion y con el intento bloqueado, igual que las escrituras del participante.
 */
@Component
@ConditionalOnProperty(name = "psychoform.subtests.cierre-automatico.enabled", havingValue = "true", matchIfMissing = true)
public class ExpiredSubtestCloser {
    private static final Logger log = LoggerFactory.getLogger(ExpiredSubtestCloser.class);

    private final IntentoSubtestRepository intentoSubtests;
    private final IntentoTestRepository intentos;
    private final SubtestClosingService closing;
    private final TransactionTemplate tx;
    private final Clock clock;
    private final EntityManager entityManager;

    public ExpiredSubtestCloser(IntentoSubtestRepository intentoSubtests, IntentoTestRepository intentos,
            SubtestClosingService closing, PlatformTransactionManager txManager, Clock clock,
            EntityManager entityManager) {
        this.intentoSubtests = intentoSubtests;
        this.intentos = intentos;
        this.closing = closing;
        this.tx = new TransactionTemplate(txManager);
        this.clock = clock;
        this.entityManager = entityManager;
    }

    @Scheduled(fixedDelayString = "${psychoform.subtests.cierre-automatico.intervalo-ms:30000}",
            initialDelayString = "${psychoform.subtests.cierre-automatico.intervalo-ms:30000}")
    public void ejecutar() {
        cerrarExpirados();
    }

    /** Devuelve cuantos subtests cerro. */
    public int cerrarExpirados() {
        return cerrarExpirados(candidato -> true);
    }

    /** Variante acotada (p. ej. a un intento concreto) para no tocar otros datos de la misma base. */
    public int cerrarExpirados(java.util.function.Predicate<IntentoSubtestRepository.CierreCandidato> filtro) {
        int cerrados = 0;
        for (IntentoSubtestRepository.CierreCandidato candidato : intentoSubtests.findCandidatosCierrePorTiempo()) {
            if (!filtro.test(candidato)) {
                continue;
            }
            try {
                Boolean cerrado = tx.execute(status -> cerrarSiExpirado(candidato));
                if (Boolean.TRUE.equals(cerrado)) {
                    cerrados++;
                }
            } catch (RuntimeException ex) {
                log.warn("No se pudo cerrar por tiempo el intento_subtest {}", candidato.getIntentoSubtestId(), ex);
            }
        }
        return cerrados;
    }

    private boolean cerrarSiExpirado(IntentoSubtestRepository.CierreCandidato candidato) {
        var intento = intentos.findByIdForUpdate(candidato.getIntentoId()).orElse(null);
        if (intento == null || intento.getEstado() != EstadoIntento.EN_PROGRESO) {
            return false;
        }
        IntentoSubtest intentoSubtest = intentoSubtests.findById(candidato.getIntentoSubtestId()).orElse(null);
        if (intentoSubtest == null || intentoSubtest.getEstado() != EstadoIntento.EN_PROGRESO) {
            return false;
        }
        Long sesionId = intento.getAsignacion().getSesionAplicacion().getId();
        // FOR SHARE sobre la sesion (mismo orden que las escrituras: intento -> sesion): espera a que confirme una
        // pausa en curso (pausar toma FOR UPDATE e inserta la pausa en la misma transaccion), de modo que el
        // vencimiento se evalua con el historial de pausas confirmado.
        SesionAplicacion sesion = entityManager.find(SesionAplicacion.class, sesionId);
        if (sesion == null) {
            return false;
        }
        entityManager.refresh(sesion, LockModeType.PESSIMISTIC_READ);
        // Una sesion cerrada o cancelada no sigue corriendo el tiempo: el job no entrega intentos de sesiones
        // terminadas (el estado se lee bajo el mismo bloqueo que toman cerrar/cancelar).
        if (sesion.getEstado() == EstadoSesionAplicacion.CERRADA
                || sesion.getEstado() == EstadoSesionAplicacion.CANCELADA) {
            return false;
        }
        LocalDateTime now = LocalDateTime.now(clock);
        if (!closing.tiempoAgotado(intentoSubtest, sesionId, now)) {
            return false;
        }
        closing.cerrar(intentoSubtest, sesionId, now);
        return true;
    }
}

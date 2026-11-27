package com.uam.psychoform.assessment.service;

import com.uam.psychoform.assessment.model.EstadoSesionAplicacion;
import com.uam.psychoform.assessment.model.SesionAplicacion;
import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityNotFoundException;
import jakarta.persistence.LockModeType;
import org.springframework.stereotype.Component;

/**
 * Garantiza dentro de la transaccion de cada escritura del participante que la sesion esta ABIERTA.
 * Usa FOR SHARE para serializar contra pausar/cerrar/cancelar (que bloquean con FOR UPDATE).
 * El estado se relee de la fila bajo bloqueo con refresh: con Open EntityManager in View la sesion puede estar ya
 * gestionada (cargada por validateRuntimeWrite) y una consulta normal devolveria el estado anterior a la pausa.
 */
@Component
public class SessionWriteGuard {
    private final EntityManager entityManager;

    public SessionWriteGuard(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    public SesionAplicacion requireWritable(Long sesionId) {
        SesionAplicacion sesion = entityManager.find(SesionAplicacion.class, sesionId);
        if (sesion == null) {
            throw new EntityNotFoundException("Sesion no encontrada: " + sesionId);
        }
        entityManager.refresh(sesion, LockModeType.PESSIMISTIC_READ);
        checkWritable(sesion.getEstado());
        return sesion;
    }

    public static void checkReadable(EstadoSesionAplicacion estado) {
        switch (estado) {
            case PROGRAMADA -> throw new ParticipantConflictException(ParticipantConflictException.SESION_NO_ABIERTA,
                    "La sesion no esta abierta");
            case CERRADA, CANCELADA -> throw new ParticipantConflictException(
                    ParticipantConflictException.SESION_FINALIZADA, "La sesion ha finalizado");
            default -> {
            }
        }
    }

    /** Lectura del estado final de una asignacion COMPLETADO: tambien se admite con la sesion CERRADA o CANCELADA. */
    public static void checkReadableCompleted(EstadoSesionAplicacion estado) {
        if (estado == EstadoSesionAplicacion.CERRADA || estado == EstadoSesionAplicacion.CANCELADA) {
            return;
        }
        checkReadable(estado);
    }

    public static void checkWritable(EstadoSesionAplicacion estado) {
        checkReadable(estado);
        if (estado == EstadoSesionAplicacion.PAUSADA) {
            throw new SesionPausadaException();
        }
    }
}

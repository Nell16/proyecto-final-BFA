package com.uam.psychoform.assessment.service;

import com.uam.psychoform.assessment.model.EstadoAsignacion;
import com.uam.psychoform.assessment.model.EstadoIntento;
import java.time.LocalDateTime;

/**
 * B11: deriva los estados que el monitor de sesion muestra (enlace y intento) a partir de los enums del dominio.
 * Funcion pura, sin acceso a base de datos ni reloj propio: "ahora" se recibe como parametro.
 *
 * <p>Los valores devueltos estan dentro de los enums que acepta el frontend
 * ({@code bfa-digital/src/api/schemas/sessions.ts}); no se inventan valores nuevos.
 */
public final class AssignmentStatusMapper {
    public static final String LINK_GENERADO = "GENERADO";
    public static final String LINK_ACTIVO = "ACTIVO";
    public static final String LINK_VENCIDO = "VENCIDO";
    public static final String LINK_REVOCADO = "REVOCADO";

    public static final String STATE_NO_INICIADO = "no-iniciado";
    public static final String STATE_EN_PROGRESO = "en-progreso";
    public static final String STATE_COMPLETADO = "completado";
    public static final String STATE_INTERRUMPIDO = "interrumpido";
    public static final String STATE_ANULADO = "anulado";

    private AssignmentStatusMapper() {
    }

    /** Estado derivado de una asignacion: {@code status} del enlace y {@code state} del intento. */
    public record Mapped(String status, String state) {
    }

    public static Mapped map(EstadoAsignacion assignment, LocalDateTime tokenExpiresAt, EstadoIntento attempt,
            LocalDateTime now) {
        return new Mapped(linkStatus(assignment, tokenExpiresAt, attempt, now), attemptState(assignment, attempt));
    }

    /**
     * GENERADO | ACTIVO | VENCIDO | REVOCADO. Prioridad:
     * <ol>
     * <li>Asignacion ANULADO (o intento ANULADO): REVOCADO, siempre gana, aunque el intento ya estuviera COMPLETADO.</li>
     * <li>Intento EN_PROGRESO o INTERRUMPIDO: ACTIVO (quien esta respondiendo no pierde el estado por el vencimiento
     * del token, que solo sirve para entrar).</li>
     * <li>Intento COMPLETADO, asignacion COMPLETADO o EXPIRADO, o token vencido (aunque nadie haya intentado entrar y
     * EXPIRADO aun no se haya marcado): VENCIDO.</li>
     * <li>En otro caso: GENERADO.</li>
     * </ol>
     */
    public static String linkStatus(EstadoAsignacion assignment, LocalDateTime tokenExpiresAt, EstadoIntento attempt,
            LocalDateTime now) {
        if (assignment == EstadoAsignacion.ANULADO || attempt == EstadoIntento.ANULADO) {
            return LINK_REVOCADO;
        }
        if (attempt == EstadoIntento.EN_PROGRESO || attempt == EstadoIntento.INTERRUMPIDO) {
            return LINK_ACTIVO;
        }
        if (attempt == EstadoIntento.COMPLETADO || assignment == EstadoAsignacion.COMPLETADO
                || assignment == EstadoAsignacion.EXPIRADO || tokenExpired(tokenExpiresAt, now)) {
            return LINK_VENCIDO;
        }
        return LINK_GENERADO;
    }

    /**
     * no-iniciado | en-progreso | completado | interrumpido | anulado. Con intento, mapeo explicito de
     * {@link EstadoIntento} (nunca {@code name().toLowerCase()}). Sin intento: anulado si la asignacion esta ANULADO;
     * si no, no-iniciado.
     */
    public static String attemptState(EstadoAsignacion assignment, EstadoIntento attempt) {
        if (attempt == null) {
            return assignment == EstadoAsignacion.ANULADO ? STATE_ANULADO : STATE_NO_INICIADO;
        }
        return switch (attempt) {
            case NO_INICIADO -> STATE_NO_INICIADO;
            case EN_PROGRESO -> STATE_EN_PROGRESO;
            case COMPLETADO -> STATE_COMPLETADO;
            case INTERRUMPIDO -> STATE_INTERRUMPIDO;
            case ANULADO -> STATE_ANULADO;
        };
    }

    /** Mismo criterio que la validacion de acceso: vencido cuando el vencimiento es anterior a "ahora". */
    private static boolean tokenExpired(LocalDateTime tokenExpiresAt, LocalDateTime now) {
        return tokenExpiresAt != null && tokenExpiresAt.isBefore(now);
    }
}

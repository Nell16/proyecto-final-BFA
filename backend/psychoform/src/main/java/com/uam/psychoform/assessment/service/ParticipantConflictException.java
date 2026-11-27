package com.uam.psychoform.assessment.service;

/**
 * Conflicto de runtime del participante con un código de error estable (contrato con el frontend).
 * Extiende IllegalStateException para conservar la semántica 409 existente.
 */
public class ParticipantConflictException extends IllegalStateException {
    public static final String SESION_NO_ABIERTA = "SESION_NO_ABIERTA";
    public static final String SESION_FINALIZADA = "SESION_FINALIZADA";
    public static final String TIEMPO_AGOTADO = "TIEMPO_AGOTADO";
    public static final String TOKEN_EXPIRADO = "TOKEN_EXPIRADO";
    public static final String ASIGNACION_NO_OPERABLE = "ASIGNACION_NO_OPERABLE";

    private final String code;

    public ParticipantConflictException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}

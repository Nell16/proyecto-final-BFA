package com.uam.psychoform.assessment.service;

public class SesionPausadaException extends ParticipantConflictException {
    public static final String CODE = "SESION_PAUSADA";
    public static final String MESSAGE = "La sesión está pausada por el aplicador";

    public SesionPausadaException() {
        super(CODE, MESSAGE);
    }
}

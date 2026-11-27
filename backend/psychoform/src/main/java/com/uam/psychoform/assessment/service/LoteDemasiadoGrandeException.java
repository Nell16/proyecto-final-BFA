package com.uam.psychoform.assessment.service;

/** Lote de bulk-sync que excede el limite de bytes configurado: 413. */
public class LoteDemasiadoGrandeException extends RuntimeException {
    public LoteDemasiadoGrandeException(String message) {
        super(message);
    }

    public static LoteDemasiadoGrandeException porBytes(long maxBytes) {
        return new LoteDemasiadoGrandeException("El lote excede el tamano maximo de " + maxBytes + " bytes");
    }

    public static LoteDemasiadoGrandeException porElementos(int maxElementos) {
        return new LoteDemasiadoGrandeException("El lote excede el maximo de " + maxElementos + " respuestas");
    }
}

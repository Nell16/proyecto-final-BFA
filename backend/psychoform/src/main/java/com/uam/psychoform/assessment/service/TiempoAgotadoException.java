package com.uam.psychoform.assessment.service;

/**
 * El subtest supero su limite + gracia. Quien la lanza ya cerro el subtest en la misma transaccion; las escrituras
 * que la propagan declaran noRollbackFor para que ese cierre se confirme aunque la peticion responda 409.
 */
public class TiempoAgotadoException extends ParticipantConflictException {
    public TiempoAgotadoException() {
        super(TIEMPO_AGOTADO, "El tiempo del subtest se agoto; se entrego con las respuestas registradas hasta ese momento");
    }
}

package com.uam.psychoform.instrument.service;

import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Idempotency-Key de las subidas de imagen: validacion de la clave del cliente y ambito con que se guarda.
 *
 * <p>La clave del cliente (maximo 64 caracteres, solo {@code [A-Za-z0-9_-]}; un UUID cumple) no se guarda tal cual: en
 * {@code recurso_multimedia.clave_subida} se almacena {@code <userId>:<OPERACION>:<clave>}. Asi la misma clave usada por
 * otro usuario, o en otra operacion (subida suelta, imagen de item, imagen de opcion, reemplazo), es una subida
 * distinta y nunca devuelve el recurso de otro ambito. Maximo: 36 + 1 + 14 + 1 + 64 = 116 caracteres (VARCHAR(128)).
 * No requiere migracion. Las respuestas devuelven siempre la clave original del cliente ({@link #clientKey}).
 */
public final class ImageUploadKeys {
    public static final int MAX_CLIENT_KEY_LENGTH = 64;
    private static final Pattern VALID_CLIENT_KEY = Pattern.compile("[A-Za-z0-9_-]{1,64}");
    private static final char SEPARATOR = ':';

    /** Tipo de operacion que ampara la clave. */
    public enum Operation {
        LOOSE, ITEM, OPTION, REPLACE_ITEM, REPLACE_OPTION
    }

    private ImageUploadKeys() {
    }

    /**
     * Devuelve la clave recortada, o null si la cabecera no viene; lanza IllegalArgumentException (400) si es invalida.
     * Una clave presente pero vacia o solo con espacios es invalida (no equivale a no enviarla).
     */
    public static String normalize(String idempotencyKey) {
        if (idempotencyKey == null) {
            return null;
        }
        String normalized = idempotencyKey.trim();
        if (!VALID_CLIENT_KEY.matcher(normalized).matches()) {
            throw new IllegalArgumentException("Idempotency-Key invalida: use hasta " + MAX_CLIENT_KEY_LENGTH
                    + " caracteres entre A-Z, a-z, 0-9, '_' y '-' (un UUID cumple)");
        }
        return normalized;
    }

    /** Valor guardado en {@code clave_subida}; null si no hay clave de cliente. */
    public static String scoped(UUID userId, Operation operation, String clientKey) {
        if (clientKey == null) {
            return null;
        }
        return userId + String.valueOf(SEPARATOR) + operation.name() + SEPARATOR + clientKey;
    }

    /** Clave original del cliente a partir de lo guardado (los valores sin ambito se devuelven tal cual). */
    public static String clientKey(String stored) {
        if (stored == null) {
            return null;
        }
        String[] parts = stored.split(String.valueOf(SEPARATOR), 3);
        return parts.length == 3 ? parts[2] : stored;
    }
}

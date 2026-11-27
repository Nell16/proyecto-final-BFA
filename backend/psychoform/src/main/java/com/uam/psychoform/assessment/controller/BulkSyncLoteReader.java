package com.uam.psychoform.assessment.controller;

import com.uam.psychoform.assessment.dto.SaveAnswerRequest;
import com.uam.psychoform.assessment.service.LoteDemasiadoGrandeException;
import com.uam.psychoform.assessment.service.ParticipantAnswerService.SaveAnswerCommand;
import java.io.FilterInputStream;
import java.io.FilterReader;
import java.io.InputStreamReader;
import java.io.PushbackReader;
import java.io.Reader;
import java.nio.charset.Charset;
import java.nio.charset.CharsetDecoder;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import tools.jackson.core.JacksonException;
import tools.jackson.core.JsonParser;
import tools.jackson.core.JsonToken;
import tools.jackson.core.ObjectReadContext;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.util.TokenBuffer;

/**
 * Lee el cuerpo de bulk-sync en streaming para que un elemento mal tipado no rechace todo el lote:
 * <ul>
 * <li>El cuerpo se lee como bytes con un limite (413 si se excede), y Jackson decodifica el texto de forma estricta
 * (UTF-8 invalido es 400, BOM aceptado), igual que el conversor estandar.</li>
 * <li>Cada elemento se copia a un buffer de tokens sin convertir sus numeros; la conversion (BigDecimal exacto) ocurre
 * al leer ese elemento, de modo que un numero inconvertible solo invalida su posicion.</li>
 * <li>null conserva su posicion con itemId nulo; un elemento ilegible se marca como entrada invalida con su itemId
 * si es legible. Solo un cuerpo que no es un arreglo JSON bien formado es 400.</li>
 * </ul>
 */
final class BulkSyncLoteReader {
    static final long MAX_BYTES_POR_DEFECTO = 2L * 1024 * 1024;
    static final int MAX_ELEMENTOS_POR_DEFECTO = 1000;

    private static final JsonMapper MAPPER = JsonMapper.builder()
            .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS)
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            // 9007199254740993.0 no debe convertirse silenciosamente en otro itemId: decimales en enteros invalidan.
            .disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT)
            .build();

    private BulkSyncLoteReader() {
    }

    static List<SaveAnswerCommand> leer(Long attemptId, InputStream cuerpo, long maxBytes) {
        return leer(attemptId, cuerpo, null, maxBytes, MAX_ELEMENTOS_POR_DEFECTO);
    }

    /**
     * @param charset charset declarado en Content-Type (null = UTF-8). La decodificacion es estricta
     *                (CodingErrorAction.REPORT): secuencias invalidas o sobrelargas son 400, nunca texto alterado.
     */
    static List<SaveAnswerCommand> leer(Long attemptId, InputStream cuerpo, Charset charset, long maxBytes,
            int maxElementos) {
        List<SaveAnswerCommand> lote = new ArrayList<>();
        try (JsonParser p = MAPPER.createParser(lectorEstricto(new LimiteInputStream(cuerpo, maxBytes), charset))) {
            if (p.nextToken() != JsonToken.START_ARRAY) {
                throw cuerpoInvalido();
            }
            JsonToken token;
            while ((token = p.nextToken()) != JsonToken.END_ARRAY) {
                if (token == null) {
                    throw cuerpoInvalido();
                }
                if (lote.size() >= maxElementos) {
                    // Antes de llamar al servicio: un lote enorme retendria el bloqueo compartido de la sesion.
                    throw LoteDemasiadoGrandeException.porElementos(maxElementos);
                }
                if (token == JsonToken.VALUE_NULL) {
                    lote.add(new SaveAnswerCommand(attemptId, null, List.of(), null, null, null));
                    continue;
                }
                TokenBuffer elemento = TokenBuffer.forBuffering(p, ObjectReadContext.empty());
                elemento.copyCurrentStructure(p);
                lote.add(convertir(attemptId, elemento));
            }
            if (p.nextToken() != null) {
                throw cuerpoInvalido();
            }
        } catch (LoteDemasiadoGrandeException ex) {
            throw ex;
        } catch (JacksonException ex) {
            LoteDemasiadoGrandeException excedido = buscarExceso(ex);
            if (excedido != null) {
                throw excedido;
            }
            throw cuerpoInvalido();
        }
        return lote;
    }

    private static Reader lectorEstricto(InputStream bytes, Charset charset) {
        Charset efectivo = charset == null ? StandardCharsets.UTF_8 : charset;
        CharsetDecoder decoder = efectivo.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT);
        PushbackReader lector = new PushbackReader(new InputStreamReader(bytes, decoder), 1);
        return new FilterReader(lector) {
            private boolean inicio = true;

            @Override
            public int read() throws IOException {
                saltarBom();
                return super.read();
            }

            @Override
            public int read(char[] buffer, int off, int len) throws IOException {
                saltarBom();
                return super.read(buffer, off, len);
            }

            /** BOM inicial (U+FEFF) aceptado, como el conversor estandar. */
            private void saltarBom() throws IOException {
                if (inicio) {
                    inicio = false;
                    int primero = lector.read();
                    if (primero >= 0 && primero != '\uFEFF') {
                        lector.unread(primero);
                    }
                }
            }
        };
    }

    private static SaveAnswerCommand convertir(Long attemptId, TokenBuffer elemento) {
        try (JsonParser p = elemento.asParser(MAPPER._deserializationContext())) {
            SaveAnswerRequest r = MAPPER.readValue(p, SaveAnswerRequest.class);
            if (r == null) {
                return SaveAnswerCommand.invalida(attemptId, itemIdLegible(elemento));
            }
            return new SaveAnswerCommand(attemptId, r.itemId(), r.selectedOptionIds(), r.textAnswer(),
                    r.numericAnswer(), r.timeUsedSeconds());
        } catch (RuntimeException ex) {
            // JacksonException, NumberFormatException (exponente fuera de rango) o ArithmeticException.
            return SaveAnswerCommand.invalida(attemptId, itemIdLegible(elemento));
        }
    }

    /** itemId de primer nivel si es un entero JSON que cabe en long; recorre tokens sin convertir otros numeros. */
    private static Long itemIdLegible(TokenBuffer elemento) {
        try (JsonParser p = elemento.asParser()) {
            if (p.nextToken() != JsonToken.START_OBJECT) {
                return null;
            }
            while (p.nextToken() == JsonToken.PROPERTY_NAME) {
                String nombre = p.currentName();
                JsonToken valor = p.nextToken();
                if ("itemId".equals(nombre) && valor == JsonToken.VALUE_NUMBER_INT
                        && p.getNumberType() != JsonParser.NumberType.BIG_INTEGER) {
                    return p.getLongValue();
                }
                p.skipChildren();
            }
            return null;
        } catch (RuntimeException ex) {
            return null;
        }
    }

    private static LoteDemasiadoGrandeException buscarExceso(Throwable ex) {
        for (Throwable t = ex; t != null; t = t.getCause()) {
            if (t instanceof LoteDemasiadoGrandeException excedido) {
                return excedido;
            }
        }
        return null;
    }

    private static IllegalArgumentException cuerpoInvalido() {
        return new IllegalArgumentException("El cuerpo debe ser un arreglo JSON de respuestas");
    }

    /** Corta la lectura al superar el limite, tambien sin Content-Length (chunked). */
    private static final class LimiteInputStream extends FilterInputStream {
        private final long maxBytes;
        private long leidos;

        LimiteInputStream(InputStream in, long maxBytes) {
            super(in);
            this.maxBytes = maxBytes;
        }

        @Override
        public int read() throws IOException {
            int b = super.read();
            if (b >= 0) {
                contar(1);
            }
            return b;
        }

        @Override
        public int read(byte[] buffer, int off, int len) throws IOException {
            int n = super.read(buffer, off, len);
            if (n > 0) {
                contar(n);
            }
            return n;
        }

        @Override
        public long skip(long n) throws IOException {
            long s = super.skip(n);
            contar(s);
            return s;
        }

        private void contar(long n) {
            leidos += n;
            if (leidos > maxBytes) {
                throw LoteDemasiadoGrandeException.porBytes(maxBytes);
            }
        }
    }
}

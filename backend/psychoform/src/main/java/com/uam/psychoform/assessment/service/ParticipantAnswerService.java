package com.uam.psychoform.assessment.service;

import com.uam.psychoform.assessment.model.EstadoIntento;
import com.uam.psychoform.assessment.model.IntentoSubtest;
import com.uam.psychoform.assessment.model.IntentoTest;
import com.uam.psychoform.assessment.model.OpcionSeleccionadaRespuesta;
import com.uam.psychoform.assessment.model.OpcionSeleccionadaRespuestaId;
import com.uam.psychoform.assessment.model.RespuestaItem;
import com.uam.psychoform.assessment.repository.IntentoSubtestRepository;
import com.uam.psychoform.assessment.repository.IntentoTestRepository;
import com.uam.psychoform.assessment.repository.OpcionSeleccionadaRespuestaRepository;
import com.uam.psychoform.assessment.repository.RespuestaItemRepository;
import com.uam.psychoform.assessment.repository.RespuestaRechazadaRepository;
import com.uam.psychoform.instrument.model.Item;
import com.uam.psychoform.instrument.model.OpcionItem;
import com.uam.psychoform.instrument.model.TipoRespuesta;
import com.uam.psychoform.instrument.repository.ItemLookupRepository;
import com.uam.psychoform.instrument.repository.OpcionItemLookupRepository;
import jakarta.persistence.EntityNotFoundException;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Objects;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Guardado de respuestas del participante.
 *
 * Regla de tiempo (PUT y bulk-sync por igual): solo se escribe en un subtest iniciado y EN_PROGRESO cuyo tiempo
 * efectivo no supere limite + gracia. Si el tiempo se agoto, el subtest se cierra "tal como estaba" (respuestas
 * guardadas hasta ese momento + respuestas vacias para los items omitidos) en la misma transaccion, y la respuesta
 * tardia no se guarda. PUT responde 409 TIEMPO_AGOTADO; bulk-sync no aborta el lote: informa el resultado por item
 * para que el cliente pueda vaciar su cola.
 */
@Service
@Transactional(readOnly = true)
public class ParticipantAnswerService {
    public static final String RESULTADO_GUARDADA = "GUARDADA";
    public static final String RESULTADO_RECHAZADA = "RECHAZADA";
    public static final String SUBTEST_NO_INICIADO = "SUBTEST_NO_INICIADO";
    public static final String SUBTEST_FINALIZADO = "SUBTEST_FINALIZADO";
    public static final String ITEM_NO_ENCONTRADO = "ITEM_NO_ENCONTRADO";
    public static final String OPCION_INVALIDA = "OPCION_INVALIDA";
    public static final String RESPUESTA_INVALIDA = "RESPUESTA_INVALIDA";
    static final int MAX_OPCIONES_POR_RESPUESTA = 1000;
    /** respuesta_numerica es DECIMAL(12,4): como maximo 8 digitos enteros tras redondear a 4 decimales. */
    private static final BigDecimal LIMITE_NUMERICO = new BigDecimal("100000000");
    private static final int ESCALA_NUMERICA = 4;

    private final IntentoTestRepository intentos;
    private final RespuestaItemRepository respuestas;
    private final OpcionSeleccionadaRespuestaRepository opcionesSeleccionadas;
    private final ItemLookupRepository items;
    private final OpcionItemLookupRepository opciones;
    private final SessionWriteGuard sessionWriteGuard;
    private final IntentoSubtestRepository intentoSubtests;
    private final SubtestClosingService closing;
    private final RespuestaRechazadaRepository rechazos;
    private final Clock clock;

    public ParticipantAnswerService(IntentoTestRepository intentos, RespuestaItemRepository respuestas,
            OpcionSeleccionadaRespuestaRepository opcionesSeleccionadas, ItemLookupRepository items,
            OpcionItemLookupRepository opciones, SessionWriteGuard sessionWriteGuard,
            IntentoSubtestRepository intentoSubtests, SubtestClosingService closing,
            RespuestaRechazadaRepository rechazos, Clock clock) {
        this.intentos = intentos;
        this.respuestas = respuestas;
        this.opcionesSeleccionadas = opcionesSeleccionadas;
        this.items = items;
        this.opciones = opciones;
        this.sessionWriteGuard = sessionWriteGuard;
        this.intentoSubtests = intentoSubtests;
        this.closing = closing;
        this.rechazos = rechazos;
        this.clock = clock;
    }

    /** PUT respuesta. noRollbackFor: el cierre por tiempo agotado se confirma aunque la peticion responda 409. */
    @Transactional(noRollbackFor = TiempoAgotadoException.class)
    public RespuestaItem saveAnswer(ParticipantAccessService.ParticipantAccess access, SaveAnswerCommand command) {
        Contexto contexto = prepare(access, command);
        switch (contexto.estado()) {
            case NO_INICIADO -> throw new ParticipantConflictException(SUBTEST_NO_INICIADO, "El subtest no ha sido iniciado");
            case FINALIZADO -> throw new ParticipantConflictException(SUBTEST_FINALIZADO, "El subtest ya fue finalizado");
            case TIEMPO_AGOTADO -> throw new TiempoAgotadoException();
            default -> {
                List<OpcionItem> selected = validarOpciones(contexto.item(), command.selectedOptionIds());
                validarAlmacenamiento(contexto.item(), command, selected.size());
                return persist(contexto, command, selected);
            }
        }
    }

    /**
     * Cada item se resuelve por separado. Los errores propios del item (item inexistente u opciones invalidas) se
     * validan antes de escribir nada y se informan como RECHAZADA, sin revertir lo demas del lote. Los errores del
     * intento o de la sesion (alcance, sesion pausada, intento finalizado) siguen abortando el lote completo.
     */
    @Transactional
    public List<BulkSyncResult> bulkSyncAnswers(ParticipantAccessService.ParticipantAccess access,
            BulkSyncAnswersCommand command) {
        return command.answers().stream().map(answer -> registrarSiRechazada(command.intentoId(),
                procesarRespuesta(access, answer))).toList();
    }

    /**
     * B17: el rechazo no aborta el lote, pero queda en la bitacora (upsert, misma transaccion) para que el monitor
     * de sesion lo muestre. Sin itemId no hay fila posible (item_id NOT NULL): solo se informa al participante.
     */
    private BulkSyncResult registrarSiRechazada(Long intentoId, BulkSyncResult resultado) {
        if (RESULTADO_RECHAZADA.equals(resultado.status()) && resultado.itemId() != null) {
            rechazos.registrar(intentoId, resultado.itemId(), resultado.code(), LocalDateTime.now(clock));
        }
        return resultado;
    }

    private BulkSyncResult procesarRespuesta(ParticipantAccessService.ParticipantAccess access,
            SaveAnswerCommand answer) {
        if (answer.entradaInvalida()) {
            try {
                // Solo las validaciones de intento y sesion (sin item): una sesion pausada sigue abortando el lote.
                prepare(access, SaveAnswerCommand.invalida(answer.intentoId(), null));
            } catch (ItemNoEncontradoException esperado) {
                // prepare siempre termina aqui con itemId nulo cuando intento y sesion son operables.
            }
            return BulkSyncResult.rechazada(answer.itemId(), RESPUESTA_INVALIDA);
        }
        Contexto contexto;
        try {
            contexto = prepare(access, answer);
        } catch (ItemNoEncontradoException ex) {
            return BulkSyncResult.rechazada(answer.itemId(), ITEM_NO_ENCONTRADO);
        }
        return switch (contexto.estado()) {
            case NO_INICIADO -> BulkSyncResult.rechazada(answer.itemId(), SUBTEST_NO_INICIADO);
            case FINALIZADO -> BulkSyncResult.rechazada(answer.itemId(), SUBTEST_FINALIZADO);
            case TIEMPO_AGOTADO -> BulkSyncResult.rechazada(answer.itemId(), ParticipantConflictException.TIEMPO_AGOTADO);
            case PERMITIDA -> {
                List<OpcionItem> selected;
                try {
                    selected = validarOpciones(contexto.item(), answer.selectedOptionIds());
                } catch (EntityNotFoundException | IllegalArgumentException ex) {
                    yield BulkSyncResult.rechazada(answer.itemId(), OPCION_INVALIDA);
                }
                try {
                    validarAlmacenamiento(contexto.item(), answer, selected.size());
                } catch (RespuestaInvalidaException ex) {
                    yield BulkSyncResult.rechazada(answer.itemId(), RESPUESTA_INVALIDA);
                }
                RespuestaItem guardada = persist(contexto, answer, selected);
                yield new BulkSyncResult(answer.itemId(), RESULTADO_GUARDADA, null, guardada.getId());
            }
        };
    }

    private Contexto prepare(ParticipantAccessService.ParticipantAccess access, SaveAnswerCommand command) {
        IntentoTest intento = intentos.findByIdForUpdate(command.intentoId())
                .orElseThrow(() -> new EntityNotFoundException("Intento no encontrado: " + command.intentoId()));
        requireAttemptScope(access, intento);
        Long sesionId = intento.getAsignacion().getSesionAplicacion().getId();
        sessionWriteGuard.requireWritable(sesionId);
        if (intento.getEstado() == EstadoIntento.COMPLETADO || intento.getEstado() == EstadoIntento.ANULADO) {
            throw new IllegalStateException("El intento no permite respuestas");
        }
        if (command.itemId() == null) {
            // Antes del repositorio: findById(null) lanzaria dentro del proxy y dejaria la transaccion rollback-only.
            throw new ItemNoEncontradoException(null);
        }
        Item item = items.findById(command.itemId())
                .orElseThrow(() -> new ItemNoEncontradoException(command.itemId()));
        LocalDateTime now = LocalDateTime.now(clock);
        if (item.getSubtest() == null) {
            return new Contexto(intento, item, null, now, EstadoEscritura.PERMITIDA);
        }
        IntentoSubtest intentoSubtest = intentoSubtests
                .findByIntentoIdAndSubtestId(command.intentoId(), item.getSubtest().getId()).orElse(null);
        if (intentoSubtest == null || intentoSubtest.getIniciadoEn() == null) {
            return new Contexto(intento, item, intentoSubtest, now, EstadoEscritura.NO_INICIADO);
        }
        if (intentoSubtest.getEstado() != EstadoIntento.EN_PROGRESO) {
            return new Contexto(intento, item, intentoSubtest, now, EstadoEscritura.FINALIZADO);
        }
        if (closing.tiempoAgotado(intentoSubtest, sesionId, now)) {
            closing.cerrar(intentoSubtest, sesionId, now);
            return new Contexto(intento, item, intentoSubtest, now, EstadoEscritura.TIEMPO_AGOTADO);
        }
        return new Contexto(intento, item, intentoSubtest, now, EstadoEscritura.PERMITIDA);
    }

    /** Valida (sin escribir) que todas las opciones existan y pertenezcan al item. */
    private List<OpcionItem> validarOpciones(Item item, List<Long> selectedOptionIds) {
        if (selectedOptionIds.stream().anyMatch(Objects::isNull)) {
            // Antes del repositorio: un id nulo lanzaria dentro del proxy y dejaria la transaccion rollback-only.
            throw new EntityNotFoundException("Opcion no encontrada");
        }
        // Tambien antes del repositorio: listas enormes exceden el limite de parametros JDBC dentro del proxy.
        if (selectedOptionIds.size() > MAX_OPCIONES_POR_RESPUESTA
                || new java.util.HashSet<>(selectedOptionIds).size() != selectedOptionIds.size()) {
            throw new IllegalArgumentException("Opciones seleccionadas invalidas");
        }
        List<OpcionItem> selected = opciones.findAllById(selectedOptionIds);
        if (selected.size() != selectedOptionIds.size()) {
            throw new EntityNotFoundException("Opcion no encontrada");
        }
        for (OpcionItem option : selected) {
            if (!option.getItem().getId().equals(item.getId())) {
                throw new IllegalArgumentException("La opcion no pertenece al item");
            }
        }
        return selected;
    }

    /**
     * Mismas reglas que fn_bfa_problema_respuesta (validada por un trigger diferido al confirmar): se comprueban
     * antes de escribir para que una respuesta incompatible no revierta la transaccion completa. Una respuesta vacia
     * siempre es valida y el texto en blanco cuenta como ausencia de texto.
     */
    private static void validarAlmacenamiento(Item item, SaveAnswerCommand command, int selecciones) {
        TipoRespuesta tipo = item.getTipoRespuesta();
        if (tipo == null) {
            return;
        }
        if (command.timeUsedSeconds() != null && command.timeUsedSeconds() < 0) {
            throw new RespuestaInvalidaException("El tiempo usado no puede ser negativo");
        }
        if (command.textAnswer() != null && command.textAnswer().indexOf('\u0000') >= 0) {
            throw new RespuestaInvalidaException("La respuesta de texto contiene caracteres no permitidos");
        }
        normalizarNumero(command.numericAnswer());
        // Igual que btrim(texto) en el trigger: solo los espacios ' ' cuentan como ausencia de texto.
        boolean tieneTexto = command.textAnswer() != null && !command.textAnswer().replace(" ", "").isEmpty();
        if (tieneTexto && tipo != TipoRespuesta.TEXTO_ABIERTO) {
            throw new RespuestaInvalidaException("Respuesta de texto no permitida para items " + tipo);
        }
        if (command.numericAnswer() != null && tipo != TipoRespuesta.NUMERICA) {
            throw new RespuestaInvalidaException("Respuesta numerica no permitida para items " + tipo);
        }
        boolean admiteOpciones = tipo == TipoRespuesta.OPCION_UNICA || tipo == TipoRespuesta.OPCION_MULTIPLE
                || tipo == TipoRespuesta.VERDADERO_FALSO;
        if (selecciones > 0 && !admiteOpciones) {
            throw new RespuestaInvalidaException("Opciones seleccionadas no permitidas para items " + tipo);
        }
        if (selecciones > 1 && (tipo == TipoRespuesta.OPCION_UNICA || tipo == TipoRespuesta.VERDADERO_FALSO)) {
            throw new RespuestaInvalidaException("Los items " + tipo + " admiten a lo sumo una opcion seleccionada");
        }
    }

    /**
     * Lleva el numero a la escala de la columna DECIMAL(12,4) sin operar con exponentes extremos: la magnitud se
     * evalua antes de redondear (setScale con escalas enormes agota memoria o lanza ArithmeticException). Se persiste
     * este mismo valor normalizado, nunca el original.
     */
    static BigDecimal normalizarNumero(BigDecimal valor) {
        if (valor == null) {
            return null;
        }
        if (valor.signum() == 0) {
            return BigDecimal.ZERO.setScale(ESCALA_NUMERICA);
        }
        // Exponente decimal del digito mas significativo: |valor| esta en [10^e, 10^(e+1)).
        long exponente = (long) valor.precision() - valor.scale() - 1;
        if (exponente >= 8) {
            throw new RespuestaInvalidaException("La respuesta numerica excede el rango permitido");
        }
        if (exponente < -(ESCALA_NUMERICA + 1)) {
            // |valor| < 10^-5 redondea a cero en cuatro decimales.
            return BigDecimal.ZERO.setScale(ESCALA_NUMERICA);
        }
        BigDecimal normalizado = valor.setScale(ESCALA_NUMERICA, java.math.RoundingMode.HALF_UP);
        if (normalizado.abs().compareTo(LIMITE_NUMERICO) >= 0) {
            throw new RespuestaInvalidaException("La respuesta numerica excede el rango permitido");
        }
        return normalizado;
    }

    /** Respuesta incompatible con el tipo de respuesta del item: 400 en PUT, RECHAZADA en bulk-sync. */
    static class RespuestaInvalidaException extends IllegalArgumentException {
        RespuestaInvalidaException(String message) {
            super(message);
        }
    }

    private RespuestaItem persist(Contexto contexto, SaveAnswerCommand command, List<OpcionItem> selected) {
        Item item = contexto.item();
        IntentoTest intento = contexto.intento();
        LocalDateTime now = contexto.now();

        RespuestaItem respuesta = respuestas.findByIntentoIdAndItemId(command.intentoId(), command.itemId())
                .orElseGet(() -> newAnswer(intento, item));
        if (contexto.intentoSubtest() != null) {
            respuesta.setIntentoSubtest(contexto.intentoSubtest());
        }
        respuesta.setRespuestaTextoAbierto(command.textAnswer());
        respuesta.setRespuestaNumerica(normalizarNumero(command.numericAnswer()));
        respuesta.setTiempoUsadoSegundos(command.timeUsedSeconds());
        respuesta.setRespondidoEn(now);
        respuesta.setEsFinal(true);
        respuesta.setRequiereRevisionManual(false);
        respuestas.save(respuesta);
        intento.setUltimaActividadEn(now);

        if (respuesta.getId() != null) {
            opcionesSeleccionadas.deleteByRespuestaId(respuesta.getId());
        }
        for (OpcionItem option : selected) {
            OpcionSeleccionadaRespuesta selectedOption = new OpcionSeleccionadaRespuesta();
            OpcionSeleccionadaRespuestaId id = new OpcionSeleccionadaRespuestaId();
            id.setRespuestaId(respuesta.getId());
            id.setOpcionId(option.getId());
            selectedOption.setId(id);
            selectedOption.setRespuesta(respuesta);
            selectedOption.setItem(item);
            selectedOption.setOpcion(option);
            selectedOption.setSeleccionadaEn(now);
            opcionesSeleccionadas.save(selectedOption);
        }
        return respuesta;
    }

    private static void requireAttemptScope(ParticipantAccessService.ParticipantAccess access, IntentoTest intento) {
        if (!Objects.equals(intento.getAsignacion().getId(), access.assignmentId())) {
            throw new AccessDeniedException("Intento fuera de alcance");
        }
    }

    private static RespuestaItem newAnswer(IntentoTest intento, Item item) {
        RespuestaItem respuesta = new RespuestaItem();
        respuesta.setIntento(intento);
        respuesta.setItem(item);
        return respuesta;
    }

    /** Item inexistente: 404 en PUT (EntityNotFoundException), RECHAZADA en bulk-sync. */
    static class ItemNoEncontradoException extends EntityNotFoundException {
        ItemNoEncontradoException(Long itemId) {
            super("Item no encontrado: " + itemId);
        }
    }

    private enum EstadoEscritura { PERMITIDA, NO_INICIADO, FINALIZADO, TIEMPO_AGOTADO }

    private record Contexto(IntentoTest intento, Item item, IntentoSubtest intentoSubtest, LocalDateTime now,
            EstadoEscritura estado) {
    }

    /** Resultado por item de bulk-sync: GUARDADA (con answerId) o RECHAZADA (con code). */
    public record BulkSyncResult(Long itemId, String status, String code, Long answerId) {
        static BulkSyncResult rechazada(Long itemId, String code) {
            return new BulkSyncResult(itemId, RESULTADO_RECHAZADA, code, null);
        }
    }

    /** entradaInvalida: el elemento JSON del lote no pudo leerse; se informa RECHAZADA sin tocar el item. */
    public record SaveAnswerCommand(Long intentoId, Long itemId, List<Long> selectedOptionIds, String textAnswer,
            BigDecimal numericAnswer, Integer timeUsedSeconds, boolean entradaInvalida) {
        public SaveAnswerCommand(Long intentoId, Long itemId, List<Long> selectedOptionIds, String textAnswer,
                BigDecimal numericAnswer, Integer timeUsedSeconds) {
            this(intentoId, itemId, selectedOptionIds, textAnswer, numericAnswer, timeUsedSeconds, false);
        }

        public static SaveAnswerCommand invalida(Long intentoId, Long itemId) {
            return new SaveAnswerCommand(intentoId, itemId, List.of(), null, null, null, true);
        }
    }

    public record BulkSyncAnswersCommand(Long intentoId, List<SaveAnswerCommand> answers) {
        public BulkSyncAnswersCommand {
            answers = answers.stream()
                    .map(answer -> new SaveAnswerCommand(intentoId, answer.itemId(), answer.selectedOptionIds(),
                            answer.textAnswer(), answer.numericAnswer(), answer.timeUsedSeconds(),
                            answer.entradaInvalida()))
                    .toList();
        }
    }
}

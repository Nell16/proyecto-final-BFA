package com.uam.psychoform.assessment.service;

import com.uam.psychoform.assessment.model.AsignacionTest;
import com.uam.psychoform.assessment.model.IntentoSubtest;
import com.uam.psychoform.assessment.model.EstadoAsignacion;
import com.uam.psychoform.assessment.model.EstadoSesionAplicacion;
import com.uam.psychoform.assessment.model.PausaSesion;
import com.uam.psychoform.assessment.model.IntentoTest;
import com.uam.psychoform.assessment.model.SesionSubtest;
import com.uam.psychoform.assessment.repository.AsignacionTestRepository;
import com.uam.psychoform.assessment.repository.IntentoSubtestRepository;
import com.uam.psychoform.assessment.repository.IntentoTestRepository;
import com.uam.psychoform.assessment.repository.SesionSubtestRepository;
import com.uam.psychoform.instrument.model.ImagenItem;
import com.uam.psychoform.instrument.model.ImagenOpcion;
import com.uam.psychoform.instrument.model.Item;
import com.uam.psychoform.instrument.model.OpcionItem;
import com.uam.psychoform.instrument.repository.ImagenItemRepository;
import com.uam.psychoform.instrument.repository.ImagenOpcionRepository;
import com.uam.psychoform.instrument.repository.ItemLookupRepository;
import com.uam.psychoform.instrument.repository.OpcionItemLookupRepository;
import com.uam.psychoform.security.model.EstadoGeneral;
import jakarta.persistence.EntityNotFoundException;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.stream.Collectors;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
public class ParticipantEvaluationView {
    private final AsignacionTestRepository asignaciones;
    private final IntentoTestRepository intentos;
    private final IntentoSubtestRepository intentoSubtests;
    private final SesionSubtestRepository sesionSubtests;
    private final ItemLookupRepository items;
    private final OpcionItemLookupRepository opciones;
    private final ImagenItemRepository imagenesItem;
    private final ImagenOpcionRepository imagenesOpcion;
    private final SubtestTimingService timing;

    public ParticipantEvaluationView(AsignacionTestRepository asignaciones, IntentoTestRepository intentos,
            IntentoSubtestRepository intentoSubtests, SesionSubtestRepository sesionSubtests,
            ItemLookupRepository items, OpcionItemLookupRepository opciones,
            ImagenItemRepository imagenesItem, ImagenOpcionRepository imagenesOpcion,
            SubtestTimingService timing) {
        this.asignaciones = asignaciones;
        this.intentos = intentos;
        this.intentoSubtests = intentoSubtests;
        this.sesionSubtests = sesionSubtests;
        this.items = items;
        this.opciones = opciones;
        this.imagenesItem = imagenesItem;
        this.imagenesOpcion = imagenesOpcion;
        this.timing = timing;
    }

    public EvaluationPayload getEvaluationPayload(long asignacionId) {
        AsignacionTest asignacion = asignaciones.findByIdWithSessionAndParticipant(asignacionId)
                .orElseThrow(() -> new EntityNotFoundException("Asignacion no encontrada: " + asignacionId));
        Optional<IntentoTest> intento = intentos.findByAsignacionId(asignacionId);
        Map<Long, IntentoSubtest> attemptSubtests = intento
                .map(existing -> intentoSubtests.findByIntentoIdWithSubtest(existing.getId()).stream()
                        .collect(Collectors.toMap(status -> status.getSubtest().getId(),
                                status -> status, (first, second) -> first)))
                .orElseGet(Map::of);
        Long sesionId = asignacion.getSesionAplicacion().getId();
        EstadoSesionAplicacion sessionState = asignacion.getSesionAplicacion().getEstado();
        List<PausaSesion> pausas = timing.loadPausas(sesionId);
        List<SesionSubtest> sessionSubtests = sesionSubtests
                .findBySesionAplicacionIdWithSubtestOrderByNumeroOrdenAsc(asignacion.getSesionAplicacion().getId());
        // Una asignacion COMPLETADO es de solo lectura: se devuelve el estado final sin items ni opciones.
        boolean completed = asignacion.getEstado() == EstadoAsignacion.COMPLETADO;
        List<Long> subtestIds = completed
                ? List.of()
                : sessionSubtests.stream().map(sesionSubtest -> sesionSubtest.getSubtest().getId()).toList();
        Map<Long, List<Item>> itemsBySubtest = subtestIds.isEmpty()
                ? Map.of()
                : items.findBySubtestIdInAndEstadoOrderBySubtestAndItemOrder(subtestIds, EstadoGeneral.ACTIVO)
                        .stream()
                        .collect(Collectors.groupingBy(item -> item.getSubtest().getId()));
        List<Long> itemIds = itemsBySubtest.values().stream().flatMap(List::stream).map(Item::getId).toList();
        Map<Long, List<OpcionItem>> optionsByItem = itemIds.isEmpty()
                ? Map.of()
                : opciones.findByItemIdInAndEstadoOrderByItemAndOptionOrder(itemIds, EstadoGeneral.ACTIVO).stream()
                        .collect(Collectors.groupingBy(option -> option.getItem().getId()));
        Map<Long, List<ImagenItem>> imagesByItem = itemIds.isEmpty()
                ? Map.of()
                : imagenesItem.findByItemIdInOrderByItemAndImageOrder(itemIds).stream()
                        .collect(Collectors.groupingBy(image -> image.getItem().getId()));
        List<Long> optionIds = optionsByItem.values().stream().flatMap(List::stream).map(OpcionItem::getId).toList();
        Map<Long, List<ImagenOpcion>> imagesByOption = optionIds.isEmpty()
                ? Map.of()
                : imagenesOpcion.findByOpcionIdInOrderByOptionAndImageOrder(optionIds).stream()
                        .collect(Collectors.groupingBy(image -> image.getOpcion().getId()));
        List<SubtestPayload> subtests = sessionSubtests.stream()
                .map(sesionSubtest -> toSubtestPayload(sesionSubtest, attemptSubtests, sessionState, pausas,
                        itemsBySubtest, optionsByItem, imagesByItem, imagesByOption))
                .toList();
        Long attemptId = intento.map(IntentoTest::getId).orElse(null);
        String attemptStatus = intento.map(existing -> existing.getEstado().name()).orElse("NO_INICIADO");
        return new EvaluationPayload(attemptId, asignacion.getId(), asignacion.getSesionAplicacion().getId(),
                participantDisplayName(asignacion), asignacion.getSesionAplicacion().getNombreSesion(),
                sessionState.name(), timing.toOffsetDateTime(asignacion.getSesionAplicacion().getPausadoEn()),
                attemptStatus, subtests,
                completed ? intento.map(existing -> timing.toOffsetDateTime(existing.getFinalizadoEn())).orElse(null)
                        : null);
    }

    public SubtestPayload getScopedSubtestPayload(ParticipantAccessService.ParticipantAccess access, long attemptId,
            long subtestId) {
        IntentoTest intento = intentos.findById(attemptId)
                .orElseThrow(() -> new EntityNotFoundException("Intento no encontrado: " + attemptId));
        if (!Objects.equals(intento.getAsignacion().getId(), access.assignmentId())) {
            throw new AccessDeniedException("Intento fuera de alcance");
        }
        return getEvaluationPayload(access.assignmentId()).subtests().stream()
                .filter(subtest -> subtest.subtestId() == subtestId)
                .findFirst()
                .orElseThrow(() -> new EntityNotFoundException("Subtest no encontrado en intento"));
    }

    private SubtestPayload toSubtestPayload(SesionSubtest sesionSubtest, Map<Long, IntentoSubtest> attemptSubtests,
            EstadoSesionAplicacion sessionState, List<PausaSesion> pausas, Map<Long, List<Item>> itemsBySubtest, Map<Long, List<OpcionItem>> optionsByItem,
            Map<Long, List<ImagenItem>> imagesByItem, Map<Long, List<ImagenOpcion>> imagesByOption) {
        List<ItemPayload> itemPayloads = itemsBySubtest.getOrDefault(sesionSubtest.getSubtest().getId(), List.of())
                .stream()
                .map(item -> toItemPayload(item, optionsByItem, imagesByItem, imagesByOption))
                .toList();
        IntentoSubtest attemptSubtest = attemptSubtests.get(sesionSubtest.getSubtest().getId());
        SubtestTimingService.SubtestTiming subtestTiming = attemptSubtest == null
                ? timing.notStarted(sesionSubtest.getTiempoLimiteSegundos())
                : timing.forAttemptSubtest(attemptSubtest, sessionState, pausas);
        String status = attemptSubtest == null ? "NO_INICIADO" : attemptSubtest.getEstado().name();
        return new SubtestPayload(sesionSubtest.getSubtest().getId(), sesionSubtest.getSubtest().getCodigoSubtest(),
                sesionSubtest.getSubtest().getNombreSubtest(), sesionSubtest.getSubtest().getInstrucciones(),
                sesionSubtest.getNumeroOrden(), sesionSubtest.getTiempoLimiteSegundos(),
                sesionSubtest.getPermiteAleatorizarItems(), sesionSubtest.getPermiteAleatorizarOpciones(),
                status, subtestTiming.startedAt(), subtestTiming.remainingSeconds(), subtestTiming.paused(),
                subtestTiming.serverNow(), itemPayloads);
    }

    private ItemPayload toItemPayload(Item item, Map<Long, List<OpcionItem>> optionsByItem,
            Map<Long, List<ImagenItem>> imagesByItem, Map<Long, List<ImagenOpcion>> imagesByOption) {
        List<OptionPayload> optionPayloads = optionsByItem.getOrDefault(item.getId(), List.of()).stream()
                .map(option -> toOptionPayload(option, imagesByOption))
                .toList();
        List<ItemImagePayload> imagePayloads = imagesByItem.getOrDefault(item.getId(), List.of()).stream()
                .map(this::toItemImagePayload)
                .toList();
        return new ItemPayload(item.getId(), item.getCodigoItem(), item.getTipoItem().name(),
                item.getTipoRespuesta().name(), item.getEnunciado(), item.getInstruccion(), item.getNumeroOrden(),
                item.getTiempoLimiteSegundos(), item.getEsObligatorio(), imagePayloads, optionPayloads);
    }

    private OptionPayload toOptionPayload(OpcionItem opcion, Map<Long, List<ImagenOpcion>> imagesByOption) {
        List<OptionImagePayload> imagePayloads = imagesByOption.getOrDefault(opcion.getId(), List.of()).stream()
                .map(this::toOptionImagePayload)
                .toList();
        return new OptionPayload(opcion.getId(), opcion.getCodigoOpcion(), opcion.getTextoOpcion(),
                opcion.getNumeroOrden(), opcion.getValorOrdinal(), imagePayloads);
    }

    private ItemImagePayload toItemImagePayload(ImagenItem image) {
        return new ItemImagePayload(
                image.getId(),
                "/items/images/resources/" + image.getRecurso().getId(),
                image.getRolImagen(),
                image.getNumeroOrden(),
                image.getTextoAlternativo()
        );
    }

    private OptionImagePayload toOptionImagePayload(ImagenOpcion image) {
        return new OptionImagePayload(
                image.getId(),
                "/items/images/resources/" + image.getRecurso().getId(),
                image.getNumeroOrden(),
                image.getTextoAlternativo()
        );
    }

    private static String participantDisplayName(AsignacionTest asignacion) {
        return (asignacion.getParticipante().getNombres() + " " + asignacion.getParticipante().getApellidos()).trim();
    }

    /** {@code finishedAt}: fin del intento; solo se informa cuando la asignacion esta COMPLETADO (B21). */
    public record EvaluationPayload(Long id, long assignmentId, long sessionId, String participantDisplayName,
            String sessionName, String sessionStatus, java.time.OffsetDateTime pausedAt, String attemptStatus, List<SubtestPayload> subtests,
            java.time.OffsetDateTime finishedAt) {
        public EvaluationPayload(Long id, long assignmentId, long sessionId, String participantDisplayName,
                String sessionName, String sessionStatus, java.time.OffsetDateTime pausedAt, String attemptStatus,
                List<SubtestPayload> subtests) {
            this(id, assignmentId, sessionId, participantDisplayName, sessionName, sessionStatus, pausedAt,
                    attemptStatus, subtests, null);
        }
    }

    public record SubtestPayload(long subtestId, String code, String name, String instructions, int order,
            Integer timeLimitSeconds, boolean randomizeItems, boolean randomizeOptions, String status,
            java.time.OffsetDateTime startedAt, Integer remainingSeconds, boolean paused,
            java.time.OffsetDateTime serverNow, List<ItemPayload> items) {
    }

    public record ItemPayload(long itemId, String code, String itemType, String responseType, String prompt,
            String instruction, int order, Integer timeLimitSeconds, boolean required,
            List<ItemImagePayload> images, List<OptionPayload> options) {
    }

    public record OptionPayload(long optionId, String code, String text, int order, java.math.BigDecimal ordinalValue,
            List<OptionImagePayload> images) {
    }

    public record ItemImagePayload(long imageId, String url, String role, int order, String altText) {
    }

    public record OptionImagePayload(long imageId, String url, int order, String altText) {
    }
}

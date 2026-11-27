package com.uam.psychoform.scoring.service;

import com.uam.psychoform.assessment.model.OpcionSeleccionadaRespuesta;
import com.uam.psychoform.assessment.model.RespuestaItem;
import com.uam.psychoform.assessment.repository.OpcionSeleccionadaRespuestaRepository;
import com.uam.psychoform.assessment.repository.RespuestaItemRepository;
import com.uam.psychoform.instrument.model.Baremo;
import com.uam.psychoform.instrument.model.ClaveRespuesta;
import com.uam.psychoform.instrument.model.DimensionResultado;
import com.uam.psychoform.instrument.model.OpcionPuntajeDimension;
import com.uam.psychoform.instrument.model.RangoBaremo;
import com.uam.psychoform.instrument.repository.BaremoRepository;
import com.uam.psychoform.instrument.repository.ClaveRespuestaLookupRepository;
import com.uam.psychoform.instrument.repository.DimensionResultadoLookupRepository;
import com.uam.psychoform.instrument.repository.OpcionPuntajeDimensionRepository;
import com.uam.psychoform.instrument.repository.RangoBaremoRepository;
import com.uam.psychoform.scoring.model.EstadoRevisionManual;
import com.uam.psychoform.scoring.model.ResultadoDimension;
import com.uam.psychoform.scoring.model.RevisionManualRespuesta;
import com.uam.psychoform.scoring.repository.RevisionManualRespuestaRepository;
import java.math.BigDecimal;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/**
 * Logica comun del puntaje por dimension/subtest que usan la calificacion y la resolucion de revisiones manuales:
 * que dimension recibe el puntaje de un subtest y como se resuelve su baremo/rango a partir del puntaje directo.
 */
@Component
class DimensionScoreSupport {
    private final DimensionResultadoLookupRepository dimensiones;
    private final BaremoRepository baremos;
    private final RangoBaremoRepository rangosBaremo;
    private final RespuestaItemRepository respuestas;
    private final OpcionSeleccionadaRespuestaRepository opcionesSeleccionadas;
    private final ClaveRespuestaLookupRepository claves;
    private final OpcionPuntajeDimensionRepository puntajesDimension;
    private final RevisionManualRespuestaRepository revisiones;

    DimensionScoreSupport(DimensionResultadoLookupRepository dimensiones, BaremoRepository baremos,
            RangoBaremoRepository rangosBaremo, RespuestaItemRepository respuestas,
            OpcionSeleccionadaRespuestaRepository opcionesSeleccionadas, ClaveRespuestaLookupRepository claves,
            OpcionPuntajeDimensionRepository puntajesDimension, RevisionManualRespuestaRepository revisiones) {
        this.dimensiones = dimensiones;
        this.baremos = baremos;
        this.rangosBaremo = rangosBaremo;
        this.respuestas = respuestas;
        this.opcionesSeleccionadas = opcionesSeleccionadas;
        this.claves = claves;
        this.puntajesDimension = puntajesDimension;
        this.revisiones = revisiones;
    }

    /** Dimension (la primera por orden de presentacion) que recibe el puntaje de cada subtest de la version. */
    Map<Long, DimensionResultado> dimensionsBySubtest(Long versionTestId) {
        Map<Long, DimensionResultado> bySubtest = new LinkedHashMap<>();
        for (DimensionResultado dimension : dimensiones.findActiveSubtestDimensionsByVersionId(versionTestId)) {
            bySubtest.putIfAbsent(dimension.getSubtest().getId(), dimension);
        }
        return bySubtest;
    }

    /** Un item requiere revision manual si lo marca su clave o la propia respuesta. */
    static boolean requiresManualReview(ClaveRespuesta clave, RespuestaItem respuesta) {
        return Boolean.TRUE.equals(clave.getRequiereRevisionManual())
                || Boolean.TRUE.equals(respuesta.getRequiereRevisionManual());
    }

    /** Matriz de puntaje por dimension (activa y oficial) de las opciones indicadas, agrupada por opcion. */
    Map<Long, List<OpcionPuntajeDimension>> optionScores(Long versionTestId, Collection<Long> optionIds) {
        if (optionIds.isEmpty()) {
            return Map.of();
        }
        return puntajesDimension.findActiveOfficialByVersionAndOptionIds(versionTestId, optionIds).stream()
                .collect(Collectors.groupingBy(row -> row.getOpcion().getId()));
    }

    /** Aporte automatico (matriz de opciones) de un item que no requiere revision manual. */
    static void accumulateAutomatic(List<Long> selectedOptionIds,
            Map<Long, List<OpcionPuntajeDimension>> optionScores, Map<Long, BigDecimal> directScoresByDimension,
            Map<Long, DimensionResultado> dimensionsById) {
        for (Long selectedOptionId : selectedOptionIds) {
            for (OpcionPuntajeDimension matrixRow : optionScores.getOrDefault(selectedOptionId, List.of())) {
                Long dimensionId = matrixRow.getDimensionResultado().getId();
                BigDecimal contribution = matrixRow.getPuntaje().multiply(matrixRow.getPeso());
                directScoresByDimension.merge(dimensionId, contribution, BigDecimal::add);
                dimensionsById.putIfAbsent(dimensionId, matrixRow.getDimensionResultado());
            }
        }
    }

    /**
     * Aporte de un item con revision manual: no suma matriz de opciones, aporta su puntaje (0 mientras esta pendiente
     * u observada, el asignado al revisarla) a la dimension de su subtest.
     */
    static void accumulateManual(RespuestaItem respuesta, BigDecimal score,
            Map<Long, DimensionResultado> dimensionsBySubtest, Map<Long, BigDecimal> directScoresByDimension,
            Map<Long, DimensionResultado> dimensionsById) {
        Long subtestId = respuesta.getItem().getSubtest() == null ? null : respuesta.getItem().getSubtest().getId();
        DimensionResultado subtestDimension = subtestId == null ? null : dimensionsBySubtest.get(subtestId);
        if (subtestDimension != null) {
            directScoresByDimension.merge(subtestDimension.getId(), score, BigDecimal::add);
            dimensionsById.putIfAbsent(subtestDimension.getId(), subtestDimension);
        }
    }

    /** Puntaje que una revision aporta: el asignado si esta REVISADO, 0 si esta pendiente u observada. */
    static BigDecimal reviewedScore(RevisionManualRespuesta review) {
        return review != null && review.getEstado() == EstadoRevisionManual.REVISADO && review.getPuntajeAsignado() != null
                ? review.getPuntajeAsignado()
                : BigDecimal.ZERO;
    }

    /**
     * Recalcula desde cero el puntaje directo de cada dimension de un intento con la regla vigente: aporte
     * automatico de las respuestas (excluidos los items con revision manual) mas el puntaje de las revisiones
     * REVISADO. Solo aparecen las dimensiones que reciben algun aporte.
     */
    Map<Long, BigDecimal> directScoresByDimension(Long versionTestId, Long attemptId) {
        Map<Long, ClaveRespuesta> keysByItem = claves.findOfficialKeysByVersionId(versionTestId).stream()
                .collect(Collectors.toMap(c -> c.getItem().getId(), Function.identity(), (first, second) -> first));
        List<RespuestaItem> attemptAnswers = respuestas.findByIntentoIdWithItem(attemptId);
        List<Long> answerIds = attemptAnswers.stream().map(RespuestaItem::getId).toList();
        if (answerIds.isEmpty()) {
            return Map.of();
        }
        Map<Long, List<OpcionSeleccionadaRespuesta>> selectionsByAnswer = opcionesSeleccionadas
                .findByRespuestaIdIn(answerIds).stream()
                .collect(Collectors.groupingBy(selection -> selection.getRespuesta().getId()));
        List<Long> selectedOptionIds = selectionsByAnswer.values().stream()
                .flatMap(List::stream)
                .map(selection -> selection.getOpcion().getId())
                .distinct()
                .toList();
        Map<Long, List<OpcionPuntajeDimension>> optionScores = optionScores(versionTestId, selectedOptionIds);
        Map<Long, RevisionManualRespuesta> reviewsByAnswer = revisiones.findByRespuestaIdIn(answerIds).stream()
                .collect(Collectors.toMap(review -> review.getRespuesta().getId(), Function.identity(),
                        (first, second) -> first));
        Map<Long, DimensionResultado> dimensionsBySubtest = dimensionsBySubtest(versionTestId);
        Map<Long, BigDecimal> directScores = new LinkedHashMap<>();
        Map<Long, DimensionResultado> dimensionsById = new LinkedHashMap<>();
        for (RespuestaItem respuesta : attemptAnswers) {
            ClaveRespuesta clave = keysByItem.get(respuesta.getItem().getId());
            if (clave == null) {
                continue;
            }
            if (requiresManualReview(clave, respuesta)) {
                accumulateManual(respuesta, reviewedScore(reviewsByAnswer.get(respuesta.getId())), dimensionsBySubtest,
                        directScores, dimensionsById);
            } else {
                List<Long> optionIds = selectionsByAnswer.getOrDefault(respuesta.getId(), List.of()).stream()
                        .map(selection -> selection.getOpcion().getId())
                        .toList();
                accumulateAutomatic(optionIds, optionScores, directScores, dimensionsById);
            }
        }
        return directScores;
    }

    /**
     * Resuelve baremo y rango de cada fila segun su puntaje directo actual. Si el puntaje cae fuera de todo rango (o
     * no hay baremo) se limpian los campos derivados, para que un recalculo no deje un rango obsoleto.
     */
    void applyBaremo(Long versionTestId, Collection<ResultadoDimension> rows) {
        if (rows.isEmpty()) {
            return;
        }
        List<Long> dimensionIds = rows.stream().map(row -> row.getDimensionResultado().getId()).toList();
        Map<Long, Baremo> preferredBaremosByDimension = baremos.findPreferredDimensionBaremos(versionTestId, dimensionIds)
                .stream()
                .collect(Collectors.toMap(baremo -> baremo.getDimensionResultado().getId(), Function.identity(),
                        (first, second) -> first));
        List<Long> baremoIds = preferredBaremosByDimension.values().stream().map(Baremo::getId).toList();
        Map<Long, List<RangoBaremo>> rangesByBaremo = baremoIds.isEmpty()
                ? Map.of()
                : rangosBaremo.findByBaremoIdInOrderByBaremoAndRangeOrder(baremoIds).stream()
                        .collect(Collectors.groupingBy(range -> range.getBaremo().getId()));
        for (ResultadoDimension row : rows) {
            Baremo baremo = preferredBaremosByDimension.get(row.getDimensionResultado().getId());
            row.setBaremo(baremo);
            RangoBaremo range = baremo == null ? null
                    : matchingRange(rangesByBaremo.getOrDefault(baremo.getId(), List.of()), row.getPuntajeDirecto());
            applyRange(row, range);
        }
    }

    private static RangoBaremo matchingRange(List<RangoBaremo> ranges, BigDecimal score) {
        return ranges.stream()
                .filter(range -> range.getPuntajeMinimo().compareTo(score) <= 0
                        && range.getPuntajeMaximo().compareTo(score) >= 0)
                .findFirst()
                .orElse(null);
    }

    private static void applyRange(ResultadoDimension row, RangoBaremo range) {
        row.setRangoBaremo(range);
        row.setCategoria(range == null ? null : range.getCategoria());
        row.setPercentil(range == null ? null : range.getPercentil());
        row.setInterpretacion(range == null ? null : range.getInterpretacion());
        row.setPuntajeTransformado(range == null ? null : range.getPercentil());
    }
}

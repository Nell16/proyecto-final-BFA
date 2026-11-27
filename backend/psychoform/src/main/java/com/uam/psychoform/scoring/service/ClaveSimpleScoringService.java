package com.uam.psychoform.scoring.service;

import com.uam.psychoform.assessment.model.EstadoIntento;
import com.uam.psychoform.assessment.model.IntentoTest;
import com.uam.psychoform.assessment.model.OpcionSeleccionadaRespuesta;
import com.uam.psychoform.assessment.model.RespuestaItem;
import com.uam.psychoform.assessment.repository.IntentoTestRepository;
import com.uam.psychoform.assessment.repository.OpcionSeleccionadaRespuestaRepository;
import com.uam.psychoform.assessment.repository.RespuestaItemRepository;
import com.uam.psychoform.instrument.model.ClaveRespuesta;
import com.uam.psychoform.instrument.model.DimensionResultado;
import com.uam.psychoform.instrument.model.EstadoVersionTest;
import com.uam.psychoform.instrument.model.OpcionPuntajeDimension;
import com.uam.psychoform.instrument.model.ReglaCalificacion;
import com.uam.psychoform.instrument.model.TipoEstrategiaCalificacion;
import com.uam.psychoform.instrument.model.VersionTest;
import com.uam.psychoform.instrument.repository.ClaveRespuestaLookupRepository;
import com.uam.psychoform.scoring.model.CalificacionRespuesta;
import com.uam.psychoform.scoring.model.EstadoRevisionManual;
import com.uam.psychoform.scoring.model.RevisionManualRespuesta;
import com.uam.psychoform.scoring.model.Resultado;
import com.uam.psychoform.scoring.model.ResultadoDimension;
import com.uam.psychoform.scoring.repository.CalificacionRespuestaRepository;
import com.uam.psychoform.scoring.repository.ResultadoDimensionRepository;
import com.uam.psychoform.scoring.repository.ResultadoRepository;
import com.uam.psychoform.scoring.repository.RevisionManualRespuestaRepository;
import com.uam.psychoform.security.CurrentActor;
import com.uam.psychoform.security.SecurityPermissions;
import com.uam.psychoform.security.model.Usuario;
import com.uam.psychoform.security.repository.UsuarioRepository;
import jakarta.persistence.EntityNotFoundException;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
public class ClaveSimpleScoringService {
    private final IntentoTestRepository intentos;
    private final ResultadoRepository resultados;
    private final RespuestaItemRepository respuestas;
    private final OpcionSeleccionadaRespuestaRepository opcionesSeleccionadas;
    private final ClaveRespuestaLookupRepository claves;
    private final DimensionScoreSupport dimensionScores;
    private final CalificacionRespuestaRepository calificaciones;
    private final ResultadoDimensionRepository resultadosDimension;
    private final RevisionManualRespuestaRepository revisiones;
    private final UsuarioRepository usuarios;
    private final CurrentActor currentActor;
    private final Clock clock;

    public ClaveSimpleScoringService(IntentoTestRepository intentos, ResultadoRepository resultados,
            RespuestaItemRepository respuestas, OpcionSeleccionadaRespuestaRepository opcionesSeleccionadas,
            ClaveRespuestaLookupRepository claves, DimensionScoreSupport dimensionScores,
            CalificacionRespuestaRepository calificaciones, ResultadoDimensionRepository resultadosDimension,
            RevisionManualRespuestaRepository revisiones, UsuarioRepository usuarios, CurrentActor currentActor, Clock clock) {
        this.intentos = intentos;
        this.resultados = resultados;
        this.respuestas = respuestas;
        this.opcionesSeleccionadas = opcionesSeleccionadas;
        this.claves = claves;
        this.dimensionScores = dimensionScores;
        this.calificaciones = calificaciones;
        this.resultadosDimension = resultadosDimension;
        this.revisiones = revisiones;
        this.usuarios = usuarios;
        this.currentActor = currentActor;
        this.clock = clock;
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.CALIFICACION_EJECUTAR)
    public Resultado scoreAttempt(long intentoId) {
        return resultados.findByIntentoId(intentoId)
                .map(this::ensurePendingReviews)
                .orElseGet(() -> calculate(intentoId));
    }

    /**
     * Recalificar no crea otro resultado (hay uno por intento): solo garantiza que cada calificacion con revision
     * manual pendiente tenga su revision, sin duplicar ni tocar las ya existentes (incluidas las resueltas).
     */
    private Resultado ensurePendingReviews(Resultado resultado) {
        List<CalificacionRespuesta> pending = calificaciones.findByResultadoId(resultado.getId()).stream()
                .filter(c -> Boolean.TRUE.equals(c.getRequiereRevisionManual()))
                .toList();
        if (pending.isEmpty()) {
            return resultado;
        }
        java.util.Set<Long> answersWithReview = revisiones
                .findByRespuestaIdIn(pending.stream().map(c -> c.getRespuesta().getId()).toList()).stream()
                .map(review -> review.getRespuesta().getId())
                .collect(Collectors.toSet());
        for (CalificacionRespuesta calificacion : pending) {
            if (!answersWithReview.contains(calificacion.getRespuesta().getId())) {
                createPendingReview(calificacion.getRespuesta(), calificacion.getReglaCalificacion());
            }
        }
        return resultado;
    }

    private void createPendingReview(RespuestaItem respuesta, ReglaCalificacion regla) {
        RevisionManualRespuesta review = new RevisionManualRespuesta();
        review.setRespuesta(respuesta);
        review.setReglaCalificacion(regla);
        review.setEstado(EstadoRevisionManual.PENDIENTE);
        review.setCreadoEn(LocalDateTime.now(clock));
        revisiones.save(review);
    }

    private Resultado calculate(long intentoId) {
        IntentoTest intento = intentos.findByIdForUpdate(intentoId)
                .orElseThrow(() -> new EntityNotFoundException("Intento no encontrado: " + intentoId));
        if (intento.getEstado() != EstadoIntento.COMPLETADO) {
            throw new IllegalStateException("El intento debe estar finalizado para calificar");
        }
        VersionTest version = intento.getAsignacion().getSesionAplicacion().getVersionTest();
        if (version.getEstado() != EstadoVersionTest.PUBLICADO) {
            throw new IllegalStateException("La version del test no esta publicada");
        }
        if (version.getEstrategiaCalificacion() == null
                || version.getEstrategiaCalificacion().getTipoEstrategia() != TipoEstrategiaCalificacion.CLAVE_SIMPLE) {
            throw new IllegalStateException("La version no usa CLAVE_SIMPLE");
        }
        UUID actorId = currentActor.usuarioId();
        Usuario actor = usuarios.findById(actorId)
                .orElseThrow(() -> new EntityNotFoundException("Usuario autenticado no encontrado: " + actorId));
        Map<Long, ClaveRespuesta> keysByItem = claves.findOfficialKeysByVersionId(version.getId()).stream()
                .collect(Collectors.toMap(c -> c.getItem().getId(), Function.identity()));
        Map<Long, Set<Long>> optionSetsByKey = loadOptionSets(keysByItem.values());
        List<RespuestaItem> attemptAnswers = respuestas.findByIntentoIdWithItem(intentoId);
        List<Long> answerIds = attemptAnswers.stream().map(RespuestaItem::getId).toList();
        Map<Long, List<OpcionSeleccionadaRespuesta>> selectionsByAnswer = answerIds.isEmpty()
                ? Map.of()
                : opcionesSeleccionadas.findByRespuestaIdIn(answerIds).stream()
                        .collect(Collectors.groupingBy(selection -> selection.getRespuesta().getId()));
        List<Long> selectedOptionIdsForAttempt = selectionsByAnswer.values().stream()
                .flatMap(List::stream)
                .map(selection -> selection.getOpcion().getId())
                .distinct()
                .toList();
        Map<Long, List<OpcionPuntajeDimension>> dimensionScoresByOption = dimensionScores.optionScores(version.getId(),
                selectedOptionIdsForAttempt);
        Map<Long, BigDecimal> directScoresByDimension = new java.util.LinkedHashMap<>();
        Map<Long, DimensionResultado> dimensionsById = new java.util.LinkedHashMap<>();
        Map<Long, DimensionResultado> dimensionsBySubtest = dimensionScores.dimensionsBySubtest(version.getId());
        Map<Long, RevisionManualRespuesta> reviewsByAnswer = answerIds.isEmpty()
                ? Map.of()
                : revisiones.findByRespuestaIdIn(answerIds).stream()
                        .collect(Collectors.toMap(review -> review.getRespuesta().getId(), Function.identity(),
                                (first, second) -> first));

        Resultado resultado = new Resultado();
        resultado.setIntento(intento);
        resultado.setEstrategiaCalificacion(version.getEstrategiaCalificacion());
        resultado.setCalculadoPor(actor);
        resultado.setCalculadoEn(LocalDateTime.now(clock));
        resultado.setPuntajeTotalDirecto(BigDecimal.ZERO);
        resultado.setCantidadItems(0);
        resultado.setCantidadCorrectas(0);
        resultado.setCantidadIncorrectas(0);
        resultado.setCantidadPendientesRevision(0);
        resultado.setRequiereRevisionManual(false);
        resultado.setEstado("CALCULADO");
        resultados.save(resultado);

        for (RespuestaItem respuesta : attemptAnswers) {
            ClaveRespuesta clave = keysByItem.get(respuesta.getItem().getId());
            if (clave == null) {
                continue;
            }
            List<OpcionSeleccionadaRespuesta> selections = selectionsByAnswer.getOrDefault(respuesta.getId(), List.of());
            List<Long> selectedOptionIds = selections.stream()
                    .map(OpcionSeleccionadaRespuesta::getOpcion)
                    .map(o -> o.getId())
                    .toList();
            boolean manualFlag = DimensionScoreSupport.requiresManualReview(clave, respuesta);
            RevisionManualRespuesta review = reviewsByAnswer.get(respuesta.getId());
            // Una revision ya resuelta se conserva y su puntaje se aplica al calcular.
            boolean resolved = manualFlag && review != null && review.getEstado() == EstadoRevisionManual.REVISADO
                    && review.getPuntajeAsignado() != null;
            // Un item con revision manual no se autocalifica: queda en 0 hasta que se resuelva la revision.
            boolean manualReview = manualFlag && !resolved;
            boolean correct;
            BigDecimal score;
            if (resolved) {
                score = review.getPuntajeAsignado();
                correct = score.signum() > 0;
            } else {
                correct = !manualFlag && ClaveCorrectnessEvaluator.isCorrect(
                        respuesta.getItem().getTipoRespuesta(), clave,
                        selections.stream()
                                .map(s -> new ClaveCorrectnessEvaluator.SelectedOption(s.getOpcion().getId(),
                                        s.getOpcion().getCodigoOpcion()))
                                .toList(),
                        optionSetsByKey.get(clave.getId()), respuesta.getRespuestaTextoAbierto(),
                        respuesta.getRespuestaNumerica());
                score = correct ? clave.getPuntaje() : BigDecimal.ZERO;
            }
            if (manualFlag) {
                DimensionScoreSupport.accumulateManual(respuesta, score, dimensionsBySubtest, directScoresByDimension,
                        dimensionsById);
            } else {
                DimensionScoreSupport.accumulateAutomatic(selectedOptionIds, dimensionScoresByOption,
                        directScoresByDimension, dimensionsById);
            }
            if (manualReview && review == null) {
                createPendingReview(respuesta, clave.getReglaCalificacion());
            }
            resultado.setCantidadItems(resultado.getCantidadItems() + 1);
            resultado.setPuntajeTotalDirecto(resultado.getPuntajeTotalDirecto().add(score));
            resultado.setCantidadCorrectas(resultado.getCantidadCorrectas() + (correct ? 1 : 0));
            resultado.setCantidadIncorrectas(resultado.getCantidadIncorrectas() + (correct ? 0 : 1));
            if (manualReview) {
                resultado.setCantidadPendientesRevision(resultado.getCantidadPendientesRevision() + 1);
                resultado.setRequiereRevisionManual(true);
            }
            CalificacionRespuesta calificacion = new CalificacionRespuesta();
            calificacion.setResultado(resultado);
            calificacion.setRespuesta(respuesta);
            calificacion.setReglaCalificacion(clave.getReglaCalificacion());
            calificacion.setOpcion(clave.getOpcionCorrecta());
            calificacion.setPuntajeObtenido(score);
            calificacion.setEsCorrecta(correct);
            calificacion.setRequiereRevisionManual(manualReview);
            calificacion.setCreadoEn(LocalDateTime.now(clock));
            calificaciones.save(calificacion);
        }
        createDimensionResults(resultado, version.getId(), directScoresByDimension, dimensionsById);
        resultados.save(resultado);
        return resultado;
    }

    private Map<Long, Set<Long>> loadOptionSets(java.util.Collection<ClaveRespuesta> keys) {
        List<Long> keyIds = keys.stream()
                .filter(key -> key.getId() != null)
                .map(ClaveRespuesta::getId)
                .toList();
        if (keyIds.isEmpty()) {
            return java.util.Collections.emptyMap();
        }
        return ClaveCorrectnessEvaluator.groupOptionSetRows(claves.findOptionSetRowsByKeyIds(keyIds));
    }

    private void createDimensionResults(Resultado resultado, Long versionTestId,
            Map<Long, BigDecimal> directScoresByDimension, Map<Long, DimensionResultado> dimensionsById) {
        List<ResultadoDimension> rows = new java.util.ArrayList<>();
        for (Map.Entry<Long, BigDecimal> entry : directScoresByDimension.entrySet()) {
            ResultadoDimension dimensionResult = new ResultadoDimension();
            dimensionResult.setResultado(resultado);
            dimensionResult.setDimensionResultado(dimensionsById.get(entry.getKey()));
            dimensionResult.setPuntajeDirecto(entry.getValue());
            dimensionResult.setRequiereRevisionManual(resultado.getRequiereRevisionManual());
            rows.add(dimensionResult);
        }
        dimensionScores.applyBaremo(versionTestId, rows);
        rows.forEach(resultadosDimension::save);
    }
}

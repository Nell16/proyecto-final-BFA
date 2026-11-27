package com.uam.psychoform.scoring.service;

import com.uam.psychoform.assessment.model.RespuestaItem;
import com.uam.psychoform.assessment.repository.IntentoTestRepository;
import com.uam.psychoform.assessment.repository.RespuestaItemRepository;
import com.uam.psychoform.audit.service.AuditLogService;
import com.uam.psychoform.instrument.model.ClaveRespuesta;
import com.uam.psychoform.instrument.model.DimensionResultado;
import com.uam.psychoform.instrument.model.Subtest;
import com.uam.psychoform.instrument.repository.ClaveRespuestaLookupRepository;
import com.uam.psychoform.scoring.model.CalificacionRespuesta;
import com.uam.psychoform.scoring.model.EstadoRevisionManual;
import com.uam.psychoform.scoring.model.Resultado;
import com.uam.psychoform.scoring.model.ResultadoDimension;
import com.uam.psychoform.scoring.model.RevisionManualRespuesta;
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
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
public class ManualReviewService {
    private static final List<EstadoRevisionManual> INBOX_STATES = List.of(EstadoRevisionManual.PENDIENTE,
            EstadoRevisionManual.OBSERVADO);

    private final RevisionManualRespuestaRepository reviews;
    private final RespuestaItemRepository answers;
    private final IntentoTestRepository attempts;
    private final ResultadoRepository results;
    private final CalificacionRespuestaRepository gradings;
    private final ResultadoDimensionRepository dimensionResults;
    private final ClaveRespuestaLookupRepository keys;
    private final DimensionScoreSupport dimensionScores;
    private final UsuarioRepository users;
    private final CurrentActor currentActor;
    private final AuditLogService audit;
    private final Clock clock;

    public ManualReviewService(RevisionManualRespuestaRepository reviews, RespuestaItemRepository answers,
            IntentoTestRepository attempts, ResultadoRepository results, CalificacionRespuestaRepository gradings,
            ResultadoDimensionRepository dimensionResults, ClaveRespuestaLookupRepository keys,
            DimensionScoreSupport dimensionScores, UsuarioRepository users, CurrentActor currentActor,
            AuditLogService audit, Clock clock) {
        this.reviews = reviews;
        this.answers = answers;
        this.attempts = attempts;
        this.results = results;
        this.gradings = gradings;
        this.dimensionResults = dimensionResults;
        this.keys = keys;
        this.dimensionScores = dimensionScores;
        this.users = users;
        this.currentActor = currentActor;
        this.audit = audit;
        this.clock = clock;
    }

    /**
     * Bandeja de revision: PENDIENTE y OBSERVADO (una observada requiere otra decision del revisor). Las REVISADO
     * salen de la bandeja.
     */
    @PreAuthorize(SecurityPermissions.CALIFICACION_EJECUTAR + " or " + SecurityPermissions.RESULTADO_VER)
    public List<PendingReviewView> pending() {
        return reviews.findPendingWithAnswerContext(INBOX_STATES).stream()
                .map(this::toView)
                .toList();
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.CALIFICACION_EJECUTAR)
    public PendingReviewView createPendingForAnswer(Long answerId) {
        RespuestaItem answer = answers.findById(answerId)
                .orElseThrow(() -> new EntityNotFoundException("Respuesta no encontrada: " + answerId));
        RevisionManualRespuesta existing = reviews.findByRespuestaId(answerId).orElse(null);
        if (existing != null) {
            return toView(existing);
        }
        RevisionManualRespuesta review = new RevisionManualRespuesta();
        review.setRespuesta(answer);
        review.setEstado(EstadoRevisionManual.PENDIENTE);
        review.setCreadoEn(LocalDateTime.now(clock));
        reviews.save(review);
        answer.setRequiereRevisionManual(true);
        answers.save(answer);
        return toView(review);
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.CALIFICACION_EJECUTAR)
    public PendingReviewView resolve(Long reviewId, ReviewCommand command) {
        RevisionManualRespuesta review = reviews.findById(reviewId)
                .orElseThrow(() -> new EntityNotFoundException("Revision no encontrada: " + reviewId));
        RespuestaItem answer = review.getRespuesta();
        Long attemptId = answer.getIntento().getId();
        BigDecimal score = command.score();
        if (score != null && score.signum() < 0) {
            throw new IllegalArgumentException("El puntaje no puede ser negativo");
        }
        if (command.approved() && score == null) {
            throw new IllegalArgumentException("El puntaje es obligatorio para aprobar la revision");
        }
        // Serializa las resoluciones de un mismo intento: cada una recalcula el total completo.
        attempts.findByIdForUpdate(attemptId).orElseThrow(
                () -> new EntityNotFoundException("Intento no encontrado: " + attemptId));
        Resultado result = results.findByIntentoId(attemptId).orElseThrow(
                () -> new IllegalStateException("El intento aun no tiene resultado calificado"));
        CalificacionRespuesta grading = gradings.findByResultadoId(result.getId()).stream()
                .filter(g -> g.getRespuesta().getId().equals(answer.getId()))
                .findFirst()
                .orElseThrow(() -> new IllegalStateException(
                        "La respuesta no forma parte del resultado calificado del intento"));
        validateScoreAgainstKey(score, grading, answer);

        review.setEstado(command.approved() ? EstadoRevisionManual.REVISADO : EstadoRevisionManual.OBSERVADO);
        review.setPuntajeAsignado(score);
        review.setComentario(command.comment());
        review.setRevisadoPor(currentUser());
        review.setRevisadoEn(LocalDateTime.now(clock));
        reviews.save(review);

        if (command.approved()) {
            grading.setPuntajeObtenido(score);
            grading.setEsCorrecta(score.signum() > 0);
            grading.setRequiereRevisionManual(false);
        } else {
            // Observada: no aplica puntaje y sigue pendiente (si estaba revisada, vuelve al estado provisional).
            grading.setPuntajeObtenido(BigDecimal.ZERO);
            grading.setEsCorrecta(false);
            grading.setRequiereRevisionManual(true);
        }
        gradings.save(grading);
        recalculateResult(result, answer);
        audit.recordTrusted(new AuditLogService.AuditEvent("REVISION_MANUAL_GUARDADA", "revision_manual_respuesta",
                String.valueOf(reviewId), null,
                "{\"score\":" + command.score() + ",\"approved\":" + command.approved() + "}", null, null));
        return toView(review);
    }

    private void validateScoreAgainstKey(BigDecimal score, CalificacionRespuesta grading, RespuestaItem answer) {
        if (score == null || grading.getReglaCalificacion() == null) {
            return;
        }
        ClaveRespuesta key = keys.findFirstByReglaCalificacionIdAndItemId(grading.getReglaCalificacion().getId(),
                answer.getItem().getId()).orElse(null);
        if (key != null && key.getPuntaje() != null && score.compareTo(key.getPuntaje()) > 0) {
            throw new IllegalArgumentException("El puntaje no puede superar el maximo del item (" + key.getPuntaje() + ")");
        }
    }

    /**
     * Recalcula los totales del resultado a partir de sus calificaciones y de las revisiones del intento, y recalcula
     * desde cero el puntaje de la dimension del subtest de la respuesta resuelta (aporte automatico de las respuestas
     * sin revision manual mas el puntaje de las revisiones REVISADO), con su baremo/rango. Recalcular en lugar de
     * sumar un delta evita arrastrar el aporte automatico que los resultados historicos dejaron en esa fila.
     */
    private void recalculateResult(Resultado result, RespuestaItem answer) {
        List<CalificacionRespuesta> gradingList = gradings.findByResultadoId(result.getId());
        BigDecimal total = gradingList.stream()
                .map(CalificacionRespuesta::getPuntajeObtenido)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        int correct = (int) gradingList.stream().filter(g -> Boolean.TRUE.equals(g.getEsCorrecta())).count();
        int pending = (int) reviews.findByRespuestaIntentoId(result.getIntento().getId()).stream()
                .filter(r -> r.getEstado() != EstadoRevisionManual.REVISADO)
                .count();
        result.setPuntajeTotalDirecto(total);
        result.setCantidadCorrectas(correct);
        result.setCantidadIncorrectas(gradingList.size() - correct);
        result.setCantidadPendientesRevision(pending);
        result.setRequiereRevisionManual(pending > 0);
        results.save(result);
        List<ResultadoDimension> dimensions = new ArrayList<>(dimensionResults.findByResultadoId(result.getId()));
        recalculateSubtestDimension(result, dimensions, answer);
        dimensions.forEach(d -> d.setRequiereRevisionManual(pending > 0));
        dimensionResults.saveAll(dimensions);
    }

    /** Recalcula desde cero el puntaje y el baremo de la dimension del subtest del item (crea la fila si faltaba). */
    private void recalculateSubtestDimension(Resultado result, List<ResultadoDimension> dimensions, RespuestaItem answer) {
        Subtest subtest = answer.getItem().getSubtest();
        if (subtest == null) {
            return;
        }
        Long versionId = result.getIntento().getAsignacion().getSesionAplicacion().getVersionTest().getId();
        DimensionResultado dimension = dimensionScores.dimensionsBySubtest(versionId).get(subtest.getId());
        if (dimension == null) {
            return;
        }
        Map<Long, BigDecimal> directScores = dimensionScores.directScoresByDimension(versionId,
                result.getIntento().getId());
        ResultadoDimension row = dimensions.stream()
                .filter(d -> d.getDimensionResultado().getId().equals(dimension.getId()))
                .findFirst()
                .orElse(null);
        if (row == null) {
            if (!directScores.containsKey(dimension.getId())) {
                return;
            }
            row = new ResultadoDimension();
            row.setResultado(result);
            row.setDimensionResultado(dimension);
            row.setRequiereRevisionManual(result.getRequiereRevisionManual());
            dimensions.add(row);
        }
        row.setPuntajeDirecto(directScores.getOrDefault(dimension.getId(), BigDecimal.ZERO));
        dimensionScores.applyBaremo(versionId, List.of(row));
    }

    private PendingReviewView toView(RevisionManualRespuesta review) {
        RespuestaItem answer = review.getRespuesta();
        return new PendingReviewView(review.getId(), answer.getId(), answer.getIntento().getId(),
                answer.getIntento().getAsignacion().getParticipante().getId().toString(),
                answer.getIntento().getAsignacion().getParticipante().getNombres() + " "
                        + answer.getIntento().getAsignacion().getParticipante().getApellidos(),
                answer.getItem().getId(), answer.getItem().getCodigoItem(), answer.getItem().getEnunciado(),
                answer.getRespuestaTextoAbierto(), answer.getRespuestaNumerica(), review.getEstado().name(),
                review.getPuntajeAsignado(), review.getComentario(), review.getCreadoEn(), review.getRevisadoEn());
    }

    private Usuario currentUser() {
        return users.findById(currentActor.usuarioId())
                .orElseThrow(() -> new EntityNotFoundException("Usuario autenticado no encontrado"));
    }

    public record ReviewCommand(BigDecimal score, String comment, boolean approved) {
    }

    public record PendingReviewView(Long reviewId, Long answerId, Long attemptId, String participantId,
            String participantName, Long itemId, String itemCode, String prompt, String textAnswer,
            BigDecimal numericAnswer, String status, BigDecimal score, String comment, LocalDateTime createdAt,
            LocalDateTime reviewedAt) {
    }
}

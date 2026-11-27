package com.uam.psychoform.assessment.controller;

import com.uam.psychoform.assessment.dto.*;

import com.uam.psychoform.assessment.service.*;
import com.uam.psychoform.dto.ApiResponse;
import com.uam.psychoform.dto.EntityView;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;

@RestController
public class ParticipantRuntimeController {
    private final ParticipantJwtService participantJwt;
    private final ParticipantAccessService access;
    private final ParticipantRuntimeService runtime;
    private final ParticipantAnswerService answers;
    private final ParticipantEvaluationView evaluation;
    private final SubtestTimingService timing;
    @org.springframework.beans.factory.annotation.Value("${psychoform.bulk-sync.max-bytes:2097152}")
    private long maxBytesLote = BulkSyncLoteReader.MAX_BYTES_POR_DEFECTO;
    @org.springframework.beans.factory.annotation.Value("${psychoform.bulk-sync.max-items:1000}")
    private int maxElementosLote = BulkSyncLoteReader.MAX_ELEMENTOS_POR_DEFECTO;

    public ParticipantRuntimeController(ParticipantJwtService participantJwt, ParticipantRuntimeService runtime,
            ParticipantAccessService access, ParticipantAnswerService answers, ParticipantEvaluationView evaluation,
            SubtestTimingService timing) {
        this.participantJwt = participantJwt;
        this.access = access;
        this.runtime = runtime;
        this.answers = answers;
        this.evaluation = evaluation;
        this.timing = timing;
    }

    @GetMapping("/evaluacion-participante/yo")
    public ApiResponse<?> me(HttpServletRequest request) {
        var participantAccess = access.validateRuntimeStatusRead(
                participantJwt.requireAccess(request.getHeader("Authorization")));
        return ApiResponse.ok(evaluation.getEvaluationPayload(participantAccess.assignmentId()));
    }

    @PostMapping("/evaluacion-participante/iniciar")
    public ApiResponse<?> start(@Valid @RequestBody StartAttemptRequest body, HttpServletRequest request) {
        var participantAccess = requireWriteAccess(request);
        if (!participantAccess.assignmentId().equals(body.assignmentId())) {
            throw new org.springframework.security.access.AccessDeniedException("Asignacion fuera de alcance");
        }
        return ApiResponse.ok(EntityView
                .of(runtime.startOrResumeAttempt(participantAccess, body.deviceInfo(), request.getRemoteAddr())));
    }

    @PostMapping("/intentos/{attemptId}/subtests/{subtestId}/iniciar")
    public ApiResponse<?> startSubtest(@PathVariable Long attemptId, @PathVariable Long subtestId,
            HttpServletRequest request) {
        var participantAccess = requireWriteAccess(request);
        var started = runtime.startSubtest(participantAccess, attemptId, subtestId);
        var subtestTiming = timing.forAttemptSubtest(started.getId());
        @SuppressWarnings("unchecked")
        Map<String, Object> view = new LinkedHashMap<>((Map<String, Object>) EntityView.of(started));
        view.put("startedAt", subtestTiming.startedAt());
        view.put("timeLimitSeconds", subtestTiming.timeLimitSeconds());
        view.put("remainingSeconds", subtestTiming.remainingSeconds());
        view.put("paused", subtestTiming.paused());
        view.put("serverNow", subtestTiming.serverNow());
        return ApiResponse.ok(view);
    }

    @GetMapping("/intentos/{attemptId}/subtests/{subtestId}/items")
    public ApiResponse<?> items(@PathVariable Long attemptId, @PathVariable Long subtestId,
            HttpServletRequest request) {
        var participantAccess = requireReadAccess(request);
        return ApiResponse.ok(evaluation.getScopedSubtestPayload(participantAccess, attemptId, subtestId));
    }

    @PutMapping("/intentos/{attemptId}/items/{itemId}/respuesta")
    public ApiResponse<?> answer(@PathVariable Long attemptId, @PathVariable Long itemId,
            @Valid @RequestBody SaveAnswerRequest body, HttpServletRequest request) {
        var participantAccess = requireWriteAccess(request);
        return ApiResponse
                .ok(EntityView.of(answers.saveAnswer(participantAccess,
                        new ParticipantAnswerService.SaveAnswerCommand(attemptId, itemId,
                        body.selectedOptionIds(), body.textAnswer(), body.numericAnswer(), body.timeUsedSeconds()))));
    }

    @PostMapping(path = "/intentos/{attemptId}/respuestas/bulk-sync",
            consumes = { MediaType.APPLICATION_JSON_VALUE, "application/*+json" })
    public ApiResponse<?> bulk(@PathVariable Long attemptId, HttpServletRequest request) throws java.io.IOException {
        // El acceso se valida antes de leer el cuerpo; el cuerpo se lee con limite de bytes (ver BulkSyncLoteReader).
        var participantAccess = requireWriteAccess(request);
        if (request.getContentLengthLong() > maxBytesLote) {
            throw LoteDemasiadoGrandeException.porBytes(maxBytesLote);
        }
        var lote = BulkSyncLoteReader.leer(attemptId, request.getInputStream(), charsetDeclarado(request),
                maxBytesLote, maxElementosLote);
        // La lectura puede tardar: el acceso (JWT y vigencia de la asignacion) se revalida antes de persistir.
        participantAccess = requireWriteAccess(request);
        return ApiResponse.ok(EntityView.of(answers.bulkSyncAnswers(participantAccess,
                new ParticipantAnswerService.BulkSyncAnswersCommand(attemptId, lote))));
    }

    @PostMapping("/intentos/{attemptId}/subtests/{subtestId}/finalizar")
    public ApiResponse<?> finishSubtest(@PathVariable Long attemptId, @PathVariable Long subtestId,
            @Valid @RequestBody FinishRequest body, HttpServletRequest request) {
        var participantAccess = requireWriteAccess(request);
        return ApiResponse.ok(EntityView.of(runtime.finishSubtest(participantAccess, attemptId, subtestId,
                body.timeSeconds())));
    }

    @PostMapping("/intentos/{attemptId}/finalizar")
    public ApiResponse<?> finish(@PathVariable Long attemptId, @Valid @RequestBody FinishRequest body,
            HttpServletRequest request) {
        var participantAccess = requireWriteAccess(request);
        return ApiResponse.ok(EntityView.of(runtime.finishAttempt(participantAccess, attemptId, body.timeSeconds())));
    }

    private static java.nio.charset.Charset charsetDeclarado(HttpServletRequest request) {
        String nombre = request.getCharacterEncoding();
        if (nombre == null) {
            return null;
        }
        try {
            return java.nio.charset.Charset.forName(nombre);
        } catch (IllegalArgumentException ex) {
            throw new IllegalArgumentException("Charset no soportado: " + nombre);
        }
    }

    private ParticipantAccessService.ParticipantAccess requireReadAccess(HttpServletRequest request) {
        return access.validateRuntimeRead(participantJwt.requireAccess(request.getHeader("Authorization")));
    }

    private ParticipantAccessService.ParticipantAccess requireWriteAccess(HttpServletRequest request) {
        return access.validateRuntimeWrite(participantJwt.requireAccess(request.getHeader("Authorization")));
    }
}

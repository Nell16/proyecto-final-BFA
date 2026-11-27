package com.uam.psychoform.instrument.dto;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.uam.psychoform.instrument.model.TipoItem;
import com.uam.psychoform.instrument.model.TipoRespuesta;
import java.math.BigDecimal;
import java.util.List;

/**
 * Los {@code @JsonAlias} aceptan los nombres {@code source*} de {@code SubtestCloneTemplateDTO}: el documento de
 * {@code GET /test-versions/{id}/configuration} (B7) se reenvia tal cual a {@code POST .../configuration} de una
 * version BORRADOR. Con ids reales y sin {@code status}, cada nodo se actualiza sin cambios.
 */
public record VersionConfigurationRequest(List<SubtestDraft> subtests) {
    public enum DraftStatus {
        EXISTING,
        CREATED,
        UPDATED,
        DELETED
    }

    public record SubtestDraft(@JsonAlias("sourceSubtestId") Long id, String draftId, Long sourceId,
            DraftStatus status, String code, String name, String description, String instructions, Integer order,
            Integer timeLimitSeconds, Boolean randomizeItems, Boolean randomizeOptions, Boolean required,
            Short strategyId, List<ItemDraft> items) {
    }

    public record ItemDraft(@JsonAlias("sourceItemId") Long id, String draftId, Long sourceId,
            DraftStatus status, String code, TipoItem itemType, TipoRespuesta responseType, String prompt,
            String instruction, Integer order, BigDecimal baseScore, Integer timeLimitSeconds, Boolean required,
            Boolean confidential, List<ImageDraft> images, List<OptionDraft> options, AnswerKeyDraft answerKey) {
    }

    public record OptionDraft(@JsonAlias("sourceOptionId") Long id, String draftId, Long sourceId,
            DraftStatus status, String code, String text, Integer order, BigDecimal ordinalValue,
            List<ImageDraft> images) {
    }

    public record ImageDraft(@JsonAlias("sourceImageId") Long id, String draftId, Long sourceId,
            Long resourceId, DraftStatus status, Integer order, String altText, String role) {
    }

    public record AnswerKeyDraft(@JsonAlias("sourceAnswerKeyId") Long id, String draftId, Long sourceId,
            DraftStatus status, @JsonAlias("sourceRuleId") Long ruleId, String correctOptionDraftId,
            @JsonAlias("correctOptionSourceId") Long correctOptionId, String expectedText, BigDecimal expectedNumber,
            BigDecimal numericTolerance, BigDecimal score, Boolean requiresManualReview) {
    }
}

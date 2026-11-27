package com.uam.psychoform.reporting.dto;

import java.time.LocalDateTime;
import java.util.UUID;

public record AttemptSummaryDto(
        Long attemptId,
        String status,
        LocalDateTime startedAt,
        LocalDateTime finishedAt,
        Integer totalTimeSeconds,
        ParticipantSummary participant,
        SessionSummary session,
        VersionSummary version,
        boolean scored,
        Long resultId,
        int pendingManualReviews) {

    public record ParticipantSummary(UUID id, String code, String fullName) {
    }

    public record SessionSummary(Long id, String code, String name) {
    }

    public record VersionSummary(Long id, String testName, String number) {
    }
}

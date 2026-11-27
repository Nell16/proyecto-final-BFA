package com.uam.psychoform.assessment.dto;

public record SessionSubtestDetailDto(
        Long subtestId,
        String code,
        String name,
        Integer order,
        Integer timeLimitSeconds,
        Boolean randomizeItems,
        Boolean randomizeOptions) {
}

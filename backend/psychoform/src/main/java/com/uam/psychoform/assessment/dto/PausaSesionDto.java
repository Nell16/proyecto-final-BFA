package com.uam.psychoform.assessment.dto;

import java.time.LocalDateTime;
import java.util.UUID;

public record PausaSesionDto(Long id, LocalDateTime pausadoEn, LocalDateTime reanudadoEn, UUID pausadoPor,
        String motivo) {
}

package com.uam.psychoform.assessment.dto;

import java.time.LocalDateTime;
import java.util.UUID;

/** Incidencia registrada en una sesion (fila de auditoria INCIDENCIA_SESION). */
public record SessionIncidenceDto(
    Long id,
    UUID participantId,
    String participantName,
    String text,
    LocalDateTime recordedAt,
    String recordedBy
) {}

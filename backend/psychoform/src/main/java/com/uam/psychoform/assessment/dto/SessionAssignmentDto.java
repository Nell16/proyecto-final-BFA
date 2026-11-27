package com.uam.psychoform.assessment.dto;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

public record SessionAssignmentDto(
    Long assignmentId,
    Long attemptId,
    UUID participantId,
    String participantName,
    String participantCode,
    String status,         // "GENERADO" | "ACTIVO" | "VENCIDO" | "REVOCADO"
    String state,          // "no-iniciado" | "en-progreso" | "completado" | "interrumpido" | "anulado"
    String currentSubtestId,
    Integer overallProgress,
    String lastActivity,
    String tokenExpiraEn,
    String assignmentStatus,                // B11: EstadoAsignacion.name() crudo del backend
    String attemptStatus,                   // B11: EstadoIntento.name() crudo, o null si no hay intento
    Integer rejectedAnswersCount,           // B17: filas distintas de respuesta_rechazada del intento
    List<RejectedAnswerDto> rejectedAnswers // B17: como maximo 20, las mas recientes primero
) {
    public static final int MAX_REJECTED_ANSWERS = 20;

    /** Respuesta rechazada por bulk-sync (B17). */
    public record RejectedAnswerDto(Long itemId, String code, LocalDateTime rejectedAt) {
    }
}

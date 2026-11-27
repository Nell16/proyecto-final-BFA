package com.uam.psychoform.controller;

import com.uam.psychoform.assessment.service.LoteDemasiadoGrandeException;
import com.uam.psychoform.assessment.service.ParticipantConflictException;
import com.uam.psychoform.dto.ApiResponse;
import com.uam.psychoform.storage.StorageUnavailableException;

import jakarta.persistence.EntityNotFoundException;
import java.sql.SQLException;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Set;
import org.hibernate.exception.ConstraintViolationException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.AuthenticationCredentialsNotFoundException;
import org.springframework.transaction.TransactionSystemException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;

@RestControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ApiResponse<Void>> validation(MethodArgumentNotValidException ex) {
        List<String> details = ex.getBindingResult().getFieldErrors().stream().map(this::format).toList();
        return ResponseEntity.badRequest().body(ApiResponse.error("VALIDATION_ERROR", "Datos invalidos", details));
    }

    @ExceptionHandler(AuthenticationCredentialsNotFoundException.class)
    ResponseEntity<ApiResponse<Void>> unauthenticated(RuntimeException ex) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(ApiResponse.error("UNAUTHORIZED", "No autenticado"));
    }

    @ExceptionHandler(AccessDeniedException.class)
    ResponseEntity<ApiResponse<Void>> forbidden(AccessDeniedException ex) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(ApiResponse.error("FORBIDDEN", "No tiene permiso para esta accion"));
    }

    @ExceptionHandler(EntityNotFoundException.class)
    ResponseEntity<ApiResponse<Void>> notFound(EntityNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ApiResponse.error("NOT_FOUND", ex.getMessage()));
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<ApiResponse<Void>> noResource(NoResourceFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ApiResponse.error("NOT_FOUND", "Recurso no encontrado"));
    }

    @ExceptionHandler(LoteDemasiadoGrandeException.class)
    ResponseEntity<ApiResponse<Void>> payloadTooLarge(RuntimeException ex) {
        return ResponseEntity.status(HttpStatus.CONTENT_TOO_LARGE)
                .body(ApiResponse.error("PAYLOAD_TOO_LARGE", ex.getMessage()));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    ResponseEntity<ApiResponse<Void>> badRequest(IllegalArgumentException ex) {
        String message = ex.getMessage() == null ? "Datos invalidos" : ex.getMessage();
        HttpStatus status = message.toLowerCase().contains("credencial") ? HttpStatus.UNAUTHORIZED
                : HttpStatus.BAD_REQUEST;
        String code = status == HttpStatus.UNAUTHORIZED ? "UNAUTHORIZED" : "BAD_REQUEST";
        return ResponseEntity.status(status).body(ApiResponse.error(code, message));
    }

    @ExceptionHandler(ParticipantConflictException.class)
    ResponseEntity<ApiResponse<Void>> participantConflict(ParticipantConflictException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(ApiResponse.error(ex.getCode(), ex.getMessage()));
    }

    @ExceptionHandler(IllegalStateException.class)
    ResponseEntity<ApiResponse<Void>> conflict(IllegalStateException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(ApiResponse.error("CONFLICT", ex.getMessage()));
    }

    @ExceptionHandler({ DataIntegrityViolationException.class, ConstraintViolationException.class })
    ResponseEntity<ApiResponse<Void>> dataIntegrityConflict(Exception ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ApiResponse.error("CONFLICT", "Conflicto de integridad de datos"));
    }

    @ExceptionHandler(TransactionSystemException.class)
    ResponseEntity<ApiResponse<Void>> transactionFailure(TransactionSystemException ex) {
        if (isIntegrityViolation(ex)) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(ApiResponse.error("CONFLICT", "Conflicto de integridad de datos"));
        }
        throw ex;
    }

    @ExceptionHandler(StorageUnavailableException.class)
    ResponseEntity<ApiResponse<Void>> storageUnavailable(StorageUnavailableException ex) {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(ApiResponse.error("SERVICE_UNAVAILABLE", "El almacenamiento no esta disponible"));
    }

    private boolean isIntegrityViolation(Throwable ex) {
        Set<Throwable> visited = Collections.newSetFromMap(new IdentityHashMap<>());
        Throwable cursor = ex;
        while (cursor != null && visited.add(cursor)) {
            if (cursor instanceof DataIntegrityViolationException
                    || cursor instanceof ConstraintViolationException) {
                return true;
            }
            if (cursor instanceof SQLException sqlEx && sqlEx.getSQLState() != null
                    && sqlEx.getSQLState().startsWith("23")) {
                return true;
            }
            cursor = cursor.getCause();
        }
        return false;
    }

    private String format(FieldError error) {
        return error.getField() + ": " + error.getDefaultMessage();
    }
}



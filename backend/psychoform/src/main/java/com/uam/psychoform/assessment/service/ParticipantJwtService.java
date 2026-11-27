package com.uam.psychoform.assessment.service;

import com.uam.psychoform.security.service.JwtExpiredException;
import com.uam.psychoform.security.service.JwtService;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class ParticipantJwtService {
    private static final String PREFIX = "participant-assignment:";
    private final JwtService jwt;

    public ParticipantJwtService(JwtService jwt) {
        this.jwt = jwt;
    }

    public String issue(UUID participantId, long assignmentId, LocalDateTime expiresAtUtc) {
        return jwt.emitir(participantId, PREFIX + assignmentId, Set.of(), Set.of("PARTICIPANTE"),
                expiresAtUtc.toInstant(ZoneOffset.UTC));
    }

    public long requireAssignment(String authorizationHeader) {
        return requireAccess(authorizationHeader).assignmentId();
    }

    public ParticipantAccessService.ParticipantAccess requireAccess(String authorizationHeader) {
        if (authorizationHeader == null || !authorizationHeader.startsWith("Bearer ")) {
            throw new org.springframework.security.authentication.AuthenticationCredentialsNotFoundException("Token participante requerido");
        }
        JwtService.JwtPrincipal principal;
        try {
            principal = jwt.validar(authorizationHeader.substring(7));
        } catch (JwtExpiredException ex) {
            // El filtro ya valido este JWT; si vencio entre ambas validaciones se responde el mismo contrato
            // que el filtro (409 TOKEN_EXPIRADO) en lugar de un 400 generico.
            if (ex.roles().contains("PARTICIPANTE")) {
                throw new ParticipantConflictException(ParticipantConflictException.TOKEN_EXPIRADO,
                        "El acceso del participante expiro");
            }
            throw ex;
        }
        if (!principal.roles().contains("PARTICIPANTE") || !principal.username().startsWith(PREFIX)) {
            throw new org.springframework.security.access.AccessDeniedException("Token participante invalido");
        }
        return new ParticipantAccessService.ParticipantAccess(
                Long.parseLong(principal.username().substring(PREFIX.length())), principal.usuarioId());
    }
}

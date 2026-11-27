package com.uam.psychoform.security;

import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

@Component
public class CurrentActor {
    public java.util.UUID usuarioId() {
        return principal().usuarioId();
    }

    public String username() {
        return principal().username();
    }

    public com.uam.psychoform.security.service.JwtService.JwtPrincipal principal() {

        Object principal = SecurityContextHolder.getContext().getAuthentication().getPrincipal();

        if (principal instanceof com.uam.psychoform.security.service.JwtService.JwtPrincipal actor)
            return actor;
        throw new org.springframework.security.authentication.AuthenticationCredentialsNotFoundException(
                "No hay actor autenticado");
    }

    /** True si el actor actual puede leer instrumentos completos (TEST_LEER); si no, solo ve el catalogo publicado. */
    public boolean canReadFullInstruments() {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null) {
            return false;
        }
        return authentication.getAuthorities().stream()
                .anyMatch(a -> SecurityPermissions.TEST_LEER_AUTHORITIES.contains(a.getAuthority()));
    }
}

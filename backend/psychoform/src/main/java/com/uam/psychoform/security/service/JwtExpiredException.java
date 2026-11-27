package com.uam.psychoform.security.service;

import java.util.Set;

public class JwtExpiredException extends IllegalArgumentException {
    private final Set<String> roles;

    public JwtExpiredException(Set<String> roles) {
        super("JWT expirado");
        this.roles = Set.copyOf(roles);
    }

    public Set<String> roles() {
        return roles;
    }
}

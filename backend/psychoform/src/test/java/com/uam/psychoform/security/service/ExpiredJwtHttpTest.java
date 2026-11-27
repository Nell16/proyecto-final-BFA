package com.uam.psychoform.security.service;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.uam.psychoform.PsychoformApplication;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(classes = PsychoformApplication.class)
@AutoConfigureMockMvc
class ExpiredJwtHttpTest {
    @Autowired private MockMvc mvc;
    @Value("${security.jwt.secret}") private String secret;

    private String expiredToken(String username, Set<String> roles) {
        JwtService past = new JwtService(secret, Clock.fixed(Instant.now().minusSeconds(86_400), ZoneOffset.UTC));
        return past.emitir(UUID.randomUUID(), username, Set.of(), roles, Instant.now().minusSeconds(86_400).plusSeconds(60));
    }

    @Test
    void jwtDeParticipanteVencidoDevuelve409TokenExpirado() throws Exception {
        mvc.perform(get("/evaluacion-participante/yo").header("Authorization",
                        "Bearer " + expiredToken("participant-assignment:1", Set.of("PARTICIPANTE"))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error.code").value("TOKEN_EXPIRADO"));
    }

    @Test
    void jwtDeStaffVencidoDevuelve401() throws Exception {
        mvc.perform(get("/sesiones").header("Authorization",
                        "Bearer " + expiredToken("ana", Set.of("PSICOLOGO_COORDINADOR"))))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));
    }
}

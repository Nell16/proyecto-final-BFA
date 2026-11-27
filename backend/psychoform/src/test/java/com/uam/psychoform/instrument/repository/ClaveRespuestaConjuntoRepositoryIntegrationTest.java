package com.uam.psychoform.instrument.repository;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class ClaveRespuestaConjuntoRepositoryIntegrationTest {
    @Autowired
    private ClaveRespuestaLookupRepository claves;

    @Test
    void consultaDeConjuntoDeOpcionesEjecutaContraElEsquemaYDevuelveVacioSinFilas() {
        assertThat(claves.findOptionSetRowsByKeyIds(List.of(-1L, -2L))).isEmpty();
    }
}

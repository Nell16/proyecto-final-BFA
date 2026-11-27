package com.uam.psychoform.scoring;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

/** B23: el indice unico impide dos revisiones de la misma respuesta, incluso con regla de calificacion NULL. */
@SpringBootTest
@Transactional
class RevisionManualUnicaIntegrationTest {
    @Autowired
    JdbcTemplate jdbc;

    @Test
    void noPermiteDosRevisionesDeLaMismaRespuestaYElIndiceExiste() {
        // Solo durante esta transaccion (se revierte): omite FK para no sembrar el grafo completo.
        jdbc.execute("set local session_replication_role = replica");
        assertThat(jdbc.queryForObject(
                "select count(*) from pg_indexes where indexname = 'ux_revision_manual_respuesta_unica'", Long.class))
                .isEqualTo(1L);
        jdbc.update("insert into revision_manual_respuesta (respuesta_id, estado) values (-777, 'PENDIENTE')");

        assertThatThrownBy(() -> jdbc.update(
                "insert into revision_manual_respuesta (respuesta_id, estado) values (-777, 'PENDIENTE')"))
                .isInstanceOf(DuplicateKeyException.class);
    }
}

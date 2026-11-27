package com.uam.psychoform.assessment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class PausaSesionSchemaIntegrationTest {
    @Autowired
    JdbcTemplate jdbc;

    @Test
    void elEnumDeSesionIncluyePausadaEnElOrdenEsperado() {
        List<String> valores = jdbc.queryForList(
                "select unnest(enum_range(null::estado_sesion_aplicacion))::text", String.class);
        assertThat(valores).containsExactly("PROGRAMADA", "ABIERTA", "PAUSADA", "CERRADA", "CANCELADA");
    }

    @Test
    void existeIndiceUnicoParcialParaLaPausaAbierta() {
        String definicion = jdbc.queryForObject(
                "select indexdef from pg_indexes where indexname = 'ux_pausa_sesion_abierta'", String.class);
        assertThat(definicion).containsIgnoringCase("UNIQUE").containsIgnoringCase("reanudado_en IS NULL");
    }

    @Test
    void rechazaDosPausasAbiertasEnLaMismaSesion() {
        Long sesionId = sesionTemporal();
        jdbc.update("insert into pausa_sesion (sesion_aplicacion_id, pausado_en) values (?, now())", sesionId);

        assertThatThrownBy(() -> jdbc.update(
                "insert into pausa_sesion (sesion_aplicacion_id, pausado_en) values (?, now())", sesionId))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void permiteVariasPausasCerradasYRechazaReanudacionAnteriorALaPausa() {
        Long sesionId = sesionTemporal();
        jdbc.update("insert into pausa_sesion (sesion_aplicacion_id, pausado_en, reanudado_en) "
                + "values (?, now() - interval '2 hour', now() - interval '1 hour')", sesionId);
        jdbc.update("insert into pausa_sesion (sesion_aplicacion_id, pausado_en, reanudado_en) "
                + "values (?, now() - interval '50 minute', now() - interval '40 minute')", sesionId);

        assertThatThrownBy(() -> jdbc.update("insert into pausa_sesion (sesion_aplicacion_id, pausado_en, reanudado_en) "
                + "values (?, now(), now() - interval '1 minute')", sesionId))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    /**
     * Crea una sesion minima dentro de la transaccion del test (se revierte al final, no deja datos).
     * session_replication_role = replica omite FK y triggers solo para este INSERT; los indices unicos y los
     * CHECK de pausa_sesion siguen activos, que es lo que se prueba.
     */
    private Long sesionTemporal() {
        jdbc.execute("set local session_replication_role = replica");
        Long id = jdbc.queryForObject("insert into sesion_aplicacion (version_test_id, codigo_sesion, nombre_sesion, "
                + "inicio_programado, estado) values (-1, 'TEST-PAUSA-' || gen_random_uuid(), 'tmp', now(), 'ABIERTA') "
                + "returning sesion_aplicacion_id", Long.class);
        jdbc.execute("set local session_replication_role = origin");
        return id;
    }
}

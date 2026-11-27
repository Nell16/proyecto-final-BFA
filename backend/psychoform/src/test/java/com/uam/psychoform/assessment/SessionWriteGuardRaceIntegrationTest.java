package com.uam.psychoform.assessment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.uam.psychoform.assessment.model.EstadoSesionAplicacion;
import com.uam.psychoform.assessment.model.SesionAplicacion;
import com.uam.psychoform.assessment.service.SesionPausadaException;
import com.uam.psychoform.assessment.service.SessionWriteGuard;
import jakarta.persistence.EntityManager;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Reproduce la carrera de Open EntityManager in View: la sesion ya esta gestionada (ABIERTA) en el contexto de
 * persistencia de la peticion cuando otra transaccion la pausa y confirma. El guard debe ver PAUSADA.
 */
@SpringBootTest
class SessionWriteGuardRaceIntegrationTest {
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    PlatformTransactionManager txManager;
    @Autowired
    EntityManager entityManager;
    @Autowired
    SessionWriteGuard guard;

    private Long sesionId;

    @BeforeEach
    void crearSesion() {
        sesionId = new TransactionTemplate(txManager).execute(status -> {
            // replica omite FK/triggers solo para crear una sesion minima de prueba.
            jdbc.execute("set local session_replication_role = replica");
            return jdbc.queryForObject("insert into sesion_aplicacion (version_test_id, codigo_sesion, nombre_sesion, "
                    + "inicio_programado, estado) values (-1, 'TEST-GUARD-' || gen_random_uuid(), 'tmp', now(), "
                    + "'ABIERTA') returning sesion_aplicacion_id", Long.class);
        });
    }

    @AfterEach
    void borrarSesion() {
        new TransactionTemplate(txManager).executeWithoutResult(status -> {
            jdbc.execute("set local session_replication_role = replica");
            jdbc.update("delete from sesion_aplicacion where sesion_aplicacion_id = ?", sesionId);
        });
    }

    @Test
    void elGuardVeLaPausaConfirmadaAunqueLaSesionYaEsteGestionada() {
        new TransactionTemplate(txManager).executeWithoutResult(status -> {
            SesionAplicacion gestionada = entityManager.find(SesionAplicacion.class, sesionId);
            assertThat(gestionada.getEstado()).isEqualTo(EstadoSesionAplicacion.ABIERTA);

            // Otra conexion pausa la sesion y confirma mientras esta transaccion sigue abierta.
            CompletableFuture.runAsync(() -> new TransactionTemplate(txManager).executeWithoutResult(other ->
                    jdbc.update("update sesion_aplicacion set estado = 'PAUSADA' where sesion_aplicacion_id = ?",
                            sesionId))).join();

            assertThatThrownBy(() -> guard.requireWritable(sesionId)).isInstanceOf(SesionPausadaException.class);
        });
    }
}

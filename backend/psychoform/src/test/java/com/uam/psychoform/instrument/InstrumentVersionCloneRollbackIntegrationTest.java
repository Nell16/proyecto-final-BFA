package com.uam.psychoform.instrument;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.uam.psychoform.PsychoformApplication;
import com.uam.psychoform.security.service.JwtService;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * B9: si la copia falla a mitad de camino no queda una version parcial. No es transaccional (la peticion confirma de
 * verdad); un trigger temporal hace fallar el alta de claves de la version destino y todo se limpia al final.
 */
@SpringBootTest(classes = PsychoformApplication.class,
        properties = "spring.jpa.properties.hibernate.generate_statistics=true")
@AutoConfigureMockMvc
class InstrumentVersionCloneRollbackIntegrationTest {
    private static final String FAILING_NUMBER = "ROLLBACK-B9";

    @Autowired
    MockMvc mvc;

    @Autowired
    JwtService jwt;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    PlatformTransactionManager transactionManager;

    @Test
    void siLaCopiaFallaARegresaTodoYNoQuedaUnaVersionParcial() throws Exception {
        UUID userId = InstrumentVersionFixture.createUser(jdbc, "b9rb");
        long testId = InstrumentVersionFixture.createTest(jdbc, "B9RB");
        try {
            // Una sola transaccion: los triggers diferidos de clave/conjunto validan al confirmar.
            long sourceId = new TransactionTemplate(transactionManager).execute(status -> {
                long id = InstrumentVersionFixture.createDraftVersion(jdbc, testId, "1.0");
                InstrumentVersionFixture.seedFullContent(jdbc, id);
                return id;
            });
            long subtestsBefore = count("select count(*) from subtest where version_test_id in "
                    + "(select version_test_id from version_test where test_id = ?)", testId);
            long itemsBefore = count("select count(*) from item i join subtest s on s.subtest_id = i.subtest_id "
                    + "join version_test v on v.version_test_id = s.version_test_id where v.test_id = ?", testId);
            jdbc.execute("""
                    CREATE OR REPLACE FUNCTION tg_test_b9_fallo_clave() RETURNS trigger LANGUAGE plpgsql AS $$
                    BEGIN
                        IF EXISTS (SELECT 1 FROM regla_calificacion r
                                   JOIN version_test v ON v.version_test_id = r.version_test_id
                                   WHERE r.regla_calificacion_id = NEW.regla_calificacion_id
                                     AND v.numero_version = '%s') THEN
                            RAISE EXCEPTION 'fallo simulado a mitad de la copia';
                        END IF;
                        RETURN NEW;
                    END;
                    $$
                    """.formatted(FAILING_NUMBER));
            jdbc.execute("CREATE TRIGGER tg_test_b9_fallo_clave BEFORE INSERT ON clave_respuesta "
                    + "FOR EACH ROW EXECUTE FUNCTION tg_test_b9_fallo_clave()");

            int statusCode;
            try {
                statusCode = mvc.perform(post("/test-versions/{id}/clone", sourceId)
                        .header("Authorization", "Bearer " + jwt.emitir(userId, "usuario-b9rb",
                                Set.of("TEST_CREAR"), Set.of("ROL_PRUEBA")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"versionNumber\":\"" + FAILING_NUMBER + "\"}"))
                        .andReturn().getResponse().getStatus();
            } catch (Exception ex) {
                statusCode = 500;
            }

            assertThat(statusCode).isGreaterThanOrEqualTo(400);
            assertThat(count("select count(*) from version_test where test_id = ? and numero_version = ?", testId,
                    FAILING_NUMBER)).isZero();
            assertThat(count("select count(*) from version_test where test_id = ?", testId)).isEqualTo(1);
            assertThat(count("select count(*) from subtest where version_test_id in "
                    + "(select version_test_id from version_test where test_id = ?)", testId))
                    .isEqualTo(subtestsBefore);
            assertThat(count("select count(*) from item i join subtest s on s.subtest_id = i.subtest_id "
                    + "join version_test v on v.version_test_id = s.version_test_id where v.test_id = ?", testId))
                    .isEqualTo(itemsBefore);
        } finally {
            jdbc.execute("DROP TRIGGER IF EXISTS tg_test_b9_fallo_clave ON clave_respuesta");
            jdbc.execute("DROP FUNCTION IF EXISTS tg_test_b9_fallo_clave()");
            jdbc.update("delete from test where test_id = ?", testId);
            jdbc.update("delete from recurso_multimedia where ruta_almacenamiento like 'test-fixture/%'");
            jdbc.update("delete from usuario where usuario_id = ?", userId);
        }
    }

    private long count(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }
}

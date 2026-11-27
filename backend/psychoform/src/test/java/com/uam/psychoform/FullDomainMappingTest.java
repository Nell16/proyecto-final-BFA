package com.uam.psychoform;

import static org.assertj.core.api.Assertions.assertThat;

import com.uam.psychoform.assessment.model.OpcionSeleccionadaRespuesta;
import com.uam.psychoform.assessment.model.PausaSesion;
import com.uam.psychoform.assessment.model.RespuestaRechazada;
import com.uam.psychoform.assessment.model.SesionAplicacion;
import org.hibernate.annotations.Formula;
import com.uam.psychoform.instrument.model.ReglaCalificacion;
import com.uam.psychoform.instrument.model.VersionTest;
import com.uam.psychoform.scoring.model.ResultadoDimension;
import jakarta.persistence.ManyToOne;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.lang.reflect.Field;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import org.junit.jupiter.api.Test;

class FullDomainMappingTest {

    @Test
    void mapsBusinessColumnsRelationshipsAndDatabaseSpecificTypes() throws Exception {
        Field versionTest = VersionTest.class.getDeclaredField("test");
        Field ruleParameters = ReglaCalificacion.class.getDeclaredField("parametros");
        Field selectedOption = OpcionSeleccionadaRespuesta.class.getDeclaredField("opcion");
        Field normRange = ResultadoDimension.class.getDeclaredField("rangoBaremo");

        assertThat(versionTest.getAnnotation(ManyToOne.class)).isNotNull();
        assertThat(ruleParameters.getAnnotation(JdbcTypeCode.class).value()).isEqualTo(SqlTypes.JSON);
        assertThat(selectedOption.getAnnotation(ManyToOne.class)).isNotNull();
        assertThat(normRange.getAnnotation(ManyToOne.class)).isNotNull();
    }

    @Test
    void exposesBeanValidationForRequiredBusinessData() throws Exception {
        assertThat(VersionTest.class.getDeclaredField("numeroVersion").getAnnotation(NotBlank.class)).isNotNull();
        assertThat(ReglaCalificacion.class.getDeclaredField("prioridad").getAnnotation(NotNull.class)).isNotNull();
    }

    @Test
    void mapsSessionPauseHistory() throws Exception {
        assertThat(PausaSesion.class.getDeclaredField("sesionAplicacion").getAnnotation(ManyToOne.class)).isNotNull();
        assertThat(PausaSesion.class.getDeclaredField("pausadoEn").getAnnotation(NotNull.class)).isNotNull();
        assertThat(PausaSesion.class.getDeclaredField("pausadoPor").getAnnotation(ManyToOne.class)).isNotNull();
        assertThat(SesionAplicacion.class.getDeclaredField("pausadoEn").getAnnotation(Formula.class)).isNotNull();
    }

    @Test
    void mapsRejectedAnswerLog() throws Exception {
        assertThat(RespuestaRechazada.class.getDeclaredField("intento").getAnnotation(ManyToOne.class)).isNotNull();
        assertThat(RespuestaRechazada.class.getDeclaredField("itemId").getAnnotation(NotNull.class)).isNotNull();
        assertThat(RespuestaRechazada.class.getDeclaredField("codigo").getAnnotation(NotBlank.class)).isNotNull();
        assertThat(RespuestaRechazada.class.getDeclaredField("veces").getAnnotation(NotNull.class)).isNotNull();
    }
}

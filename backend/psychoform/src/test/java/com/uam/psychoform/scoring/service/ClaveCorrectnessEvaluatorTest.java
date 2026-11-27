package com.uam.psychoform.scoring.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.uam.psychoform.instrument.model.ClaveRespuesta;
import com.uam.psychoform.instrument.model.OpcionItem;
import com.uam.psychoform.instrument.model.TipoRespuesta;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** El detalle del resultado y la calificacion deben partir del mismo conjunto de opciones correctas. */
class ClaveCorrectnessEvaluatorTest {
    private static final List<ClaveCorrectnessEvaluator.OptionRef> OPTIONS = List.of(
            new ClaveCorrectnessEvaluator.OptionRef(1L, "A"), new ClaveCorrectnessEvaluator.OptionRef(2L, "B"),
            new ClaveCorrectnessEvaluator.OptionRef(3L, "C"), new ClaveCorrectnessEvaluator.OptionRef(4L, "D"));

    @Test
    void precedenciaFilasDelConjuntoLuegoTextoEsperadoLuegoOpcionSingular() {
        ClaveRespuesta clave = clave("C,D", 2L);

        assertThat(ClaveCorrectnessEvaluator.correctOptionIds(TipoRespuesta.OPCION_MULTIPLE, clave, Set.of(1L, 4L),
                OPTIONS)).containsExactlyInAnyOrder(1L, 4L);
        assertThat(ClaveCorrectnessEvaluator.correctOptionIds(TipoRespuesta.OPCION_MULTIPLE, clave, Set.of(), OPTIONS))
                .containsExactlyInAnyOrder(3L, 4L);
        assertThat(ClaveCorrectnessEvaluator.correctOptionIds(TipoRespuesta.OPCION_MULTIPLE, clave("", 2L), null,
                OPTIONS)).containsExactly(2L);
    }

    @Test
    void fueraDeOpcionMultipleSoloCuentaLaOpcionSingular() {
        assertThat(ClaveCorrectnessEvaluator.correctOptionIds(TipoRespuesta.OPCION_UNICA, clave("C,D", 2L),
                Set.of(1L), OPTIONS)).containsExactly(2L);
        assertThat(ClaveCorrectnessEvaluator.correctOptionIds(TipoRespuesta.NUMERICA, clave(null, null), null, OPTIONS))
                .isEmpty();
    }

    @Test
    void elConjuntoCorrectoSeleccionadoEsExactamenteLoQueLaCalificacionConsideraCorrecto() {
        ClaveRespuesta clave = clave("C,D", 2L);
        Set<Long> correct = ClaveCorrectnessEvaluator.correctOptionIds(TipoRespuesta.OPCION_MULTIPLE, clave, null,
                OPTIONS);
        List<ClaveCorrectnessEvaluator.SelectedOption> selected = OPTIONS.stream()
                .filter(o -> correct.contains(o.id()))
                .map(o -> new ClaveCorrectnessEvaluator.SelectedOption(o.id(), o.code()))
                .toList();

        assertThat(ClaveCorrectnessEvaluator.isCorrect(TipoRespuesta.OPCION_MULTIPLE, clave, selected, null, null, null))
                .isTrue();
    }

    private static ClaveRespuesta clave(String expectedText, Long singleOptionId) {
        ClaveRespuesta clave = new ClaveRespuesta();
        clave.setId(41L);
        clave.setTextoEsperado(expectedText);
        if (singleOptionId != null) {
            OpcionItem option = new OpcionItem();
            option.setId(singleOptionId);
            clave.setOpcionCorrecta(option);
        }
        return clave;
    }
}

package com.uam.psychoform.scoring.service;

import com.uam.psychoform.instrument.model.ClaveRespuesta;
import com.uam.psychoform.instrument.model.TipoRespuesta;
import java.math.BigDecimal;
import java.text.Normalizer;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Decision pura (sin acceso a datos) de si una respuesta es correcta segun la clave y el tipo de respuesta del item.
 * <p>
 * Reglas por tipo (la revision manual la decide quien llama: un item con revision manual no se autocalifica):
 * <ul>
 * <li>OPCION_MULTIPLE: el conjunto de opciones seleccionadas debe ser igual al conjunto correcto. Fuente del
 * conjunto, por prioridad: filas de {@code clave_respuesta_opcion}; codigos de opcion separados por coma en
 * {@code textoEsperado}; la opcion singular {@code opcionCorrecta}.</li>
 * <li>NUMERICA: |respuesta - esperado| <= tolerancia (nula = 0).</li>
 * <li>TEXTO_ABIERTO con textoEsperado: comparacion normalizada (recorte, espacios colapsados, mayusculas, sin
 * acentos).</li>
 * <li>Resto de tipos (OPCION_UNICA, VERDADERO_FALSO, tipo desconocido): {@code opcionCorrecta} entre las
 * seleccionadas.</li>
 * </ul>
 */
public final class ClaveCorrectnessEvaluator {
    private static final Pattern DIACRITICS = Pattern.compile("\\p{M}+");
    private static final Pattern WHITESPACE = Pattern.compile("\\s+");

    private ClaveCorrectnessEvaluator() {
    }

    /** Opcion seleccionada por el participante (id y codigo) para evaluar la correccion. */
    record SelectedOption(Long id, String code) {
    }

    /** Opcion de un item (id y codigo) sobre la que se resuelven los codigos esperados de la clave. */
    public record OptionRef(Long id, String code) {
    }

    /**
     * Agrupa las filas {@code [claveId, opcionId]} de {@code clave_respuesta_opcion} por clave. Lo usan la
     * calificacion y el detalle del resultado para partir del mismo conjunto de filas.
     */
    public static Map<Long, Set<Long>> groupOptionSetRows(Iterable<Object[]> rows) {
        Map<Long, Set<Long>> optionIdsByKey = new HashMap<>();
        for (Object[] row : rows) {
            optionIdsByKey.computeIfAbsent(((Number) row[0]).longValue(), id -> new HashSet<>())
                    .add(((Number) row[1]).longValue());
        }
        return optionIdsByKey;
    }

    /**
     * Opciones correctas de una clave, con la misma precedencia con la que se califica. En OPCION_MULTIPLE: filas de
     * {@code clave_respuesta_opcion} ({@code setOptionIds}); codigos de {@code textoEsperado} resueltos contra las
     * opciones del item; la opcion singular {@code opcionCorrecta}. En el resto de tipos: {@code opcionCorrecta}.
     */
    public static Set<Long> correctOptionIds(TipoRespuesta tipo, ClaveRespuesta clave, Set<Long> setOptionIds,
            List<OptionRef> itemOptions) {
        if (clave == null) {
            return Set.of();
        }
        if (tipo == TipoRespuesta.OPCION_MULTIPLE) {
            if (setOptionIds != null && !setOptionIds.isEmpty()) {
                return Set.copyOf(setOptionIds);
            }
            Set<String> expectedCodes = parseCodes(clave.getTextoEsperado());
            if (!expectedCodes.isEmpty()) {
                return itemOptions.stream()
                        .filter(option -> expectedCodes.contains(normalizeCode(option.code())))
                        .map(OptionRef::id)
                        .collect(Collectors.toUnmodifiableSet());
            }
        }
        if (clave.getOpcionCorrecta() != null && clave.getOpcionCorrecta().getId() != null) {
            return Set.of(clave.getOpcionCorrecta().getId());
        }
        return Set.of();
    }

    static boolean isCorrect(TipoRespuesta tipo, ClaveRespuesta clave, List<SelectedOption> selected,
            Set<Long> setOptionIds, String textAnswer, BigDecimal numericAnswer) {
        if (tipo == TipoRespuesta.OPCION_MULTIPLE) {
            return multipleChoiceIsCorrect(clave, selected, setOptionIds);
        }
        if (tipo == TipoRespuesta.NUMERICA) {
            return numericIsCorrect(clave, numericAnswer);
        }
        if (tipo == TipoRespuesta.TEXTO_ABIERTO) {
            return openTextIsCorrect(clave, textAnswer);
        }
        return singleOptionIsCorrect(clave, selected);
    }

    private static boolean singleOptionIsCorrect(ClaveRespuesta clave, List<SelectedOption> selected) {
        if (clave.getOpcionCorrecta() == null) {
            return false;
        }
        Long correctId = clave.getOpcionCorrecta().getId();
        return selected.stream().anyMatch(option -> correctId != null && correctId.equals(option.id()));
    }

    private static boolean multipleChoiceIsCorrect(ClaveRespuesta clave, List<SelectedOption> selected,
            Set<Long> setOptionIds) {
        if (selected.isEmpty()) {
            return false;
        }
        if (setOptionIds != null && !setOptionIds.isEmpty()) {
            Set<Long> selectedIds = selected.stream().map(SelectedOption::id).collect(Collectors.toSet());
            return selectedIds.equals(setOptionIds);
        }
        Set<String> expectedCodes = parseCodes(clave.getTextoEsperado());
        if (!expectedCodes.isEmpty()) {
            Set<String> selectedCodes = selected.stream()
                    .map(option -> normalizeCode(option.code()))
                    .filter(code -> !code.isEmpty())
                    .collect(Collectors.toSet());
            return selectedCodes.equals(expectedCodes);
        }
        if (clave.getOpcionCorrecta() != null && clave.getOpcionCorrecta().getId() != null) {
            Set<Long> selectedIds = selected.stream().map(SelectedOption::id).collect(Collectors.toSet());
            return selectedIds.equals(Set.of(clave.getOpcionCorrecta().getId()));
        }
        return false;
    }

    private static boolean numericIsCorrect(ClaveRespuesta clave, BigDecimal answer) {
        if (answer == null || clave.getValorNumericoEsperado() == null) {
            return false;
        }
        BigDecimal tolerance = clave.getToleranciaNumerica() == null ? BigDecimal.ZERO : clave.getToleranciaNumerica();
        BigDecimal difference = answer.subtract(clave.getValorNumericoEsperado()).abs();
        return difference.compareTo(tolerance) <= 0;
    }

    private static boolean openTextIsCorrect(ClaveRespuesta clave, String answer) {
        if (answer == null || clave.getTextoEsperado() == null) {
            return false;
        }
        String expected = normalizeText(clave.getTextoEsperado());
        return !expected.isEmpty() && expected.equals(normalizeText(answer));
    }

    /** Codigos separados por coma: recorte, mayusculas, sin vacios ni duplicados. */
    static Set<String> parseCodes(String raw) {
        if (raw == null || raw.isBlank()) {
            return Set.of();
        }
        return Arrays.stream(raw.split(","))
                .map(ClaveCorrectnessEvaluator::normalizeCode)
                .filter(code -> !code.isEmpty())
                .collect(Collectors.toCollection(HashSet::new));
    }

    private static String normalizeCode(String code) {
        return code == null ? "" : code.trim().toUpperCase(Locale.ROOT);
    }

    static String normalizeText(String text) {
        String decomposed = Normalizer.normalize(text, Normalizer.Form.NFD);
        String withoutAccents = DIACRITICS.matcher(decomposed).replaceAll("");
        return WHITESPACE.matcher(withoutAccents.trim()).replaceAll(" ").toUpperCase(Locale.ROOT);
    }
}

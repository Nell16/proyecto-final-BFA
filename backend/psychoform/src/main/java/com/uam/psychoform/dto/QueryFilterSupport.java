package com.uam.psychoform.dto;

import jakarta.persistence.criteria.CriteriaBuilder;
import jakarta.persistence.criteria.CriteriaQuery;
import jakarta.persistence.criteria.Path;
import jakarta.persistence.criteria.Predicate;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;

/**
 * Utilidades comunes para paginación, ordenamiento por lista blanca y parsing de filtros
 * en endpoints de listado.
 */
public final class QueryFilterSupport {
    public static final int MAX_PAGE_SIZE = 100;
    public static final int DEFAULT_PAGE_SIZE = 20;

    private QueryFilterSupport() {
    }

    public static PageRequest pageRequest(int page, int size, Sort sort) {
        if (page < 0) {
            throw new IllegalArgumentException("page debe ser mayor o igual a 0");
        }
        if (size < 1) {
            throw new IllegalArgumentException("size debe ser mayor o igual a 1");
        }
        int effectiveSize = Math.min(size, MAX_PAGE_SIZE);
        return PageRequest.of(page, effectiveSize, sort);
    }

    public static Sort parseSort(
            String rawSort,
            String defaultSort,
            Map<String, String> whitelist,
            Set<String> nullableFields) {
        String effective = (rawSort == null || rawSort.isBlank()) ? defaultSort : rawSort.trim();
        String[] parts = effective.split(",", -1);
        if (parts.length > 2 || parts[0].isBlank()) {
            throw new IllegalArgumentException("Orden invalido: " + rawSort);
        }
        String field = parts[0].trim();
        String property = whitelist.get(field);
        if (property == null) {
            throw new IllegalArgumentException("Campo de ordenamiento invalido: " + field);
        }
        Sort.Direction direction = Sort.Direction.ASC;
        if (parts.length == 2) {
            String dir = parts[1].trim().toLowerCase(Locale.ROOT);
            if ("desc".equals(dir)) {
                direction = Sort.Direction.DESC;
            } else if (!"asc".equals(dir)) {
                throw new IllegalArgumentException("Direccion de ordenamiento invalida: " + parts[1]);
            }
        }
        Sort.Order primary = new Sort.Order(direction, property);
        if (nullableFields.contains(field)) {
            primary = primary.nullsLast();
        }
        if ("id".equals(property)) {
            return Sort.by(primary);
        }
        return Sort.by(primary, new Sort.Order(direction, "id"));
    }

    public static String toLikePattern(String raw) {
        String trimmed = trimToNull(raw);
        if (trimmed == null) {
            return null;
        }
        String escaped = trimmed.toLowerCase(Locale.ROOT)
                .replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_");
        return "%" + escaped + "%";
    }

    public static String trimToNull(String raw) {
        if (raw == null) {
            return null;
        }
        String trimmed = raw.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    public static <E extends Enum<E>> E parseEnum(String raw, Class<E> enumType, String label) {
        String trimmed = trimToNull(raw);
        if (trimmed == null) {
            return null;
        }
        try {
            return Enum.valueOf(enumType, trimmed);
        } catch (IllegalArgumentException ex) {
            throw new IllegalArgumentException(label + " invalido: " + raw);
        }
    }

    public static UUID parseUuid(String raw, String paramName) {
        String trimmed = trimToNull(raw);
        if (trimmed == null) {
            return null;
        }
        try {
            return UUID.fromString(trimmed);
        } catch (IllegalArgumentException ex) {
            throw new IllegalArgumentException("Identificador '" + paramName + "' invalido: " + raw);
        }
    }

    public static boolean isCountQuery(CriteriaQuery<?> query) {
        return query != null
                && (Long.class.equals(query.getResultType()) || long.class.equals(query.getResultType()));
    }

    public static DateRange parseDateRange(String rawFrom, String rawTo) {
        return new DateRange(parseBound(rawFrom, "from", false), parseBound(rawTo, "to", true));
    }

    public static void addDateRangePredicates(
            CriteriaBuilder cb,
            Path<LocalDateTime> path,
            DateRange range,
            List<Predicate> predicates) {
        if (range.from() != null) {
            predicates.add(cb.greaterThanOrEqualTo(path, range.from().value()));
        }
        if (range.to() != null) {
            if (range.to().exclusive()) {
                predicates.add(cb.lessThan(path, range.to().value()));
            } else {
                predicates.add(cb.lessThanOrEqualTo(path, range.to().value()));
            }
        }
    }

    private static DateBound parseBound(String raw, String paramName, boolean upperBound) {
        String trimmed = trimToNull(raw);
        if (trimmed == null) {
            return null;
        }
        try {
            return new DateBound(LocalDateTime.parse(trimmed, DateTimeFormatter.ISO_LOCAL_DATE_TIME), false);
        } catch (DateTimeParseException ignored) {
            // Try offset datetime or date-only ISO formats below.
        }
        try {
            LocalDateTime utc = OffsetDateTime.parse(trimmed, DateTimeFormatter.ISO_OFFSET_DATE_TIME)
                    .withOffsetSameInstant(ZoneOffset.UTC)
                    .toLocalDateTime();
            return new DateBound(utc, false);
        } catch (DateTimeParseException ignored) {
            // Try date-only ISO format below.
        }
        try {
            LocalDate date = LocalDate.parse(trimmed, DateTimeFormatter.ISO_LOCAL_DATE);
            return upperBound
                    ? new DateBound(date.plusDays(1).atStartOfDay(), true)
                    : new DateBound(date.atStartOfDay(), false);
        } catch (DateTimeParseException ex) {
            throw new IllegalArgumentException(
                    "Fecha '" + paramName + "' invalida, use formato ISO UTC: " + raw);
        }
    }

    public record DateBound(LocalDateTime value, boolean exclusive) {
    }

    public record DateRange(DateBound from, DateBound to) {
    }
}

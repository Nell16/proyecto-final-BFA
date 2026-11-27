package com.uam.psychoform.reporting.service;

import com.uam.psychoform.assessment.model.EstadoIntento;
import com.uam.psychoform.dto.PageResponse;
import com.uam.psychoform.reporting.dto.AttemptSummaryDto;
import com.uam.psychoform.reporting.dto.AttemptSummaryDto.ParticipantSummary;
import com.uam.psychoform.reporting.dto.AttemptSummaryDto.SessionSummary;
import com.uam.psychoform.reporting.dto.AttemptSummaryDto.VersionSummary;
import com.uam.psychoform.scoring.model.EstadoRevisionManual;
import com.uam.psychoform.scoring.repository.RevisionManualRespuestaRepository;
import com.uam.psychoform.security.SecurityPermissions;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import jakarta.persistence.TypedQuery;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
public class AttemptQueryService {
    private static final int MAX_PAGE_SIZE = 100;
    private static final String DEFAULT_SORT = "finalizadoEn,desc";

    private final EntityManager em;
    private final RevisionManualRespuestaRepository manualReviews;

    public AttemptQueryService(EntityManager em, RevisionManualRespuestaRepository manualReviews) {
        this.em = em;
        this.manualReviews = manualReviews;
    }

    /**
     * Lista intentos paginados con filtros combinables, usando una consulta de proyeccion para la pagina,
     * otra para el conteo total y un agregado por lotes para el numero de revisiones manuales pendientes.
     */
    @PreAuthorize(SecurityPermissions.RESULTADO_VER + " or " + SecurityPermissions.CALIFICACION_EJECUTAR)
    public PageResponse<AttemptSummaryDto> listAttempts(AttemptQuery query) {
        if (query.page() < 0) {
            throw new IllegalArgumentException("page debe ser mayor o igual a 0");
        }
        if (query.size() < 1) {
            throw new IllegalArgumentException("size debe ser mayor o igual a 1");
        }
        int effectiveSize = Math.min(query.size(), MAX_PAGE_SIZE);
        EstadoIntento status = parseStatus(query.status());
        LocalDateTime from = parseUtcDateTime(query.from(), "from");
        LocalDateTime to = parseUtcDateTime(query.to(), "to");
        SortSpec sort = parseSort(query.sort());
        String participantPattern = toParticipantCodePattern(query.participantCode());

        FilterPlan filters = buildFilterPlan(status, query.scored(), query.sessionId(), query.versionTestId(),
                participantPattern, from, to);

        String baseFrom = """
                from IntentoTest i
                join i.asignacion a
                join a.participante p
                join a.sesionAplicacion s
                join s.versionTest v
                join v.test t
                """;
        String resultadoJoin = "left join Resultado r on r.intento.id = i.id\n";

        String selectJpql = """
                select
                  i.id as attemptId,
                  i.estado as status,
                  i.iniciadoEn as startedAt,
                  i.finalizadoEn as finishedAt,
                  i.tiempoTotalSegundos as totalTimeSeconds,
                  p.id as participantId,
                  p.codigoParticipante as participantCode,
                  p.nombres as participantFirstNames,
                  p.apellidos as participantLastNames,
                  s.id as sessionId,
                  s.codigoSesion as sessionCode,
                  s.nombreSesion as sessionName,
                  v.id as versionId,
                  t.nombreTest as testName,
                  v.numeroVersion as versionNumber,
                  r.id as resultId
                """ + baseFrom + resultadoJoin + filters.whereClause() + sort.orderByClause();

        TypedQuery<Tuple> dataQuery = em.createQuery(selectJpql, Tuple.class);
        bindParams(dataQuery, filters.params());
        dataQuery.setFirstResult(query.page() * effectiveSize);
        dataQuery.setMaxResults(effectiveSize);
        List<Tuple> rows = dataQuery.getResultList();

        long total;
        if (query.page() == 0 && rows.size() < effectiveSize) {
            total = rows.size();
        } else {
            String countFrom = baseFrom + (query.scored() != null ? resultadoJoin : "");
            TypedQuery<Long> countQuery = em.createQuery(
                    "select count(i.id) " + countFrom + filters.whereClause(), Long.class);
            bindParams(countQuery, filters.params());
            total = countQuery.getSingleResult();
        }

        Map<Long, Integer> pendingByAttempt = loadPendingManualReviewCounts(rows);
        List<AttemptSummaryDto> dtos = rows.stream()
                .map(row -> toDto(row, pendingByAttempt))
                .toList();

        return PageResponse.from(new PageImpl<>(dtos, PageRequest.of(query.page(), effectiveSize), total));
    }

    private Map<Long, Integer> loadPendingManualReviewCounts(List<Tuple> rows) {
        if (rows.isEmpty()) {
            return Map.of();
        }
        List<Long> attemptIds = rows.stream()
                .map(row -> row.get("attemptId", Long.class))
                .toList();
        Map<Long, Integer> counts = new HashMap<>();
        for (Object[] entry : manualReviews.countUnreviewedByIntentoIds(attemptIds, EstadoRevisionManual.REVISADO)) {
            Long attemptId = ((Number) entry[0]).longValue();
            int count = ((Number) entry[1]).intValue();
            counts.put(attemptId, count);
        }
        return counts;
    }

    private static AttemptSummaryDto toDto(Tuple row, Map<Long, Integer> pendingByAttempt) {
        Long attemptId = row.get("attemptId", Long.class);
        EstadoIntento status = row.get("status", EstadoIntento.class);
        Long resultId = row.get("resultId", Long.class);
        String fullName = formatFullName(
                row.get("participantFirstNames", String.class),
                row.get("participantLastNames", String.class));

        return new AttemptSummaryDto(
                attemptId,
                status.name(),
                row.get("startedAt", LocalDateTime.class),
                row.get("finishedAt", LocalDateTime.class),
                row.get("totalTimeSeconds", Integer.class),
                new ParticipantSummary(
                        row.get("participantId", UUID.class),
                        row.get("participantCode", String.class),
                        fullName),
                new SessionSummary(
                        row.get("sessionId", Long.class),
                        row.get("sessionCode", String.class),
                        row.get("sessionName", String.class)),
                new VersionSummary(
                        row.get("versionId", Long.class),
                        row.get("testName", String.class),
                        row.get("versionNumber", String.class)),
                resultId != null,
                resultId,
                pendingByAttempt.getOrDefault(attemptId, 0));
    }

    private static String formatFullName(String firstNames, String lastNames) {
        String first = firstNames == null ? "" : firstNames.trim();
        String last = lastNames == null ? "" : lastNames.trim();
        return (first + " " + last).trim();
    }

    private static FilterPlan buildFilterPlan(
            EstadoIntento status,
            Boolean scored,
            Long sessionId,
            Long versionTestId,
            String participantPattern,
            LocalDateTime from,
            LocalDateTime to) {
        List<String> predicates = new ArrayList<>();
        Map<String, Object> params = new HashMap<>();

        if (status != null) {
            predicates.add("i.estado = :status");
            params.put("status", status);
        }
        if (scored != null) {
            predicates.add(scored ? "r.id is not null" : "r.id is null");
        }
        if (sessionId != null) {
            predicates.add("s.id = :sessionId");
            params.put("sessionId", sessionId);
        }
        if (versionTestId != null) {
            predicates.add("v.id = :versionTestId");
            params.put("versionTestId", versionTestId);
        }
        if (participantPattern != null) {
            predicates.add("lower(p.codigoParticipante) like :participantCode escape '\\'");
            params.put("participantCode", participantPattern);
        }
        if (from != null) {
            predicates.add("i.finalizadoEn >= :from");
            params.put("from", from);
        }
        if (to != null) {
            predicates.add("i.finalizadoEn <= :to");
            params.put("to", to);
        }

        String whereClause = predicates.isEmpty() ? "" : "where " + String.join(" and ", predicates) + "\n";
        return new FilterPlan(whereClause, params);
    }

    private static void bindParams(TypedQuery<?> query, Map<String, Object> params) {
        params.forEach(query::setParameter);
    }

    private static EstadoIntento parseStatus(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return EstadoIntento.valueOf(raw.trim());
        } catch (IllegalArgumentException ex) {
            throw new IllegalArgumentException("Estado de intento invalido: " + raw);
        }
    }

    private static LocalDateTime parseUtcDateTime(String raw, String paramName) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String trimmed = raw.trim();
        try {
            return LocalDateTime.parse(trimmed, DateTimeFormatter.ISO_LOCAL_DATE_TIME);
        } catch (DateTimeParseException ignored) {
            try {
                return OffsetDateTime.parse(trimmed, DateTimeFormatter.ISO_OFFSET_DATE_TIME)
                        .withOffsetSameInstant(ZoneOffset.UTC)
                        .toLocalDateTime();
            } catch (DateTimeParseException ex) {
                throw new IllegalArgumentException(
                        "Fecha '" + paramName + "' invalida, use formato ISO UTC: " + raw);
            }
        }
    }

    private static String toParticipantCodePattern(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String normalized = raw.trim().toLowerCase(Locale.ROOT)
                .replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_");
        return "%" + normalized + "%";
    }

    private static SortSpec parseSort(String rawSort) {
        String effective = (rawSort == null || rawSort.isBlank()) ? DEFAULT_SORT : rawSort.trim();
        String[] parts = effective.split(",", -1);
        if (parts.length > 2 || parts[0].isBlank()) {
            throw new IllegalArgumentException("Orden invalido: " + rawSort);
        }
        String field = parts[0].trim();
        String jpqlField = switch (field) {
            case "finalizadoEn" -> "i.finalizadoEn";
            case "iniciadoEn" -> "i.iniciadoEn";
            case "participantCode" -> "p.codigoParticipante";
            default -> throw new IllegalArgumentException("Campo de ordenamiento invalido: " + field);
        };
        boolean descending = false;
        if (parts.length == 2) {
            String dir = parts[1].trim().toLowerCase(Locale.ROOT);
            if ("desc".equals(dir)) {
                descending = true;
            } else if (!"asc".equals(dir)) {
                throw new IllegalArgumentException("Direccion de ordenamiento invalida: " + parts[1]);
            }
        }
        String dirSql = descending ? "desc" : "asc";
        String nullsClause = jpqlField.equals("p.codigoParticipante") ? "" : " nulls last";
        return new SortSpec("order by " + jpqlField + " " + dirSql + nullsClause + ", i.id " + dirSql);
    }

    private record FilterPlan(String whereClause, Map<String, Object> params) {
    }

    private record SortSpec(String orderByClause) {
    }

    public record AttemptQuery(
            String status,
            Boolean scored,
            Long sessionId,
            Long versionTestId,
            String participantCode,
            String from,
            String to,
            int page,
            int size,
            String sort) {
    }
}

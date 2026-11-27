package com.uam.psychoform.assessment.service;

import com.uam.psychoform.assessment.dto.SessionSubtestDetailDto;
import com.uam.psychoform.assessment.model.*;
import com.uam.psychoform.assessment.repository.*;
import com.uam.psychoform.dto.EntityView;
import com.uam.psychoform.dto.QueryFilterSupport;
import com.uam.psychoform.instrument.model.EstadoVersionTest;
import com.uam.psychoform.instrument.model.Subtest;
import com.uam.psychoform.instrument.model.VersionTest;
import com.uam.psychoform.instrument.repository.VersionTestRepository;
import com.uam.psychoform.security.CurrentActor;
import com.uam.psychoform.security.SecurityPermissions;
import com.uam.psychoform.security.model.Usuario;
import com.uam.psychoform.security.repository.UsuarioRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityNotFoundException;
import jakarta.persistence.criteria.Fetch;
import jakarta.persistence.criteria.Join;
import jakarta.persistence.criteria.JoinType;
import jakarta.persistence.criteria.Predicate;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
public class SessionManagementService {
    private static final String DEFAULT_SORT = "inicioProgramado,desc";
    private static final Map<String, String> SORT_FIELDS = Map.of(
            "inicioProgramado", "inicioProgramado",
            "finProgramado", "finProgramado",
            "inicioReal", "inicioReal",
            "finReal", "finReal",
            "codigoSesion", "codigoSesion",
            "nombreSesion", "nombreSesion",
            "estado", "estado",
            "creadoEn", "creadoEn",
            "id", "id");
    private static final Set<String> NULLABLE_SORT_FIELDS = Set.of("finProgramado", "inicioReal", "finReal");

    private final SesionAplicacionRepository sesiones;
    private final SesionSubtestRepository sesionSubtests;
    private final VersionTestRepository versiones;
    private final UsuarioRepository usuarios;
    private final CurrentActor currentActor;
    private final EntityManager entityManager;
    private final Clock clock;

    public SessionManagementService(SesionAplicacionRepository sesiones, SesionSubtestRepository sesionSubtests,
            VersionTestRepository versiones, UsuarioRepository usuarios, CurrentActor currentActor,
            EntityManager entityManager, Clock clock) {
        this.sesiones = sesiones;
        this.sesionSubtests = sesionSubtests;
        this.versiones = versiones;
        this.usuarios = usuarios;
        this.currentActor = currentActor;
        this.entityManager = entityManager;
        this.clock = clock;
    }

    @PreAuthorize(SecurityPermissions.SESION_LEER)
    public List<SesionAplicacion> listSessions() {
        return listSessions(null, null);
    }

    @PreAuthorize(SecurityPermissions.SESION_LEER)
    public List<SesionAplicacion> listSessions(SessionFilter filter, String sort) {
        SessionQuerySpec spec = buildSessionQuery(filter, sort);
        return sesiones.findAll(spec.spec(), spec.sort());
    }

    @PreAuthorize(SecurityPermissions.SESION_LEER)
    public Page<SesionAplicacion> listSessionsPage(SessionFilter filter, int page, int size, String sort) {
        SessionQuerySpec spec = buildSessionQuery(filter, sort);
        return sesiones.findAll(spec.spec(), QueryFilterSupport.pageRequest(page, size, spec.sort()));
    }

    private SessionQuerySpec buildSessionQuery(SessionFilter filter, String sort) {
        Sort parsedSort = QueryFilterSupport.parseSort(sort, DEFAULT_SORT, SORT_FIELDS, NULLABLE_SORT_FIELDS);
        SessionFilter effective = filter == null ? SessionFilter.empty() : filter;
        EstadoSesionAplicacion estado = QueryFilterSupport.parseEnum(
                effective.estado(), EstadoSesionAplicacion.class, "Estado de sesion");
        String pattern = QueryFilterSupport.toLikePattern(effective.q());
        QueryFilterSupport.DateRange range = QueryFilterSupport.parseDateRange(effective.from(), effective.to());

        Specification<SesionAplicacion> spec = (root, query, cb) -> {
            boolean countQuery = QueryFilterSupport.isCountQuery(query);
            Join<SesionAplicacion, VersionTest> versionJoin = null;
            if (!countQuery) {
                Fetch<SesionAplicacion, VersionTest> fetched = root.fetch("versionTest", JoinType.INNER);
                if (fetched instanceof Join<?, ?> join) {
                    @SuppressWarnings("unchecked")
                    Join<SesionAplicacion, VersionTest> typed = (Join<SesionAplicacion, VersionTest>) join;
                    versionJoin = typed;
                }
                root.fetch("creadoPor", JoinType.LEFT);
            }
            List<Predicate> predicates = new ArrayList<>();
            if (estado != null) {
                predicates.add(cb.equal(root.get("estado"), estado));
            }
            if (effective.versionTestId() != null) {
                predicates.add(cb.equal(root.get("versionTest").get("id"), effective.versionTestId()));
            }
            if (effective.testId() != null) {
                if (versionJoin == null) {
                    versionJoin = root.join("versionTest", JoinType.INNER);
                }
                predicates.add(cb.equal(versionJoin.get("test").get("id"), effective.testId()));
            }
            if (pattern != null) {
                predicates.add(cb.or(
                        cb.like(cb.lower(root.get("codigoSesion")), pattern, '\\'),
                        cb.like(cb.lower(root.get("nombreSesion")), pattern, '\\')));
            }
            QueryFilterSupport.addDateRangePredicates(cb, root.get("inicioProgramado"), range, predicates);
            return cb.and(predicates.toArray(Predicate[]::new));
        };
        return new SessionQuerySpec(spec, parsedSort);
    }

    private record SessionQuerySpec(Specification<SesionAplicacion> spec, Sort sort) {
    }

    public record SessionFilter(
            String estado,
            Long versionTestId,
            Long testId,
            String q,
            String from,
            String to) {
        public static SessionFilter empty() {
            return new SessionFilter(null, null, null, null, null, null);
        }
    }

    @PreAuthorize(SecurityPermissions.SESION_LEER)
    public SesionAplicacion getSession(long sessionId) {
        return sesiones.findById(sessionId)
                .orElseThrow(() -> new EntityNotFoundException("Sesion no encontrada: " + sessionId));
    }

    @PreAuthorize(SecurityPermissions.SESION_LEER)
    @SuppressWarnings("unchecked")
    public Map<String, Object> getSessionDetail(long sessionId) {
        List<Object[]> rows = sesiones.findDetailRowsById(sessionId);
        if (rows.isEmpty()) {
            throw new EntityNotFoundException("Sesion no encontrada: " + sessionId);
        }
        SesionAplicacion session = (SesionAplicacion) rows.get(0)[0];
        List<SessionSubtestDetailDto> subtests = rows.stream()
                .filter(row -> row[1] != null)
                .map(row -> toSubtestDetailDto((SesionSubtest) row[1], (Subtest) row[2]))
                .toList();
        Map<String, Object> view = new LinkedHashMap<>((Map<String, Object>) EntityView.of(session));
        VersionTest version = session.getVersionTest();
        view.put("testId", version.getTest().getId());
        view.put("testName", version.getTest().getNombreTest());
        view.put("versionNumber", version.getNumeroVersion());
        view.put("subtests", subtests);
        return view;
    }

    private SessionSubtestDetailDto toSubtestDetailDto(SesionSubtest ss, Subtest subtest) {
        Integer timeLimitSeconds = ss.getTiempoLimiteSegundos() != null
                ? ss.getTiempoLimiteSegundos()
                : subtest.getTiempoLimiteSegundos();
        return new SessionSubtestDetailDto(
                subtest.getId(),
                subtest.getCodigoSubtest(),
                subtest.getNombreSubtest(),
                ss.getNumeroOrden(),
                timeLimitSeconds,
                ss.getPermiteAleatorizarItems(),
                ss.getPermiteAleatorizarOpciones());
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.SESION_CREAR)
    public SesionAplicacion create(CreateSessionCommand command) {
        VersionTest version = versiones.findById(command.versionTestId())
                .orElseThrow(() -> new EntityNotFoundException("Version no encontrada: " + command.versionTestId()));
        if (version.getEstado() != EstadoVersionTest.PUBLICADO) {
            throw new IllegalStateException("La sesion requiere una version publicada");
        }
        UUID actorId = currentActor.usuarioId();
        Usuario actor = usuarios.findById(actorId)
                .orElseThrow(() -> new EntityNotFoundException("Usuario autenticado no encontrado: " + actorId));
        SesionAplicacion session = new SesionAplicacion();
        session.setVersionTest(version);
        session.setCodigoSesion(command.code());
        session.setNombreSesion(command.name());
        session.setDescripcion(command.description());
        session.setInicioProgramado(command.scheduledStart());
        session.setFinProgramado(command.scheduledEnd());
        session.setUbicacion(command.location());
        session.setEstado(EstadoSesionAplicacion.PROGRAMADA);
        session.setCreadoPor(actor);
        session.setCreadoEn(LocalDateTime.now(clock));
        return sesiones.save(session);
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.SESION_CREAR)
    public List<SesionSubtest> replaceSubtests(long sessionId, List<SessionSubtestCommand> commands,
            boolean deleteOmitted) {
        validateSubtestCommands(commands);
        SesionAplicacion session = sesiones.findByIdForUpdate(sessionId)
                .orElseThrow(() -> new EntityNotFoundException("Sesion no encontrada: " + sessionId));
        if (session.getEstado() != EstadoSesionAplicacion.PROGRAMADA) {
            throw new IllegalStateException("Solo se configuran subtests en sesiones programadas");
        }
        // Sin mode=replace el PUT es un upsert que conserva los subtests omitidos (contrato previo a B15, del que
        // depende el wizard actual). Con mode=replace los omitidos se eliminan (con lista vacia, todos).
        if (deleteOmitted) {
            if (commands.isEmpty()) {
                sesionSubtests.deleteBySesionAplicacionId(sessionId);
            } else {
                List<Long> subtestIds = commands.stream().map(SessionSubtestCommand::subtestId).toList();
                sesionSubtests.deleteBySesionAplicacionIdAndSubtestIdNotIn(sessionId, subtestIds);
            }
            entityManager.flush();
        }
        List<SesionSubtest> result = new ArrayList<>(commands.stream()
                .map(command -> saveSubtest(session, command))
                .toList());
        if (!deleteOmitted && !commands.isEmpty()) {
            result.addAll(relocateKeptSubtests(sessionId, commands));
        }
        result.sort(Comparator.comparing(SesionSubtest::getNumeroOrden));
        return result;
    }

    /**
     * En el modo upsert los subtests omitidos se conservan, pero no pueden competir por las posiciones que el
     * cliente acaba de asignar: se reubican a continuacion de la mayor posicion enviada, manteniendo su orden
     * relativo actual. La UNIQUE (sesion_aplicacion_id, numero_orden) es DEFERRABLE, asi que basta con dejar el
     * estado final consistente antes del commit (el flush lo fuerza dentro de la misma transaccion).
     */
    private List<SesionSubtest> relocateKeptSubtests(long sessionId, List<SessionSubtestCommand> commands) {
        Set<Long> sentSubtestIds = commands.stream().map(SessionSubtestCommand::subtestId)
                .collect(Collectors.toSet());
        int nextOrder = commands.stream().mapToInt(SessionSubtestCommand::order).max().orElse(0) + 1;
        List<SesionSubtest> kept = sesionSubtests.findBySesionAplicacionIdOrderByNumeroOrdenAsc(sessionId).stream()
                .filter(row -> !sentSubtestIds.contains(row.getSubtest().getId()))
                .toList();
        for (SesionSubtest row : kept) {
            row.setNumeroOrden(nextOrder++);
        }
        entityManager.flush();
        return kept;
    }

    private void validateSubtestCommands(List<SessionSubtestCommand> commands) {
        if (commands == null) {
            throw new IllegalArgumentException("La lista de subtests es obligatoria");
        }
        Set<Long> seenSubtestIds = new HashSet<>();
        Set<Integer> seenOrders = new HashSet<>();
        for (SessionSubtestCommand command : commands) {
            if (command == null || command.subtestId() == null) {
                throw new IllegalArgumentException("El subtestId es obligatorio");
            }
            if (command.order() == null || command.order() < 1) {
                throw new IllegalArgumentException("El orden del subtest debe ser mayor o igual a 1");
            }
            if (command.timeLimitSeconds() != null && command.timeLimitSeconds() < 1) {
                throw new IllegalArgumentException("El tiempo limite debe ser mayor o igual a 1");
            }
            if (!seenSubtestIds.add(command.subtestId())) {
                throw new IllegalArgumentException("Subtest duplicado: " + command.subtestId());
            }
            if (!seenOrders.add(command.order())) {
                throw new IllegalArgumentException("Orden de subtest duplicado: " + command.order());
            }
        }
    }

    private SesionSubtest saveSubtest(SesionAplicacion session, SessionSubtestCommand command) {
        Subtest subtest = entityManager.find(Subtest.class, command.subtestId());
        if (subtest == null) {
            throw new EntityNotFoundException("Subtest no encontrado: " + command.subtestId());
        }
        if (!subtest.getVersionTest().getId().equals(session.getVersionTest().getId())) {
            throw new IllegalArgumentException("El subtest no pertenece a la version de la sesion");
        }
        SesionSubtest row = sesionSubtests.findBySesionAplicacionIdAndSubtestId(session.getId(), subtest.getId())
                .orElseGet(SesionSubtest::new);
        row.setSesionAplicacion(session);
        row.setVersionTest(session.getVersionTest());
        row.setSubtest(subtest);
        row.setNumeroOrden(command.order());
        row.setTiempoLimiteSegundos(command.timeLimitSeconds());
        
        boolean randomizeItems = Boolean.TRUE.equals(command.randomizeItems());
        if (randomizeItems && !Boolean.TRUE.equals(session.getVersionTest().getPermiteAleatorizarItems())) {
            randomizeItems = false;
        }
        row.setPermiteAleatorizarItems(randomizeItems);
        row.setPermiteAleatorizarOpciones(Boolean.TRUE.equals(command.randomizeOptions()));
        return sesionSubtests.save(row);
    }

    public record CreateSessionCommand(Long versionTestId, String code, String name, String description,
            LocalDateTime scheduledStart, LocalDateTime scheduledEnd, String location) {
    }

    public record SessionSubtestCommand(Long subtestId, Integer order, Integer timeLimitSeconds,
            Boolean randomizeItems, Boolean randomizeOptions) {
    }
}

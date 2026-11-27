package com.uam.psychoform.audit.service;

import com.uam.psychoform.audit.model.Auditoria;
import com.uam.psychoform.audit.repository.AuditoriaRepository;
import com.uam.psychoform.dto.QueryFilterSupport;
import com.uam.psychoform.security.CurrentActor;
import com.uam.psychoform.security.SecurityPermissions;
import com.uam.psychoform.security.model.Usuario;
import com.uam.psychoform.security.repository.UsuarioRepository;
import jakarta.persistence.criteria.JoinType;
import jakarta.persistence.criteria.Predicate;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
public class AuditLogService {
    private static final String DEFAULT_SORT = "creadoEn,desc";
    private static final Map<String, String> SORT_FIELDS = Map.of(
            "creadoEn", "creadoEn",
            "accion", "accion",
            "entidad", "entidad",
            "entidadId", "entidadId",
            "id", "id");
    private static final Set<String> NULLABLE_SORT_FIELDS = Set.of("entidadId");

    private final AuditoriaRepository repository;
    private final UsuarioRepository usuarios;
    private final CurrentActor currentActor;
    private final Clock clock;

    public AuditLogService(AuditoriaRepository repository, UsuarioRepository usuarios, CurrentActor currentActor,
            Clock clock) {
        this.repository = repository;
        this.usuarios = usuarios;
        this.currentActor = currentActor;
        this.clock = clock;
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.AUDITORIA_REGISTRAR)
    public Auditoria record(AuditEvent event) {
        return recordInternal(event);
    }

    @Transactional
    @PreAuthorize("permitAll()")
    public Auditoria recordTrusted(AuditEvent event) {
        return recordInternal(event);
    }

    private Auditoria recordInternal(AuditEvent event) {
        Auditoria audit = new Auditoria();
        audit.setUsuario(resolveCurrentActorOrNull());
        audit.setAccion(event.action());
        audit.setEntidad(event.entity());
        audit.setEntidadId(event.entityId());
        audit.setValorAnterior(event.previousValuesJson());
        audit.setValorNuevo(event.newValuesJson());
        audit.setDireccionIp(event.ip());
        audit.setAgenteUsuario(event.userAgent());
        audit.setCreadoEn(LocalDateTime.now(clock));
        repository.save(audit);
        return audit;
    }

    @PreAuthorize(SecurityPermissions.AUDITORIA_VER)
    public List<Auditoria> listByEntity(String entity, String entityId) {
        return repository.findByEntidadAndEntidadIdOrderByCreadoEnDesc(entity, entityId);
    }

    @PreAuthorize(SecurityPermissions.AUDITORIA_VER)
    public List<Auditoria> listAll() {
        return repository.findAll(org.springframework.data.domain.Sort.by(org.springframework.data.domain.Sort.Direction.DESC, "creadoEn"));
    }

    @PreAuthorize(SecurityPermissions.AUDITORIA_VER)
    public List<Auditoria> listRecent() {
        return repository.findAllByOrderByCreadoEnDesc();
    }

    @PreAuthorize(SecurityPermissions.AUDITORIA_VER)
    public List<Auditoria> list(AuditFilter filter, String sort) {
        AuditQuerySpec spec = buildAuditQuery(filter, sort);
        return repository.findAll(spec.spec(), spec.sort());
    }

    @PreAuthorize(SecurityPermissions.AUDITORIA_VER)
    public Page<Auditoria> listPage(AuditFilter filter, int page, int size, String sort) {
        AuditQuerySpec spec = buildAuditQuery(filter, sort);
        return repository.findAll(spec.spec(), QueryFilterSupport.pageRequest(page, size, spec.sort()));
    }

    private AuditQuerySpec buildAuditQuery(AuditFilter filter, String sort) {
        Sort parsedSort = QueryFilterSupport.parseSort(sort, DEFAULT_SORT, SORT_FIELDS, NULLABLE_SORT_FIELDS);
        AuditFilter effective = filter == null ? AuditFilter.empty() : filter;
        String entity = QueryFilterSupport.trimToNull(effective.entity());
        String entityId = QueryFilterSupport.trimToNull(effective.entityId());
        String action = QueryFilterSupport.trimToNull(effective.action());
        UUID actorUuid = resolveActorId(effective.userId(), effective.actorId());
        QueryFilterSupport.DateRange range = QueryFilterSupport.parseDateRange(effective.from(), effective.to());

        Specification<Auditoria> spec = (root, query, cb) -> {
            if (!QueryFilterSupport.isCountQuery(query)) {
                root.fetch("usuario", JoinType.LEFT);
            }
            List<Predicate> predicates = new ArrayList<>();
            if (entity != null) {
                predicates.add(cb.equal(root.get("entidad"), entity));
            }
            if (entityId != null) {
                predicates.add(cb.equal(root.get("entidadId"), entityId));
            }
            if (action != null) {
                predicates.add(cb.equal(root.get("accion"), action));
            }
            if (actorUuid != null) {
                predicates.add(cb.equal(root.get("usuario").get("id"), actorUuid));
            }
            QueryFilterSupport.addDateRangePredicates(cb, root.get("creadoEn"), range, predicates);
            return cb.and(predicates.toArray(Predicate[]::new));
        };
        return new AuditQuerySpec(spec, parsedSort);
    }

    private static UUID resolveActorId(String rawUserId, String rawActorId) {
        UUID userId = QueryFilterSupport.parseUuid(rawUserId, "userId");
        UUID actorId = QueryFilterSupport.parseUuid(rawActorId, "actorId");
        if (userId != null && actorId != null && !userId.equals(actorId)) {
            throw new IllegalArgumentException("userId y actorId no coinciden");
        }
        return userId != null ? userId : actorId;
    }

    private record AuditQuerySpec(Specification<Auditoria> spec, Sort sort) {
    }

    public record AuditFilter(
            String entity,
            String entityId,
            String action,
            String userId,
            String actorId,
            String from,
            String to) {
        public static AuditFilter empty() {
            return new AuditFilter(null, null, null, null, null, null, null);
        }
    }

    private Usuario resolveCurrentActorOrNull() {
        try {
            return usuarios.findById(currentActor.usuarioId()).orElse(null);
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    public record AuditEvent(String action, String entity, String entityId, String previousValuesJson,
            String newValuesJson, String ip, String userAgent) {
    }
}

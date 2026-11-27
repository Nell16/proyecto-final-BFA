package com.uam.psychoform.academic.service;

import com.uam.psychoform.academic.model.Participante;
import com.uam.psychoform.academic.repository.CarreraRepository;
import com.uam.psychoform.academic.repository.CatalogoSexoRepository;
import com.uam.psychoform.academic.repository.CohorteRepository;
import com.uam.psychoform.academic.repository.GrupoAcademicoRepository;
import com.uam.psychoform.academic.repository.ParticipanteRepository;
import com.uam.psychoform.dto.QueryFilterSupport;
import com.uam.psychoform.security.SecurityPermissions;
import com.uam.psychoform.security.model.EstadoGeneral;
import jakarta.persistence.EntityNotFoundException;
import jakarta.persistence.criteria.JoinType;
import jakarta.persistence.criteria.Predicate;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.security.access.prepost.PreAuthorize;

@Service
@Transactional(readOnly = true)
public class ParticipanteService {
    private static final String DEFAULT_SORT = "apellidos,asc";
    private static final Map<String, String> SORT_FIELDS = Map.of(
            "apellidos", "apellidos",
            "nombres", "nombres",
            "codigoParticipante", "codigoParticipante",
            "fechaNacimiento", "fechaNacimiento",
            "estado", "estado",
            "creadoEn", "creadoEn",
            "actualizadoEn", "actualizadoEn",
            "id", "id");
    private static final Set<String> NULLABLE_SORT_FIELDS = Set.of("fechaNacimiento");

    private final ParticipanteRepository repository;
    private final CatalogoSexoRepository sexoRepository;
    private final CarreraRepository carreraRepository;
    private final CohorteRepository cohorteRepository;
    private final GrupoAcademicoRepository grupoRepository;
    private final Clock clock;

    public ParticipanteService(
            ParticipanteRepository repository,
            CatalogoSexoRepository sexoRepository,
            CarreraRepository carreraRepository,
            CohorteRepository cohorteRepository,
            GrupoAcademicoRepository grupoRepository,
            Clock clock) {
        this.repository = repository;
        this.sexoRepository = sexoRepository;
        this.carreraRepository = carreraRepository;
        this.cohorteRepository = cohorteRepository;
        this.grupoRepository = grupoRepository;
        this.clock = clock;
    }

    @PreAuthorize(SecurityPermissions.PARTICIPANTE_LEER)
    public Page<Participante> listar(int page, int size) {
        return listar(null, page, size, null);
    }

    @PreAuthorize(SecurityPermissions.PARTICIPANTE_LEER)
    public Page<Participante> listar(ParticipantFilter filter, int page, int size, String sort) {
        Sort parsedSort = QueryFilterSupport.parseSort(sort, DEFAULT_SORT, SORT_FIELDS, NULLABLE_SORT_FIELDS);
        PageRequest pageable = QueryFilterSupport.pageRequest(page, size, parsedSort);
        ParticipantFilter effectiveFilter = filter == null ? ParticipantFilter.empty() : filter;
        EstadoGeneral estado = QueryFilterSupport.parseEnum(effectiveFilter.estado(), EstadoGeneral.class,
                "Estado de participante");
        String pattern = QueryFilterSupport.toLikePattern(effectiveFilter.q());

        Specification<Participante> spec = (root, query, cb) -> {
            if (!QueryFilterSupport.isCountQuery(query)) {
                root.fetch("sexo", JoinType.LEFT);
                root.fetch("carrera", JoinType.LEFT);
                root.fetch("cohorte", JoinType.LEFT);
                root.fetch("grupoAcademico", JoinType.LEFT);
            }
            List<Predicate> predicates = new ArrayList<>();
            if (pattern != null) {
                predicates.add(cb.or(
                        cb.like(cb.lower(root.get("codigoParticipante")), pattern, '\\'),
                        cb.like(cb.lower(root.get("nombres")), pattern, '\\'),
                        cb.like(cb.lower(root.get("apellidos")), pattern, '\\')));
            }
            if (estado != null) {
                predicates.add(cb.equal(root.get("estado"), estado));
            }
            if (effectiveFilter.sexoId() != null) {
                predicates.add(cb.equal(root.get("sexo").get("id"), effectiveFilter.sexoId()));
            }
            if (effectiveFilter.carreraId() != null) {
                predicates.add(cb.equal(root.get("carrera").get("id"), effectiveFilter.carreraId()));
            }
            if (effectiveFilter.cohorteId() != null) {
                predicates.add(cb.equal(root.get("cohorte").get("id"), effectiveFilter.cohorteId()));
            }
            if (effectiveFilter.grupoAcademicoId() != null) {
                predicates.add(cb.equal(root.get("grupoAcademico").get("id"), effectiveFilter.grupoAcademicoId()));
            }
            return cb.and(predicates.toArray(Predicate[]::new));
        };
        return repository.findAll(spec, pageable);
    }

    public record ParticipantFilter(
            String q,
            String estado,
            Short sexoId,
            Short carreraId,
            Short cohorteId,
            Short grupoAcademicoId) {
        public static ParticipantFilter empty() {
            return new ParticipantFilter(null, null, null, null, null, null);
        }
    }

    @PreAuthorize(SecurityPermissions.PARTICIPANTE_LEER)
    public Participante obtener(UUID participanteId) {
        return buscarPorId(participanteId);
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.PARTICIPANTE_CREAR)
    public Participante registrar(String codigoParticipante, String nombres, String apellidos) {
        return registrar(codigoParticipante, nombres, apellidos, null, null, null, null, null);
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.PARTICIPANTE_CREAR)
    public Participante registrar(
            String codigoParticipante,
            String nombres,
            String apellidos,
            Short sexoId,
            Short carreraId,
            Short cohorteId,
            Short grupoAcademicoId) {
        return registrar(codigoParticipante, nombres, apellidos, null, sexoId, carreraId, cohorteId, grupoAcademicoId);
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.PARTICIPANTE_CREAR)
    public Participante registrar(
            String codigoParticipante,
            String nombres,
            String apellidos,
            LocalDate fechaNacimiento,
            Short sexoId,
            Short carreraId,
            Short cohorteId,
            Short grupoAcademicoId) {
        if (repository.existsByCodigoParticipante(codigoParticipante)) {
            throw new IllegalStateException("Ya existe el participante: " + codigoParticipante);
        }
        LocalDateTime ahora = LocalDateTime.now(clock);
        Participante participante = new Participante();
        participante.setId(UUID.randomUUID());
        participante.setCodigoParticipante(codigoParticipante);
        participante.setNombres(nombres);
        participante.setApellidos(apellidos);
        participante.setFechaNacimiento(fechaNacimiento);
        participante.setEstado(EstadoGeneral.ACTIVO);
        participante.setCreadoEn(ahora);
        participante.setActualizadoEn(ahora);
        asignarRelacionesAcademicas(participante, sexoId, carreraId, cohorteId, grupoAcademicoId);
        return repository.save(participante);
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.PARTICIPANTE_MODIFICAR)
    public Participante actualizar(
            UUID participanteId,
            String codigoParticipante,
            String nombres,
            String apellidos,
            LocalDate fechaNacimiento,
            Short sexoId,
            Short carreraId,
            Short cohorteId,
            Short grupoAcademicoId) {
        Participante participante = buscarPorId(participanteId);
        if (codigoParticipante != null && !codigoParticipante.equals(participante.getCodigoParticipante())) {
            throw new IllegalArgumentException("El código del participante no es editable");
        }
        participante.setNombres(nombres);
        participante.setApellidos(apellidos);
        participante.setFechaNacimiento(fechaNacimiento);
        participante.setActualizadoEn(LocalDateTime.now(clock));
        asignarRelacionesAcademicas(participante, sexoId, carreraId, cohorteId, grupoAcademicoId);
        return repository.save(participante);
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.PARTICIPANTE_ELIMINAR)
    public void desactivar(UUID participanteId) {
        Participante participante = obtener(participanteId);
        participante.setEstado(EstadoGeneral.INACTIVO);
        participante.setActualizadoEn(LocalDateTime.now(clock));
        repository.save(participante);
    }

    private Participante buscarPorId(UUID participanteId) {
        return repository.findById(participanteId)
                .orElseThrow(() -> new EntityNotFoundException("Participante no encontrado: " + participanteId));
    }

    private void asignarRelacionesAcademicas(
            Participante participante,
            Short sexoId,
            Short carreraId,
            Short cohorteId,
            Short grupoAcademicoId) {
        participante.setSexo(sexoId != null ? sexoRepository.getReferenceById(sexoId) : null);
        participante.setCarrera(carreraId != null ? carreraRepository.getReferenceById(carreraId) : null);
        participante.setCohorte(cohorteId != null ? cohorteRepository.getReferenceById(cohorteId) : null);
        participante.setGrupoAcademico(grupoAcademicoId != null ? grupoRepository.getReferenceById(grupoAcademicoId) : null);
    }
}

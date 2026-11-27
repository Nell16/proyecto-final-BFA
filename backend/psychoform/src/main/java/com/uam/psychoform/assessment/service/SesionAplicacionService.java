package com.uam.psychoform.assessment.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.uam.psychoform.assessment.dto.PausaSesionDto;
import com.uam.psychoform.assessment.model.EstadoSesionAplicacion;
import com.uam.psychoform.assessment.model.PausaSesion;
import com.uam.psychoform.assessment.model.SesionAplicacion;
import com.uam.psychoform.assessment.repository.PausaSesionRepository;
import com.uam.psychoform.assessment.repository.SesionAplicacionRepository;
import com.uam.psychoform.audit.service.AuditLogService;
import com.uam.psychoform.security.CurrentActor;
import com.uam.psychoform.security.SecurityPermissions;
import com.uam.psychoform.security.model.Usuario;
import com.uam.psychoform.security.repository.UsuarioRepository;
import jakarta.persistence.EntityNotFoundException;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Ciclo de vida de la sesion de aplicacion:
 * PROGRAMADA -activar-> ABIERTA -pausar-> PAUSADA -reanudar-> ABIERTA;
 * ABIERTA|PAUSADA -cerrar-> CERRADA; PROGRAMADA|ABIERTA|PAUSADA -cancelar-> CANCELADA.
 * Cualquier otra transicion lanza IllegalStateException (409).
 */
@Service
@Transactional(readOnly = true)
public class SesionAplicacionService {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String ENTIDAD = "sesion_aplicacion";

    private final SesionAplicacionRepository repository;
    private final PausaSesionRepository pausas;
    private final UsuarioRepository usuarios;
    private final CurrentActor currentActor;
    private final AuditLogService audit;
    private final Clock clock;

    public SesionAplicacionService(SesionAplicacionRepository repository, PausaSesionRepository pausas,
            UsuarioRepository usuarios, CurrentActor currentActor, AuditLogService audit, Clock clock) {
        this.repository = repository;
        this.pausas = pausas;
        this.usuarios = usuarios;
        this.currentActor = currentActor;
        this.audit = audit;
        this.clock = clock;
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.SESION_APLICAR)
    public SesionAplicacion abrir(Long sesionId) {
        SesionAplicacion sesion = obtenerBloqueada(sesionId);
        requerirEstado(sesion, EnumSet.of(EstadoSesionAplicacion.PROGRAMADA));
        if (sesion.getInicioReal() == null) {
            sesion.setInicioReal(LocalDateTime.now(clock));
        }
        sesion.setEstado(EstadoSesionAplicacion.ABIERTA);
        return repository.save(sesion);
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.SESION_APLICAR)
    public SesionAplicacion pausar(Long sesionId, String motivo) {
        SesionAplicacion sesion = obtenerBloqueada(sesionId);
        requerirEstado(sesion, EnumSet.of(EstadoSesionAplicacion.ABIERTA));
        if (pausas.findFirstBySesionAplicacionIdAndReanudadoEnIsNull(sesion.getId()).isPresent()) {
            throw new IllegalStateException("La sesion ya tiene una pausa abierta");
        }
        LocalDateTime now = LocalDateTime.now(clock);
        String motivoNormalizado = motivo == null || motivo.isBlank() ? null : motivo.trim();
        PausaSesion pausa = new PausaSesion();
        pausa.setSesionAplicacion(sesion);
        pausa.setPausadoEn(now);
        pausa.setPausadoPor(actor());
        pausa.setMotivo(motivoNormalizado);
        pausas.save(pausa);

        sesion.setEstado(EstadoSesionAplicacion.PAUSADA);
        sesion.setPausadoEn(now);
        SesionAplicacion guardada = repository.save(sesion);
        Map<String, Object> detalle = new LinkedHashMap<>();
        detalle.put("estado", EstadoSesionAplicacion.PAUSADA.name());
        detalle.put("pausaId", pausa.getId());
        detalle.put("pausadoEn", now.toString());
        detalle.put("motivo", motivoNormalizado);
        auditar("SESION_PAUSADA", sesion, EstadoSesionAplicacion.ABIERTA, detalle);
        return guardada;
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.SESION_APLICAR)
    public SesionAplicacion reanudar(Long sesionId) {
        SesionAplicacion sesion = obtenerBloqueada(sesionId);
        requerirEstado(sesion, EnumSet.of(EstadoSesionAplicacion.PAUSADA));
        LocalDateTime now = LocalDateTime.now(clock);
        PausaSesion pausa = cerrarPausaAbierta(sesion, now);
        if (pausa == null) {
            throw new IllegalStateException("La sesion no tiene una pausa abierta para reanudar");
        }

        sesion.setEstado(EstadoSesionAplicacion.ABIERTA);
        sesion.setPausadoEn(null);
        SesionAplicacion guardada = repository.save(sesion);
        Map<String, Object> detalle = new LinkedHashMap<>();
        detalle.put("estado", EstadoSesionAplicacion.ABIERTA.name());
        detalle.put("pausaId", pausa.getId());
        detalle.put("pausadoEn", pausa.getPausadoEn().toString());
        detalle.put("reanudadoEn", now.toString());
        detalle.put("motivo", pausa.getMotivo());
        auditar("SESION_REANUDADA", sesion, EstadoSesionAplicacion.PAUSADA, detalle);
        return guardada;
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.SESION_APLICAR)
    public SesionAplicacion cerrar(Long sesionId) {
        return finalizar(sesionId, EnumSet.of(EstadoSesionAplicacion.ABIERTA, EstadoSesionAplicacion.PAUSADA),
                EstadoSesionAplicacion.CERRADA);
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.SESION_APLICAR)
    public SesionAplicacion cancelar(Long sesionId) {
        return finalizar(sesionId, EnumSet.of(EstadoSesionAplicacion.PROGRAMADA, EstadoSesionAplicacion.ABIERTA,
                EstadoSesionAplicacion.PAUSADA), EstadoSesionAplicacion.CANCELADA);
    }

    @PreAuthorize(SecurityPermissions.SESION_LEER)
    public List<PausaSesionDto> listarPausas(Long sesionId) {
        if (!repository.existsById(sesionId)) {
            throw new EntityNotFoundException("Sesión no encontrada: " + sesionId);
        }
        return pausas.findBySesionAplicacionIdOrderByPausadoEnAsc(sesionId).stream()
                .map(p -> new PausaSesionDto(p.getId(), p.getPausadoEn(), p.getReanudadoEn(),
                        p.getPausadoPor() == null ? null : p.getPausadoPor().getId(), p.getMotivo()))
                .toList();
    }

    private SesionAplicacion finalizar(Long sesionId, Set<EstadoSesionAplicacion> origenes,
            EstadoSesionAplicacion destino) {
        SesionAplicacion sesion = obtenerBloqueada(sesionId);
        requerirEstado(sesion, origenes);
        LocalDateTime now = LocalDateTime.now(clock);
        if (sesion.getEstado() == EstadoSesionAplicacion.PAUSADA) {
            cerrarPausaAbierta(sesion, now);
            sesion.setPausadoEn(null);
        }
        sesion.setFinReal(now);
        sesion.setEstado(destino);
        return repository.save(sesion);
    }

    private PausaSesion cerrarPausaAbierta(SesionAplicacion sesion, LocalDateTime now) {
        return pausas.findFirstBySesionAplicacionIdAndReanudadoEnIsNull(sesion.getId()).map(pausa -> {
            pausa.setReanudadoEn(now);
            pausa.setReanudadoPor(actor());
            return pausas.save(pausa);
        }).orElse(null);
    }

    private static void requerirEstado(SesionAplicacion sesion, Set<EstadoSesionAplicacion> permitidos) {
        if (!permitidos.contains(sesion.getEstado())) {
            throw new IllegalStateException("Transición de sesión inválida desde " + sesion.getEstado());
        }
    }

    private Usuario actor() {
        return usuarios.getReferenceById(currentActor.usuarioId());
    }

    private void auditar(String accion, SesionAplicacion sesion, EstadoSesionAplicacion anterior,
            Map<String, Object> nuevo) {
        audit.recordTrusted(new AuditLogService.AuditEvent(accion, ENTIDAD, String.valueOf(sesion.getId()),
                json(Map.of("estado", anterior.name())), json(nuevo), null, null));
    }

    private static String json(Map<String, Object> value) {
        try {
            return JSON.writeValueAsString(value);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("No se pudo serializar la auditoria", ex);
        }
    }

    private SesionAplicacion obtenerBloqueada(Long id) {
        return repository.findByIdForUpdate(id).orElseThrow(() -> new EntityNotFoundException("Sesión no encontrada: " + id));
    }
}

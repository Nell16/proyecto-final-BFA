package com.uam.psychoform.audit.dto;

import com.uam.psychoform.audit.model.Auditoria;
import com.uam.psychoform.security.model.Usuario;
import java.time.LocalDateTime;
import java.util.UUID;

public record AuditLogDto(
        Long id,
        AuditActorDto usuario,
        String accion,
        String entidad,
        String entidadId,
        String valorAnterior,
        String valorNuevo,
        String direccionIp,
        String agenteUsuario,
        LocalDateTime creadoEn) {

    public static AuditLogDto from(Auditoria audit) {
        Usuario actor = audit.getUsuario();
        AuditActorDto actorDto = actor == null
                ? null
                : new AuditActorDto(actor.getId(), actor.getNombreUsuario(), actor.getNombreCompleto());
        return new AuditLogDto(
                audit.getId(),
                actorDto,
                audit.getAccion(),
                audit.getEntidad(),
                audit.getEntidadId(),
                audit.getValorAnterior(),
                audit.getValorNuevo(),
                audit.getDireccionIp(),
                audit.getAgenteUsuario(),
                audit.getCreadoEn());
    }

    public record AuditActorDto(UUID id, String nombreUsuario, String nombreCompleto) {
    }
}

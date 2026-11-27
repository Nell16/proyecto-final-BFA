package com.uam.psychoform.academic.controller;

import com.uam.psychoform.academic.dto.ParticipantRequest;
import com.uam.psychoform.academic.dto.ParticipantUpdateRequest;

import com.uam.psychoform.academic.model.Participante;
import com.uam.psychoform.academic.service.ParticipanteService;
import com.uam.psychoform.dto.ApiResponse;
import com.uam.psychoform.dto.EntityView;
import com.uam.psychoform.dto.PageResponse;
import com.uam.psychoform.security.SecurityPermissions;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/participantes")
public class ParticipantController {
    private final ParticipanteService service;

    public ParticipantController(ParticipanteService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize(SecurityPermissions.PARTICIPANTE_LEER)
    public ApiResponse<PageResponse<Object>> list(
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String estado,
            @RequestParam(required = false) Short sexoId,
            @RequestParam(required = false) Short carreraId,
            @RequestParam(required = false) Short cohorteId,
            @RequestParam(required = false) Short grupoAcademicoId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(defaultValue = "apellidos,asc") String sort) {
        var filter = new ParticipanteService.ParticipantFilter(q, estado, sexoId, carreraId, cohorteId,
                grupoAcademicoId);
        return ApiResponse.ok(PageResponse.from(service.listar(filter, page, size, sort).map(EntityView::of)));
    }

    @GetMapping("/{id}")
    @PreAuthorize(SecurityPermissions.PARTICIPANTE_LEER)
    public ApiResponse<?> get(@PathVariable UUID id) {
        return ApiResponse.ok(EntityView.of(service.obtener(id)));
    }

    @PostMapping
    @PreAuthorize(SecurityPermissions.PARTICIPANTE_CREAR)
    public ApiResponse<Participante> create(@Valid @RequestBody ParticipantRequest request) {
        return ApiResponse.ok(service.registrar(
                request.code(),
                request.firstNames(),
                request.lastNames(),
                request.fechaNacimiento(),
                request.sexoId(),
                request.carreraId(),
                request.cohorteId(),
                request.grupoAcademicoId()));
    }

    @PutMapping("/{id}")
    @PreAuthorize(SecurityPermissions.PARTICIPANTE_MODIFICAR)
    public ApiResponse<?> update(
            @PathVariable UUID id,
            @Valid @RequestBody ParticipantUpdateRequest request) {
        return ApiResponse.ok(EntityView.of(service.actualizar(
                id,
                request.code(),
                request.firstNames(),
                request.lastNames(),
                request.fechaNacimiento(),
                request.sexoId(),
                request.carreraId(),
                request.cohorteId(),
                request.grupoAcademicoId())));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize(SecurityPermissions.PARTICIPANTE_ELIMINAR)
    public ApiResponse<Void> deactivate(@PathVariable UUID id) {
        service.desactivar(id);
        return ApiResponse.ok(null);
    }
}

package com.uam.psychoform.audit.controller;

import com.uam.psychoform.audit.dto.AuditLogDto;
import com.uam.psychoform.audit.service.AuditLogService;
import com.uam.psychoform.dto.ApiResponse;
import com.uam.psychoform.dto.PageResponse;
import com.uam.psychoform.security.SecurityPermissions;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/auditoria")
public class AuditController {
    private final AuditLogService audit;

    public AuditController(AuditLogService audit) {
        this.audit = audit;
    }

    @GetMapping
    @PreAuthorize(SecurityPermissions.AUDITORIA_VER)
    public ApiResponse<?> list(
            @RequestParam(required = false) String entity,
            @RequestParam(required = false) String entityId,
            @RequestParam(required = false) String action,
            @RequestParam(required = false) String userId,
            @RequestParam(required = false) String actorId,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(required = false) Integer page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(defaultValue = "creadoEn,desc") String sort) {
        var filter = new AuditLogService.AuditFilter(entity, entityId, action, userId, actorId, from, to);
        if (page == null) {
            return ApiResponse.ok(audit.list(filter, sort).stream().map(AuditLogDto::from).toList());
        }
        return ApiResponse.ok(PageResponse.from(audit.listPage(filter, page, size, sort).map(AuditLogDto::from)));
    }
}

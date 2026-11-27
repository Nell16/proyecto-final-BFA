package com.uam.psychoform.reporting.controller;

import com.uam.psychoform.dto.ApiResponse;
import com.uam.psychoform.dto.PageResponse;
import com.uam.psychoform.reporting.dto.AttemptSummaryDto;
import com.uam.psychoform.reporting.service.AttemptQueryService;
import com.uam.psychoform.reporting.service.AttemptQueryService.AttemptQuery;
import com.uam.psychoform.security.SecurityPermissions;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/attempts")
public class AttemptController {
    private final AttemptQueryService queries;

    public AttemptController(AttemptQueryService queries) {
        this.queries = queries;
    }

    @GetMapping
    @PreAuthorize(SecurityPermissions.RESULTADO_VER + " or " + SecurityPermissions.CALIFICACION_EJECUTAR)
    public ApiResponse<PageResponse<AttemptSummaryDto>> list(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) Boolean scored,
            @RequestParam(required = false) Long sessionId,
            @RequestParam(required = false) Long versionTestId,
            @RequestParam(required = false) String participantCode,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(defaultValue = "finalizadoEn,desc") String sort) {
        return ApiResponse.ok(queries.listAttempts(new AttemptQuery(
                status, scored, sessionId, versionTestId, participantCode, from, to, page, size, sort)));
    }
}

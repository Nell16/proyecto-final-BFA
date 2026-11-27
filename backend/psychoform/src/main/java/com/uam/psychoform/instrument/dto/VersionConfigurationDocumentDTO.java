package com.uam.psychoform.instrument.dto;

import java.util.List;

/** B7: respuesta de GET /test-versions/{id}/configuration. {@code version} es el EntityView de VersionTest. */
public record VersionConfigurationDocumentDTO(Object version, List<SubtestCloneTemplateDTO> subtests) {
}

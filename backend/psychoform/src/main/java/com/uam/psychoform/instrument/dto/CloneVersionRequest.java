package com.uam.psychoform.instrument.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** B9: cuerpo de POST /test-versions/{id}/clone. */
public record CloneVersionRequest(@NotBlank @Size(max = 30) String versionNumber) {
}

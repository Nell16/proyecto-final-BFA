package com.uam.psychoform.assessment.dto;

import jakarta.validation.constraints.Size;

public record PauseSessionRequest(@Size(max = 300) String motivo) {
}

package com.uam.psychoform.instrument.dto;

public record ImageResourceUploadResponse(Long resourceId, String storagePath, String mimeType,
        String originalFileName, Long sizeBytes, String sha256, String uploadKey) {
}

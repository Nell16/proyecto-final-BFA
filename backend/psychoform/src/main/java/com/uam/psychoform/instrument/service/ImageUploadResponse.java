package com.uam.psychoform.instrument.service;

public record ImageUploadResponse(Long imageLinkId, Long resourceId, String storagePath, String filename,
        String mimeType, Long sizeBytes, String hash, Integer order, String altText, String role, String uploadKey) {
    public ImageUploadResponse(Long imageLinkId, Long resourceId, String storagePath, String filename,
            String mimeType, Long sizeBytes, String hash, Integer order, String altText, String role) {
        this(imageLinkId, resourceId, storagePath, filename, mimeType, sizeBytes, hash, order, altText, role, null);
    }
}

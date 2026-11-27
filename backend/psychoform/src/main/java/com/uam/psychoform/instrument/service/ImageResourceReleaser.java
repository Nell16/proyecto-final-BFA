package com.uam.psychoform.instrument.service;

import com.uam.psychoform.instrument.model.RecursoMultimedia;
import com.uam.psychoform.storage.ObjectStorageService;
import jakarta.persistence.EntityManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Libera un {@link RecursoMultimedia} cuando un vinculo de imagen deja de usarlo.
 *
 * <p>Un recurso puede estar compartido: B9 clona las imagenes de una version como filas nuevas de
 * {@code imagen_item}/{@code imagen_opcion} que apuntan al mismo recurso. Por eso reemplazar o eliminar una imagen
 * solo cambia el vinculo; el recurso (y su objeto en storage) se borra unicamente si, tras el flush, ninguna otra fila
 * lo referencia. Las unicas tablas que referencian {@code recurso_multimedia} son {@code imagen_item} e
 * {@code imagen_opcion} (ver 20260621000100_create_bfa_schema.sql).
 *
 * <p>El objeto de storage se borra DESPUES del commit: si la transaccion se revierte, la BD sigue apuntando a un
 * objeto que existe. Un fallo del borrado posterior al commit solo deja un objeto huerfano (se registra y no se
 * propaga, porque la BD ya esta confirmada).
 */
@Component
public class ImageResourceReleaser {
    private static final Logger LOG = LoggerFactory.getLogger(ImageResourceReleaser.class);

    private final EntityManager em;
    private final ObjectStorageService storage;

    public ImageResourceReleaser(EntityManager em, ObjectStorageService storage) {
        this.em = em;
        this.storage = storage;
    }

    /**
     * Debe llamarse DESPUES de modificar o eliminar el vinculo. Devuelve true si el recurso quedo sin referencias y se
     * programo su borrado.
     */
    public boolean releaseIfUnreferenced(RecursoMultimedia resource) {
        if (resource == null) {
            return false;
        }
        em.flush();
        if (isReferenced(resource)) {
            return false;
        }
        String path = resource.getRutaAlmacenamiento();
        em.remove(resource);
        em.flush();
        deleteObjectAfterCommit(path);
        return true;
    }

    private boolean isReferenced(RecursoMultimedia resource) {
        long itemLinks = em.createQuery("SELECT COUNT(img) FROM ImagenItem img WHERE img.recurso.id = :id",
                Long.class).setParameter("id", resource.getId()).getSingleResult();
        if (itemLinks > 0) {
            return true;
        }
        long optionLinks = em.createQuery("SELECT COUNT(img) FROM ImagenOpcion img WHERE img.recurso.id = :id",
                Long.class).setParameter("id", resource.getId()).getSingleResult();
        return optionLinks > 0;
    }

    private void deleteObjectAfterCommit(String path) {
        if (path == null || path.isBlank()) {
            return;
        }
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    deleteBestEffort(path);
                }
            });
        } else {
            deleteBestEffort(path);
        }
    }

    private void deleteBestEffort(String path) {
        try {
            storage.deleteObject(path);
        } catch (RuntimeException ex) {
            LOG.warn("No se pudo borrar el objeto de storage {} tras confirmar la BD; queda huerfano", path, ex);
        }
    }
}

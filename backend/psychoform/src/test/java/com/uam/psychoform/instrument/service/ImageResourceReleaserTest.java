package com.uam.psychoform.instrument.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.uam.psychoform.instrument.model.RecursoMultimedia;
import com.uam.psychoform.storage.ObjectStorageService;
import jakarta.persistence.EntityManager;
import jakarta.persistence.TypedQuery;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

class ImageResourceReleaserTest {
    private final EntityManager em = Mockito.mock(EntityManager.class);
    private final ObjectStorageService storage = Mockito.mock(ObjectStorageService.class);
    private final ImageResourceReleaser releaser = new ImageResourceReleaser(em, storage);

    @AfterEach
    void clearSynchronization() {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    @Test
    void conReferenciasRestantesNoBorraNadaNiElObjeto() {
        RecursoMultimedia resource = resource();
        stubReferences(1L, 0L);

        assertThat(releaser.releaseIfUnreferenced(resource)).isFalse();

        verify(em, never()).remove(resource);
        verify(storage, never()).deleteObject(Mockito.anyString());
    }

    @Test
    void sinReferenciasBorraElRecursoYElObjetoSoloTrasElCommit() {
        RecursoMultimedia resource = resource();
        stubReferences(0L, 0L);
        TransactionSynchronizationManager.initSynchronization();

        assertThat(releaser.releaseIfUnreferenced(resource)).isTrue();

        verify(em).remove(resource);
        verify(storage, never()).deleteObject(Mockito.anyString());
        TransactionSynchronizationManager.getSynchronizations().forEach(TransactionSynchronization::afterCommit);
        verify(storage).deleteObject("test-config/x.png");
    }

    @Test
    void siLaTransaccionSeRevierteElObjetoNoSeBorra() {
        RecursoMultimedia resource = resource();
        stubReferences(0L, 0L);
        TransactionSynchronizationManager.initSynchronization();

        releaser.releaseIfUnreferenced(resource);
        TransactionSynchronizationManager.getSynchronizations()
                .forEach(sync -> sync.afterCompletion(TransactionSynchronization.STATUS_ROLLED_BACK));

        verify(storage, never()).deleteObject(Mockito.anyString());
    }

    @Test
    void unFalloDelBorradoPosteriorAlCommitNoSePropaga() {
        RecursoMultimedia resource = resource();
        stubReferences(0L, 0L);
        Mockito.doThrow(new IllegalStateException("storage caido")).when(storage).deleteObject("test-config/x.png");
        TransactionSynchronizationManager.initSynchronization();

        releaser.releaseIfUnreferenced(resource);
        List<TransactionSynchronization> syncs = TransactionSynchronizationManager.getSynchronizations();

        syncs.forEach(TransactionSynchronization::afterCommit);
        verify(storage).deleteObject("test-config/x.png");
    }

    private void stubReferences(Long itemLinks, Long optionLinks) {
        TypedQuery<Long> itemQuery = typedQuery(itemLinks);
        TypedQuery<Long> optionQuery = typedQuery(optionLinks);
        when(em.createQuery("SELECT COUNT(img) FROM ImagenItem img WHERE img.recurso.id = :id", Long.class))
                .thenReturn(itemQuery);
        when(em.createQuery("SELECT COUNT(img) FROM ImagenOpcion img WHERE img.recurso.id = :id", Long.class))
                .thenReturn(optionQuery);
    }

    private TypedQuery<Long> typedQuery(Long result) {
        TypedQuery<Long> query = Mockito.mock();
        when(query.setParameter(Mockito.eq("id"), Mockito.any())).thenReturn(query);
        when(query.getSingleResult()).thenReturn(result);
        return query;
    }

    private RecursoMultimedia resource() {
        RecursoMultimedia resource = new RecursoMultimedia();
        resource.setId(5L);
        resource.setRutaAlmacenamiento("test-config/x.png");
        return resource;
    }
}

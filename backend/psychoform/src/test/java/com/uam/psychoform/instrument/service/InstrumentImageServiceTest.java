package com.uam.psychoform.instrument.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.uam.psychoform.instrument.model.EstadoVersionTest;
import com.uam.psychoform.instrument.model.ImagenItem;
import com.uam.psychoform.instrument.model.ImagenOpcion;
import com.uam.psychoform.instrument.model.Item;
import com.uam.psychoform.instrument.model.OpcionItem;
import com.uam.psychoform.instrument.model.RecursoMultimedia;
import com.uam.psychoform.instrument.model.Subtest;
import com.uam.psychoform.instrument.model.VersionTest;
import com.uam.psychoform.instrument.repository.VersionTestRepository;
import com.uam.psychoform.security.CurrentActor;
import com.uam.psychoform.security.model.Usuario;
import com.uam.psychoform.security.repository.UsuarioRepository;
import com.uam.psychoform.storage.ObjectStorageService;
import com.uam.psychoform.storage.StoredObject;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceException;
import jakarta.persistence.TypedQuery;
import java.io.IOException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.PlatformTransactionManager;

class InstrumentImageServiceTest {
    private static final UUID ACTOR_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private final EntityManager em = Mockito.mock(EntityManager.class);
    private final VersionTestRepository versions = Mockito.mock(VersionTestRepository.class);
    private final UsuarioRepository users = Mockito.mock(UsuarioRepository.class);
    private final CurrentActor currentActor = Mockito.mock(CurrentActor.class);
    private final ObjectStorageService storage = Mockito.mock(ObjectStorageService.class);
    private final InstrumentImageService service = new InstrumentImageService(em, versions, users, currentActor,
            storage, Clock.fixed(Instant.parse("2026-06-26T10:15:30Z"), ZoneOffset.UTC),
            new ImageResourceReleaser(em, storage), Mockito.mock(PlatformTransactionManager.class));

    @Test
    void rechazaArchivoVacioSinSubirAStorage() {
        MockMultipartFile empty = new MockMultipartFile("file", "empty.png", "image/png", new byte[0]);

        assertThatThrownBy(() -> service.uploadItemImage(10L, empty, 1, "alt", "ENUNCIADO"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("vacio");
        verify(storage, never()).putObject(anyString(), anyString(), any());
    }

    @Test
    void rechazaMimeNoPermitidoSinSubirAStorage() {
        MockMultipartFile text = new MockMultipartFile("file", "bad.txt", "text/plain", "bad".getBytes());

        assertThatThrownBy(() -> service.uploadItemImage(10L, text, 1, "alt", "ENUNCIADO"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Tipo de imagen no permitido");
        verify(storage, never()).putObject(anyString(), anyString(), any());
    }

    @Test
    void exigeVersionBorradorAntesDeSubirImagenDeItem() {
        Item item = itemWithVersion(10L, 20L, EstadoVersionTest.APROBADO);
        when(em.find(Item.class, 10L)).thenReturn(item);
        when(versions.findByIdForUpdate(20L)).thenReturn(Optional.of(item.getSubtest().getVersionTest()));

        MockMultipartFile file = new MockMultipartFile("file", "figura.png", "image/png", "img".getBytes());

        assertThatThrownBy(() -> service.uploadItemImage(10L, file, 1, "alt", "ENUNCIADO"))
                .isInstanceOf(IllegalStateException.class);
        verify(storage, never()).putObject(anyString(), anyString(), any());
    }

    @Test
    void cargaImagenDeItemSubeAStorageYPersisteMetadatos() throws IOException {
        Item item = itemWithVersion(10L, 20L, EstadoVersionTest.BORRADOR);
        Usuario actor = new Usuario();
        actor.setId(ACTOR_ID);
        when(em.find(Item.class, 10L)).thenReturn(item);
        when(versions.findByIdForUpdate(20L)).thenReturn(Optional.of(item.getSubtest().getVersionTest()));
        when(currentActor.usuarioId()).thenReturn(ACTOR_ID);
        when(users.findById(ACTOR_ID)).thenReturn(Optional.of(actor));
        when(storage.putObject(anyString(), anyString(), any())).thenReturn(new StoredObject("stored-key", "etag"));

        MockMultipartFile file = new MockMultipartFile("file", "Figura 1.png", "image/png", "img".getBytes());

        ImageUploadResponse response = service.uploadItemImage(10L, file, 2, "Figura", "ENUNCIADO");

        assertThat(response.storagePath()).startsWith("test-config/items/10/");
        assertThat(response.filename()).isEqualTo("Figura 1.png");
        assertThat(response.mimeType()).isEqualTo("image/png");
        assertThat(response.sizeBytes()).isEqualTo(3L);
        assertThat(response.hash()).isEqualTo("b29814cf5792e684cd75d6a7fce7a67a11887e312f87ca2ac2496d81f365ff72");
        assertThat(response.order()).isEqualTo(2);
        assertThat(response.altText()).isEqualTo("Figura");
        assertThat(response.role()).isEqualTo("ENUNCIADO");

        ArgumentCaptor<Object> persisted = ArgumentCaptor.forClass(Object.class);
        verify(em, Mockito.times(2)).persist(persisted.capture());
        RecursoMultimedia recurso = persisted.getAllValues().stream()
                .filter(RecursoMultimedia.class::isInstance)
                .map(RecursoMultimedia.class::cast)
                .findFirst()
                .orElseThrow();
        ImagenItem imagen = persisted.getAllValues().stream()
                .filter(ImagenItem.class::isInstance)
                .map(ImagenItem.class::cast)
                .findFirst()
                .orElseThrow();
        assertThat(recurso.getRutaAlmacenamiento()).startsWith("test-config/items/10/");
        assertThat(recurso.getHashIntegridad()).isEqualTo(response.hash());
        assertThat(recurso.getSubidoPor()).isSameAs(actor);
        assertThat(imagen.getItem()).isSameAs(item);
        assertThat(imagen.getRecurso()).isSameAs(recurso);
    }

    @Test
    void cargaImagenDeOpcionSubeAStorageYPersisteMetadatos() throws IOException {
        Item item = itemWithVersion(10L, 20L, EstadoVersionTest.BORRADOR);
        OpcionItem option = new OpcionItem();
        option.setId(33L);
        option.setItem(item);
        Usuario actor = new Usuario();
        actor.setId(ACTOR_ID);
        when(em.find(OpcionItem.class, 33L)).thenReturn(option);
        when(versions.findByIdForUpdate(20L)).thenReturn(Optional.of(item.getSubtest().getVersionTest()));
        when(currentActor.usuarioId()).thenReturn(ACTOR_ID);
        when(users.findById(ACTOR_ID)).thenReturn(Optional.of(actor));
        when(storage.putObject(anyString(), anyString(), any())).thenReturn(new StoredObject("stored-key", "etag"));

        MockMultipartFile file = new MockMultipartFile("file", "opcion.webp", "image/webp", "img".getBytes());

        ImageUploadResponse response = service.uploadOptionImage(33L, file, 1, "Opcion");

        assertThat(response.storagePath()).startsWith("test-config/options/33/");
        assertThat(response.role()).isNull();
        ArgumentCaptor<Object> persisted = ArgumentCaptor.forClass(Object.class);
        verify(em, Mockito.times(2)).persist(persisted.capture());
        ImagenOpcion imagen = persisted.getAllValues().stream()
                .filter(ImagenOpcion.class::isInstance)
                .map(ImagenOpcion.class::cast)
                .findFirst()
                .orElseThrow();
        assertThat(imagen.getOpcion()).isSameAs(option);
    }

    @Test
    void borraObjetoSubidoSiFallaLaPersistencia() throws IOException {
        Item item = itemWithVersion(10L, 20L, EstadoVersionTest.BORRADOR);
        when(em.find(Item.class, 10L)).thenReturn(item);
        when(versions.findByIdForUpdate(20L)).thenReturn(Optional.of(item.getSubtest().getVersionTest()));
        when(currentActor.usuarioId()).thenReturn(ACTOR_ID);
        when(users.findById(ACTOR_ID)).thenReturn(Optional.of(new Usuario()));
        when(storage.putObject(anyString(), anyString(), any())).thenReturn(new StoredObject("stored-key", "etag"));
        Mockito.doThrow(new PersistenceException("db")).when(em).persist(any(ImagenItem.class));

        MockMultipartFile file = new MockMultipartFile("file", "figura.png", "image/png", "img".getBytes());

        assertThatThrownBy(() -> service.uploadItemImage(10L, file, 1, null, null))
                .isInstanceOf(PersistenceException.class);
        verify(storage).deleteObject(anyString());
    }

    @Test
    void borraObjetoSubidoSiFallaElFlushDeLaPersistencia() throws IOException {
        Item item = itemWithVersion(10L, 20L, EstadoVersionTest.BORRADOR);
        when(em.find(Item.class, 10L)).thenReturn(item);
        when(versions.findByIdForUpdate(20L)).thenReturn(Optional.of(item.getSubtest().getVersionTest()));
        when(currentActor.usuarioId()).thenReturn(ACTOR_ID);
        when(users.findById(ACTOR_ID)).thenReturn(Optional.of(new Usuario()));
        when(storage.putObject(anyString(), anyString(), any())).thenReturn(new StoredObject("stored-key", "etag"));
        Mockito.doThrow(new PersistenceException("db")).when(em).flush();

        MockMultipartFile file = new MockMultipartFile("file", "figura.png", "image/png", "img".getBytes());

        assertThatThrownBy(() -> service.uploadItemImage(10L, file, 1, null, null))
                .isInstanceOf(PersistenceException.class);
        verify(storage).deleteObject(anyString());
    }

    @Test
    void reemplazaImagenDeItemPorOrdenYBorraObjetoAnteriorTrasPersistir() throws IOException {
        Item item = itemWithVersion(10L, 20L, EstadoVersionTest.BORRADOR);
        ImagenItem image = new ImagenItem();
        image.setId(55L);
        image.setItem(item);
        image.setNumeroOrden(2);
        image.setRolImagen("ENUNCIADO");
        image.setTextoAlternativo("Anterior");
        RecursoMultimedia previous = new RecursoMultimedia();
        previous.setId(77L);
        previous.setRutaAlmacenamiento("test-config/items/10/old.png");
        image.setRecurso(previous);
        Usuario actor = new Usuario();
        actor.setId(ACTOR_ID);
        TypedQuery<ImagenItem> query = Mockito.mock();
        when(em.find(Item.class, 10L)).thenReturn(item);
        when(em.createQuery(
                "SELECT img FROM ImagenItem img WHERE img.item.id = :itemId AND img.numeroOrden = :order",
                ImagenItem.class)).thenReturn(query);
        when(query.setParameter("itemId", 10L)).thenReturn(query);
        when(query.setParameter("order", 2)).thenReturn(query);
        when(query.setMaxResults(1)).thenReturn(query);
        when(query.getResultList()).thenReturn(java.util.List.of(image));
        when(versions.findByIdForUpdate(20L)).thenReturn(Optional.of(item.getSubtest().getVersionTest()));
        when(currentActor.usuarioId()).thenReturn(ACTOR_ID);
        when(users.findById(ACTOR_ID)).thenReturn(Optional.of(actor));
        when(storage.putObject(anyString(), anyString(), any())).thenReturn(new StoredObject("stored-key", "etag"));
        stubLinkCounts(0L, 0L);
        MockMultipartFile file = new MockMultipartFile("file", "nueva.png", "image/png", "new".getBytes());

        ImageUploadResponse response = service.replaceItemImageByOrder(10L, 2, file, "Nueva", "ENUNCIADO");

        assertThat(response.imageLinkId()).isEqualTo(55L);
        assertThat(image.getRecurso()).isNotSameAs(previous);
        assertThat(image.getTextoAlternativo()).isEqualTo("Nueva");
        verify(em).remove(previous);
        verify(storage).deleteObject("test-config/items/10/old.png");
    }

    @Test
    void reemplazarConRecursoCompartidoSoloCambiaElVinculoYNoBorraElObjeto() throws IOException {
        Item item = itemWithVersion(10L, 20L, EstadoVersionTest.BORRADOR);
        ImagenItem image = new ImagenItem();
        image.setId(55L);
        image.setItem(item);
        image.setNumeroOrden(2);
        image.setRolImagen("ENUNCIADO");
        RecursoMultimedia shared = new RecursoMultimedia();
        shared.setId(77L);
        shared.setRutaAlmacenamiento("test-config/items/10/shared.png");
        image.setRecurso(shared);
        when(em.find(Item.class, 10L)).thenReturn(item);
        when(em.find(ImagenItem.class, 55L)).thenReturn(image);
        when(versions.findByIdForUpdate(20L)).thenReturn(Optional.of(item.getSubtest().getVersionTest()));
        when(currentActor.usuarioId()).thenReturn(ACTOR_ID);
        when(users.findById(ACTOR_ID)).thenReturn(Optional.of(new Usuario()));
        when(storage.putObject(anyString(), anyString(), any())).thenReturn(new StoredObject("stored-key", "etag"));
        // Otra version (la original) sigue apuntando al mismo recurso.
        stubLinkCounts(1L, 0L);
        MockMultipartFile file = new MockMultipartFile("file", "nueva.png", "image/png", "new".getBytes());

        service.replaceItemImage(10L, 55L, file, "Nueva", "ENUNCIADO");

        assertThat(image.getRecurso()).isNotSameAs(shared);
        verify(em, never()).remove(shared);
        verify(storage, never()).deleteObject("test-config/items/10/shared.png");
    }

    private void stubLinkCounts(Long itemLinks, Long optionLinks) {
        TypedQuery<Long> itemCount = Mockito.mock();
        TypedQuery<Long> optionCount = Mockito.mock();
        when(itemCount.setParameter(Mockito.eq("id"), any())).thenReturn(itemCount);
        when(itemCount.getSingleResult()).thenReturn(itemLinks);
        when(optionCount.setParameter(Mockito.eq("id"), any())).thenReturn(optionCount);
        when(optionCount.getSingleResult()).thenReturn(optionLinks);
        when(em.createQuery("SELECT COUNT(img) FROM ImagenItem img WHERE img.recurso.id = :id", Long.class))
                .thenReturn(itemCount);
        when(em.createQuery("SELECT COUNT(img) FROM ImagenOpcion img WHERE img.recurso.id = :id", Long.class))
                .thenReturn(optionCount);
    }

    @Test
    void reemplazoBorraObjetoNuevoSiFallaLaTransaccionYConservaElAnterior() throws IOException {
        Item item = itemWithVersion(10L, 20L, EstadoVersionTest.BORRADOR);
        ImagenItem image = new ImagenItem();
        image.setId(55L);
        image.setItem(item);
        image.setNumeroOrden(2);
        image.setRolImagen("ENUNCIADO");
        RecursoMultimedia previous = new RecursoMultimedia();
        previous.setRutaAlmacenamiento("test-config/items/10/old.png");
        image.setRecurso(previous);
        when(em.find(Item.class, 10L)).thenReturn(item);
        when(em.find(ImagenItem.class, 55L)).thenReturn(image);
        when(versions.findByIdForUpdate(20L)).thenReturn(Optional.of(item.getSubtest().getVersionTest()));
        when(currentActor.usuarioId()).thenReturn(ACTOR_ID);
        when(users.findById(ACTOR_ID)).thenReturn(Optional.of(new Usuario()));
        when(storage.putObject(anyString(), anyString(), any())).thenReturn(new StoredObject("stored-key", "etag"));
        Mockito.doThrow(new PersistenceException("db")).when(em).flush();
        MockMultipartFile file = new MockMultipartFile("file", "nueva.png", "image/png", "new".getBytes());

        assertThatThrownBy(() -> service.replaceItemImage(10L, 55L, file, "Nueva", "ENUNCIADO"))
                .isInstanceOf(PersistenceException.class);

        assertThat(image.getRecurso()).isSameAs(previous);
        verify(storage).deleteObject(Mockito.startsWith("test-config/items/10/"));
        verify(storage, never()).deleteObject("test-config/items/10/old.png");
    }

    @Test
    void duplicadoDeOrdenDevuelveErrorDeConflictoClaro() throws IOException {
        Item item = itemWithVersion(10L, 20L, EstadoVersionTest.BORRADOR);
        when(em.find(Item.class, 10L)).thenReturn(item);
        when(versions.findByIdForUpdate(20L)).thenReturn(Optional.of(item.getSubtest().getVersionTest()));
        when(currentActor.usuarioId()).thenReturn(ACTOR_ID);
        when(users.findById(ACTOR_ID)).thenReturn(Optional.of(new Usuario()));
        when(storage.putObject(anyString(), anyString(), any())).thenReturn(new StoredObject("stored-key", "etag"));
        Mockito.doThrow(new PersistenceException("duplicate key value violates unique constraint \"imagen_item_item_id_numero_orden_key\""))
                .when(em).flush();
        MockMultipartFile file = new MockMultipartFile("file", "figura.png", "image/png", "img".getBytes());

        assertThatThrownBy(() -> service.uploadItemImage(10L, file, 1, null, null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Ya existe una imagen")
                .hasMessageContaining("orden 1");
    }

    @Test
    void idempotencyKeyRepetidaConMismoArchivoDevuelveRecursoExistenteSinSubirAStorage() throws IOException {
        Item item = itemWithVersion(10L, 20L, EstadoVersionTest.BORRADOR);
        when(em.find(Item.class, 10L)).thenReturn(item);
        when(versions.findByIdForUpdate(20L)).thenReturn(Optional.of(item.getSubtest().getVersionTest()));
        when(currentActor.usuarioId()).thenReturn(ACTOR_ID);

        byte[] content = "img".getBytes();
        String expectedHash = "b29814cf5792e684cd75d6a7fce7a67a11887e312f87ca2ac2496d81f365ff72";
        RecursoMultimedia existing = new RecursoMultimedia();
        existing.setId(77L);
        existing.setRutaAlmacenamiento("test-config/items/10/figura.png");
        existing.setNombreArchivo("figura.png");
        existing.setTipoMime("image/png");
        existing.setTamanoBytes((long) content.length);
        existing.setHashIntegridad(expectedHash);
        existing.setClaveSubida(scoped(ImageUploadKeys.Operation.ITEM, "11111111-2222-3333-4444-555555555555"));

        ImagenItem existingLink = new ImagenItem();
        existingLink.setId(55L);
        existingLink.setItem(item);
        existingLink.setRecurso(existing);
        existingLink.setNumeroOrden(2);
        existingLink.setTextoAlternativo("Figura");
        existingLink.setRolImagen("ENUNCIADO");

        TypedQuery<RecursoMultimedia> resourceQuery = Mockito.mock();
        when(em.createQuery("SELECT r FROM RecursoMultimedia r WHERE r.claveSubida = :uploadKey",
                RecursoMultimedia.class)).thenReturn(resourceQuery);
        when(resourceQuery.setParameter("uploadKey", scoped(ImageUploadKeys.Operation.ITEM, "11111111-2222-3333-4444-555555555555")))
                .thenReturn(resourceQuery);
        when(resourceQuery.setMaxResults(1)).thenReturn(resourceQuery);
        when(resourceQuery.getResultList()).thenReturn(java.util.List.of(existing));

        TypedQuery<ImagenItem> linkQuery = Mockito.mock();
        when(em.createQuery("SELECT img FROM ImagenItem img WHERE img.item.id = :itemId AND img.recurso.id = :resourceId",
                ImagenItem.class)).thenReturn(linkQuery);
        when(linkQuery.setParameter("itemId", 10L)).thenReturn(linkQuery);
        when(linkQuery.setParameter("resourceId", 77L)).thenReturn(linkQuery);
        when(linkQuery.setMaxResults(1)).thenReturn(linkQuery);
        when(linkQuery.getResultList()).thenReturn(java.util.List.of(existingLink));

        MockMultipartFile file = new MockMultipartFile("file", "figura.png", "image/png", content);
        ImageUploadResponse response = service.uploadItemImage(10L, file, 2, "Figura", "ENUNCIADO",
                "11111111-2222-3333-4444-555555555555");

        assertThat(response.imageLinkId()).isEqualTo(55L);
        assertThat(response.resourceId()).isEqualTo(77L);
        assertThat(response.uploadKey()).isEqualTo("11111111-2222-3333-4444-555555555555");
        verify(storage, never()).putObject(anyString(), anyString(), any());
        verify(em, never()).persist(any());
    }

    @Test
    void idempotencyKeyRepetidaConArchivoDistintoLanzaConflicto() {
        Item item = itemWithVersion(10L, 20L, EstadoVersionTest.BORRADOR);
        when(em.find(Item.class, 10L)).thenReturn(item);
        when(versions.findByIdForUpdate(20L)).thenReturn(Optional.of(item.getSubtest().getVersionTest()));
        when(currentActor.usuarioId()).thenReturn(ACTOR_ID);

        RecursoMultimedia existing = new RecursoMultimedia();
        existing.setId(77L);
        existing.setHashIntegridad("otro-hash");
        existing.setClaveSubida(scoped(ImageUploadKeys.Operation.ITEM, "11111111-2222-3333-4444-555555555555"));

        TypedQuery<RecursoMultimedia> resourceQuery = Mockito.mock();
        when(em.createQuery("SELECT r FROM RecursoMultimedia r WHERE r.claveSubida = :uploadKey",
                RecursoMultimedia.class)).thenReturn(resourceQuery);
        when(resourceQuery.setParameter("uploadKey", scoped(ImageUploadKeys.Operation.ITEM, "11111111-2222-3333-4444-555555555555")))
                .thenReturn(resourceQuery);
        when(resourceQuery.setMaxResults(1)).thenReturn(resourceQuery);
        when(resourceQuery.getResultList()).thenReturn(java.util.List.of(existing));

        MockMultipartFile file = new MockMultipartFile("file", "figura.png", "image/png", "distinto".getBytes());

        assertThatThrownBy(() -> service.uploadItemImage(10L, file, 2, "Figura", "ENUNCIADO",
                "11111111-2222-3333-4444-555555555555"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Idempotency-Key");
        verify(storage, never()).putObject(anyString(), anyString(), any());
    }

    @Test
    void replaceItemImageConIdempotencyKeyRepetidaDevuelveRecursoActualSinResubir() throws Exception {
        Item item = itemWithVersion(10L, 20L, EstadoVersionTest.BORRADOR);
        byte[] content = "new".getBytes();
        String expectedHash = java.util.HexFormat.of()
                .formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(content));
        RecursoMultimedia current = new RecursoMultimedia();
        current.setId(88L);
        current.setRutaAlmacenamiento("test-config/items/10/nueva.png");
        current.setNombreArchivo("nueva.png");
        current.setTipoMime("image/png");
        current.setTamanoBytes((long) content.length);
        current.setHashIntegridad(expectedHash);
        current.setClaveSubida(scoped(ImageUploadKeys.Operation.REPLACE_ITEM, "key-put-1"));

        ImagenItem image = new ImagenItem();
        image.setId(55L);
        image.setItem(item);
        image.setNumeroOrden(2);
        image.setRolImagen("ENUNCIADO");
        image.setTextoAlternativo("Nueva");
        image.setRecurso(current);

        when(em.find(Item.class, 10L)).thenReturn(item);
        when(em.find(ImagenItem.class, 55L)).thenReturn(image);
        when(versions.findByIdForUpdate(20L)).thenReturn(Optional.of(item.getSubtest().getVersionTest()));
        when(currentActor.usuarioId()).thenReturn(ACTOR_ID);

        TypedQuery<RecursoMultimedia> resourceQuery = Mockito.mock();
        when(em.createQuery("SELECT r FROM RecursoMultimedia r WHERE r.claveSubida = :uploadKey",
                RecursoMultimedia.class)).thenReturn(resourceQuery);
        when(resourceQuery.setParameter("uploadKey", scoped(ImageUploadKeys.Operation.REPLACE_ITEM, "key-put-1"))).thenReturn(resourceQuery);
        when(resourceQuery.setMaxResults(1)).thenReturn(resourceQuery);
        when(resourceQuery.getResultList()).thenReturn(java.util.List.of(current));

        MockMultipartFile file = new MockMultipartFile("file", "nueva.png", "image/png", content);
        ImageUploadResponse response = service.replaceItemImage(10L, 55L, file, "Nueva", "ENUNCIADO", "key-put-1");

        assertThat(response.resourceId()).isEqualTo(88L);
        assertThat(response.uploadKey()).isEqualTo("key-put-1");
        verify(storage, never()).putObject(anyString(), anyString(), any());
        verify(storage, never()).deleteObject(anyString());
    }

    @Test
    void uploadLooseResourceGuardaSoloRecursoMultimediaSinCrearVinculos() throws IOException {
        Usuario actor = new Usuario();
        actor.setId(ACTOR_ID);
        when(currentActor.usuarioId()).thenReturn(ACTOR_ID);
        when(users.findById(ACTOR_ID)).thenReturn(Optional.of(actor));
        when(storage.putObject(anyString(), anyString(), any())).thenReturn(new StoredObject("stored-key", "etag"));
        TypedQuery<RecursoMultimedia> resourceQuery = Mockito.mock();
        when(em.createQuery("SELECT r FROM RecursoMultimedia r WHERE r.claveSubida = :uploadKey",
                RecursoMultimedia.class)).thenReturn(resourceQuery);
        when(resourceQuery.setParameter("uploadKey", scoped(ImageUploadKeys.Operation.LOOSE, "loose-key-1"))).thenReturn(resourceQuery);
        when(resourceQuery.setMaxResults(1)).thenReturn(resourceQuery);
        when(resourceQuery.getResultList()).thenReturn(java.util.List.of());

        MockMultipartFile file = new MockMultipartFile("file", "suelta.png", "image/png", "loose".getBytes());
        var response = service.uploadLooseResource(file, "alt ignorado", "loose-key-1");

        assertThat(response.storagePath()).startsWith("test-config/resources/");
        assertThat(response.originalFileName()).isEqualTo("suelta.png");
        assertThat(response.mimeType()).isEqualTo("image/png");
        assertThat(response.sizeBytes()).isEqualTo(5L);
        assertThat(response.sha256()).isNotBlank();
        assertThat(response.uploadKey()).isEqualTo("loose-key-1");

        ArgumentCaptor<Object> persisted = ArgumentCaptor.forClass(Object.class);
        verify(em, Mockito.times(1)).persist(persisted.capture());
        assertThat(persisted.getValue()).isInstanceOf(RecursoMultimedia.class);
        assertThat(((RecursoMultimedia) persisted.getValue()).getClaveSubida())
                .isEqualTo(scoped(ImageUploadKeys.Operation.LOOSE, "loose-key-1"));
    }

    @Test
    void uploadLooseResourceConIdempotencyKeyRepetidaDevuelveMismoRecursoSinResubir() throws Exception {
        byte[] content = "loose-bytes".getBytes();
        String hash = java.util.HexFormat.of()
                .formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(content));
        RecursoMultimedia existing = new RecursoMultimedia();
        existing.setId(91L);
        existing.setRutaAlmacenamiento("test-config/resources/91-suelta.png");
        existing.setNombreArchivo("suelta.png");
        existing.setTipoMime("image/png");
        existing.setTamanoBytes((long) content.length);
        existing.setHashIntegridad(hash);
        existing.setClaveSubida(scoped(ImageUploadKeys.Operation.LOOSE, "loose-key-dup"));
        when(currentActor.usuarioId()).thenReturn(ACTOR_ID);

        TypedQuery<RecursoMultimedia> resourceQuery = Mockito.mock();
        when(em.createQuery("SELECT r FROM RecursoMultimedia r WHERE r.claveSubida = :uploadKey",
                RecursoMultimedia.class)).thenReturn(resourceQuery);
        when(resourceQuery.setParameter("uploadKey", scoped(ImageUploadKeys.Operation.LOOSE, "loose-key-dup"))).thenReturn(resourceQuery);
        when(resourceQuery.setMaxResults(1)).thenReturn(resourceQuery);
        when(resourceQuery.getResultList()).thenReturn(java.util.List.of(existing));

        MockMultipartFile file = new MockMultipartFile("file", "suelta.png", "image/png", content);
        var response = service.uploadLooseResource(file, null, "loose-key-dup");

        assertThat(response.resourceId()).isEqualTo(91L);
        assertThat(response.uploadKey()).isEqualTo("loose-key-dup");
        verify(storage, never()).putObject(anyString(), anyString(), any());
        verify(em, never()).persist(any());
    }

    @Test
    void uploadLooseResourceRechazaArchivoMayorA25MbSinSubirAStorage() {
        MockMultipartFile oversized = Mockito.mock(MockMultipartFile.class);
        when(oversized.isEmpty()).thenReturn(false);
        when(oversized.getContentType()).thenReturn("image/png");
        when(oversized.getSize()).thenReturn(25L * 1024L * 1024L + 1L);

        assertThatThrownBy(() -> service.uploadLooseResource(oversized, null, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("25MB");
        verify(storage, never()).putObject(anyString(), anyString(), any());
    }

    private static String scoped(ImageUploadKeys.Operation operation, String clientKey) {
        return ImageUploadKeys.scoped(ACTOR_ID, operation, clientKey);
    }

    private static Item itemWithVersion(long itemId, long versionId, EstadoVersionTest state) {
        VersionTest version = new VersionTest();
        version.setId(versionId);
        version.setEstado(state);
        Subtest subtest = new Subtest();
        subtest.setVersionTest(version);
        Item item = new Item();
        item.setId(itemId);
        item.setSubtest(subtest);
        return item;
    }
}

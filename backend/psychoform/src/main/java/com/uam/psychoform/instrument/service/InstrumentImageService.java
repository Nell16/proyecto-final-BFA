package com.uam.psychoform.instrument.service;

import com.uam.psychoform.instrument.dto.ImageResourceUploadResponse;
import com.uam.psychoform.instrument.model.EstadoVersionTest;
import com.uam.psychoform.instrument.model.ImagenItem;
import com.uam.psychoform.instrument.model.ImagenOpcion;
import com.uam.psychoform.instrument.model.Item;
import com.uam.psychoform.instrument.model.OpcionItem;
import com.uam.psychoform.instrument.model.RecursoMultimedia;
import com.uam.psychoform.instrument.model.Subtest;
import com.uam.psychoform.instrument.model.TipoItem;
import com.uam.psychoform.instrument.model.TipoRecurso;
import com.uam.psychoform.instrument.model.TipoRespuesta;
import com.uam.psychoform.instrument.model.VersionTest;
import com.uam.psychoform.instrument.repository.VersionTestRepository;
import com.uam.psychoform.security.CurrentActor;
import com.uam.psychoform.security.model.EstadoGeneral;
import com.uam.psychoform.security.model.Usuario;
import com.uam.psychoform.security.repository.UsuarioRepository;
import java.math.BigDecimal;
import com.uam.psychoform.storage.ObjectStorageService;
import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityNotFoundException;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.List;
import java.util.HexFormat;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;

@Service
public class InstrumentImageService {
    private static final long MAX_IMAGE_BYTES = 25L * 1024L * 1024L;
    private static final Set<String> ALLOWED_MIME_TYPES = Set.of("image/png", "image/jpeg", "image/webp");

    private final EntityManager em;
    private final VersionTestRepository versions;
    private final UsuarioRepository users;
    private final CurrentActor currentActor;
    private final ObjectStorageService storage;
    private final Clock clock;
    private final ImageResourceReleaser releaser;
    private final TransactionTemplate transaction;
    private final TransactionTemplate freshTransaction;

    public InstrumentImageService(EntityManager em, VersionTestRepository versions, UsuarioRepository users,
            CurrentActor currentActor, ObjectStorageService storage, Clock clock, ImageResourceReleaser releaser,
            PlatformTransactionManager transactionManager) {
        this.em = em;
        this.versions = versions;
        this.users = users;
        this.currentActor = currentActor;
        this.storage = storage;
        this.clock = clock;
        this.releaser = releaser;
        this.transaction = new TransactionTemplate(transactionManager);
        this.freshTransaction = new TransactionTemplate(transactionManager);
        this.freshTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    @PreAuthorize(com.uam.psychoform.security.SecurityPermissions.TEST_CREAR)
    public ImageResourceUploadResponse uploadLooseResource(MultipartFile file, String altText, String idempotencyKey)
            throws IOException {
        String uploadKey = scopedKey(ImageUploadKeys.Operation.LOOSE, idempotencyKey);
        return inTransaction(uploadKey, () -> uploadLooseResourceInTransaction(file, uploadKey));
    }

    private ImageResourceUploadResponse uploadLooseResourceInTransaction(MultipartFile file, String uploadKey)
            throws IOException {
        byte[] bytes = validatedBytes(file);
        String hash = sha256(bytes);
        RecursoMultimedia existing = findExistingIdempotentResource(uploadKey, hash);
        if (existing != null) {
            return looseResponse(existing);
        }
        String key = looseStorageKey(file.getOriginalFilename());
        storage.putObject(key, normalizedContentType(file), bytes);
        try {
            RecursoMultimedia resource = resource(file, bytes, hash, key, uploadKey);
            em.persist(resource);
            em.flush();
            return looseResponse(resource);
        } catch (RuntimeException ex) {
            deleteBestEffort(key);
            throw ex;
        }
    }

    @PreAuthorize(com.uam.psychoform.security.SecurityPermissions.TEST_CREAR)
    public ImageUploadResponse uploadItemImage(long itemId, MultipartFile file, Integer order, String altText,
            String role) throws IOException {
        return uploadItemImage(itemId, file, order, altText, role, null);
    }

    @PreAuthorize(com.uam.psychoform.security.SecurityPermissions.TEST_CREAR)
    public ImageUploadResponse uploadItemImage(long itemId, MultipartFile file, Integer order, String altText,
            String role, String idempotencyKey) throws IOException {
        String uploadKey = scopedKey(ImageUploadKeys.Operation.ITEM, idempotencyKey);
        return inTransaction(uploadKey,
                () -> uploadItemImageInTransaction(itemId, file, order, altText, role, uploadKey));
    }

    private ImageUploadResponse uploadItemImageInTransaction(long itemId, MultipartFile file, Integer order,
            String altText, String role, String uploadKey) throws IOException {
        byte[] bytes = validatedBytes(file);
        String hash = sha256(bytes);
        Item item = find(Item.class, itemId);
        requireDraft(item.getSubtest().getVersionTest().getId());
        RecursoMultimedia existing = findExistingIdempotentResource(uploadKey, hash);
        if (existing != null) {
            ImagenItem existingLink = findItemImageByItemAndResource(itemId, existing.getId());
            return response(existingLink.getId(), existing, existingLink.getNumeroOrden(),
                    existingLink.getTextoAlternativo(), existingLink.getRolImagen());
        }
        String key = storageKey("items", itemId, file.getOriginalFilename());
        storage.putObject(key, normalizedContentType(file), bytes);
        try {
            RecursoMultimedia resource = resource(file, bytes, hash, key, uploadKey);
            em.persist(resource);
            ImagenItem image = new ImagenItem();
            image.setItem(item);
            image.setRecurso(resource);
            image.setRolImagen(blank(role) ? "ENUNCIADO" : role);
            image.setNumeroOrden(order == null ? 1 : order);
            image.setTextoAlternativo(altText);
            em.persist(image);
            em.flush();
            return response(image.getId(), resource, image.getNumeroOrden(), image.getTextoAlternativo(),
                    image.getRolImagen());
        } catch (RuntimeException ex) {
            deleteBestEffort(key);
            throw duplicateOrderConflict(ex, "item", order == null ? 1 : order);
        }
    }

    @Transactional(rollbackFor = Exception.class)
    @PreAuthorize(com.uam.psychoform.security.SecurityPermissions.TEST_CREAR)
    public Item createItemWithImage(long subtestId, String code, TipoItem itemType, TipoRespuesta responseType,
            String prompt, String instruction, Integer order, BigDecimal baseScore, Integer timeLimitSeconds,
            Boolean required, Boolean confidential, MultipartFile file, Integer imageOrder, String altText,
            String role) throws IOException {
        Subtest subtest = find(Subtest.class, subtestId);
        requireDraft(subtest.getVersionTest().getId());

        Item item = new Item();
        item.setSubtest(subtest);
        item.setCodigoItem(code);
        item.setTipoItem(itemType);
        item.setTipoRespuesta(responseType);
        item.setEnunciado(prompt);
        item.setInstruccion(instruction);
        item.setNumeroOrden(order);
        item.setPuntajeBase(baseScore == null ? BigDecimal.ONE : baseScore);
        item.setTiempoLimiteSegundos(timeLimitSeconds);
        item.setEsObligatorio(!Boolean.FALSE.equals(required));
        item.setEsConfidencial(!Boolean.FALSE.equals(confidential));
        item.setEstado(EstadoGeneral.ACTIVO);
        em.persist(item);

        if (file != null && !file.isEmpty()) {
            uploadItemImage(item.getId(), file, imageOrder, altText, role);
        }

        return item;
    }

    @PreAuthorize(com.uam.psychoform.security.SecurityPermissions.TEST_CREAR)
    public ImageUploadResponse uploadOptionImage(long optionId, MultipartFile file, Integer order, String altText)
            throws IOException {
        return uploadOptionImage(optionId, file, order, altText, null);
    }

    @PreAuthorize(com.uam.psychoform.security.SecurityPermissions.TEST_CREAR)
    public ImageUploadResponse uploadOptionImage(long optionId, MultipartFile file, Integer order, String altText,
            String idempotencyKey) throws IOException {
        String uploadKey = scopedKey(ImageUploadKeys.Operation.OPTION, idempotencyKey);
        return inTransaction(uploadKey, () -> uploadOptionImageInTransaction(optionId, file, order, altText, uploadKey));
    }

    private ImageUploadResponse uploadOptionImageInTransaction(long optionId, MultipartFile file, Integer order,
            String altText, String uploadKey) throws IOException {
        byte[] bytes = validatedBytes(file);
        String hash = sha256(bytes);
        OpcionItem option = find(OpcionItem.class, optionId);
        requireDraft(option.getItem().getSubtest().getVersionTest().getId());
        RecursoMultimedia existing = findExistingIdempotentResource(uploadKey, hash);
        if (existing != null) {
            ImagenOpcion existingLink = findOptionImageByOptionAndResource(optionId, existing.getId());
            return response(existingLink.getId(), existing, existingLink.getNumeroOrden(),
                    existingLink.getTextoAlternativo(), null);
        }
        String key = storageKey("options", optionId, file.getOriginalFilename());
        storage.putObject(key, normalizedContentType(file), bytes);
        try {
            RecursoMultimedia resource = resource(file, bytes, hash, key, uploadKey);
            em.persist(resource);
            ImagenOpcion image = new ImagenOpcion();
            image.setOpcion(option);
            image.setRecurso(resource);
            image.setNumeroOrden(order == null ? 1 : order);
            image.setTextoAlternativo(altText);
            em.persist(image);
            em.flush();
            return response(image.getId(), resource, image.getNumeroOrden(), image.getTextoAlternativo(), null);
        } catch (RuntimeException ex) {
            deleteBestEffort(key);
            throw duplicateOrderConflict(ex, "opcion", order == null ? 1 : order);
        }
    }

    @PreAuthorize(com.uam.psychoform.security.SecurityPermissions.TEST_CREAR)
    public ImageUploadResponse replaceItemImage(long itemId, long imageId, MultipartFile file, String altText,
            String role) throws IOException {
        return replaceItemImage(itemId, imageId, file, altText, role, null);
    }

    @PreAuthorize(com.uam.psychoform.security.SecurityPermissions.TEST_CREAR)
    public ImageUploadResponse replaceItemImage(long itemId, long imageId, MultipartFile file, String altText,
            String role, String idempotencyKey) throws IOException {
        String uploadKey = scopedKey(ImageUploadKeys.Operation.REPLACE_ITEM, idempotencyKey);
        return inTransaction(uploadKey, () -> {
            // Bloquear la version ANTES de cargar la imagen: una peticion concurrente puede reemplazarla mientras esta
            // espera el bloqueo, y debe operar sobre el estado ya confirmado, no sobre el vinculo leido antes.
            Item item = find(Item.class, itemId);
            VersionTest version = lockVersion(item.getSubtest().getVersionTest().getId());
            ImagenItem image = find(ImagenItem.class, imageId);
            if (!image.getItem().getId().equals(itemId)) {
                throw new EntityNotFoundException("Imagen de item no encontrada: " + imageId);
            }
            requireDraftState(version);
            return replaceItemImage(image, itemId, file, altText, role, uploadKey);
        });
    }

    @PreAuthorize(com.uam.psychoform.security.SecurityPermissions.TEST_CREAR)
    public ImageUploadResponse replaceItemImageByOrder(long itemId, int order, MultipartFile file, String altText,
            String role) throws IOException {
        return replaceItemImageByOrder(itemId, order, file, altText, role, null);
    }

    @PreAuthorize(com.uam.psychoform.security.SecurityPermissions.TEST_CREAR)
    public ImageUploadResponse replaceItemImageByOrder(long itemId, int order, MultipartFile file, String altText,
            String role, String idempotencyKey) throws IOException {
        String uploadKey = scopedKey(ImageUploadKeys.Operation.REPLACE_ITEM, idempotencyKey);
        return inTransaction(uploadKey, () -> {
            Item item = find(Item.class, itemId);
            requireDraft(item.getSubtest().getVersionTest().getId());
            ImagenItem image = findItemImageByOrder(itemId, order);
            return replaceItemImage(image, itemId, file, altText, role, uploadKey);
        });
    }

    @PreAuthorize(com.uam.psychoform.security.SecurityPermissions.TEST_CREAR)
    public ImageUploadResponse replaceOptionImage(long optionId, long imageId, MultipartFile file, String altText)
            throws IOException {
        return replaceOptionImage(optionId, imageId, file, altText, null);
    }

    @PreAuthorize(com.uam.psychoform.security.SecurityPermissions.TEST_CREAR)
    public ImageUploadResponse replaceOptionImage(long optionId, long imageId, MultipartFile file, String altText,
            String idempotencyKey) throws IOException {
        String uploadKey = scopedKey(ImageUploadKeys.Operation.REPLACE_OPTION, idempotencyKey);
        return inTransaction(uploadKey, () -> {
            // Bloquear la version ANTES de cargar la imagen (ver replaceItemImage).
            OpcionItem option = find(OpcionItem.class, optionId);
            VersionTest version = lockVersion(option.getItem().getSubtest().getVersionTest().getId());
            ImagenOpcion image = find(ImagenOpcion.class, imageId);
            if (!image.getOpcion().getId().equals(optionId)) {
                throw new EntityNotFoundException("Imagen de opcion no encontrada: " + imageId);
            }
            requireDraftState(version);
            return replaceOptionImage(image, optionId, file, altText, uploadKey);
        });
    }

    @PreAuthorize(com.uam.psychoform.security.SecurityPermissions.TEST_CREAR)
    public ImageUploadResponse replaceOptionImageByOrder(long optionId, int order, MultipartFile file, String altText)
            throws IOException {
        return replaceOptionImageByOrder(optionId, order, file, altText, null);
    }

    @PreAuthorize(com.uam.psychoform.security.SecurityPermissions.TEST_CREAR)
    public ImageUploadResponse replaceOptionImageByOrder(long optionId, int order, MultipartFile file, String altText,
            String idempotencyKey) throws IOException {
        String uploadKey = scopedKey(ImageUploadKeys.Operation.REPLACE_OPTION, idempotencyKey);
        return inTransaction(uploadKey, () -> {
            OpcionItem option = find(OpcionItem.class, optionId);
            requireDraft(option.getItem().getSubtest().getVersionTest().getId());
            ImagenOpcion image = findOptionImageByOrder(optionId, order);
            return replaceOptionImage(image, optionId, file, altText, uploadKey);
        });
    }

    private ImageUploadResponse replaceItemImage(ImagenItem image, long itemId, MultipartFile file, String altText,
            String role, String uploadKey) throws IOException {
        byte[] bytes = validatedBytes(file);
        String hash = sha256(bytes);
        RecursoMultimedia existing = findExistingIdempotentResource(uploadKey, hash);
        if (existing != null) {
            if (image.getRecurso() != null && Objects.equals(image.getRecurso().getId(), existing.getId())) {
                return response(image.getId(), existing, image.getNumeroOrden(), image.getTextoAlternativo(),
                        image.getRolImagen());
            }
            throw new IllegalStateException("La Idempotency-Key ya fue utilizada en otra operacion");
        }
        String key = storageKey("items", itemId, file.getOriginalFilename());
        storage.putObject(key, normalizedContentType(file), bytes);
        RecursoMultimedia previousResource = image.getRecurso();
        String previousAltText = image.getTextoAlternativo();
        String previousRole = image.getRolImagen();
        try {
            RecursoMultimedia resource = resource(file, bytes, hash, key, uploadKey);
            em.persist(resource);
            image.setRecurso(resource);
            image.setTextoAlternativo(altText);
            image.setRolImagen(blank(role) ? previousRole : role);
            em.flush();
            releaser.releaseIfUnreferenced(previousResource);
            return response(image.getId(), resource, image.getNumeroOrden(), image.getTextoAlternativo(),
                    image.getRolImagen());
        } catch (RuntimeException ex) {
            image.setRecurso(previousResource);
            image.setTextoAlternativo(previousAltText);
            image.setRolImagen(previousRole);
            deleteBestEffort(key);
            throw ex;
        }
    }

    private ImageUploadResponse replaceOptionImage(ImagenOpcion image, long optionId, MultipartFile file,
            String altText, String uploadKey) throws IOException {
        byte[] bytes = validatedBytes(file);
        String hash = sha256(bytes);
        RecursoMultimedia existing = findExistingIdempotentResource(uploadKey, hash);
        if (existing != null) {
            if (image.getRecurso() != null && Objects.equals(image.getRecurso().getId(), existing.getId())) {
                return response(image.getId(), existing, image.getNumeroOrden(), image.getTextoAlternativo(), null);
            }
            throw new IllegalStateException("La Idempotency-Key ya fue utilizada en otra operacion");
        }
        String key = storageKey("options", optionId, file.getOriginalFilename());
        storage.putObject(key, normalizedContentType(file), bytes);
        RecursoMultimedia previousResource = image.getRecurso();
        String previousAltText = image.getTextoAlternativo();
        try {
            RecursoMultimedia resource = resource(file, bytes, hash, key, uploadKey);
            em.persist(resource);
            image.setRecurso(resource);
            image.setTextoAlternativo(altText);
            em.flush();
            releaser.releaseIfUnreferenced(previousResource);
            return response(image.getId(), resource, image.getNumeroOrden(), image.getTextoAlternativo(), null);
        } catch (RuntimeException ex) {
            image.setRecurso(previousResource);
            image.setTextoAlternativo(previousAltText);
            deleteBestEffort(key);
            throw ex;
        }
    }

    @FunctionalInterface
    private interface TransactionalWork<T> {
        T run() throws IOException;
    }

    /**
     * Ejecuta la operacion en una transaccion y, si pierde una carrera por la misma Idempotency-Key, la repite UNA vez
     * en una transaccion NUEVA.
     *
     * <p>Dos peticiones simultaneas con la misma clave consultan antes de que exista la fila; el indice unico
     * {@code ux_recurso_multimedia_clave_subida} deja pasar a una y la otra recibe la violacion (con Postgres, tras
     * esperar a que la ganadora confirme). La perdedora ya borro el objeto que habia subido a storage (el catch de cada
     * operacion) y su transaccion esta revertida, asi que no puede consultar en ella: la reintenta desde cero, y esta
     * vez la consulta por clave encuentra al recurso ganador (mismo hash: se devuelve; otro hash: 409). Se reintenta en
     * lugar de subir despues de reservar la clave porque es lo mas simple y no cambia el flujo normal.
     */
    private <T> T inTransaction(String uploadKey, TransactionalWork<T> work) throws IOException {
        try {
            return execute(transaction, work);
        } catch (RuntimeException ex) {
            if (uploadKey == null || !isUploadKeyViolation(ex)) {
                throw ex;
            }
            return execute(freshTransaction, work);
        }
    }

    private <T> T execute(TransactionTemplate template, TransactionalWork<T> work) throws IOException {
        try {
            return template.execute(status -> {
                try {
                    return work.run();
                } catch (IOException ex) {
                    throw new UncheckedIOException(ex);
                }
            });
        } catch (UncheckedIOException ex) {
            throw ex.getCause();
        }
    }

    private boolean isUploadKeyViolation(Throwable ex) {
        for (Throwable cursor = ex; cursor != null; cursor = cursor.getCause()) {
            if (cursor instanceof java.sql.SQLException sql && "23505".equals(sql.getSQLState())
                    && sql.getMessage() != null && sql.getMessage().contains("ux_recurso_multimedia_clave_subida")) {
                return true;
            }
            if (cursor.getMessage() != null && cursor.getMessage().contains("ux_recurso_multimedia_clave_subida")
                    && cursor.getMessage().toLowerCase().contains("duplicate")) {
                return true;
            }
        }
        return false;
    }

    private byte[] validatedBytes(MultipartFile file) throws IOException {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("El archivo de imagen esta vacio");
        }
        String contentType = file.getContentType();
        if (contentType == null || !ALLOWED_MIME_TYPES.contains(contentType.toLowerCase())) {
            throw new IllegalArgumentException("Tipo de imagen no permitido: " + contentType);
        }
        if (file.getSize() > MAX_IMAGE_BYTES) {
            throw new IllegalArgumentException("La imagen excede 25MB");
        }
        return file.getBytes();
    }

    private String normalizedContentType(MultipartFile file) {
        return file.getContentType().toLowerCase();
    }

    /**
     * Valida la clave del cliente (400 si es invalida) y la acota por usuario y tipo de operacion: es el valor que se
     * guarda y se busca en {@code clave_subida}. Null si la peticion no trae clave.
     */
    private String scopedKey(ImageUploadKeys.Operation operation, String idempotencyKey) {
        String clientKey = ImageUploadKeys.normalize(idempotencyKey);
        if (clientKey == null) {
            return null;
        }
        return ImageUploadKeys.scoped(currentActor.usuarioId(), operation, clientKey);
    }

    private RecursoMultimedia findExistingIdempotentResource(String uploadKey, String hash) {
        if (uploadKey == null) {
            return null;
        }
        List<RecursoMultimedia> existing = em.createQuery(
                "SELECT r FROM RecursoMultimedia r WHERE r.claveSubida = :uploadKey",
                RecursoMultimedia.class)
                .setParameter("uploadKey", uploadKey)
                .setMaxResults(1)
                .getResultList();
        if (existing.isEmpty()) {
            return null;
        }
        RecursoMultimedia resource = existing.getFirst();
        if (!Objects.equals(resource.getHashIntegridad(), hash)) {
            throw new IllegalStateException("Ya existe un recurso con esta Idempotency-Key y un archivo distinto");
        }
        return resource;
    }

    private ImagenItem findItemImageByItemAndResource(long itemId, long resourceId) {
        List<ImagenItem> images = em.createQuery(
                "SELECT img FROM ImagenItem img WHERE img.item.id = :itemId AND img.recurso.id = :resourceId",
                ImagenItem.class)
                .setParameter("itemId", itemId)
                .setParameter("resourceId", resourceId)
                .setMaxResults(1)
                .getResultList();
        if (images.isEmpty()) {
            throw new IllegalStateException("La Idempotency-Key ya fue utilizada en otra operacion");
        }
        return images.getFirst();
    }

    private ImagenOpcion findOptionImageByOptionAndResource(long optionId, long resourceId) {
        List<ImagenOpcion> images = em.createQuery(
                "SELECT img FROM ImagenOpcion img WHERE img.opcion.id = :optionId AND img.recurso.id = :resourceId",
                ImagenOpcion.class)
                .setParameter("optionId", optionId)
                .setParameter("resourceId", resourceId)
                .setMaxResults(1)
                .getResultList();
        if (images.isEmpty()) {
            throw new IllegalStateException("La Idempotency-Key ya fue utilizada en otra operacion");
        }
        return images.getFirst();
    }

    private RecursoMultimedia resource(MultipartFile file, byte[] bytes, String hash, String key, String uploadKey) {
        RecursoMultimedia resource = new RecursoMultimedia();
        resource.setTipoRecurso(TipoRecurso.IMAGEN);
        resource.setNombreArchivo(originalFilename(file.getOriginalFilename()));
        resource.setRutaAlmacenamiento(key);
        resource.setTipoMime(normalizedContentType(file));
        resource.setTamanoBytes((long) bytes.length);
        resource.setHashIntegridad(hash);
        resource.setClaveSubida(uploadKey);
        resource.setEsConfidencial(true);
        resource.setRequiereAutorizacion(true);
        resource.setSubidoPor(currentUser());
        resource.setSubidoEn(LocalDateTime.now(clock));
        return resource;
    }

    private ImageUploadResponse response(Long imageLinkId, RecursoMultimedia resource, Integer order, String altText,
            String role) {
        return new ImageUploadResponse(imageLinkId, resource.getId(), resource.getRutaAlmacenamiento(),
                resource.getNombreArchivo(), resource.getTipoMime(), resource.getTamanoBytes(),
                resource.getHashIntegridad(), order, altText, role, ImageUploadKeys.clientKey(resource.getClaveSubida()));
    }

    private ImageResourceUploadResponse looseResponse(RecursoMultimedia resource) {
        return new ImageResourceUploadResponse(resource.getId(), resource.getRutaAlmacenamiento(),
                resource.getTipoMime(), resource.getNombreArchivo(), resource.getTamanoBytes(),
                resource.getHashIntegridad(), ImageUploadKeys.clientKey(resource.getClaveSubida()));
    }

    private VersionTest requireDraft(long versionId) {
        VersionTest version = lockVersion(versionId);
        requireDraftState(version);
        return version;
    }

    private VersionTest lockVersion(long versionId) {
        return versions.findByIdForUpdate(versionId)
                .orElseThrow(() -> new EntityNotFoundException("Version no encontrada: " + versionId));
    }

    private void requireDraftState(VersionTest version) {
        if (version.getEstado() != EstadoVersionTest.BORRADOR) {
            throw new IllegalStateException("La version publicada o aprobada no se edita directamente");
        }
    }

    private Usuario currentUser() {
        UUID id = currentActor.usuarioId();
        return users.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Usuario autenticado no encontrado: " + id));
    }

    private <T> T find(Class<T> type, Object id) {
        T value = em.find(type, id);
        if (value == null) {
            throw new EntityNotFoundException(type.getSimpleName() + " no encontrado: " + id);
        }
        return value;
    }

    private ImagenItem findItemImageByOrder(long itemId, int order) {
        List<ImagenItem> images = em.createQuery(
                "SELECT img FROM ImagenItem img WHERE img.item.id = :itemId AND img.numeroOrden = :order",
                ImagenItem.class)
                .setParameter("itemId", itemId)
                .setParameter("order", order)
                .setMaxResults(1)
                .getResultList();
        if (images.isEmpty()) {
            throw new EntityNotFoundException("Imagen de item no encontrada para item " + itemId + " y orden " + order);
        }
        return images.getFirst();
    }

    private ImagenOpcion findOptionImageByOrder(long optionId, int order) {
        List<ImagenOpcion> images = em.createQuery(
                "SELECT img FROM ImagenOpcion img WHERE img.opcion.id = :optionId AND img.numeroOrden = :order",
                ImagenOpcion.class)
                .setParameter("optionId", optionId)
                .setParameter("order", order)
                .setMaxResults(1)
                .getResultList();
        if (images.isEmpty()) {
            throw new EntityNotFoundException(
                    "Imagen de opcion no encontrada para opcion " + optionId + " y orden " + order);
        }
        return images.getFirst();
    }

    private RuntimeException duplicateOrderConflict(RuntimeException ex, String owner, int order) {
        if (isDuplicateImageOrder(ex)) {
            return new IllegalStateException("Ya existe una imagen para este " + owner + " en el orden " + order, ex);
        }
        return ex;
    }

    private boolean isDuplicateImageOrder(Throwable ex) {
        String message = rootMessage(ex).toLowerCase();
        return message.contains("duplicate") && message.contains("numero_orden")
                && (message.contains("imagen_item") || message.contains("imagen_opcion"));
    }

    private String rootMessage(Throwable ex) {
        Throwable cursor = ex;
        String message = "";
        while (cursor != null) {
            if (cursor.getMessage() != null) {
                message = cursor.getMessage();
            }
            cursor = cursor.getCause();
        }
        return message;
    }

    private String storageKey(String scope, long ownerId, String filename) {
        return "test-config/" + scope + "/" + ownerId + "/" + UUID.randomUUID() + "-" + sanitize(filename);
    }

    private String looseStorageKey(String filename) {
        return "test-config/resources/" + UUID.randomUUID() + "-" + sanitize(filename);
    }

    private String sanitize(String filename) {
        return originalFilename(filename).replaceAll("[^A-Za-z0-9._-]", "_");
    }

    private String originalFilename(String filename) {
        if (blank(filename)) {
            return "image";
        }
        String normalized = filename.replace('\\', '/');
        int slash = normalized.lastIndexOf('/');
        return slash >= 0 ? normalized.substring(slash + 1) : normalized;
    }

    private String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 no disponible", ex);
        }
    }

    private void deleteBestEffort(String key) {
        try {
            storage.deleteObject(key);
        } catch (RuntimeException ignored) {
            // The database failure is the primary error; storage cleanup is best effort.
        }
    }

    private boolean blank(String value) {
        return value == null || value.isBlank();
    }
}

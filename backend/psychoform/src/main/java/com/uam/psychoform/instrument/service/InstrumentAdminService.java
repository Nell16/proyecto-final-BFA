package com.uam.psychoform.instrument.service;

import com.uam.psychoform.instrument.model.*;
import com.uam.psychoform.instrument.dto.ImageResourceDTO;
import com.uam.psychoform.instrument.dto.ItemDTO;
import com.uam.psychoform.instrument.dto.OptionDTO;
import com.uam.psychoform.instrument.dto.SubtestCloneTemplateDTO;
import com.uam.psychoform.instrument.dto.VersionConfigurationRequest;
import com.uam.psychoform.instrument.repository.VersionTestRepository;
import com.uam.psychoform.security.CurrentActor;
import com.uam.psychoform.security.SecurityPermissions;
import com.uam.psychoform.security.model.EstadoGeneral;
import com.uam.psychoform.security.model.Usuario;
import com.uam.psychoform.security.repository.UsuarioRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityNotFoundException;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.List;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
public class InstrumentAdminService {
    private final EntityManager em;
    private final VersionTestRepository versions;
    private final UsuarioRepository users;
    private final CurrentActor currentActor;
    private final Clock clock;

    public InstrumentAdminService(EntityManager em, VersionTestRepository versions, UsuarioRepository users,
            CurrentActor currentActor, Clock clock) {
        this.em = em;
        this.versions = versions;
        this.users = users;
        this.currentActor = currentActor;
        this.clock = clock;
    }

    @PreAuthorize(SecurityPermissions.INSTRUMENTO_CATALOGO_LEER)
    public List<TestPsicologico> listTests() {
        if (currentActor.canReadFullInstruments()) {
            return em.createQuery("select t from TestPsicologico t", TestPsicologico.class).getResultList();
        }
        return em.createQuery("select t from TestPsicologico t where exists ("
                + "select 1 from VersionTest v where v.test = t and v.estado = :publicado)", TestPsicologico.class)
                .setParameter("publicado", EstadoVersionTest.PUBLICADO).getResultList();
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.TEST_CREAR)
    public TestPsicologico createTest(TestCommand command) {
        TestPsicologico test = new TestPsicologico();
        test.setCodigoTest(command.code());
        test.setNombreTest(command.name());
        test.setDescripcion(command.description());
        test.setEstado(EstadoGeneral.ACTIVO);
        test.setCreadoPor(currentUser());
        test.setCreadoEn(LocalDateTime.now(clock));
        em.persist(test);
        return test;
    }

    @PreAuthorize(SecurityPermissions.INSTRUMENTO_CATALOGO_LEER)
    public List<VersionTest> listVersions(long testId) {
        if (currentActor.canReadFullInstruments()) {
            return em.createQuery("select v from VersionTest v where v.test.id = :testId", VersionTest.class)
                    .setParameter("testId", testId).getResultList();
        }
        return em.createQuery("select v from VersionTest v where v.test.id = :testId and v.estado = :publicado",
                VersionTest.class).setParameter("testId", testId)
                .setParameter("publicado", EstadoVersionTest.PUBLICADO).getResultList();
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.TEST_CREAR)
    public VersionTest createVersion(long testId, VersionCommand command) {
        TestPsicologico test = find(TestPsicologico.class, testId);
        VersionTest version = new VersionTest();
        version.setTest(test);
        version.setEstrategiaCalificacion(command.strategyId() == null ? null : find(EstrategiaCalificacion.class, command.strategyId()));
        version.setNumeroVersion(command.number());
        version.setEstado(EstadoVersionTest.BORRADOR);
        version.setInstruccionesGenerales(command.instructions());
        version.setTiempoLimiteSegundos(command.timeLimitSeconds());
        version.setPermiteAleatorizarItems(Boolean.TRUE.equals(command.randomizeItems()));
        version.setPermiteAleatorizarSubtests(Boolean.TRUE.equals(command.randomizeSubtests()));
        version.setCreadoPor(currentUser());
        version.setCreadoEn(LocalDateTime.now(clock));
        em.persist(version);
        return version;
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.TEST_CREAR)
    public VersionTest updateVersion(long versionId, VersionCommand command) {
        VersionTest version = requireDraft(versionId);
        version.setEstrategiaCalificacion(command.strategyId() == null ? version.getEstrategiaCalificacion()
                : find(EstrategiaCalificacion.class, command.strategyId()));
        version.setNumeroVersion(command.number());
        version.setInstruccionesGenerales(command.instructions());
        version.setTiempoLimiteSegundos(command.timeLimitSeconds());
        version.setPermiteAleatorizarItems(Boolean.TRUE.equals(command.randomizeItems()));
        version.setPermiteAleatorizarSubtests(Boolean.TRUE.equals(command.randomizeSubtests()));
        return version;
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.TEST_CREAR)
    public Subtest createSubtest(long versionId, SubtestCommand command) {
        VersionTest version = requireDraft(versionId);
        Subtest subtest = new Subtest();
        subtest.setVersionTest(version);
        subtest.setEstrategiaCalificacion(command.strategyId() == null ? null : find(EstrategiaCalificacion.class, command.strategyId()));
        subtest.setCodigoSubtest(command.code());
        subtest.setNombreSubtest(command.name());
        subtest.setDescripcion(command.description());
        subtest.setInstrucciones(command.instructions());
        subtest.setNumeroOrden(command.order());
        subtest.setTiempoLimiteSegundos(command.timeLimitSeconds());
        
        boolean randomizeItems = Boolean.TRUE.equals(command.randomizeItems());
        if (randomizeItems && !Boolean.TRUE.equals(version.getPermiteAleatorizarItems())) {
            randomizeItems = false;
        }
        subtest.setPermiteAleatorizarItems(randomizeItems);
        subtest.setPermiteAleatorizarOpciones(Boolean.TRUE.equals(command.randomizeOptions()));
        subtest.setEsObligatorio(!Boolean.FALSE.equals(command.required()));
        subtest.setEstado(EstadoGeneral.ACTIVO);
        em.persist(subtest);
        return subtest;
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.TEST_CREAR)
    public Subtest updateSubtest(long subtestId, SubtestCommand command) {
        Subtest subtest = find(Subtest.class, subtestId);
        requireDraft(subtest.getVersionTest().getId());
        subtest.setEstrategiaCalificacion(command.strategyId() == null ? null : find(EstrategiaCalificacion.class, command.strategyId()));
        subtest.setCodigoSubtest(command.code());
        subtest.setNombreSubtest(command.name());
        subtest.setDescripcion(command.description());
        subtest.setInstrucciones(command.instructions());
        subtest.setNumeroOrden(command.order());
        subtest.setTiempoLimiteSegundos(command.timeLimitSeconds());
        
        boolean randomizeItems = Boolean.TRUE.equals(command.randomizeItems());
        if (randomizeItems && !Boolean.TRUE.equals(subtest.getVersionTest().getPermiteAleatorizarItems())) {
            randomizeItems = false;
        }
        subtest.setPermiteAleatorizarItems(randomizeItems);
        subtest.setPermiteAleatorizarOpciones(Boolean.TRUE.equals(command.randomizeOptions()));
        subtest.setEsObligatorio(!Boolean.FALSE.equals(command.required()));
        return subtest;
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.TEST_CREAR)
    public Item createItem(long subtestId, ItemCommand command) {
        Subtest subtest = find(Subtest.class, subtestId);
        requireDraft(subtest.getVersionTest().getId());
        Item item = new Item();
        item.setSubtest(subtest);
        item.setCodigoItem(command.code());
        item.setTipoItem(command.itemType());
        item.setTipoRespuesta(command.responseType());
        item.setEnunciado(command.prompt());
        item.setInstruccion(command.instruction());
        item.setNumeroOrden(command.order());
        item.setPuntajeBase(command.baseScore() == null ? BigDecimal.ONE : command.baseScore());
        item.setTiempoLimiteSegundos(command.timeLimitSeconds());
        item.setEsObligatorio(!Boolean.FALSE.equals(command.required()));
        item.setEsConfidencial(!Boolean.FALSE.equals(command.confidential()));
        item.setEstado(EstadoGeneral.ACTIVO);
        em.persist(item);
        return item;
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.TEST_CREAR)
    public Item updateItem(long itemId, ItemCommand command) {
        Item item = find(Item.class, itemId);
        requireDraft(item.getSubtest().getVersionTest().getId());
        item.setCodigoItem(command.code());
        item.setTipoItem(command.itemType());
        item.setTipoRespuesta(command.responseType());
        item.setEnunciado(command.prompt());
        item.setInstruccion(command.instruction());
        item.setNumeroOrden(command.order());
        item.setPuntajeBase(command.baseScore() == null ? BigDecimal.ONE : command.baseScore());
        item.setTiempoLimiteSegundos(command.timeLimitSeconds());
        item.setEsObligatorio(!Boolean.FALSE.equals(command.required()));
        item.setEsConfidencial(!Boolean.FALSE.equals(command.confidential()));
        return item;
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.TEST_CREAR)
    public OpcionItem createOption(long itemId, OptionCommand command) {
        Item item = find(Item.class, itemId);
        requireDraft(item.getSubtest().getVersionTest().getId());
        OpcionItem option = new OpcionItem();
        option.setItem(item);
        option.setCodigoOpcion(command.code());
        option.setTextoOpcion(command.text());
        option.setNumeroOrden(command.order());
        option.setValorOrdinal(command.ordinalValue());
        option.setEstado(EstadoGeneral.ACTIVO);
        em.persist(option);
        return option;
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.TEST_CREAR)
    public OpcionItem updateOption(long optionId, OptionCommand command) {
        OpcionItem option = find(OpcionItem.class, optionId);
        requireDraft(option.getItem().getSubtest().getVersionTest().getId());
        option.setCodigoOpcion(command.code());
        option.setTextoOpcion(command.text());
        option.setNumeroOrden(command.order());
        option.setValorOrdinal(command.ordinalValue());
        return option;
    }

    @PreAuthorize(SecurityPermissions.CALIFICACION_CONFIGURAR + " or " + SecurityPermissions.TEST_CREAR)
    public List<EstrategiaCalificacion> listStrategies() {
        return em.createQuery("select e from EstrategiaCalificacion e", EstrategiaCalificacion.class).getResultList();
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.CALIFICACION_CONFIGURAR)
    public ReglaCalificacion createScoringRule(long subtestId, ScoringRuleCommand command) {
        Subtest subtest = find(Subtest.class, subtestId);
        VersionTest version = requireDraft(subtest.getVersionTest().getId());
        ReglaCalificacion rule = new ReglaCalificacion();
        rule.setVersionTest(version);
        rule.setSubtest(subtest);
        rule.setItem(command.itemId() == null ? null : find(Item.class, command.itemId()));
        rule.setEstrategiaCalificacion(find(EstrategiaCalificacion.class, command.strategyId()));
        rule.setTipoRegla(command.ruleType());
        rule.setPrioridad(command.priority() == null ? 1 : command.priority());
        rule.setActiva(true);
        rule.setEstado(EstadoConfiguracion.BORRADOR);
        rule.setParametros(command.parametersJson() == null ? "{}" : command.parametersJson());
        rule.setObservacion(command.observation());
        rule.setCreadoPor(currentUser());
        rule.setCreadoEn(LocalDateTime.now(clock));
        em.persist(rule);
        return rule;
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.CALIFICACION_CONFIGURAR)
    public ReglaCalificacion updateScoringRule(long ruleId, ScoringRuleCommand command) {
        ReglaCalificacion rule = find(ReglaCalificacion.class, ruleId);
        requireDraft(rule.getVersionTest().getId());
        rule.setItem(command.itemId() == null ? null : find(Item.class, command.itemId()));
        rule.setEstrategiaCalificacion(find(EstrategiaCalificacion.class, command.strategyId()));
        rule.setTipoRegla(command.ruleType());
        rule.setPrioridad(command.priority() == null ? 1 : command.priority());
        rule.setParametros(command.parametersJson() == null ? "{}" : command.parametersJson());
        rule.setObservacion(command.observation());
        return rule;
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.CALIFICACION_CONFIGURAR)
    public ClaveRespuesta createAnswerKey(long itemId, AnswerKeyCommand command) {
        Item item = find(Item.class, itemId);
        requireDraft(item.getSubtest().getVersionTest().getId());
        ClaveRespuesta key = new ClaveRespuesta();
        key.setReglaCalificacion(find(ReglaCalificacion.class, command.ruleId()));
        key.setItem(item);
        key.setOpcionCorrecta(command.correctOptionId() == null ? null : find(OpcionItem.class, command.correctOptionId()));
        key.setTextoEsperado(command.expectedText());
        key.setValorNumericoEsperado(command.expectedNumber());
        key.setToleranciaNumerica(command.numericTolerance());
        key.setPuntaje(command.score() == null ? BigDecimal.ONE : command.score());
        key.setRequiereRevisionManual(Boolean.TRUE.equals(command.requiresManualReview()));
        key.setCreadoPor(currentUser());
        key.setCreadoEn(LocalDateTime.now(clock));
        em.persist(key);
        return key;
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.CALIFICACION_CONFIGURAR)
    public ClaveRespuesta updateAnswerKey(long keyId, AnswerKeyCommand command) {
        ClaveRespuesta key = find(ClaveRespuesta.class, keyId);
        requireDraft(key.getItem().getSubtest().getVersionTest().getId());
        key.setReglaCalificacion(find(ReglaCalificacion.class, command.ruleId()));
        key.setOpcionCorrecta(command.correctOptionId() == null ? null : find(OpcionItem.class, command.correctOptionId()));
        key.setTextoEsperado(command.expectedText());
        key.setValorNumericoEsperado(command.expectedNumber());
        key.setToleranciaNumerica(command.numericTolerance());
        key.setPuntaje(command.score() == null ? BigDecimal.ONE : command.score());
        key.setRequiereRevisionManual(Boolean.TRUE.equals(command.requiresManualReview()));
        return key;
    }

    @PreAuthorize(SecurityPermissions.TEST_LEER)
    public SubtestCloneTemplateDTO getCloneTemplate(long subtestId) {
        Subtest subtest = find(Subtest.class, subtestId);
        List<Item> items = listItems(subtestId);
        return toSubtestTemplate(subtest, items, loadItemGraph(items));
    }

    /**
     * B7: documento de configuracion completo de una version (subtests ordenados por orden con la misma forma que
     * {@link #getCloneTemplate}). Carga ordenes, opciones, imagenes y claves de toda la version con consultas en
     * lote, sin consultas por subtest.
     */
    @PreAuthorize(SecurityPermissions.TEST_LEER)
    public VersionConfiguration getConfiguration(long versionId) {
        VersionTest version = find(VersionTest.class, versionId);
        List<Subtest> subtests = em.createQuery(
                "SELECT s FROM Subtest s WHERE s.versionTest.id = :versionId ORDER BY s.numeroOrden ASC, s.id ASC",
                Subtest.class).setParameter("versionId", versionId).getResultList();
        if (subtests.isEmpty()) {
            return new VersionConfiguration(version, List.of());
        }
        List<Long> subtestIds = subtests.stream().map(Subtest::getId).toList();
        List<Item> allItems = em.createQuery("""
                SELECT i FROM Item i
                WHERE i.subtest.id IN :subtestIds
                ORDER BY i.subtest.id ASC, i.numeroOrden ASC
                """, Item.class).setParameter("subtestIds", subtestIds).getResultList();
        Map<Long, List<Item>> itemsBySubtest = new LinkedHashMap<>();
        for (Item item : allItems) {
            itemsBySubtest.computeIfAbsent(item.getSubtest().getId(), ignored -> new ArrayList<>()).add(item);
        }
        ItemGraph graph = loadItemGraph(allItems);
        List<SubtestCloneTemplateDTO> templates = subtests.stream()
                .map(subtest -> toSubtestTemplate(subtest, itemsBySubtest.getOrDefault(subtest.getId(), List.of()),
                        graph))
                .toList();
        return new VersionConfiguration(version, templates);
    }

    private ItemGraph loadItemGraph(List<Item> items) {
        List<Long> itemIds = items.stream().map(Item::getId).toList();
        Map<Long, List<OpcionItem>> optionsByItem = optionsByItem(itemIds);
        List<Long> optionIds = optionsByItem.values().stream()
                .flatMap(List::stream)
                .map(OpcionItem::getId)
                .toList();
        return new ItemGraph(optionsByItem, cloneItemImages(itemIds), cloneOptionImages(optionIds),
                answerKeysByItem(itemIds));
    }

    private SubtestCloneTemplateDTO toSubtestTemplate(Subtest subtest, List<Item> items, ItemGraph graph) {
        List<SubtestCloneTemplateDTO.ItemTemplate> itemTemplates = items.stream()
                .map(item -> toItemTemplate(item, graph.optionsByItem().getOrDefault(item.getId(), List.of()),
                        graph.itemImagesByItem().getOrDefault(item.getId(), List.of()),
                        graph.optionImagesByOption(), graph.keysByItem().get(item.getId())))
                .toList();
        Short strategyId = subtest.getEstrategiaCalificacion() == null
                ? null
                : subtest.getEstrategiaCalificacion().getId();
        return new SubtestCloneTemplateDTO(subtest.getId(), subtest.getCodigoSubtest(), subtest.getNombreSubtest(),
                subtest.getDescripcion(), subtest.getInstrucciones(), subtest.getNumeroOrden(),
                subtest.getTiempoLimiteSegundos(), subtest.getPermiteAleatorizarItems(),
                subtest.getPermiteAleatorizarOpciones(), subtest.getEsObligatorio(), strategyId,
                subtest.getEstado(), itemTemplates);
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.TEST_CREAR)
    public List<Subtest> saveConfiguration(long versionId, VersionConfigurationRequest request) {
        VersionTest version = requireDraft(versionId);
        List<Subtest> saved = new ArrayList<>();
        if (request == null || request.subtests() == null) {
            return saved;
        }
        validateConfigurationRequest(request);
        validateDeletedOptionsNotReferencedByExistingKeys(request.subtests());
        for (VersionConfigurationRequest.SubtestDraft draft : request.subtests()) {
            if (draft.status() == VersionConfigurationRequest.DraftStatus.DELETED) {
                removeExisting(Subtest.class, draft.id());
                continue;
            }
            Subtest subtest = draft.id() == null ? new Subtest() : find(Subtest.class, draft.id());
            requireSameVersion(versionId, subtest);
            applySubtestDraft(version, subtest, draft);
            if (draft.id() == null) {
                em.persist(subtest);
            }
            persistDraftItems(subtest, nullToEmpty(draft.items()));
            saved.add(subtest);
        }
        return saved;
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.BAREMO_CONFIGURAR)
    public Baremo createBaremo(BaremoCommand command) {
        VersionTest version = requireDraft(command.versionId());
        Baremo baremo = new Baremo();
        baremo.setVersionTest(version);
        baremo.setDimensionResultado(command.dimensionId() == null ? null : find(DimensionResultado.class, command.dimensionId()));
        baremo.setCodigoBaremo(command.code());
        baremo.setNombre(command.name());
        baremo.setDescripcion(command.description());
        baremo.setGrupoNormativo(command.normativeGroup());
        baremo.setEstado(EstadoConfiguracion.BORRADOR);
        baremo.setCreadoPor(currentUser());
        baremo.setCreadoEn(LocalDateTime.now(clock));
        em.persist(baremo);
        return baremo;
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.BAREMO_CONFIGURAR)
    public Baremo updateBaremo(long baremoId, BaremoCommand command) {
        Baremo baremo = find(Baremo.class, baremoId);
        requireDraft(baremo.getVersionTest().getId());
        baremo.setDimensionResultado(command.dimensionId() == null ? null : find(DimensionResultado.class, command.dimensionId()));
        baremo.setCodigoBaremo(command.code());
        baremo.setNombre(command.name());
        baremo.setDescripcion(command.description());
        baremo.setGrupoNormativo(command.normativeGroup());
        return baremo;
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.BAREMO_CONFIGURAR)
    public RangoBaremo createBaremoRange(long baremoId, BaremoRangeCommand command) {
        Baremo baremo = find(Baremo.class, baremoId);
        requireDraft(baremo.getVersionTest().getId());
        RangoBaremo range = new RangoBaremo();
        range.setBaremo(baremo);
        range.setPuntajeMinimo(command.minScore());
        range.setPuntajeMaximo(command.maxScore());
        range.setPercentil(command.percentile());
        range.setCategoria(command.category());
        range.setInterpretacion(command.interpretation());
        range.setRecomendacion(command.recommendation());
        range.setOrden(command.order());
        em.persist(range);
        return range;
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.BAREMO_CONFIGURAR)
    public RangoBaremo updateBaremoRange(long rangeId, BaremoRangeCommand command) {
        RangoBaremo range = find(RangoBaremo.class, rangeId);
        requireDraft(range.getBaremo().getVersionTest().getId());
        range.setPuntajeMinimo(command.minScore());
        range.setPuntajeMaximo(command.maxScore());
        range.setPercentil(command.percentile());
        range.setCategoria(command.category());
        range.setInterpretacion(command.interpretation());
        range.setRecomendacion(command.recommendation());
        range.setOrden(command.order());
        return range;
    }

    /**
     * B9: clona en una sola transaccion la configuracion completa de una version (en cualquier estado) a una
     * {@code VersionTest} BORRADOR nueva del mismo test. Copia subtests, items, opciones, imagenes (filas nuevas sobre
     * el mismo {@code RecursoMultimedia}), dimensiones, reglas de calificacion, claves (con su conjunto de opciones
     * correctas), matriz opcion-dimension y baremos con sus rangos. No copia rubricas de evaluacion.
     * Cualquier excepcion revierte todo: no queda una version parcial.
     */
    @Transactional
    @PreAuthorize(SecurityPermissions.TEST_CREAR)
    public VersionTest cloneVersion(long sourceVersionId, String versionNumber) {
        if (versionNumber == null || versionNumber.isBlank()) {
            throw new IllegalArgumentException("El numero de version es obligatorio");
        }
        VersionTest source = versions.findByIdForUpdate(sourceVersionId)
                .orElseThrow(() -> new EntityNotFoundException("Version no encontrada: " + sourceVersionId));
        Long duplicates = em.createQuery(
                "SELECT count(v) FROM VersionTest v WHERE v.test.id = :testId AND v.numeroVersion = :number",
                Long.class).setParameter("testId", source.getTest().getId())
                .setParameter("number", versionNumber).getSingleResult();
        if (duplicates > 0) {
            throw new IllegalStateException("Ya existe la version " + versionNumber + " en el test");
        }
        Usuario actor = currentUser();
        LocalDateTime now = LocalDateTime.now(clock);

        VersionTest copy = new VersionTest();
        copy.setTest(source.getTest());
        copy.setEstrategiaCalificacion(source.getEstrategiaCalificacion());
        copy.setNumeroVersion(versionNumber);
        copy.setEstado(EstadoVersionTest.BORRADOR);
        copy.setInstruccionesGenerales(source.getInstruccionesGenerales());
        copy.setTiempoLimiteSegundos(source.getTiempoLimiteSegundos());
        copy.setPermiteAleatorizarItems(source.getPermiteAleatorizarItems());
        copy.setPermiteAleatorizarSubtests(source.getPermiteAleatorizarSubtests());
        copy.setCreadoPor(actor);
        copy.setCreadoEn(now);
        em.persist(copy);

        Map<Long, Subtest> subtestMap = cloneSubtests(source, copy);
        Map<Long, DimensionResultado> dimensionMap = cloneDimensions(source, copy, subtestMap, now);
        Map<Long, Item> itemMap = cloneItems(subtestMap);
        Map<Long, OpcionItem> optionMap = cloneOptions(itemMap);
        cloneImages(itemMap, optionMap);
        Map<Long, ReglaCalificacion> ruleMap = cloneRules(source, copy, subtestMap, itemMap, actor, now);
        cloneAnswerKeys(source, ruleMap, itemMap, optionMap, actor, now);
        cloneOptionDimensionScores(ruleMap, optionMap, dimensionMap, now);
        cloneBaremos(source, copy, dimensionMap, actor, now);
        em.flush();
        return copy;
    }

    private Map<Long, Subtest> cloneSubtests(VersionTest source, VersionTest copy) {
        List<Subtest> originals = em.createQuery(
                "SELECT s FROM Subtest s WHERE s.versionTest.id = :versionId ORDER BY s.numeroOrden ASC, s.id ASC",
                Subtest.class).setParameter("versionId", source.getId()).getResultList();
        Map<Long, Subtest> map = new LinkedHashMap<>();
        for (Subtest original : originals) {
            Subtest clone = new Subtest();
            clone.setVersionTest(copy);
            clone.setEstrategiaCalificacion(original.getEstrategiaCalificacion());
            clone.setCodigoSubtest(original.getCodigoSubtest());
            clone.setNombreSubtest(original.getNombreSubtest());
            clone.setDescripcion(original.getDescripcion());
            clone.setInstrucciones(original.getInstrucciones());
            clone.setNumeroOrden(original.getNumeroOrden());
            clone.setTiempoLimiteSegundos(original.getTiempoLimiteSegundos());
            clone.setPermiteAleatorizarItems(original.getPermiteAleatorizarItems());
            clone.setPermiteAleatorizarOpciones(original.getPermiteAleatorizarOpciones());
            clone.setEsObligatorio(original.getEsObligatorio());
            clone.setEstado(original.getEstado());
            em.persist(clone);
            map.put(original.getId(), clone);
        }
        return map;
    }

    private Map<Long, DimensionResultado> cloneDimensions(VersionTest source, VersionTest copy,
            Map<Long, Subtest> subtestMap, LocalDateTime now) {
        List<DimensionResultado> originals = em.createQuery(
                "SELECT d FROM DimensionResultado d WHERE d.versionTest.id = :versionId ORDER BY d.id ASC",
                DimensionResultado.class).setParameter("versionId", source.getId()).getResultList();
        Map<Long, DimensionResultado> map = new LinkedHashMap<>();
        for (DimensionResultado original : originals) {
            DimensionResultado clone = new DimensionResultado();
            clone.setVersionTest(copy);
            clone.setSubtest(original.getSubtest() == null ? null : subtestMap.get(original.getSubtest().getId()));
            clone.setCodigoDimension(original.getCodigoDimension());
            clone.setNombreDimension(original.getNombreDimension());
            clone.setDescripcion(original.getDescripcion());
            clone.setOrdenPresentacion(original.getOrdenPresentacion());
            clone.setPuntajeMinimo(original.getPuntajeMinimo());
            clone.setPuntajeMaximo(original.getPuntajeMaximo());
            clone.setActiva(original.getActiva());
            clone.setCreadoEn(now);
            em.persist(clone);
            map.put(original.getId(), clone);
        }
        return map;
    }

    private Map<Long, Item> cloneItems(Map<Long, Subtest> subtestMap) {
        if (subtestMap.isEmpty()) {
            return Map.of();
        }
        List<Item> originals = em.createQuery("""
                SELECT i FROM Item i
                WHERE i.subtest.id IN :subtestIds
                ORDER BY i.subtest.id ASC, i.numeroOrden ASC
                """, Item.class).setParameter("subtestIds", List.copyOf(subtestMap.keySet())).getResultList();
        Map<Long, Item> map = new LinkedHashMap<>();
        for (Item original : originals) {
            Item clone = new Item();
            clone.setSubtest(subtestMap.get(original.getSubtest().getId()));
            clone.setCodigoItem(original.getCodigoItem());
            clone.setTipoItem(original.getTipoItem());
            clone.setTipoRespuesta(original.getTipoRespuesta());
            clone.setEnunciado(original.getEnunciado());
            clone.setInstruccion(original.getInstruccion());
            clone.setNumeroOrden(original.getNumeroOrden());
            clone.setPuntajeBase(original.getPuntajeBase());
            clone.setTiempoLimiteSegundos(original.getTiempoLimiteSegundos());
            clone.setEsObligatorio(original.getEsObligatorio());
            clone.setEsConfidencial(original.getEsConfidencial());
            clone.setEstado(original.getEstado());
            em.persist(clone);
            map.put(original.getId(), clone);
        }
        return map;
    }

    private Map<Long, OpcionItem> cloneOptions(Map<Long, Item> itemMap) {
        Map<Long, List<OpcionItem>> originalsByItem = optionsByItem(List.copyOf(itemMap.keySet()));
        Map<Long, OpcionItem> map = new LinkedHashMap<>();
        for (List<OpcionItem> originals : originalsByItem.values()) {
            for (OpcionItem original : originals) {
                OpcionItem clone = new OpcionItem();
                clone.setItem(itemMap.get(original.getItem().getId()));
                clone.setCodigoOpcion(original.getCodigoOpcion());
                clone.setTextoOpcion(original.getTextoOpcion());
                clone.setNumeroOrden(original.getNumeroOrden());
                clone.setValorOrdinal(original.getValorOrdinal());
                clone.setEstado(original.getEstado());
                em.persist(clone);
                map.put(original.getId(), clone);
            }
        }
        return map;
    }

    private void cloneImages(Map<Long, Item> itemMap, Map<Long, OpcionItem> optionMap) {
        if (!itemMap.isEmpty()) {
            List<ImagenItem> originals = em.createQuery("""
                    SELECT img FROM ImagenItem img JOIN FETCH img.recurso
                    WHERE img.item.id IN :itemIds
                    ORDER BY img.item.id ASC, img.numeroOrden ASC
                    """, ImagenItem.class).setParameter("itemIds", List.copyOf(itemMap.keySet())).getResultList();
            for (ImagenItem original : originals) {
                ImagenItem clone = new ImagenItem();
                clone.setItem(itemMap.get(original.getItem().getId()));
                clone.setRecurso(original.getRecurso());
                clone.setRolImagen(original.getRolImagen());
                clone.setNumeroOrden(original.getNumeroOrden());
                clone.setTextoAlternativo(original.getTextoAlternativo());
                em.persist(clone);
            }
        }
        if (!optionMap.isEmpty()) {
            List<ImagenOpcion> originals = em.createQuery("""
                    SELECT img FROM ImagenOpcion img JOIN FETCH img.recurso
                    WHERE img.opcion.id IN :optionIds
                    ORDER BY img.opcion.id ASC, img.numeroOrden ASC
                    """, ImagenOpcion.class).setParameter("optionIds", List.copyOf(optionMap.keySet()))
                    .getResultList();
            for (ImagenOpcion original : originals) {
                ImagenOpcion clone = new ImagenOpcion();
                clone.setOpcion(optionMap.get(original.getOpcion().getId()));
                clone.setRecurso(original.getRecurso());
                clone.setNumeroOrden(original.getNumeroOrden());
                clone.setTextoAlternativo(original.getTextoAlternativo());
                em.persist(clone);
            }
        }
    }

    private Map<Long, ReglaCalificacion> cloneRules(VersionTest source, VersionTest copy,
            Map<Long, Subtest> subtestMap, Map<Long, Item> itemMap, Usuario actor, LocalDateTime now) {
        List<ReglaCalificacion> originals = em.createQuery(
                "SELECT r FROM ReglaCalificacion r WHERE r.versionTest.id = :versionId ORDER BY r.id ASC",
                ReglaCalificacion.class).setParameter("versionId", source.getId()).getResultList();
        Map<Long, ReglaCalificacion> map = new LinkedHashMap<>();
        for (ReglaCalificacion original : originals) {
            ReglaCalificacion clone = new ReglaCalificacion();
            clone.setVersionTest(copy);
            clone.setSubtest(original.getSubtest() == null ? null : subtestMap.get(original.getSubtest().getId()));
            clone.setItem(original.getItem() == null ? null : itemMap.get(original.getItem().getId()));
            clone.setEstrategiaCalificacion(original.getEstrategiaCalificacion());
            clone.setTipoRegla(original.getTipoRegla());
            clone.setPrioridad(original.getPrioridad());
            clone.setActiva(original.getActiva());
            clone.setEstado(EstadoConfiguracion.BORRADOR);
            clone.setParametros(original.getParametros());
            clone.setObservacion(original.getObservacion());
            clone.setCreadoPor(actor);
            clone.setCreadoEn(now);
            em.persist(clone);
            map.put(original.getId(), clone);
        }
        return map;
    }

    /**
     * Las claves se copian con SQL nativo porque {@code usa_conjunto_opciones} y {@code clave_respuesta_opcion}
     * (conjunto exacto de opciones correctas de items OPCION_MULTIPLE) no estan mapeados en {@link ClaveRespuesta}.
     */
    @SuppressWarnings("unchecked")
    private void cloneAnswerKeys(VersionTest source, Map<Long, ReglaCalificacion> ruleMap, Map<Long, Item> itemMap,
            Map<Long, OpcionItem> optionMap, Usuario actor, LocalDateTime now) {
        em.flush();
        List<Object[]> keys = em.createNativeQuery("""
                SELECT c.clave_respuesta_id, c.regla_calificacion_id, c.item_id, c.opcion_correcta_id,
                       c.texto_esperado, c.valor_numerico_esperado, c.tolerancia_numerica, c.puntaje,
                       c.requiere_revision_manual, c.usa_conjunto_opciones
                FROM clave_respuesta c
                JOIN regla_calificacion r ON r.regla_calificacion_id = c.regla_calificacion_id
                WHERE r.version_test_id = :versionId
                ORDER BY c.clave_respuesta_id
                """).setParameter("versionId", source.getId()).getResultList();
        if (keys.isEmpty()) {
            return;
        }
        Map<Long, List<Long>> optionSetByKey = new HashMap<>();
        List<Long> setKeyIds = keys.stream().filter(row -> Boolean.TRUE.equals(row[9]))
                .map(row -> ((Number) row[0]).longValue()).toList();
        if (!setKeyIds.isEmpty()) {
            List<Object[]> rows = em.createNativeQuery("""
                    SELECT clave_respuesta_id, opcion_id FROM clave_respuesta_opcion
                    WHERE clave_respuesta_id IN (:keyIds) ORDER BY clave_respuesta_id, opcion_id
                    """).setParameter("keyIds", setKeyIds).getResultList();
            for (Object[] row : rows) {
                optionSetByKey.computeIfAbsent(((Number) row[0]).longValue(), ignored -> new ArrayList<>())
                        .add(((Number) row[1]).longValue());
            }
        }
        for (Object[] row : keys) {
            long keyId = ((Number) row[0]).longValue();
            ReglaCalificacion rule = ruleMap.get(((Number) row[1]).longValue());
            Item item = itemMap.get(((Number) row[2]).longValue());
            OpcionItem correct = row[3] == null ? null : optionMap.get(((Number) row[3]).longValue());
            Number newKeyId = (Number) em.createNativeQuery("""
                    INSERT INTO clave_respuesta (regla_calificacion_id, item_id, opcion_correcta_id, texto_esperado,
                        valor_numerico_esperado, tolerancia_numerica, puntaje, requiere_revision_manual,
                        usa_conjunto_opciones, creado_por, creado_en)
                    VALUES (:ruleId, :itemId, :correctId, :expectedText, :expectedNumber, :tolerance, :score,
                        :manual, :usesSet, :actorId, :createdAt)
                    RETURNING clave_respuesta_id
                    """)
                    .setParameter("ruleId", rule.getId())
                    .setParameter("itemId", item.getId())
                    .setParameter("correctId", correct == null ? null : correct.getId())
                    .setParameter("expectedText", row[4])
                    .setParameter("expectedNumber", row[5])
                    .setParameter("tolerance", row[6])
                    .setParameter("score", row[7])
                    .setParameter("manual", row[8])
                    .setParameter("usesSet", row[9])
                    .setParameter("actorId", actor.getId())
                    .setParameter("createdAt", now)
                    .getSingleResult();
            for (Long optionId : optionSetByKey.getOrDefault(keyId, List.of())) {
                em.createNativeQuery("""
                        INSERT INTO clave_respuesta_opcion (clave_respuesta_id, item_id, opcion_id)
                        VALUES (:keyId, :itemId, :optionId)
                        """)
                        .setParameter("keyId", newKeyId.longValue())
                        .setParameter("itemId", item.getId())
                        .setParameter("optionId", optionMap.get(optionId).getId())
                        .executeUpdate();
            }
        }
    }

    private void cloneOptionDimensionScores(Map<Long, ReglaCalificacion> ruleMap, Map<Long, OpcionItem> optionMap,
            Map<Long, DimensionResultado> dimensionMap, LocalDateTime now) {
        if (ruleMap.isEmpty()) {
            return;
        }
        List<OpcionPuntajeDimension> originals = em.createQuery("""
                SELECT p FROM OpcionPuntajeDimension p
                WHERE p.reglaCalificacion.id IN :ruleIds
                ORDER BY p.id ASC
                """, OpcionPuntajeDimension.class).setParameter("ruleIds", List.copyOf(ruleMap.keySet()))
                .getResultList();
        for (OpcionPuntajeDimension original : originals) {
            OpcionPuntajeDimension clone = new OpcionPuntajeDimension();
            clone.setReglaCalificacion(ruleMap.get(original.getReglaCalificacion().getId()));
            clone.setOpcion(optionMap.get(original.getOpcion().getId()));
            clone.setDimensionResultado(dimensionMap.get(original.getDimensionResultado().getId()));
            clone.setPuntaje(original.getPuntaje());
            clone.setPeso(original.getPeso());
            clone.setActiva(original.getActiva());
            clone.setCreadoEn(now);
            em.persist(clone);
        }
    }

    private void cloneBaremos(VersionTest source, VersionTest copy, Map<Long, DimensionResultado> dimensionMap,
            Usuario actor, LocalDateTime now) {
        List<Baremo> originals = em.createQuery(
                "SELECT b FROM Baremo b WHERE b.versionTest.id = :versionId ORDER BY b.id ASC", Baremo.class)
                .setParameter("versionId", source.getId()).getResultList();
        if (originals.isEmpty()) {
            return;
        }
        Map<Long, Baremo> map = new LinkedHashMap<>();
        for (Baremo original : originals) {
            Baremo clone = new Baremo();
            clone.setVersionTest(copy);
            clone.setDimensionResultado(original.getDimensionResultado() == null ? null
                    : dimensionMap.get(original.getDimensionResultado().getId()));
            clone.setCodigoBaremo(original.getCodigoBaremo());
            clone.setNombre(original.getNombre());
            clone.setDescripcion(original.getDescripcion());
            clone.setGrupoNormativo(original.getGrupoNormativo());
            clone.setCriterioEdadMinima(original.getCriterioEdadMinima());
            clone.setCriterioEdadMaxima(original.getCriterioEdadMaxima());
            clone.setCriterioSexo(original.getCriterioSexo());
            clone.setCriterioCarrera(original.getCriterioCarrera());
            clone.setVigenteDesde(original.getVigenteDesde());
            clone.setVigenteHasta(original.getVigenteHasta());
            clone.setEstado(EstadoConfiguracion.BORRADOR);
            clone.setCreadoPor(actor);
            clone.setCreadoEn(now);
            em.persist(clone);
            map.put(original.getId(), clone);
        }
        List<RangoBaremo> ranges = em.createQuery(
                "SELECT r FROM RangoBaremo r WHERE r.baremo.id IN :baremoIds ORDER BY r.baremo.id ASC, r.orden ASC",
                RangoBaremo.class).setParameter("baremoIds", List.copyOf(map.keySet())).getResultList();
        for (RangoBaremo original : ranges) {
            RangoBaremo clone = new RangoBaremo();
            clone.setBaremo(map.get(original.getBaremo().getId()));
            clone.setPuntajeMinimo(original.getPuntajeMinimo());
            clone.setPuntajeMaximo(original.getPuntajeMaximo());
            clone.setPercentil(original.getPercentil());
            clone.setCategoria(original.getCategoria());
            clone.setInterpretacion(original.getInterpretacion());
            clone.setRecomendacion(original.getRecomendacion());
            clone.setOrden(original.getOrden());
            em.persist(clone);
        }
    }

    private VersionTest requireDraft(long versionId) {
        VersionTest version = versions.findByIdForUpdate(versionId)
                .orElseThrow(() -> new EntityNotFoundException("Version no encontrada: " + versionId));
        if (version.getEstado() != EstadoVersionTest.BORRADOR) {
            throw new IllegalStateException("La version publicada o aprobada no se edita directamente");
        }
        return version;
    }

    @PreAuthorize(SecurityPermissions.INSTRUMENTO_CATALOGO_LEER)
    public List<Subtest> listSubtests(long versionId) {
        if (!currentActor.canReadFullInstruments()) {
            VersionTest version = em.find(VersionTest.class, versionId);
            if (version == null || version.getEstado() != EstadoVersionTest.PUBLICADO) {
                throw new EntityNotFoundException("Version no encontrada: " + versionId);
            }
        }
        return em.createQuery("SELECT s FROM Subtest s WHERE s.versionTest.id = :versionId ORDER BY s.numeroOrden ASC", Subtest.class)
                .setParameter("versionId", versionId)
                .getResultList();
    }

    @PreAuthorize(SecurityPermissions.TEST_LEER)
    public List<Item> listItems(long subtestId) {
        return em.createQuery("SELECT i FROM Item i WHERE i.subtest.id = :subtestId ORDER BY i.numeroOrden ASC", Item.class)
                .setParameter("subtestId", subtestId)
                .getResultList();
    }

    @PreAuthorize(SecurityPermissions.TEST_LEER)
    public List<ItemDTO> listItemDtos(long subtestId) {
        List<Item> items = listItems(subtestId);
        Map<Long, List<ImageResourceDTO>> imagesByItem = itemImages(items.stream().map(Item::getId).toList());
        return items.stream()
                .map(item -> ItemDTO.from(item, imagesByItem.getOrDefault(item.getId(), List.of())))
                .toList();
    }

    @PreAuthorize(SecurityPermissions.TEST_LEER)
    public List<OpcionItem> listOptions(long itemId) {
        return em.createQuery("SELECT o FROM OpcionItem o WHERE o.item.id = :itemId ORDER BY o.numeroOrden ASC", OpcionItem.class)
                .setParameter("itemId", itemId)
                .getResultList();
    }

    @PreAuthorize(SecurityPermissions.TEST_LEER)
    public List<OptionDTO> listOptionDtos(long itemId) {
        List<OpcionItem> options = listOptions(itemId);
        Map<Long, List<ImageResourceDTO>> imagesByOption = optionImages(options.stream().map(OpcionItem::getId).toList());
        return options.stream()
                .map(option -> OptionDTO.from(option, imagesByOption.getOrDefault(option.getId(), List.of())))
                .toList();
    }

    @PreAuthorize(SecurityPermissions.CALIFICACION_CONFIGURAR + " or " + SecurityPermissions.TEST_LEER)
    public List<ReglaCalificacion> listScoringRules(long subtestId) {
        return em.createQuery("SELECT r FROM ReglaCalificacion r WHERE r.subtest.id = :subtestId ORDER BY r.prioridad ASC", ReglaCalificacion.class)
                .setParameter("subtestId", subtestId)
                .getResultList();
    }

    @PreAuthorize(SecurityPermissions.CALIFICACION_CONFIGURAR + " or " + SecurityPermissions.TEST_LEER)
    public ClaveRespuesta findAnswerKey(long itemId) {
        List<ClaveRespuesta> keys = em.createQuery("SELECT c FROM ClaveRespuesta c WHERE c.item.id = :itemId", ClaveRespuesta.class)
                .setParameter("itemId", itemId)
                .setMaxResults(1)
                .getResultList();
        return keys.isEmpty() ? null : keys.get(0);
    }

    private void validateConfigurationRequest(VersionConfigurationRequest request) {
        Set<String> subtestCodes = new HashSet<>();
        Set<Integer> subtestOrders = new HashSet<>();
        Set<Long> itemsDeletingAnswerKey = new HashSet<>();
        Set<Long> itemsCreatingAnswerKey = new HashSet<>();
        Set<String> itemDraftsDeletingAnswerKey = new HashSet<>();
        Set<String> itemDraftsCreatingAnswerKey = new HashSet<>();
        for (VersionConfigurationRequest.SubtestDraft subtest : request.subtests()) {
            if (subtest.status() == VersionConfigurationRequest.DraftStatus.DELETED) {
                continue;
            }
            if (!subtestCodes.add(normalized(subtest.code()))) {
                throw new IllegalArgumentException("Codigo de subtest duplicado: " + subtest.code());
            }
            if (subtest.order() != null && !subtestOrders.add(subtest.order())) {
                throw new IllegalArgumentException("Orden de subtest duplicado: " + subtest.order());
            }
            validateItemDrafts(nullToEmpty(subtest.items()), itemsDeletingAnswerKey, itemsCreatingAnswerKey,
                    itemDraftsDeletingAnswerKey, itemDraftsCreatingAnswerKey);
        }
    }

    private void validateItemDrafts(List<VersionConfigurationRequest.ItemDraft> items,
            Set<Long> itemsDeletingAnswerKey, Set<Long> itemsCreatingAnswerKey,
            Set<String> itemDraftsDeletingAnswerKey, Set<String> itemDraftsCreatingAnswerKey) {
        Set<String> itemCodes = new HashSet<>();
        Set<Integer> itemOrders = new HashSet<>();
        for (VersionConfigurationRequest.ItemDraft item : items) {
            if (item.status() == VersionConfigurationRequest.DraftStatus.DELETED) {
                continue;
            }
            if (!itemCodes.add(normalized(item.code()))) {
                throw new IllegalArgumentException("Codigo de item duplicado: " + item.code());
            }
            if (item.order() != null && !itemOrders.add(item.order())) {
                throw new IllegalArgumentException("Orden de item duplicado: " + item.order());
            }
            List<VersionConfigurationRequest.OptionDraft> options = nullToEmpty(item.options());
            validateImageDrafts(nullToEmpty(item.images()), "item");
            validateOptionDrafts(options);
            validateItemAnswerKeyDraft(item, options, itemsDeletingAnswerKey, itemsCreatingAnswerKey,
                    itemDraftsDeletingAnswerKey, itemDraftsCreatingAnswerKey);
        }
    }

    private void validateItemAnswerKeyDraft(VersionConfigurationRequest.ItemDraft item,
            List<VersionConfigurationRequest.OptionDraft> options,
            Set<Long> itemsDeletingAnswerKey, Set<Long> itemsCreatingAnswerKey,
            Set<String> itemDraftsDeletingAnswerKey, Set<String> itemDraftsCreatingAnswerKey) {
        VersionConfigurationRequest.AnswerKeyDraft answerKey = item.answerKey();
        if (answerKey == null) {
            return;
        }
        if (answerKey.status() == VersionConfigurationRequest.DraftStatus.DELETED) {
            if (item.id() != null) {
                itemsDeletingAnswerKey.add(item.id());
                if (itemsCreatingAnswerKey.contains(item.id())) {
                    throw new IllegalArgumentException(
                            "Conflicto en clave de respuesta del item " + item.id()
                                    + ": no puede eliminarse y crearse en la misma configuracion");
                }
            } else if (item.draftId() != null) {
                itemDraftsDeletingAnswerKey.add(item.draftId());
                if (itemDraftsCreatingAnswerKey.contains(item.draftId())) {
                    throw new IllegalArgumentException(
                            "Conflicto en clave de respuesta del item " + item.draftId()
                                    + ": no puede eliminarse y crearse en la misma configuracion");
                }
            }
            return;
        }
        if (answerKey.status() == VersionConfigurationRequest.DraftStatus.CREATED) {
            if (item.id() != null) {
                itemsCreatingAnswerKey.add(item.id());
                if (itemsDeletingAnswerKey.contains(item.id())) {
                    throw new IllegalArgumentException(
                            "Conflicto en clave de respuesta del item " + item.id()
                                    + ": no puede eliminarse y crearse en la misma configuracion");
                }
            } else if (item.draftId() != null) {
                itemDraftsCreatingAnswerKey.add(item.draftId());
                if (itemDraftsDeletingAnswerKey.contains(item.draftId())) {
                    throw new IllegalArgumentException(
                            "Conflicto en clave de respuesta del item " + item.draftId()
                                    + ": no puede eliminarse y crearse en la misma configuracion");
                }
            }
        }
        Set<Long> deletedOptionIds = new HashSet<>();
        Set<String> deletedOptionDraftIds = new HashSet<>();
        for (VersionConfigurationRequest.OptionDraft option : options) {
            if (option.status() == VersionConfigurationRequest.DraftStatus.DELETED) {
                if (option.id() != null) {
                    deletedOptionIds.add(option.id());
                }
                if (option.draftId() != null) {
                    deletedOptionDraftIds.add(option.draftId());
                }
            }
        }
        if ((answerKey.correctOptionId() != null && deletedOptionIds.contains(answerKey.correctOptionId()))
                || (answerKey.correctOptionDraftId() != null
                        && deletedOptionDraftIds.contains(answerKey.correctOptionDraftId()))) {
            throw new IllegalArgumentException(
                    "No se puede eliminar la opcion correcta sin eliminar o reasignar la clave de respuesta");
        }
    }

    private void validateDeletedOptionsNotReferencedByExistingKeys(
            List<VersionConfigurationRequest.SubtestDraft> subtests) {
        Set<Long> deletedAnswerKeyIds = new HashSet<>();
        for (VersionConfigurationRequest.SubtestDraft subtest : subtests) {
            if (subtest.status() == VersionConfigurationRequest.DraftStatus.DELETED) {
                continue;
            }
            for (VersionConfigurationRequest.ItemDraft item : nullToEmpty(subtest.items())) {
                if (item.status() == VersionConfigurationRequest.DraftStatus.DELETED) {
                    continue;
                }
                if (item.answerKey() != null
                        && item.answerKey().status() == VersionConfigurationRequest.DraftStatus.DELETED
                        && item.answerKey().id() != null) {
                    deletedAnswerKeyIds.add(item.answerKey().id());
                }
            }
        }
        for (VersionConfigurationRequest.SubtestDraft subtest : subtests) {
            if (subtest.status() == VersionConfigurationRequest.DraftStatus.DELETED) {
                continue;
            }
            for (VersionConfigurationRequest.ItemDraft item : nullToEmpty(subtest.items())) {
                if (item.status() == VersionConfigurationRequest.DraftStatus.DELETED || item.id() == null) {
                    continue;
                }
                boolean keyUntouchedOrNoOpDelete = item.answerKey() == null
                        || (item.answerKey().status() == VersionConfigurationRequest.DraftStatus.DELETED
                                && item.answerKey().id() == null);
                if (!keyUntouchedOrNoOpDelete) {
                    continue;
                }
                Set<Long> deletedOptionIds = new HashSet<>();
                for (VersionConfigurationRequest.OptionDraft option : nullToEmpty(item.options())) {
                    if (option.status() == VersionConfigurationRequest.DraftStatus.DELETED && option.id() != null) {
                        deletedOptionIds.add(option.id());
                    }
                }
                if (deletedOptionIds.isEmpty()) {
                    continue;
                }
                List<ClaveRespuesta> existingKeys = em.createQuery(
                        "SELECT c FROM ClaveRespuesta c LEFT JOIN FETCH c.opcionCorrecta WHERE c.item.id = :itemId",
                        ClaveRespuesta.class)
                        .setParameter("itemId", item.id())
                        .getResultList();
                for (ClaveRespuesta existingKey : existingKeys) {
                    if (!deletedAnswerKeyIds.contains(existingKey.getId())
                            && existingKey.getOpcionCorrecta() != null
                            && deletedOptionIds.contains(existingKey.getOpcionCorrecta().getId())) {
                        throw new IllegalArgumentException(
                                "No se puede eliminar la opcion correcta sin eliminar o reasignar la clave de respuesta");
                    }
                }
            }
        }
    }

    private void validateOptionDrafts(List<VersionConfigurationRequest.OptionDraft> options) {
        Set<String> optionCodes = new HashSet<>();
        Set<Integer> optionOrders = new HashSet<>();
        for (VersionConfigurationRequest.OptionDraft option : options) {
            if (option.status() == VersionConfigurationRequest.DraftStatus.DELETED) {
                continue;
            }
            if (!optionCodes.add(normalized(option.code()))) {
                throw new IllegalArgumentException("Codigo de opcion duplicado: " + option.code());
            }
            if (option.order() != null && !optionOrders.add(option.order())) {
                throw new IllegalArgumentException("Orden de opcion duplicado: " + option.order());
            }
            validateImageDrafts(nullToEmpty(option.images()), "opcion");
        }
    }

    private void validateImageDrafts(List<VersionConfigurationRequest.ImageDraft> images, String owner) {
        Set<Integer> imageOrders = new HashSet<>();
        for (VersionConfigurationRequest.ImageDraft image : images) {
            if (image.status() == VersionConfigurationRequest.DraftStatus.DELETED) {
                continue;
            }
            if (image.resourceId() == null) {
                throw new IllegalArgumentException("resourceId es requerido para la imagen de " + owner);
            }
            if (image.order() != null && !imageOrders.add(image.order())) {
                throw new IllegalArgumentException("Orden de imagen de " + owner + " duplicado: " + image.order());
            }
        }
    }

    private static String normalized(String value) {
        return value == null ? "" : value.trim().toUpperCase();
    }

    private SubtestCloneTemplateDTO.ItemTemplate toItemTemplate(Item item, List<OpcionItem> options,
            List<SubtestCloneTemplateDTO.ImageTemplate> images,
            Map<Long, List<SubtestCloneTemplateDTO.ImageTemplate>> optionImagesByOption, ClaveRespuesta key) {
        List<SubtestCloneTemplateDTO.OptionTemplate> optionTemplates = options.stream()
                .map(option -> new SubtestCloneTemplateDTO.OptionTemplate(option.getId(), option.getCodigoOpcion(),
                        option.getTextoOpcion(), option.getNumeroOrden(), option.getValorOrdinal(),
                        option.getEstado(), optionImagesByOption.getOrDefault(option.getId(), List.of())))
                .toList();
        SubtestCloneTemplateDTO.AnswerKeyTemplate answerKey = key == null ? null
                : new SubtestCloneTemplateDTO.AnswerKeyTemplate(key.getId(),
                        key.getReglaCalificacion() == null ? null : key.getReglaCalificacion().getId(),
                        key.getOpcionCorrecta() == null ? null : key.getOpcionCorrecta().getId(),
                        key.getTextoEsperado(), key.getValorNumericoEsperado(), key.getToleranciaNumerica(),
                        key.getPuntaje(), key.getRequiereRevisionManual());
        return new SubtestCloneTemplateDTO.ItemTemplate(item.getId(), item.getCodigoItem(), item.getTipoItem(),
                item.getTipoRespuesta(), item.getEnunciado(), item.getInstruccion(), item.getNumeroOrden(),
                item.getPuntajeBase(), item.getTiempoLimiteSegundos(), item.getEsObligatorio(),
                item.getEsConfidencial(), item.getEstado(), images, optionTemplates, answerKey);
    }

    private Map<Long, List<OpcionItem>> optionsByItem(List<Long> itemIds) {
        if (itemIds.isEmpty()) {
            return Map.of();
        }
        List<OpcionItem> options = em.createQuery("""
                SELECT o FROM OpcionItem o
                WHERE o.item.id IN :itemIds
                ORDER BY o.item.id ASC, o.numeroOrden ASC
                """, OpcionItem.class)
                .setParameter("itemIds", itemIds)
                .getResultList();
        Map<Long, List<OpcionItem>> result = new LinkedHashMap<>();
        for (OpcionItem option : options) {
            result.computeIfAbsent(option.getItem().getId(), ignored -> new ArrayList<>()).add(option);
        }
        return result;
    }

    private Map<Long, ClaveRespuesta> answerKeysByItem(List<Long> itemIds) {
        if (itemIds.isEmpty()) {
            return Map.of();
        }
        List<ClaveRespuesta> keys = em.createQuery("""
                SELECT c FROM ClaveRespuesta c
                LEFT JOIN FETCH c.opcionCorrecta
                WHERE c.item.id IN :itemIds
                """, ClaveRespuesta.class)
                .setParameter("itemIds", itemIds)
                .getResultList();
        Map<Long, ClaveRespuesta> result = new LinkedHashMap<>();
        for (ClaveRespuesta key : keys) {
            result.putIfAbsent(key.getItem().getId(), key);
        }
        return result;
    }

    private void applySubtestDraft(VersionTest version, Subtest subtest, VersionConfigurationRequest.SubtestDraft draft) {
        subtest.setVersionTest(version);
        subtest.setEstrategiaCalificacion(draft.strategyId() == null ? null : find(EstrategiaCalificacion.class, draft.strategyId()));
        subtest.setCodigoSubtest(draft.code());
        subtest.setNombreSubtest(draft.name());
        subtest.setDescripcion(draft.description());
        subtest.setInstrucciones(draft.instructions());
        subtest.setNumeroOrden(draft.order());
        subtest.setTiempoLimiteSegundos(draft.timeLimitSeconds());
        boolean randomizeItems = Boolean.TRUE.equals(draft.randomizeItems());
        if (randomizeItems && !Boolean.TRUE.equals(version.getPermiteAleatorizarItems())) {
            randomizeItems = false;
        }
        subtest.setPermiteAleatorizarItems(randomizeItems);
        subtest.setPermiteAleatorizarOpciones(Boolean.TRUE.equals(draft.randomizeOptions()));
        subtest.setEsObligatorio(!Boolean.FALSE.equals(draft.required()));
        subtest.setEstado(EstadoGeneral.ACTIVO);
    }

    private void persistDraftItems(Subtest subtest, List<VersionConfigurationRequest.ItemDraft> drafts) {
        Map<String, OpcionItem> optionsByDraftId = new HashMap<>();
        List<PendingAnswerKey> pendingKeys = new ArrayList<>();
        for (VersionConfigurationRequest.ItemDraft draft : drafts) {
            if (draft.status() == VersionConfigurationRequest.DraftStatus.DELETED) {
                removeExisting(Item.class, draft.id());
                continue;
            }
            Item item = draft.id() == null ? new Item() : find(Item.class, draft.id());
            item.setSubtest(subtest);
            item.setCodigoItem(draft.code());
            item.setTipoItem(draft.itemType());
            item.setTipoRespuesta(draft.responseType());
            item.setEnunciado(draft.prompt());
            item.setInstruccion(draft.instruction());
            item.setNumeroOrden(draft.order());
            item.setPuntajeBase(draft.baseScore() == null ? BigDecimal.ONE : draft.baseScore());
            item.setTiempoLimiteSegundos(draft.timeLimitSeconds());
            item.setEsObligatorio(!Boolean.FALSE.equals(draft.required()));
            item.setEsConfidencial(!Boolean.FALSE.equals(draft.confidential()));
            item.setEstado(EstadoGeneral.ACTIVO);
            if (draft.id() == null) {
                em.persist(item);
            }
            if (draft.answerKey() != null
                    && draft.answerKey().status() == VersionConfigurationRequest.DraftStatus.DELETED) {
                deleteAnswerKey(item, draft.answerKey());
            }
            persistItemImages(item, nullToEmpty(draft.images()));
            persistDraftOptions(item, nullToEmpty(draft.options()), optionsByDraftId);
            if (draft.answerKey() != null && draft.answerKey().status() != VersionConfigurationRequest.DraftStatus.DELETED) {
                pendingKeys.add(new PendingAnswerKey(item, draft.answerKey()));
            }
        }
        for (PendingAnswerKey pendingKey : pendingKeys) {
            persistAnswerKey(pendingKey.item(), pendingKey.draft(), optionsByDraftId);
        }
    }

    private void persistDraftOptions(Item item, List<VersionConfigurationRequest.OptionDraft> drafts,
            Map<String, OpcionItem> optionsByDraftId) {
        for (VersionConfigurationRequest.OptionDraft draft : drafts) {
            if (draft.status() == VersionConfigurationRequest.DraftStatus.DELETED) {
                removeExisting(OpcionItem.class, draft.id());
                continue;
            }
            OpcionItem option = draft.id() == null ? new OpcionItem() : find(OpcionItem.class, draft.id());
            option.setItem(item);
            option.setCodigoOpcion(draft.code());
            option.setTextoOpcion(draft.text());
            option.setNumeroOrden(draft.order());
            option.setValorOrdinal(draft.ordinalValue());
            option.setEstado(EstadoGeneral.ACTIVO);
            if (draft.id() == null) {
                em.persist(option);
            }
            if (draft.draftId() != null) {
                optionsByDraftId.put(draft.draftId(), option);
            }
            persistOptionImages(option, nullToEmpty(draft.images()));
        }
    }

    private void persistItemImages(Item item, List<VersionConfigurationRequest.ImageDraft> drafts) {
        for (VersionConfigurationRequest.ImageDraft draft : drafts) {
            if (draft.status() == VersionConfigurationRequest.DraftStatus.DELETED) {
                removeExisting(ImagenItem.class, draft.id());
                continue;
            }
            ImagenItem image = draft.id() == null ? new ImagenItem() : find(ImagenItem.class, draft.id());
            image.setItem(item);
            image.setRecurso(findResourceOrBadRequest(draft.resourceId()));
            image.setNumeroOrden(draft.order());
            image.setTextoAlternativo(draft.altText());
            image.setRolImagen(draft.role() == null ? "ENUNCIADO" : draft.role());
            if (draft.id() == null) {
                em.persist(image);
            }
        }
    }

    private void persistOptionImages(OpcionItem option, List<VersionConfigurationRequest.ImageDraft> drafts) {
        for (VersionConfigurationRequest.ImageDraft draft : drafts) {
            if (draft.status() == VersionConfigurationRequest.DraftStatus.DELETED) {
                removeExisting(ImagenOpcion.class, draft.id());
                continue;
            }
            ImagenOpcion image = draft.id() == null ? new ImagenOpcion() : find(ImagenOpcion.class, draft.id());
            image.setOpcion(option);
            image.setRecurso(findResourceOrBadRequest(draft.resourceId()));
            image.setNumeroOrden(draft.order());
            image.setTextoAlternativo(draft.altText());
            if (draft.id() == null) {
                em.persist(image);
            }
        }
    }

    private RecursoMultimedia findResourceOrBadRequest(Long resourceId) {
        if (resourceId == null) {
            throw new IllegalArgumentException("resourceId es requerido para la imagen");
        }
        RecursoMultimedia resource = em.find(RecursoMultimedia.class, resourceId);
        if (resource == null) {
            throw new IllegalArgumentException("Recurso multimedia no encontrado: " + resourceId);
        }
        return resource;
    }

    private void deleteAnswerKey(Item item, VersionConfigurationRequest.AnswerKeyDraft draft) {
        if (draft.id() == null) {
            return;
        }
        ClaveRespuesta key = find(ClaveRespuesta.class, draft.id());
        if (item.getId() == null || key.getItem() == null || !Objects.equals(key.getItem().getId(), item.getId())) {
            throw new IllegalStateException("La clave de respuesta no pertenece al item indicado");
        }
        em.remove(key);
    }

    private void persistAnswerKey(Item item, VersionConfigurationRequest.AnswerKeyDraft draft,
            Map<String, OpcionItem> optionsByDraftId) {
        ClaveRespuesta key = draft.id() == null ? new ClaveRespuesta() : find(ClaveRespuesta.class, draft.id());
        key.setReglaCalificacion(find(ReglaCalificacion.class, draft.ruleId()));
        key.setItem(item);
        key.setOpcionCorrecta(resolveCorrectOption(draft, optionsByDraftId));
        key.setTextoEsperado(draft.expectedText());
        key.setValorNumericoEsperado(draft.expectedNumber());
        key.setToleranciaNumerica(draft.numericTolerance());
        key.setPuntaje(draft.score() == null ? BigDecimal.ONE : draft.score());
        key.setRequiereRevisionManual(Boolean.TRUE.equals(draft.requiresManualReview()));
        if (draft.id() == null) {
            key.setCreadoPor(currentUser());
            key.setCreadoEn(LocalDateTime.now(clock));
            em.persist(key);
        }
    }

    private OpcionItem resolveCorrectOption(VersionConfigurationRequest.AnswerKeyDraft draft,
            Map<String, OpcionItem> optionsByDraftId) {
        if (draft.correctOptionDraftId() != null) {
            OpcionItem option = optionsByDraftId.get(draft.correctOptionDraftId());
            if (option == null) {
                throw new EntityNotFoundException("Opcion draft no encontrada: " + draft.correctOptionDraftId());
            }
            return option;
        }
        return draft.correctOptionId() == null ? null : find(OpcionItem.class, draft.correctOptionId());
    }

    private void requireSameVersion(long versionId, Subtest subtest) {
        if (subtest.getId() != null && !Objects.equals(subtest.getVersionTest().getId(), versionId)) {
            throw new IllegalArgumentException("El subtest no pertenece a la version destino");
        }
    }

    private <T> void removeExisting(Class<T> type, Long id) {
        if (id == null) {
            return;
        }
        em.remove(find(type, id));
    }

    private static <T> List<T> nullToEmpty(List<T> values) {
        return values == null ? List.of() : values;
    }

    @PreAuthorize(SecurityPermissions.BAREMO_CONFIGURAR + " or " + SecurityPermissions.TEST_LEER)
    public List<Baremo> listBaremos(long versionId) {
        return em.createQuery("SELECT b FROM Baremo b WHERE b.versionTest.id = :versionId ORDER BY b.codigoBaremo ASC", Baremo.class)
                .setParameter("versionId", versionId)
                .getResultList();
    }

    @PreAuthorize(SecurityPermissions.BAREMO_CONFIGURAR + " or " + SecurityPermissions.TEST_LEER)
    public List<RangoBaremo> listBaremoRanges(long baremoId) {
        return em.createQuery("SELECT r FROM RangoBaremo r WHERE r.baremo.id = :baremoId ORDER BY r.orden ASC", RangoBaremo.class)
                .setParameter("baremoId", baremoId)
                .getResultList();
    }

    private Usuario currentUser() {
        UUID id = currentActor.usuarioId();
        return users.findById(id).orElseThrow(() -> new EntityNotFoundException("Usuario autenticado no encontrado: " + id));
    }

    private <T> T find(Class<T> type, Object id) {
        T value = em.find(type, id);
        if (value == null) {
            throw new EntityNotFoundException(type.getSimpleName() + " no encontrado: " + id);
        }
        return value;
    }

    private Map<Long, List<ImageResourceDTO>> itemImages(List<Long> itemIds) {
        if (itemIds.isEmpty()) {
            return Map.of();
        }
        List<Object[]> rows = em.createQuery("""
                SELECT img.item.id, img.id, img.numeroOrden, img.textoAlternativo, res.rutaAlmacenamiento,
                       img.rolImagen
                FROM ImagenItem img
                JOIN img.recurso res
                WHERE img.item.id IN :itemIds
                ORDER BY img.item.id ASC, img.numeroOrden ASC
                """, Object[].class)
                .setParameter("itemIds", itemIds)
                .getResultList();
        Map<Long, List<ImageResourceDTO>> result = new LinkedHashMap<>();
        for (Object[] row : rows) {
            Long ownerId = (Long) row[0];
            result.computeIfAbsent(ownerId, ignored -> new ArrayList<>())
                    .add(new ImageResourceDTO((Long) row[1], (Integer) row[2], (String) row[3], (String) row[4],
                            null, (String) row[5]));
        }
        return result;
    }

    private Map<Long, List<ImageResourceDTO>> optionImages(List<Long> optionIds) {
        if (optionIds.isEmpty()) {
            return Map.of();
        }
        List<Object[]> rows = em.createQuery("""
                SELECT img.opcion.id, img.id, img.numeroOrden, img.textoAlternativo, res.rutaAlmacenamiento
                FROM ImagenOpcion img
                JOIN img.recurso res
                WHERE img.opcion.id IN :optionIds
                ORDER BY img.opcion.id ASC, img.numeroOrden ASC
                """, Object[].class)
                .setParameter("optionIds", optionIds)
                .getResultList();
        Map<Long, List<ImageResourceDTO>> result = new LinkedHashMap<>();
        for (Object[] row : rows) {
            Long ownerId = (Long) row[0];
            result.computeIfAbsent(ownerId, ignored -> new ArrayList<>())
                    .add(new ImageResourceDTO((Long) row[1], (Integer) row[2], (String) row[3], (String) row[4],
                            null, null));
        }
        return result;
    }

    private Map<Long, List<SubtestCloneTemplateDTO.ImageTemplate>> cloneItemImages(List<Long> itemIds) {
        if (itemIds.isEmpty()) {
            return Map.of();
        }
        List<Object[]> rows = em.createQuery("""
                SELECT img.item.id, img.id, img.recurso.id, img.numeroOrden, img.textoAlternativo,
                       res.rutaAlmacenamiento, img.rolImagen,
                       res.nombreArchivo, res.tamanoBytes, res.hashIntegridad, res.claveSubida
                FROM ImagenItem img
                JOIN img.recurso res
                WHERE img.item.id IN :itemIds
                ORDER BY img.item.id ASC, img.numeroOrden ASC
                """, Object[].class)
                .setParameter("itemIds", itemIds)
                .getResultList();
        Map<Long, List<SubtestCloneTemplateDTO.ImageTemplate>> result = new LinkedHashMap<>();
        for (Object[] row : rows) {
            Long ownerId = (Long) row[0];
            result.computeIfAbsent(ownerId, ignored -> new ArrayList<>())
                    .add(new SubtestCloneTemplateDTO.ImageTemplate((Long) row[1], (Long) row[2],
                            (Integer) row[3], (String) row[4], (String) row[5], (String) row[6],
                            (String) row[7], (Long) row[8], (String) row[9], ImageUploadKeys.clientKey((String) row[10])));
        }
        return result;
    }

    private Map<Long, List<SubtestCloneTemplateDTO.ImageTemplate>> cloneOptionImages(List<Long> optionIds) {
        if (optionIds.isEmpty()) {
            return Map.of();
        }
        List<Object[]> rows = em.createQuery("""
                SELECT img.opcion.id, img.id, img.recurso.id, img.numeroOrden, img.textoAlternativo,
                       res.rutaAlmacenamiento,
                       res.nombreArchivo, res.tamanoBytes, res.hashIntegridad, res.claveSubida
                FROM ImagenOpcion img
                JOIN img.recurso res
                WHERE img.opcion.id IN :optionIds
                ORDER BY img.opcion.id ASC, img.numeroOrden ASC
                """, Object[].class)
                .setParameter("optionIds", optionIds)
                .getResultList();
        Map<Long, List<SubtestCloneTemplateDTO.ImageTemplate>> result = new LinkedHashMap<>();
        for (Object[] row : rows) {
            Long ownerId = (Long) row[0];
            result.computeIfAbsent(ownerId, ignored -> new ArrayList<>())
                    .add(new SubtestCloneTemplateDTO.ImageTemplate((Long) row[1], (Long) row[2],
                            (Integer) row[3], (String) row[4], (String) row[5], null,
                            (String) row[6], (Long) row[7], (String) row[8], ImageUploadKeys.clientKey((String) row[9])));
        }
        return result;
    }

    public record TestCommand(String code, String name, String description) {
    }

    public record VersionCommand(String number, Short strategyId, String instructions, Integer timeLimitSeconds,
            Boolean randomizeSubtests, Boolean randomizeItems) {
    }

    public record SubtestCommand(String code, String name, String description, String instructions, Integer order,
            Integer timeLimitSeconds, Boolean randomizeItems, Boolean randomizeOptions, Boolean required,
            Short strategyId) {
    }

    public record ItemCommand(String code, TipoItem itemType, TipoRespuesta responseType, String prompt,
            String instruction, Integer order, BigDecimal baseScore, Integer timeLimitSeconds, Boolean required,
            Boolean confidential) {
    }

    public record OptionCommand(String code, String text, Integer order, BigDecimal ordinalValue) {
    }

    public record ScoringRuleCommand(Short strategyId, TipoReglaCalificacion ruleType, Long itemId, Integer priority,
            String parametersJson, String observation) {
    }

    public record AnswerKeyCommand(Long ruleId, Long correctOptionId, String expectedText, BigDecimal expectedNumber,
            BigDecimal numericTolerance, BigDecimal score, Boolean requiresManualReview) {
    }

    public record BaremoCommand(Long versionId, Long dimensionId, String code, String name, String description,
            String normativeGroup) {
    }

    public record BaremoRangeCommand(BigDecimal minScore, BigDecimal maxScore, BigDecimal percentile, String category,
            String interpretation, String recommendation, Integer order) {
    }

    /** Documento de configuracion de una version: la version y sus subtests con la forma de clone-template. */
    public record VersionConfiguration(VersionTest version, List<SubtestCloneTemplateDTO> subtests) {
    }

    private record ItemGraph(Map<Long, List<OpcionItem>> optionsByItem,
            Map<Long, List<SubtestCloneTemplateDTO.ImageTemplate>> itemImagesByItem,
            Map<Long, List<SubtestCloneTemplateDTO.ImageTemplate>> optionImagesByOption,
            Map<Long, ClaveRespuesta> keysByItem) {
    }

    private record PendingAnswerKey(Item item, VersionConfigurationRequest.AnswerKeyDraft draft) {
    }
}

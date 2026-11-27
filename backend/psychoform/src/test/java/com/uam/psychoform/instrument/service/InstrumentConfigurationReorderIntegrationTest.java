package com.uam.psychoform.instrument.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.uam.psychoform.PsychoformApplication;
import com.uam.psychoform.instrument.dto.VersionConfigurationRequest;
import com.uam.psychoform.instrument.dto.VersionConfigurationRequest.DraftStatus;
import com.uam.psychoform.instrument.dto.VersionConfigurationRequest.ItemDraft;
import com.uam.psychoform.instrument.dto.VersionConfigurationRequest.OptionDraft;
import com.uam.psychoform.instrument.dto.VersionConfigurationRequest.SubtestDraft;
import com.uam.psychoform.instrument.model.TipoItem;
import com.uam.psychoform.instrument.model.TipoRespuesta;
import com.uam.psychoform.security.service.JwtService;
import java.math.BigDecimal;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(classes = PsychoformApplication.class)
@AutoConfigureMockMvc
class InstrumentConfigurationReorderIntegrationTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    @Autowired
    MockMvc mvc;

    @Autowired
    JwtService jwt;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    PlatformTransactionManager txManager;

    private Scenario scenario;

    private record Scenario(long testId, long versionId, List<Long> subtestIds, List<Long> itemIds,
            List<Long> optionIds) {
    }

    @AfterEach
    void cleanup() {
        if (scenario == null) {
            return;
        }
        Scenario s = scenario;
        new TransactionTemplate(txManager).executeWithoutResult(status -> {
            jdbc.update("delete from opcion_item where item_id in (select item_id from item where subtest_id in "
                    + "(select subtest_id from subtest where version_test_id = ?))", s.versionId());
            jdbc.update("delete from item where subtest_id in (select subtest_id from subtest where version_test_id = ?)",
                    s.versionId());
            jdbc.update("delete from subtest where version_test_id = ?", s.versionId());
            jdbc.update("delete from version_test where version_test_id = ?", s.versionId());
            jdbc.update("delete from test where test_id = ?", s.testId());
        });
    }

    @Test
    void swapTwoSubtestsTwoItemsAndTwoOptionsInOneRequestReturns200AndFinalOrder() throws Exception {
        scenario = seed(2, 2, 2);

        OptionDraft opt1 = updatedOption(scenario.optionIds().get(0), "OPT-1", 2);
        OptionDraft opt2 = updatedOption(scenario.optionIds().get(1), "OPT-2", 1);
        ItemDraft item1 = updatedItem(scenario.itemIds().get(0), "IT-1", 2, List.of(opt1, opt2));
        ItemDraft item2 = updatedItem(scenario.itemIds().get(1), "IT-2", 1, List.of());
        SubtestDraft sub1 = updatedSubtest(scenario.subtestIds().get(0), "SUB-1", 2, List.of(item1, item2));
        SubtestDraft sub2 = updatedSubtest(scenario.subtestIds().get(1), "SUB-2", 1, List.of());

        mvc.perform(post("/test-versions/{id}/configuration", scenario.versionId())
                .header("Authorization", bearer())
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(new VersionConfigurationRequest(List.of(sub1, sub2)))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true));

        assertThat(subtestOrder(scenario.subtestIds().get(0))).isEqualTo(2);
        assertThat(subtestOrder(scenario.subtestIds().get(1))).isEqualTo(1);
        assertThat(itemOrder(scenario.itemIds().get(0))).isEqualTo(2);
        assertThat(itemOrder(scenario.itemIds().get(1))).isEqualTo(1);
        assertThat(optionOrder(scenario.optionIds().get(0))).isEqualTo(2);
        assertThat(optionOrder(scenario.optionIds().get(1))).isEqualTo(1);
    }

    @Test
    void rotateThreeSubtestsThreeItemsAndThreeOptionsReturns200AndFinalOrder() throws Exception {
        scenario = seed(3, 3, 3);

        List<OptionDraft> rotatedOptions = List.of(
                updatedOption(scenario.optionIds().get(0), "OPT-1", 2),
                updatedOption(scenario.optionIds().get(1), "OPT-2", 3),
                updatedOption(scenario.optionIds().get(2), "OPT-3", 1));
        List<ItemDraft> rotatedItems = List.of(
                updatedItem(scenario.itemIds().get(0), "IT-1", 2, rotatedOptions),
                updatedItem(scenario.itemIds().get(1), "IT-2", 3, List.of()),
                updatedItem(scenario.itemIds().get(2), "IT-3", 1, List.of()));
        List<SubtestDraft> rotatedSubtests = List.of(
                updatedSubtest(scenario.subtestIds().get(0), "SUB-1", 2, rotatedItems),
                updatedSubtest(scenario.subtestIds().get(1), "SUB-2", 3, List.of()),
                updatedSubtest(scenario.subtestIds().get(2), "SUB-3", 1, List.of()));

        mvc.perform(post("/test-versions/{id}/configuration", scenario.versionId())
                .header("Authorization", bearer())
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(new VersionConfigurationRequest(rotatedSubtests))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true));

        assertThat(subtestOrder(scenario.subtestIds().get(0))).isEqualTo(2);
        assertThat(subtestOrder(scenario.subtestIds().get(1))).isEqualTo(3);
        assertThat(subtestOrder(scenario.subtestIds().get(2))).isEqualTo(1);
        assertThat(itemOrder(scenario.itemIds().get(0))).isEqualTo(2);
        assertThat(itemOrder(scenario.itemIds().get(1))).isEqualTo(3);
        assertThat(itemOrder(scenario.itemIds().get(2))).isEqualTo(1);
        assertThat(optionOrder(scenario.optionIds().get(0))).isEqualTo(2);
        assertThat(optionOrder(scenario.optionIds().get(1))).isEqualTo(3);
        assertThat(optionOrder(scenario.optionIds().get(2))).isEqualTo(1);
    }

    @Test
    void duplicateFinalOrderReturns400AndLeavesDatabaseUnchanged() throws Exception {
        scenario = seed(2, 2, 2);

        SubtestDraft sub1 = updatedSubtest(scenario.subtestIds().get(0), "SUB-1", 2, List.of());
        SubtestDraft sub2 = updatedSubtest(scenario.subtestIds().get(1), "SUB-2", 2, List.of());

        mvc.perform(post("/test-versions/{id}/configuration", scenario.versionId())
                .header("Authorization", bearer())
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(new VersionConfigurationRequest(List.of(sub1, sub2)))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error.code").value("BAD_REQUEST"));

        assertThat(subtestOrder(scenario.subtestIds().get(0))).isEqualTo(1);
        assertThat(subtestOrder(scenario.subtestIds().get(1))).isEqualTo(2);
    }

    @Test
    void partialUpdateCollidingAtCommitReturns409AndRollsBack() throws Exception {
        scenario = seed(2, 2, 0);

        ItemDraft item1CollidingWithItem2 = updatedItem(scenario.itemIds().get(0), "IT-1", 2, List.of());
        SubtestDraft sub1 = updatedSubtest(scenario.subtestIds().get(0), "SUB-1", 5,
                List.of(item1CollidingWithItem2));

        mvc.perform(post("/test-versions/{id}/configuration", scenario.versionId())
                .header("Authorization", bearer())
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(new VersionConfigurationRequest(List.of(sub1)))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error.code").value("CONFLICT"));

        assertThat(subtestOrder(scenario.subtestIds().get(0))).isEqualTo(1);
        assertThat(itemOrder(scenario.itemIds().get(0))).isEqualTo(1);
        assertThat(itemOrder(scenario.itemIds().get(1))).isEqualTo(2);
    }

    @Test
    void midTransactionFailureRollsBackAllOrderChanges() throws Exception {
        scenario = seed(2, 2, 0);

        SubtestDraft sub1 = updatedSubtest(scenario.subtestIds().get(0), "SUB-1", 2, List.of());
        ItemDraft missingItem = updatedItem(999_999_999L, "IT-MISSING", 1, List.of());
        SubtestDraft sub2 = updatedSubtest(scenario.subtestIds().get(1), "SUB-2", 1, List.of(missingItem));

        mvc.perform(post("/test-versions/{id}/configuration", scenario.versionId())
                .header("Authorization", bearer())
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(new VersionConfigurationRequest(List.of(sub1, sub2)))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error.code").value("NOT_FOUND"));

        assertThat(subtestOrder(scenario.subtestIds().get(0))).isEqualTo(1);
        assertThat(subtestOrder(scenario.subtestIds().get(1))).isEqualTo(2);
    }

    @Test
    void deleteOptionAndRecreateSameCodeAtDifferentOrderReturns200WithSingleLiveOption() throws Exception {
        scenario = seed(1, 1, 3);

        OptionDraft opt1 = optionDraft(scenario.optionIds().get(0), DraftStatus.EXISTING, "OPT-1", 1);
        OptionDraft opt2 = optionDraft(scenario.optionIds().get(1), DraftStatus.EXISTING, "OPT-2", 2);
        OptionDraft deletedOpt3 = optionDraft(scenario.optionIds().get(2), DraftStatus.DELETED, "OPT-3", 3);
        OptionDraft recreatedOpt3 = optionDraft(null, DraftStatus.CREATED, "OPT-3", 5);
        ItemDraft item1 = updatedItem(scenario.itemIds().get(0), "IT-1", 1,
                List.of(opt1, opt2, deletedOpt3, recreatedOpt3));
        SubtestDraft sub1 = updatedSubtest(scenario.subtestIds().get(0), "SUB-1", 1, List.of(item1));

        mvc.perform(post("/test-versions/{id}/configuration", scenario.versionId())
                .header("Authorization", bearer())
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(new VersionConfigurationRequest(List.of(sub1)))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true));

        List<Long> matchingIds = jdbc.queryForList(
                "select opcion_id from opcion_item where item_id = ? and codigo_opcion = ?",
                Long.class, scenario.itemIds().get(0), "OPT-3");
        assertThat(matchingIds).hasSize(1);
        assertThat(matchingIds.getFirst()).isNotEqualTo(scenario.optionIds().get(2));
        assertThat(optionOrder(matchingIds.getFirst())).isEqualTo(5);
    }

    @Test
    void deleteItemAndRecreateSameCodeAtDifferentOrderReturns200WithSingleLiveItem() throws Exception {
        scenario = seed(1, 2, 0);

        ItemDraft item1 = itemDraft(scenario.itemIds().get(0), DraftStatus.EXISTING, "IT-1", 1, List.of());
        ItemDraft deletedItem2 = itemDraft(scenario.itemIds().get(1), DraftStatus.DELETED, "IT-2", 2, List.of());
        ItemDraft recreatedItem2 = itemDraft(null, DraftStatus.CREATED, "IT-2", 5, List.of());
        SubtestDraft sub1 = updatedSubtest(scenario.subtestIds().get(0), "SUB-1", 1,
                List.of(item1, deletedItem2, recreatedItem2));

        mvc.perform(post("/test-versions/{id}/configuration", scenario.versionId())
                .header("Authorization", bearer())
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(new VersionConfigurationRequest(List.of(sub1)))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true));

        List<Long> matchingIds = jdbc.queryForList(
                "select item_id from item where subtest_id = ? and codigo_item = ?",
                Long.class, scenario.subtestIds().get(0), "IT-2");
        assertThat(matchingIds).hasSize(1);
        assertThat(matchingIds.getFirst()).isNotEqualTo(scenario.itemIds().get(1));
        assertThat(itemOrder(matchingIds.getFirst())).isEqualTo(5);
    }

    @Test
    void deleteSubtestAndRecreateSameCodeAtDifferentOrderReturns200WithSingleLiveSubtest() throws Exception {
        scenario = seed(2, 0, 0);

        SubtestDraft sub1 = subtestDraft(scenario.subtestIds().get(0), DraftStatus.EXISTING, "SUB-1", 1, List.of());
        SubtestDraft deletedSub2 = subtestDraft(scenario.subtestIds().get(1), DraftStatus.DELETED, "SUB-2", 2, List.of());
        SubtestDraft recreatedSub2 = subtestDraft(null, DraftStatus.CREATED, "SUB-2", 5, List.of());

        mvc.perform(post("/test-versions/{id}/configuration", scenario.versionId())
                .header("Authorization", bearer())
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(new VersionConfigurationRequest(List.of(sub1, deletedSub2, recreatedSub2)))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true));

        List<Long> matchingIds = jdbc.queryForList(
                "select subtest_id from subtest where version_test_id = ? and codigo_subtest = ?",
                Long.class, scenario.versionId(), "SUB-2");
        assertThat(matchingIds).hasSize(1);
        assertThat(matchingIds.getFirst()).isNotEqualTo(scenario.subtestIds().get(1));
        assertThat(subtestOrder(matchingIds.getFirst())).isEqualTo(5);
    }

    @Test
    void duplicateOptionCodeAtCommitReturns409AndRollsBack() throws Exception {
        scenario = seed(1, 1, 2);

        OptionDraft duplicateOpt2 = optionDraft(null, DraftStatus.CREATED, "OPT-2", 5);
        ItemDraft item1 = updatedItem(scenario.itemIds().get(0), "IT-1", 1, List.of(duplicateOpt2));
        SubtestDraft sub1 = updatedSubtest(scenario.subtestIds().get(0), "SUB-1", 1, List.of(item1));

        mvc.perform(post("/test-versions/{id}/configuration", scenario.versionId())
                .header("Authorization", bearer())
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(new VersionConfigurationRequest(List.of(sub1)))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error.code").value("CONFLICT"));

        Integer totalOptions = jdbc.queryForObject(
                "select count(*) from opcion_item where item_id = ?",
                Integer.class, scenario.itemIds().get(0));
        Integer opt2Count = jdbc.queryForObject(
                "select count(*) from opcion_item where item_id = ? and codigo_opcion = ?",
                Integer.class, scenario.itemIds().get(0), "OPT-2");
        assertThat(totalOptions).isEqualTo(2);
        assertThat(opt2Count).isEqualTo(1);
    }

    @Test
    void duplicateItemCodeAtCommitReturns409AndRollsBack() throws Exception {
        scenario = seed(1, 2, 0);

        ItemDraft duplicateItem2 = itemDraft(null, DraftStatus.CREATED, "IT-2", 5, List.of());
        SubtestDraft sub1 = updatedSubtest(scenario.subtestIds().get(0), "SUB-1", 1, List.of(duplicateItem2));

        mvc.perform(post("/test-versions/{id}/configuration", scenario.versionId())
                .header("Authorization", bearer())
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(new VersionConfigurationRequest(List.of(sub1)))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error.code").value("CONFLICT"));

        Integer totalItems = jdbc.queryForObject(
                "select count(*) from item where subtest_id = ?",
                Integer.class, scenario.subtestIds().get(0));
        Integer item2Count = jdbc.queryForObject(
                "select count(*) from item where subtest_id = ? and codigo_item = ?",
                Integer.class, scenario.subtestIds().get(0), "IT-2");
        assertThat(totalItems).isEqualTo(2);
        assertThat(item2Count).isEqualTo(1);
    }

    private Scenario seed(int subtestCount, int itemCountInFirstSubtest, int optionCountInFirstItem) {
        return new TransactionTemplate(txManager).execute(status -> {
            String suffix = UUID.randomUUID().toString().substring(0, 8);
            long testId = id("insert into test (codigo_test, nombre_test) values (?, ?) returning test_id",
                    "TST-" + suffix, "Test " + suffix);
            long versionId = id(
                    "insert into version_test (test_id, numero_version, estado) values (?, '1.0', 'BORRADOR') "
                            + "returning version_test_id",
                    testId);
            List<Long> subtestIds = new java.util.ArrayList<>();
            for (int i = 1; i <= subtestCount; i++) {
                long subtestId = id(
                        "insert into subtest (version_test_id, codigo_subtest, nombre_subtest, numero_orden) "
                                + "values (?, ?, ?, ?) returning subtest_id",
                        versionId, "SUB-" + i, "Subtest " + i, i);
                subtestIds.add(subtestId);
            }
            List<Long> itemIds = new java.util.ArrayList<>();
            for (int i = 1; i <= itemCountInFirstSubtest; i++) {
                long itemId = id(
                        "insert into item (subtest_id, codigo_item, tipo_item, tipo_respuesta, enunciado, numero_orden) "
                                + "values (?, ?, 'SOLO_TEXTO', 'OPCION_UNICA', ?, ?) returning item_id",
                        subtestIds.getFirst(), "IT-" + i, "Pregunta " + i, i);
                itemIds.add(itemId);
            }
            List<Long> optionIds = new java.util.ArrayList<>();
            for (int i = 1; i <= optionCountInFirstItem; i++) {
                long optionId = id(
                        "insert into opcion_item (item_id, codigo_opcion, texto_opcion, numero_orden) "
                                + "values (?, ?, ?, ?) returning opcion_id",
                        itemIds.getFirst(), "OPT-" + i, "Opcion " + i, i);
                optionIds.add(optionId);
            }
            return new Scenario(testId, versionId, subtestIds, itemIds, optionIds);
        });
    }

    private long id(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }

    private Integer subtestOrder(long subtestId) {
        return jdbc.queryForObject("select numero_orden from subtest where subtest_id = ?", Integer.class, subtestId);
    }

    private Integer itemOrder(long itemId) {
        return jdbc.queryForObject("select numero_orden from item where item_id = ?", Integer.class, itemId);
    }

    private Integer optionOrder(long optionId) {
        return jdbc.queryForObject("select numero_orden from opcion_item where opcion_id = ?", Integer.class, optionId);
    }

    private String bearer() {
        return "Bearer " + jwt.emitir(UUID.randomUUID(), "editor", Set.of("TEST_CREAR"), Set.of("ADMINISTRADOR"));
    }

    private static SubtestDraft updatedSubtest(long id, String code, int order, List<ItemDraft> items) {
        return subtestDraft(id, DraftStatus.UPDATED, code, order, items);
    }

    private static ItemDraft updatedItem(long id, String code, int order, List<OptionDraft> options) {
        return itemDraft(id, DraftStatus.UPDATED, code, order, options);
    }

    private static OptionDraft updatedOption(long id, String code, int order) {
        return optionDraft(id, DraftStatus.UPDATED, code, order);
    }

    private static SubtestDraft subtestDraft(Long id, DraftStatus status, String code, int order,
            List<ItemDraft> items) {
        String draftId = id == null ? "sub-new-" + code : "sub-" + id;
        return new SubtestDraft(id, draftId, null, status, code, "Subtest " + code,
                null, null, order, null, false, false, true, null, items);
    }

    private static ItemDraft itemDraft(Long id, DraftStatus status, String code, int order,
            List<OptionDraft> options) {
        String draftId = id == null ? "item-new-" + code : "item-" + id;
        return new ItemDraft(id, draftId, null, status, code, TipoItem.SOLO_TEXTO,
                TipoRespuesta.OPCION_UNICA, "Pregunta " + code, null, order, BigDecimal.ONE, null, true, true,
                List.of(), options, null);
    }

    private static OptionDraft optionDraft(Long id, DraftStatus status, String code, int order) {
        String draftId = id == null ? "opt-new-" + code : "opt-" + id;
        return new OptionDraft(id, draftId, null, status, code, "Opcion " + code,
                order, BigDecimal.ONE, List.of());
    }
}

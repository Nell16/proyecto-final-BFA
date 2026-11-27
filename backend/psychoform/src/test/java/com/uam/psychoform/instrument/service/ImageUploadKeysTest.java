package com.uam.psychoform.instrument.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.UUID;
import org.junit.jupiter.api.Test;

class ImageUploadKeysTest {
    private static final UUID USER = UUID.fromString("11111111-1111-1111-1111-111111111111");

    @Test
    void aceptaUuidYClavesDeHasta64CaracteresValidos() {
        String uuid = UUID.randomUUID().toString();

        assertThat(ImageUploadKeys.normalize(uuid)).isEqualTo(uuid);
        assertThat(ImageUploadKeys.normalize("  abc_DEF-123  ")).isEqualTo("abc_DEF-123");
        assertThat(ImageUploadKeys.normalize("k".repeat(64))).hasSize(64);
    }

    @Test
    void claveAusenteEsNula() {
        assertThat(ImageUploadKeys.normalize(null)).isNull();
    }

    @Test
    void claveVaciaOSoloEspaciosEsInvalida() {
        for (String blank : new String[] { "", " ", "   ", "\t" }) {
            assertThatThrownBy(() -> ImageUploadKeys.normalize(blank))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("Idempotency-Key");
        }
    }

    @Test
    void rechazaClavesLargasOConCaracteresNoPermitidos() {
        for (String invalid : new String[] { "k".repeat(65), "con espacio", "con.punto", "con:dos-puntos", "ñandú",
                "a/b" }) {
            assertThatThrownBy(() -> ImageUploadKeys.normalize(invalid))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("Idempotency-Key");
        }
    }

    @Test
    void elValorGuardadoIncluyeUsuarioYOperacionYCabeEnVarchar128() {
        String longest = ImageUploadKeys.scoped(USER, ImageUploadKeys.Operation.REPLACE_OPTION, "k".repeat(64));

        assertThat(longest).startsWith(USER + ":REPLACE_OPTION:");
        assertThat(longest.length()).isLessThanOrEqualTo(128);
        assertThat(ImageUploadKeys.scoped(USER, ImageUploadKeys.Operation.ITEM, null)).isNull();
    }

    @Test
    void ambitosDistintosProducenValoresDistintos() {
        UUID other = UUID.fromString("22222222-2222-2222-2222-222222222222");

        assertThat(ImageUploadKeys.scoped(USER, ImageUploadKeys.Operation.ITEM, "k"))
                .isNotEqualTo(ImageUploadKeys.scoped(other, ImageUploadKeys.Operation.ITEM, "k"))
                .isNotEqualTo(ImageUploadKeys.scoped(USER, ImageUploadKeys.Operation.LOOSE, "k"));
    }

    @Test
    void clientKeyRecuperaLaClaveOriginalYDejaIntactosLosValoresSinAmbito() {
        String stored = ImageUploadKeys.scoped(USER, ImageUploadKeys.Operation.OPTION, "mi-clave_1");

        assertThat(ImageUploadKeys.clientKey(stored)).isEqualTo("mi-clave_1");
        assertThat(ImageUploadKeys.clientKey("sin-ambito")).isEqualTo("sin-ambito");
        assertThat(ImageUploadKeys.clientKey(null)).isNull();
    }
}

-- PsychoForm | Reconstrucción del esquema y datos iniciales
-- Ejecutar en una base PostgreSQL vacía con permisos para crear extensiones en public.
-- Incluye las migraciones del repositorio en orden. No restaura datos de una instalación previa.
-- Origen: supabase/migrations y supabase/seed.sql.

BEGIN;
SET LOCAL search_path TO public;

-- migrations/20260621000100_create_bfa_schema.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ============================================================
-- Limpieza destructiva omitida: esta es una migracion inicial no repetible.

-- ============================================================
-- TIPOS Y CATALOGOS DE ESTADO
-- ============================================================

CREATE TYPE estado_general AS ENUM ('ACTIVO', 'INACTIVO');

CREATE TYPE estado_configuracion AS ENUM (
    'BORRADOR',
    'EN_REVISION',
    'APROBADO',
    'PUBLICADO',
    'RETIRADO'
);

CREATE TYPE estado_version_test AS ENUM (
    'BORRADOR',
    'EN_REVISION',
    'APROBADO',
    'PUBLICADO',
    'RETIRADO'
);

CREATE TYPE tipo_item AS ENUM (
    'SOLO_TEXTO',
    'SOLO_IMAGEN',
    'TEXTO_E_IMAGEN',
    'COMPARACION_IMAGENES',
    'RAZONAMIENTO_VERBAL'
);

CREATE TYPE tipo_respuesta AS ENUM (
    'OPCION_UNICA',
    'OPCION_MULTIPLE',
    'TEXTO_ABIERTO',
    'NUMERICA',
    'VERDADERO_FALSO'
);

CREATE TYPE estado_sesion_aplicacion AS ENUM (
    'PROGRAMADA',
    'ABIERTA',
    'CERRADA',
    'CANCELADA'
);

CREATE TYPE estado_asignacion AS ENUM (
    'ASIGNADO',
    'EN_PROGRESO',
    'COMPLETADO',
    'ANULADO',
    'EXPIRADO'
);

CREATE TYPE estado_intento AS ENUM (
    'NO_INICIADO',
    'EN_PROGRESO',
    'COMPLETADO',
    'INTERRUMPIDO',
    'ANULADO'
);

CREATE TYPE tipo_recurso AS ENUM (
    'IMAGEN',
    'DOCUMENTO',
    'OTRO'
);

CREATE TYPE formato_reporte AS ENUM (
    'PDF',
    'XLSX',
    'CSV'
);

CREATE TYPE tipo_estrategia_calificacion AS ENUM (
    'CLAVE_SIMPLE',
    'MATRIZ_DIMENSIONAL',
    'LIKERT_ESCALA',
    'RESPUESTA_NUMERICA',
    'REVISION_MANUAL',
    'RUBRICA_MANUAL',
    'FORMULA_CONTROLADA'
);

CREATE TYPE tipo_regla_calificacion AS ENUM (
    'CLAVE_ITEM',
    'OPCION_DIMENSION',
    'LIKERT',
    'NUMERICA_RANGO',
    'REVISION_MANUAL',
    'RUBRICA',
    'FORMULA'
);

CREATE TYPE estado_revision_manual AS ENUM (
    'PENDIENTE',
    'EN_REVISION',
    'REVISADO',
    'OBSERVADO',
    'ANULADO'
);

-- ============================================================
-- SEGURIDAD
-- ============================================================

CREATE TABLE usuario (
    usuario_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre_usuario VARCHAR(80) NOT NULL UNIQUE,
    correo VARCHAR(150) NOT NULL UNIQUE,
    hash_contrasena VARCHAR(255) NOT NULL,
    nombre_completo VARCHAR(150) NOT NULL,
    estado estado_general NOT NULL DEFAULT 'ACTIVO',
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE rol (
    rol_id SMALLSERIAL PRIMARY KEY,
    nombre_rol VARCHAR(60) NOT NULL UNIQUE,
    descripcion VARCHAR(255)
);

CREATE TABLE permiso (
    permiso_id SMALLSERIAL PRIMARY KEY,
    codigo_permiso VARCHAR(80) NOT NULL UNIQUE,
    descripcion VARCHAR(255)
);

CREATE TABLE usuario_rol (
    usuario_id UUID NOT NULL REFERENCES usuario(usuario_id) ON DELETE CASCADE,
    rol_id SMALLINT NOT NULL REFERENCES rol(rol_id) ON DELETE CASCADE,
    PRIMARY KEY (usuario_id, rol_id)
);

CREATE TABLE rol_permiso (
    rol_id SMALLINT NOT NULL REFERENCES rol(rol_id) ON DELETE CASCADE,
    permiso_id SMALLINT NOT NULL REFERENCES permiso(permiso_id) ON DELETE CASCADE,
    PRIMARY KEY (rol_id, permiso_id)
);

-- ============================================================
-- CATALOGOS ACADEMICOS Y DEMOGRAFICOS
-- ============================================================

CREATE TABLE catalogo_sexo (
    sexo_id SMALLSERIAL PRIMARY KEY,
    codigo VARCHAR(20) NOT NULL UNIQUE,
    nombre VARCHAR(80) NOT NULL,
    estado estado_general NOT NULL DEFAULT 'ACTIVO'
);

CREATE TABLE carrera (
    carrera_id SMALLSERIAL PRIMARY KEY,
    codigo_carrera VARCHAR(30) NOT NULL UNIQUE,
    nombre_carrera VARCHAR(150) NOT NULL,
    estado estado_general NOT NULL DEFAULT 'ACTIVO'
);

CREATE TABLE cohorte (
    cohorte_id SMALLSERIAL PRIMARY KEY,
    codigo_cohorte VARCHAR(30) NOT NULL UNIQUE,
    nombre_cohorte VARCHAR(100) NOT NULL,
    anio SMALLINT CHECK (anio IS NULL OR anio BETWEEN 1900 AND 2100),
    periodo VARCHAR(30),
    estado estado_general NOT NULL DEFAULT 'ACTIVO'
);

CREATE TABLE grupo_academico (
    grupo_academico_id SMALLSERIAL PRIMARY KEY,
    carrera_id SMALLINT REFERENCES carrera(carrera_id) ON DELETE RESTRICT,
    codigo_grupo VARCHAR(50) NOT NULL,
    nombre_grupo VARCHAR(100),
    estado estado_general NOT NULL DEFAULT 'ACTIVO',
    UNIQUE (carrera_id, codigo_grupo)
);

-- ============================================================
-- PARTICIPANTES
-- ============================================================

CREATE TABLE participante (
    participante_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo_participante VARCHAR(80) NOT NULL UNIQUE,
    nombres VARCHAR(100) NOT NULL,
    apellidos VARCHAR(100) NOT NULL,
    fecha_nacimiento DATE,
    sexo_id SMALLINT REFERENCES catalogo_sexo(sexo_id) ON DELETE RESTRICT,
    carrera_id SMALLINT REFERENCES carrera(carrera_id) ON DELETE RESTRICT,
    cohorte_id SMALLINT REFERENCES cohorte(cohorte_id) ON DELETE RESTRICT,
    grupo_academico_id SMALLINT REFERENCES grupo_academico(grupo_academico_id) ON DELETE RESTRICT,
    estado estado_general NOT NULL DEFAULT 'ACTIVO',
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- ESTRATEGIAS DE CALIFICACION
-- ============================================================

CREATE TABLE estrategia_calificacion (
    estrategia_calificacion_id SMALLSERIAL PRIMARY KEY,
    codigo VARCHAR(60) NOT NULL UNIQUE,
    nombre VARCHAR(120) NOT NULL,
    descripcion TEXT,
    tipo_estrategia tipo_estrategia_calificacion NOT NULL,
    activa BOOLEAN NOT NULL DEFAULT TRUE,
    requiere_revision_manual BOOLEAN NOT NULL DEFAULT FALSE,
    permite_baremo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_estrategia_tipo_codigo UNIQUE (tipo_estrategia, codigo)
);

-- ============================================================
-- TESTS, VERSIONES, SUBTESTS, DIMENSIONES E ITEMS
-- ============================================================

CREATE TABLE test (
    test_id BIGSERIAL PRIMARY KEY,
    codigo_test VARCHAR(50) NOT NULL UNIQUE,
    nombre_test VARCHAR(150) NOT NULL,
    descripcion TEXT,
    creado_por UUID REFERENCES usuario(usuario_id),
    estado estado_general NOT NULL DEFAULT 'ACTIVO',
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE version_test (
    version_test_id BIGSERIAL PRIMARY KEY,
    test_id BIGINT NOT NULL REFERENCES test(test_id) ON DELETE CASCADE,
    estrategia_calificacion_id SMALLINT REFERENCES estrategia_calificacion(estrategia_calificacion_id) ON DELETE RESTRICT,
    numero_version VARCHAR(30) NOT NULL,
    estado estado_version_test NOT NULL DEFAULT 'BORRADOR',
    instrucciones_generales TEXT,
    tiempo_limite_segundos INT CHECK (tiempo_limite_segundos IS NULL OR tiempo_limite_segundos > 0),
    permite_aleatorizar_subtests BOOLEAN NOT NULL DEFAULT FALSE,
    permite_aleatorizar_items BOOLEAN NOT NULL DEFAULT FALSE,
    aprobado_por UUID REFERENCES usuario(usuario_id),
    aprobado_en TIMESTAMP,
    publicado_en TIMESTAMP,
    creado_por UUID REFERENCES usuario(usuario_id),
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (test_id, numero_version),
    CONSTRAINT ck_version_aprobacion CHECK (
        estado NOT IN ('APROBADO', 'PUBLICADO')
        OR (aprobado_por IS NOT NULL AND aprobado_en IS NOT NULL)
    ),
    CONSTRAINT ck_version_publicacion CHECK (
        estado <> 'PUBLICADO'
        OR (publicado_en IS NOT NULL AND estrategia_calificacion_id IS NOT NULL)
    )
);

CREATE TABLE subtest (
    subtest_id BIGSERIAL PRIMARY KEY,
    version_test_id BIGINT NOT NULL REFERENCES version_test(version_test_id) ON DELETE CASCADE,
    estrategia_calificacion_id SMALLINT REFERENCES estrategia_calificacion(estrategia_calificacion_id) ON DELETE RESTRICT,
    codigo_subtest VARCHAR(50) NOT NULL,
    nombre_subtest VARCHAR(150) NOT NULL,
    descripcion TEXT,
    instrucciones TEXT,
    numero_orden INT NOT NULL,
    tiempo_limite_segundos INT CHECK (tiempo_limite_segundos IS NULL OR tiempo_limite_segundos > 0),
    permite_aleatorizar_items BOOLEAN NOT NULL DEFAULT FALSE,
    permite_aleatorizar_opciones BOOLEAN NOT NULL DEFAULT FALSE,
    es_obligatorio BOOLEAN NOT NULL DEFAULT TRUE,
    estado estado_general NOT NULL DEFAULT 'ACTIVO',
    UNIQUE (version_test_id, codigo_subtest),
    UNIQUE (version_test_id, numero_orden),
    UNIQUE (version_test_id, subtest_id)
);

CREATE TABLE dimension_resultado (
    dimension_resultado_id BIGSERIAL PRIMARY KEY,
    version_test_id BIGINT NOT NULL REFERENCES version_test(version_test_id) ON DELETE CASCADE,
    subtest_id BIGINT,
    codigo_dimension VARCHAR(60) NOT NULL,
    nombre_dimension VARCHAR(150) NOT NULL,
    descripcion TEXT,
    orden_presentacion INT NOT NULL,
    puntaje_minimo DECIMAL(10,2),
    puntaje_maximo DECIMAL(10,2),
    activa BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (version_test_id, codigo_dimension),
    UNIQUE (version_test_id, orden_presentacion),
    UNIQUE (version_test_id, dimension_resultado_id),
    FOREIGN KEY (version_test_id, subtest_id)
        REFERENCES subtest(version_test_id, subtest_id) ON DELETE CASCADE,
    CONSTRAINT ck_dimension_rango CHECK (
        puntaje_minimo IS NULL
        OR puntaje_maximo IS NULL
        OR puntaje_minimo <= puntaje_maximo
    )
);

CREATE TABLE item (
    item_id BIGSERIAL PRIMARY KEY,
    subtest_id BIGINT NOT NULL REFERENCES subtest(subtest_id) ON DELETE CASCADE,
    codigo_item VARCHAR(80) NOT NULL,
    tipo_item tipo_item NOT NULL,
    tipo_respuesta tipo_respuesta NOT NULL,
    enunciado TEXT,
    instruccion TEXT,
    numero_orden INT NOT NULL,
    puntaje_base DECIMAL(8,2) NOT NULL DEFAULT 1.00 CHECK (puntaje_base >= 0),
    tiempo_limite_segundos INT CHECK (tiempo_limite_segundos IS NULL OR tiempo_limite_segundos > 0),
    es_obligatorio BOOLEAN NOT NULL DEFAULT TRUE,
    es_confidencial BOOLEAN NOT NULL DEFAULT TRUE,
    estado estado_general NOT NULL DEFAULT 'ACTIVO',
    UNIQUE (subtest_id, codigo_item),
    UNIQUE (subtest_id, numero_orden),
    UNIQUE (subtest_id, item_id)
);

-- ============================================================
-- RECURSOS MULTIMEDIA
-- ============================================================

CREATE TABLE recurso_multimedia (
    recurso_id BIGSERIAL PRIMARY KEY,
    tipo_recurso tipo_recurso NOT NULL DEFAULT 'IMAGEN',
    nombre_archivo VARCHAR(255) NOT NULL,
    ruta_almacenamiento TEXT NOT NULL,
    tipo_mime VARCHAR(100) NOT NULL,
    tamano_bytes BIGINT CHECK (tamano_bytes IS NULL OR tamano_bytes >= 0),
    hash_integridad VARCHAR(128),
    es_confidencial BOOLEAN NOT NULL DEFAULT TRUE,
    requiere_autorizacion BOOLEAN NOT NULL DEFAULT TRUE,
    subido_por UUID REFERENCES usuario(usuario_id),
    subido_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE imagen_item (
    imagen_item_id BIGSERIAL PRIMARY KEY,
    item_id BIGINT NOT NULL REFERENCES item(item_id) ON DELETE CASCADE,
    recurso_id BIGINT NOT NULL REFERENCES recurso_multimedia(recurso_id) ON DELETE RESTRICT,
    rol_imagen VARCHAR(50) NOT NULL DEFAULT 'ENUNCIADO',
    numero_orden INT NOT NULL DEFAULT 1,
    texto_alternativo VARCHAR(255),
    UNIQUE (item_id, recurso_id),
    UNIQUE (item_id, numero_orden)
);

CREATE TABLE opcion_item (
    opcion_id BIGSERIAL PRIMARY KEY,
    item_id BIGINT NOT NULL REFERENCES item(item_id) ON DELETE CASCADE,
    codigo_opcion VARCHAR(50) NOT NULL,
    texto_opcion TEXT,
    numero_orden INT NOT NULL,
    valor_ordinal DECIMAL(8,2),
    estado estado_general NOT NULL DEFAULT 'ACTIVO',
    UNIQUE (item_id, codigo_opcion),
    UNIQUE (item_id, numero_orden),
    UNIQUE (item_id, opcion_id)
);

CREATE TABLE imagen_opcion (
    imagen_opcion_id BIGSERIAL PRIMARY KEY,
    opcion_id BIGINT NOT NULL REFERENCES opcion_item(opcion_id) ON DELETE CASCADE,
    recurso_id BIGINT NOT NULL REFERENCES recurso_multimedia(recurso_id) ON DELETE RESTRICT,
    numero_orden INT NOT NULL DEFAULT 1,
    texto_alternativo VARCHAR(255),
    UNIQUE (opcion_id, recurso_id),
    UNIQUE (opcion_id, numero_orden)
);

-- ============================================================
-- REGLAS, CLAVES Y MATRICES DE PUNTAJE
-- ============================================================

CREATE TABLE regla_calificacion (
    regla_calificacion_id BIGSERIAL PRIMARY KEY,
    version_test_id BIGINT NOT NULL REFERENCES version_test(version_test_id) ON DELETE CASCADE,
    subtest_id BIGINT,
    item_id BIGINT,
    estrategia_calificacion_id SMALLINT NOT NULL REFERENCES estrategia_calificacion(estrategia_calificacion_id) ON DELETE RESTRICT,
    tipo_regla tipo_regla_calificacion NOT NULL,
    prioridad INT NOT NULL DEFAULT 1 CHECK (prioridad > 0),
    activa BOOLEAN NOT NULL DEFAULT TRUE,
    estado estado_configuracion NOT NULL DEFAULT 'BORRADOR',
    parametros JSONB NOT NULL DEFAULT '{}'::jsonb,
    observacion TEXT,
    creado_por UUID REFERENCES usuario(usuario_id),
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    aprobado_por UUID REFERENCES usuario(usuario_id),
    aprobado_en TIMESTAMP,
    FOREIGN KEY (version_test_id, subtest_id)
        REFERENCES subtest(version_test_id, subtest_id) ON DELETE CASCADE,
    FOREIGN KEY (subtest_id, item_id)
        REFERENCES item(subtest_id, item_id) ON DELETE CASCADE,
    CONSTRAINT ck_regla_item_requiere_subtest CHECK (
        item_id IS NULL OR subtest_id IS NOT NULL
    ),
    CONSTRAINT ck_regla_aprobacion CHECK (
        estado NOT IN ('APROBADO', 'PUBLICADO')
        OR (aprobado_por IS NOT NULL AND aprobado_en IS NOT NULL)
    )
);

CREATE TABLE clave_respuesta (
    clave_respuesta_id BIGSERIAL PRIMARY KEY,
    regla_calificacion_id BIGINT NOT NULL REFERENCES regla_calificacion(regla_calificacion_id) ON DELETE CASCADE,
    item_id BIGINT NOT NULL REFERENCES item(item_id) ON DELETE CASCADE,
    opcion_correcta_id BIGINT,
    texto_esperado TEXT,
    valor_numerico_esperado DECIMAL(12,4),
    tolerancia_numerica DECIMAL(12,4) CHECK (tolerancia_numerica IS NULL OR tolerancia_numerica >= 0),
    puntaje DECIMAL(8,2) NOT NULL DEFAULT 1.00 CHECK (puntaje >= 0),
    requiere_revision_manual BOOLEAN NOT NULL DEFAULT FALSE,
    creado_por UUID REFERENCES usuario(usuario_id),
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id, opcion_correcta_id)
        REFERENCES opcion_item(item_id, opcion_id) ON DELETE RESTRICT,
    CONSTRAINT ck_clave_tipo CHECK (
        opcion_correcta_id IS NOT NULL
        OR texto_esperado IS NOT NULL
        OR valor_numerico_esperado IS NOT NULL
        OR requiere_revision_manual = TRUE
    ),
    UNIQUE (regla_calificacion_id, item_id)
);

CREATE TABLE opcion_puntaje_dimension (
    opcion_puntaje_dimension_id BIGSERIAL PRIMARY KEY,
    regla_calificacion_id BIGINT NOT NULL REFERENCES regla_calificacion(regla_calificacion_id) ON DELETE CASCADE,
    opcion_id BIGINT NOT NULL REFERENCES opcion_item(opcion_id) ON DELETE CASCADE,
    dimension_resultado_id BIGINT NOT NULL REFERENCES dimension_resultado(dimension_resultado_id) ON DELETE CASCADE,
    puntaje DECIMAL(8,2) NOT NULL DEFAULT 0 CHECK (puntaje >= 0),
    peso DECIMAL(8,4) NOT NULL DEFAULT 1 CHECK (peso > 0),
    activa BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX uq_opcion_dimension_activa
    ON opcion_puntaje_dimension(opcion_id, dimension_resultado_id)
    WHERE activa;

-- ============================================================
-- BAREMOS VERSIONADOS
-- ============================================================

CREATE TABLE baremo (
    baremo_id BIGSERIAL PRIMARY KEY,
    version_test_id BIGINT NOT NULL REFERENCES version_test(version_test_id) ON DELETE CASCADE,
    dimension_resultado_id BIGINT,
    codigo_baremo VARCHAR(60) NOT NULL,
    nombre VARCHAR(150) NOT NULL,
    descripcion TEXT,
    grupo_normativo VARCHAR(150),
    criterio_edad_minima SMALLINT CHECK (criterio_edad_minima IS NULL OR criterio_edad_minima BETWEEN 0 AND 120),
    criterio_edad_maxima SMALLINT CHECK (criterio_edad_maxima IS NULL OR criterio_edad_maxima BETWEEN 0 AND 120),
    criterio_sexo_id SMALLINT REFERENCES catalogo_sexo(sexo_id) ON DELETE RESTRICT,
    criterio_carrera_id SMALLINT REFERENCES carrera(carrera_id) ON DELETE RESTRICT,
    vigente_desde DATE,
    vigente_hasta DATE,
    estado estado_configuracion NOT NULL DEFAULT 'BORRADOR',
    creado_por UUID REFERENCES usuario(usuario_id),
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    aprobado_por UUID REFERENCES usuario(usuario_id),
    aprobado_en TIMESTAMP,
    FOREIGN KEY (version_test_id, dimension_resultado_id)
        REFERENCES dimension_resultado(version_test_id, dimension_resultado_id) ON DELETE CASCADE,
    CONSTRAINT ck_baremo_edad CHECK (
        criterio_edad_minima IS NULL
        OR criterio_edad_maxima IS NULL
        OR criterio_edad_minima <= criterio_edad_maxima
    ),
    CONSTRAINT ck_baremo_vigencia CHECK (
        vigente_desde IS NULL OR vigente_hasta IS NULL OR vigente_hasta >= vigente_desde
    ),
    CONSTRAINT ck_baremo_aprobacion CHECK (
        estado NOT IN ('APROBADO', 'PUBLICADO')
        OR (aprobado_por IS NOT NULL AND aprobado_en IS NOT NULL)
    )
);

CREATE UNIQUE INDEX uq_baremo_dimension_codigo
    ON baremo(version_test_id, dimension_resultado_id, codigo_baremo)
    WHERE dimension_resultado_id IS NOT NULL;

CREATE UNIQUE INDEX uq_baremo_total_codigo
    ON baremo(version_test_id, codigo_baremo)
    WHERE dimension_resultado_id IS NULL;

CREATE TABLE rango_baremo (
    rango_baremo_id BIGSERIAL PRIMARY KEY,
    baremo_id BIGINT NOT NULL REFERENCES baremo(baremo_id) ON DELETE CASCADE,
    puntaje_minimo DECIMAL(10,2) NOT NULL,
    puntaje_maximo DECIMAL(10,2) NOT NULL,
    percentil DECIMAL(6,2) CHECK (percentil IS NULL OR percentil BETWEEN 0 AND 100),
    categoria VARCHAR(100) NOT NULL,
    interpretacion TEXT,
    recomendacion TEXT,
    orden INT NOT NULL,
    UNIQUE (baremo_id, orden),
    UNIQUE (baremo_id, rango_baremo_id),
    CONSTRAINT ck_rango_baremo_puntaje CHECK (puntaje_minimo <= puntaje_maximo),
    CONSTRAINT ex_rango_baremo_no_solapado EXCLUDE USING gist (
        baremo_id WITH =,
        numrange(puntaje_minimo, puntaje_maximo, '[]') WITH &&
    )
);

-- ============================================================
-- RUBRICAS Y REVISION MANUAL ESTRUCTURADA
-- ============================================================

CREATE TABLE rubrica_evaluacion (
    rubrica_id BIGSERIAL PRIMARY KEY,
    version_test_id BIGINT NOT NULL REFERENCES version_test(version_test_id) ON DELETE CASCADE,
    subtest_id BIGINT,
    item_id BIGINT,
    codigo_rubrica VARCHAR(60) NOT NULL,
    nombre VARCHAR(150) NOT NULL,
    descripcion TEXT,
    puntaje_maximo DECIMAL(8,2) CHECK (puntaje_maximo IS NULL OR puntaje_maximo >= 0),
    estado estado_configuracion NOT NULL DEFAULT 'BORRADOR',
    creado_por UUID REFERENCES usuario(usuario_id),
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    aprobado_por UUID REFERENCES usuario(usuario_id),
    aprobado_en TIMESTAMP,
    FOREIGN KEY (version_test_id, subtest_id)
        REFERENCES subtest(version_test_id, subtest_id) ON DELETE CASCADE,
    FOREIGN KEY (subtest_id, item_id)
        REFERENCES item(subtest_id, item_id) ON DELETE CASCADE,
    UNIQUE (version_test_id, codigo_rubrica),
    CONSTRAINT ck_rubrica_item_requiere_subtest CHECK (
        item_id IS NULL OR subtest_id IS NOT NULL
    ),
    CONSTRAINT ck_rubrica_aprobacion CHECK (
        estado NOT IN ('APROBADO', 'PUBLICADO')
        OR (aprobado_por IS NOT NULL AND aprobado_en IS NOT NULL)
    )
);

CREATE TABLE criterio_rubrica (
    criterio_rubrica_id BIGSERIAL PRIMARY KEY,
    rubrica_id BIGINT NOT NULL REFERENCES rubrica_evaluacion(rubrica_id) ON DELETE CASCADE,
    codigo_criterio VARCHAR(60) NOT NULL,
    nombre VARCHAR(150) NOT NULL,
    descripcion TEXT,
    puntaje_maximo DECIMAL(8,2) NOT NULL CHECK (puntaje_maximo >= 0),
    peso DECIMAL(8,4) NOT NULL DEFAULT 1 CHECK (peso > 0),
    orden INT NOT NULL,
    UNIQUE (rubrica_id, codigo_criterio),
    UNIQUE (rubrica_id, orden)
);

CREATE TABLE nivel_criterio_rubrica (
    nivel_criterio_rubrica_id BIGSERIAL PRIMARY KEY,
    criterio_rubrica_id BIGINT NOT NULL REFERENCES criterio_rubrica(criterio_rubrica_id) ON DELETE CASCADE,
    codigo_nivel VARCHAR(60) NOT NULL,
    nombre VARCHAR(150) NOT NULL,
    descripcion TEXT,
    puntaje DECIMAL(8,2) NOT NULL CHECK (puntaje >= 0),
    orden INT NOT NULL,
    UNIQUE (criterio_rubrica_id, codigo_nivel),
    UNIQUE (criterio_rubrica_id, orden)
);

-- ============================================================
-- SESIONES CONFIGURABLES Y TOKENS
-- ============================================================

CREATE TABLE sesion_aplicacion (
    sesion_aplicacion_id BIGSERIAL PRIMARY KEY,
    version_test_id BIGINT NOT NULL REFERENCES version_test(version_test_id) ON DELETE RESTRICT,
    codigo_sesion VARCHAR(80) NOT NULL UNIQUE,
    nombre_sesion VARCHAR(150) NOT NULL,
    descripcion TEXT,
    inicio_programado TIMESTAMP NOT NULL,
    fin_programado TIMESTAMP,
    inicio_real TIMESTAMP,
    fin_real TIMESTAMP,
    ubicacion VARCHAR(150),
    estado estado_sesion_aplicacion NOT NULL DEFAULT 'PROGRAMADA',
    creado_por UUID REFERENCES usuario(usuario_id),
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (sesion_aplicacion_id, version_test_id),
    CONSTRAINT ck_fechas_sesion CHECK (
        fin_programado IS NULL OR fin_programado > inicio_programado
    )
);

CREATE TABLE sesion_subtest (
    sesion_subtest_id BIGSERIAL PRIMARY KEY,
    sesion_aplicacion_id BIGINT NOT NULL,
    version_test_id BIGINT NOT NULL,
    subtest_id BIGINT NOT NULL,
    numero_orden INT NOT NULL,
    tiempo_limite_segundos INT CHECK (tiempo_limite_segundos IS NULL OR tiempo_limite_segundos > 0),
    permite_aleatorizar_items BOOLEAN NOT NULL DEFAULT FALSE,
    permite_aleatorizar_opciones BOOLEAN NOT NULL DEFAULT FALSE,
    FOREIGN KEY (sesion_aplicacion_id, version_test_id)
        REFERENCES sesion_aplicacion(sesion_aplicacion_id, version_test_id) ON DELETE CASCADE,
    FOREIGN KEY (version_test_id, subtest_id)
        REFERENCES subtest(version_test_id, subtest_id) ON DELETE RESTRICT,
    UNIQUE (sesion_aplicacion_id, subtest_id),
    UNIQUE (sesion_aplicacion_id, numero_orden)
);

CREATE TABLE asignacion_test (
    asignacion_id BIGSERIAL PRIMARY KEY,
    sesion_aplicacion_id BIGINT NOT NULL REFERENCES sesion_aplicacion(sesion_aplicacion_id) ON DELETE CASCADE,
    participante_id UUID NOT NULL REFERENCES participante(participante_id) ON DELETE RESTRICT,
    evaluador_id UUID NOT NULL REFERENCES usuario(usuario_id) ON DELETE RESTRICT,
    token_acceso_hash VARCHAR(255) NOT NULL UNIQUE,
    token_expira_en TIMESTAMP NOT NULL,
    token_usado_en TIMESTAMP,
    intentos_acceso INT NOT NULL DEFAULT 0 CHECK (intentos_acceso >= 0),
    edad_registrada_aplicacion SMALLINT CHECK (edad_registrada_aplicacion IS NULL OR edad_registrada_aplicacion BETWEEN 0 AND 120),
    sexo_id_aplicacion SMALLINT REFERENCES catalogo_sexo(sexo_id) ON DELETE RESTRICT,
    carrera_id_aplicacion SMALLINT REFERENCES carrera(carrera_id) ON DELETE RESTRICT,
    cohorte_id_aplicacion SMALLINT REFERENCES cohorte(cohorte_id) ON DELETE RESTRICT,
    grupo_academico_id_aplicacion SMALLINT REFERENCES grupo_academico(grupo_academico_id) ON DELETE RESTRICT,
    asignado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    estado estado_asignacion NOT NULL DEFAULT 'ASIGNADO',
    UNIQUE (sesion_aplicacion_id, participante_id)
);

CREATE TABLE intento_test (
    intento_id BIGSERIAL PRIMARY KEY,
    asignacion_id BIGINT NOT NULL UNIQUE REFERENCES asignacion_test(asignacion_id) ON DELETE CASCADE,
    iniciado_en TIMESTAMP,
    finalizado_en TIMESTAMP,
    estado estado_intento NOT NULL DEFAULT 'NO_INICIADO',
    ultimo_subtest_id BIGINT REFERENCES subtest(subtest_id),
    ultima_actividad_en TIMESTAMP,
    tiempo_total_segundos INT CHECK (tiempo_total_segundos IS NULL OR tiempo_total_segundos >= 0),
    informacion_dispositivo TEXT,
    direccion_ip VARCHAR(60)
);

CREATE TABLE intento_subtest (
    intento_subtest_id BIGSERIAL PRIMARY KEY,
    intento_id BIGINT NOT NULL REFERENCES intento_test(intento_id) ON DELETE CASCADE,
    sesion_subtest_id BIGINT NOT NULL REFERENCES sesion_subtest(sesion_subtest_id) ON DELETE RESTRICT,
    subtest_id BIGINT NOT NULL REFERENCES subtest(subtest_id) ON DELETE RESTRICT,
    iniciado_en TIMESTAMP,
    finalizado_en TIMESTAMP,
    estado estado_intento NOT NULL DEFAULT 'NO_INICIADO',
    tiempo_usado_segundos INT CHECK (tiempo_usado_segundos IS NULL OR tiempo_usado_segundos >= 0),
    UNIQUE (intento_id, subtest_id)
);

-- ============================================================
-- RESPUESTAS FINALES DEL PARTICIPANTE
-- ============================================================

CREATE TABLE respuesta_item (
    respuesta_id BIGSERIAL PRIMARY KEY,
    intento_id BIGINT NOT NULL REFERENCES intento_test(intento_id) ON DELETE CASCADE,
    intento_subtest_id BIGINT REFERENCES intento_subtest(intento_subtest_id) ON DELETE CASCADE,
    item_id BIGINT NOT NULL REFERENCES item(item_id) ON DELETE RESTRICT,
    respuesta_texto_abierto TEXT,
    respuesta_numerica DECIMAL(12,4),
    respondido_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    tiempo_usado_segundos INT CHECK (tiempo_usado_segundos IS NULL OR tiempo_usado_segundos >= 0),
    es_final BOOLEAN NOT NULL DEFAULT TRUE,
    requiere_revision_manual BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (intento_id, item_id),
    UNIQUE (respuesta_id, item_id)
);

CREATE TABLE opcion_seleccionada_respuesta (
    respuesta_id BIGINT NOT NULL,
    item_id BIGINT NOT NULL,
    opcion_id BIGINT NOT NULL,
    seleccionada_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (respuesta_id, opcion_id),
    FOREIGN KEY (respuesta_id, item_id)
        REFERENCES respuesta_item(respuesta_id, item_id) ON DELETE CASCADE,
    FOREIGN KEY (item_id, opcion_id)
        REFERENCES opcion_item(item_id, opcion_id) ON DELETE RESTRICT
);

-- ============================================================
-- RESULTADOS, CALIFICACION DETALLADA Y BAREMOS APLICADOS
-- ============================================================

CREATE TABLE resultado (
    resultado_id BIGSERIAL PRIMARY KEY,
    intento_id BIGINT NOT NULL UNIQUE REFERENCES intento_test(intento_id) ON DELETE CASCADE,
    estrategia_calificacion_id SMALLINT REFERENCES estrategia_calificacion(estrategia_calificacion_id) ON DELETE RESTRICT,
    calculado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    calculado_por UUID REFERENCES usuario(usuario_id),
    puntaje_total_directo DECIMAL(10,2) NOT NULL DEFAULT 0,
    cantidad_items INT NOT NULL DEFAULT 0 CHECK (cantidad_items >= 0),
    cantidad_correctas INT NOT NULL DEFAULT 0 CHECK (cantidad_correctas >= 0),
    cantidad_incorrectas INT NOT NULL DEFAULT 0 CHECK (cantidad_incorrectas >= 0),
    cantidad_pendientes_revision INT NOT NULL DEFAULT 0 CHECK (cantidad_pendientes_revision >= 0),
    requiere_revision_manual BOOLEAN NOT NULL DEFAULT FALSE,
    estado VARCHAR(30) NOT NULL DEFAULT 'CALCULADO'
);

CREATE TABLE resultado_dimension (
    resultado_dimension_id BIGSERIAL PRIMARY KEY,
    resultado_id BIGINT NOT NULL REFERENCES resultado(resultado_id) ON DELETE CASCADE,
    dimension_resultado_id BIGINT NOT NULL REFERENCES dimension_resultado(dimension_resultado_id) ON DELETE RESTRICT,
    baremo_id BIGINT REFERENCES baremo(baremo_id) ON DELETE RESTRICT,
    rango_baremo_id BIGINT,
    puntaje_directo DECIMAL(10,2) NOT NULL DEFAULT 0,
    puntaje_transformado DECIMAL(10,2),
    percentil DECIMAL(6,2) CHECK (percentil IS NULL OR percentil BETWEEN 0 AND 100),
    categoria VARCHAR(100),
    interpretacion TEXT,
    requiere_revision_manual BOOLEAN NOT NULL DEFAULT FALSE,
    observacion TEXT,
    UNIQUE (resultado_id, dimension_resultado_id),
    CONSTRAINT ck_resultado_dimension_rango_baremo CHECK (
        rango_baremo_id IS NULL OR baremo_id IS NOT NULL
    ),
    FOREIGN KEY (baremo_id, rango_baremo_id)
        REFERENCES rango_baremo(baremo_id, rango_baremo_id) ON DELETE RESTRICT
);

CREATE TABLE calificacion_respuesta (
    calificacion_respuesta_id BIGSERIAL PRIMARY KEY,
    resultado_id BIGINT NOT NULL REFERENCES resultado(resultado_id) ON DELETE CASCADE,
    respuesta_id BIGINT NOT NULL REFERENCES respuesta_item(respuesta_id) ON DELETE CASCADE,
    regla_calificacion_id BIGINT REFERENCES regla_calificacion(regla_calificacion_id) ON DELETE RESTRICT,
    dimension_resultado_id BIGINT REFERENCES dimension_resultado(dimension_resultado_id) ON DELETE RESTRICT,
    opcion_id BIGINT REFERENCES opcion_item(opcion_id) ON DELETE RESTRICT,
    puntaje_obtenido DECIMAL(10,2) NOT NULL DEFAULT 0,
    es_correcta BOOLEAN,
    requiere_revision_manual BOOLEAN NOT NULL DEFAULT FALSE,
    observacion TEXT,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE revision_manual_respuesta (
    revision_manual_respuesta_id BIGSERIAL PRIMARY KEY,
    respuesta_id BIGINT NOT NULL REFERENCES respuesta_item(respuesta_id) ON DELETE CASCADE,
    regla_calificacion_id BIGINT REFERENCES regla_calificacion(regla_calificacion_id) ON DELETE RESTRICT,
    estado estado_revision_manual NOT NULL DEFAULT 'PENDIENTE',
    puntaje_asignado DECIMAL(10,2) CHECK (puntaje_asignado IS NULL OR puntaje_asignado >= 0),
    comentario TEXT,
    revisado_por UUID REFERENCES usuario(usuario_id),
    revisado_en TIMESTAMP,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (respuesta_id, regla_calificacion_id),
    CONSTRAINT ck_revision_manual_revisada CHECK (
        estado <> 'REVISADO'
        OR (revisado_por IS NOT NULL AND revisado_en IS NOT NULL)
    )
);

CREATE TABLE revision_rubrica_respuesta (
    revision_rubrica_respuesta_id BIGSERIAL PRIMARY KEY,
    revision_manual_respuesta_id BIGINT NOT NULL REFERENCES revision_manual_respuesta(revision_manual_respuesta_id) ON DELETE CASCADE,
    criterio_rubrica_id BIGINT NOT NULL REFERENCES criterio_rubrica(criterio_rubrica_id) ON DELETE RESTRICT,
    nivel_criterio_rubrica_id BIGINT REFERENCES nivel_criterio_rubrica(nivel_criterio_rubrica_id) ON DELETE RESTRICT,
    puntaje_asignado DECIMAL(10,2) NOT NULL CHECK (puntaje_asignado >= 0),
    comentario TEXT,
    UNIQUE (revision_manual_respuesta_id, criterio_rubrica_id)
);

-- Vista de compatibilidad para reportes heredados del MVP.
CREATE VIEW detalle_resultado AS
SELECT
    rd.resultado_dimension_id AS detalle_resultado_id,
    rd.resultado_id,
    dr.subtest_id,
    dr.nombre_dimension AS nombre_puntaje,
    rd.puntaje_directo,
    rd.puntaje_transformado,
    rd.percentil,
    rd.categoria,
    rd.interpretacion,
    rd.requiere_revision_manual,
    rd.observacion
FROM resultado_dimension rd
JOIN dimension_resultado dr
    ON dr.dimension_resultado_id = rd.dimension_resultado_id;

CREATE TABLE reporte_generado (
    reporte_id BIGSERIAL PRIMARY KEY,
    tipo_reporte VARCHAR(50) NOT NULL,
    intento_id BIGINT REFERENCES intento_test(intento_id) ON DELETE CASCADE,
    resultado_id BIGINT REFERENCES resultado(resultado_id) ON DELETE CASCADE,
    sesion_aplicacion_id BIGINT REFERENCES sesion_aplicacion(sesion_aplicacion_id) ON DELETE CASCADE,
    generado_por UUID REFERENCES usuario(usuario_id),
    generado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    formato formato_reporte NOT NULL,
    ruta_almacenamiento TEXT NOT NULL,
    resumen_filtros JSONB,
    CONSTRAINT ck_reporte_origen CHECK (
        intento_id IS NOT NULL OR resultado_id IS NOT NULL OR sesion_aplicacion_id IS NOT NULL
    )
);

-- ============================================================
-- AUDITORIA
-- ============================================================

CREATE TABLE auditoria (
    auditoria_id BIGSERIAL PRIMARY KEY,
    usuario_id UUID REFERENCES usuario(usuario_id),
    accion VARCHAR(100) NOT NULL,
    entidad VARCHAR(100) NOT NULL,
    entidad_id VARCHAR(100),
    valor_anterior JSONB,
    valor_nuevo JSONB,
    direccion_ip VARCHAR(60),
    agente_usuario TEXT,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- INDICES
-- ============================================================

CREATE INDEX idx_usuario_estado ON usuario(estado);
CREATE INDEX idx_participante_codigo ON participante(codigo_participante);
CREATE INDEX idx_participante_demografia ON participante(sexo_id, carrera_id, cohorte_id, grupo_academico_id);
CREATE INDEX idx_version_test_estado ON version_test(estado);
CREATE INDEX idx_subtest_version ON subtest(version_test_id);
CREATE INDEX idx_dimension_version ON dimension_resultado(version_test_id);
CREATE INDEX idx_item_subtest ON item(subtest_id);
CREATE INDEX idx_opcion_item ON opcion_item(item_id);
CREATE INDEX idx_recurso_confidencial ON recurso_multimedia(es_confidencial, requiere_autorizacion);
CREATE INDEX idx_regla_version_estado ON regla_calificacion(version_test_id, estado, activa);
CREATE INDEX idx_regla_item ON regla_calificacion(item_id);
CREATE INDEX idx_clave_item ON clave_respuesta(item_id);
CREATE INDEX idx_opcion_puntaje_dimension ON opcion_puntaje_dimension(dimension_resultado_id);
CREATE INDEX idx_baremo_dimension_estado ON baremo(dimension_resultado_id, estado);
CREATE INDEX idx_rango_baremo_baremo ON rango_baremo(baremo_id);
CREATE INDEX idx_sesion_estado ON sesion_aplicacion(estado);
CREATE INDEX idx_sesion_subtest_sesion ON sesion_subtest(sesion_aplicacion_id);
CREATE INDEX idx_asignacion_participante ON asignacion_test(participante_id);
CREATE INDEX idx_asignacion_evaluador ON asignacion_test(evaluador_id);
CREATE INDEX idx_asignacion_token_hash ON asignacion_test(token_acceso_hash);
CREATE INDEX idx_intento_asignacion ON intento_test(asignacion_id);
CREATE INDEX idx_intento_subtest_intento ON intento_subtest(intento_id);
CREATE INDEX idx_respuesta_intento ON respuesta_item(intento_id);
CREATE INDEX idx_respuesta_item ON respuesta_item(item_id);
CREATE INDEX idx_resultado_intento ON resultado(intento_id);
CREATE INDEX idx_resultado_dimension_resultado ON resultado_dimension(resultado_id);
CREATE INDEX idx_calificacion_resultado ON calificacion_respuesta(resultado_id);
CREATE INDEX idx_calificacion_respuesta ON calificacion_respuesta(respuesta_id);
CREATE INDEX idx_revision_manual_estado ON revision_manual_respuesta(estado);
CREATE INDEX idx_reporte_generado_fecha ON reporte_generado(generado_en);
CREATE INDEX idx_auditoria_usuario_fecha ON auditoria(usuario_id, creado_en);
CREATE INDEX idx_auditoria_entidad_fecha ON auditoria(entidad, entidad_id, creado_en);

-- ============================================================
-- DATOS BASE
-- ============================================================

INSERT INTO rol (nombre_rol, descripcion) VALUES
('ADMINISTRADOR', 'Administra usuarios, roles, configuracion general y auditoria'),
('PSICOLOGO_COORDINADOR', 'Configura instrumentos, valida resultados y consulta reportes'),
('APLICADOR', 'Crea sesiones de aplicacion y supervisa evaluaciones'),
('CONSULTOR_REPORTES', 'Consulta resultados y reportes autorizados');

INSERT INTO permiso (codigo_permiso, descripcion) VALUES
('USUARIO_LEER', 'Consultar usuarios'),
('USUARIO_CREAR', 'Crear usuarios'),
('USUARIO_MODIFICAR', 'Modificar usuarios'),
('USUARIO_ELIMINAR', 'Eliminar o desactivar usuarios'),
('ROL_LEER', 'Consultar roles y permisos'),
('ROL_CREAR', 'Crear roles'),
('ROL_MODIFICAR', 'Modificar roles y permisos'),
('ROL_ELIMINAR', 'Eliminar o desactivar roles'),
('CATALOGO_SEXO_LEER', 'Consultar catalogo de sexos'),
('CATALOGO_SEXO_CREAR', 'Crear valores del catalogo de sexos'),
('CATALOGO_SEXO_MODIFICAR', 'Modificar valores del catalogo de sexos'),
('CATALOGO_SEXO_ELIMINAR', 'Eliminar logicamente valores del catalogo de sexos'),
('CARRERA_LEER', 'Consultar carreras'),
('CARRERA_CREAR', 'Crear carreras'),
('CARRERA_MODIFICAR', 'Modificar carreras'),
('CARRERA_ELIMINAR', 'Eliminar logicamente carreras'),
('COHORTE_LEER', 'Consultar cohortes'),
('COHORTE_CREAR', 'Crear cohortes'),
('COHORTE_MODIFICAR', 'Modificar cohortes'),
('COHORTE_ELIMINAR', 'Eliminar logicamente cohortes'),
('GRUPO_ACADEMICO_LEER', 'Consultar grupos academicos'),
('GRUPO_ACADEMICO_CREAR', 'Crear grupos academicos'),
('GRUPO_ACADEMICO_MODIFICAR', 'Modificar grupos academicos'),
('GRUPO_ACADEMICO_ELIMINAR', 'Eliminar logicamente grupos academicos'),
('PARTICIPANTE_LEER', 'Consultar participantes'),
('PARTICIPANTE_CREAR', 'Crear participantes'),
('PARTICIPANTE_MODIFICAR', 'Modificar participantes'),
('PARTICIPANTE_ELIMINAR', 'Eliminar logicamente participantes'),
('TEST_CREAR', 'Crear tests, subtests, items y opciones'),
('TEST_PUBLICAR', 'Aprobar y publicar versiones de tests'),
('TEST_LEER', 'Leer y listar versiones de tests'),
('CALIFICACION_CONFIGURAR', 'Configurar estrategias, reglas, claves y matrices de puntaje'),
('BAREMO_CONFIGURAR', 'Configurar baremos y rangos de baremo'),
('RUBRICA_CONFIGURAR', 'Configurar rubricas de revision manual'),
('SESION_CREAR', 'Crear sesiones de aplicacion'),
('SESION_APLICAR', 'Aplicar y supervisar tests'),
('RESPUESTA_REVISAR', 'Revisar respuestas abiertas o manuales'),
('RESULTADO_VER', 'Consultar resultados'),
('REPORTE_EXPORTAR', 'Exportar reportes'),
('AUDITORIA_VER', 'Consultar auditoria');

INSERT INTO catalogo_sexo (codigo, nombre) VALUES
('F', 'Femenino'),
('M', 'Masculino'),
('ND', 'No declarado');

INSERT INTO estrategia_calificacion (
    codigo,
    nombre,
    descripcion,
    tipo_estrategia,
    requiere_revision_manual,
    permite_baremo
) VALUES
('CLAVE_SIMPLE', 'Clave simple', 'Compara la respuesta contra una clave aprobada y suma puntaje por acierto.', 'CLAVE_SIMPLE', FALSE, TRUE),
('MATRIZ_DIMENSIONAL', 'Matriz dimensional', 'Cada opcion seleccionada aporta puntaje a una o varias dimensiones de resultado.', 'MATRIZ_DIMENSIONAL', FALSE, TRUE),
('LIKERT_ESCALA', 'Escala Likert', 'Asigna valores ordinales a opciones y acumula o promedia puntajes por dimension.', 'LIKERT_ESCALA', FALSE, TRUE),
('RESPUESTA_NUMERICA', 'Respuesta numerica', 'Califica una respuesta numerica con valor esperado, rango o tolerancia.', 'RESPUESTA_NUMERICA', FALSE, TRUE),
('REVISION_MANUAL', 'Revision manual', 'Marca respuestas para revision manual por un usuario autorizado.', 'REVISION_MANUAL', TRUE, FALSE),
('RUBRICA_MANUAL', 'Rubrica manual', 'Permite calificar respuestas mediante criterios y niveles de rubrica.', 'RUBRICA_MANUAL', TRUE, TRUE),
('FORMULA_CONTROLADA', 'Formula controlada', 'Ejecuta calculos parametrizados bajo esquemas preaprobados por el backend.', 'FORMULA_CONTROLADA', FALSE, TRUE);

-- ============================================================
-- COMENTARIOS IMPORTANTES
-- ============================================================

COMMENT ON TABLE estrategia_calificacion IS
'Catalogo de estrategias de calificacion. Permite que el backend seleccione la logica general de calculo sin quemar reglas por test.';

COMMENT ON TABLE regla_calificacion IS
'Configura reglas aprobables por version, subtest o item. Las reglas no deben aplicarse en sesiones reales si no estan aprobadas/publicadas.';

COMMENT ON TABLE dimension_resultado IS
'Representa escalas, factores, subtests o categorias que reciben puntaje. Evita depender de nombres textuales repetidos en resultados.';

COMMENT ON TABLE opcion_puntaje_dimension IS
'Matriz opcion-dimension-puntaje para pruebas sin respuesta correcta unica, como valores, intereses o perfiles vocacionales.';

COMMENT ON TABLE baremo IS
'Baremo versionado y aprobable para transformar puntajes directos en categorias, percentiles o interpretaciones.';

COMMENT ON TABLE rango_baremo IS
'Rangos no solapados por baremo. La restriccion EXCLUDE evita que dos rangos de un mismo baremo cubran el mismo puntaje.';

COMMENT ON TABLE resultado_dimension IS
'Resultado calculado por dimension. Guarda el puntaje directo, transformado, categoria e interpretacion aplicada.';

COMMENT ON TABLE calificacion_respuesta IS
'Trazabilidad item a item entre respuesta, regla aplicada, opcion, dimension y puntaje obtenido.';

COMMENT ON TABLE revision_manual_respuesta IS
'Registra revision manual de respuestas abiertas o criterios no calificables automaticamente.';

COMMENT ON TABLE asignacion_test IS
'Acceso por link/token. Solo se guarda el hash del token, junto con snapshots demograficos relevantes para baremos historicos.';

COMMENT ON TABLE recurso_multimedia IS
'Los archivos reales deben estar en almacenamiento privado. Aqui solo se guarda ruta, hash y metadatos.';

COMMENT ON VIEW detalle_resultado IS
'Vista de compatibilidad del MVP. La fuente normalizada de resultados parciales es resultado_dimension.';

-- migrations/20260624000100_seed_rbac_permissions.sql
INSERT INTO permiso (codigo_permiso, descripcion) VALUES
('USUARIO_LEER', 'Consultar usuarios'),
('USUARIO_CREAR', 'Crear usuarios'),
('USUARIO_MODIFICAR', 'Modificar usuarios'),
('USUARIO_ELIMINAR', 'Eliminar o desactivar usuarios'),
('ROL_LEER', 'Consultar roles y permisos'),
('ROL_CREAR', 'Crear roles'),
('ROL_MODIFICAR', 'Modificar roles y permisos'),
('ROL_ELIMINAR', 'Eliminar o desactivar roles'),
('CATALOGO_SEXO_LEER', 'Consultar catalogo de sexos'),
('CATALOGO_SEXO_CREAR', 'Crear valores del catalogo de sexos'),
('CATALOGO_SEXO_MODIFICAR', 'Modificar valores del catalogo de sexos'),
('CATALOGO_SEXO_ELIMINAR', 'Eliminar logicamente valores del catalogo de sexos'),
('CARRERA_LEER', 'Consultar carreras'),
('CARRERA_CREAR', 'Crear carreras'),
('CARRERA_MODIFICAR', 'Modificar carreras'),
('CARRERA_ELIMINAR', 'Eliminar logicamente carreras'),
('COHORTE_LEER', 'Consultar cohortes'),
('COHORTE_CREAR', 'Crear cohortes'),
('COHORTE_MODIFICAR', 'Modificar cohortes'),
('COHORTE_ELIMINAR', 'Eliminar logicamente cohortes'),
('GRUPO_ACADEMICO_LEER', 'Consultar grupos academicos'),
('GRUPO_ACADEMICO_CREAR', 'Crear grupos academicos'),
('GRUPO_ACADEMICO_MODIFICAR', 'Modificar grupos academicos'),
('GRUPO_ACADEMICO_ELIMINAR', 'Eliminar logicamente grupos academicos'),
('PARTICIPANTE_LEER', 'Consultar participantes'),
('PARTICIPANTE_CREAR', 'Crear participantes'),
('PARTICIPANTE_MODIFICAR', 'Modificar participantes'),
('PARTICIPANTE_ELIMINAR', 'Eliminar logicamente participantes'),
('PARTICIPANTE_ACCESO_GESTIONAR', 'Generar y administrar tokens de acceso de participantes'),
('CALIFICACION_EJECUTAR', 'Ejecutar calificacion oficial de intentos'),
('RESULTADO_AGREGADO_VER', 'Consultar resultados agregados'),
('AUDITORIA_REGISTRAR', 'Registrar eventos de auditoria desde servicios')
ON CONFLICT (codigo_permiso) DO UPDATE SET descripcion = EXCLUDED.descripcion;

DELETE FROM rol_permiso
WHERE permiso_id IN (
    SELECT permiso_id FROM permiso
    WHERE codigo_permiso IN ('USUARIO_GESTIONAR', 'ROL_PERMISO_GESTIONAR', 'PARTICIPANTE_GESTIONAR', 'RESPUESTA_REGISTRAR')
);

DELETE FROM permiso
WHERE codigo_permiso IN ('USUARIO_GESTIONAR', 'ROL_PERMISO_GESTIONAR', 'PARTICIPANTE_GESTIONAR', 'RESPUESTA_REGISTRAR');

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.rol_id, p.permiso_id
FROM rol r
CROSS JOIN permiso p
WHERE r.nombre_rol = 'ADMINISTRADOR'
   OR (r.nombre_rol = 'PSICOLOGO_COORDINADOR' AND p.codigo_permiso IN (
        'CATALOGO_SEXO_LEER', 'CARRERA_LEER', 'COHORTE_LEER', 'GRUPO_ACADEMICO_LEER',
        'TEST_CREAR', 'TEST_PUBLICAR','TEST_LEER', 'CALIFICACION_CONFIGURAR', 'BAREMO_CONFIGURAR',
        'RUBRICA_CONFIGURAR', 'RESULTADO_VER', 'RESULTADO_AGREGADO_VER',
        'REPORTE_EXPORTAR', 'CALIFICACION_EJECUTAR'
   ))
   OR (r.nombre_rol = 'APLICADOR' AND p.codigo_permiso IN (
        'CATALOGO_SEXO_LEER', 'CARRERA_LEER', 'COHORTE_LEER', 'GRUPO_ACADEMICO_LEER',
        'PARTICIPANTE_LEER', 'PARTICIPANTE_CREAR', 'PARTICIPANTE_MODIFICAR', 'PARTICIPANTE_ELIMINAR',
        'PARTICIPANTE_ACCESO_GESTIONAR', 'SESION_CREAR', 'SESION_APLICAR'
   ))
   OR (r.nombre_rol = 'CONSULTOR_REPORTES' AND p.codigo_permiso IN (
        'CATALOGO_SEXO_LEER', 'CARRERA_LEER', 'COHORTE_LEER', 'GRUPO_ACADEMICO_LEER',
        'PARTICIPANTE_LEER', 'RESULTADO_VER', 'RESULTADO_AGREGADO_VER', 'REPORTE_EXPORTAR'
   ))
ON CONFLICT DO NOTHING;

-- migrations/20260625000100_remove_participant_response_rbac.sql
DELETE FROM rol_permiso
WHERE permiso_id IN (
    SELECT permiso_id
    FROM permiso
    WHERE codigo_permiso = 'RESPUESTA_REGISTRAR'
);

DELETE FROM permiso
WHERE codigo_permiso = 'RESPUESTA_REGISTRAR';

-- migrations/20261122000100_diagnostico_integridad_dominio.sql
-- ============================================================
-- DIAGNOSTICO DE INTEGRIDAD DEL DOMINIO DE APLICACION
-- ============================================================
-- Migracion solo aditiva: crea funciones auxiliares y una vista de diagnostico.
-- No modifica ni borra datos. La migracion siguiente
-- (20261122000200_integridad_dominio.sql) invoca fn_bfa_prevalidar_integridad()
-- y se detiene si encuentra datos historicos incompatibles; esta vista queda
-- disponible para revisarlos y corregirlos manualmente antes de reintentar.

-- ============================================================
-- FUNCIONES AUXILIARES DE ALCANCE
-- ============================================================

CREATE OR REPLACE FUNCTION fn_bfa_version_de_item(p_item_id BIGINT)
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
    SELECT s.version_test_id
    FROM item i
    JOIN subtest s ON s.subtest_id = i.subtest_id
    WHERE i.item_id = p_item_id
$$;

CREATE OR REPLACE FUNCTION fn_bfa_sesion_de_intento(p_intento_id BIGINT)
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
    SELECT a.sesion_aplicacion_id
    FROM intento_test it
    JOIN asignacion_test a ON a.asignacion_id = it.asignacion_id
    WHERE it.intento_id = p_intento_id
$$;

CREATE OR REPLACE FUNCTION fn_bfa_version_de_intento(p_intento_id BIGINT)
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
    SELECT sa.version_test_id
    FROM intento_test it
    JOIN asignacion_test a ON a.asignacion_id = it.asignacion_id
    JOIN sesion_aplicacion sa ON sa.sesion_aplicacion_id = a.sesion_aplicacion_id
    WHERE it.intento_id = p_intento_id
$$;

-- Un alcance de configuracion (version obligatoria, subtest e item opcionales)
-- cubre un item cuando el item pertenece a la version y, si se informan,
-- al subtest y al item indicados. Es la regla comun para reglas y rubricas.
CREATE OR REPLACE FUNCTION fn_bfa_alcance_cubre_item(
    p_version_test_id BIGINT,
    p_subtest_id BIGINT,
    p_item_id BIGINT,
    p_item_objetivo_id BIGINT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM item i
        JOIN subtest s ON s.subtest_id = i.subtest_id
        WHERE i.item_id = p_item_objetivo_id
          AND s.version_test_id = p_version_test_id
          AND (p_subtest_id IS NULL OR i.subtest_id = p_subtest_id)
          AND (p_item_id IS NULL OR i.item_id = p_item_id)
    )
$$;

CREATE OR REPLACE FUNCTION fn_bfa_regla_cubre_item(p_regla_calificacion_id BIGINT, p_item_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM regla_calificacion r
        WHERE r.regla_calificacion_id = p_regla_calificacion_id
          AND fn_bfa_alcance_cubre_item(r.version_test_id, r.subtest_id, r.item_id, p_item_id)
    )
$$;

CREATE OR REPLACE FUNCTION fn_bfa_criterio_cubre_item(p_criterio_rubrica_id BIGINT, p_item_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM criterio_rubrica c
        JOIN rubrica_evaluacion ru ON ru.rubrica_id = c.rubrica_id
        WHERE c.criterio_rubrica_id = p_criterio_rubrica_id
          AND fn_bfa_alcance_cubre_item(ru.version_test_id, ru.subtest_id, ru.item_id, p_item_id)
    )
$$;

-- Compatibilidad del almacenamiento de una respuesta con el tipo de respuesta
-- del item. Devuelve NULL si es valida o el motivo del problema.
-- Una respuesta vacia (sin texto, numero ni selecciones) siempre es valida.
-- El texto en blanco ('' o espacios) se trata como ausencia de texto para no
-- rechazar clientes que envian cadenas vacias en items de seleccion.
CREATE OR REPLACE FUNCTION fn_bfa_problema_respuesta(p_respuesta_id BIGINT)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN x.tiene_texto AND x.tipo <> 'TEXTO_ABIERTO'
            THEN format('respuesta de texto no permitida para items %s', x.tipo)
        WHEN x.tiene_numero AND x.tipo <> 'NUMERICA'
            THEN format('respuesta numerica no permitida para items %s', x.tipo)
        WHEN x.selecciones > 0 AND x.tipo NOT IN ('OPCION_UNICA', 'OPCION_MULTIPLE', 'VERDADERO_FALSO')
            THEN format('opciones seleccionadas no permitidas para items %s', x.tipo)
        WHEN x.selecciones > 1 AND x.tipo IN ('OPCION_UNICA', 'VERDADERO_FALSO')
            THEN format('items %s admiten a lo sumo una opcion seleccionada (hay %s)', x.tipo, x.selecciones)
    END
    FROM (
        SELECT
            i.tipo_respuesta::TEXT AS tipo,
            NULLIF(btrim(r.respuesta_texto_abierto), '') IS NOT NULL AS tiene_texto,
            r.respuesta_numerica IS NOT NULL AS tiene_numero,
            (
                SELECT count(*)
                FROM opcion_seleccionada_respuesta o
                WHERE o.respuesta_id = r.respuesta_id
            ) AS selecciones
        FROM respuesta_item r
        JOIN item i ON i.item_id = r.item_id
        WHERE r.respuesta_id = p_respuesta_id
    ) x
$$;

-- ============================================================
-- VISTA DE DIAGNOSTICO
-- ============================================================

CREATE OR REPLACE VIEW diagnostico_integridad_dominio AS
SELECT
    'SESION_VERSION_NO_PUBLICADA'::TEXT AS regla,
    'sesion_aplicacion'::TEXT AS tabla,
    sa.sesion_aplicacion_id::TEXT AS fila_id,
    format('version %s en estado %s', v.version_test_id, v.estado) AS detalle
FROM sesion_aplicacion sa
JOIN version_test v ON v.version_test_id = sa.version_test_id
WHERE v.estado NOT IN ('PUBLICADO', 'RETIRADO')

UNION ALL
SELECT
    'INTENTO_SUBTEST_FUERA_DE_SESION',
    'intento_subtest',
    ist.intento_subtest_id::TEXT,
    format('intento %s, sesion_subtest %s, subtest %s', ist.intento_id, ist.sesion_subtest_id, ist.subtest_id)
FROM intento_subtest ist
LEFT JOIN sesion_subtest ss ON ss.sesion_subtest_id = ist.sesion_subtest_id
WHERE ss.subtest_id IS DISTINCT FROM ist.subtest_id
   OR ss.sesion_aplicacion_id IS DISTINCT FROM fn_bfa_sesion_de_intento(ist.intento_id)

UNION ALL
SELECT
    'INTENTO_ULTIMO_SUBTEST_FUERA_DE_SESION',
    'intento_test',
    it.intento_id::TEXT,
    format('ultimo_subtest %s', it.ultimo_subtest_id)
FROM intento_test it
WHERE it.ultimo_subtest_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM sesion_subtest ss
      WHERE ss.sesion_aplicacion_id = fn_bfa_sesion_de_intento(it.intento_id)
        AND ss.subtest_id = it.ultimo_subtest_id
  )

UNION ALL
SELECT
    'RESPUESTA_ITEM_FUERA_DE_SESION',
    'respuesta_item',
    r.respuesta_id::TEXT,
    format('intento %s, item %s, subtest %s', r.intento_id, r.item_id, i.subtest_id)
FROM respuesta_item r
JOIN item i ON i.item_id = r.item_id
WHERE NOT EXISTS (
    SELECT 1
    FROM sesion_subtest ss
    WHERE ss.sesion_aplicacion_id = fn_bfa_sesion_de_intento(r.intento_id)
      AND ss.subtest_id = i.subtest_id
)

UNION ALL
SELECT
    'RESPUESTA_INTENTO_SUBTEST_INCONSISTENTE',
    'respuesta_item',
    r.respuesta_id::TEXT,
    format('intento %s/%s, subtest item %s/intento_subtest %s', r.intento_id, ist.intento_id, i.subtest_id, ist.subtest_id)
FROM respuesta_item r
JOIN item i ON i.item_id = r.item_id
JOIN intento_subtest ist ON ist.intento_subtest_id = r.intento_subtest_id
WHERE ist.intento_id <> r.intento_id
   OR ist.subtest_id <> i.subtest_id

UNION ALL
SELECT
    'RESPUESTA_TIPO_INCOMPATIBLE',
    'respuesta_item',
    r.respuesta_id::TEXT,
    fn_bfa_problema_respuesta(r.respuesta_id)
FROM respuesta_item r
WHERE fn_bfa_problema_respuesta(r.respuesta_id) IS NOT NULL

UNION ALL
SELECT
    'CLAVE_FUERA_DE_ALCANCE_REGLA',
    'clave_respuesta',
    c.clave_respuesta_id::TEXT,
    format('regla %s, item %s', c.regla_calificacion_id, c.item_id)
FROM clave_respuesta c
WHERE NOT fn_bfa_regla_cubre_item(c.regla_calificacion_id, c.item_id)

UNION ALL
SELECT
    'MATRIZ_FUERA_DE_ALCANCE',
    'opcion_puntaje_dimension',
    opd.opcion_puntaje_dimension_id::TEXT,
    format('regla %s, opcion %s, dimension %s', opd.regla_calificacion_id, opd.opcion_id, opd.dimension_resultado_id)
FROM opcion_puntaje_dimension opd
JOIN regla_calificacion r ON r.regla_calificacion_id = opd.regla_calificacion_id
JOIN opcion_item o ON o.opcion_id = opd.opcion_id
JOIN dimension_resultado d ON d.dimension_resultado_id = opd.dimension_resultado_id
WHERE NOT fn_bfa_regla_cubre_item(opd.regla_calificacion_id, o.item_id)
   OR d.version_test_id <> r.version_test_id

UNION ALL
SELECT
    'RESULTADO_DIMENSION_FUERA_DE_VERSION',
    'resultado_dimension',
    rd.resultado_dimension_id::TEXT,
    format('resultado %s, dimension %s, baremo %s', rd.resultado_id, rd.dimension_resultado_id, rd.baremo_id)
FROM resultado_dimension rd
JOIN resultado res ON res.resultado_id = rd.resultado_id
JOIN dimension_resultado d ON d.dimension_resultado_id = rd.dimension_resultado_id
LEFT JOIN baremo b ON b.baremo_id = rd.baremo_id
WHERE d.version_test_id IS DISTINCT FROM fn_bfa_version_de_intento(res.intento_id)
   OR (rd.baremo_id IS NOT NULL AND (
        b.version_test_id <> d.version_test_id
        OR (b.dimension_resultado_id IS NOT NULL AND b.dimension_resultado_id <> rd.dimension_resultado_id)
   ))

UNION ALL
SELECT
    'CALIFICACION_INCONSISTENTE',
    'calificacion_respuesta',
    cr.calificacion_respuesta_id::TEXT,
    format('resultado %s, respuesta %s, regla %s, dimension %s, opcion %s',
        cr.resultado_id, cr.respuesta_id, cr.regla_calificacion_id, cr.dimension_resultado_id, cr.opcion_id)
FROM calificacion_respuesta cr
JOIN resultado res ON res.resultado_id = cr.resultado_id
JOIN respuesta_item r ON r.respuesta_id = cr.respuesta_id
WHERE r.intento_id <> res.intento_id
   OR (cr.regla_calificacion_id IS NOT NULL AND NOT fn_bfa_regla_cubre_item(cr.regla_calificacion_id, r.item_id))
   OR (cr.dimension_resultado_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM dimension_resultado d
        WHERE d.dimension_resultado_id = cr.dimension_resultado_id
          AND d.version_test_id = fn_bfa_version_de_item(r.item_id)
   ))
   OR (cr.opcion_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM opcion_item o
        WHERE o.opcion_id = cr.opcion_id AND o.item_id = r.item_id
   ))

UNION ALL
SELECT
    'REVISION_MANUAL_FUERA_DE_ALCANCE',
    'revision_manual_respuesta',
    rm.revision_manual_respuesta_id::TEXT,
    format('respuesta %s, regla %s', rm.respuesta_id, rm.regla_calificacion_id)
FROM revision_manual_respuesta rm
JOIN respuesta_item r ON r.respuesta_id = rm.respuesta_id
WHERE rm.regla_calificacion_id IS NOT NULL
  AND NOT fn_bfa_regla_cubre_item(rm.regla_calificacion_id, r.item_id)

UNION ALL
SELECT
    'REVISION_RUBRICA_INCONSISTENTE',
    'revision_rubrica_respuesta',
    rr.revision_rubrica_respuesta_id::TEXT,
    format('revision %s, criterio %s, nivel %s', rr.revision_manual_respuesta_id, rr.criterio_rubrica_id, rr.nivel_criterio_rubrica_id)
FROM revision_rubrica_respuesta rr
JOIN revision_manual_respuesta rm ON rm.revision_manual_respuesta_id = rr.revision_manual_respuesta_id
JOIN respuesta_item r ON r.respuesta_id = rm.respuesta_id
LEFT JOIN nivel_criterio_rubrica n ON n.nivel_criterio_rubrica_id = rr.nivel_criterio_rubrica_id
WHERE NOT fn_bfa_criterio_cubre_item(rr.criterio_rubrica_id, r.item_id)
   OR (rr.nivel_criterio_rubrica_id IS NOT NULL AND n.criterio_rubrica_id <> rr.criterio_rubrica_id);

COMMENT ON VIEW diagnostico_integridad_dominio IS
'Lista filas que violan las reglas de integridad de alcance, tipo de respuesta y sesion aplicadas desde 20261122000200. Solo lectura: no corrige ni borra datos.';

-- ============================================================
-- PREVALIDACION
-- ============================================================

CREATE OR REPLACE FUNCTION fn_bfa_prevalidar_integridad()
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_resumen TEXT;
    v_detalle TEXT;
BEGIN
    SELECT
        string_agg(format('%s=%s', regla, total), ', ' ORDER BY regla),
        string_agg(format('%s (%s): %s filas, ejemplos %s', regla, tabla, total, muestras), E'\n' ORDER BY regla)
    INTO v_resumen, v_detalle
    FROM (
        SELECT
            regla,
            tabla,
            count(*) AS total,
            array_to_string((array_agg(fila_id ORDER BY fila_id))[1:5], ', ') AS muestras
        FROM diagnostico_integridad_dominio
        GROUP BY regla, tabla
    ) d;

    IF v_resumen IS NOT NULL THEN
        RAISE EXCEPTION 'Datos historicos incompatibles con la integridad del dominio: %', v_resumen
            USING ERRCODE = 'check_violation',
                  DETAIL = v_detalle,
                  HINT = 'Revise SELECT * FROM diagnostico_integridad_dominio y corrija los datos manualmente; la migracion no borra ni normaliza datos.';
    END IF;
END;
$$;

-- migrations/20261122000200_integridad_dominio.sql
-- ============================================================
-- INTEGRIDAD DEL DOMINIO DE APLICACION Y CONTENIDO OFICIAL
-- ============================================================
-- Preserva el modelo test -> version -> subtest -> item, una version por sesion
-- y un intento por asignacion. Agrega:
--   1. Coherencia de alcance entre intento, sesion, subtest, item, configuracion
--      de calificacion y resultados (FK compuestas donde la estructura lo permite
--      y triggers puntuales donde haria falta cambiar columnas usadas por JPA).
--   2. Compatibilidad del almacenamiento de respuestas con el tipo de respuesta,
--      validada de forma diferida para respetar el patron del backend: guardar
--      respuesta, borrar selecciones y reinsertarlas en la misma transaccion.
--   3. Inmutabilidad del contenido de versiones PUBLICADO/RETIRADO, compatible
--      con el orden de escrituras de VersionTestService.publishVersion.
--   4. Conjunto exacto de opciones correctas (aditivo, convive con la clave
--      singular opcion_correcta_id).
-- Todos los errores usan SQLSTATE de clase 23 (integridad).
-- Requiere 20261122000100_diagnostico_integridad_dominio.sql.

-- Impide escrituras entre el diagnóstico y la instalación de los triggers.
-- Ejecutar esta migración dentro de una transacción.
LOCK TABLE version_test, subtest, item, opcion_item, dimension_resultado,
    regla_calificacion, clave_respuesta, opcion_puntaje_dimension, baremo, rubrica_evaluacion,
    criterio_rubrica, nivel_criterio_rubrica, sesion_aplicacion, sesion_subtest, asignacion_test,
    intento_test, intento_subtest, respuesta_item, opcion_seleccionada_respuesta,
    resultado, resultado_dimension, calificacion_respuesta, revision_manual_respuesta,
    revision_rubrica_respuesta
    IN SHARE ROW EXCLUSIVE MODE;

SELECT fn_bfa_prevalidar_integridad();

-- ============================================================
-- RESTRICCIONES DECLARATIVAS (FK COMPUESTAS)
-- ============================================================

-- intento_subtest.subtest_id debe ser el subtest de su sesion_subtest.
ALTER TABLE sesion_subtest
    ADD CONSTRAINT uq_sesion_subtest_id_subtest UNIQUE (sesion_subtest_id, subtest_id);

ALTER TABLE intento_subtest
    ADD CONSTRAINT fk_intento_subtest_sesion_subtest_subtest
        FOREIGN KEY (sesion_subtest_id, subtest_id)
        REFERENCES sesion_subtest(sesion_subtest_id, subtest_id) ON DELETE RESTRICT;

-- respuesta_item.intento_subtest_id (opcional) debe pertenecer al mismo intento.
ALTER TABLE intento_subtest
    ADD CONSTRAINT uq_intento_subtest_id_intento UNIQUE (intento_subtest_id, intento_id);

ALTER TABLE respuesta_item
    ADD CONSTRAINT fk_respuesta_intento_subtest_intento
        FOREIGN KEY (intento_subtest_id, intento_id)
        REFERENCES intento_subtest(intento_subtest_id, intento_id) ON DELETE CASCADE;

-- El nivel aplicado en una revision de rubrica debe pertenecer a su criterio.
ALTER TABLE nivel_criterio_rubrica
    ADD CONSTRAINT uq_nivel_criterio_id UNIQUE (criterio_rubrica_id, nivel_criterio_rubrica_id);

ALTER TABLE revision_rubrica_respuesta
    ADD CONSTRAINT fk_revision_rubrica_nivel_criterio
        FOREIGN KEY (criterio_rubrica_id, nivel_criterio_rubrica_id)
        REFERENCES nivel_criterio_rubrica(criterio_rubrica_id, nivel_criterio_rubrica_id) ON DELETE RESTRICT;

-- ============================================================
-- CONJUNTO EXACTO DE OPCIONES CORRECTAS
-- ============================================================
-- Politica de convivencia:
--   * usa_conjunto_opciones = FALSE (valor por defecto, el que escribe el backend
--     actual): la clave se interpreta como hasta ahora (opcion_correcta_id,
--     texto, numero o revision manual) y no puede tener filas en
--     clave_respuesta_opcion.
--   * usa_conjunto_opciones = TRUE: la respuesta correcta es exactamente el
--     conjunto de filas de clave_respuesta_opcion (al menos una), solo para items
--     OPCION_MULTIPLE; opcion_correcta_id, texto_esperado y
--     valor_numerico_esperado deben ser NULL para que ningun evaluador de clave
--     singular la interprete parcialmente.
--   * El conjunto se congela junto con la version (ver contenido oficial).
-- La interpretacion (coincidencia exacta, puntaje parcial, etc.) corresponde a
-- la estrategia de calificacion del backend; la base solo garantiza integridad.

ALTER TABLE clave_respuesta
    ADD COLUMN usa_conjunto_opciones BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE clave_respuesta
    ADD CONSTRAINT uq_clave_respuesta_id_item UNIQUE (clave_respuesta_id, item_id);

ALTER TABLE clave_respuesta
    DROP CONSTRAINT ck_clave_tipo;

ALTER TABLE clave_respuesta
    ADD CONSTRAINT ck_clave_tipo CHECK (
        opcion_correcta_id IS NOT NULL
        OR texto_esperado IS NOT NULL
        OR valor_numerico_esperado IS NOT NULL
        OR requiere_revision_manual = TRUE
        OR usa_conjunto_opciones = TRUE
    );

ALTER TABLE clave_respuesta
    ADD CONSTRAINT ck_clave_conjunto_exclusivo CHECK (
        usa_conjunto_opciones = FALSE
        OR (opcion_correcta_id IS NULL AND texto_esperado IS NULL AND valor_numerico_esperado IS NULL)
    );

CREATE TABLE clave_respuesta_opcion (
    clave_respuesta_id BIGINT NOT NULL,
    item_id BIGINT NOT NULL,
    opcion_id BIGINT NOT NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (clave_respuesta_id, opcion_id),
    FOREIGN KEY (clave_respuesta_id, item_id)
        REFERENCES clave_respuesta(clave_respuesta_id, item_id) ON DELETE CASCADE,
    FOREIGN KEY (item_id, opcion_id)
        REFERENCES opcion_item(item_id, opcion_id) ON DELETE RESTRICT
);

CREATE INDEX idx_clave_respuesta_opcion_opcion ON clave_respuesta_opcion(item_id, opcion_id);

COMMENT ON TABLE clave_respuesta_opcion IS
'Conjunto exacto de opciones correctas de una clave con usa_conjunto_opciones = TRUE (items OPCION_MULTIPLE). Convive con la clave singular opcion_correcta_id, que queda NULL en estas claves.';

COMMENT ON COLUMN clave_respuesta.usa_conjunto_opciones IS
'TRUE: la respuesta correcta es exactamente el conjunto en clave_respuesta_opcion. FALSE (por defecto): clave singular historica.';

-- ============================================================
-- FUNCIONES DE SOPORTE
-- ============================================================

-- Indica si una version tiene contenido oficial congelado. Bloquea la fila de
-- la version en modo compartido para serializar con publicaciones concurrentes
-- (VersionTestService toma FOR UPDATE sobre la version antes de escribir).
CREATE OR REPLACE FUNCTION fn_bfa_version_congelada(p_version_test_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
    v_estado estado_version_test;
BEGIN
    IF p_version_test_id IS NULL THEN
        RETURN FALSE;
    END IF;
    SELECT estado INTO v_estado
    FROM version_test
    WHERE version_test_id = p_version_test_id
    FOR SHARE;
    RETURN COALESCE(v_estado IN ('PUBLICADO', 'RETIRADO'), FALSE);
END;
$$;

-- Resuelve la version propietaria de una fila de contenido de instrumento.
CREATE OR REPLACE FUNCTION fn_bfa_version_de_contenido(p_tabla TEXT, p_fila JSONB)
RETURNS BIGINT
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    CASE p_tabla
        WHEN 'subtest', 'dimension_resultado', 'regla_calificacion', 'baremo', 'rubrica_evaluacion' THEN
            RETURN (p_fila->>'version_test_id')::BIGINT;
        WHEN 'item' THEN
            RETURN (SELECT s.version_test_id FROM subtest s
                    WHERE s.subtest_id = (p_fila->>'subtest_id')::BIGINT);
        WHEN 'opcion_item', 'imagen_item' THEN
            RETURN fn_bfa_version_de_item((p_fila->>'item_id')::BIGINT);
        WHEN 'imagen_opcion' THEN
            RETURN (SELECT fn_bfa_version_de_item(o.item_id) FROM opcion_item o
                    WHERE o.opcion_id = (p_fila->>'opcion_id')::BIGINT);
        WHEN 'clave_respuesta', 'opcion_puntaje_dimension' THEN
            RETURN (SELECT r.version_test_id FROM regla_calificacion r
                    WHERE r.regla_calificacion_id = (p_fila->>'regla_calificacion_id')::BIGINT);
        WHEN 'clave_respuesta_opcion' THEN
            RETURN (SELECT r.version_test_id FROM clave_respuesta c
                    JOIN regla_calificacion r ON r.regla_calificacion_id = c.regla_calificacion_id
                    WHERE c.clave_respuesta_id = (p_fila->>'clave_respuesta_id')::BIGINT);
        WHEN 'rango_baremo' THEN
            RETURN (SELECT b.version_test_id FROM baremo b
                    WHERE b.baremo_id = (p_fila->>'baremo_id')::BIGINT);
        WHEN 'criterio_rubrica' THEN
            RETURN (SELECT ru.version_test_id FROM rubrica_evaluacion ru
                    WHERE ru.rubrica_id = (p_fila->>'rubrica_id')::BIGINT);
        WHEN 'nivel_criterio_rubrica' THEN
            RETURN (SELECT ru.version_test_id FROM criterio_rubrica c
                    JOIN rubrica_evaluacion ru ON ru.rubrica_id = c.rubrica_id
                    WHERE c.criterio_rubrica_id = (p_fila->>'criterio_rubrica_id')::BIGINT);
        ELSE
            RAISE EXCEPTION 'Tabla de contenido no soportada: %', p_tabla;
    END CASE;
END;
$$;

-- ============================================================
-- INMUTABILIDAD DEL CONTENIDO OFICIAL
-- ============================================================
-- Las versiones PUBLICADO/RETIRADO no admiten altas, bajas ni cambios en su
-- contenido. Las actualizaciones sin cambios reales (flush de JPA con los
-- mismos valores) se permiten. Las versiones APROBADO siguen siendo escribibles
-- en SQL porque publishVersion publica reglas y baremos antes de cambiar la
-- version a PUBLICADO.

CREATE OR REPLACE FUNCTION tg_bfa_proteger_contenido_oficial()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND to_jsonb(NEW) = to_jsonb(OLD) THEN
        RETURN NEW;
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE')
       AND fn_bfa_version_congelada(fn_bfa_version_de_contenido(TG_TABLE_NAME, to_jsonb(OLD))) THEN
        RAISE EXCEPTION 'Contenido oficial inmutable: % pertenece a una version publicada o retirada', TG_TABLE_NAME
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE')
       AND fn_bfa_version_congelada(fn_bfa_version_de_contenido(TG_TABLE_NAME, to_jsonb(NEW))) THEN
        RAISE EXCEPTION 'Contenido oficial inmutable: % pertenece a una version publicada o retirada', TG_TABLE_NAME
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DO $$
DECLARE
    v_tabla TEXT;
BEGIN
    FOREACH v_tabla IN ARRAY ARRAY[
        'subtest', 'dimension_resultado', 'item', 'opcion_item', 'imagen_item', 'imagen_opcion',
        'regla_calificacion', 'clave_respuesta', 'clave_respuesta_opcion', 'opcion_puntaje_dimension',
        'baremo', 'rango_baremo', 'rubrica_evaluacion', 'criterio_rubrica', 'nivel_criterio_rubrica'
    ] LOOP
        EXECUTE format(
            'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I '
            'FOR EACH ROW EXECUTE FUNCTION tg_bfa_proteger_contenido_oficial()',
            'tg_' || v_tabla || '_contenido_oficial',
            v_tabla
        );
    END LOOP;
END;
$$;

-- Metadatos de recursos enlazados a contenido oficial. El borrado ya esta
-- impedido por las FK ON DELETE RESTRICT de imagen_item/imagen_opcion.
CREATE OR REPLACE FUNCTION tg_bfa_proteger_recurso_oficial()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF to_jsonb(NEW) = to_jsonb(OLD) THEN
        RETURN NEW;
    END IF;
    IF EXISTS (
        SELECT 1 FROM imagen_item ii
        WHERE ii.recurso_id = OLD.recurso_id
          AND fn_bfa_version_congelada(fn_bfa_version_de_item(ii.item_id))
    ) OR EXISTS (
        SELECT 1 FROM imagen_opcion io
        JOIN opcion_item o ON o.opcion_id = io.opcion_id
        WHERE io.recurso_id = OLD.recurso_id
          AND fn_bfa_version_congelada(fn_bfa_version_de_item(o.item_id))
    ) THEN
        RAISE EXCEPTION 'Contenido oficial inmutable: recurso_multimedia % esta enlazado a una version publicada o retirada', OLD.recurso_id
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_recurso_multimedia_contenido_oficial
    BEFORE UPDATE ON recurso_multimedia
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_proteger_recurso_oficial();

-- Transiciones de la propia version:
--   PUBLICADO -> PUBLICADO (sin cambios) o RETIRADO, cambiando solo estado.
--   RETIRADO  -> sin cambios.
--   No se borran versiones PUBLICADO/RETIRADO.
-- Retirar no modifica reglas, baremos ni rubricas: la configuracion historica
-- conserva sus estados.
CREATE OR REPLACE FUNCTION tg_bfa_proteger_version_oficial()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.estado IN ('PUBLICADO', 'RETIRADO') THEN
            RAISE EXCEPTION 'Contenido oficial inmutable: no se elimina la version % en estado %', OLD.version_test_id, OLD.estado
                USING ERRCODE = 'restrict_violation';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.estado = 'RETIRADO' AND to_jsonb(NEW) <> to_jsonb(OLD) THEN
        RAISE EXCEPTION 'Contenido oficial inmutable: la version % esta retirada', OLD.version_test_id
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.estado = 'PUBLICADO' AND (
        NEW.estado NOT IN ('PUBLICADO', 'RETIRADO')
        OR to_jsonb(NEW) - 'estado' <> to_jsonb(OLD) - 'estado'
    ) THEN
        RAISE EXCEPTION 'Contenido oficial inmutable: la version publicada % solo puede pasar a RETIRADO', OLD.version_test_id
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_version_test_contenido_oficial
    BEFORE UPDATE OR DELETE ON version_test
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_proteger_version_oficial();

-- ============================================================
-- COLUMNAS DE PERTENENCIA FIJAS
-- ============================================================
-- Reasignar una fila a otro padre podria invalidar relaciones ya validadas.
-- El backend nunca cambia estas columnas (las actualizaciones completas de JPA
-- reescriben el mismo valor, lo cual se permite).

CREATE OR REPLACE FUNCTION tg_bfa_columnas_fijas()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_columna TEXT;
BEGIN
    FOREACH v_columna IN ARRAY TG_ARGV LOOP
        IF to_jsonb(NEW)->v_columna IS DISTINCT FROM to_jsonb(OLD)->v_columna THEN
            RAISE EXCEPTION 'La columna %.% no puede modificarse', TG_TABLE_NAME, v_columna
                USING ERRCODE = 'restrict_violation';
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_subtest_columnas_fijas BEFORE UPDATE ON subtest
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_columnas_fijas('version_test_id');
CREATE TRIGGER tg_dimension_resultado_columnas_fijas BEFORE UPDATE ON dimension_resultado
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_columnas_fijas('version_test_id');
CREATE TRIGGER tg_regla_calificacion_columnas_fijas BEFORE UPDATE ON regla_calificacion
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_columnas_fijas('version_test_id');
CREATE TRIGGER tg_clave_respuesta_opcion_columnas_fijas BEFORE UPDATE ON clave_respuesta_opcion
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_columnas_fijas('clave_respuesta_id');
CREATE TRIGGER tg_baremo_columnas_fijas BEFORE UPDATE ON baremo
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_columnas_fijas('version_test_id');
CREATE TRIGGER tg_rubrica_evaluacion_columnas_fijas BEFORE UPDATE ON rubrica_evaluacion
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_columnas_fijas('version_test_id');
CREATE TRIGGER tg_criterio_rubrica_columnas_fijas BEFORE UPDATE ON criterio_rubrica
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_columnas_fijas('rubrica_id');
CREATE TRIGGER tg_sesion_subtest_columnas_fijas BEFORE UPDATE ON sesion_subtest
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_columnas_fijas('sesion_aplicacion_id', 'version_test_id');
CREATE TRIGGER tg_asignacion_test_columnas_fijas BEFORE UPDATE ON asignacion_test
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_columnas_fijas('sesion_aplicacion_id');
CREATE TRIGGER tg_intento_test_columnas_fijas BEFORE UPDATE ON intento_test
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_columnas_fijas('asignacion_id');
CREATE TRIGGER tg_intento_subtest_columnas_fijas BEFORE UPDATE ON intento_subtest
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_columnas_fijas('intento_id', 'sesion_subtest_id', 'subtest_id');
CREATE TRIGGER tg_respuesta_item_columnas_fijas BEFORE UPDATE ON respuesta_item
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_columnas_fijas('intento_id', 'item_id');
CREATE TRIGGER tg_resultado_columnas_fijas BEFORE UPDATE ON resultado
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_columnas_fijas('intento_id');
CREATE TRIGGER tg_revision_manual_respuesta_columnas_fijas BEFORE UPDATE ON revision_manual_respuesta
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_columnas_fijas('respuesta_id');

-- ============================================================
-- SESIONES: VERSION PUBLICADA Y CONFIGURACION APLICADA
-- ============================================================

-- Una sesion solo se crea (o cambia de version) sobre una version PUBLICADO, y
-- no cambia de version una vez que tiene asignaciones. Asi el contenido usado
-- por respuestas reales siempre esta congelado.
CREATE OR REPLACE FUNCTION tg_bfa_validar_sesion_version()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.version_test_id = OLD.version_test_id THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND EXISTS (
        SELECT 1 FROM asignacion_test a WHERE a.sesion_aplicacion_id = OLD.sesion_aplicacion_id
    ) THEN
        RAISE EXCEPTION 'La sesion % ya tiene asignaciones y no puede cambiar de version', OLD.sesion_aplicacion_id
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM version_test v
        WHERE v.version_test_id = NEW.version_test_id
          AND v.estado = 'PUBLICADO'
    ) THEN
        RAISE EXCEPTION 'La sesion requiere una version PUBLICADO (version %)', NEW.version_test_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_sesion_aplicacion_version
    BEFORE INSERT OR UPDATE OF version_test_id ON sesion_aplicacion
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_validar_sesion_version();

-- Una sesion con intentos ya fue aplicada: sus subtests no se agregan, quitan ni
-- reconfiguran. Antes del primer intento (PROGRAMADA con o sin asignaciones) se
-- permite configurar libremente, como hace SessionManagementService.
CREATE OR REPLACE FUNCTION tg_bfa_proteger_sesion_aplicada()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_sesiones BIGINT[] := ARRAY[]::BIGINT[];
BEGIN
    IF TG_OP = 'UPDATE' AND to_jsonb(NEW) = to_jsonb(OLD) THEN
        RETURN NEW;
    END IF;
    IF TG_OP <> 'INSERT' THEN
        v_sesiones := array_append(v_sesiones, OLD.sesion_aplicacion_id);
    END IF;
    IF TG_OP <> 'DELETE' THEN
        v_sesiones := array_append(v_sesiones, NEW.sesion_aplicacion_id);
    END IF;
    IF EXISTS (
        SELECT 1
        FROM asignacion_test a
        JOIN intento_test it ON it.asignacion_id = a.asignacion_id
        WHERE a.sesion_aplicacion_id = ANY (v_sesiones)
    ) THEN
        RAISE EXCEPTION 'La sesion ya tiene intentos: no se reconfiguran sus subtests'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_sesion_subtest_sesion_aplicada
    BEFORE INSERT OR UPDATE OR DELETE ON sesion_subtest
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_proteger_sesion_aplicada();

-- ============================================================
-- ALCANCE DE INTENTOS Y RESPUESTAS
-- ============================================================

CREATE OR REPLACE FUNCTION tg_bfa_validar_intento_subtest()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- El subtest coincide con sesion_subtest por FK; aqui se exige la sesion.
    IF NOT EXISTS (
        SELECT 1 FROM sesion_subtest ss
        WHERE ss.sesion_subtest_id = NEW.sesion_subtest_id
          AND ss.sesion_aplicacion_id = fn_bfa_sesion_de_intento(NEW.intento_id)
    ) THEN
        RAISE EXCEPTION 'intento_subtest: la sesion_subtest % no pertenece a la sesion del intento %', NEW.sesion_subtest_id, NEW.intento_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_intento_subtest_alcance
    BEFORE INSERT ON intento_subtest
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_validar_intento_subtest();

CREATE OR REPLACE FUNCTION tg_bfa_validar_intento_ultimo_subtest()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.ultimo_subtest_id IS NULL
       OR (TG_OP = 'UPDATE' AND NEW.ultimo_subtest_id IS NOT DISTINCT FROM OLD.ultimo_subtest_id) THEN
        RETURN NEW;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM asignacion_test a
        JOIN sesion_subtest ss ON ss.sesion_aplicacion_id = a.sesion_aplicacion_id
        WHERE a.asignacion_id = NEW.asignacion_id
          AND ss.subtest_id = NEW.ultimo_subtest_id
    ) THEN
        RAISE EXCEPTION 'intento_test: el subtest % no esta configurado en la sesion del intento %', NEW.ultimo_subtest_id, NEW.intento_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_intento_test_alcance
    BEFORE INSERT OR UPDATE OF ultimo_subtest_id ON intento_test
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_validar_intento_ultimo_subtest();

-- respuesta_item: el item debe pertenecer a un subtest configurado en la sesion
-- del intento (por FK de sesion_subtest, eso implica la version de la sesion).
-- Si intento_subtest_id se informa, debe ser del mismo intento (FK compuesta) y
-- del mismo subtest del item. NULL sigue permitido para el backend actual.
CREATE OR REPLACE FUNCTION tg_bfa_validar_respuesta_alcance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_subtest_id BIGINT;
BEGIN
    SELECT i.subtest_id INTO v_subtest_id FROM item i WHERE i.item_id = NEW.item_id;

    -- FOR KEY SHARE impide quitar o reasignar la sesion_subtest mientras la
    -- transaccion que guarda la respuesta sigue abierta.
    PERFORM 1
    FROM sesion_subtest ss
    WHERE ss.sesion_aplicacion_id = fn_bfa_sesion_de_intento(NEW.intento_id)
      AND ss.subtest_id = v_subtest_id
    FOR KEY SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'respuesta_item: el item % no pertenece a un subtest configurado en la sesion del intento %', NEW.item_id, NEW.intento_id
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.intento_subtest_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM intento_subtest ist
        WHERE ist.intento_subtest_id = NEW.intento_subtest_id
          AND ist.subtest_id = v_subtest_id
    ) THEN
        RAISE EXCEPTION 'respuesta_item: el intento_subtest % no corresponde al subtest del item %', NEW.intento_subtest_id, NEW.item_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_respuesta_item_alcance
    BEFORE INSERT OR UPDATE OF intento_subtest_id ON respuesta_item
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_validar_respuesta_alcance();

-- ============================================================
-- ALMACENAMIENTO POR TIPO DE RESPUESTA (DIFERIDO)
-- ============================================================
-- Se valida al confirmar la transaccion (DEFERRABLE INITIALLY DEFERRED) porque
-- ParticipantAnswerService actualiza la respuesta, borra sus selecciones y las
-- reinserta, y Hibernate puede emitir las inserciones antes que los borrados.
-- Una escritura en el padre serializa los cambios de las selecciones, incluso
-- en REPEATABLE READ, donde un bloqueo sin escritura permite validar dos
-- cambios concurrentes contra instantáneas antiguas.

CREATE OR REPLACE FUNCTION tg_bfa_validar_almacenamiento_respuesta()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_problema TEXT;
BEGIN
    IF TG_TABLE_NAME = 'opcion_seleccionada_respuesta' THEN
        -- La validación diferida que dispara este UPDATE no vuelve a escribir.
        UPDATE respuesta_item SET es_final = es_final WHERE respuesta_id = NEW.respuesta_id;
    ELSE
        PERFORM 1 FROM respuesta_item WHERE respuesta_id = NEW.respuesta_id FOR NO KEY UPDATE;
    END IF;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    v_problema := fn_bfa_problema_respuesta(NEW.respuesta_id);
    IF v_problema IS NOT NULL THEN
        RAISE EXCEPTION 'respuesta_item %: %', NEW.respuesta_id, v_problema
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER tg_respuesta_item_almacenamiento
    AFTER INSERT OR UPDATE ON respuesta_item
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_validar_almacenamiento_respuesta();

CREATE CONSTRAINT TRIGGER tg_opcion_seleccionada_respuesta_almacenamiento
    AFTER INSERT OR UPDATE ON opcion_seleccionada_respuesta
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_validar_almacenamiento_respuesta();

-- ============================================================
-- ALCANCE DE CONFIGURACION DE CALIFICACION
-- ============================================================

CREATE OR REPLACE FUNCTION tg_bfa_validar_clave_alcance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT fn_bfa_regla_cubre_item(NEW.regla_calificacion_id, NEW.item_id) THEN
        RAISE EXCEPTION 'clave_respuesta: el item % esta fuera del alcance de la regla %', NEW.item_id, NEW.regla_calificacion_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_clave_respuesta_alcance
    BEFORE INSERT OR UPDATE ON clave_respuesta
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_validar_clave_alcance();

CREATE OR REPLACE FUNCTION tg_bfa_validar_matriz_alcance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT fn_bfa_regla_cubre_item(
        NEW.regla_calificacion_id,
        (SELECT o.item_id FROM opcion_item o WHERE o.opcion_id = NEW.opcion_id)
    ) THEN
        RAISE EXCEPTION 'opcion_puntaje_dimension: la opcion % esta fuera del alcance de la regla %', NEW.opcion_id, NEW.regla_calificacion_id
            USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM dimension_resultado d
        JOIN regla_calificacion r ON r.version_test_id = d.version_test_id
        WHERE d.dimension_resultado_id = NEW.dimension_resultado_id
          AND r.regla_calificacion_id = NEW.regla_calificacion_id
    ) THEN
        RAISE EXCEPTION 'opcion_puntaje_dimension: la dimension % no pertenece a la version de la regla %', NEW.dimension_resultado_id, NEW.regla_calificacion_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_opcion_puntaje_dimension_alcance
    BEFORE INSERT OR UPDATE ON opcion_puntaje_dimension
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_validar_matriz_alcance();

-- Coherencia diferida entre usa_conjunto_opciones y clave_respuesta_opcion:
-- permite insertar la clave y luego sus opciones en la misma transaccion.
CREATE OR REPLACE FUNCTION tg_bfa_validar_conjunto_clave()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_clave_id BIGINT := CASE WHEN TG_OP = 'DELETE' THEN OLD.clave_respuesta_id ELSE NEW.clave_respuesta_id END;
    v_usa_conjunto BOOLEAN;
    v_tipo tipo_respuesta;
    v_opciones INT;
BEGIN
    IF TG_TABLE_NAME = 'clave_respuesta_opcion' THEN
        -- Dos borrados concurrentes no pueden dejar vacía la clave de conjunto.
        UPDATE clave_respuesta SET usa_conjunto_opciones = usa_conjunto_opciones
        WHERE clave_respuesta_id = v_clave_id;
    END IF;
    SELECT c.usa_conjunto_opciones, i.tipo_respuesta
    INTO v_usa_conjunto, v_tipo
    FROM clave_respuesta c
    JOIN item i ON i.item_id = c.item_id
    WHERE c.clave_respuesta_id = v_clave_id
    FOR NO KEY UPDATE OF c;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    SELECT count(*) INTO v_opciones
    FROM clave_respuesta_opcion cro
    WHERE cro.clave_respuesta_id = v_clave_id;

    IF v_usa_conjunto AND v_opciones = 0 THEN
        RAISE EXCEPTION 'clave_respuesta %: usa_conjunto_opciones requiere al menos una opcion en clave_respuesta_opcion', v_clave_id
            USING ERRCODE = 'check_violation';
    END IF;
    IF NOT v_usa_conjunto AND v_opciones > 0 THEN
        RAISE EXCEPTION 'clave_respuesta %: tiene opciones de conjunto pero usa_conjunto_opciones es FALSE', v_clave_id
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_usa_conjunto AND v_tipo <> 'OPCION_MULTIPLE' THEN
        RAISE EXCEPTION 'clave_respuesta %: el conjunto de opciones correctas solo aplica a items OPCION_MULTIPLE', v_clave_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER tg_clave_respuesta_conjunto
    AFTER INSERT OR UPDATE ON clave_respuesta
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_validar_conjunto_clave();

CREATE CONSTRAINT TRIGGER tg_clave_respuesta_opcion_conjunto
    AFTER INSERT OR UPDATE OR DELETE ON clave_respuesta_opcion
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_validar_conjunto_clave();

-- ============================================================
-- ALCANCE DE RESULTADOS Y REVISIONES
-- ============================================================

CREATE OR REPLACE FUNCTION tg_bfa_validar_resultado_dimension()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_version_id BIGINT;
BEGIN
    SELECT fn_bfa_version_de_intento(res.intento_id) INTO v_version_id
    FROM resultado res WHERE res.resultado_id = NEW.resultado_id;

    IF NOT EXISTS (
        SELECT 1 FROM dimension_resultado d
        WHERE d.dimension_resultado_id = NEW.dimension_resultado_id
          AND d.version_test_id = v_version_id
    ) THEN
        RAISE EXCEPTION 'resultado_dimension: la dimension % no pertenece a la version del intento', NEW.dimension_resultado_id
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.baremo_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM baremo b
        WHERE b.baremo_id = NEW.baremo_id
          AND b.version_test_id = v_version_id
          AND (b.dimension_resultado_id IS NULL OR b.dimension_resultado_id = NEW.dimension_resultado_id)
    ) THEN
        RAISE EXCEPTION 'resultado_dimension: el baremo % no corresponde a la version o dimension del resultado', NEW.baremo_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_resultado_dimension_alcance
    BEFORE INSERT OR UPDATE ON resultado_dimension
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_validar_resultado_dimension();

CREATE OR REPLACE FUNCTION tg_bfa_validar_calificacion_respuesta()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_intento_id BIGINT;
    v_item_id BIGINT;
BEGIN
    SELECT r.intento_id, r.item_id INTO v_intento_id, v_item_id
    FROM respuesta_item r WHERE r.respuesta_id = NEW.respuesta_id;

    IF v_intento_id IS DISTINCT FROM (SELECT res.intento_id FROM resultado res WHERE res.resultado_id = NEW.resultado_id) THEN
        RAISE EXCEPTION 'calificacion_respuesta: la respuesta % no pertenece al intento del resultado %', NEW.respuesta_id, NEW.resultado_id
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.regla_calificacion_id IS NOT NULL AND NOT fn_bfa_regla_cubre_item(NEW.regla_calificacion_id, v_item_id) THEN
        RAISE EXCEPTION 'calificacion_respuesta: la regla % no cubre el item %', NEW.regla_calificacion_id, v_item_id
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.dimension_resultado_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM dimension_resultado d
        WHERE d.dimension_resultado_id = NEW.dimension_resultado_id
          AND d.version_test_id = fn_bfa_version_de_item(v_item_id)
    ) THEN
        RAISE EXCEPTION 'calificacion_respuesta: la dimension % no pertenece a la version del item %', NEW.dimension_resultado_id, v_item_id
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.opcion_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM opcion_item o WHERE o.opcion_id = NEW.opcion_id AND o.item_id = v_item_id
    ) THEN
        RAISE EXCEPTION 'calificacion_respuesta: la opcion % no pertenece al item %', NEW.opcion_id, v_item_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_calificacion_respuesta_alcance
    BEFORE INSERT OR UPDATE ON calificacion_respuesta
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_validar_calificacion_respuesta();

CREATE OR REPLACE FUNCTION tg_bfa_validar_revision_manual()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.regla_calificacion_id IS NOT NULL AND NOT fn_bfa_regla_cubre_item(
        NEW.regla_calificacion_id,
        (SELECT r.item_id FROM respuesta_item r WHERE r.respuesta_id = NEW.respuesta_id)
    ) THEN
        RAISE EXCEPTION 'revision_manual_respuesta: la regla % no cubre el item de la respuesta %', NEW.regla_calificacion_id, NEW.respuesta_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_revision_manual_respuesta_alcance
    BEFORE INSERT OR UPDATE ON revision_manual_respuesta
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_validar_revision_manual();

CREATE OR REPLACE FUNCTION tg_bfa_validar_revision_rubrica()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- El nivel pertenece al criterio por FK compuesta; aqui se exige el alcance.
    IF NOT fn_bfa_criterio_cubre_item(
        NEW.criterio_rubrica_id,
        (SELECT r.item_id
         FROM revision_manual_respuesta rm
         JOIN respuesta_item r ON r.respuesta_id = rm.respuesta_id
         WHERE rm.revision_manual_respuesta_id = NEW.revision_manual_respuesta_id)
    ) THEN
        RAISE EXCEPTION 'revision_rubrica_respuesta: la rubrica del criterio % no cubre el item revisado', NEW.criterio_rubrica_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_revision_rubrica_respuesta_alcance
    BEFORE INSERT OR UPDATE ON revision_rubrica_respuesta
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_validar_revision_rubrica();

-- ============================================================
-- REVALIDACION ANTE CAMBIOS DE PADRES
-- ============================================================
-- Cambios permitidos en versiones no congeladas que podrian invalidar filas
-- dependientes ya validadas.

-- regla_calificacion: cambio de alcance (subtest/item).
CREATE OR REPLACE FUNCTION tg_bfa_revalidar_regla()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.subtest_id IS NOT DISTINCT FROM OLD.subtest_id AND NEW.item_id IS NOT DISTINCT FROM OLD.item_id THEN
        RETURN NULL;
    END IF;
    IF EXISTS (
        SELECT 1 FROM clave_respuesta c
        WHERE c.regla_calificacion_id = NEW.regla_calificacion_id
          AND NOT fn_bfa_regla_cubre_item(NEW.regla_calificacion_id, c.item_id)
    ) OR EXISTS (
        SELECT 1 FROM opcion_puntaje_dimension opd
        JOIN opcion_item o ON o.opcion_id = opd.opcion_id
        WHERE opd.regla_calificacion_id = NEW.regla_calificacion_id
          AND NOT fn_bfa_regla_cubre_item(NEW.regla_calificacion_id, o.item_id)
    ) OR EXISTS (
        SELECT 1 FROM calificacion_respuesta cr
        JOIN respuesta_item r ON r.respuesta_id = cr.respuesta_id
        WHERE cr.regla_calificacion_id = NEW.regla_calificacion_id
          AND NOT fn_bfa_regla_cubre_item(NEW.regla_calificacion_id, r.item_id)
    ) OR EXISTS (
        SELECT 1 FROM revision_manual_respuesta rm
        JOIN respuesta_item r ON r.respuesta_id = rm.respuesta_id
        WHERE rm.regla_calificacion_id = NEW.regla_calificacion_id
          AND NOT fn_bfa_regla_cubre_item(NEW.regla_calificacion_id, r.item_id)
    ) THEN
        RAISE EXCEPTION 'regla_calificacion %: el nuevo alcance deja claves, matriz o calificaciones fuera de alcance', NEW.regla_calificacion_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER tg_regla_calificacion_revalidar
    AFTER UPDATE OF subtest_id, item_id ON regla_calificacion
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_revalidar_regla();

-- rubrica_evaluacion: cambio de alcance (subtest/item).
CREATE OR REPLACE FUNCTION tg_bfa_revalidar_rubrica()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.subtest_id IS NOT DISTINCT FROM OLD.subtest_id AND NEW.item_id IS NOT DISTINCT FROM OLD.item_id THEN
        RETURN NULL;
    END IF;
    IF EXISTS (
        SELECT 1
        FROM revision_rubrica_respuesta rr
        JOIN criterio_rubrica c ON c.criterio_rubrica_id = rr.criterio_rubrica_id
        JOIN revision_manual_respuesta rm ON rm.revision_manual_respuesta_id = rr.revision_manual_respuesta_id
        JOIN respuesta_item r ON r.respuesta_id = rm.respuesta_id
        WHERE c.rubrica_id = NEW.rubrica_id
          AND NOT fn_bfa_criterio_cubre_item(rr.criterio_rubrica_id, r.item_id)
    ) THEN
        RAISE EXCEPTION 'rubrica_evaluacion %: el nuevo alcance deja revisiones fuera de alcance', NEW.rubrica_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER tg_rubrica_evaluacion_revalidar
    AFTER UPDATE OF subtest_id, item_id ON rubrica_evaluacion
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_revalidar_rubrica();

-- item: el backend puede reasignar un item a otro subtest de la misma version
-- en borrador (saveConfiguration). Se exige misma version, que no haya
-- respuestas y que claves/matriz sigan en alcance. El tipo de respuesta no
-- cambia si hay respuestas o si contradice un conjunto de opciones correctas.
CREATE OR REPLACE FUNCTION tg_bfa_revalidar_item()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.subtest_id IS DISTINCT FROM OLD.subtest_id THEN
        IF (SELECT s.version_test_id FROM subtest s WHERE s.subtest_id = NEW.subtest_id)
           IS DISTINCT FROM (SELECT s.version_test_id FROM subtest s WHERE s.subtest_id = OLD.subtest_id) THEN
            RAISE EXCEPTION 'item %: no puede moverse a un subtest de otra version', NEW.item_id
                USING ERRCODE = 'restrict_violation';
        END IF;
        IF EXISTS (SELECT 1 FROM respuesta_item r WHERE r.item_id = NEW.item_id) THEN
            RAISE EXCEPTION 'item %: tiene respuestas y no puede cambiar de subtest', NEW.item_id
                USING ERRCODE = 'restrict_violation';
        END IF;
        IF EXISTS (
            SELECT 1 FROM clave_respuesta c
            WHERE c.item_id = NEW.item_id
              AND NOT fn_bfa_regla_cubre_item(c.regla_calificacion_id, c.item_id)
        ) OR EXISTS (
            SELECT 1 FROM opcion_puntaje_dimension opd
            JOIN opcion_item o ON o.opcion_id = opd.opcion_id
            WHERE o.item_id = NEW.item_id
              AND NOT fn_bfa_regla_cubre_item(opd.regla_calificacion_id, o.item_id)
        ) THEN
            RAISE EXCEPTION 'item %: el cambio de subtest deja claves o matriz fuera del alcance de su regla', NEW.item_id
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    IF NEW.tipo_respuesta IS DISTINCT FROM OLD.tipo_respuesta THEN
        IF EXISTS (SELECT 1 FROM respuesta_item r WHERE r.item_id = NEW.item_id) THEN
            RAISE EXCEPTION 'item %: tiene respuestas y no puede cambiar de tipo de respuesta', NEW.item_id
                USING ERRCODE = 'restrict_violation';
        END IF;
        IF NEW.tipo_respuesta <> 'OPCION_MULTIPLE' AND EXISTS (
            SELECT 1 FROM clave_respuesta c
            WHERE c.item_id = NEW.item_id AND c.usa_conjunto_opciones
        ) THEN
            RAISE EXCEPTION 'item %: tiene un conjunto de opciones correctas y debe seguir siendo OPCION_MULTIPLE', NEW.item_id
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER tg_item_revalidar
    AFTER UPDATE OF subtest_id, tipo_respuesta ON item
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_revalidar_item();

-- opcion_item: el backend puede reasignar una opcion a otro item en borrador.
-- Claves, selecciones y conjuntos ya lo impiden por FK compuesta; aqui se
-- exige misma version y se revalidan matriz y calificaciones.
CREATE OR REPLACE FUNCTION tg_bfa_revalidar_opcion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.item_id IS NOT DISTINCT FROM OLD.item_id THEN
        RETURN NULL;
    END IF;
    IF fn_bfa_version_de_item(NEW.item_id) IS DISTINCT FROM fn_bfa_version_de_item(OLD.item_id) THEN
        RAISE EXCEPTION 'opcion_item %: no puede moverse a un item de otra version', NEW.opcion_id
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF EXISTS (
        SELECT 1 FROM opcion_puntaje_dimension opd
        WHERE opd.opcion_id = NEW.opcion_id
          AND NOT fn_bfa_regla_cubre_item(opd.regla_calificacion_id, NEW.item_id)
    ) OR EXISTS (
        SELECT 1 FROM calificacion_respuesta cr
        WHERE cr.opcion_id = NEW.opcion_id
    ) THEN
        RAISE EXCEPTION 'opcion_item %: el cambio de item deja matriz o calificaciones inconsistentes', NEW.opcion_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER tg_opcion_item_revalidar
    AFTER UPDATE OF item_id ON opcion_item
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_revalidar_opcion();

-- baremo: cambio de dimension con resultados ya asociados.
CREATE OR REPLACE FUNCTION tg_bfa_revalidar_baremo()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.dimension_resultado_id IS NOT NULL
       AND NEW.dimension_resultado_id IS DISTINCT FROM OLD.dimension_resultado_id
       AND EXISTS (
           SELECT 1 FROM resultado_dimension rd
           WHERE rd.baremo_id = NEW.baremo_id
             AND rd.dimension_resultado_id <> NEW.dimension_resultado_id
       ) THEN
        RAISE EXCEPTION 'baremo %: el cambio de dimension deja resultados inconsistentes', NEW.baremo_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER tg_baremo_revalidar
    AFTER UPDATE OF dimension_resultado_id ON baremo
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_revalidar_baremo();

COMMENT ON FUNCTION tg_bfa_proteger_contenido_oficial() IS
'Bloquea altas, bajas y cambios del contenido de versiones PUBLICADO/RETIRADO. Las actualizaciones sin cambios se permiten.';

COMMENT ON FUNCTION tg_bfa_validar_almacenamiento_respuesta() IS
'Validacion diferida: OPCION_UNICA y VERDADERO_FALSO admiten a lo sumo una seleccion, OPCION_MULTIPLE varias; texto solo en TEXTO_ABIERTO y numero solo en NUMERICA. La respuesta vacia es valida.';

-- migrations/20261124000100_pausa_sesion.sql
-- Pausa y reanudacion de sesiones de aplicacion (1/2).
-- ALTER TYPE ... ADD VALUE va en una migracion propia: el nuevo valor no puede
-- usarse en la misma transaccion en que se agrega.
ALTER TYPE estado_sesion_aplicacion ADD VALUE IF NOT EXISTS 'PAUSADA' AFTER 'ABIERTA';

-- migrations/20261124000200_pausa_sesion_tabla.sql
-- Pausa y reanudacion de sesiones de aplicacion (2/2): historial de pausas.
CREATE TABLE pausa_sesion (
    pausa_sesion_id BIGSERIAL PRIMARY KEY,
    sesion_aplicacion_id BIGINT NOT NULL REFERENCES sesion_aplicacion(sesion_aplicacion_id) ON DELETE CASCADE,
    pausado_en TIMESTAMP NOT NULL,
    reanudado_en TIMESTAMP,
    pausado_por UUID REFERENCES usuario(usuario_id),
    reanudado_por UUID REFERENCES usuario(usuario_id),
    motivo VARCHAR(300),
    CONSTRAINT ck_pausa_fechas CHECK (reanudado_en IS NULL OR reanudado_en >= pausado_en)
);

CREATE INDEX idx_pausa_sesion_sesion ON pausa_sesion(sesion_aplicacion_id);

-- Como maximo una pausa abierta por sesion.
CREATE UNIQUE INDEX ux_pausa_sesion_abierta ON pausa_sesion(sesion_aplicacion_id) WHERE reanudado_en IS NULL;

COMMENT ON TABLE pausa_sesion IS
'Historial de pausas de una sesion de aplicacion. Una fila con reanudado_en NULL es la pausa en curso.';

-- Una pausa no cambia de sesion, inicio, autor ni motivo; solo se cierra
-- (reanudado_en / reanudado_por). Mismo patron que 20261122000200_integridad_dominio.sql.
CREATE TRIGGER tg_pausa_sesion_columnas_fijas BEFORE UPDATE ON pausa_sesion
    FOR EACH ROW EXECUTE FUNCTION tg_bfa_columnas_fijas('sesion_aplicacion_id', 'pausado_en', 'pausado_por', 'motivo');

-- migrations/20261126000100_orden_deferrable.sql
-- Permite intercambiar o rotar posiciones ocupadas dentro de una misma
-- transaccion, posponiendo la validacion de unicidad hasta el COMMIT.
DO $$
DECLARE
    v_spec RECORD;
    v_conname TEXT;
    v_ya_deferrable BOOLEAN;
BEGIN
    FOR v_spec IN
        SELECT *
        FROM (VALUES
            ('subtest',        'version_test_id',      'numero_orden', 'uq_subtest_version_orden'),
            ('item',           'subtest_id',           'numero_orden', 'uq_item_subtest_orden'),
            ('imagen_item',    'item_id',              'numero_orden', 'uq_imagen_item_orden'),
            ('opcion_item',    'item_id',              'numero_orden', 'uq_opcion_item_orden'),
            ('imagen_opcion',  'opcion_id',            'numero_orden', 'uq_imagen_opcion_orden'),
            ('sesion_subtest', 'sesion_aplicacion_id', 'numero_orden', 'uq_sesion_subtest_orden')
        ) AS t(tabla, col1, col2, nuevo_nombre)
    LOOP
        SELECT EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class cl ON cl.oid = c.conrelid
            JOIN pg_namespace ns ON ns.oid = cl.relnamespace
            WHERE ns.nspname = 'public'
              AND cl.relname = v_spec.tabla
              AND c.contype = 'u'
              AND c.condeferrable
              AND c.condeferred
              AND (
                  SELECT array_agg(a.attname::text ORDER BY u.ord)
                  FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
                  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum
              ) = ARRAY[v_spec.col1, v_spec.col2]
        ) INTO v_ya_deferrable;

        IF v_ya_deferrable THEN
            CONTINUE;
        END IF;

        FOR v_conname IN
            SELECT c.conname
            FROM pg_constraint c
            JOIN pg_class cl ON cl.oid = c.conrelid
            JOIN pg_namespace ns ON ns.oid = cl.relnamespace
            WHERE ns.nspname = 'public'
              AND cl.relname = v_spec.tabla
              AND c.contype = 'u'
              AND (
                  c.conname = v_spec.nuevo_nombre
                  OR (
                      SELECT array_agg(a.attname::text ORDER BY u.ord)
                      FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
                      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum
                  ) = ARRAY[v_spec.col1, v_spec.col2]
              )
        LOOP
            EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', v_spec.tabla, v_conname);
        END LOOP;

        EXECUTE format(
            'ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (%I, %I) DEFERRABLE INITIALLY DEFERRED',
            v_spec.tabla,
            v_spec.nuevo_nombre,
            v_spec.col1,
            v_spec.col2
        );
    END LOOP;
END;
$$;

-- migrations/20261126000200_revision_manual_unica.sql
-- B23: una sola revision manual por respuesta.
-- La calificacion crea la revision PENDIENTE de cada respuesta con revision manual y debe ser idempotente
-- al recalificar. UNIQUE (respuesta_id, regla_calificacion_id) no lo garantiza cuando regla_calificacion_id
-- es NULL (revisiones creadas a mano), por eso se agrega un indice unico solo por respuesta.

-- Deduplica antes de crear el indice: conserva una fila por respuesta, prefiriendo la ya REVISADO y,
-- despues, la mas reciente. Las filas de revision_rubrica_respuesta de las eliminadas caen en cascada.
DELETE FROM revision_manual_respuesta r
USING (
    SELECT revision_manual_respuesta_id,
           ROW_NUMBER() OVER (
               PARTITION BY respuesta_id
               ORDER BY (estado = 'REVISADO') DESC, creado_en DESC, revision_manual_respuesta_id DESC
           ) AS posicion
    FROM revision_manual_respuesta
) d
WHERE r.revision_manual_respuesta_id = d.revision_manual_respuesta_id
  AND d.posicion > 1;

CREATE UNIQUE INDEX IF NOT EXISTS ux_revision_manual_respuesta_unica
    ON revision_manual_respuesta(respuesta_id);

-- migrations/20261126000300_rbac_catalogo_y_supervision.sql
-- B12: permisos de solo catalogo (Aplicador) y de supervision (Psicologo/Coordinador).
-- INSTRUMENTO_CATALOGO_LEER: listar tests, versiones publicadas y subtests para programar sesiones, sin ver items, opciones ni claves.
-- SESION_LEER: consultar sesiones, asignaciones y su progreso (lectura explicita, sin operar la sesion).
INSERT INTO permiso (codigo_permiso, descripcion) VALUES
('INSTRUMENTO_CATALOGO_LEER', 'Listar tests, versiones publicadas y subtests para programar sesiones'),
('SESION_LEER', 'Consultar sesiones, asignaciones y su progreso')
ON CONFLICT (codigo_permiso) DO UPDATE SET descripcion = EXCLUDED.descripcion;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.rol_id, p.permiso_id
FROM rol r
CROSS JOIN permiso p
WHERE r.nombre_rol = 'ADMINISTRADOR'
   OR (r.nombre_rol = 'APLICADOR' AND p.codigo_permiso IN (
        'INSTRUMENTO_CATALOGO_LEER'
   ))
   OR (r.nombre_rol = 'PSICOLOGO_COORDINADOR' AND p.codigo_permiso IN (
        'SESION_LEER', 'PARTICIPANTE_LEER', 'INSTRUMENTO_CATALOGO_LEER'
   ))
ON CONFLICT DO NOTHING;

-- migrations/20261126000400_idx_intento_estado_fin.sql
CREATE INDEX IF NOT EXISTS idx_intento_estado_fin
    ON intento_test(estado, finalizado_en);

-- migrations/20261126000500_respuesta_rechazada.sql
-- B17: bitacora de respuestas rechazadas por bulk-sync (TIEMPO_AGOTADO, tipo incompatible, item inexistente...).
-- Hasta ahora solo se devolvian al participante; con esta tabla el monitor de sesion las muestra al staff.
-- Una fila por (intento, item, codigo): repetir el mismo rechazo incrementa "veces" (upsert ON CONFLICT en el
-- backend). La UNIQUE NO es DEFERRABLE porque ON CONFLICT no admite restricciones diferibles. item_id no tiene FK
-- porque el rechazo puede ser, justamente, por un item inexistente. Idempotente.
CREATE TABLE IF NOT EXISTS respuesta_rechazada (
    respuesta_rechazada_id BIGSERIAL PRIMARY KEY,
    intento_id BIGINT NOT NULL REFERENCES intento_test(intento_id) ON DELETE CASCADE,
    item_id BIGINT NOT NULL,
    codigo VARCHAR(60) NOT NULL,
    rechazado_en TIMESTAMP NOT NULL,
    veces INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_respuesta_rechazada UNIQUE (intento_id, item_id, codigo)
);

-- migrations/20261126000600_recurso_clave_subida.sql
ALTER TABLE public.recurso_multimedia
    ADD COLUMN IF NOT EXISTS clave_subida VARCHAR(128);

CREATE UNIQUE INDEX IF NOT EXISTS ux_recurso_multimedia_clave_subida
    ON public.recurso_multimedia(clave_subida);

-- migrations/20261126000700_codigos_deferrable.sql
-- Permite reutilizar codigos en el arbol de configuracion dentro de una misma
-- transaccion (borrar y crear en el mismo guardado), posponiendo la validacion
-- de unicidad hasta el COMMIT.
DO $$
DECLARE
    v_spec RECORD;
    v_conname TEXT;
    v_ya_deferrable BOOLEAN;
    v_tiene_fk BOOLEAN;
BEGIN
    FOR v_spec IN
        SELECT *
        FROM (VALUES
            ('subtest',                'version_test_id',     'codigo_subtest',   'uq_subtest_version_codigo'),
            ('dimension_resultado',    'version_test_id',     'codigo_dimension', 'uq_dimension_version_codigo'),
            ('item',                   'subtest_id',          'codigo_item',      'uq_item_subtest_codigo'),
            ('opcion_item',            'item_id',             'codigo_opcion',    'uq_opcion_item_codigo'),
            ('rubrica_evaluacion',     'version_test_id',     'codigo_rubrica',   'uq_rubrica_version_codigo'),
            ('criterio_rubrica',       'rubrica_id',          'codigo_criterio',  'uq_criterio_rubrica_codigo'),
            ('nivel_criterio_rubrica', 'criterio_rubrica_id', 'codigo_nivel',     'uq_nivel_criterio_codigo')
        ) AS t(tabla, col1, col2, nuevo_nombre)
    LOOP
        SELECT EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class cl ON cl.oid = c.conrelid
            JOIN pg_namespace ns ON ns.oid = cl.relnamespace
            WHERE ns.nspname = 'public'
              AND cl.relname = v_spec.tabla
              AND c.contype = 'u'
              AND c.condeferrable
              AND c.condeferred
              AND (
                  SELECT array_agg(a.attname::text ORDER BY u.ord)
                  FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
                  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum
              ) = ARRAY[v_spec.col1, v_spec.col2]
        ) INTO v_ya_deferrable;

        IF v_ya_deferrable THEN
            CONTINUE;
        END IF;

        SELECT EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class cl ON cl.oid = c.conrelid
            JOIN pg_namespace ns ON ns.oid = cl.relnamespace
            JOIN pg_constraint fk ON fk.confrelid = cl.oid AND fk.contype = 'f'
            WHERE ns.nspname = 'public'
              AND cl.relname = v_spec.tabla
              AND c.contype = 'u'
              AND (
                  SELECT array_agg(a.attname::text ORDER BY u.ord)
                  FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
                  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum
              ) = ARRAY[v_spec.col1, v_spec.col2]
              AND fk.confkey = c.conkey
        ) INTO v_tiene_fk;

        IF v_tiene_fk THEN
            RAISE NOTICE 'Se omite %.% porque es referenciada por una FK', v_spec.tabla, v_spec.nuevo_nombre;
            CONTINUE;
        END IF;

        FOR v_conname IN
            SELECT c.conname
            FROM pg_constraint c
            JOIN pg_class cl ON cl.oid = c.conrelid
            JOIN pg_namespace ns ON ns.oid = cl.relnamespace
            WHERE ns.nspname = 'public'
              AND cl.relname = v_spec.tabla
              AND c.contype = 'u'
              AND (
                  c.conname = v_spec.nuevo_nombre
                  OR (
                      SELECT array_agg(a.attname::text ORDER BY u.ord)
                      FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
                      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum
                  ) = ARRAY[v_spec.col1, v_spec.col2]
              )
        LOOP
            EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', v_spec.tabla, v_conname);
        END LOOP;

        EXECUTE format(
            'ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (%I, %I) DEFERRABLE INITIALLY DEFERRED',
            v_spec.tabla,
            v_spec.nuevo_nombre,
            v_spec.col1,
            v_spec.col2
        );
    END LOOP;
END;
$$;

-- migrations/20261126000800_backfill_revision_manual.sql
-- B23: backfill de revisiones manuales de intentos ya calificados.
-- Los resultados calificados antes de B23 tienen calificaciones pendientes de revision manual
-- (calificacion_respuesta.requiere_revision_manual = TRUE) sin fila en revision_manual_respuesta, asi que nunca
-- entraban en la bandeja y la interfaz oculta recalificar. Se crea una revision PENDIENTE por cada respuesta en esa
-- situacion. Idempotente: no toca respuestas que ya tienen revision (en cualquier estado) y es compatible con el
-- indice unico ux_revision_manual_respuesta_unica (una revision por respuesta).
INSERT INTO revision_manual_respuesta (respuesta_id, regla_calificacion_id, estado, creado_en)
SELECT DISTINCT ON (c.respuesta_id)
       c.respuesta_id,
       c.regla_calificacion_id,
       'PENDIENTE',
       CURRENT_TIMESTAMP
FROM calificacion_respuesta c
WHERE c.requiere_revision_manual = TRUE
  AND NOT EXISTS (
      SELECT 1
      FROM revision_manual_respuesta rm
      WHERE rm.respuesta_id = c.respuesta_id
  )
ORDER BY c.respuesta_id, c.calificacion_respuesta_id DESC;

-- seed.sql
-- Seed data is managed by versioned migrations in supabase/migrations.

COMMIT;

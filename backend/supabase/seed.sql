-- ============================================================
-- SEED DE DEMOSTRACION E2E — BFA Digital
-- ============================================================
-- Datos ficticios para recorrer el flujo completo del sistema:
--   configuracion de instrumentos -> publicacion -> sesiones -> asignaciones
--   -> intentos y respuestas -> calificacion -> resultados -> reportes/auditoria.
--
-- Se ejecuta automaticamente con `supabase db reset` (config.toml -> [db.seed]).
-- Requiere una base recien migrada y SIN datos de negocio (aborta si ya hay
-- participantes). Todas las fechas son relativas al momento de ejecucion (UTC,
-- igual que el Clock del backend), asi la demo siempre luce "reciente".
--
-- ------------------------------------------------------------
-- CREDENCIALES (todas las cuentas: contrasena  Demo2026! )
-- ------------------------------------------------------------
--   admin        ADMINISTRADOR
--   psicologa    PSICOLOGO_COORDINADOR   (configura, califica, ve resultados)
--   aplicador    APLICADOR               (sesiones S-04 y S-05 en vivo)
--   aplicadora   APLICADOR
--   consultor    CONSULTOR_REPORTES
--   ex.aplicador APLICADOR (INACTIVO: el login debe fallar)
--
-- ------------------------------------------------------------
-- CODIGOS DE ACCESO DE PARTICIPANTES  (formato  asignacionId-token)
-- ------------------------------------------------------------
-- Todos los tokens son 'DEMO' + id de asignacion. Los utiles para probar en vivo:
--   S-04 BFA ABIERTA   401-DEMO401 (Sebastian, sin iniciar)
--                      402-DEMO402 (Paola, sin iniciar)
--                      403-DEMO403 (Javier, sin iniciar)
--                      404-DEMO404 (Natalia, EN PROGRESO: termino Figuras identicas)
--                      405-DEMO405 (Daniela, COMPLETADO hoy, pendiente de calificar)
--   S-05 RV PAUSADA    501-DEMO501 (Sofia, subtest en curso congelado por la pausa)
--                      502-DEMO502 (Luis, sin iniciar; escribir falla hasta reanudar)
--   S-06 RV PROGRAMADA 601-DEMO601 .. 603-DEMO603 (acceso rechazado: sesion no abierta)
--
-- ------------------------------------------------------------
-- HISTORIA DE LA DEMO
-- ------------------------------------------------------------
--   Instrumentos
--     BFA v1.0  PUBLICADO  Figuras identicas / Desplazamiento / Espacial (8 items c/u)
--     BFA v1.1  BORRADOR   en edicion (2 subtests, sin publicar)
--     RV  v1.0  PUBLICADO  Sinonimos / Analogias (6 items c/u)
--   Sesiones
--     S-01 BFA Psicologia        CERRADA     7 calificados + 1 token vencido
--     S-02 BFA Ingenieria/Med.   CERRADA     6 calificados + 1 revocado (con 1 pausa)
--     S-03 RV Adm./Derecho       CERRADA     5 calificados + 1 pendiente de calificar
--     S-04 BFA en curso          ABIERTA     3 sin iniciar, 1 en progreso, 1 completo
--     S-05 RV en curso           PAUSADA     pausa abierta (corte de energia)
--     S-06 RV Psicologia         PROGRAMADA  3 asignados para la proxima semana
--     S-07 BFA Medicina          CANCELADA
--   Imagenes: los items usan simbolos Unicode (sin archivos en Storage) para no
--   depender del bucket privado. Se pueden subir imagenes desde la UI de la v1.1.
-- ============================================================

BEGIN;

SET search_path = public, extensions;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM participante) OR EXISTS (SELECT 1 FROM usuario) THEN
        RAISE EXCEPTION 'seed.sql requiere una base sin datos de negocio. Ejecute: supabase db reset';
    END IF;
END;
$$;

-- Referencias temporales usadas por todo el seed.
CREATE TEMP TABLE seed_ref ON COMMIT DROP AS
SELECT
    (now() AT TIME ZONE 'UTC')                             AS ahora,
    date_trunc('day', now() AT TIME ZONE 'UTC')            AS hoy,
    (SELECT estrategia_calificacion_id FROM estrategia_calificacion WHERE codigo = 'CLAVE_SIMPLE') AS est_clave;

-- ============================================================
-- 1. USUARIOS DEL PERSONAL Y ROLES
-- ============================================================

INSERT INTO usuario (usuario_id, nombre_usuario, correo, hash_contrasena, nombre_completo, estado, creado_en, actualizado_en)
SELECT u.id::uuid, u.usr, u.correo, crypt('Demo2026!', gen_salt('bf', 10)), u.nombre, u.estado::estado_general,
       r.hoy - u.antig, r.hoy - u.antig
FROM seed_ref r,
(VALUES
    ('a0000000-0000-4000-8000-000000000001', 'admin',        'admin@bfa-demo.local',        'Administrador del Sistema', 'ACTIVO',   interval '120 days'),
    ('a0000000-0000-4000-8000-000000000002', 'psicologa',    'laura.mendez@bfa-demo.local', 'Dra. Laura Mendez',         'ACTIVO',   interval '110 days'),
    ('a0000000-0000-4000-8000-000000000003', 'aplicador',    'roberto.salazar@bfa-demo.local', 'Lic. Roberto Salazar',   'ACTIVO',   interval '100 days'),
    ('a0000000-0000-4000-8000-000000000004', 'aplicadora',   'karla.ramirez@bfa-demo.local', 'Lic. Karla Ramirez',       'ACTIVO',   interval '95 days'),
    ('a0000000-0000-4000-8000-000000000005', 'consultor',    'jorge.paredes@bfa-demo.local', 'MSc. Jorge Paredes',       'ACTIVO',   interval '60 days'),
    ('a0000000-0000-4000-8000-000000000006', 'ex.aplicador', 'ex.aplicador@bfa-demo.local', 'Lic. Mario Urbina',         'INACTIVO', interval '200 days')
) AS u(id, usr, correo, nombre, estado, antig);

INSERT INTO usuario_rol (usuario_id, rol_id)
SELECT u.id::uuid, r.rol_id
FROM (VALUES
    ('a0000000-0000-4000-8000-000000000001', 'ADMINISTRADOR'),
    ('a0000000-0000-4000-8000-000000000002', 'PSICOLOGO_COORDINADOR'),
    ('a0000000-0000-4000-8000-000000000003', 'APLICADOR'),
    ('a0000000-0000-4000-8000-000000000004', 'APLICADOR'),
    ('a0000000-0000-4000-8000-000000000005', 'CONSULTOR_REPORTES'),
    ('a0000000-0000-4000-8000-000000000006', 'APLICADOR')
) AS u(id, rol)
JOIN rol r ON r.nombre_rol = u.rol;

-- ============================================================
-- 2. CATALOGOS ACADEMICOS (catalogo_sexo ya viene de las migraciones)
-- ============================================================

INSERT INTO carrera (carrera_id, codigo_carrera, nombre_carrera, estado) VALUES
(1, 'PSI', 'Psicologia', 'ACTIVO'),
(2, 'ISC', 'Ingenieria en Sistemas de Computacion', 'ACTIVO'),
(3, 'MED', 'Medicina', 'ACTIVO'),
(4, 'ADM', 'Administracion de Empresas', 'ACTIVO'),
(5, 'DER', 'Derecho', 'ACTIVO');

INSERT INTO cohorte (cohorte_id, codigo_cohorte, nombre_cohorte, anio, periodo, estado) VALUES
(1, '2024-I', 'Ingreso 2024 - Primer semestre', 2024, 'I', 'ACTIVO'),
(2, '2025-I', 'Ingreso 2025 - Primer semestre', 2025, 'I', 'ACTIVO'),
(3, '2026-I', 'Ingreso 2026 - Primer semestre', 2026, 'I', 'ACTIVO');

INSERT INTO grupo_academico (grupo_academico_id, carrera_id, codigo_grupo, nombre_grupo, estado) VALUES
(1, 1, 'PSI-1A', 'Psicologia 1er anio - Grupo A', 'ACTIVO'),
(2, 1, 'PSI-2A', 'Psicologia 2do anio - Grupo A', 'ACTIVO'),
(3, 2, 'ISC-1A', 'Sistemas 1er anio - Grupo A', 'ACTIVO'),
(4, 2, 'ISC-2A', 'Sistemas 2do anio - Grupo A', 'ACTIVO'),
(5, 3, 'MED-1A', 'Medicina 1er anio - Grupo A', 'ACTIVO'),
(6, 4, 'ADM-2A', 'Administracion 2do anio - Grupo A', 'ACTIVO'),
(7, 4, 'ADM-3A', 'Administracion 3er anio - Grupo A', 'ACTIVO'),
(8, 5, 'DER-2A', 'Derecho 2do anio - Grupo A', 'ACTIVO'),
(9, 5, 'DER-3A', 'Derecho 3er anio - Grupo A', 'INACTIVO');

-- ============================================================
-- 3. PARTICIPANTES (20)
-- ============================================================
-- "habilidad" solo se usa en este seed para generar respuestas verosimiles.

CREATE TEMP TABLE seed_participante ON COMMIT DROP AS
SELECT n,
       ('b0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid AS participante_id,
       nombres, apellidos, nacimiento::date AS nacimiento, sexo, carrera, cohorte, grupo, estado, habilidad::numeric AS habilidad
FROM (VALUES
    ( 1, 'Maria Jose',      'Perez Gutierrez',   '2006-03-14', 'F',  'PSI', '2026-I', 'PSI-1A', 'ACTIVO',   0.82),
    ( 2, 'Carlos Andres',   'Lopez Martinez',    '2005-07-22', 'M',  'PSI', '2026-I', 'PSI-1A', 'ACTIVO',   0.64),
    ( 3, 'Ana Lucia',       'Rodriguez Silva',   '2006-11-02', 'F',  'PSI', '2026-I', 'PSI-1A', 'ACTIVO',   0.71),
    ( 4, 'Jose Daniel',     'Hernandez Castillo','2004-01-30', 'M',  'PSI', '2026-I', 'PSI-1A', 'ACTIVO',   0.45),
    ( 5, 'Valeria',         'Morales Rivas',     '2005-05-18', 'F',  'PSI', '2025-I', 'PSI-2A', 'ACTIVO',   0.92),
    ( 6, 'Diego Alejandro', 'Ruiz Ortega',       '2005-09-09', 'M',  'PSI', '2025-I', 'PSI-2A', 'ACTIVO',   0.36),
    ( 7, 'Sofia Isabel',    'Chavez Mendoza',    '2006-02-25', 'F',  'ISC', '2026-I', 'ISC-1A', 'ACTIVO',   0.77),
    ( 8, 'Luis Fernando',   'Gomez Arana',       '2006-06-11', 'M',  'ISC', '2026-I', 'ISC-1A', 'ACTIVO',   0.86),
    ( 9, 'Camila',          'Torres Baez',       '2005-12-05', 'F',  'ISC', '2026-I', 'ISC-1A', 'ACTIVO',   0.58),
    (10, 'Andres Felipe',   'Vargas Solis',      '2004-08-19', 'M',  'ISC', '2025-I', 'ISC-2A', 'ACTIVO',   0.69),
    (11, 'Gabriela',        'Castro Nunez',      '2005-04-03', 'F',  'ISC', '2025-I', 'ISC-2A', 'ACTIVO',   0.52),
    (12, 'Mateo',           'Jimenez Lacayo',    '2006-10-27', 'M',  'MED', '2026-I', 'MED-1A', 'ACTIVO',   0.80),
    (13, 'Daniela',         'Flores Zamora',     '2006-01-16', 'F',  'MED', '2026-I', 'MED-1A', 'ACTIVO',   0.61),
    (14, 'Sebastian',       'Aguilar Rocha',     '2005-03-08', 'M',  'MED', '2026-I', 'MED-1A', 'ACTIVO',   0.66),
    (15, 'Fernanda',        'Reyes Obando',      '2004-12-12', 'F',  'ADM', '2024-I', 'ADM-3A', 'ACTIVO',   0.55),
    (16, 'Ricardo',         'Mejia Somarriba',   '2003-07-07', 'M',  'ADM', '2024-I', 'ADM-3A', 'ACTIVO',   0.48),
    (17, 'Paola Alejandra', 'Sandoval Cruz',     '2005-08-29', 'F',  'ADM', '2025-I', 'ADM-2A', 'ACTIVO',   0.73),
    (18, 'Javier',          'Espinoza Duarte',   '2004-02-14', 'M',  'DER', '2024-I', 'DER-3A', 'ACTIVO',   0.62),
    (19, 'Natalia',         'Guevara Tellez',    '2005-11-21', 'ND', 'DER', '2025-I', 'DER-2A', 'ACTIVO',   0.57),
    (20, 'Emilio',          'Cerda Palacios',    '2003-05-01', 'M',  'DER', '2024-I', 'DER-3A', 'INACTIVO', 0.50)
) AS p(n, nombres, apellidos, nacimiento, sexo, carrera, cohorte, grupo, estado, habilidad);

INSERT INTO participante (participante_id, codigo_participante, nombres, apellidos, fecha_nacimiento,
                          sexo_id, carrera_id, cohorte_id, grupo_academico_id, estado, creado_en, actualizado_en)
SELECT p.participante_id, 'UAM-' || p.cohorte || '-' || lpad(p.n::text, 4, '0'), p.nombres, p.apellidos, p.nacimiento,
       s.sexo_id, c.carrera_id, co.cohorte_id, g.grupo_academico_id, p.estado::estado_general,
       r.hoy - interval '45 days' + p.n * interval '1 hour', r.hoy - interval '45 days' + p.n * interval '1 hour'
FROM seed_participante p
CROSS JOIN seed_ref r
JOIN catalogo_sexo s ON s.codigo = p.sexo
JOIN carrera c ON c.codigo_carrera = p.carrera
JOIN cohorte co ON co.codigo_cohorte = p.cohorte
JOIN grupo_academico g ON g.codigo_grupo = p.grupo AND g.carrera_id = c.carrera_id;

-- ============================================================
-- 4. INSTRUMENTOS: TESTS, VERSIONES, SUBTESTS, ITEMS, OPCIONES
-- ============================================================
-- Las versiones nacen APROBADO (o BORRADOR), se carga su contenido y al final
-- se pasan a PUBLICADO: el trigger de contenido oficial congela todo lo publicado.

INSERT INTO test (test_id, codigo_test, nombre_test, descripcion, creado_por, estado, creado_en)
SELECT t.id, t.codigo, t.nombre, t.descr, 'a0000000-0000-4000-8000-000000000002'::uuid, 'ACTIVO', r.hoy - interval '90 days'
FROM seed_ref r, (VALUES
    (1, 'BFA', 'Bateria Factorial de Aptitudes', 'Subtests de aptitud perceptiva y espacial digitalizados para la carrera de Psicologia.'),
    (2, 'RV',  'Prueba de Razonamiento Verbal',  'Instrumento complementario de comprension y razonamiento con palabras.')
) AS t(id, codigo, nombre, descr);

INSERT INTO version_test (version_test_id, test_id, estrategia_calificacion_id, numero_version, estado,
                          instrucciones_generales, tiempo_limite_segundos, aprobado_por, aprobado_en, creado_por, creado_en)
SELECT v.id, v.test_id, r.est_clave, v.num, v.estado::estado_version_test, v.instr, v.tiempo,
       CASE WHEN v.estado = 'APROBADO' THEN 'a0000000-0000-4000-8000-000000000002'::uuid END,
       CASE WHEN v.estado = 'APROBADO' THEN r.hoy - v.antig + interval '5 days' END,
       'a0000000-0000-4000-8000-000000000002'::uuid, r.hoy - v.antig
FROM seed_ref r, (VALUES
    (1, 1, '1.0', 'APROBADO', 'Lea con atencion las instrucciones de cada subtest. Trabaje rapido y con precision; no se descuentan puntos por errores.', 900, interval '80 days'),
    (2, 1, '1.1', 'BORRADOR', 'Version en revision con nuevos items de Figuras identicas.', 900, interval '6 days'),
    (3, 2, '1.0', 'APROBADO', 'Elija la opcion que mejor complete cada enunciado.', 420, interval '60 days')
) AS v(id, test_id, num, estado, instr, tiempo, antig);

INSERT INTO subtest (subtest_id, version_test_id, estrategia_calificacion_id, codigo_subtest, nombre_subtest,
                     descripcion, instrucciones, numero_orden, tiempo_limite_segundos)
SELECT s.id, s.version_id, r.est_clave, s.codigo, s.nombre, s.descr, s.instr, s.orden, s.tiempo
FROM seed_ref r, (VALUES
    (1, 1, 'FI',  'Figuras identicas', 'Rapidez perceptiva: identificar la figura igual al modelo.',
        'Observe el modelo y seleccione la opcion EXACTAMENTE igual. Solo una opcion es correcta.', 1, 180),
    (2, 1, 'DES', 'Desplazamiento', 'Rotacion y desplazamiento mental de figuras.',
        'Imagine el movimiento indicado y elija como queda la figura al final.', 2, 240),
    (3, 1, 'ESP', 'Espacial', 'Razonamiento espacial con cuerpos y vistas.',
        'Resuelva mentalmente cada situacion espacial y marque la respuesta correcta.', 3, 300),
    (4, 2, 'FI',  'Figuras identicas (revision 1.1)', 'Nuevos modelos de mayor dificultad.',
        'Observe el modelo y seleccione la opcion exactamente igual.', 1, 180),
    (5, 2, 'ESP', 'Espacial (revision 1.1)', 'Items espaciales en evaluacion piloto.',
        'Resuelva mentalmente cada situacion espacial.', 2, 300),
    (6, 3, 'SIN', 'Sinonimos', 'Vocabulario: palabra de significado equivalente.',
        'Elija la palabra que significa lo MISMO que la palabra en mayusculas.', 1, 180),
    (7, 3, 'ANA', 'Analogias', 'Relaciones entre conceptos.',
        'Complete la analogia eligiendo la palabra que mantiene la misma relacion.', 2, 240)
) AS s(id, version_id, codigo, nombre, descr, instr, orden, tiempo);

-- item_id = subtest*100 + orden ; opcion_id = item*10 + orden de opcion.
CREATE TEMP TABLE seed_item ON COMMIT DROP AS
SELECT subtest_id * 100 + orden AS item_id, subtest_id, orden, tipo_item, enunciado, correcta, opciones
FROM (VALUES
    -- Figuras identicas (v1.0)
    (1, 1, 'SOLO_TEXTO', 'Modelo:  ▲ ● ■ ◆',      1, ARRAY['▲ ● ■ ◆', '▲ ■ ● ◆', '● ▲ ■ ◆', '▲ ● ◆ ■']),
    (1, 2, 'SOLO_TEXTO', 'Modelo:  ◐ ◑ ◒ ◓',      2, ARRAY['◐ ◒ ◑ ◓', '◐ ◑ ◒ ◓', '◑ ◐ ◒ ◓', '◐ ◑ ◓ ◒']),
    (1, 3, 'SOLO_TEXTO', 'Modelo:  ★ ☆ ★ ★',      4, ARRAY['★ ★ ☆ ★', '★ ☆ ☆ ★', '☆ ★ ★ ★', '★ ☆ ★ ★']),
    (1, 4, 'SOLO_TEXTO', 'Modelo:  △ ▽ △ △',      2, ARRAY['▽ △ △ △', '△ ▽ △ △', '△ △ ▽ △', '△ ▽ ▽ △']),
    (1, 5, 'SOLO_TEXTO', 'Modelo:  ┌ ┐ └ ┘',      3, ARRAY['┌ └ ┐ ┘', '┐ ┌ └ ┘', '┌ ┐ └ ┘', '┌ ┐ ┘ └']),
    (1, 6, 'SOLO_TEXTO', 'Modelo:  ◢ ◣ ◤ ◥',      1, ARRAY['◢ ◣ ◤ ◥', '◣ ◢ ◤ ◥', '◢ ◤ ◣ ◥', '◢ ◣ ◥ ◤']),
    (1, 7, 'SOLO_TEXTO', 'Modelo:  ○ ● ○ ○ ●',    3, ARRAY['○ ● ● ○ ●', '● ○ ○ ○ ●', '○ ● ○ ○ ●', '○ ● ○ ● ○']),
    (1, 8, 'SOLO_TEXTO', 'Modelo:  ▣ ▢ ▣ ▢ ▣',    4, ARRAY['▣ ▣ ▢ ▢ ▣', '▢ ▣ ▣ ▢ ▣', '▣ ▢ ▢ ▣ ▣', '▣ ▢ ▣ ▢ ▣']),
    -- Desplazamiento (v1.0)
    (2, 1, 'SOLO_TEXTO', 'La figura ▶ gira 90° en sentido horario. ¿Como queda?',            2, ARRAY['◀', '▼', '▲', '▶']),
    (2, 2, 'SOLO_TEXTO', 'La figura ▲ gira 180°. ¿Como queda?',                              3, ARRAY['▶', '◀', '▼', '▲']),
    (2, 3, 'SOLO_TEXTO', 'La figura ◀ gira 90° en sentido horario. ¿Como queda?',            1, ARRAY['▲', '▼', '▶', '◀']),
    (2, 4, 'SOLO_TEXTO', 'La flecha ↗ gira 90° en sentido horario. ¿Como queda?',            4, ARRAY['↖', '↙', '↗', '↘']),
    (2, 5, 'SOLO_TEXTO', 'La flecha ↑ gira 270° en sentido horario. ¿Como queda?',           2, ARRAY['→', '←', '↓', '↑']),
    (2, 6, 'SOLO_TEXTO', 'La figura ◣ gira 90° en sentido horario. ¿Como queda?',            3, ARRAY['◢', '◥', '◤', '◣']),
    (2, 7, 'SOLO_TEXTO', 'La secuencia ■ □ □ se desplaza una posicion a la derecha (circular).', 1, ARRAY['□ ■ □', '□ □ ■', '■ □ □', '■ ■ □']),
    (2, 8, 'SOLO_TEXTO', 'La secuencia ● ○ ○ ○ se desplaza dos posiciones a la derecha (circular).', 4, ARRAY['○ ● ○ ○', '○ ○ ○ ●', '● ○ ○ ○', '○ ○ ● ○']),
    -- Espacial (v1.0)
    (3, 1, 'TEXTO_E_IMAGEN', 'Un cubo pintado por fuera se corta en 27 cubitos iguales. ¿Cuantos cubitos tienen exactamente 3 caras pintadas?', 2, ARRAY['6', '8', '12', '1']),
    (3, 2, 'TEXTO_E_IMAGEN', 'Con el mismo cubo de 27 cubitos, ¿cuantos tienen exactamente 2 caras pintadas?', 3, ARRAY['8', '6', '12', '24']),
    (3, 3, 'TEXTO_E_IMAGEN', 'Con el mismo cubo de 27 cubitos, ¿cuantos no tienen ninguna cara pintada?',     1, ARRAY['1', '0', '3', '6']),
    (3, 4, 'SOLO_TEXTO', 'Al plegar un desarrollo plano en forma de cruz de 6 cuadrados se obtiene:',       4, ARRAY['Una piramide', 'Un prisma triangular', 'Un cilindro', 'Un cubo']),
    (3, 5, 'SOLO_TEXTO', 'La vista superior de un cilindro apoyado sobre su base es:',                      2, ARRAY['Un rectangulo', 'Un circulo', 'Un triangulo', 'Una elipse']),
    (3, 6, 'SOLO_TEXTO', 'La vista frontal de una piramide de base cuadrada es:',                          3, ARRAY['Un cuadrado', 'Un circulo', 'Un triangulo', 'Un pentagono']),
    (3, 7, 'SOLO_TEXTO', '¿Cuantas aristas tiene un cubo?',                                                1, ARRAY['12', '8', '6', '24']),
    (3, 8, 'SOLO_TEXTO', '¿Cuantos vertices tiene una piramide de base cuadrada?',                         4, ARRAY['4', '6', '8', '5']),
    -- Borrador v1.1
    (4, 1, 'SOLO_TEXTO', 'Modelo:  ◇ ◆ ◇ ◆ ◆',    2, ARRAY['◇ ◆ ◆ ◇ ◆', '◇ ◆ ◇ ◆ ◆', '◆ ◇ ◇ ◆ ◆', '◇ ◇ ◆ ◆ ◆']),
    (4, 2, 'SOLO_TEXTO', 'Modelo:  ▤ ▥ ▦ ▧',      1, ARRAY['▤ ▥ ▦ ▧', '▥ ▤ ▦ ▧', '▤ ▦ ▥ ▧', '▤ ▥ ▧ ▦']),
    (4, 3, 'COMPARACION_IMAGENES', 'Seleccione la figura identica al modelo (imagen pendiente de carga).', 3, ARRAY['Opcion A', 'Opcion B', 'Opcion C', 'Opcion D']),
    (5, 1, 'SOLO_TEXTO', 'Un prisma triangular tiene ¿cuantas caras?',                                      2, ARRAY['4', '5', '6', '3']),
    (5, 2, 'SOLO_TEXTO', 'Si doblas una hoja por la mitad dos veces y haces un agujero, al abrirla hay:',   3, ARRAY['1 agujero', '2 agujeros', '4 agujeros', '8 agujeros']),
    -- Sinonimos (RV v1.0)
    (6, 1, 'RAZONAMIENTO_VERBAL', 'ALEGRE',    2, ARRAY['triste', 'contento', 'serio', 'cansado']),
    (6, 2, 'RAZONAMIENTO_VERBAL', 'VELOZ',     2, ARRAY['lento', 'rapido', 'pesado', 'torpe']),
    (6, 3, 'RAZONAMIENTO_VERBAL', 'ESCASO',    3, ARRAY['abundante', 'grande', 'insuficiente', 'claro']),
    (6, 4, 'RAZONAMIENTO_VERBAL', 'HONESTO',   1, ARRAY['integro', 'astuto', 'timido', 'frio']),
    (6, 5, 'RAZONAMIENTO_VERBAL', 'EFIMERO',   4, ARRAY['eterno', 'solido', 'antiguo', 'pasajero']),
    (6, 6, 'RAZONAMIENTO_VERBAL', 'DILIGENTE', 2, ARRAY['descuidado', 'aplicado', 'distraido', 'lento']),
    -- Analogias (RV v1.0)
    (7, 1, 'RAZONAMIENTO_VERBAL', 'Medico es a hospital como maestro es a...',  1, ARRAY['escuela', 'libro', 'alumno', 'pizarra']),
    (7, 2, 'RAZONAMIENTO_VERBAL', 'Pez es a agua como ave es a...',             2, ARRAY['nido', 'aire', 'pluma', 'arbol']),
    (7, 3, 'RAZONAMIENTO_VERBAL', 'Frio es a calor como noche es a...',         3, ARRAY['luna', 'oscuridad', 'dia', 'estrella']),
    (7, 4, 'RAZONAMIENTO_VERBAL', 'Pie es a zapato como mano es a...',          1, ARRAY['guante', 'dedo', 'anillo', 'brazo']),
    (7, 5, 'RAZONAMIENTO_VERBAL', 'Pincel es a pintor como bisturi es a...',    4, ARRAY['hospital', 'enfermo', 'corte', 'cirujano']),
    (7, 6, 'RAZONAMIENTO_VERBAL', 'Semilla es a arbol como huevo es a...',      3, ARRAY['nido', 'cascara', 'ave', 'yema'])
) AS i(subtest_id, orden, tipo_item, enunciado, correcta, opciones);

INSERT INTO item (item_id, subtest_id, codigo_item, tipo_item, tipo_respuesta, enunciado, instruccion, numero_orden, puntaje_base)
SELECT i.item_id, i.subtest_id, s.codigo_subtest || '-' || lpad(i.orden::text, 2, '0'), i.tipo_item::tipo_item,
       'OPCION_UNICA', i.enunciado,
       CASE WHEN i.subtest_id IN (1, 4) THEN 'Seleccione la opcion identica al modelo.' END,
       i.orden, 1.00
FROM seed_item i
JOIN subtest s ON s.subtest_id = i.subtest_id;

INSERT INTO opcion_item (opcion_id, item_id, codigo_opcion, texto_opcion, numero_orden)
SELECT i.item_id * 10 + o.ord, i.item_id, chr(64 + o.ord::int), o.texto, o.ord
FROM seed_item i
CROSS JOIN LATERAL unnest(i.opciones) WITH ORDINALITY AS o(texto, ord);

-- ============================================================
-- 5. CALIFICACION: DIMENSIONES, REGLAS, CLAVES, MATRIZ Y BAREMOS
-- ============================================================

-- Una dimension por subtest publicado (dimension_id = subtest_id).
INSERT INTO dimension_resultado (dimension_resultado_id, version_test_id, subtest_id, codigo_dimension,
                                 nombre_dimension, descripcion, orden_presentacion, puntaje_minimo, puntaje_maximo, creado_en)
SELECT s.subtest_id, s.version_test_id, s.subtest_id, s.codigo_subtest, s.nombre_subtest,
       'Puntaje directo del subtest ' || s.nombre_subtest, s.numero_orden, 0,
       (SELECT count(*) FROM seed_item i WHERE i.subtest_id = s.subtest_id), r.hoy - interval '78 days'
FROM subtest s, seed_ref r
WHERE s.version_test_id IN (1, 3);

-- Una regla CLAVE_ITEM por subtest (regla_id = subtest_id). Publicadas en v1.0/RV; borrador en v1.1.
INSERT INTO regla_calificacion (regla_calificacion_id, version_test_id, subtest_id, estrategia_calificacion_id,
                                tipo_regla, prioridad, activa, estado, parametros, observacion,
                                creado_por, creado_en, aprobado_por, aprobado_en)
SELECT s.subtest_id, s.version_test_id, s.subtest_id, r.est_clave, 'CLAVE_ITEM', 1, TRUE,
       CASE WHEN s.version_test_id = 2 THEN 'BORRADOR' ELSE 'PUBLICADO' END::estado_configuracion,
       jsonb_build_object('puntaje_por_acierto', 1, 'omitida_cuenta_como', 'INCORRECTA'),
       'Un punto por acierto en ' || s.nombre_subtest,
       'a0000000-0000-4000-8000-000000000002'::uuid, r.hoy - interval '76 days',
       CASE WHEN s.version_test_id <> 2 THEN 'a0000000-0000-4000-8000-000000000002'::uuid END,
       CASE WHEN s.version_test_id <> 2 THEN r.hoy - interval '75 days' END
FROM subtest s, seed_ref r;

-- clave_respuesta_id = item_id.
INSERT INTO clave_respuesta (clave_respuesta_id, regla_calificacion_id, item_id, opcion_correcta_id, puntaje, creado_por, creado_en)
SELECT i.item_id, i.subtest_id, i.item_id, i.item_id * 10 + i.correcta, 1.00,
       'a0000000-0000-4000-8000-000000000002'::uuid, r.hoy - interval '76 days'
FROM seed_item i, seed_ref r;

-- Matriz: la opcion correcta suma 1 punto a la dimension de su subtest (asi el
-- backend genera resultado_dimension y aplica el baremo por subtest).
INSERT INTO opcion_puntaje_dimension (opcion_puntaje_dimension_id, regla_calificacion_id, opcion_id,
                                      dimension_resultado_id, puntaje, peso, activa, creado_en)
SELECT i.item_id, i.subtest_id, i.item_id * 10 + i.correcta, i.subtest_id, 1.00, 1.0000, TRUE, r.hoy - interval '76 days'
FROM seed_item i, seed_ref r
WHERE i.subtest_id IN (1, 2, 3, 6, 7);

-- Baremos: uno por dimension (baremo_id = dimension_id) + uno total por version (10 = BFA, 20 = RV).
INSERT INTO baremo (baremo_id, version_test_id, dimension_resultado_id, codigo_baremo, nombre, descripcion,
                    grupo_normativo, criterio_edad_minima, criterio_edad_maxima, vigente_desde,
                    estado, creado_por, creado_en, aprobado_por, aprobado_en)
SELECT b.id, b.version_id, b.dim_id, b.codigo, b.nombre, 'Baremo institucional de referencia (datos de demostracion).',
       'Estudiantes universitarios de primer ingreso', 17, 30, (r.hoy - interval '1 year')::date,
       'PUBLICADO', 'a0000000-0000-4000-8000-000000000002'::uuid, r.hoy - interval '74 days',
       'a0000000-0000-4000-8000-000000000002'::uuid, r.hoy - interval '73 days'
FROM seed_ref r, (VALUES
    (1,  1, 1,    'BAR-FI',    'Baremo Figuras identicas'),
    (2,  1, 2,    'BAR-DES',   'Baremo Desplazamiento'),
    (3,  1, 3,    'BAR-ESP',   'Baremo Espacial'),
    (10, 1, NULL, 'BAR-BFA-T', 'Baremo total BFA'),
    (6,  3, 6,    'BAR-SIN',   'Baremo Sinonimos'),
    (7,  3, 7,    'BAR-ANA',   'Baremo Analogias'),
    (20, 3, NULL, 'BAR-RV-T',  'Baremo total Razonamiento Verbal')
) AS b(id, version_id, dim_id, codigo, nombre);

-- Rangos (rango_id = baremo*10 + orden). Escalas: 0-8 (subtests BFA), 0-6 (RV), 0-24 y 0-12 (totales).
INSERT INTO rango_baremo (rango_baremo_id, baremo_id, puntaje_minimo, puntaje_maximo, percentil, categoria, interpretacion, recomendacion, orden)
SELECT b.baremo_id * 10 + x.orden, b.baremo_id,
       round(x.min_frac * esc.maximo, 2) + CASE WHEN x.orden = 1 THEN 0 ELSE 0.01 END,
       round(x.max_frac * esc.maximo, 2),
       x.percentil, x.categoria, x.interp, x.recom, x.orden
FROM baremo b
JOIN LATERAL (
    SELECT CASE
        WHEN b.dimension_resultado_id IS NOT NULL THEN (SELECT puntaje_maximo FROM dimension_resultado d WHERE d.dimension_resultado_id = b.dimension_resultado_id)
        ELSE (SELECT sum(d.puntaje_maximo) FROM dimension_resultado d WHERE d.version_test_id = b.version_test_id)
    END AS maximo
) esc ON TRUE
CROSS JOIN (VALUES
    (1, 0.00, 0.34, 10, 'Bajo',       'Desempeno por debajo del grupo normativo.',          'Sugerir refuerzo y reevaluacion en el siguiente periodo.'),
    (2, 0.34, 0.59, 35, 'Medio bajo', 'Desempeno ligeramente inferior al promedio.',        'Acompanamiento academico opcional.'),
    (3, 0.59, 0.80, 65, 'Medio alto', 'Desempeno dentro o sobre el promedio esperado.',     'Sin acciones adicionales.'),
    (4, 0.80, 1.00, 90, 'Alto',       'Desempeno destacado respecto al grupo normativo.',   'Considerar para programas de tutoria entre pares.')
) AS x(orden, min_frac, max_frac, percentil, categoria, interp, recom);

-- Publicacion de las versiones (mismo efecto que VersionTestService.publishVersion).
UPDATE version_test v
SET estado = 'PUBLICADO', publicado_en = v.aprobado_en + interval '1 day'
WHERE v.version_test_id IN (1, 3);

-- ============================================================
-- 6. SESIONES DE APLICACION
-- ============================================================

INSERT INTO sesion_aplicacion (sesion_aplicacion_id, version_test_id, codigo_sesion, nombre_sesion, descripcion,
                               inicio_programado, fin_programado, inicio_real, fin_real, ubicacion, estado, creado_por, creado_en)
SELECT s.id, s.version_id, s.codigo, s.nombre, s.descr, s.inicio, s.inicio + s.duracion,
       s.inicio_real, s.fin_real, s.ubicacion, s.estado::estado_sesion_aplicacion, s.creador::uuid, s.inicio - interval '3 days'
FROM seed_ref r
CROSS JOIN LATERAL (VALUES
    (1, 1, 'S-2026-01', 'BFA - Psicologia primer ingreso', 'Aplicacion diagnostica para estudiantes de Psicologia.',
        r.hoy - interval '14 days' + interval '15 hours', interval '3 hours',
        r.hoy - interval '14 days' + interval '15 hours 5 minutes', r.hoy - interval '14 days' + interval '17 hours',
        'Laboratorio de Computo 2', 'CERRADA', 'a0000000-0000-4000-8000-000000000003'),
    (2, 1, 'S-2026-02', 'BFA - Ingenieria y Medicina', 'Aplicacion conjunta de Sistemas y Medicina.',
        r.hoy - interval '7 days' + interval '15 hours', interval '3 hours',
        r.hoy - interval '7 days' + interval '15 hours 10 minutes', r.hoy - interval '7 days' + interval '17 hours 30 minutes',
        'Laboratorio de Computo 1', 'CERRADA', 'a0000000-0000-4000-8000-000000000004'),
    (3, 3, 'S-2026-03', 'RV - Administracion y Derecho', 'Razonamiento verbal para carreras de ciencias sociales.',
        r.hoy - interval '5 days' + interval '20 hours', interval '2 hours',
        r.hoy - interval '5 days' + interval '20 hours 5 minutes', r.hoy - interval '5 days' + interval '21 hours 15 minutes',
        'Aula Magna B', 'CERRADA', 'a0000000-0000-4000-8000-000000000003'),
    (4, 1, 'S-2026-04', 'BFA - Sesion en curso (demo)', 'Sesion abierta para probar la aplicacion en vivo.',
        r.ahora - interval '35 minutes', interval '6 hours',
        r.ahora - interval '30 minutes', NULL::timestamp,
        'Laboratorio de Computo 2', 'ABIERTA', 'a0000000-0000-4000-8000-000000000003'),
    (5, 3, 'S-2026-05', 'RV - Sesion pausada (demo)', 'Pausada por un corte de energia; reanudar para continuar.',
        r.ahora - interval '45 minutes', interval '5 hours',
        r.ahora - interval '40 minutes', NULL::timestamp,
        'Laboratorio de Computo 1', 'PAUSADA', 'a0000000-0000-4000-8000-000000000003'),
    (6, 3, 'S-2026-06', 'RV - Psicologia (proxima semana)', 'Segunda bateria para el grupo PSI-1A.',
        r.hoy + interval '7 days' + interval '15 hours', interval '2 hours',
        NULL::timestamp, NULL::timestamp,
        'Aula 304', 'PROGRAMADA', 'a0000000-0000-4000-8000-000000000004'),
    (7, 1, 'S-2026-07', 'BFA - Medicina (cancelada)', 'Cancelada por actividad institucional en el mismo horario.',
        r.hoy + interval '3 days' + interval '15 hours', interval '3 hours',
        NULL::timestamp, r.ahora - interval '1 day',
        'Laboratorio de Computo 1', 'CANCELADA', 'a0000000-0000-4000-8000-000000000004')
) AS s(id, version_id, codigo, nombre, descr, inicio, duracion, inicio_real, fin_real, ubicacion, estado, creador);

-- Subtests habilitados en cada sesion (sesion_subtest_id = sesion*10 + orden).
INSERT INTO sesion_subtest (sesion_subtest_id, sesion_aplicacion_id, version_test_id, subtest_id, numero_orden, tiempo_limite_segundos)
SELECT sa.sesion_aplicacion_id * 10 + s.numero_orden, sa.sesion_aplicacion_id, sa.version_test_id,
       s.subtest_id, s.numero_orden, s.tiempo_limite_segundos
FROM sesion_aplicacion sa
JOIN subtest s ON s.version_test_id = sa.version_test_id;

-- Historial de pausas: una ya reanudada en S-02 y en S-05, y la pausa abierta de S-05.
INSERT INTO pausa_sesion (pausa_sesion_id, sesion_aplicacion_id, pausado_en, reanudado_en, pausado_por, reanudado_por, motivo)
SELECT p.id, p.sesion, p.desde, p.hasta, p.usr::uuid, CASE WHEN p.hasta IS NOT NULL THEN p.usr::uuid END, p.motivo
FROM seed_ref r
CROSS JOIN LATERAL (VALUES
    (1, 2, r.hoy - interval '7 days' + interval '16 hours', r.hoy - interval '7 days' + interval '16 hours 6 minutes',
        'a0000000-0000-4000-8000-000000000004', 'Participante con malestar; se espero a que se recuperara.'),
    (2, 5, r.ahora - interval '35 minutes', r.ahora - interval '32 minutes',
        'a0000000-0000-4000-8000-000000000003', 'Reinicio del proyector.'),
    (3, 5, r.ahora - interval '10 minutes', NULL::timestamp,
        'a0000000-0000-4000-8000-000000000003', 'Corte de energia en el laboratorio.')
) AS p(id, sesion, desde, hasta, usr, motivo);

-- ============================================================
-- 7. ASIGNACIONES E INTENTOS
-- ============================================================
-- asignacion_id = sesion*100 + n ; intento_id = asignacion_id.
--   subtests_ok  : subtests COMPLETADOS (en orden).
--   parcial_n    : items respondidos del siguiente subtest (que queda EN_PROGRESO o INTERRUMPIDO).
--   t0_min       : minutos desde inicio_real de la sesion hasta el primer subtest.

CREATE TEMP TABLE seed_asignacion ON COMMIT DROP AS
SELECT a.*
FROM (VALUES
    -- id, sesion, part, asignacion, intento, calificar, subtests_ok, parcial_n, t0_min
    (101, 1,  1, 'COMPLETADO', 'COMPLETADO', TRUE,  3, 0, 5.0),
    (102, 1,  2, 'COMPLETADO', 'COMPLETADO', TRUE,  3, 0, 5.5),
    (103, 1,  3, 'COMPLETADO', 'COMPLETADO', TRUE,  3, 0, 6.0),
    (104, 1,  4, 'COMPLETADO', 'COMPLETADO', TRUE,  3, 0, 6.5),
    (105, 1,  5, 'COMPLETADO', 'COMPLETADO', TRUE,  3, 0, 7.0),
    (106, 1,  6, 'COMPLETADO', 'COMPLETADO', TRUE,  3, 0, 7.5),
    (107, 1, 15, 'COMPLETADO', 'COMPLETADO', TRUE,  3, 0, 8.0),
    (108, 1, 16, 'EXPIRADO',   NULL,         FALSE, 0, 0, 0),
    (201, 2,  7, 'COMPLETADO', 'COMPLETADO', TRUE,  3, 0, 5.0),
    (202, 2,  8, 'COMPLETADO', 'COMPLETADO', TRUE,  3, 0, 5.5),
    (203, 2,  9, 'COMPLETADO', 'COMPLETADO', TRUE,  3, 0, 6.0),
    (204, 2, 10, 'COMPLETADO', 'COMPLETADO', TRUE,  3, 0, 6.5),
    (205, 2, 11, 'COMPLETADO', 'COMPLETADO', TRUE,  3, 0, 7.0),
    (206, 2, 12, 'COMPLETADO', 'COMPLETADO', TRUE,  3, 0, 7.5),
    (207, 2, 13, 'ANULADO',    'ANULADO',    FALSE, 1, 3, 8.0),
    (301, 3, 15, 'COMPLETADO', 'COMPLETADO', TRUE,  2, 0, 5.0),
    (302, 3, 16, 'COMPLETADO', 'COMPLETADO', TRUE,  2, 0, 5.5),
    (303, 3, 17, 'COMPLETADO', 'COMPLETADO', TRUE,  2, 0, 6.0),
    (304, 3, 18, 'COMPLETADO', 'COMPLETADO', TRUE,  2, 0, 6.5),
    (305, 3,  1, 'COMPLETADO', 'COMPLETADO', TRUE,  2, 0, 7.0),
    (306, 3, 19, 'COMPLETADO', 'COMPLETADO', FALSE, 2, 0, 7.5),
    (401, 4, 14, 'ASIGNADO',   NULL,         FALSE, 0, 0, 0),
    (402, 4, 17, 'ASIGNADO',   NULL,         FALSE, 0, 0, 0),
    (403, 4, 18, 'ASIGNADO',   NULL,         FALSE, 0, 0, 0),
    (404, 4, 19, 'EN_PROGRESO','EN_PROGRESO',FALSE, 1, 0, 5.0),
    (405, 4, 13, 'COMPLETADO', 'COMPLETADO', FALSE, 3, 0, 2.0),
    -- 501: el subtest SIN empezo 70 s antes de la pausa abierta (le quedan 110 s al reanudar).
    (501, 5,  7, 'EN_PROGRESO','EN_PROGRESO',FALSE, 0, 3, 28.8333333),
    (502, 5,  8, 'ASIGNADO',   NULL,         FALSE, 0, 0, 0),
    (601, 6,  2, 'ASIGNADO',   NULL,         FALSE, 0, 0, 0),
    (602, 6,  3, 'ASIGNADO',   NULL,         FALSE, 0, 0, 0),
    (603, 6,  4, 'ASIGNADO',   NULL,         FALSE, 0, 0, 0)
) AS a(asignacion_id, sesion_id, part_n, estado_asig, estado_intento, calificar, subtests_ok, parcial_n, t0_min);

INSERT INTO asignacion_test (asignacion_id, sesion_aplicacion_id, participante_id, evaluador_id, token_acceso_hash,
                             token_expira_en, token_usado_en, intentos_acceso, edad_registrada_aplicacion,
                             sexo_id_aplicacion, carrera_id_aplicacion, cohorte_id_aplicacion, grupo_academico_id_aplicacion,
                             asignado_en, estado)
SELECT a.asignacion_id, a.sesion_id, p.participante_id, sa.creado_por,
       crypt('DEMO' || a.asignacion_id, gen_salt('bf', 10)),
       CASE WHEN sa.estado IN ('CERRADA', 'CANCELADA') THEN sa.inicio_programado + interval '1 day'
            ELSE r.ahora + interval '14 days' END,
       CASE WHEN a.estado_intento IS NOT NULL THEN coalesce(sa.inicio_real, sa.inicio_programado) + make_interval(secs => a.t0_min * 60) - interval '2 minutes' END,
       CASE WHEN a.asignacion_id = 108 THEN 0 WHEN a.asignacion_id = 402 THEN 1 ELSE CASE WHEN a.estado_intento IS NOT NULL THEN 1 ELSE 0 END END,
       date_part('year', age(sa.inicio_programado::date, pa.fecha_nacimiento))::smallint,
       pa.sexo_id, pa.carrera_id, pa.cohorte_id, pa.grupo_academico_id,
       CASE WHEN sa.estado IN ('ABIERTA', 'PAUSADA', 'PROGRAMADA') THEN r.ahora - interval '1 day'
            ELSE sa.inicio_programado - interval '2 days' END + a.part_n * interval '1 minute',
       a.estado_asig::estado_asignacion
FROM seed_asignacion a
CROSS JOIN seed_ref r
JOIN seed_participante p ON p.n = a.part_n
JOIN participante pa ON pa.participante_id = p.participante_id
JOIN sesion_aplicacion sa ON sa.sesion_aplicacion_id = a.sesion_id;

-- Plan de subtests por intento: tiempos y estado de cada subtest.
CREATE TEMP TABLE seed_intento_subtest ON COMMIT DROP AS
SELECT a.asignacion_id AS intento_id,
       a.asignacion_id * 10 + ss.numero_orden AS intento_subtest_id,
       ss.sesion_subtest_id, ss.subtest_id, ss.numero_orden, ss.tiempo_limite_segundos AS limite,
       CASE WHEN ss.numero_orden <= a.subtests_ok THEN 'COMPLETADO'
            WHEN ss.numero_orden = a.subtests_ok + 1 AND a.parcial_n > 0 THEN
                 CASE WHEN a.estado_intento = 'ANULADO' THEN 'INTERRUMPIDO' ELSE 'EN_PROGRESO' END
       END AS estado,
       CASE WHEN ss.numero_orden <= a.subtests_ok THEN NULL ELSE a.parcial_n END AS parcial_n,
       sa.inicio_real + make_interval(secs => a.t0_min * 60) + (ss.numero_orden - 1) * interval '6 minutes' AS iniciado_en,
       -- tiempo usado entre 55 % y 100 % del limite
       round(ss.tiempo_limite_segundos * (0.55 + (abs(hashtext('t' || a.asignacion_id || ':' || ss.subtest_id)) % 45) / 100.0))::int AS usado
FROM seed_asignacion a
JOIN sesion_aplicacion sa ON sa.sesion_aplicacion_id = a.sesion_id
JOIN sesion_subtest ss ON ss.sesion_aplicacion_id = a.sesion_id
WHERE a.estado_intento IS NOT NULL;

DELETE FROM seed_intento_subtest WHERE estado IS NULL;

INSERT INTO intento_test (intento_id, asignacion_id, iniciado_en, finalizado_en, estado, ultimo_subtest_id,
                          ultima_actividad_en, tiempo_total_segundos, informacion_dispositivo, direccion_ip)
SELECT a.asignacion_id, a.asignacion_id,
       inicio.t - interval '1 minute',
       CASE WHEN a.estado_intento = 'COMPLETADO' THEN fin.t + interval '30 seconds' END,
       a.estado_intento::estado_intento,
       ult.subtest_id,
       fin.t + CASE WHEN a.estado_intento = 'COMPLETADO' THEN interval '30 seconds' ELSE interval '0' END,
       CASE WHEN a.estado_intento = 'COMPLETADO' THEN extract(epoch FROM (fin.t + interval '30 seconds') - (inicio.t - interval '1 minute'))::int END,
       CASE WHEN a.part_n % 3 = 0 THEN 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/133.0'
            ELSE 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0 Safari/537.36' END,
       '10.20.' || a.sesion_id || '.' || (20 + a.part_n)
FROM seed_asignacion a
CROSS JOIN LATERAL (SELECT min(s.iniciado_en) AS t FROM seed_intento_subtest s WHERE s.intento_id = a.asignacion_id) inicio
CROSS JOIN LATERAL (
    SELECT max(CASE WHEN s.estado = 'COMPLETADO' THEN s.iniciado_en + make_interval(secs => s.usado)
                    ELSE s.iniciado_en + make_interval(secs => 20 * s.parcial_n) END) AS t
    FROM seed_intento_subtest s WHERE s.intento_id = a.asignacion_id
) fin
CROSS JOIN LATERAL (
    SELECT s.subtest_id FROM seed_intento_subtest s WHERE s.intento_id = a.asignacion_id
    ORDER BY s.numero_orden DESC LIMIT 1
) ult
WHERE a.estado_intento IS NOT NULL;

INSERT INTO intento_subtest (intento_subtest_id, intento_id, sesion_subtest_id, subtest_id, iniciado_en,
                             finalizado_en, estado, tiempo_usado_segundos)
SELECT s.intento_subtest_id, s.intento_id, s.sesion_subtest_id, s.subtest_id, s.iniciado_en,
       CASE WHEN s.estado = 'COMPLETADO' THEN s.iniciado_en + make_interval(secs => s.usado) END,
       s.estado::estado_intento,
       CASE WHEN s.estado = 'COMPLETADO' THEN s.usado END
FROM seed_intento_subtest s;

-- ============================================================
-- 8. RESPUESTAS
-- ============================================================
-- respuesta_id = intento*1000 + item_id. Probabilidad de acierto = habilidad del
-- participante menos 4 puntos por posicion del item (los ultimos son mas dificiles).
-- En subtests completados ~6 % de items quedan omitidos (respuesta vacia, como
-- hace SubtestClosingService); en subtests parciales solo existen los respondidos.

CREATE TEMP TABLE seed_respuesta ON COMMIT DROP AS
WITH base AS (
    SELECT s.intento_id, s.intento_subtest_id, s.estado AS estado_subtest, s.iniciado_en, s.usado, s.parcial_n,
           i.item_id, i.orden, i.correcta, i.subtest_id,
           (SELECT count(*) FROM seed_item x WHERE x.subtest_id = i.subtest_id) AS n_items,
           p.habilidad,
           (abs(hashtext('c' || s.intento_id || ':' || i.item_id)) % 1000) / 1000.0 AS h_acierto,
           abs(hashtext('o' || s.intento_id || ':' || i.item_id)) % 100 AS h_opcion
    FROM seed_intento_subtest s
    JOIN seed_asignacion a ON a.asignacion_id = s.intento_id
    JOIN seed_participante p ON p.n = a.part_n
    JOIN seed_item i ON i.subtest_id = s.subtest_id
    WHERE s.estado = 'COMPLETADO' OR i.orden <= s.parcial_n
)
SELECT b.intento_id * 1000 + b.item_id AS respuesta_id, b.intento_id, b.intento_subtest_id, b.item_id,
       CASE
           WHEN b.estado_subtest = 'COMPLETADO' AND b.h_opcion < 6 THEN NULL
           WHEN b.h_acierto < b.habilidad - (b.orden - 1) * 0.04 THEN b.item_id * 10 + b.correcta
           ELSE b.item_id * 10 + (SELECT array_agg(k ORDER BY k) FROM generate_series(1, 4) k WHERE k <> b.correcta)[1 + b.h_opcion % 3]
       END AS opcion_id,
       b.item_id * 10 + b.correcta AS opcion_correcta,
       CASE WHEN b.estado_subtest = 'COMPLETADO'
            THEN b.iniciado_en + make_interval(secs => b.usado * b.orden / b.n_items)
            ELSE b.iniciado_en + make_interval(secs => 20 * b.orden) END AS respondido_en,
       CASE WHEN b.estado_subtest = 'COMPLETADO' THEN (b.usado / b.n_items)::int ELSE 20 END AS tiempo
FROM base b;

INSERT INTO respuesta_item (respuesta_id, intento_id, intento_subtest_id, item_id, respondido_en,
                            tiempo_usado_segundos, es_final, requiere_revision_manual)
SELECT r.respuesta_id, r.intento_id, r.intento_subtest_id, r.item_id, r.respondido_en, r.tiempo, TRUE, FALSE
FROM seed_respuesta r;

INSERT INTO opcion_seleccionada_respuesta (respuesta_id, item_id, opcion_id, seleccionada_en)
SELECT r.respuesta_id, r.item_id, r.opcion_id, r.respondido_en
FROM seed_respuesta r
WHERE r.opcion_id IS NOT NULL;

-- ============================================================
-- 9. RESULTADOS (equivalente a ClaveSimpleScoringService)
-- ============================================================
-- resultado_id = intento_id. 306 y 405 quedan COMPLETADOS sin calificar para
-- probar el boton "Calificar" desde la UI.

INSERT INTO resultado (resultado_id, intento_id, estrategia_calificacion_id, calculado_en, calculado_por,
                       puntaje_total_directo, cantidad_items, cantidad_correctas, cantidad_incorrectas,
                       cantidad_pendientes_revision, requiere_revision_manual, estado)
SELECT it.intento_id, it.intento_id, r.est_clave, it.finalizado_en + interval '3 hours',
       'a0000000-0000-4000-8000-000000000002'::uuid,
       count(*) FILTER (WHERE sr.opcion_id = sr.opcion_correcta),
       count(*),
       count(*) FILTER (WHERE sr.opcion_id = sr.opcion_correcta),
       count(*) FILTER (WHERE sr.opcion_id IS DISTINCT FROM sr.opcion_correcta),
       0, FALSE, 'CALCULADO'
FROM intento_test it
CROSS JOIN seed_ref r
JOIN seed_asignacion a ON a.asignacion_id = it.intento_id AND a.calificar
JOIN seed_respuesta sr ON sr.intento_id = it.intento_id
GROUP BY it.intento_id, it.finalizado_en, r.est_clave;

-- calificacion_respuesta_id = respuesta_id (opcion_id = opcion correcta, como el backend).
INSERT INTO calificacion_respuesta (calificacion_respuesta_id, resultado_id, respuesta_id, regla_calificacion_id,
                                    opcion_id, puntaje_obtenido, es_correcta, requiere_revision_manual, creado_en)
SELECT sr.respuesta_id, res.resultado_id, sr.respuesta_id, c.regla_calificacion_id, c.opcion_correcta_id,
       CASE WHEN sr.opcion_id = sr.opcion_correcta THEN c.puntaje ELSE 0 END,
       sr.opcion_id IS NOT DISTINCT FROM sr.opcion_correcta, FALSE, res.calculado_en
FROM seed_respuesta sr
JOIN resultado res ON res.intento_id = sr.intento_id
JOIN clave_respuesta c ON c.item_id = sr.item_id;

-- Solo dimensiones con al menos un acierto (el backend acumula desde la matriz).
INSERT INTO resultado_dimension (resultado_dimension_id, resultado_id, dimension_resultado_id, baremo_id, rango_baremo_id,
                                 puntaje_directo, puntaje_transformado, percentil, categoria, interpretacion, requiere_revision_manual)
SELECT res.resultado_id * 10 + d.subtest_id, res.resultado_id, d.subtest_id, b.baremo_id, rb.rango_baremo_id,
       d.puntaje, rb.percentil, rb.percentil, rb.categoria, rb.interpretacion, FALSE
FROM resultado res
JOIN LATERAL (
    SELECT i.subtest_id, count(*)::numeric AS puntaje
    FROM seed_respuesta sr
    JOIN seed_item i ON i.item_id = sr.item_id
    WHERE sr.intento_id = res.intento_id AND sr.opcion_id = sr.opcion_correcta
    GROUP BY i.subtest_id
) d ON TRUE
JOIN baremo b ON b.dimension_resultado_id = d.subtest_id
LEFT JOIN rango_baremo rb ON rb.baremo_id = b.baremo_id AND d.puntaje BETWEEN rb.puntaje_minimo AND rb.puntaje_maximo;

-- ============================================================
-- 10. REPORTES GENERADOS Y AUDITORIA
-- ============================================================

INSERT INTO reporte_generado (reporte_id, tipo_reporte, intento_id, resultado_id, sesion_aplicacion_id,
                              generado_por, generado_en, formato, ruta_almacenamiento, resumen_filtros)
SELECT x.id, x.tipo, x.intento, x.resultado, x.sesion, x.usr::uuid, x.cuando, x.formato::formato_reporte, x.ruta, x.filtros::jsonb
FROM seed_ref r
CROSS JOIN LATERAL (VALUES
    (1, 'INDIVIDUAL', 105, 105, NULL::bigint, 'a0000000-0000-4000-8000-000000000002', r.hoy - interval '13 days' + interval '16 hours',
        'PDF',  'reportes/individual/resultado-105.pdf', '{"intentoId":105}'),
    (2, 'SESION',     NULL, NULL, 1,          'a0000000-0000-4000-8000-000000000002', r.hoy - interval '13 days' + interval '17 hours',
        'XLSX', 'reportes/sesion/S-2026-01.xlsx', '{"sesionId":1}'),
    (3, 'SESION',     NULL, NULL, 2,          'a0000000-0000-4000-8000-000000000002', r.hoy - interval '6 days' + interval '15 hours',
        'PDF',  'reportes/sesion/S-2026-02.pdf', '{"sesionId":2}'),
    (4, 'AGREGADO',   NULL, NULL, 3,          'a0000000-0000-4000-8000-000000000005', r.hoy - interval '4 days' + interval '14 hours',
        'CSV',  'reportes/agregado/rv-por-carrera.csv', '{"sesionId":3,"agruparPor":"carrera"}'),
    (5, 'INDIVIDUAL', 202, 202, NULL::bigint, 'a0000000-0000-4000-8000-000000000005', r.hoy - interval '2 days' + interval '19 hours',
        'PDF',  'reportes/individual/resultado-202.pdf', '{"intentoId":202}')
) AS x(id, tipo, intento, resultado, sesion, usr, cuando, formato, ruta, filtros);

INSERT INTO auditoria (auditoria_id, usuario_id, accion, entidad, entidad_id, valor_anterior, valor_nuevo,
                       direccion_ip, agente_usuario, creado_en)
SELECT x.id, x.usr::uuid, x.accion, x.entidad, x.entidad_id, x.antes::jsonb, x.despues::jsonb,
       '10.20.0.' || (x.id % 7 + 2), 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Chrome/131.0', x.cuando
FROM seed_ref r
CROSS JOIN LATERAL (VALUES
    ( 1, 'a0000000-0000-4000-8000-000000000001', 'USUARIO_CREADO',       'usuario',            'a0000000-0000-4000-8000-000000000003', NULL, '{"nombreUsuario":"aplicador","rol":"APLICADOR"}', r.hoy - interval '100 days'),
    ( 2, 'a0000000-0000-4000-8000-000000000002', 'VERSION_APROBADA',     'version_test',       '1', '{"estado":"EN_REVISION"}', '{"estado":"APROBADO"}', r.hoy - interval '75 days'),
    ( 3, 'a0000000-0000-4000-8000-000000000002', 'VERSION_PUBLICADA',    'version_test',       '1', '{"estado":"APROBADO"}', '{"estado":"PUBLICADO"}', r.hoy - interval '74 days'),
    ( 4, 'a0000000-0000-4000-8000-000000000002', 'VERSION_PUBLICADA',    'version_test',       '3', '{"estado":"APROBADO"}', '{"estado":"PUBLICADO"}', r.hoy - interval '54 days'),
    ( 5, 'a0000000-0000-4000-8000-000000000003', 'SESION_CREADA',        'sesion_aplicacion',  '1', NULL, '{"codigo":"S-2026-01"}', r.hoy - interval '17 days'),
    ( 6, 'a0000000-0000-4000-8000-000000000003', 'SESION_ABIERTA',       'sesion_aplicacion',  '1', '{"estado":"PROGRAMADA"}', '{"estado":"ABIERTA"}', r.hoy - interval '14 days' + interval '15 hours 5 minutes'),
    ( 7, 'a0000000-0000-4000-8000-000000000003', 'INCIDENCIA_SESION',    'sesion_aplicacion',  '1', NULL, '{"participantId":"b0000000-0000-4000-8000-000000000004","text":"Solicito salir 3 minutos; se reincorporo sin novedad."}', r.hoy - interval '14 days' + interval '15 hours 40 minutes'),
    ( 8, 'a0000000-0000-4000-8000-000000000003', 'SESION_CERRADA',       'sesion_aplicacion',  '1', '{"estado":"ABIERTA"}', '{"estado":"CERRADA"}', r.hoy - interval '14 days' + interval '17 hours'),
    ( 9, 'a0000000-0000-4000-8000-000000000002', 'CALIFICACION_EJECUTADA','sesion_aplicacion', '1', NULL, '{"intentosCalificados":7}', r.hoy - interval '14 days' + interval '20 hours'),
    (10, 'a0000000-0000-4000-8000-000000000004', 'SESION_PAUSADA',       'sesion_aplicacion',  '2', '{"estado":"ABIERTA"}', '{"estado":"PAUSADA","motivo":"Participante con malestar"}', r.hoy - interval '7 days' + interval '16 hours'),
    (11, 'a0000000-0000-4000-8000-000000000004', 'SESION_REANUDADA',     'sesion_aplicacion',  '2', '{"estado":"PAUSADA"}', '{"estado":"ABIERTA"}', r.hoy - interval '7 days' + interval '16 hours 6 minutes'),
    (12, 'a0000000-0000-4000-8000-000000000004', 'ASIGNACION_REVOCADA',  'asignacion_test',    '207', NULL, '{"sesionId":2}', r.hoy - interval '7 days' + interval '16 hours 20 minutes'),
    (13, 'a0000000-0000-4000-8000-000000000004', 'INCIDENCIA_SESION',    'sesion_aplicacion',  '2', NULL, '{"participantId":"b0000000-0000-4000-8000-000000000013","text":"Uso de celular durante la prueba; se revoca el acceso y se reprograma."}', r.hoy - interval '7 days' + interval '16 hours 19 minutes'),
    (14, 'a0000000-0000-4000-8000-000000000002', 'CALIFICACION_EJECUTADA','sesion_aplicacion', '2', NULL, '{"intentosCalificados":6}', r.hoy - interval '7 days' + interval '21 hours'),
    (15, 'a0000000-0000-4000-8000-000000000002', 'CALIFICACION_EJECUTADA','sesion_aplicacion', '3', NULL, '{"intentosCalificados":5}', r.hoy - interval '5 days' + interval '23 hours'),
    (16, 'a0000000-0000-4000-8000-000000000005', 'REPORTE_EXPORTADO',    'reporte_generado',   '4', NULL, '{"tipo":"AGREGADO","formato":"CSV"}', r.hoy - interval '4 days' + interval '14 hours'),
    (17, 'a0000000-0000-4000-8000-000000000004', 'SESION_CANCELADA',     'sesion_aplicacion',  '7', '{"estado":"PROGRAMADA"}', '{"estado":"CANCELADA"}', r.ahora - interval '1 day'),
    (18, 'a0000000-0000-4000-8000-000000000001', 'USUARIO_DESACTIVADO',  'usuario',            'a0000000-0000-4000-8000-000000000006', '{"estado":"ACTIVO"}', '{"estado":"INACTIVO"}', r.hoy - interval '30 days'),
    (19, 'a0000000-0000-4000-8000-000000000003', 'SESION_ABIERTA',       'sesion_aplicacion',  '4', '{"estado":"PROGRAMADA"}', '{"estado":"ABIERTA"}', r.ahora - interval '30 minutes'),
    (20, 'a0000000-0000-4000-8000-000000000003', 'SESION_PAUSADA',       'sesion_aplicacion',  '5', '{"estado":"ABIERTA"}', '{"estado":"PAUSADA","motivo":"Corte de energia en el laboratorio."}', r.ahora - interval '10 minutes')
) AS x(id, usr, accion, entidad, entidad_id, antes, despues, cuando);

-- ============================================================
-- 11. SECUENCIAS: continuar despues de los IDs explicitos
-- ============================================================

DO $$
DECLARE
    v RECORD;
BEGIN
    FOR v IN
        SELECT c.table_name, c.column_name, pg_get_serial_sequence(c.table_name, c.column_name) AS seq
        FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.column_default LIKE 'nextval(%'
    LOOP
        EXECUTE format('SELECT setval(%L, COALESCE((SELECT max(%I) FROM %I), 0) + 1, false)',
                       v.seq, v.column_name, v.table_name);
    END LOOP;
END;
$$;

-- Fuerza las validaciones diferidas aqui (mensajes de error mas claros que en COMMIT).
SET CONSTRAINTS ALL IMMEDIATE;

COMMIT;

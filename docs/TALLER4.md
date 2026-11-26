# Taller 4 – Revisión de avances BFA Digital

Repositorio unificado: `backend/` (Spring Boot + PostgreSQL/Supabase) y `frontend/` (React + Vite).
Equipo: Gabriel Pérez, Silvio Mora, Christopher Ibarra.

## 1. Propuesta de base de datos (unificada)

Base de datos PostgreSQL (script completo: `backend/supabase/migrations/20260621000100_create_bfa_schema.sql`).
El diagrama muestra las tablas principales; `PK` = clave primaria, `FK` = clave foránea.

```mermaid
erDiagram
    USUARIO ||--o{ USUARIO_ROL : "tiene"
    ROL ||--o{ USUARIO_ROL : "asignado en"
    ROL ||--o{ ROL_PERMISO : "otorga"
    PERMISO ||--o{ ROL_PERMISO : "pertenece a"

    CARRERA ||--o{ GRUPO_ACADEMICO : "tiene"
    CARRERA ||--o{ PARTICIPANTE : "cursa"
    CATALOGO_SEXO ||--o{ PARTICIPANTE : "clasifica"
    COHORTE ||--o{ PARTICIPANTE : "pertenece"
    GRUPO_ACADEMICO ||--o{ PARTICIPANTE : "agrupa"

    TEST ||--o{ VERSION_TEST : "tiene versiones"
    VERSION_TEST ||--o{ SUBTEST : "contiene"
    VERSION_TEST ||--o{ DIMENSION_RESULTADO : "define"
    VERSION_TEST ||--o{ BAREMO : "usa"
    SUBTEST ||--o{ ITEM : "contiene"
    ITEM ||--o{ OPCION_ITEM : "ofrece"
    ITEM ||--o{ IMAGEN_ITEM : "muestra"
    RECURSO_MULTIMEDIA ||--o{ IMAGEN_ITEM : "almacena"
    VERSION_TEST ||--o{ REGLA_CALIFICACION : "califica con"
    REGLA_CALIFICACION ||--o{ CLAVE_RESPUESTA : "define"
    BAREMO ||--o{ RANGO_BAREMO : "tiene"

    VERSION_TEST ||--o{ SESION_APLICACION : "se aplica en"
    SESION_APLICACION ||--o{ SESION_SUBTEST : "habilita"
    SESION_APLICACION ||--o{ ASIGNACION_TEST : "asigna"
    PARTICIPANTE ||--o{ ASIGNACION_TEST : "recibe"
    USUARIO ||--o{ ASIGNACION_TEST : "evalua"
    ASIGNACION_TEST ||--|| INTENTO_TEST : "genera"
    INTENTO_TEST ||--o{ INTENTO_SUBTEST : "incluye"
    INTENTO_TEST ||--o{ RESPUESTA_ITEM : "registra"
    ITEM ||--o{ RESPUESTA_ITEM : "responde"
    INTENTO_TEST ||--|| RESULTADO : "produce"
    RESULTADO ||--o{ RESULTADO_DIMENSION : "detalla"
    DIMENSION_RESULTADO ||--o{ RESULTADO_DIMENSION : "mide"
    RESPUESTA_ITEM ||--o{ REVISION_MANUAL_RESPUESTA : "revisa"
    USUARIO ||--o{ AUDITORIA : "genera"

    USUARIO {
        uuid usuario_id PK
        varchar nombre_usuario
        varchar correo
        varchar hash_contrasena
        varchar nombre_completo
        enum estado
    }
    ROL {
        smallint rol_id PK
        varchar nombre_rol
    }
    PERMISO {
        smallint permiso_id PK
        varchar codigo_permiso
    }
    USUARIO_ROL {
        uuid usuario_id PK_FK
        smallint rol_id PK_FK
    }
    ROL_PERMISO {
        smallint rol_id PK_FK
        smallint permiso_id PK_FK
    }
    CARRERA {
        smallint carrera_id PK
        varchar codigo_carrera
        varchar nombre_carrera
    }
    COHORTE {
        smallint cohorte_id PK
        varchar nombre_cohorte
        smallint anio
    }
    CATALOGO_SEXO {
        smallint sexo_id PK
        varchar nombre
    }
    GRUPO_ACADEMICO {
        smallint grupo_academico_id PK
        smallint carrera_id FK
        varchar nombre_grupo
    }
    PARTICIPANTE {
        uuid participante_id PK
        varchar codigo_participante
        varchar nombres
        varchar apellidos
        date fecha_nacimiento
        smallint sexo_id FK
        smallint carrera_id FK
        smallint cohorte_id FK
        smallint grupo_academico_id FK
    }
    TEST {
        bigint test_id PK
        varchar codigo_test
        varchar nombre_test
        uuid creado_por FK
    }
    VERSION_TEST {
        bigint version_test_id PK
        bigint test_id FK
        varchar numero_version
        enum estado
        int tiempo_limite_segundos
    }
    SUBTEST {
        bigint subtest_id PK
        bigint version_test_id FK
        varchar nombre_subtest
        int numero_orden
        int tiempo_limite_segundos
    }
    ITEM {
        bigint item_id PK
        bigint subtest_id FK
        varchar codigo_item
        enum tipo_item
        int numero_orden
        decimal puntaje_base
    }
    OPCION_ITEM {
        bigint opcion_id PK
        bigint item_id FK
        varchar codigo_opcion
        int numero_orden
    }
    RECURSO_MULTIMEDIA {
        bigint recurso_id PK
        varchar nombre_archivo
        text ruta_almacenamiento
        varchar tipo_mime
    }
    IMAGEN_ITEM {
        bigint imagen_item_id PK
        bigint item_id FK
        bigint recurso_id FK
    }
    DIMENSION_RESULTADO {
        bigint dimension_resultado_id PK
        bigint version_test_id FK
        bigint subtest_id FK
        varchar nombre_dimension
    }
    REGLA_CALIFICACION {
        bigint regla_calificacion_id PK
        bigint version_test_id FK
        bigint subtest_id FK
        enum tipo_regla
    }
    CLAVE_RESPUESTA {
        bigint clave_respuesta_id PK
        bigint regla_calificacion_id FK
        bigint item_id FK
        bigint opcion_correcta_id FK
        decimal puntaje
    }
    BAREMO {
        bigint baremo_id PK
        bigint version_test_id FK
        bigint dimension_resultado_id FK
        smallint criterio_sexo_id FK
        smallint criterio_carrera_id FK
    }
    RANGO_BAREMO {
        bigint rango_baremo_id PK
        bigint baremo_id FK
        decimal puntaje_minimo
        decimal puntaje_maximo
        decimal percentil
        varchar categoria
    }
    SESION_APLICACION {
        bigint sesion_aplicacion_id PK
        bigint version_test_id FK
        varchar codigo_sesion
        timestamp inicio_programado
        enum estado
    }
    SESION_SUBTEST {
        bigint sesion_subtest_id PK
        bigint sesion_aplicacion_id FK
        bigint subtest_id FK
    }
    ASIGNACION_TEST {
        bigint asignacion_id PK
        bigint sesion_aplicacion_id FK
        uuid participante_id FK
        uuid evaluador_id FK
        varchar token_acceso_hash
        enum estado
    }
    INTENTO_TEST {
        bigint intento_id PK
        bigint asignacion_id FK
        timestamp iniciado_en
        timestamp finalizado_en
        enum estado
    }
    INTENTO_SUBTEST {
        bigint intento_subtest_id PK
        bigint intento_id FK
        bigint subtest_id FK
        enum estado
    }
    RESPUESTA_ITEM {
        bigint respuesta_id PK
        bigint intento_id FK
        bigint item_id FK
        numeric respuesta_numerica
        timestamp respondido_en
    }
    RESULTADO {
        bigint resultado_id PK
        bigint intento_id FK
        decimal puntaje_total_directo
        int cantidad_correctas
    }
    RESULTADO_DIMENSION {
        bigint resultado_dimension_id PK
        bigint resultado_id FK
        bigint dimension_resultado_id FK
        bigint baremo_id FK
        decimal puntaje_directo
        decimal percentil
        varchar categoria
    }
    REVISION_MANUAL_RESPUESTA {
        bigint revision_manual_respuesta_id PK
        bigint respuesta_id FK
        enum estado
        decimal puntaje_asignado
        uuid revisado_por FK
    }
    AUDITORIA {
        bigint auditoria_id PK
        uuid usuario_id FK
        varchar accion
        varchar entidad
        jsonb valor_nuevo
    }
```

### Cómo el diseño respalda la API

| Módulo de la API | Tablas que usa |
|---|---|
| `/auth`, `/users`, `/roles` | USUARIO, ROL, PERMISO, USUARIO_ROL, ROL_PERMISO |
| `/catalogos`, `/participantes` | CARRERA, COHORTE, CATALOGO_SEXO, GRUPO_ACADEMICO, PARTICIPANTE |
| `/tests`, `/test-versions`, `/subtests`, `/items`, `/baremos` | TEST, VERSION_TEST, SUBTEST, ITEM, OPCION_ITEM, IMAGEN_ITEM, RECURSO_MULTIMEDIA, REGLA_CALIFICACION, CLAVE_RESPUESTA, BAREMO, RANGO_BAREMO |
| `/sesiones` | SESION_APLICACION, SESION_SUBTEST, ASIGNACION_TEST |
| `/evaluacion-participante`, `/intentos` | INTENTO_TEST, INTENTO_SUBTEST, RESPUESTA_ITEM |
| `/attempts/.../score`, `/reports`, `/dashboard` | RESULTADO, RESULTADO_DIMENSION, DIMENSION_RESULTADO |
| `/manual-review` | REVISION_MANUAL_RESPUESTA |
| `/auditoria` | AUDITORIA |

Decisiones clave: las versiones de test son inmutables una vez publicadas (un cambio crea otra versión), la asignación guarda sexo/carrera/cohorte del momento de la aplicación para que los baremos no cambien si el participante cambia de grupo, y cada asignación tiene un único intento y un único resultado (relaciones 1 a 1).

## 2. Funcionalidades acordadas y avance

> Estado marcado por revisión del código (endpoint + pantalla existentes). Antes de presentar, confirmar cada una con una prueba real en Postman.

| # | Funcionalidad | Backend | Frontend | Estado |
|---|---|---|---|---|
| 1 | Autenticación con JWT (login, perfil) | `/auth` | login | Completada |
| 2 | Roles y permisos (RBAC) | `/roles`, `/permissions` | roles | Completada |
| 3 | Gestión de usuarios | `/users` | usuarios | Completada |
| 4 | Catálogos (sexo, carrera, cohorte, grupo) | `/catalogos` | sexos, carreras, cohortes, grupos | Completada |
| 5 | Participantes con paginación | `/participantes` | participantes | Completada |
| 6 | Configuración de instrumentos (test, versión, subtests, ítems, opciones) | `/tests`, `/test-versions`, `/subtests`, `/items` | instrumentos | Completada |
| 7 | Imágenes de ítems y opciones | `/items/.../images` | carga-imagenes | Completada |
| 8 | Reglas de calificación, claves y baremos | `/scoring-rules`, `/answer-keys`, `/baremos` | instrumentos | Completada |
| 9 | Sesiones de aplicación (crear, activar, cerrar, cancelar) | `/sesiones` | sesiones | Completada |
| 10 | Asignaciones y tokens de acceso | `/sesiones/{id}/asignaciones`, `/acceso-participante` | sesiones.asignaciones | Completada |
| 11 | Aplicación al participante con guardado incremental | `/intentos`, `/evaluacion-participante` | evaluación | Completada |
| 12 | Calificación automática | `/attempts/{id}/score` | calificaciones | Completada |
| 13 | Resultados individuales y detalle | `/attempts/{id}/result` | resultados | Completada |
| 14 | Revisión manual | `/manual-review` | revision-manual | Completada |
| 15 | Dashboard y analítica | `/dashboard`, `/analytics` | dashboard | Completada |
| 16 | Reportes PDF / Excel / CSV | `/reports` | reportes | En desarrollo |
| 17 | Auditoría | `/auditoria` | auditoria | Completada |
| 18 | Respaldo y recuperación | `/backups` | respaldos | En desarrollo (la restauración solo registra la solicitud) |
| 19 | Búsqueda y notificaciones | `/search`, `/notifications` | admin-layout | Completada |
| 20 | Publicación de la API y documentación en Swagger UI | Render + Supabase, 103 operaciones documentadas | n/a | Completada |

**Avance: 18 de 20 completadas = 90 %.**

## 3. Evidencias

- Repositorio: https://github.com/Nell16/proyecto-final-BFA
- API publicada: https://bfa-api-m03x.onrender.com
- Frontend publicado: https://proyecto-final-bfa.vercel.app
- Swagger UI: https://bfa-api-m03x.onrender.com/swagger-ui.html
- Colección Postman (importable): `docs/postman/BFA-API.postman_collection.json`
- Login en Swagger UI con la URL publicada (credenciales tapadas):

![Swagger: solicitud](evidencias/swagger-1-login-request.png)
![Swagger: respuesta 200](evidencias/swagger-2-login-respuesta.png)
![Swagger: esquema documentado](evidencias/swagger-3-esquema-documentado.png)

- Misma prueba en Postman con la URL publicada: 200 OK con la estructura documentada.

![Postman: login 200](evidencias/postman-login-respuesta.png)

## 4. Tareas pendientes y responsables

| Tarea | Responsable |
|---|---|
| Crear la colección Postman con login y las operaciones principales | <asignar> |
| Verificar en Postman que códigos de estado y estructura coinciden con Swagger | <asignar> |
| Terminar la generación de reportes PDF / Excel / CSV | <asignar> |
| Implementar la restauración real de respaldos | <asignar> |
| Revisar pruebas automáticas y datos semilla para la demostración | <asignar> |

# Guion para presentar el Taller 4 (30 puntos)

## Antes de presentar (10 minutos antes)

1. Abre https://bfa-api-m03x.onrender.com/swagger-ui.html y espera a que cargue. El plan gratuito duerme la API tras ~15 min sin uso y el arranque en frío tarda de 2 a 3 minutos.
2. Abre `docs/TALLER4.md` en GitHub (el diagrama ER se dibuja solo).
3. Abre Postman, importa `docs/postman/BFA-API.postman_collection.json` y escribe tu contraseña en la variable `adminPassword`. No la compartas en pantalla.
4. Ten abierto el frontend: https://proyecto-final-bfa.vercel.app

## 1. Propuesta de base de datos (8 pts)

- Muestra el esquema general (3 bloques) y luego cada diagrama.
  - Bloque A: accesos (usuario, rol, permiso), catálogos y participantes, auditoría.
  - Bloque B: instrumentos (test → versión → subtest → ítem → opción), reglas de calificación, claves y baremos.
  - Bloque C: aplicación (sesión → asignación → intento → respuesta → resultado) y revisión manual.
- Señala claves primarias (PK), foráneas (FK) y cardinalidades (1 a muchos, y 1 a 1 entre asignación, intento y resultado).
- Explica cómo respalda la API con la tabla "Cómo el diseño respalda la API" de `TALLER4.md`.
- Dos decisiones de diseño para mencionar:
  - Una versión de test es inmutable al publicarse; un cambio crea otra versión.
  - Cada asignación guarda un único intento y un único resultado.

## 2. Avance funcional de la API (10 pts)

- Muestra la tabla de funcionalidades: 18 de 20 completadas = 90 %.
  - Cálculo: 18 / 20 × 100 = 90 %.
  - En desarrollo: reportes PDF/Excel/CSV y restauración real de respaldos.
- En Postman ejecuta **Run collection** y muestra que las operaciones principales pasan: login, perfil, roles, usuarios, carreras (listar y crear), participantes (listar y crear), tests, sesiones, auditoría.
- Frontend: muestra el login y la navegación en https://proyecto-final-bfa.vercel.app

## 3. Publicación y verificación de la API (8 pts)

- URL publicada: https://bfa-api-m03x.onrender.com
- Para que el docente la pruebe desde otro equipo: `GET https://bfa-api-m03x.onrender.com/v3/api-docs` (no pide login).
- En Swagger UI abre `POST /auth/login`, muestra la documentación (cuerpo y respuestas) y ejecútalo con **Try it out**.
- En Postman, con la misma URL, muestra la petición **1. Login**: código 200 y las pruebas de estructura en verde.
- Muestra también **1b. Login con credenciales incorrectas**: código 401 con la estructura de error.

## 4. Colaboración y seguimiento (4 pts)

- Trabajo individual: avisa al docente al inicio.
- Muestra el historial de commits de https://github.com/Nell16/proyecto-final-BFA (aporte verificable).
- Muestra la tabla de tareas pendientes con responsable (sección 4 de `TALLER4.md`).

## Si algo falla durante la demostración

| Síntoma | Qué hacer |
|---|---|
| La API tarda mucho o devuelve 503 | Está despertando; el arranque en frío tarda 2 a 3 minutos. Espera y repite |
| El frontend se queda cargando | Es la misma causa; abre Swagger y espera a que cargue |
| Postman da 401 en todo | Ejecuta primero la petición 1 (Login) y revisa `adminPassword` |
| Swagger no abre | Prueba https://bfa-api-m03x.onrender.com/swagger-ui/index.html |

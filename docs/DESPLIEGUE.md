# Despliegue

- Base de datos y almacenamiento: Supabase (proyecto `bfa-digital`, esquema cargado, bucket privado `images`).
- Backend: Docker (`backend/psychoform/Dockerfile`) en Render.
- Frontend: variable `VITE_API_URL` apunta a la URL pública de la API.

## Variables de entorno del backend

| Variable | Descripción |
|---|---|
| BFA_DB_URL | Cadena JDBC de Supabase (`jdbc:postgresql://...`) |
| BFA_DB_USERNAME / BFA_DB_PASSWORD | Usuario y contraseña de la base de datos |
| BFA_JWT_SECRET | Secreto largo para firmar los JWT |
| BFA_STORAGE_S3_ENDPOINT | Endpoint S3 de Supabase Storage |
| BFA_STORAGE_S3_REGION | Región del proyecto |
| BFA_STORAGE_S3_BUCKET | `images` |
| BFA_STORAGE_S3_ACCESS_KEY / BFA_STORAGE_S3_SECRET_KEY | Llaves S3 de Supabase |
| BFA_BOOTSTRAP_ADMIN_USERNAME / _EMAIL / _PASSWORD | Crea el primer administrador al iniciar |

Los valores secretos no se guardan en el repositorio.

# ADR-003 — Media Object Storage

- Status: accepted. Data: 2026.
- Contexto: mídia como base64 no banco / URLs externas sem controle (custo, tamanho, SSRF).
- Decisão: abstração `MediaStorage` (put/get/delete/exists/signed URL) + driver S3-compatível (MinIO/S3/R2, SSE-AES256) + driver memory explícito proibido em prod; metadados em `media_assets`; pipeline opt-in (`MEDIA_PIPELINE_ENABLED`) para data-URLs; fetch remoto opt-in com SSRF guard.
- Alternativas: filesystem local (não escala, sem presigned); sempre-fetch (latência/SSRF).
- Consequências: URLs externas continuam referência EXTERNAL+PENDING_SCAN até fetch explícito; storage público só após CLEAN.
- Segurança: presigned com expiração; bucket privado por padrão; sem credenciais em URL.
- Operacional: retenção configurável; quarentena com TTL curto.

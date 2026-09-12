# Docker Setup - Connect Desk

Este documento descreve como subir o projeto Connect Desk completamente em Docker, de forma limpa e reproduzível.

## Arquivos criados/alterados

### Novos Dockerfiles
- `apps/desk-api/Dockerfile` - API Fastify (usa tsx)
- `apps/desk-web/Dockerfile` - Frontend React (build estático + nginx)
- `apps/desk-web/nginx.conf` - Configuração do nginx (proxy /api e SPA)
- `apps/message-worker/Dockerfile` - Worker de mensagens
- `apps/realtime-service/Dockerfile` - Serviço WebSocket
- `services/db-init/Dockerfile` - Inicializador do banco (migrations + seed)

### Compose atualizado
- `docker-compose.yml` - Orquestra todos os serviços

### Scripts auxiliares
- `docker-up.sh` - Prepara .env e sobe os containers
- `docker-down.sh` - Derruba os containers

## Pré-requisitos

- Docker >= 24
- Docker Compose plugin
- (Opcional)make se quiser usar make targets

## Como usar

### 1. Preparar variáveis de ambiente

Se não houver `.env`, o script `docker-up.sh` cria automaticamente a partir de `.env.example`.

Caso queira customizar, edite o `.env` antes de subir.

### 2. Subir tudo

```bash
./docker-up.sh
```

Isso vai:
- Copiar `.env.example` para `.env` se necessário
- Subir PostgreSQL, Redis
- Executar migrations e seed
- Subir API, Frontend, Worker, Realtime

### 3. Verificar status

```bash
docker compose ps
```

### 4. Acessar serviços

- Frontend: http://localhost:8081
- API: http://localhost:3000
- API Docs (Swagger): http://localhost:3000/docs
- Health check: http://localhost:3000/health
- Readiness: http://localhost:3000/readiness
- Realtime WebSocket: ws://localhost:8080
- PostgreSQL: localhost:5432
- Redis: localhost:6379

### 5. Logs

```bash
docker compose logs -f          # todos
docker compose logs -f desk-api # só API
```

## Containers sobem

| Serviço           | Imagem construída | Porta exposta | Healthcheck |
|-------------------|-------------------|---------------|-------------|
| postgres          | postgres:15-alpine| 5432          | pg_isready  |
| redis             | redis:7-alpine    | 6379          | ping        |
| db-init           | custom            | (não expõe)   | (singleton) |
| desk-api          | custom            | 3000          | /health     |
| desk-web          | custom (nginx)    | 80 → 8081     | depende de desk-api |
| message-worker    | custom            | (nenhuma)     | always ok   |
| realtime-service  | custom            | 8080          | nc localhost:8080 |

O serviço `db-init` roda uma única vez (restart: "no") e executa migrations e seed. Ele depende do PostgreSQL saudável.

## Variáveis de ambiente obrigatórias

- `DATABASE_URL` - conexão PostgreSQL
- `PORT` (padrão 3000)
- `VITE_API_URL` (para frontend)

As demais são opcionais segundo a documentação atual.

## Healthcheck e Readiness

- **API `/health`**: `{ status: 'ok', timestamp: ... }`
- **API `/readiness`**: verifica conexão com banco e retorna `{ ready: true, checks: { database: { status: 'ok' } } }`

O `docker-compose.yml` usa esses endpoints parahealth de `desk-api`.

## Reset total

Para limpar tudo (incluindo volumes do banco e redis):

```bash
docker compose down -v
rm -rf .env  # se quiser reiniciar configuração
./docker-up.sh
```

## Notas de implementação

- Os apps backend usam `tsx` para rodar TypeScript diretamente no container. Isso elimina a necessidade de etapa de build (o projeto não tinha builds TypeScript configurados ainda).
- O frontend é buildado como estático e servido por nginx. O nginx está configurado para rotear `/api` para a API e servir SPA.
- O workspace pnpm é instalado com corepack para versão exata (10.33.0).
- As migrations e seed rodam automaticamente em um container separado antes da API subir.
- O worker não expõe porta; é um processo consumidor.
- O realtime-service usa WebSocket puro; healthcheck verifica se a porta está aberta.

## Problemas comuns

### API sobe mas /readiness Retorna database: error

Verifique se o `db-init` rodou com sucesso. Veja logs: `docker compose logs db-init`.

### Frontend 502 Bad Gateway

Verifique se a API está saudável (`docker compose ps desk-api`). O nginx proxy depende da API.

### Erro de conexão no banco

Confira se as variáveis `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` e `DATABASE_URL` estão consistentes.

### Migrations falham

As migrations usam `tsx src/migrate.ts`. Certifique-se de que o pacote `@cvg/database` e suas dependências estão instaladas corretamente no container `db-init`.

## Arquivos alterados

- `/home/ricardo/Área de trabalho/connect_desk/docker-compose.yml` - Substituído por versão completa
- `/home/ricardo/Área de trabalho/connect_desk/apps/desk-api/Dockerfile` - Criado
- `/home/ricardo/Área de trabalho/connect_desk/apps/desk-web/Dockerfile` - Criado
- `/home/ricardo/Área de trabalho/connect_desk/apps/desk-web/nginx.conf` - Criado
- `/home/ricardo/Área de trabalho/connect_desk/apps/message-worker/Dockerfile` - Criado
- `/home/ricardo/Área de trabalho/connect_desk/apps/realtime-service/Dockerfile` - Criado
- `/home/ricardo/Área de trabalho/connect_desk/services/db-init/Dockerfile` - Criado
- `/home/ricardo/Área de trabalho/connect_desk/docker-up.sh` - Criado
- `/home/ricardo/Área de trabalho/connect_desk/docker-down.sh` - Criado
- `/home/ricardo/Área de trabalho/connect_desk/DOCKER_SETUP.md` - Criado (este arquivo)

## Comandos úteis

```bash
# Rebuild de um serviço após mudanças no Dockerfile
docker compose build desk-api

# Subir apenas a infra (postgres, redis) e db-init
docker compose up -d postgres redis db-init

# Ver logs de um serviço específico
docker compose logs -f desk-api

# Executar comando dentro de um container
docker compose exec desk-api sh

# Stop sem destroy
docker compose stop

# Start novamente
docker compose start
```

## Checklist de validação

Após subir, verifique:

- [ ] `docker compose ps` mostra todos serviços "healthy" ou "running"
- [ ] `curl http://localhost:3000/health` retorna status ok
- [ ] `curl http://localhost:3000/readiness` retorna `ready: true` e database ok
- [ ] `curl http://localhost:3000/docs` abre Swagger
- [ ] Frontend http://localhost:8081 carrega
- [ ] Login inicial funciona com o usuário bootstrap (`ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD`)
- [ ] PostgreSQL contém dados seedados

## Considerações

A configuração atual assume que o ambiente de produção pode usar tsx para rodar TypeScript diretamente. Para otimizar, pode-se configurar um verdadeiro build tsc no futuro.

Para ambientes de produção, lembre-se de:
- Mudar senhas e JWT_SECRET
- Usar HTTPS no nginx
- Configurar backup do banco
- Limitar acesso às portas internas

---

Criado em: 2026-03-29
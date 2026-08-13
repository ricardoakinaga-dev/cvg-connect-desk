# Runbook de Release e Operação — CVG Connect Desk

**Status:** entrega atual  
**Owner primário:** Platform/SRE  
**Owners secundários:** Backend, Security, QA  
**Escalonamento:** incidente P0 de segurança ou perda de eventos → Security + Platform imediatamente; indisponibilidade de API/DB → Platform + Backend; regressão funcional → QA + Product.

## 1. Pré-release

Executar na branch/artefato que será promovido:

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm audit --audit-level moderate
pnpm run check:security:session
pnpm run lint
pnpm run typecheck
pnpm run build
```

Para as suítes reais, fornecer pelo secret manager:

```bash
export DATABASE_URL='postgresql://<user>:<password>@<host>:5432/<database>'
export REDIS_URL='redis://<host>:6379'
export REQUIRE_REAL_DB=1
export INTERNAL_EVENTS_SECRET='<rotated-internal-secret>'
export WEBHOOK_SECRET='<rotated-webhook-secret>'
export GATEWAY_WEBHOOK_SECRET='<rotated-gateway-secret>'
```

Depois executar `pnpm run test`, `pnpm run test:postgres-real`, `pnpm run test:coverage:critical` e o E2E em stack isolada. Não aprovar release com `skipped` em pacote crítico, falha de audit, erro de typecheck ou falha de migration.

## 2. Migrations e bootstrap

1. Fazer backup/snapshot do PostgreSQL.
2. Validar conectividade com o host e permissões do usuário de migration.
3. Executar `pnpm --filter @cvg/database db:migrate` uma única vez por banco.
4. Conferir a tabela de migrations e os índices de `sessions`, `dead_letter_events`, `webhook_security_events` e `gateway_request_nonces`.
5. Executar seed somente com `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD` fornecidos pelo secret manager. Valores default/curtos devem falhar.
6. Validar `GET /health` e `GET /ready` antes de abrir tráfego.

As migrations desta entrega são `0013_hash_session_tokens.sql`, `0014_dead_letter_events.sql` e `0015_operational_security_state.sql`.

## 3. Segredos e sessão

- `WEBHOOK_SECRET`, `GATEWAY_WEBHOOK_SECRET` e `INTERNAL_EVENTS_SECRET` são obrigatórios no ambiente de produção.
- Nunca colocar esses valores em git, imagem, log, query string ou resposta HTTP.
- Rotacione um segredo criando o novo valor no secret manager, reiniciando os consumidores dependentes e só então revogando o valor anterior conforme a janela acordada.
- Para invalidar sessões, revogue as linhas de `sessions` pelo procedimento aprovado pelo DBA ou use logout administrativo; não edite tokens manualmente.
- Se houver suspeita de vazamento, revogue sessões e segredos, preserve logs com correlation id e abra incidente Security.

## 4. DLQ e recuperação de eventos

Triagem:

1. Abrir Admin → Dead-letter ou consultar `/admin/dead-letters/stats` com uma sessão administrativa.
2. Consultar `/admin/operational/metrics` para backlog de outbox, idade do evento e limiares ativos.
3. Verificar `handler`, `event_type`, `failure_context`, `retry_count` e `source_event`.
4. Usar retry apenas para falhas transitórias e quando `source_event` estiver presente.
5. Marcar como resolvido somente após confirmar o efeito no domínio e registrar a causa no ticket do incidente.
6. Se o retry produzir nova falha, preservar o contexto e escalar para Backend/Platform; não apagar a DLQ para “limpar” o painel.

A operação é idempotente: retry e resolução não devem criar dois efeitos nem duas marcações finais. A DLQ é compartilhada entre API/worker/réplicas pelo PostgreSQL.

## 5. Gateway e webhook

Em caso de 401/403/409/429:

- confirmar escopo (`inbound`, `receipt`, `instance-status`, `outbound:read`, `outbound:write` ou `health`);
- conferir timestamp, nonce único e assinatura calculada sobre `timestamp.nonce.scope.body`;
- verificar relógio do host e rotação do segredo;
- consultar estatísticas persistentes de webhook por `reason`;
- não desabilitar HMAC, replay protection ou rate limit em produção como workaround.

Se a origem externa estiver repetindo requests, preserve o `correlation_id`, reduza a taxa na integração e use a janela de rate limit aprovada. O rate limit do gateway é por processo; a proteção contra replay é compartilhada pelo banco.

## 6. Indisponibilidade de PostgreSQL/Redis

1. Confirmar se é falha de rede, credencial, pool esgotado ou indisponibilidade do serviço.
2. Manter o tráfego fechado se `/ready` não conseguir validar dependências.
3. Não executar migrations ou seed enquanto o diagnóstico de conectividade estiver inconclusivo.
4. Após recuperação, validar outbox/DLQ, conexões WebSocket, health/readiness e uma mensagem de teste em ambiente controlado.
5. Liberar tráfego gradualmente e acompanhar p95, 5xx, backlog e reconnects.

## 7. Rollback

Rollback de aplicação:

1. Congelar promoção e registrar versão, migration e horário.
2. Retornar para a imagem anterior somente se ela for compatível com o schema atual.
3. Manter as migrations aditivas aplicadas; não executar `DROP` ou rollback destrutivo em produção como ação automática.
4. Se a migration for incompatível, restaurar snapshot em ambiente controlado, validar integridade e seguir o plano de recuperação aprovado pelo DBA.
5. Reexecutar health, readiness, testes smoke e consulta de backlog antes de reabrir tráfego.

## 8. Carga e SLO

O perfil reproduzível local/QA é:

```bash
TARGET_URL=http://localhost:4330 \
QA_PERF_PROFILE=local-docker \
P95_THRESHOLD_MS=1500 \
TEST_EMAIL="$TEST_EMAIL" \
TEST_PASSWORD="$TEST_PASSWORD" \
bash stress-test/run-k6-stress.sh
```

O gate local aprovado em 2026-08-12 teve 20.389 requests, 0% 5xx, checks 100% e p95 1.155,44 ms. Para staging/produção, usar `QA_PERF_PROFILE=production` e o SLO de p95 500 ms; arquivar o JSON antes da aprovação.

## 9. Critérios de escalonamento

| Severidade | Critério | Ação |
|---|---|---|
| P0 | segredo exposto, bypass de auth, perda/duplicação de eventos ou DB indisponível sem fail-closed | bloquear release/tráfego, Security + Platform imediatos, preservar evidências |
| P1 | 5xx >1%, DLQ acima do limiar, p95 fora do SLO, retry crescente ou reconnect anormal | abrir incidente, reduzir tráfego, executar triagem DLQ e plano de recuperação |
| P2 | erro isolado de UI, métrica ausente ou documentação divergente sem impacto | ticket com owner e prazo, sem workaround inseguro |

Ao encerrar, registrar causa raiz, impacto, timeline, comandos executados, decisão de rollback/retomada e follow-up no backlog.

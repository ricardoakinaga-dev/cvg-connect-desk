# PROD-15 — Validar upload e resolução autorizada de assets

**Observação da auditoria:** Suíte R3 de PROD-15 executada em segmento próprio r3-prod15-20260914-a1; 12/12 passou com HTTP real, PostgreSQL/Redis isolados, moto S3-compatible e ClamAV reais. MinIO, revisão independente, staging externo e D05 permanecem pendentes.

**Tratamento:** PRESERVE_COMPLETE_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** Sem achado individual; completar/revalidar os aceites.

**Origem:** CVG-IMPROVEMENTS-20260913-R2 / PROD-15 / estado recebido PLANNED

**Estado:** REVIEW · **Prioridade:** P1 · **Marco:** M1 · **Estimativa relativa:** 5

**Dono funcional:** Backend mídia + plataforma · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** BE15, BE10, UI04

**Dependências:** [PROD-11](PROD-11.md), [PROD-14](PROD-14.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `packages/media/src`
- `modules/chat/src/presentation/http/media-upload.controller.ts`
- `modules/chat/src/application/use-cases/send-outbound-message.use-case.ts`
- `apps/desk-api/src/app.ts`
- `apps/desk-web/nginx.conf`
- `apps/desk-api/src/__tests__/production/prod-15.test.ts`

**Locks:** api-composition

## Critérios de aceite

- **PROD-15-AC1** — Limite 16MiB útil consistente proxy/API/storage incluindo overhead; tamanho exato aceita se válido e excesso413; stream/limites protegem memória e abort/cancel limpa apenas asset do run.
- **PROD-15-AC2** — Leitura/download/URL assinada confere ator, conversa, estado CLEAN e prefixo; outro setor/assetId adulterado, expirado/revogado, infected e pending negados.
- **PROD-15-AC3** — Transportar documento/vídeo/imagem/áudio por asset, preservando DTO de cliente e não aceitando URL arbitrária no outbound; falha de scanner/storage claramente recuperável.
- **PROD-15-AC4** — Executar via HTTP de imagem de produção com MinIO/ClamAV reais, fronteiras de tamanho e assinatura expirando; nenhum mock substitui scanner/storage para esse aceite.

## Verificação proposta

Estado: **PASS**. Ambiente: Candidato R3 com PostgreSQL/Redis isolados, HTTP real via app.listen/fetch, moto S3-compatible real e ClamAV real em 127.0.0.1:53110 com EICAR; MinIO real bloqueado por ausência de binário/permissão Docker; nenhum dado de produção..

12 testes passam sem skip; limites 16MiB, upload/abort, MIME/magic, leitura autorizada, TTL/assinatura, outbound por asset, idempotência e integração inbound/legado permanecem observáveis; MinIO, revisão independente e staging externo continuam pendentes.

```bash
CVG_PROGRAM_DIR=/home/ricardo/cvg-connect-desk/docs/melhorias-2026-09-13-r3 CVG_RUNTIME_DIR=/home/ricardo/cvg-connect-desk/docs/melhorias-2026-09-13-r3/evidencias/prod-15/r3-prod15-20260914-a1/runtime CVG_EVIDENCE_SEGMENT=r3-prod15-20260914-a1 AAA_RUN_ID=r3-prod15-20260914-a1 AAA_WORKER_INDEX=41 AAA_ATTEMPT=1 pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-15.test.ts
```

Estado: **TO_CREATE**. Ambiente: Candidato R3 próprio; identidade/portas/recursos declarados antes de imports; terceiros somente sandbox autorizado..

Provar os aceites R3 e preservar regressões resolvidas. Logs de auditoria são baseline; cada aceite real exige ferramenta/ambiente apropriado, revisão e evidência nova.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Suíte R3 executada em HTTP real com PG/Redis isolados, moto S3-compatible e ClamAV reais; 12/12 testes passaram cobrindo limites, abort, autorização, assinatura/TTL, outbound por asset, idempotência e integração inbound/legado. MinIO, revisão independente, staging externo e D05 permanecem pendentes.

**Sinal de conclusão da ação:** Aceites cobertos por evidência atual e revisão; pendências externas registradas sem PASS implícito.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: evidencias/prod-15/r3-prod15-20260914-a1/manifest.json, evidencias/prod-15/r3-prod15-20260914-a1/prod-15.test.log, evidencias/prod-15/r3-prod15-20260914-a1/prod-15-evidence.json, evidencias/prod-15/r3-prod15-20260914-a1/logs/moto-server.log, evidencias/prod-15/r3-prod15-20260914-a1/runtime/environment/isolated-env.json

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.

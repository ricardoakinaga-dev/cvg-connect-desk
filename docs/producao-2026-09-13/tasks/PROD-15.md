# PROD-15 — Validar upload e resolução autorizada de assets

**Estado:** IMPLEMENTED · **Prioridade:** P1 · **Marco:** M1 · **Estimativa relativa:** 5

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

Estado: **TO_CREATE**. Ambiente: synthetic-isolated.

Especificação de regressão a criar/adaptar após descoberta. Cobrir os aceites aplicáveis com casos positivos e negativos; exit 0 isolado não comprova o aceite integrado.

```bash
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-15.test.ts
```

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Upload/resolução de assets implementados; 12/12 com moto/ClamAV; MinIO e assinatura real permanecem limitados.

**Sinal de conclusão da ação:** Revisor confirma limites, autorização cross-conversa e ciclo CLEAN/INFECTED/PENDING sem URL crua.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: evidencias/prod-15/RELATORIO.md

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.

# PROD-02 — Corrigir gate mestre e vínculo de evidência ao candidato

**Estado:** IMPLEMENTED · **Prioridade:** P0 · **Marco:** M0 · **Estimativa relativa:** 5

**Dono funcional:** Plataforma + crítico de evidências · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** OP01, OP07, OP16

**Dependências:** [PROD-00](PROD-00.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `scripts/triple-aaa-verify.mjs`
- `scripts/production/evidence-gate.mjs`
- `scripts/production/prod-02.test.mjs`

**Locks:** Aplicar exclusão por arquivos e recursos do ambiente.

## Critérios de aceite

- **PROD-02-AC1** — Rejeitar SHA/lock/source/image digest divergentes, evidência antiga de outro candidato, JSON vazio/truncado, query set vazio e PASS só narrativo; conservar logs da falha.
- **PROD-02-AC2** — FAIL, BLOCKED, NOT_RUN, skipped indevido e gate requerido ausente impedem VERIFIED_CANDIDATE; saída não zero para falha e estado inequívoco para evidência ausente.
- **PROD-02-AC3** — Exigir manifesto por check com comando, ambiente, horário, resultado, hashes e escopo real; não reutilizar percentuais de coverage fixos no texto.
- **PROD-02-AC4** — Caso bom selado aceita; cada caso ruim isoladamente rejeita. Selo AAA não pode ser criado só por status local nem sem política de release definida.

## Verificação proposta

Estado: **TO_CREATE**. Ambiente: synthetic-isolated.

Especificação de regressão a criar/adaptar após descoberta. Cobrir os aceites aplicáveis com casos positivos e negativos; exit 0 isolado não comprova o aceite integrado.

```bash
node --test scripts/production/prod-02.test.mjs
```

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Gate mestre corrigido e 17 testes verdes localmente; aguarda revisao independente.

**Sinal de conclusão da ação:** Critico reproduz adversariais rejeitados no candidato.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: evidencias/prod-02/RELATORIO.md

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.

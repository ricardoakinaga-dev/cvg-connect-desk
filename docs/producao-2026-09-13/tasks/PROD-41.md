# PROD-41 — Preparar pacote revisável e decisão go/no-go

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M5 · **Estimativa relativa:** 5

**Dono funcional:** Lead release + operador responsável · **Risco:** R2 · **Classe:** OPERACAO_CONDICIONAL

**Itens auditados:** OP09, OP16, BE20, OP08

**Dependências:** [PROD-40](PROD-40.md)

**Decisões:** D02, D06

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `docs/producao-2026-09-13/evidencias/release`
- `docs/PRODUCTION_DEPLOYMENT.md`
- `docs/RUNBOOK.md`

**Locks:** Aplicar exclusão por arquivos e recursos do ambiente.

## Critérios de aceite

- **PROD-41-AC1** — Pacote imutável commit/source/lock/SBOM/image-digests, matriz de evidências, migração expand/rollback/runbook,configuração com segredos ocultados, backup válido e owners de incidente/contatos/plantão identificados.
- **PROD-41-AC2** — D06 fixa domínio/TLS,ambiente,capacidade,janela,perfilpiloto,critériosabort/rollback,observação,custo e responsáveis; D02 retenção ratificada; credenciais e sandbox/providerteste realmente disponíveis.
- **PROD-41-AC3** — Dry-run de deploy com mesmas imagens em staging privado e permissões mínimas; registrar risco residual concreto e mudança de código após selo invalida o aceite e repete gates afetados.
- **PROD-41-AC4** — Solicitar aprovação apenas sobre esse pacote concreto se implantação ainda não tiver autorização explícita. Decisão go/no-go do operador identificada, nunca inferida de timeout/notas.

## Verificação proposta

Estado: **NOT_RUN**. Ambiente: revisão documental; operação somente quando autorizada.

Revisão registrada requisito por requisito, links a artefatos e identidade do candidato. Decisões humanas e observação de campo não são substituídas por teste automatizado.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Revalidar os achados e predecessores desta tarefa no candidato atual, antes de editar.

**Sinal de conclusão da ação:** Mapa achado→caminho real e reprodução/limite atual registrados no retorno.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: Ainda não produzidas para esta execução.

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.

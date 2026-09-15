# Melhorias R3 — referência atual

**Produto NOT_READY · programa PLANNED_NOT_EXECUTING.** Auditoria realizada; implementação futura não executada nesta solicitação.

- [Auditoria R3](../auditorias/2026-09-13-r3/RELATORIO.md) e [verificações](../auditorias/2026-09-13-r3/VERIFICACOES.json).
- [Plano executivo](PLANO-EXECUTIVO.md), [roadmap](ROADMAP.md), [backlog legível](BACKLOG.md) e [fonte canônica JSON](BACKLOG.json).
- [Contratos](CONTRATOS.md), [critérios G01–G12](CRITERIOS.md), [decisões D01–D06](DECISOES.md), [protocolo do agente](AGENTE.md) e [rastreabilidade](RASTREABILIDADE.md).

45 cartões: PROD-00–43 preservados e PROD-44 novo para bootstrap realtime. As55 exigências originais e37 registros de achados estão mapeados. 5 achados específicos resolvidos exigem regressão, não reimplementação. Estado PLANNED é da nova execução; observações reconhecem resultados auditados. Não chamar todos os cartões de pendências de código: muitos combinam complemento, prova e operação.

Início: PROD-00 identifica candidato/ambiente; PROD-44 restaura entrypoint nativo e libera PROD-05. PROD-02 corrige os novos adversariais em paralelo somente com ownership separado. Decisões abertas bloqueiam apenas seus efeitos dependentes. Release exige o pacote final e autorização aplicável.

Validar sem executar tarefas: `python3 docs/melhorias-2026-09-13-r3/plan.py validate`. Regenerar Markdown após editar JSON: trocar `validate` por `render`. O validador verifica estrutura/hashes/cobertura/DAG, não prontidão do produto.

Histórico preservado: [R2](../melhorias-2026-09-13/README.md), [produção inicial](../producao-2026-09-13/README.md). Novas provas devem ficar nesta rodada com runId/attempt próprios; os scripts com caminho histórico fixo precisam parametrização antes de execução.

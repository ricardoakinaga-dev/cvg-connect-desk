# PROD-40 — Auditoria independente final do candidato integrado

**Observação da auditoria:** Crítica desta rodada aprova ou reprova o pacote documental, não o produto. Revisão independente do candidato integrado G01–G12 ainda pendente.

**Tratamento:** PRESERVE_COMPLETE_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** OPS07, R3-OP02

**Origem:** CVG-IMPROVEMENTS-20260913-R2 / PROD-40 / estado recebido PLANNED

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M5 · **Estimativa relativa:** 8

**Dono funcional:** Crítico final fresco + integrador · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** BE01, BE02, BE03, BE04, BE05, BE06, BE07, BE08, BE09, BE10, BE11, BE12, BE13, BE14, BE15, BE16, BE17, BE18, BE19, BE20, UI01, UI02, UI03, UI04, UI05, UI06, UI07, UI08, UI09, UI10, UI11, UI12, UI13, UI14, UI15, UI16, UI17, OP01, OP02, OP03, OP04, OP05, OP06, OP07, OP08, OP09, OP10, OP11, OP12, OP13, OP14, OP15, OP16, DT01, DT02

**Dependências:** [PROD-00](PROD-00.md), [PROD-01](PROD-01.md), [PROD-02](PROD-02.md), [PROD-03](PROD-03.md), [PROD-04](PROD-04.md), [PROD-05](PROD-05.md), [PROD-06](PROD-06.md), [PROD-07](PROD-07.md), [PROD-08](PROD-08.md), [PROD-09](PROD-09.md), [PROD-10](PROD-10.md), [PROD-11](PROD-11.md), [PROD-12](PROD-12.md), [PROD-13](PROD-13.md), [PROD-14](PROD-14.md), [PROD-15](PROD-15.md), [PROD-16](PROD-16.md), [PROD-17](PROD-17.md), [PROD-18](PROD-18.md), [PROD-19](PROD-19.md), [PROD-20](PROD-20.md), [PROD-21](PROD-21.md), [PROD-22](PROD-22.md), [PROD-23](PROD-23.md), [PROD-24](PROD-24.md), [PROD-25](PROD-25.md), [PROD-26](PROD-26.md), [PROD-27](PROD-27.md), [PROD-28](PROD-28.md), [PROD-29](PROD-29.md), [PROD-30](PROD-30.md), [PROD-31](PROD-31.md), [PROD-32](PROD-32.md), [PROD-33](PROD-33.md), [PROD-34](PROD-34.md), [PROD-35](PROD-35.md), [PROD-36](PROD-36.md), [PROD-37](PROD-37.md), [PROD-38](PROD-38.md), [PROD-39](PROD-39.md), [PROD-44](PROD-44.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `docs/melhorias-2026-09-13-r3/evidencias/final`

**Locks:** Aplicar exclusão por arquivos e recursos do ambiente.

## Critérios de aceite

- **PROD-40-AC1** — Crítico fresco distinto dos builders/revisores intermediários inspeciona produto e registros selados contra cada requisito, sem usar nota anterior ou relato de builder como prova.
- **PROD-40-AC2** — Revalidar todos os gates G01–G12 exigidos antes de release no mesmo candidato/digest; nenhuma falhaCritical/High ou requerida aberta e nenhum resultado STALE/NOT_RUN substituído por média.
- **PROD-40-AC3** — Sentinela de fontes antes/depois limpa, evidências rejeitam versões falsas e casos conhecidos ruins; amostras visuais e fluxos completos revisados conforme critério configurado.
- **PROD-40-AC4** — Emitir READY_FOR_RELEASE apenas para artefato íntegro aprovado; achado volta dono existente REWORK com regressão+novo crítico, sem criar certificação/implantação automática.
- **PROD-40-R3-AC1** — Validar run/attempt e vínculo esperado tanto no payload quanto no manifesto derivado; preservar metadados e exigir mesma semântica de identidade/tempo em todas vias.

## Verificação proposta

Estado: **NOT_RUN**. Ambiente: revisão documental; operação somente quando autorizada.

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

Estado: **TO_CREATE**. Ambiente: Candidato R3 próprio; identidade/portas/recursos declarados antes de imports; terceiros somente sandbox autorizado..

Provar os aceites R3 e preservar regressões resolvidas. Logs de auditoria são baseline; cada aceite real exige ferramenta/ambiente apropriado, revisão e evidência nova.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Crítica desta rodada aprova ou reprova o pacote documental, não o produto. Revisão independente do candidato integrado G01–G12 ainda pendente. Registrar subtarefas de correção e prova conforme aceites, preservando o comportamento já correto.

**Sinal de conclusão da ação:** Aceites cobertos por evidência atual e revisão; pendências externas registradas sem PASS implícito.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: Ainda não produzidas para esta execução.

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.

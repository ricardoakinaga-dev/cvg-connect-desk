# PROD-01 — Fechar contratos e decisões de escopo/produção

**Observação da auditoria:** 4/4 casos documentais passam; C01-C10 estão explicitamente registrados e D01-D06 têm alcance/dono funcional, mas nenhuma decisão foi ratificada e contratos externos continuam sem aceite oficial.

**Tratamento:** PRESERVE_COMPLETE_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** BE-A03, DOC01

**Origem:** CVG-IMPROVEMENTS-20260913-R2 / PROD-01 / estado recebido PLANNED

**Estado:** REVIEW · **Prioridade:** P1 · **Marco:** M0 · **Estimativa relativa:** 3

**Dono funcional:** Lead + donos de produto/dados/operação · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** BE01, BE02, BE03, BE04, BE20, DT01, UI05, UI10, UI13, OP16

**Dependências:** [PROD-00](PROD-00.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `docs/melhorias-2026-09-13-r3/CONTRATOS.md`
- `docs/melhorias-2026-09-13-r3/DECISOES.md`

**Locks:** Aplicar exclusão por arquivos e recursos do ambiente.

## Critérios de aceite

- **PROD-01-AC1** — Publicar contratos C01–C10 definidos em CONTRATOS.md com produtor, consumidor, payload positivo/negativo, erro, versão, compatibilidade e evidência requerida; ratificar os recortes já congelados sem redesenhar sessão ou canal.
- **PROD-01-AC2** — Registrar decisões D01–D06 com dono e alcance: permissões efetivas, dados/retencão, tutor-paciente, expansões Kanban, ferramentas IA e condições operacionais. Decisão não tomada bloqueia só ação dependente; não inventar ratificação.
- **PROD-01-AC3** — Manter todos os 55 itens cobertos; funcionalidades já completas recebem validação, não reimplementação. Cada possível exclusão precisa origem, motivo, dono e registro explícito; não classificar ausência como concluída.
- **PROD-01-AC4** — Distinguir implementação autorizada por futura solicitação, aprovação técnica e implantação externa; plano atual não inicia nenhuma delas.

## Verificação proposta

Estado: **PASS**. Ambiente: Candidato R3; Node v24.20.0; revisão documental local; nenhum contrato externo ou decisão de produto ratificado.

4/4 casos passam; C01-C10 têm produtor/consumidor/payload/erro/versão/compatibilidade/evidência, D01-D06 permanecem OPEN e os 55 itens continuam cobertos.

```bash
node --test scripts/production/prod-01.test.mjs
```

Estado: **TO_CREATE**. Ambiente: Candidato R3 próprio; identidade/portas/recursos declarados antes de imports; terceiros somente sandbox autorizado..

Provar os aceites R3 e preservar regressões resolvidas. Logs de auditoria são baseline; cada aceite real exige ferramenta/ambiente apropriado, revisão e evidência nova.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Contratos C01-C10 foram registrados com caminhos reais, payloads, erros, compatibilidade e provas; D01-D06 continuam OPEN com donos funcionais e bloqueios delimitados. Aguardar revisão independente e ratificação nominal antes de qualquer ação dependente.

**Sinal de conclusão da ação:** Aceites cobertos por evidência atual e revisão; pendências externas registradas sem PASS implícito.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: evidencias/prod-01/r3-prod01-20260913-a1/manifest.json, evidencias/prod-01/r3-prod01-20260913-a1/prod-01.test.log

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.

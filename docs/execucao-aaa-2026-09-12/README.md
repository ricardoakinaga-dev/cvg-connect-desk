**Programa de melhoria CVG — plano para State of Art / Triplo AAA**

Este pacote transforma a auditoria de 12/09/2026 em **32 tarefas executáveis por agentes**, cobrindo **A01–A16, L01 e as 18 dimensões avaliadas**. É um plano de execução futuro; nenhuma tarefa do produto foi declarada concluída. A baseline permanece **53/100**.

| Documento | Uso |
|---|---|
| [Relatório original](../auditorias/2026-09-12/RELATORIO.md) | Achados e evidências preservados |
| [Plano executivo](PLANO_EXECUTIVO.md) | Resultado, prioridades, governança, riscos e recursos |
| [Roadmap](ROADMAP.md) | Marcos, dependências, caminho crítico e demonstrações |
| [Backlog legível](BACKLOG.md) | Tarefas e rastreabilidade; derivado do JSON |
| [BACKLOG.json](BACKLOG.json) | Fonte canônica dos contratos de tarefas; status PLANNED |
| [Critérios de qualidade](QUALIDADE.json) | Barra técnica/operacional/visual v1, ainda não verificada |
| [Contratos](CONTRATOS.md) e [decisões](DECISOES.md) | Interfaces e decisões antes de trabalho paralelo |
| [Execução multiagente](EXECUCAO_MULTIAGENTE.md) | Prompts, ownership, revisão, integração e recuperação |
| [Retorno recebido de AAA-03](runtime/retornos/2026-09-12-AAA-03.md) | Bloqueio informado, reconciliação e próxima ação; não constitui liberação |
| [Retorno recebido de AAA-02](runtime/retornos/2026-09-12-AAA-02.md) | Ciclo Chat/Gateway, bloqueio e divergências de ambiente observadas após o relato |
| [Matriz de design/QA](DESIGN_QA.md) | Rotas, estados, viewports e aceitação visual/acessível |
| [Verificação deste plano](VERIFICACAO.md) | Validação do pacote e revisão independente; não certificação do produto |

Da raiz do repositório:

```bash
python3 docs/execucao-aaa-2026-09-12/plan.py validate
python3 docs/execucao-aaa-2026-09-12/plan.py list
python3 docs/execucao-aaa-2026-09-12/plan.py waves --slots 2
python3 docs/execucao-aaa-2026-09-12/plan.py brief AAA-00
```

`waves` simula lotes possíveis, sem executar agentes, sem comprovar dependências e sem marcar tarefas prontas. `brief` gera o pacote da tarefa; o coordenador ainda precisa verificar predecessores e adquirir ownership antes de despachar. O primeiro cartão é [AAA-00](tasks/AAA-00.md).

Para iniciar em outra conversa, use o prompt em [EXECUCAO_MULTIAGENTE.md](EXECUCAO_MULTIAGENTE.md). A execução futura deve manter estado e evidências sob `runtime/` deste programa e não reaproveitar os runs históricos de `.gauntlet/` como prova atual.

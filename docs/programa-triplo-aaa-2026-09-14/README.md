# Programa executivo Triplo AAA — CVG Connect Desk

**Versão:** 3 · **Data:** 15/09/2026 · **Estado:** EM EXECUÇÃO, produto `NOT_READY`.

Programa para elevar **todos os 48 itens do relatório e as 11 dimensões de UX à meta mínima de 95/100**, com comprovação técnica e revisão independente. Contém **63 tarefas, 8 marcos e 411 pontos relativos**. Após a auditoria R3: **0 DONE, 19 REWORK e 44 PLANNED**. As implementações anteriores foram preservadas, mas suas promoções foram reabertas por evidência incompleta ou antiga. A baseline permanece 73/100; não houve repontuação SA-059.

“Triplo AAA” é o padrão interno definido neste programa para engenharia, experiência e operação. Não é uma certificação externa, não significa conformidade WCAG AAA e não foi conquistado pela criação destes documentos.

## Entregáveis

1. [Plano executivo](PLANO-EXECUTIVO.md): resultado, execução, arquitetura, riscos, recuperação e responsabilidades.
2. [Roadmap](ROADMAP.md): marcos, demonstrações, dependências e capacidade.
3. [Backlog executivo](BACKLOG.md): tarefas priorizadas; [JSON canônico](BACKLOG.json) e [cartões individuais](tasks).
4. [Critérios Triplo AAA](CRITERIOS.md): metas e gates que podem reprovar o candidato.
5. [Contratos](CONTRATOS.md): regras entre backend, interface, dados e operação.
6. [Decisões](DECISOES.md): propostas e ações dependentes de política/autoridade.
7. [Rastreabilidade](RASTREABILIDADE.md): cada item, dimensão, achado e gate ligado a executores.
8. [Guia do agente](AGENTE.md): como começar, dividir trabalho, registrar evidência e retomar.
9. [Validação do programa](VALIDACAO.md): coerência, cobertura, revisão e limites desta entrega.
10. [Execução atual](EXECUCAO.md): checkpoint auditado, verificações e próxima ação.
11. [Auditoria R3](../auditorias/2026-09-15-checkpoint-triplo-aaa-r3/RELATORIO.md): confronto atual entre estado, candidato, código e evidências.
12. [Rodada R3](rodadas/R3/README.md): [roadmap](rodadas/R3/ROADMAP-R3.md) e [backlog priorizado](rodadas/R3/BACKLOG-R3.md).

## Próxima ação do agente executor

Na raiz do repositório:

```bash
python3 docs/programa-triplo-aaa-2026-09-14/programa.py validate
python3 docs/programa-triplo-aaa-2026-09-14/programa.py next
```

Começar por [SA-001](tasks/SA-001.md), reparando o ponto cego do selo, separando produto e livro-caixa e validando ambos com controles known-good/known-bad. Depois requalificar fundação e M1 em lotes pequenos. O utilitário valida o **plano**, não certifica o produto.

## Fontes e relação com programas anteriores

Base: [auditoria de 14/09](../auditorias/2026-09-14/RELATORIO.md), [notas](../auditorias/2026-09-14/NOTAS.json) e [revisão](../auditorias/2026-09-14/REVISAO.md). Orçamentos e obrigações produtivas vêm dos [critérios R3](../melhorias-2026-09-13-r3/CRITERIOS.md), dos contratos/ADRs e do brief CVG.

Este pacote é a proposta atual de execução **baseada nessa auditoria**. Os programas anteriores continuam históricos; não executar backlogs concorrentes nem herdar DONE/PASS. SA-001 concilia qualquer trabalho já realizado desde a auditoria e SA-057 atualiza a navegação documental. Nenhum histórico foi apagado.

## O que o checkpoint atual comprova

Há progresso técnico preservado: typecheck 33/33, regressão `test:ci` em runner isolado e 35/35 testes focados de SA-015/019 passaram, conforme os [artefatos da auditoria R3](../auditorias/2026-09-15-checkpoint-triplo-aaa-r3/ARTIFACTS.json). Isso não sustenta os estados terminais: G01, G05, G08 e G11 falham; G09 carece de harness válido; a matriz UX não foi executada. G01–G12 não possuem aprovação coletiva e a qualificação continua aberta.

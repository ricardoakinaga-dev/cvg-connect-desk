**Como executar este backlog com múltiplos agentes**

O catálogo `BACKLOG.json` é fonte única de intenção, dependências, ownership e aceite. `BACKLOG.md` e `tasks/*.md` são gerados; não editar à mão. Ele não é ledger de execução e não deve ganhar DONE por edição manual. `plan.py` consulta, valida e simula; não inicia agentes, não altera serviços e não certifica o produto.

**Prompt pronto para o coordenador**

```text
Execute o programa docs/execucao-aaa-2026-09-12 com $orchestrate,
$engineering-framework, $gauntlet-loop e $design-director na fronteira visual.
Leia README, PLANO_EXECUTIVO, ROADMAP, BACKLOG.json, QUALIDADE.json,
CONTRATOS, DECISOES, DESIGN_QA e instruções aplicáveis.
Comece por AAA-00. Faça correções locais e verificações com dados isolados.
Preserve o relatório e alterações preexistentes. Não publique/deploy nem
contate clientes. Resolva escolhas técnicas rotineiras autonomamente;
decisões de dados não autorizadas bloqueiam apenas a tarefa dependente.
Use no máximo 3 agentes ativos: 1 lead + até 2 builders sem colisão.
A revisão por crítico fresco ocupa uma dessas 3 vagas. Não delegue
subagentes de segundo nível. Use os briefs do plan.py, conclua todos os
itens aplicáveis com evidência atual e integre antes de marcar DONE.
Não chame o produto de AAA enquanto houver gate obrigatório pendente.
```

O prompt acima é uma instrução para a futura execução quando enviada pelo usuário. Sua presença neste documento não autoriza iniciar correções durante uma tarefa somente de planejamento.

**Preparação do coordenador**

1. Ler instruções vigentes, `git status`, revisão e hashes. Validar catálogo com `python3 docs/execucao-aaa-2026-09-12/plan.py validate`. Se o hash do relatório não bater, investigar sem reescrever o histórico.
2. Executar AAA-00 e identificar recursos vivos por ferramenta/processo. Um arquivo RUNNING ou lock antigo não comprova processo ativo. Descobrir serviços em vez de repetir setup destrutivo após timeout.
3. Criar estado de execução somente agora: `runtime/` armazena evidências, manifesto, decisões e ponteiro para o catálogo. Se usar ferramentas de estado das skills, criar controlador no checkout isolado do novo run conforme schema da ferramenta; não sobrescrever `.gauntlet/` do redesign nem converter este catálogo arbitrariamente em schema v3.
4. Congelar contratos necessários em AAA-01. Decisão D02 pendente não paralisa sessões/build; bloqueia apenas mudanças de retenção dependentes. Não liberar um consumidor cujo contrato específico ainda não foi decidido.
5. Registrar intenção da tarefa e contratos por hash. O ledger de execução referencia catálogo/ID e guarda status, tentativas, processo e evidências; não duplica a especificação. Um único lead escreve estado e mantém transições auditáveis.

**Despacho seguro**

Consultar `python3 docs/execucao-aaa-2026-09-12/plan.py waves --slots 2` para simulação de lotes. Esses lotes respeitam dependências estruturais e ownership declarado; antes de cada despacho conferir que predecessores foram realmente revisados e integrados. Se a task terminou apenas no branch do builder, ainda não está disponível para dependentes. Atualizar conflito real de paths conforme os diffs forem surgindo.

Gerar pacote: `python3 docs/execucao-aaa-2026-09-12/plan.py brief AAA-03`. No host atual, o lead usa `collaboration.spawn_agent` com `fork_turns="none"` e o pacote. Modelo/capacidade seguem o host; não inventar flags de CLI ou orquestração. Cada builder executa diretamente e não cria descendentes.

Worktrees isoladas reduzem colisão física, mas não resolvem incompatibilidade de contratos. O lead cria e atribui worktree/branch quando autorizado, com porta/DB/namespace/fixtures exclusivos. Em filesystem compartilhado, arquivo, pasta ancestral, migration, lockfile, CSS global e estado têm um único dono por vez. Tasks marcadas `exclusive_repo` são exclusivas de escrita. Review pode ler candidato congelado enquanto outros trabalham em cópias separadas.

**Estados futuros e retorno**

**Responsabilidade documental — instrução do usuário em 12/09/2026.** O assistente coordenador desta conversa é responsável por manter a documentação atualizada a cada tarefa, inclusive em bloqueios, falhas, revisões e integrações. Builders entregam resultados e evidências; o coordenador os confere e consolida antes de encerrar o retorno da tarefa, sem depender de nova solicitação do usuário.

Para cada tarefa, registrar ID, responsável informado, estado, origem e grau de verificação das informações, arquivos alterados, decisões/contratos afetados, comandos e resultados efetivamente observados, evidências, limitações, bloqueios e próxima ação. Atualizar os documentos canônicos afetados; manter histórico dos retornos em `runtime/retornos/` e o estado operacional no controlador adotado. Um relato recebido não substitui evidência verificada nem cria aprovação ou lease. A existência de `runtime/` também não comprova preparação do ambiente.

Preservar `BACKLOG.json` como catálogo PLANNED e gerar seus derivados com `plan.py` quando a especificação mudar. Não editar cartões gerados à mão nem reutilizar a revisão histórica do plano como aprovação de alterações posteriores. No fechamento de cada tarefa, informar os documentos atualizados e a verificação realizada.

Usar o schema do controlador escolhido, preservando significado: pendente → pronta por evidência → em execução → implementada → revisão → verificada → integrada/concluída; falha gera retrabalho ou bloqueio explicitamente registrado. Não misturar enums de ferramentas distintas. Builder só retorna IMPLEMENTED; lead marca concluída após revisão, integração e regressão. Ausência de ambiente não vira skip aprovado.

Retorno mínimo do builder: ID; commit base/candidato; caminhos/diff; contratos e alterações; comandos, exits, artefatos e SHA-256; testes negativos antes/depois; regressão; limites/risco residual; proposta de próxima ação. Sanitizar tokens/PII. A evidência precisa corresponder ao artefato, não só ao relato. Cada tentativa guarda hipótese e resultado; após duas tentativas sem progresso novo, diagnosticar e redistribuir em vez de repetir.

**Protocolo Gauntlet em cada marco**

GOAL → BAR → BUILD → RUN → CRITIQUE → FIX → RETEST → INTEGRATE → VERDICT. Escolher maior gap obrigatório por risco; não escolher correção estética fácil para adiar isolamento. Bar v1 em QUALIDADE; revisão só por mudança de requisito ou prova de medição inválida, com histórico e impactos. Caso conhecido ruim deve ser rejeitado pelo teste de aceitação.

O crítico recebe intenção/aceite/contratos e candidato congelado, sem diagnóstico do builder, sua nota ou resultado desejado. `fork_turns="none"`, read-only, nenhum descendente. I1 = contexto novo na mesma família de modelo; não equivale a auditoria humana independente. Comparar fingerprint do produto antes/depois; qualquer mutação invalida revisão. Para material visual, aplicar DESIGN_QA com dois julgamentos cegos. O crítico final AAA-28 é novo e distinto dos anteriores.

**Integração e recuperação**

O lead inspeciona diff, resolve conflitos com o contrato vigente, gera tipos/migrations somente como dono, executa regressão integrada e registra hash do candidato. Mudança material invalida evidência dependente; um teste isolado antigo não aprova todo o sistema. Na retomada, comparar estado com branch, processo real, contratos, último resultado e integridade dos arquivos. Timeout de observação não autoriza reiniciar worker vivo. Não reverter nem apagar trabalho alheio para limpar o tree.

Falhas de produção, publicação, compra, segredo e eliminação de dados exigem escopo explícito correspondente. Preparar material revisável primeiro; não pedir confirmação repetida para ações locais já autorizadas. A disponibilidade do Docker não é requisito universal: CI efêmero ou serviços locais isolados são alternativas válidas se provarem a mesma fronteira.

**Conclusão.** Todas tasks fechadas não bastam se a revisão integrada rejeitar o candidato. AAA-28 exige QUALIDADE inteira e notas sustentadas por evidência; sem isso, registrar FAIL/NOT_VERIFIED, achados e próxima hipótese. Aprovado tecnicamente ainda não significa implantado. O fechamento deste plano é separado do fechamento do programa.

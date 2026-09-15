# Plano executivo — elevar o CVG Connect Desk ao padrão Triplo AAA

## Propósito e resultado esperado

Concluir e provar o atendimento operacional veterinário de ponta a ponta, elevando os 48 itens auditados e as 11 dimensões UX à meta individual≥95. O operador deve receber e responder mensagens, consultar contexto, transferir, criar e acompanhar trabalho, administrar acessos e investigar falhas sem perda de informação, exposição indevida ou estado enganoso.

Este é o ExecPlan vivo do programa. **Produto atual: NOT_READY; programa: EM EXECUÇÃO.** A auditoria R3 registrou 0 tarefas DONE, 19 REWORK e 44 PLANNED; SA-001 e SA-002 foram encerradas com prova corrente e I1 independente, resultando agora em 2 DONE, 17 REWORK e 44 PLANNED. Implementações anteriores foram preservadas, mas as promoções restantes continuam sujeitas a prova atual. O resultado técnico final só será declarado depois da implementação, verificação e crítica previstas.

## Contexto e orientação

Repositório: `/home/ricardo/cvg-connect-desk`. Base: auditoria de 14/09/2026, HEAD 754f9bad mais worktree. O HEAD isolado não identifica o candidato. A auditoria registrou 1.209 testes passados,21 skips, lint/typecheck 33/33 e build 6/6 sem cache. Esses números são históricos de baseline, não prova de trabalho futuro.

Arquitetura preservada: `desk-web` React/Vite → `desk-api` Fastify → PostgreSQL/Drizzle/outbox → `message-worker` e `realtime-service`; Gateway/Evolution e Secretary mantêm suas responsabilidades externas. Sessões opacas, autorização por recurso, DLQ persistente e pipeline privado já existem e devem ser preservados.

Documentos de operação do programa: [backlog canônico](BACKLOG.json), [requisitos](REQUISITOS.json), [contratos](CONTRATOS.md), [qualidade](CRITERIOS.md), [decisões](DECISOES.md), [roadmap](ROADMAP.md) e [guia do agente](AGENTE.md).

## Escopo e restrições

- Abranger todos os itens, não apenas as notas baixas: nas áreas maduras, fechar provas/limites e corrigir lacunas concretas; não introduzir refatoração ornamental.
- Entregar 48 itens + 11 dimensões UX rastreáveis,63 tarefas,12 gates e fechamento de A01–A10.
- Preservar marca, rotas, fluxos, contratos externos e trabalho alheio. Não reescrever Gateway, Secretary, Evolution, stack ou banco por preferência.
- Não adicionar CRM/HIS completo, financeiro, campanhas, omnichannel ou aplicativo móvel nativo.
- Inspecionar AGENTS.md vigente antes de implementar. Nenhum arquivo dessa natureza foi localizado no recorte do projeto durante preparação; instruções posteriores podem alterar o modo de execução.
- Perfil: brownfield, planejamento de programa material com fronteiras de dados/segurança/UX/operação; execução requer verificação proporcional ao risco, não aprovação burocrática de cada alteração reversível.
- A autorização vigente governa ações. Código local e testes podem avançar quando o usuário iniciar a execução; decisões de política e efeitos externos têm os limites de [DECISOES](DECISOES.md).

## Arquitetura e interfaces alvo

1. Um caminho de comando por ação: controllers validam e chamam casos de uso; nenhuma rota antiga contorna transação, autorização ou auditoria.
2. Estado durável antes de efeito externo; idempotência, reconciliação e lease evitam perda/duplicação após crash.
3. Contratos de consulta/contexto e eventos permitem UI consistente, com seleção e cache reconciliados por versão.
4. Componentes e módulos frontend separam apresentação, carga, mutação e assinatura; design mantém identidade e densidade operacional.
5. Operação usa imagens identificadas, configuração verificável, telemetria útil, backup restaurável e gates que rejeitam evidência incompleta.

[C01–C10](CONTRATOS.md) definem invariantes compartilhados. SA-002 concretiza schemas, exemplos e consumidores antes de trabalho paralelo nas fronteiras.

## Plano de trabalho

### 1. Reduzir risco antes de ampliar a intervenção

SA-001/002/003 estabelecem candidato, contratos e isolamento. SA-004–010 fecham DTO administrativo, reabertura/movimento Kanban, atomicidade admin/contatos, contexto entre páginas, configuração realtime e verificador DR. Cada correção inclui reprodução anterior e teste que a distinguiria da versão defeituosa.

### 2. Completar o domínio e validar suas falhas

SA-011–032 abrangem API, sessão, RBAC, mensagens, tarefas, notas, alertas, transferências, memberships, tutores/pacientes, KPIs, audit, banco, eventos, worker, realtime, Gateway, Secretary, IA, privacidade e mídia. Provas de concorrência, SIGKILL, migração e serviços reais acompanham os contratos, sem supor que todos os códigos existentes precisem ser refeitos.

SA-020 prepara D03; SA-021 implementa o contrato decidido. SA-002 não fica artificialmente aberta até todas as decisões humanas: entrega o pacote revisável e registra os limites das tarefas dependentes.

### 3. Completar jornadas, não apenas telas

SA-033–049 e SA-063 completam componentes, fontes, shell/login, Inbox, timeline, tarefas, notas, alertas, Kanban, cadastros, admin, audit/perfil, dashboard, sincronização e a matriz visual. A correção contextual SA-008 é uma fatia fullstack antecipada e suas consultas devem existir antes do aceite UI. Serviços/configuração SA-052/053 avançam em paralelo conforme dependências reais.

A tela pontuada visualmente não está concluída se o endpoint falhar. O endpoint testado não conclui o item UI se o operador não alcançar o resultado. O aceite final cruza ambas as fronteiras.

### 4. Qualificar exatamente o candidato entregável

SA-050–058 fecham testes/coverage, identidade de imagens, boot, tracing, alertas, DR, carga, documentação e E2E real. SA-059 inspeciona o conjunto de artefatos e repontua todos os itens com críticos separados. Uma alteração após a prova invalida as verificações afetadas. SA-060 monta o pacote final antes de pedir qualquer autorização de implantação ainda ausente.

### 5. Implantar e observar quando autorizado

SA-061 promove o candidato identificado e tem limiares de abort/rollback. SA-062 observa estabilização e janela SLO de campo. Qualificação técnica, promoção e estabilidade são resultados diferentes; nenhum status presume o seguinte.

## Marcos e demonstrações

A descrição completa está no [roadmap](ROADMAP.md). Demonstrações de saída:

- M0: ambiente isolado e manifesto rejeitam alvo errado/drift.
- M1: testes públicos negativos deixam de reproduzirA01–A07; Kanban reabre corretamente e contexto de conversa atravessa telas.
- M2: ação concorrente/crash/upgrade preserva estado e acesso; integrações têm resultado explícito.
- M3:16telas completam tarefas com APIreal, teclado e mobile; dois operadores convergem.
- M4: mesmo candidato satisfaz os orçamentos deCI, imagens, carga, DR e E2E.
- M5: crítica independente aprova todos os 48 itens + 11 dimensões UX e pacote revisável.
- M6/M7: versão autorizada realmente implantada, operada e observada.

## Passos concretos iniciais

Da raiz do repositório:

1. **[SA-001-R3-A1]** Ler relatório, manifesto histórico, AGENTS.md vigente e `git status --short`; comparar fontes/configurações com a auditoria e registrar candidato completo sem apagar diferenças. A execução corrente separa `product_sha256` de `ledger_sha256` e cobre controles known-good/known-bad.
2. Executar `python3 docs/programa-triplo-aaa-2026-09-14/programa.py validate`; corrigir inconsistência do plano antes de delegar.
3. Abrir `tasks/SA-001.md`, cumprir seus aceites e registrar evidência. Só então atualizar estado e usar `programa.py next` para selecionar dependências elegíveis.
4. Concretizar SA-002 e SA-003, reservar áreas de escrita e iniciar a primeira correção pública com prova de falha anterior.

Os runners da auditoria encerraram os próprios recursos. Um container preexistente sem ownership demonstrável permaneceu intocado e está registrado em R3-F11. Ao iniciar execução prolongada, o lead pode estabelecer controle persistente conforme engineering-framework: ExecPlan executável sob `.agent/plans/`, backlog/evidências com fonte canônica única e ponte documental atualizada. Evitar duas cópias editáveis do plano. Enquanto isso, este documento é a referência narrativa e BACKLOG.json é a referência de estado.

## Validação e aceitação

[CRITERIOS.md](CRITERIOS.md) congela o padrão; cada cartão contém ACs e procedimentos. A[RASTREABILIDADE](RASTREABILIDADE.md) comprova que nenhum item depende somente da crítica final como executor.

Validação de programa: DAG acíclico, IDs/ACs íntegros,59 requisitos cobertos, achados/gates com produtores, decisões claras, links e derivados atualizados. Validação de produto: execução real de aceites e G01–G12, comcrítica separada e metaindividual≥95. O primeiro resultado não substitui o segundo.

## Responsabilidades e controle

Lead mantém contratos, estado, prioridade, reserva de arquivos e integração. Builders implementam e entregam evidência, sem autoaprovação. Críticos examinam artefato atual em contexto separado; não recebem defesa do construtor nem notas desejadas. Usuário/donos decidem somente políticas e ações externas dependentes da sua autoridade.

WIP padrão: lead+2 builders+1crítico; até 4 ativos, sem descendentes automáticos. Banco, portas, filas, lockfile, schema, Compose e componentes comuns também têm dono. ConsultarAGENTE.md antes de delegar.

## Riscos e decisões

| Risco | Mitigação | Critério de parada/localização |
|---|---|---|
| Repetir defeito histórico já corrigido | Revalidar SA-001 e prova antes/depois | Alterar tarefa com evidência; preservar objetivo, não refazer código sem motivo |
| Escritas parciais ou regressão de dados | Caso de uso único, transação, concorrência, backup e ensaio | Falha G03/G05 reabre tarefa e impede promoção |
| Mocks vendidos como integração | Nomear ambiente e usar serviços reais nos gates | Prova externa ausente é BLOCKED daquele aceite |
| Decisão ampla paralisar todo programa | Registrar subações dependentes e continuar independentes | D01–D06, sem transformar proposta em autorização |
| Escala estimada sem medição | Pontos relativos, capacidade real e3 rodadas de carga | Orçamento falho mantém gate fechado |
| Polimento esconder defeitos críticos | Priorizar gravidade/risco, não facilidade | QualquerCritical/High precede revisão cosmética |
| Drift entre evidência e artefato | Hashes/run/attempt e revalidação após alteração | STALE não aceita |
| Limite de agentes/contexto | Persistir ação/prova/estado e usar crítico novo quando possível | Declarar independência reduzida; não certificar AAA sem crítica exigida |

## Recuperação, idempotência e rollback

Ao retomar: ler autorização, instruções, plano, backlog, tarefa, última prova e fonte real. Confirmar handles vivos antes de reiniciar; lock/log não prova processo ativo. Reconciliar efeitos externos porID antes de repetir. Estados IMPLEMENTED/VERIFIED antigos perdem validade se a fonte mudou.

Restaurar apenas diff próprio de código quando apropriado; nunca `git reset --hard`, limpeza global deworktree ou teardown de banco compartilhado. Migrações de dados usam forward/rollback previamente ensaiado. Não repetir envio, deploy, eliminação ou migração apenas porque o log está incompleto.

Após trabalho material: artefato+tarefa → BACKLOG.json → evidência/log append-only → ponte de estado/ExecPlan. Regenerar cartões/roadmap derivado e validar. Guardar uma única próxima ação executável com ID estável por tarefa.

## Progresso

- 14/09/2026: programa documental elaborado a partir da auditoria; 63 tarefas PLANNED,59 requisitos rastreados.
- 14/09/2026: checkpoint de execução reportou dez tarefas DONE e duas IMPLEMENTED.
- 14/09/2026: auditoria R2 repetiu regressão, realtime, DR, lint, typecheck e build; reabriu SA-007/008/017/022. Estado canônico: 8 DONE, 4 REWORK, 51 PLANNED.
- 15/09/2026: execução R2.2 chegou a 17 DONE, 2 REWORK e 44 PLANNED, com typecheck e regressão verdes no escopo informado.
- 15/09/2026: auditoria R3 reproduziu o candidato e a regressão, encontrou ponto cego no selo, lint vermelho, budget JS excedido, harness omitido vermelho e ausência de evidência corrente/I1 final em 17/17 promoções. Estado corrigido: 0 DONE, 19 REWORK, 44 PLANNED.
- 15/09/2026: SA-001-R3-A2 implementou manifesto v2 parametrizável, separação de produto/livro-caixa, digest de `.env.production.example`, estado staged, modo e symlink; oito testes determinísticos passaram e a I1 independente aprovou o candidato corrente. SA-001 foi encerrada; a prova não certifica o produto inteiro.
- 15/09/2026: SA-002-R3-A1 revalidou C01–C10, G01–G12, D01–D06 e QB-1; adicionou matrizes explícitas de sucesso/erro/consumidor e um validador documental, com 10/10 testes estruturais/identitários. Após a reconciliação do manifesto, hashes e ponte documental, a I1 final aprovou SA-002; decisões continuam OPEN.
- Próxima ação executora: SA-003. Depois, requalificar SA-004 e SA-005–010; fechar os aceites materiais de SA-014/020/015/019/012 antes de ampliar o domínio.

## Descobertas

A auditoria já demonstrou testes significativos eboot realtime nativo. O objetivo é preservar essa base e corrigir fronteiras restantes. O verificador DR e o hash administrativo são exemplos de riscos que uma média geral ou suíteverde não elimina. A relaçãoN:N e o escopo gerencial requerem decisão explícita.

## Registro de decisões de planejamento

- Preservar stack e contratos maduros, em vez de impor reescrita sem evidência.
- Metaindividual95 e gates cumulativos; não chamar o plano entregue de produto certificado.
-63 tarefas com 8 marcos e 411 pontos; datas dependem da capacidade observada e das decisões externas.
- Originais históricos preservados; programa atual tem IDsSA para evitar confusão com AAA/PROD anteriores.

## Resultados e retrospectiva

Resultado até a auditoria R3: progresso técnico parcial, 17 implementações preservadas e nenhuma promoção terminal sustentável pela barra atual. [EXECUCAO.md](EXECUCAO.md) registra o checkpoint; a [rodada R3](rodadas/R3/README.md) orienta a retomada. A retrospectiva final continua reservada à conclusão verificada.

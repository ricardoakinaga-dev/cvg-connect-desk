# Auditoria R3 — checkpoint Triplo AAA

**Data:** 15/09/2026  
**Escopo:** estado canônico, candidato, evidências das 17 tarefas promovidas, regressão integrada e prontidão dos gates.  
**Veredito:** **FAIL / NOT_READY**.

## Conclusão executiva

O trabalho de produto é substancial e a regressão principal continua saudável no runner isolado, mas o checkpoint não sustenta as 17 promoções para `DONE`. A crítica I1 encontrou **0/17 tarefas com prova completa, atual, ligada ao candidato final e com revisão independente posterior às últimas correções**. Há ainda falhas diretas de aceite em SA-014, SA-015, SA-019 e SA-020.

Por isso, as 17 tarefas anteriormente `DONE` retornam a `REWORK`, preservando código e evidências como histórico. O estado reconciliado é **0 DONE, 19 REWORK e 44 PLANNED**, com 411 pontos formalmente não concluídos: 93 pontos de requalificação, 8 pontos de SA-017 implementados durante a auditoria e ainda pendentes de dependências/I1, 5 pontos de rework funcional em SA-022 e 305 pontos planejados.

O identificador `754f9badac46278e77d21de91c58eedb15e80581+worktree#c486a63f161da313` foi reproduzido na entrada da auditoria, antes de persistir os artefatos R3, e permaneceu estável durante os checks. Ele não aprova G01: é um hash de worktree mutável, exclui apenas o livro-caixa do programa, inclui outras auditorias como produto e não incorpora o conteúdo de arquivos classificados como segredo. Um controle negativo alterou `.env.production.example` sem alterar o `tree_sha256`. Ao persistir esta auditoria fora do diretório excluído, o digest mudou sem alteração do software, confirmando também acoplamento indevido entre produto e controle.

## Barra congelada

- Cada `DONE` exige todos os aceites obrigatórios com evidência executada e corrente no candidato exato.
- Mudança posterior ao teste ou à crítica torna a prova afetada `STALE`.
- A revisão final da tarefa deve ser I1 ou superior, sem autoria, posterior às correções e capaz de reproduzir o artefato.
- `programa.py validate` comprova estrutura; não comprova comportamento, independência nem autenticidade semântica.
- Falha de um gate obrigatório não pode ser compensada por média, contagem de testes ou progresso implementado.

Fontes: `AGENTE.md`, `CRITERIOS.md`, `CONTRATOS.md`, `BACKLOG.json`, `REQUISITOS.json` e os artefatos citados por cada tarefa.

## Achados

### R3-F01 — CRITICAL — promoções terminais sem prova corrente

- 17 tarefas estavam `DONE`, cobrindo 54 aceites obrigatórios.
- No snapshot de entrada, os 101 arquivos referenciados diretamente pelo backlog existiam e seus hashes conferiam; havia 88 registros JSONL. Execuções concorrentes posteriores adicionaram três referências e 17 registros ligados ao selo `#128b1a64...`. O [inventário reproduzível](EVIDENCE-INVENTORY.json) registra agora 104 referências íntegras e 105 registros. Isso prova integridade estrutural dos arquivos, não suficiência semântica.
- Somente dois registros usam o candidato de entrada completo `#c486a63f...`, um em SA-015 e um em SA-019; nenhum cobre todos os aceites da tarefa. As 17 entradas posteriores não revertem a adjudicação: o selo continua reprovado em G01 e não existe I1 final independente em artefato próprio.
- As revisões R2 registram inspeção estática, resultados `PARTIAL` ou findings e, em seguida, correções do lead sem nova crítica I1 comprovada.

**Ação:** reabrir SA-001–SA-015, SA-019 e SA-020. Requalificar em lotes pequenos, sempre no mesmo candidato, com cobertura por aceite e crítica nova.

### R3-F02 — CRITICAL — selo não detecta mudança em configuração sensível

`candidate_manifest.py` grava `sha256: null` para `.env.production.example` e usa string vazia no cálculo do selo. Em uma cópia Git temporária, trocar `SECRET=value-one` por `SECRET=value-two`, mantendo o mesmo tamanho, preservou exatamente o `tree_sha256`.

**Impacto:** uma alteração material de configuração pode passar sem invalidar o candidato. G01 falha.

**Ação:** incluir digest local de todo arquivo versionado no selo, mesmo quando seu conteúdo não deva ser publicado. Evidência pode ocultar o conteúdo, nunca a impressão criptográfica. Validar o gerador com controles conhecidos bom/ruim.

### R3-F03 — CRITICAL — SA-020 aceita perda como sucesso

SA-020-AC2 exige rollback/rollforward sem perda. O ensaio marca `rollback_perde_vinculo_n_n_por_desenho` como PASS, e D03 confirma perda dos vínculos N:N depois do cutover. A autoridade nominal de AC3 permanece “a registrar”.

**Ação:** projetar rollback realmente lossless ou mudar o requisito mediante decisão humana formal; registrar autoridade e repetir ensaio/current I1. Enquanto isso, SA-020 permanece `REWORK` e D03 permanece OPEN.

### R3-F04 — CRITICAL — SA-014 não executou o crash requerido

SA-014-AC3 exige falha no meio do processamento, reinício e morte de processo. A evidência declara que SIGKILL e suítes `production` citadas não foram reexecutadas; `test:ci` as exclui.

**Ação:** executar o ensaio de crash/SIGKILL no candidato corrigido, demonstrar replay/convergência e obter crítica I1 posterior.

### R3-F05 — HIGH — aceites materiais ausentes em SA-012, SA-015 e SA-019

- SA-012: timestamps divergentes e AC3 de erro de rede/bootstrap citado sem execução da prova correspondente.
- SA-015: a suíte 12/12 não contém fault injection na última escrita exigida por AC2.
- SA-019: a suíte 23/23 não cobre política de exclusão em uso, busca/paginação, saída canônica e invalidação/eventos exigidos por AC2/AC3.

**Ação:** completar os cenários faltantes, executar em runner isolado, vincular ao candidato e revisar novamente.

### R3-F06 — HIGH — regressão de lint

O [log de lint](evidencias/lint.log) termina com exit 1: 32/33 pacotes passam e `@cvg/realtime-service` registra 29 warnings para limite local 26. Foram somados 110 warnings nos 16 resumos ESLint exibidos. A barra final exige zero warning material.

**Ação:** SA-063 deve eliminar a regressão sem aumentar allowances nem desabilitar regras.

### R3-F07 — HIGH — suítes obrigatórias fora da macro/CI

`test:ci` exclui explicitamente suítes AAA e `production`; arquivos de prova em `scripts/production` também não possuem gate coletivo confiável. A macro passou no runner isolado desta auditoria, mas não pode aprovar G08/G12 sozinha.

**Ação:** SA-050 deve inventariar todas as suítes obrigatórias, executar controles conhecidos, remover omissões silenciosas e agregar resultados no CI.

### R3-F08 — HIGH — budget web continua reprovado

O [log de build](evidencias/build.log) passou 6/6, mas gerou JS inicial de **121,64 KiB gzip**, acima do limite de **120 KiB**. CSS ficou em 24,09 KiB gzip, dentro do limite de 25 KiB.

**Ação:** tratar em SA-056/G11 e reexecutar build/budget no candidato final.

### R3-F09 — HIGH — SA-003 conflita com teardown genérico existente

Ainda há comandos com `fuser -k` e portas fixas em scripts/workflows. Eles conflitam com SA-003-AC2, que proíbe matar recursos genéricos ou não pertencentes ao run.

**Ação:** substituir por ownership explícito, PID/label/run-id e cleanup limitado ao recurso criado pela execução.

### R3-F10 — MEDIUM — inventário de rotas e documentação sofreram drift

- SA-011 registrava 147 rotas/119 com schema; a auditoria estática atual encontrou 148/120, mantendo 5 mutações na allowlist.
- `EXECUCAO.md` incluía SA-016 entre as tarefas DONE e também como próxima elegível.
- README, VALIDACAO, ROADMAP, PLANO-EXECUTIVO e a rodada R2 ainda exibiam números anteriores.
- M1 aparecia como 5/7, embora o backlog anterior mostrasse 7/7.

**Ação:** sincronizar toda a documentação com o backlog canônico e exigir validação de resumos derivados.

### R3-F11 — MEDIUM — recurso ativo sem ownership demonstrável

Os runners criados por esta auditoria encerraram PostgreSQL e Redis próprios. Entretanto, o host já continha `cvg-phase4-postgres-20260915` ativo e sem labels de ownership. Não foi interrompido.

**Ação:** SA-003/SA-052 devem registrar owner, finalidade, TTL e regra de cleanup para todo recurso de programa. Recurso preexistente ou de outro projeto deve permanecer intocado.

### R3-F12 — HIGH — identidade mistura produto e auditoria

O gerador exclui `docs/programa-triplo-aaa-2026-09-14/`, mas inclui `docs/auditorias/`. A simples persistência deste relatório alterou o digest do candidato, embora nenhum arquivo de software fosse modificado nessa etapa.

**Ação:** SA-001 deve definir escopos explícitos e gerar identidades separadas para produto e livro-caixa, sem ciclos autorreferentes.

### R3-F13 — MEDIUM — harness de imagem obsoleto

O harness `prod-36` terminou 4/5 porque ainda exige `localhost` enquanto o Dockerfile usa corretamente `127.0.0.1`. O resultado é `FAIL_HARNESS`: ele invalida a prova disponível, mas não demonstra defeito comportamental do produto.

**Ação:** SA-009/SA-052 devem atualizar o contrato do harness e executar imagem/boot/readiness válidos antes de julgar G09.

## Verificações atuais

| Verificação | Resultado |
|---|---|
| `programa.py validate` antes da correção documental | PASS estrutural: 63 tarefas, 59 requisitos, 17/2/44 |
| candidato de entrada reproduzido | mesmo `c486a63f...` antes da persistência R3; G01 FAIL pelo controle negativo e pelo acoplamento de escopo |
| `pnpm typecheck` | PASS, 33/33 |
| `pnpm test:ci` no runner `audit-r3-regression` | PASS, exit 0; cleanup concluído; exclusões permanecem |
| SA-015 + SA-019 no runner `audit-r3-sa015-sa019` | PASS, 35/35; não cobre os aceites ausentes |
| `pnpm lint` | FAIL, 32/33; realtime 29 > 26; 110 warnings somados |
| `pnpm build` | PASS, 6/6; JS budget FAIL; CSS budget PASS |
| `node --test scripts/production/prod-36.test.mjs` | FAIL_HARNESS, 4/5; harness espera host antigo e não julga o produto |
| UX 16 superfícies, leitor de tela e dispositivo real | NOT_RUN |
| coverage por camada, carga, segurança completa, DR durável, E2E final | NOT_RUN |

Os detalhes estruturados estão em [ACHADOS.json](ACHADOS.json), [VERIFICACOES.json](VERIFICACOES.json), [ARTIFACTS.json](ARTIFACTS.json), [EVIDENCE-INVENTORY.json](EVIDENCE-INVENTORY.json) e no [manifesto da auditoria](MANIFESTO.json).

## Estado dos gates

| Gate | Estado R3 |
|---|---|
| G01 | FAIL — selo possui ponto cego e não é objeto Git imutável |
| G02–G04, G06 e G07 | NOT_RUN coletivamente no candidato final |
| G05 | FAIL — ensaio SA-020 aceita perda N:N no rollback |
| G08 | FAIL — lint falha e suíte coletiva omite provas obrigatórias |
| G09 | NOT_RUN / INVALID — harness `prod-36` obsoleto não julga o produto |
| G10 | NOT_RUN |
| G11 | FAIL — budget JS excedido e coverage/capacidade/DR incompletos |
| G12 | NOT_RUN — decisões D01–D06 abertas; SA-020 sem autoridade nominal |

## Limitações e independência

- A crítica de evidências foi I1, `fork_turns: none`, somente leitura e retornou `REJECT`.
- A crítica de runtime foi I1, mas seu veredito formal ficou `INVALID` porque caches e evidências mudaram durante a leitura. Os achados usados neste relatório foram reproduzidos pelo lead ou mantidos como limitações.
- Não foram executados E2E completo, matriz visual, leitores de tela, dispositivo real, carga, scanners completos, provedores reais ou DR fora do host.
- Nenhum recurso preexistente foi parado e nenhuma ação externa foi realizada.

## Veredito

O checkpoint tem progresso técnico real, incluindo typecheck verde, regressão isolada verde e correções funcionais relevantes. A execução browser+API de SA-008 foi reportada no checkpoint de entrada, mas não foi reexecutada nesta auditoria. A promoção terminal não é sustentável com a evidência atual. O produto permanece `NOT_READY`; SA-059 não pode iniciar; “Triplo AAA — candidato qualificado” continua proibido.

A retomada começa pela [rodada R3](../../programa-triplo-aaa-2026-09-14/rodadas/R3/README.md).

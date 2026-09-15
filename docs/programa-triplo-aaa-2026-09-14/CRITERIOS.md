# Barra de qualidade — Triplo AAA

**Versão congelada para planejamento:** QB-1, 14/09/2026. Fonte de metas herdadas: critérios R3. **Revalidação SA-002-R3-A1:** 15/09/2026 no candidato `754f9badac46278e77d21de91c58eedb15e80581+worktree#product-4ee19f2ec5ca8bff`; thresholds e denominadores permanecem inalterados. Todos os gates abaixo são obrigatórios para qualificar o candidato, salvo medição de operação de campo explicitamente posterior ao deploy.

## Três eixos e condição numérica

| Eixo | Escopo | Condição de qualidade |
|---|---|---|
| Engenharia e dados | 23 itens backend/dados/integrações + qualidade de código | Cada item ≥95/100, invariantes públicos e integridade provados |
| Experiência | 16 superfícies + 11 dimensões UX | Cada superfície e dimensão ≥95/100, tarefa principal e acessibilidade verificadas |
| Operação e governança | 7 itens operacionais + documentação | Cada item ≥95/100 no escopo de readiness; evidências reais do candidato |

As 48 notas mantêm os blocos/pesos da auditoria (40% backend, 25% interface, 25% operação, 10% código/documentação). UX não entra duas vezes na média. Nota geral ≥95 é necessária, mas **cada item também deve atingir a meta**. Não arredondar 94,5 para satisfazer o limiar individual. O crítico atribui a nota com justificativa, confiança e fonte; não copiar a meta para a coluna de resultado.

**Bloqueiam a aceitação:** qualquer Critical/High aberto, tarefa primária quebrada, falha de acesso/integridade, evidência requerida ausente/antiga/adulterada, skip requerido ou falta de independência da revisão. Nota alta não compensa nenhum deles. Todos os aceites materiais precisam de confiança ALTA com execução no limite real pertinente.

## Gates obrigatórios

| ID | Resultado necessário | Como reprovar / prova obrigatória |
|---|---|---|
| G01 | Candidato, evidências e CI íntegros | Manifestos separados de produto e controle; SHA de todos os arquivos versionados, inclusive configuração sensível; SHA/diff/lock/build/digests/run/attempt; adulteração, outro candidato, número inválido e tempo futuro rejeitados |
| G02 | Sessão e autorização por ação/recurso | Negativos HTTP/WS de papéis, setores, revogação, acesso cruzado, dados privados e campos adulterados |
| G03 | Atomicidade, idempotência e recuperação | Falha na última escrita reverte ação; concorrência, retry e SIGKILL antes/depois de efeito/ACK; zero efeito duplicado/perda inexplicada |
| G04 | Mídia privada e scan real | Storage/scanner reais; leitura só CLEAN autorizada; tamanho/mime/SSRF/URL expirada/scan indisponível negados e recuperação comprovada |
| G05 | Dados, migração, IA e privacidade | Fresh/upgrade, vínculos, políticas por cópia, ferramentas deny-default/aprovação e checkpoint/restore demonstrados |
| G06 | Operação completa | Jornadas de atendimento e gestão, contexto e concorrência reais; nenhuma ação inerte nem sucesso fictício |
| G07 | UX, responsividade e acessibilidade | Matriz completa, revisão visual, teclado, leitor de tela, zoom real, mobile real e inconclusivos resolvidos |
| G08 | Qualidade e coverage completa | Lint/type/build reais, suites por escopo sem skip requerido e denominadores congelados |
| G09 | Imagens, configuração e entrega | API/web/worker/realtime/db-init por identidade; scan/boot/teste do mesmo artefato; readiness e recuperação reais |
| G10 | Tracing, métricas, painéis e alertas | Jornada observada no collector, scrape privado, dashboards provisionados e alertas firing/resolved com falha/recuperação |
| G11 | Capacidade e recuperação | Perfil de carga, queries e vitals medidos; backup durável e restore verificados dentro dos orçamentos |
| G12 | E2E, documentação e revisão | Fluxo browser/API/PG/worker/WS/provedores representativos, runbook reproduzível e crítica sem autoria do produto |

Produtores e tarefas estão na [rastreabilidade](RASTREABILIDADE.md); a auditoria SA-059 julga todos os gates. Revisão não substitui tarefa de implementação.

## Gates — versão, dono, entradas/saídas e exemplos (SA-002/AC1)

Contrato de gate **G-1**, dono: lead do programa para o registro; produtores e verificação em [RASTREABILIDADE](RASTREABILIDADE.md). Cada gate recebe como entrada o candidato identificado + manifesto + evidências das tarefas produtoras, e produz um veredito `PASS/FAIL` com revisor independente (SA-059). O manifesto do produto não inclui documentos mutáveis de auditoria; o livro-caixa tem manifesto próprio. Arquivos sensíveis podem ter conteúdo oculto na evidência, mas sempre participam do selo por digest criptográfico. Exemplo de sucesso: os artefatos por tarefa com hashes atuais e o conjunto coerente no mesmo candidato. Exemplo de erro: evidência `STALE`, hash divergente, skip requerido, Critical/High aberto ou execução em ambiente diferente do declarado — todos reprovam independentemente da média.

| Gate | Dono da prova | Entradas obrigatórias | Saída verificável | Exemplo que REPROVA |
|---|---|---|---|---|
| G01 | LEAD/OPS | manifesto, git status, hashes, lock/build/digests, run/attempt | candidato único e íntegro | número inválido, tempo futuro, hash divergente |
| G02 | BACKEND | sessões, matriz ação×recurso, testes negativos HTTP/WS | negações corretas e revogação ≤5s | dado privado servido a papel sem vínculo |
| G03 | BACKEND | testes de transação, concorrência, retry e SIGKILL | zero efeito duplicado/perda | escrita parcial persistida ou 500 após sucesso |
| G04 | BACKEND/OPS | MinIO/ClamAV reais, negativos de tamanho/mime/SSRF | só CLEAN autorizado; falhas negadas | PENDING/INFECTED servido como sucesso |
| G05 | DADOS | fresh/upgrade, vínculos, D02/D05, checkpoint/restore | dados e políticas coerentes | upgrade perde registro ou política por cópia ausente |
| G06 | PRODUTO | jornadas de atendimento/gestão com API real | nenhuma ação inerte ou sucesso fictício | “salvo” sem efeito durável |
| G07 | DESIGN | matriz 16×5 + estados, teclado, leitor, zoom, mobile | jornada alcançável e acessível | estado/dado longo inacessível em 375px |
| G08 | LEAD/OPS | lint/type/build/coverage por escopo sem skip | denominadores congelados QB-1 | exclusão nova após medir |
| G09 | OPS | digest por imagem, boot/readiness, teste da mesma imagem | artefato implantável | imagem diferente da testada |
| G10 | OPS | collector, scrape privado, dashboards, alertas firing/resolved | observabilidade operável | painel/regra ausente |
| G11 | OPS | carga 3 rodadas, EXPLAIN, vitals, backup/restore externo | orçamentos QB-1 atendidos | verificador aceita restore parcial |
| G12 | LEAD/CRÍTICO | E2E browser/API/PG/worker/WS + runbook + crítica sem autoria | fluxo integrado e revisão I1+ | crítica do próprio autor |

## Matriz de consumidores e exemplos dos gates (SA-002/AC1)

Cada gate também declara quem consome seu resultado e um par mínimo de sucesso/erro. O par orienta a prova; não transforma preparação ou documentação em `PASS` do produto.

| Gate | Consumidor(es) | Exemplo de sucesso | Exemplo de erro |
|---|---|---|---|
| G01 | SA-001/002, SA-050, SA-059 | Candidato, manifestos, lock/build/run e hashes formam um conjunto atual. | Outro candidato, hash divergente, tempo futuro ou evidência stale. |
| G02 | SA-004–019, SA-059 | Papel/setor autorizado recebe somente o recurso permitido e revogação propaga. | Papel sem vínculo recebe dado privado ou mutação proibida. |
| G03 | SA-005–032, SA-059 | Retry/concorrência/SIGKILL não duplica nem perde efeito. | Última escrita persiste parcialmente ou ACK duplica efeito. |
| G04 | SA-032, SA-058, SA-059 | Asset CLEAN autorizado é servido e falhas de scan são recuperáveis/negadas. | PENDING/INFECTED/SCAN_FAILED ou SSRF vira download bem-sucedido. |
| G05 | SA-020–031, SA-055, SA-059 | Fresh/upgrade, vínculos, política por cópia e restore verificam todas as entidades. | Upgrade/restore perde vínculo ou decisão OPEN é tratada como autorização. |
| G06 | SA-004–049, SA-059 | Jornada de atendimento/gestão tem efeito durável e resultado visível. | UI exibe “salvo” sem efeito no servidor ou ação fica inerte. |
| G07 | SA-033–049, SA-059 | Matriz 16×5, teclado, leitor, zoom e mobile alcançam a tarefa principal. | Estado/dado longo ou controle fica inacessível em viewport/zoom exigido. |
| G08 | SA-003, SA-049/050, SA-059 | Lint/type/build/coverage executam no escopo congelado, sem skip requerido. | Denominador é reduzido após falha ou warning material é escondido. |
| G09 | SA-003, SA-009, SA-050–055, SA-059 | Imagem com digest único passa scan, boot/readiness e teste. | Artefato testado não é o implantado ou readiness depende de alvo implícito. |
| G10 | SA-023/025–027, SA-052–054, SA-059 | Jornada produz trace/métrica/alerta firing e resolved sem PII. | Dashboard/regra/collector ausente ou alerta não recupera. |
| G11 | SA-010/022/031/046/054–056, SA-059 | Carga, queries, vitals e restore ficam dentro dos orçamentos QB-1. | Perfil reduzido, backup não durável ou restore verifica apenas uma tag. |
| G12 | SA-001/002/003, SA-047–059 | Fluxo browser/API/PG/worker/WS tem runbook e crítico sem autoria. | Revisão do próprio autor, fluxo incompleto ou evidência sem reprodução. |

## Orçamentos preservados

- **Carga:** 10 mil conversas, 100 mil mensagens, 100 sessões; 10 minutos de aquecimento + 30 de medição, em três rodadas. Registrar hardware, dataset, configuração, mix de operações, concorrência e início/fim.
- **Latência/erros:** P95 inbound <250ms; realtime <500ms; erros inesperados <0,1%. Zero perda/efeito duplicado nos cenários determinísticos. Definir início/fim de cada latência e separar limites do provedor.
- **Convergência funcional em degradação:** fallback de atualização ≤5s no cenário funcional acordado; não substitui o orçamento normal de realtime. Identificar visualmente dados desatualizados.
- **Web:** LCP ≤2,5s, INP ≤200ms, CLS ≤0,1; JS inicial gzip ≤120KiB, CSS ≤25KiB. Medir build servido de modo representativo; distinguir kB decimal de KiB. Laboratório não representa percentil de campo.
- **Coverage:** core≥90%, domínio≥80%, API≥70%, web≥60%, global≥75%. Preservar shared≥85/80/85/85 e confirmar a ordem das métricas existente em SA-002 antes de configurar. Congelar arquivos/métricas incluídos; nenhum denominador reduzido para passar. Excluir código apenas por motivo legítimo documentado antes da medição.
- **DR:** RPO≤24h, RTO≤2h com backup durável fora do processo/host de ensaio, download/restore real e comparação de todas as entidades e vínculos exigidos.
- **Disponibilidade de campo:** API99,9%, webhook99,95% por janela mensal. SA-059 comprova instrumentação/alertas/ensaio; SA-062 observa a primeira janela mensal completa. Não exigir histórico anterior ao primeiro deploy nem inventar uma janela concluída.
- **Código:** lint sem erros e sem os avisos materiais remanescentes; meta zero avisos no escopo congelado. Proibido remover regra/excluir arquivo crítico para limpar o resultado.

## Denominadores congelados (QB-1, fixados por SA-002)

Os valores abaixo ficam congelados para toda a execução. Nenhum denominador pode ser reduzido após falha; exclusões só com motivo legítimo registrado **antes** da medição. A cópia legível por máquina está em `evidencias/SA-002/frozen-denominators.json`; a revalidação atual usa o candidato `754f9badac46278e77d21de91c58eedb15e80581+worktree#product-4ee19f2ec5ca8bff` do manifesto de `evidencias/SA-002/`.

- **Coverage (provider v8; ordem das métricas preservada):** `shared` statements/branches/functions/lines = **85/80/85/85** (já configurado em `packages/shared/vitest.config.ts`); `core` ≥90; `domínio` ≥80; `API` ≥70; `web` ≥60; `global` ≥75. Escopos/globs e exclusões permanentes estão no JSON congelado; nenhuma exclusão adicional depois de medir.
- **Workload:** 10 mil conversas, 100 mil mensagens, 100 sessões; 10 min de aquecimento + 30 min de medição, 3 rodadas; registrar hardware, dataset, configuração, mix, concorrência e início/fim. Latências: inbound P95 <250ms, realtime P95 <500ms, fallback de convergência ≤5s; erros inesperados <0,1%; zero efeito duplicado/perdido.
- **Web vitals:** LCP ≤2,5s, INP ≤200ms, CLS ≤0,1; JS inicial gzip ≤120KiB, CSS ≤25KiB; medir build de produção servido; laboratório ≠ campo.
- **Matriz visual:** 16 rotas × 5 viewports (375×812, 390×844, 768×1024, 1024×768, 1440×900) = 80 combinações normais; estados loading/vazio/erro recuperável/dados longos/acesso negado no menor viewport e desktop; fronteiras 859/860/861 e 1259/1260/1261px; zoom real 200%; reflow 320 CSS px/400%; ergonomia 375×812 (primeira tarefa prioritária e primeiro alerta crítico acionável no primeiro viewport, fixture congelada); alvo 44×44; móvel real e leitor de tela real.
- **Método de nota:** média ponderada por bloco (40/25/25/10) para a nota geral, mas **cada** item e dimensão ≥95 sem arredondar 94,5; nota exige evidência atual, confiança ALTA e revisor independente; nenhum Critical/High aberto, jornada primária quebrada, falha de acesso/integridade, prova ausente/antiga ou skip requerido.
- **DR:** RPO ≤24h, RTO ≤2h. **Disponibilidade:** API 99,9% e webhook 99,95% em janela mensal (SA-062 observa a primeira janela completa). **Código:** lint sem erros; meta zero avisos materiais no escopo congelado.

## Matriz visual e de interação

Rotas: Login, Inbox, Dashboard, Tasks, Alerts, Notes, Kanban, Contacts, Tutors, Patients, Sectors, Labels, Contact groups, Admin, Audit e Settings.

**Todas as 16 rotas:** 375×812, 390×844, 768×1024, 1024×768, 1440×900. Estado normal com dados e navegação por capacidade nas 80 combinações. Todas as rotas também cobrem loading, empty, erro recuperável, dados longos e acesso negado quando aplicável no menor viewport e desktop; tablets recebem estados adicionais quando o comportamento difere. Qualquer estado não aplicável tem justificativa revisada antes de executar.

**Por risco:** Inbox com histórico extenso, contexto, mídia, envio incerto, teclado virtual e reconnect; tarefas/notas/alertas com validação/mutação/erro/conflito; cadastros com lista/detalhe/diálogos/associações; Kanban com arraste e alternativa de teclado; Dashboard parcial/extremos; Admin com permissões/DLQ/IA; Login com expiração/offline.

Incluir fronteiras 859/860/861 e 1259/1260/1261px, zoom **real** de 200%, reflow a 320CSSpx/400% conforme cenário, reduced motion e fallback de fonte. No mínimo um dispositivo móvel real com teclado virtual e um leitor de tela real. Axe automático é necessário e insuficiente; resolver seus inconclusivos manualmente. Aplicar WCAG2.2AA pertinente e alvo interno44×44 para controles principais; isto não é alegação de WCAG AAA.

Meta ergonômica nova do programa: com fixture de referência congelada, em 375×812 a primeira tarefa prioritária e o primeiro alerta crítico com ação ficam no primeiro viewport. Validar que resumos compactos não escondem filtros/informação necessária. Se a medição for inadequada, revisar o benchmark com evidência, nunca só porque o layout falhou.

## Evidência e estados

Cada execução registra: tarefa/AC/gate, candidato completo, comando ou procedimento, ferramenta/versão, start/end/observed_at, ambiente/dataset, run/attempt, resultado/exit, artefatos com SHA256, limites, autor e crítico. Logs com dados sintéticos ou sanitizados. Captura deve identificar build servido, viewport, estado, usuário/capacidade e API real ou simulada. A revisão terminal ocorre depois da última correção material; findings corrigidos exigem nova passagem do crítico independente no candidato resultante.

`NOT_RUN`, `BLOCKED`, `FAIL`, `STALE` e `INVALID` não são PASS. `IMPLEMENTED` não é DONE. Alteração posterior invalida provas afetadas; candidato final exige conjunto coerente. Falha inicial fica preservada; retry exige hipótese causal diferente ou transiência declarada, nunca busca de um verde aleatório.

**Estados de produto:** NOT_READY → READY_FOR_RELEASE (SA-059) → PACOTE_REVISÁVEL (SA-060) → IMPLANTADO (SA-061, se autorizado) → OPERAÇÃO_ESTABILIZADA (SA-062). O título “Triplo AAA — candidato qualificado” exige SA-059; “Triplo AAA em operação” exige também estabilização. A primeira janela mensal tem resultado próprio.

## Alterar a barra

Somente requisito novo do usuário ou medição comprovadamente inválida justifica revisão. Registrar versão anterior, motivo, prova, impacto, aprovador apropriado e tarefas afetadas. Não trocar N:N por1:N, dispensar serviços reais, renomear simulação como produção ou baixar95 porque a execução encontrou dificuldade.

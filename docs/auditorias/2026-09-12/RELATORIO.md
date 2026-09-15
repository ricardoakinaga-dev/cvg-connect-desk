**Auditoria técnica do CVG Connect Desk — 12/09/2026**

**Nota geral: 53/100** — média aritmética de 18 dimensões (53.06/100 antes do arredondamento). O programa tem uma base funcional relevante, mas apresenta falhas de isolamento, sessão e entrega de eventos que impedem recomendar sua liberação irrestrita para produção nesta revisão.

Auditoria `AUDIT-CVG-20260912`, revisão `754f9badac46278e77d21de91c58eedb15e80581`. Ambiente: workspace local, Node v24.20.0 e pnpm 10.33.0. Análise individual de código, configuração, documentação e execução de verificações locais; não houve revisão independente por segundo auditor. As pastas preexistentes `.gauntlet/` e `.gauntlet-v2-archive-20260912/` foram preservadas e não usadas como prova de aprovação atual.

**Escopo e critérios.** Foram examinados API, autenticação, autorização, mensagens, eventos, realtime, banco, interface, anexos, privacidade, métricas, dependências e implantação. O parâmetro de comparação é o comportamento declarado pelo README, `docs/AUTHORIZATION.md`, scripts do projeto e contratos de cada fluxo: sessão expirada deve ser rejeitada; recurso de outro setor exige autorização; evento de mensagem deve sobreviver a falhas; gates de qualidade precisam executar verificações reais. Uma boa média não compensa falhas nesses critérios.

As notas são julgamento técnico da implementação e da evidência disponível, não porcentagem de cobertura, probabilidade de falha ou certificação. Escala: 90–100 excelente e amplamente verificado; 75–89 bom; 60–74 intermediário; 40–59 frágil; 0–39 comprometido. Ausência de evidência restringe a confiança e impede notas máximas; não prova, sozinha, um defeito.

| Item analisado | Nota /100 | Justificativa | Referências |
|---|---:|---|---|
| Arquitetura e modularidade | **65** | Boa separação em 33 pacotes; ciclo Chat ↔ Gateway impede o grafo de tarefas. | A04 |
| Autenticação e sessões | **45** | Tokens aleatórios com hash e expiração; renovação aceita sessão expirada. | A01 |
| Autorização e isolamento por setor | **25** | Há RBAC central, mas histórico de mensagens e eventos globais contornam o isolamento. | A02, A03 |
| API, validação e proteção de webhooks | **75** | HMAC, antirreplay, CORS e limites existem; aplicação dos controles é desigual. | A02, A09 |
| Banco de dados e integridade | **60** | Schemas, índices, migrations e timeouts; gravação de mensagem e evento não é atômica. | A07 |
| Eventos, filas e idempotência | **45** | Outbox, ACK por consumidor e DLQ; reserva concorrente não está implementada. | A06, A07, A11 |
| Integrações Gateway e Secretary | **65** | Adapters, contratos e política de retries; dependência circular e integrações reais não revalidadas. | A04, A07 |
| Atualizações em tempo real | **35** | Autenticação e revalidação passam nos testes; transmissão global sem autorização por recurso. | A03, A05 |
| Frontend e fluxos operacionais | **70** | Compilação e 47 testes aprovados; envio não apresenta adequadamente erros e não usa chave idempotente. | A09, A11 |
| Acessibilidade técnica | **65** | Botões semânticos, aria-label e controle de foco presentes; avaliação limitada ao código e testes existentes. | L01 |
| Anexos e segurança de mídia | **45** | Validação e pipeline de scanner existem; limite da interface conflita com o limite HTTP. | A09 |
| Desempenho e escalabilidade | **50** | Consultas agrupadas reduzem N+1, mas carregam o histórico completo para obter a última mensagem. | A10, A06 |
| Observabilidade e disponibilidade | **60** | Métricas, tracing e healthchecks; readiness sinaliza falha com HTTP 200. | A08, A15 |
| Testes e evidência de qualidade | **65** | 149 testes existentes aprovados nesta auditoria; faltam verificações negativas essenciais e banco real atual. | A01–A03, L01 |
| Build, CI e implantação | **30** | Grafo circular, 220 erros de TypeScript na API, lint divergente e Docker sem lockfile congelado. | A04, A05, A12 |
| Dependências e cadeia de fornecimento | **40** | Scanners e ações fixadas por SHA; audit aponta 8 alertas altos no recorte de produção. | A13 |
| Privacidade e rastreabilidade | **50** | Exportação, anonimização parcial e trilha existem; cópias de dados e autoria precisam de revisão. | A14, A16 |
| Documentação e recuperação | **65** | Runbooks, ADRs e scripts de backup/restore; parte das afirmações diverge do código atual. | A06, A12, L01 |

**Verificações realizadas**

| Procedimento | Resultado observado | Evidência |
|---|---|---|
| `pnpm exec turbo run lint typecheck test build --force` | Falhou antes de executar as tarefas: dependência circular Chat/Gateway. Não representa execução da suíte completa. | [checks.txt](evidencias/checks.txt) |
| `pnpm --filter @cvg/desk-web build` | Aprovado, incluindo TypeScript e Vite. JS: 312,07 kB / gzip 89,59 kB; CSS: 98,34 kB / gzip 18,41 kB. | [web-build.txt](evidencias/web-build.txt) |
| `pnpm --filter @cvg/desk-web test` | 8 arquivos, 47 testes aprovados. | [web-test.txt](evidencias/web-test.txt) |
| Testes de shared, auth, messaging-contracts e tracing | 13 arquivos, 97 testes aprovados: 74 + 9 + 7 + 7. | [unit-no-db.txt](evidencias/unit-no-db.txt) |
| Realtime, suíte comportamental de autenticação | 5 testes existentes aprovados com servidor HTTP local de teste. | [realtime.txt](evidencias/realtime.txt) |
| Quatro reproduções criadas para a auditoria | Confirmaram aceite de sessão expirada, ausência de autorização do histórico, broadcast global e readiness 200. Os testes descrevem defeitos presentes; seu sucesso NÃO aprova o produto. | [repro.txt](evidencias/repro.txt), [readiness-repro.txt](evidencias/readiness-repro.txt), [realtime.txt](evidencias/realtime.txt) |
| `pnpm --filter @cvg/desk-web lint` | Falhou: 31 warnings, limite configurado 0; nenhum erro ESLint. | [web-lint.txt](evidencias/web-lint.txt) |
| Geração de tipos do banco + `pnpm --filter @cvg/desk-api exec tsc --noEmit` | Geração aprovada; API com 220 diagnósticos TypeScript, 188 em arquivos fora de testes. É a contagem de diagnósticos, não de causas independentes. | [db-types.txt](evidencias/db-types.txt), [api-typecheck-prepared.txt](evidencias/api-typecheck-prepared.txt) |
| `pnpm audit --json` | 53 alertas: 27 altos, 23 moderados, 3 baixos, nenhum crítico. | [dependencies.json](evidencias/dependencies.json) |
| `pnpm audit --prod --json` | 17 alertas: 8 altos, 8 moderados, 1 baixo, nenhum crítico. Recorte por dependências de produção do scanner. | [dependencies-prod.json](evidencias/dependencies-prod.json) |
| Acesso a Docker | Negado pelo socket local; não houve elevação nem alteração de permissões. | Observado em `docker ps`. |
| Suíte de privacidade com endereço de banco deliberadamente inacessível | Setup/teardown falharam com ECONNREFUSED; 4 casos não executados. Limitação de ambiente, não prova de defeito funcional. | [unit.txt](evidencias/unit.txt) |

Total: **149 testes existentes aprovados**, mais **4 reproduções de defeitos**. Não foi executado `pnpm test` integralmente. Não foi calculada cobertura de linhas. Os testes de diagnóstico foram retirados das pastas de execução automática e preservados como `.test.ts.txt` em `evidencias/`. A primeira tentativa do diagnóstico HTTP retornou 401 por um mock de autenticação que não interceptou o import; o harness foi corrigido e a saída inicial preservada em [repro-initial-harness.txt](evidencias/repro-initial-harness.txt).

**Achados prioritários**

Todos os achados abaixo permanecem ABERTOS, sem correção aplicada. P0 significa corrigir antes da liberação; P1, próxima prioridade de engenharia; P2, melhoria planejada. Severidade trata do impacto potencial; prioridade trata da ordem de execução. As responsabilidades citadas são sugestões, não atribuições já aceitas.

**A01 — Sessão expirada pode ser renovada. Severidade alta, P0.**

A rota `/auth/rotate` verifica existência e revogação, mas não validade temporal, inatividade ou usuário ativo. O repositório revoga o token antigo e cria uma sessão com novos prazos. A reprodução forneceu uma sessão com vencimento e prazo absoluto em 2000; o handler respondeu 200 e chamou a renovação. Isso permite prolongar acesso com token expirado enquanto a sessão ainda existe e o usuário continua ativo. O teste usa banco/repositório simulados, não PostgreSQL real.

Evidência: [auth.controller.ts](../../../packages/auth/src/presentation/http/auth.controller.ts), linhas 184–209; [auth.repository.ts](../../../packages/auth/src/infrastructure/repositories/auth.repository.ts), linhas 34–48 e 84–86. `/auth/me` também não aplica todos os prazos do middleware, afetando a revalidação realtime. Correção sugerida: validação única de sessão, renovação transacional e preservação do prazo absoluto. Responsável sugerido: backend. Fechamento: testes HTTP rejeitando expiração normal/absoluta, inatividade, revogação e usuário desativado; corrida de renovação não deve criar duas sessões válidas.

**A02 — Histórico de conversa não exige autorização do recurso. Severidade alta, P0.**

`GET /conversations/:conversationId/messages` registra apenas `authenticate` e consulta diretamente mensagens pelo UUID. O repositório não recebe usuário/setor. A reprodução inspecionou o middleware registrado, substituiu exclusivamente a autenticação por uma identidade sintética sem roles e recebeu 200 com conteúdo sintético. Não é um bypass de login; demonstra falta de autorização depois do login. A listagem de conversas contém filtros de setor, portanto os controles diferem entre listar e abrir uma conversa. O envio e a marcação de leitura também precisam de revisão de escopo: permissão global de chat não comprova acesso à conversa.

Evidência: [outbound.controller.ts](../../../modules/chat/src/presentation/http/outbound.controller.ts), linhas 110–161; [message.repository.ts](../../../modules/chat/src/infrastructure/repositories/message.repository.ts), método `findRecentByConversationId`; [send-outbound-message.use-case.ts](../../../modules/chat/src/application/use-cases/send-outbound-message.use-case.ts). Responsável sugerido: backend. Fechamento: usuário do setor A não lê, escreve nem marca mensagens do setor B; validar sem roles, com role sem membership e com admin.

**A03 — Realtime transmite conteúdo a todos os clientes autenticados. Severidade alta, P0.**

Clientes começam inscritos em `global`. `processEvent()` transmite a projeção nesse canal; `message.persisted` preserva o payload, incluindo conteúdo. A inscrição em canais também não verifica acesso ao recurso. O diagnóstico da classe real, com dois clientes sintéticos e transporte simulado, confirmou que ambos recebem uma mensagem de uma conversa identificada como pertencente ao setor A. Não foi um teste em produção nem uma autenticação real dos dois usuários.

Evidência: [realtime-service/index.ts](../../../apps/realtime-service/src/index.ts), linhas 136, 171, 527–560 e 864; [projections.ts](../../../packages/realtime/src/projections.ts), função `projectMessagePersisted`. Responsável sugerido: backend/realtime. Fechamento: autorização por destinatário e canal, sem conteúdo sensível no broadcast global; testes negativos por setor, troca de membership e revogação.

**A04 — Dependência circular impede gates do monorepo. Severidade alta, P1.**

`@cvg/chat` depende de `@cvg/gateway-adapter`, que depende de `@cvg/chat`. A execução real do Turbo falhou no grafo de lint, typecheck e build. A organização em pastas não garante independência entre módulos.

Evidência: [chat/package.json](../../../modules/chat/package.json), [gateway-adapter/package.json](../../../modules/gateway-adapter/package.json), [turbo.json](../../../turbo.json). Responsável sugerido: arquitetura/backend. Fechamento: extrair o contrato compartilhado ou inverter a dependência; comandos públicos de build, lint e typecheck devem executar sem ciclo.

**A05 — Imagem web padrão aponta realtime para localhost. Severidade alta, P1.**

O Dockerfile incorpora `VITE_REALTIME_URL=ws://localhost:8080`. O Compose de produção fornece apenas `VITE_API_URL` como build argument. Um navegador em outra máquina tentará conectar no localhost do próprio usuário. O nginx oferece `/ws/`, mas essa rota não é usada por esse default. Constatação por configuração; imagem Docker não reconstruída nesta auditoria.

Evidência: [desk-web/Dockerfile](../../../apps/desk-web/Dockerfile), linhas 7–8; [docker-compose.yml](../../../docker-compose.yml), serviço `desk-web`; [realtime.ts](../../../apps/desk-web/src/lib/realtime.ts), linha 64. Responsável sugerido: frontend/infra. Fechamento: URL derivada do host e protocolo ou argumento obrigatório; testar acesso remoto sob HTTPS/WSS.

**A06 — O claim do outbox não reserva eventos. Severidade alta, P1.**

`claimPendingEvents()` ignora as opções de lease e apenas chama `fetchPendingEvents()`. Duas instâncias do mesmo consumidor podem obter o mesmo evento. A API anuncia lease de 120 segundos, mas não existe reserva nesse método. O comentário promete implementação na migration 0014, que na realidade cria idempotência outbound. O worker também faz fetch direto. Duplicação de efeitos é um risco inferido do caminho de concorrência, não uma corrida executada nesta auditoria.

Evidência: [outbox-reader.ts](../../../packages/events/src/outbox-reader.ts), linhas 217–223; [worker/index.ts](../../../apps/message-worker/src/index.ts), linha 301; [0014_outbound_idempotency.sql](../../../packages/database/supabase/migrations/0014_outbound_idempotency.sql). Responsável sugerido: backend/eventos. Fechamento: reserva atômica por evento e consumidor, expiração recuperável, processamento idempotente e teste concorrente com PostgreSQL real.

**A07 — Mensagem e evento são persistidos separadamente. Severidade alta, P1.**

No inbound, a mensagem é gravada antes de atualizar a conversa e publicar o evento; o publisher faz outro insert, fora de uma transação compartilhada. Se houver falha nesse intervalo, o retry pode encontrar mensagem duplicada e retornar antes da publicação. A existência de tabela outbox, sozinha, não fecha essa janela de perda. Evidência estática; falha por crash não injetada em banco real.

Evidência: [receive-inbound-message.use-case.ts](../../../modules/chat/src/application/use-cases/receive-inbound-message.use-case.ts), linhas 133–161; [outbox-publisher.ts](../../../packages/events/src/outbox-publisher.ts), função `publishToOutbox`. Responsável sugerido: backend/dados. Fechamento: mensagem, estado necessário e intenção de evento na mesma transação; teste de falha entre operações e recuperação por retry.

**A08 — Readiness retorna 200 mesmo indisponível. Severidade média, P1.**

Com falha de banco simulada, `/readiness` retornou HTTP 200 e `ready:false`. Monitores que verificam apenas o status HTTP podem continuar encaminhando tráfego. A suposta verificação de migrations executa apenas `SELECT 1`, que não prova atualização do schema. O diagnóstico HTTP confirmou o primeiro comportamento.

Evidência: [app.ts](../../../apps/desk-api/src/app.ts), linhas 311 e 330–338. Responsável sugerido: backend/infra. Fechamento: 503 para dependência indispensável indisponível; verificar versão de schema esperada; monitor deve distinguir liveness e readiness.

**A09 — Limite de anexos incompatível entre interface e API. Severidade média, P1.**

A interface aceita arquivos até 16 MiB e envia base64 em JSON. A API permite corpo de apenas 1 MiB; o nginx também não explicita um limite maior. Só o limite comprovado da API já rejeita arquivos de aproximadamente 768 KiB ou mais, dependendo do overhead. O erro fica em `console.error`, sem retorno útil ao operador. O pipeline profundo de scanner outbound é opt-in para data URLs, por variável não repassada pelo Compose base.

Evidência: [Inbox.tsx](../../../apps/desk-web/src/pages/Inbox.tsx), linhas 179–189 e 442; [app.ts](../../../apps/desk-api/src/app.ts), linha 65; [send-outbound-message.use-case.ts](../../../modules/chat/src/application/use-cases/send-outbound-message.use-case.ts). Responsável sugerido: frontend/backend. Fechamento: estratégia única de upload, limites coerentes e teste de arquivo dentro/fora do limite; mensagem de erro visível; política explícita de scanner no runtime implantado.

**A10 — Última mensagem exige carregar o histórico completo. Severidade média, P1.**

`findLatestByConversationIds` e `findLatestInboundByConversationIds` selecionam todas as mensagens das conversas e mantêm a primeira por conversa em memória. A listagem de conversas não tem paginação nesse contrato. Houve melhora de N+1, mas o volume transferido ainda cresce com todo o histórico. Latência e consumo sob carga não foram medidos.

Evidência: [message.repository.ts](../../../modules/chat/src/infrastructure/repositories/message.repository.ts), linhas 81–119; [conversation.repository.ts](../../../modules/chat/src/infrastructure/repositories/conversation.repository.ts), `findAll`. Responsável sugerido: backend/dados. Fechamento: paginação e seleção da última mensagem no PostgreSQL; comparar EXPLAIN e latência com volume representativo.

**A11 — Fluxo de envio não aproveita idempotência ponta a ponta. Severidade média, P1.**

O frontend não envia `clientMessageId` nem `Idempotency-Key` e não mantém trava de envio em andamento no handler. Repetir a ação pode criar novas mensagens. No backend, a mensagem é criada antes de disputar a chave; o perdedor da corrida retorna a mensagem original sem remover a linha recém-criada. A chave também é buscada globalmente, sem validação de payload/conversa. Efeitos de concorrência inferidos por inspeção, ainda sem teste de banco nesta revisão.

Evidência: [api.ts](../../../apps/desk-web/src/lib/api.ts), linha 382; [Inbox.tsx](../../../apps/desk-web/src/pages/Inbox.tsx), `handleSend`; [send-outbound-message.use-case.ts](../../../modules/chat/src/application/use-cases/send-outbound-message.use-case.ts), blocos de dedup e criação. Responsável sugerido: frontend/backend. Fechamento: chave estável por intenção, escopo validado e persistência atômica; testar clique duplo, retry e corrida sem linhas órfãs.

**A12 — Gates permitem aparência de qualidade sem validar o backend. Severidade alta, P1.**

Dos 33 pacotes, 32 definem lint como `echo lint`, 26 definem build como `echo build` e só 6 têm script de typecheck. A API apresentou 220 diagnósticos após geração dos tipos. Seu Dockerfile usa `tsc --noEmit || true`, neutralizando a falha. As imagens executam instalações com `--no-lockfile`, portanto podem resolver dependências diferentes das auditadas. O lint web exige zero warnings, enquanto CI/master gate permite 100. A auditoria não afirma que algum job remoto passou ou falhou: apenas verificou o código do pipeline e os comandos locais.

Evidência: manifests; [desk-api/Dockerfile](../../../apps/desk-api/Dockerfile), linhas 14 e 19; [.github/workflows/ci.yml](../../../.github/workflows/ci.yml); [triple-aaa-verify.mjs](../../../scripts/triple-aaa-verify.mjs). Responsável sugerido: plataforma/backend. Fechamento: verificações reais em todos os pacotes pertinentes, falhas propagadas, instalação reproduzível e política única de warnings. Não basta elevar limites.

**A13 — Alertas de dependências exigem triagem atual. Severidade alta potencial, P1.**

O audit completo apontou 53 alertas; o recorte de produção, 17, com 8 altos. Os altos de produção incluem `fast-uri@3.1.0` e `@opentelemetry/propagator-jaeger@1.30.1`. São contagens do scanner, não 17 explorações demonstradas. O alerta de `ws@8.20.0` no audit completo aparece pelo caminho de jsdom do frontend; não foi atribuído automaticamente ao serviço realtime.

O advisory do mantenedor confirma que o problema de Jaeger depende de uma configuração específica de propagação. A presença da dependência não comprova exploração no runtime atual. Fonte: [OpenTelemetry — GHSA-45rx-2jwx-cxfr](https://github.com/open-telemetry/opentelemetry-js/security/advisories/GHSA-45rx-2jwx-cxfr). O alerta de ws foi conferido em [GHSA-96hv-2xvq-fx4p](https://github.com/advisories/GHSA-96hv-2xvq-fx4p). Responsável sugerido: plataforma/segurança. Fechamento: avaliar alcance por configuração/caminho, atualizar dependências afetadas, testar compatibilidade e registrar exceções com justificativa; repetir audit e scan da imagem efetivamente implantada.

**A14 — Anonimização é parcial e não cobre cópias dos dados. Severidade média, P1.**

O serviço limpa campos diretos do contato e `sender` correspondente ao telefone. Conteúdo, destinatários, notas, metadados de outros registros e cópias na auditoria não são tratados por esse fluxo. Mensagens outbound registram conteúdo e destinatário em `newValue`; notas também copiam conteúdo. O próprio serviço declara escopo parcial. Isso exige uma política técnica de retenção e cobertura coerente; não constitui parecer de conformidade legal.

Evidência: [data-subject-service.ts](../../../modules/privacy/src/application/data-subject-service.ts), `anonymizeContactData`; [audit.repository.ts](../../../modules/audit/src/infrastructure/repositories/audit.repository.ts), `create`; use cases de mensagens/notas. Responsável sugerido: backend e responsável pelos dados. Fechamento: inventário de cópias e retenção aprovada, política de pseudonimização/eliminação e testes consistentes com o escopo prometido; incluir backups no procedimento operacional.

**A15 — Métricas podem acumular rótulos por URL arbitrária. Severidade média, P2.**

O fallback de rota usa `request.url` sem querystring quando não existe rota registrada. Counters e histogramas guardam cada combinação de rótulos em Maps sem descarte. Muitas URLs distintas de erro podem criar cardinalidade crescente. Além disso, `/metrics` fica aberto em produção sem `METRICS_TOKEN`, e o Compose base não passa essa variável. Impacto de memória é inferido, sem teste destrutivo de carga.

Evidência: [app.ts](../../../apps/desk-api/src/app.ts), linhas 76 e 99–107; [metrics.ts](../../../packages/shared/src/metrics.ts), Maps de Counter/Histogram. Responsável sugerido: backend/infra. Fechamento: rótulo fixo para rotas desconhecidas e exposição de métricas restrita conforme implantação; teste com URLs distintas sem crescimento por URL.

**A16 — Autor de nota é escolhido pelo corpo da requisição. Severidade média, P1.**

A rota aceita `authorId` do cliente e o use case persiste esse valor, enquanto a identidade autenticada fica separada para auditoria. Um usuário com permissão de escrever notas pode atribuir a autoria exibida a outro usuário se fornecer um ID válido. A trilha registra o ator, mas a autoria funcional pode ficar enganosa. Evidência estática, sem criação real de nota.

Evidência: [note.controller.ts](../../../modules/notes/src/presentation/http/note.controller.ts), criação; [create-note.use-case.ts](../../../modules/notes/src/application/use-cases/create-note.use-case.ts), campo `authorId`. Responsável sugerido: backend. Fechamento: derivar autor da sessão ou exigir permissão específica para delegação; teste de tentativa de atribuição a outro usuário.

**L01 — Limitações e evidências ainda necessárias**

Não foram executados PostgreSQL/Redis reais, migrations em banco novo, restore, carga, E2E completo, MinIO/ClamAV reais ou integrações externas. A suíte de privacidade incluída inicialmente exigia PostgreSQL e não pôde produzir resultado funcional. As demais verificações usaram dados sintéticos, mocks ou endereço de banco inacessível, evitando atingir dados existentes. Acessibilidade foi inspecionada no código: não houve revisão visual em navegador, leitor de tela, contraste ou certificação WCAG. Backup/restore têm scripts e workflow, mas não houve comprovação de restauração nesta execução. O ambiente local usa Node 24, enquanto CI/Docker declaram Node 20; diferenças de runtime não foram revalidadas.

Não houve alterações de código do produto, migrations, dependências ou configurações. Foram adicionados apenas este relatório e suas evidências. Relatórios antigos não foram sobrescritos.

**Ordem recomendada de correção**

1. Backend/realtime: fechar A01, A02 e A03 e executar testes negativos por sessão e setor. Esses achados impedem recomendação de liberação irrestrita.
2. Backend/plataforma: tornar o build reproduzível e os gates reais (A04/A12), corrigir configuração realtime e readiness (A05/A08), triar dependências (A13).
3. Backend/dados: garantir transação mensagem/outbox, reserva concorrente e idempotência de envio (A06/A07/A11).
4. Frontend/backend: alinhar anexos e erros, paginação, privacidade e autoria (A09/A10/A14/A16); controlar cardinalidade (A15).
5. Reauditar em ambiente isolado com PostgreSQL, Redis, navegador e serviços de mídia, incluindo falhas e recuperação. As notas só devem subir mediante evidência da correção.

**Parecer:** auditoria concluída, correções pendentes. Existe implementação funcional e há testes úteis, mas os controles de acesso e as garantias de operação ainda não são consistentes. Próxima ação concreta: unificar a validação de sessões e a autorização por conversa, incluindo a entrega realtime, com testes de negação antes de nova liberação.

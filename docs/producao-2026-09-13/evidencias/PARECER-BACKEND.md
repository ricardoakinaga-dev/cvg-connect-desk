# Subsídio backend ao plano de produção — 2026-09-13

Planejamento somente. Fontes: notas.json e RELATORIO.md em /tmp/cvg-relatorio-20260913-cgyjo2lg, confrontados com os caminhos atuais abaixo. Nenhum DB/serviço/teste runtime executado; confirmação de código é STATIC, e aceites abaixo são trabalho futuro, não evidência de PASS. Preservar monólito modular, contratos/portas Chat–Gateway, PostgreSQL outbox, workers e realtime atuais. Não há necessidade demonstrada de novo broker, microsserviços ou reescrita.

## Backlog executável sugerido (18 tarefas)

IDs BK podem ser renomeados pelo plano mestre; dependências OP/UI abaixo são interfaces de trabalho, não IDs definitivos. P0 = bloqueio de segurança/durabilidade; P1 = necessário para produção do escopo contratado; P2 = consolidação antes da declaração completa de aderência. Pontos explicitamente opcionais aparecem ao final.

### BK01 — Fechar autorização por ação e por recurso [P0; BE04, BE05]

Escopo: inventariar matriz rota/verbo/ação/recurso; tornar impossível usar apenas membership como substituto de permissão. Corrigir GET /conversations com e sem sectorId, PATCH Kanban move, CRUD tutores/pacientes, e conferir variantes de notas/tarefas/contatos/alertas/mídia. Manter 404 para recurso invisível e 403 para ação proibida conforme contrato. Preservar autoria de notas pela sessão e rejeição de referências inconsistentes; demonstrar em HTTP/PG o que hoje só foi inspecionado.

Evidência: packages/auth/src/resource-authz.ts:66 aceita acesso de setor sem resolver permissão; outbound.controller.ts:199/235 não exige chat:read sem filtro; kanban.controller.ts:218 só authenticate; tutor/patient controllers só authenticate salvo delete; note.controller.ts:92/112/188 já defende autoria/referência.

Aceite positivo: ator com permissão E escopo executa cada operação, inclusive atribuído sem setor segundo política e Admin autorizado; nota persistida tem autor da sessão. Negativo: ator sem role com membership, role sem permissão, permissão sem membership, write sobre setor read-only, referência cruzada e authorId alheio não leem/escrevem nem geram efeito/auditoria de sucesso; variações sem filtro não contornam o controle. Dependências: decisão D-B1; fornece contrato a UI de menu/admin e BK02/03/13/17. Dono: backend segurança. Colisão: auth/resource-authz e todos controllers — um integrador.

### BK02 — Escopo SQL fail-closed e paginação consistente [P0; BE17, BE04]

Escopo: distinguir explicitamente global-admin de conjunto de setores vazio no repository, incluir escopo na própria consulta para não abrir listagem na revogação entre preHandler e SQL. Validar cursor por ator/filtros, ordem total, latest-message e inserções/atualizações concorrentes; estender busca/filtros necessários à Inbox em contrato conjunto com UI, sem filtrar só página carregada.

Evidência: conversation.repository.ts:111 adiciona condição só quando membership.length > 0 e interpreta vazio como possível admin. Cursor e LATERAL LIMIT 1 existentes devem ser preservados.

Positivo: fixtures 10k conversas/100k mensagens produzem página limitada, última mensagem correta, cursor vinculado ao filtro e comportamento de ordenação documentado sob novas mensagens; EXPLAIN ANALYZE/BUFFERS medido com limiares aprovados. Negativo: revogação forçada entre autorização e query não devolve outro setor, cursor de outro usuário/filtro/malformado falha, empates não duplicam itens no cenário estável; consulta cara reprova orçamento. Não prometer snapshot imutável com updatedAt mutável: definir semântica e merge da UI. Dependências: BK01, contrato de filtros da UI, gate carga OP. Dono: backend dados.

### BK03 — Provar sessões e revogação HTTP/realtime [P1; BE03, BE06]

Escopo: exercitar hash/tokens opacos, idle e absolute expiry, rotação com lock e revogação em PG/HTTP; sockets reais em três réplicas com deadline de autorização e reconexão. Código já contém mecanismo; não substituí-lo por JWT nem marcar como ausente.

Evidência: auth.repository.ts:113/183 usa hash e transaction; realtime-service/index.ts:146/690/700/1191 autoriza inscrição/entrega e sanitiza sinal global. 

Positivo: login/refresh e reconexão preservam sessão válida, só destinatários autorizados recebem corpo; dois refresh concorrentes têm resultado único conforme contrato, sem ampliar absolute expiry. Negativo: token bruto não aparece no DB/logs, token antigo/revogado/expirado falha em HTTP e socket dentro do prazo documentado; remoção de role/membership/desativação bloqueia entrega nas três réplicas; auth indisponível/timeout não entrega payload; sinal global sem PII. Dependências: BK01, BK15 timezone, harness OP isolado. Dono: backend segurança/realtime; integrar com bootstrap auth da UI.

### BK04 — Tornar inbound atômico também na primeira conversa [P0; BE08]

Escopo: serializar/deduplicar identidade inbound e criação de conversa de modo que corrida de primeira mensagem não comite conversa/histórico/evento órfão; garantir contato, mensagem, estado e outbox no mesmo executor, hints só após commit. Incluir externalConversationId ausente e identidade de provedor/canal acordada.

Evidência: inbound-atomic.repository.ts:77–148 cria conversa/outbox antes de createIdempotent; ao detectar duplicata retorna sucesso dentro da transaction sem desfazer escritas já feitas. Teste antigo de conversa preexistente é insuficiente.

Positivo: N webhooks iguais simultâneos no contato/conversa inexistentes produzem uma mensagem lógica, uma conversa correta, um incremento unread e os eventos esperados. Negativo: falha após cada escrita causa rollback total e nenhum hint prematuro; mensagem externa já existente não cria conversa extra ou vincula contato/conversa divergente. Dependências: D-B2 identidade/dedup, BK15 coordenação migration; fornece base BK05/08/11. Dono: backend chat/dados.

### BK05 — Recuperar retry legítimo sem relaxar HMAC/replay [P0; BE09]

Escopo: separar prova criptográfica e processamento durável usando estados/reserva recuperável ou protocolo transacional compatível com store atual; vincular ID ao payload original e resultado, definir resposta para duplicata concluída/em andamento. Não simplesmente remover anti-replay.

Evidência: webhook-guard.ts:232 chama store.add antes do handler e responde 409 ao retry após falha de negócio.

Positivo: falha injetada na transação após HMAC válido, reenviada a mesma entrega, termina com uma mensagem durável e nenhum efeito duplicado; crash na reserva é recuperável em prazo definido. Negativo: assinatura errada, timestamp vencido, mesmo eventId com corpo diferente e replay fora da política não escrevem; concorrência não processa duas intenções. Testar comportamento de cache/Redis indisponível se fizer parte do store. Dependências: BK04, D-B2; testar gateway e webhook inbound que compartilham guard. Dono: backend integração.

### BK06 — Efeitos worker idempotentes e falha propagada [P0; BE11, BE07]

Escopo: propagar Result.Err como falha consumível pelo retry/NACK; chave durável de efeito por evento+consumer+tipo; transação para alerta, alert_event e marca de processamento; tratar falha de auditoria de modo explícito. Definir catálogo de eventos esperados para ACK de evento sem handler não apagar trabalho necessário. Inclui todos handlers, não só secretário.

Evidência: message-worker/index.ts:117/129/199/208 loga Err e dá ACK; create-alert.use-case.ts:33/45 grava alerta e histórico em operações separadas, sem chave durável de evento.

Positivo: replay entrega um alerta lógico e um histórico coerente; consumers distintos processam suas próprias obrigações. Negativo: erro de criação nunca dá ACK de sucesso; crash após insert/antes ACK, restart, lease expirado e reentrega não duplicam efeito; evento esperado sem handler falha observavelmente em vez de sumir. Dependências: BK15 migration, precede BK07/08. Dono: backend eventos.

### BK07 — Exercitar leases, DLQ e replay administrativo [P1; BE07, BE12]

Escopo: validar mecanismos existentes com PG, concorrência, restart e ações administrativas autorizadas; recuperação de claim interrompido, replay preservando identidade do efeito e auditoria. Corrigir apenas defeitos reproduzidos. 

Evidência: outbox-lease.ts:129/167/209/239 tem fencing owner+generation; persistent-dead-letter.ts:130 tem claim PENDING→REPLAYING. Exclusão de claim não prova idempotência de handler.

Positivo: duas instâncias disputam mesmo evento+consumer e só uma recebe lease válido; consumers independentes recebem ambos; após máximo de falhas um item DLQ persistente pode ser reprocessado uma vez logicamente. Negativo: ACK/renew/NACK antigo retorna stale sem modificar geração atual; crash antes/depois claim, dead-letter insert e replay não perde item; usuário sem permissão/escopo não consulta nem reprocessa DLQ. Dependências: BK01/06, harness OP; UI administrativa consome estados. Dono: backend eventos.

### BK08 — Mover Secretary para consumo durável assíncrono [P0; BE01, BE13]

Escopo: tirar invocação IA do caminho de resposta webhook; produzir obrigação durável e consumir no worker por portas/composição explícita; persistir tentativa/resultados/handoff/resposta e recuperar crash pós-commit. Revalidar currentHandler antes de invocar e antes de efeito, serializando por conversa quando necessário. Preservar idempotencyKey de resposta.

Evidência: receive-inbound-message.use-case.ts:125 aguarda processMessageWithSecretary e responde só depois; duplicata retorna antes; worker handleMessagePersisted hoje apenas loga. app.ts:640 já compõe Chat↔Gateway com portas, a preservar também na inicialização worker.

Positivo: webhook confirma persistência dentro do orçamento independentemente de IA lenta; restart após commit retoma processamento e produz uma resposta ou handoff lógico. Negativo: IA indisponível não perde inbound humano nem trava webhook; duplicata não reenvia resposta; conversa mudada para humano não recebe bot tardio; crash antes/depois invocação/reply mantém estado recuperável sem retry externo cego. Dependências: BK04/06/07, contrato BK09 e subtarefa outbound BE10 descrita abaixo; composição worker/app.ts sob integrador. Dono: backend chat/IA.

### BK09 — Budgets IA duráveis e policy aplicada [P1; BE14]

Escopo: substituir priorInvocations:0 por orçamento persistente e reservado atomicamente por conversa/janela; contabilizar tentativa, falha, retry e custo/limites configurados; fornecer motivo de bloqueio e fallback humano; preservar limites de prompt/histórico/ação já implementados.

Evidência: invoke-secretary.use-case.ts:52 passa zero sempre; ai-policy.ts tem gate e log de decisões em memória (bounded 500), insuficiente como trilha durável exigida.

Positivo: N invocações autorizadas consomem orçamento segundo regra acordada, sobrevivendo restart; decisão associada à invocação tem metadados duráveis sem conteúdo sensível. Negativo: duas instâncias no último crédito não excedem limite; nova tentativa não burla budget; ação proibida/limite de prompt/histórico não chega ao cliente externo. Dependências: D-B3 (limites/reset/tentativas), BK15 migration, BK14 sanitização; em paralelo ao wiring BK08 após contrato estável. Dono: backend IA.

### BK10 — Completar workflow real de ferramentas/aprovação IA [P1 de aderência BE14; ativação condicionada D-B4]

Escopo: conectar dispatcher produtivo a invokeAITool e revisão humana autenticada/autorizada; fingerprint canônico de TODOS argumentos originais separados da representação sanitizada; bind a ação/recurso/invocação/versão, expiração e decisão/consumo atômicos; execução idempotente e revalidação do recurso. Se produto não usar ferramentas, manter bloqueio explícito e registrar pendência de aderência, sem afirmar workflow implementado.

Evidência: ai-tools.ts:40 faz hash de sanitizeAIArgs; invokeAITool/decideApproval sem chamadores produtivos; aprovação atualmente não prova permissão do reviewer ou consumo único. Pontos além da auditoria são requisitos de aceite para a integração, não incidentes observados.

Positivo: ferramenta permitida passa por policy e guard do domínio; solicitação pendente pode ser aprovada por humano autorizado e executar uma vez com parâmetros exatos. Negativo: telefone/PII/args nested alterados invalidam aprovação embora log permaneça sanitizado; aprovação expirada/rejeitada, reviewer sem escopo, ferramenta desconhecida/proibida, consumo concorrente e replay não executam. Dependências: BK01/06/09/14/15, UI de aprovação e D-B4. Dono: backend IA + produto. Não confundir com ferramenta perigosa já ativa — não há essa prova.

### BK11 — Conectar scan/quarentena ao inbound [P0; BE16]

Escopo: chamar pipeline via obrigação durável, associar asset ao messageId e tornar URL externa interna ao processamento; só asset CLEAN pode ser lido/renderizado. Definir estados e atualização realtime; reconciliar órfãos de object storage e retry. MEDIA_PIPELINE_ENABLED precisa controlar comportamento real ou ser eliminado do contrato, nunca permitir bypass em produção.

Evidência: packages/media/src/index.ts:92 define processInboundMedia sem chamador produtivo; inbound-atomic.repository.ts:126 persiste mediaUrl recebida diretamente.

Positivo: webhook com anexo CLEAN termina em asset persistente legível por usuário autorizado, restart não perde vínculo e UI sai de PENDING. Negativo: INFECTED, PENDING_SCAN, timeout/scanner ausente e falha de storage não expõem URL original/bytes pela API, provider ou UI; retry não duplica asset lógico; SSRF/redirect/DNS rebinding não acessam endereço proibido. Dependências: BK04/06, BK12 contrato de entrega, BK15 migration se necessária, staging MinIO/ClamAV OP e Inbox UI. Dono: backend mídia.

### BK12 — Provar mídia outbound e entrega autenticada [P1; BE15]

Escopo: validar upload dedicado real 16 MiB, MIME/magic bytes, storage/scanner e leitura de asset protegida; acertar contrato para download/preview imagem, áudio, vídeo e documento sem URL externa insegura. Preservar checagem CLEAN existente em sendOutboundMessage.

Evidência: media-upload.controller.ts tem streaming cap, 413/415/422/503 e guard chat:write; testes unitários existentes não exercitam MinIO/ClamAV/HTTP reais.

Positivo: upload válido no limite exato retorna asset CLEAN e envio/preview/download autorizado funciona após restart com armazenamento S3 compatível. Negativo: limite+1 inclusive chunked, MIME falsificado, executável, EICAR seguro, timeout/scanner desligado e asset de outra conversa falham sem entrega; URL assinada/cache não mantém acesso indevido além do TTL acordado após revogação. Dependências: BK01/03, staging OP, contrato UI/retencão D-B5. Dono: backend mídia.

### BK13 — Escopo e retomada de operações de privacidade [P0; BE20]

Escopo: reautorizar consulta e resume com ator/escopo atual; chave requestId vinculada a titular/operação/parâmetros e verificar tanto retorno pré-existente quanto vencedor da corrida; checkpoints seguros e relatório residual real. Ratificar D02 antes de habilitar política destrutiva e ligar a retenção de mídia/eventos/backups/IA.

Evidência: privacy.controller.ts:170/193 só verifica admin:read/write; erasure-operation.ts:519/524 retorna requestId global sem checar ator/titular e winner segue mesma lógica.

Positivo: dry-run não altera dados; execução autorizada retoma de cada checkpoint sem repetir efeito indevido e inventaria resíduos em DB/storage/logs/outbox/DLQ/IA/backups conforme política aprovada. Negativo: revogação durante operação bloqueia resume e leitura; mesmo requestId usado para outro contato/ator não revela relatório nem executa; pedido concorrente e falha parcial não reportam completed falso; restore não ressuscita dado eliminado sem reaplicação de retenção. Dependências: BK01/15, D02/D-B5, BK11/14 e DR OP para resíduos pós-restore. Dono: backend privacidade + responsável dados; aprovação jurídica/política é decisão externa, não alegar conformidade.

### BK14 — Logs, métricas e tracing sem PII [P1; BE19]

Escopo: consolidar logs estruturados e redaction de objetos aninhados, remover contentPreview/prompt e dumps de erro sensíveis; separar fingerprint de segurança e args sanitizados; métricas de cardinalidade limitada e continuidade de correlation/trace entre API, outbox, worker, realtime/provider. Critérios de retenção devem abranger decisões IA.

Evidência: ai-policy.ts:80 copia 200 chars do conteúdo e deixa nested args; console livre persiste; tracing SDK já existe, logo foco é integração e prova OTLP real.

Positivo: evento real pode ser seguido por trace/correlation sem conteúdo pessoal, /metrics autenticado oferece rótulos normalizados, Collector/Tempo registra spans reais do ciclo. Negativo: corpus com email/telefone/nome/prompt nos níveis aninhados, arrays, mensagens de exceção e headers não aparece em logs/OTLP; alta variedade de IDs/rotas não explode séries; exporter indisponível não trava fluxo. Dependências: BK08/09/10, tracing/carga/prometheus OP, D-B5. Dono: backend observabilidade.

### BK15 — Reconciliar schema e migrações com dados existentes [P1; DT01, BE03/18]

Escopo: alinhar timestamps de sessão Drizzle ao TIMESTAMPTZ real; verificar FKs/PKs/uniques e todas novas migrations de BK04/06/09/10/13 em trilha única; inventariar divergência tutor_patients N:N vs patient.tutorId. Migration incremental aditiva/backfill e compatibilidade de rollout com ledger/checksum; não editar migration já aplicada para corrigir drift.

Evidência: schema.ts:274 datas sem withTimezone vs 0013_security_correctness.sql:11; auth.repository.ts já usa extract(epoch) como mitigação; docs09 §6.4 pede tutor_patients e schema tem patient.tutorId singular.

Positivo: instalação fresh e upgrade de snapshot legado real preservam IDs, relações, sessões e instant UTC em timezone UTC e America/Sao_Paulo; ledger idêntico ao catálogo; migração N:N, se ratificada, preserva vínculo antigo. Negativo: migration ausente/checksum alterado falha readiness; vínculo órfão/duplicado e mudança timezone não ampliam sessão nem perdem dados; rollback de aplicação com schema expandido funciona e procedimento de contração/rollforward é ensaiado. Dependências: D-B6 cardinalidade e baseline versionado; ordenação de migrations com OP. Dono único backend dados. Decisão N:N não bloqueia ajuste timezone independente.

### BK16 — Validar readiness real e contratos de degradação [P1; BE18]

Escopo: executar API contra falhas reais DB/ledger/schema/Redis/TLS/timeouts; integrar configuração de dependência crítica/degradável com probes worker/realtime e preflight OP, sem duplicar regras contraditórias. API já distingue liveness/readiness e checa migrations.

Positivo: dependências saudáveis e schema esperado dão readiness 200; Redis opcional indisponível retorna estado degraded documentado e app mantém operação segura. Negativo: DB down, schema atrasado/adulterado, TLS inválido e Redis crítico down dão 503 com timeout limitado e sem segredos; liveness responde enquanto processo consegue servir, e worker travado não parece saudável por SELECT1 de outro processo. Dependências: BK15, OP health/preflight; thresholds de progresso/SLO do plano operacional. Dono: backend plataforma; worker/realtime probes pertencem também OP11.

### BK17 — Contratos de operação hospitalar e integridade contextual [P1; BE04 + UI03/05/06/07/10/11/12/13]

Escopo: fechar com UI contratos já existentes para atribuição, transferência/aceite/rejeição, estado, bot/humano, tutor/paciente, notas/tarefas/alertas, filtros/pesquisa, grupos/labels e user-role/role-permission; implementar somente lacunas reais de API, evitar endpoints paralelos. Unificar regras status/statusV2 e auditoria/atualizações realtime. Planejar conflito de atualização em conversa compartilhada.

Positivo: jornada HTTP e browser muda responsável/estado/setor, cria tarefa/nota e abre contexto completo persistido; admin edita permissões/vínculos; atualização em segunda sessão converge. Negativo: agente/setor inválido, transição inválida, referência fora do escopo, papel não autorizado e duas transferências concorrentes não deixam histórico contraditório ou ampliam acesso; perda de rede não repete efeito. Dependências: D-B1/D-B6/D-B7, BK01/02/03/06, UI da operação; atualizar contratos antes de dividir implementação de Inbox/Admin. Dono: backend produto + frontend. Contratos/perfis avançados além do alvo só são opcionais por decisão explícita.

### BK18 — Reconciliar documentação arquitetural e pacote de prova backend [P1; BE02 e todos BE]

Escopo: atualizar 04/05/ARCHITECTURE/THREAT_MODEL/ADRs, AUTHORIZATION/AI_SAFETY/MEDIA/PRIVACY/TEST_MATRIX para implementação final e limites efetivos. Documentar composição, outbox durável, realtime autorizado e OTEL existente, remover alegações voláteis obsoletas sem apagar histórico. Consolidar ensaios backend acima no candidato atual com SHA/digest/run/artifact e resultados PASS/FAIL/NOT_RUN; distinguir implementação de prova runtime e aderência de certificação.

Positivo: cada BE01–20/DT01 aponta tarefa(s), teste/artefato atual e dono; docs e código concordam; todos casos bloqueantes positivos e negativos passam no gate OP. Negativo: evidência antiga, testes skipped, claims de exactly-once externo, ferramentas IA inexistentes ou migração não ensaiada impedem declaração de produção/certificação. Dependências: BK01–17, gate de evidência OP e docs finais; redação preliminar pode ocorrer antes, encerramento só após prova. Dono: integrador técnico/documentação.

## Cobertura completa da auditoria

BE01→BK08/BK18; BE02→BK18; BE03→BK03/BK15; BE04→BK01/BK02/BK17; BE05→BK01; BE06→BK03; BE07→BK06/BK07; BE08→BK04; BE09→BK05; BE10→complemento obrigatório abaixo; BE11→BK06; BE12→BK07; BE13→BK08; BE14→BK09/BK10/BK14; BE15→BK12; BE16→BK11; BE17→BK02; BE18→BK15/BK16; BE19→BK14; BE20→BK13; DT01→BK15.

### Complemento obrigatório BE10 — anexar como subtarefa de BK08 (ou separar em 19ª tarefa se permitido)

A idempotência outbound existente merece ensaio próprio, além de seu uso na resposta Secretary: outbound-atomic.repository.ts:113/178/195 tem fingerprint, escopo ator+conversa, advisory lock, mapping+mensagem+outbox transacionais e estado unknown_reconciling. Testar providers com e sem idempotência, mesma chave/conteúdo retorna intenção, mesma chave/payload divergente→409, chave em outro ator/conversa não colide, TTL expirado e formato legado têm contrato; crash antes do envio/depois da aceitação remota/antes do ACK nunca dispara reenvio cego quando efeito externo é incerto. Provider homologado deve provar reconciliação por identificação externa ou resolução operacional segura; rollout misto legado/novo e rollback de aplicação precisam preservar mapeamento. Não prometer exactly-once externo. Depende de BK01/04/06/15, decisão de capacidade do provider e ensaio isolado/homologação OP. Este é escopo obrigatório, não opcional nem satisfeito pelos testes da Secretary.

## Decisões que devem ter dono/prazo no plano executivo

- D-B1 Produto/segurança: matriz de permissões de tutores/pacientes/contatos sem setor, conversa atribuída sem setor e definição de Admin global; escolher nomes das ações, visibilidade de diretório e limites de revisão humana. Recomendação: acesso explicitamente concedido e escopo negado por padrão. Bloqueia aceite BK01/BK17, não inventário/testes de negação.
- D-B2 Integração/dados: identidade inbound por provider/instance/channel e ID externo; retenção do dedup/replay e resposta ao retry completo/em andamento. Congelar antes de migration BK04/05.
- D-B3 Produto/IA: limite por conversa, janela/reset, tratamento de retries/falhas/custo e fallback humano; parâmetro operacional precisa ser configurado, não valor zero fixo.
- D-B4 Produto/segurança: ferramentas realmente incluídas no lançamento e classificações/quem aprova/quais operações exigem aprovação. BK10 continua necessário para afirmar aderência AI_SAFETY; pode haver lançamento com ferramentas totalmente desativadas e pendência explicitamente aceita, sem chamar isso de workflow completo.
- D-B5 D02 responsável dados/jurídico + operação: períodos/fundamento de retenção e eliminação para mensagens/mídia/IA/outbox/DLQ/auditoria/backups, TTL de URL/cache e reaplicação após restore. Não é aprovação para o planejamento; apenas decisão de política para ativação destrutiva.
- D-B6 Produto/dados: tutor–paciente N:N prometido vs singular existente, tutor principal e direitos sobre pacientes compartilhados; escolher N:N com compatibilidade ou alterar requisito por decisão formal. N:N não pode desaparecer do backlog como enterprise opcional sem essa ratificação.
- D-B7 Operação hospitalar: transições válidas status/statusV2, transferência pendente/aceita, responsável permitido, handoff e prioridade quando humano assume durante IA; congelar contrato antes de Inbox/BK08/BK17.
- D-B8 Integração/operação: capacidade real de idempotência/reconciliação do provider e janela de rollout misto; definir estado apresentado ao operador e runbook de resultado incerto.

## Serialização e colisões

- schema.ts e diretório de migrations: BK04/05/06/09/10/13/15 e eventuais BK11/BK17; um responsável aloca numeração e integra sequencialmente. Branches podem escrever propostas de schema, não disputar migration aplicada. Upgrade obrigatório cobre estado legado, não repetir fresh com outro nome.
- packages/auth e controllers: BK01 fixa API de autorização antes de BK03/BK13/BK17; revogação e realtime compartilham semântica, não introduzir bypass em guard de recurso.
- apps/desk-api/src/app.ts: BK08 composição, BK11/12 rotas mídia e BK14/16 observabilidade/health têm único integrador. Extrair factories pequenas só se reduzir conflito sem mudar arquitetura.
- apps/message-worker/src/index.ts: BK06/07 primeiro estabilizam execução/erro/idempotência, BK08/11 acrescentam consumers segundo catálogo comum. Evitar duas mudanças simultâneas do loop.
- Inbox.tsx / lib/api.ts (UI): BK02 filtros, BK08 handoff, BK11/12 mídia e BK17 operação dependem de contrato congelado; consolidar adapter/client e interfaces antes de fan-out de componentes.

## Produção necessária versus enterprise opcional

Todos defeitos de autorização, durabilidade, segurança de mídia, escopo de privacidade, gate/evidência, observabilidade básica, recuperação e fluxo hospitalar contratado permanecem necessários. Validações BE03/05/06/07/10/12/15/17/18 não são removidas porque código parece bom. Ferramentas IA têm ativação condicionada acima, sem perda da obrigação contratual. N:N tutor-paciente e filtros exigidos na documentação são decisões de escopo, não extras presumidos. Broker novo, decomposição em microsserviços, multi-região ativo-ativo, SSO/SCIM ou autorização multitenant genérica não foram demonstrados como requisitos nesta auditoria e são extras enterprise opcionais fora da correção; só entram por nova decisão explícita. Três réplicas realtime são prova da arquitetura já documentada, não migração enterprise opcional.

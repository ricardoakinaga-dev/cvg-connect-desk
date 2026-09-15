**Contratos de integração — proposta v1**

Estes contratos são uma especificação alvo, não APIs já implementadas. AAA-01 congela a versão executável antes de liberar dependentes. D01–D04 em DECISOES têm premissas propostas e decisões necessárias. Um agente não altera contratos unilateralmente: solicita mudança ao lead, que analisa consumidores, versiona, atualiza o DAG e marca evidências dependentes como stale. Nenhuma assinatura abaixo deve ser anunciada como já disponível.

**Congelamento C01 (2026-09-12, run `aaa-20260912`):** C01 v1.0.2 FROZEN em `runtime/contracts/C01.md` (SHA-256 `abd51f3226fdd7a6a6009f805a188f5c3ed54c893b10ee1f42d1021b18d30668`); decisão de sessão D01 registrada em `runtime/decisions/D01-session-policy.md` (SHA-256 `36d9763dc5afb94a37c8df78f6ffd295b1d37d94597ce2e56e5d45654e57dd79`). Histórico: v1.0.0 revogada por revisão independente; v1.0.1 corrigiu H1/M2/M3/M4/L3; v1.0.2 aplica condições da crítica I1 (F5/F7) sem mudança semântica, com revisão fresca PASS registrada em `runtime/reviews/AAA-03-precondicoes-2026-09-12.md`. C00 e C04–C09 permanecem especificação alvo até seus donos congelarem (pendência registrada em `runtime/state.json`).

**Congelamento C02/C03 (2026-09-12, run `aaa-20260912`):** C02 v1.0.1 FROZEN em `runtime/contracts/C02.md` (SHA-256 `b96ebc6026feffb3db44abbab415eaf806804743c7f7f36a69f1f1f1b0eca46c`); C03 v1.0.1 FROZEN em `runtime/contracts/C03.md` (SHA-256 `26daf0cc1fee1ef34be0067e41b5af230d946e63529dbd6eb8415fddc9c5502a`). Revisão independente fresca em `runtime/reviews/AAA-02-condicoes-2026-09-12.md`: C02 v1.0.0 REJECT → v1.0.1 APPROVE WITH CONDITIONS (condição de catálogo fechada por `MUD-CAT-001`); C03 APPROVE. Habilita o despacho AAA-02. A lacuna G-C02-1 (auth de serviço nas rotas internas de outbound) fica em AAA-04, serializada após AAA-02.

| ID | Dono e fronteira | Contrato a congelar |
|---|---|---|
| C00 | Lead/infra; todos os testes | Revisão/hash, ambiente isolado marcado, fixtures determinísticas e seed repetível; DB/Redis namespace e portas por tarefa; teardown restrito ao identificador do run; logs sanitizados |
| C01 | Backend auth | **FROZEN v1.0.2** em `runtime/contracts/C01.md`: principal obtido de sessão válida; um relógio e política para expiresAt/absoluteExpiresAt/idle/revoked/user active; rotação atômica com deadline absoluto imutável (materializado se legado); requisição não escolhe autor; política de lastSeenAt e duração resolvidas em `runtime/decisions/D01-session-policy.md` |
| C02 | Backend authz + realtime | **FROZEN v1.0.1** em `runtime/contracts/C02.md`: resolver setor/owner no servidor; ação e permissão + membership necessários; admin explícito; conversa sem setor não é pública; 403/404 e nível de markRead decididos em C02 §3 (D-C02-2/4). Entrega realtime autoriza canal E destinatário e revalida membership com interrupção de entrega em até 5 s após revogação no perfil C00; global só eventos sem dados sensíveis; protocolo autenticado API↔realtime separado de usuário; portas de composição para AAA-02 |
| C03 | Backend dados/eventos | **FROZEN v1.0.1** em `runtime/contracts/C03.md`: at-least-once; mensagem/estado/intenção de evento no mesmo executor transacional. Publicação Redis somente após commit. Lease por eventId+consumerId+owner+geração/token+expiresAt; claim e renewal atômicos, ACK atrasado rejeitado; worker/HTTP/realtime compartilham semântica; evento lento e retry/DLQ têm comportamento definido; recorte de AAA-02 limita-se à preservação dos caminhos existentes |
| C04 | Backend outbound + dono cliente | Chave estável por intenção; escopo ator+conversa, fingerprint do payload, conflito 409 em reuso incompatível. Definir TTL sem permitir reenvio silencioso após expiração. Mapeamento/message/outbox atômicos. Resposta distingue aceito/pending/sent/failed/unknown-reconciling; aceite Gateway não significa entregue ao destinatário. Provider sem idempotência exige reconciliação explícita |
| C05 | Backend mídia + plataforma + cliente | Transporte upload dedicado/stream ou objeto assinado a definir em D03; conteúdo máximo alvo 16 MiB, limites proxy/API/storage coerentes incluindo overhead. Status erro 413 para excesso. Documentos aguardam CLEAN; INFECTED/PENDING/timeout não são entregues. MIME/magic bytes, SSRF, URLs/storage privados; envio referencia asset autorizado, não origem arbitrária |
| C06 | Backend consultas + cliente | Lista paginada por cursor opaco com ordenação total (timestamp,id), page size default50 max100 propostos, resposta itens+nextCursor. Autorização precede paginação; deep-link carrega recurso autorizado mesmo fora da primeira página. Transição compatível com clientes e histórico incremental, sem quebra silenciosa do DTO |
| C07 | Responsável pelos dados + backend | Matriz por tipo/cópia: finalidade/retenção/exportar/pseudonimizar/apagar/backup. Decisão D02 antes de alteração irreversível; auditoria registra ator, resultado e correlação minimizados; ação retomável e idempotente, sem alegar eliminação integral quando parcial |
| C08 | Plataforma/SRE | Runtime e package manager fixados; lock congelado; contrato de build/lint/typecheck/test por pacote; readiness 503 obrigatório/schema, liveness separado; metrics token/rede explícitos, labels limitados. Proveniência commit+hash de fontes e imagem, ambiente e evidência; promoção separada de aprovação técnica |
| C09 | Dono design system/cliente | Marca e tokens existentes como ponto de partida; estados e DTOs reais; CSS global/primitivas por um dono, páginas em lotes disjuntos; erro e conectividade verdadeiros; DESIGN_QA governa render/acessibilidade/estados; nada de geração externa obrigatória por histórico |

**Congelamento C08-AAA06 (2026-09-12, run `aaa-20260912-a6`):** recorte de plataforma para AAA-06 FROZEN em `runtime/contracts/C08-AAA06.md` (SHA-256 `8ec1ad6b9dbfe7bae8c1315cee26fd9d8dd617920ff236144ee344479d228b39`). Decisões DC08-1..10: origem publica `ws(s)://<host>/ws/`, default de imagem `/ws/` (proibido loopback), `wss` em HTTPS, DEV preservado, lockfile congelado no build da imagem web (DC08-6), staging herda o default, proxy/TLS externo e verificacao de deploy em AAA-23/24. Nao altera C02.

**Reservas compartilhadas:** schema e migrations, lock/manifests, app.ts, realtime index, Inbox/api.ts, CSS global/EntityPages.css, Compose/Playwright. BACKLOG lista ownership concreto. Migrações novas recebem número pelo integrador quando a branch se torna candidata; branches paralelas não adivinham o próximo número. Novas assinaturas/DTOs devem ter exemplo positivo, negativo, compatibilidade e teste de consumidor anexos à versão de contrato em AAA-01.

**Integração com legado:** runtime atual usa tokens de sessão opacos, embora docs históricas usem a palavra JWT. Não migrar para JWT por nomenclatura. Manter invariantes do atendimento e IDs externos; gates de migração e testes devem cobrir dados já existentes sintéticos. Type casts não resolvem incompatibilidade de contrato.


**Checklist semântico obrigatório de AAA-01, além do validador estrutural**

O responsável produz uma matriz com produtor, consumidores, assinatura/schema alvo, um exemplo aceito, um rejeitado, resposta de erro, teste de consumidor, migração/compatibilidade, versão e decisão pendente. O crítico lê a matriz e confronta cada consumidor antes de aceitar o contrato. Exemplos mínimos:

| Contrato | Caso que aceita | Caso que deve rejeitar ou recuperar |
|---|---|---|
| C00 | Fixture em DB identificado pelo run | URL de banco sem marcador isolado, teardown fora do namespace |
| C01 | Sessão válida de usuário ativo | Token expirado/idle/revogado; duas rotações concorrentes |
| C02 | Ator A autorizado à conversa A | Mesmo ator solicitando conteúdo B, em HTTP e subscription/entrega WS |
| C03 | Claim vigente e ACK de mesmo proprietário/geração | ACK atrasado de lease anterior; crash antes/depois de commit |
| C04 | Retry da mesma intenção e fingerprint retorna resultado | Mesma chave com payload/ator/conversa incompatível; aceite externo desconhecido |
| C05 | Anexo no limite com estado CLEAN | Excesso, MIME falso, scanner pendente/infectado ou destino privado indevido |
| C06 | Página seguinte com cursor/escopo válido | Cursor inválido ou tentativa de atravessar setor; empate de timestamp |
| C07 | Exportação/ação conforme política decidida | Eliminação fora do escopo aprovado ou declaração integral quando parcial |
| C08 | Imagem/hash correto, checks atuais e readiness saudável | SHA divergente, gate ausente, schema atrasado ou DB indisponível |
| C09 | Ação operável e estado visual compatível com resposta real | Online fictício, controle sem efeito, foco oculto ou erro silenciado |

Decisão pendente deve nomear somente os consumidores bloqueados. A matriz e parecer são evidência de especificação; a execução futura de testes de consumidor continua obrigatória para aceitar a implementação.

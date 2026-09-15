# LGPD_DATA_SUBJECT_REQUESTS — CVG Connect Desk (LGPD arts. 18–19)

> AAA-17 / C07 + PROD-16 (BK13). Documento operacional das cópias de dados,
> exportação por escopo, pseudonimização e retenção. **A decisão D02
> (prazo/finalidade por tipo de cópia, ratificada pelo responsável pelos
> dados) permanece PENDENTE.** Nada aqui constitui parecer de conformidade
> legal. Os defaults do código são seguros: `dry-run` e nenhuma eliminação
> irreversível habilitada.
>
> **PROD-16 registra apenas estado/inventário técnico; não ratifica a
> política.** O delta fechou o escopo de operação: consulta/retomada/
> cancelamento revalidam ator+escopo ATUAIS, `requestId` fica vinculado a
> ator+contato+modo+escopo, a execução irreversível exige
> `confirmIrreversible: true` e o relatório traz residual scan + checkpoints.
> A eliminação definitiva e a liberação de dados restaurados de backup
> permanecem **BLOCKED** até a ratificação da D02 pelo responsável pelos
> dados (dono externo), conforme `DECISOES.md`.

## Direitos atendidos

| Direito | Endpoint | Auth | Efeito |
|---|---|---|---|
| Confirmação + acesso (art. 18, I–II) | `GET /privacy/contacts/:id/export?reason=` | `admin:read` | pacote JSON integral **somente com escopo global**; ator setorial recebe 403 `FULL_EXPORT_DENIED` e deve usar `scope=authorized` |
| Acesso por escopo autorizado | `GET /privacy/contacts/:id/export?reason=&scope=authorized` | `admin:read` | somente cópias das conversas nos setores do ator; fora do escopo → 404, sem revelar existência; `omitted` conta o que foi omitido; `mediaAssets` lista os artefatos no escopo (presença de bytes via media-copy-port) |
| Inventário de cópias | `GET /privacy/contacts/:id/inventory` | `admin:read` | inventário por tipo/cópia (finalidade, retenção proposta, exportável, pseudonimizável, apagável, backup, pendência D02, contagens/ids), sem PII, no escopo do ator; fora do escopo → 404 |
| Pseudonimização/eliminação (art. 18, VI) | `POST /privacy/contacts/:id/erasure {reason, requestId?, dryRun?, confirmIrreversible?}` | `admin:write` | planeja/executa conforme configuração; default `dry-run`; execução com bytes de mídia exige `confirmIrreversible: true` (409 `IRREVERSIBLE_CONFIRMATION_REQUIRED` sem ela); resultado parcial explícito |
| Retomada | `POST /privacy/operations/:id/resume {reason?, confirmIrreversible?}` | `admin:write` | continua do checkpoint persistido no escopo ATUAL do ator (interseção com o escopo registrado); escopo revogado → 404 |
| Estado da operação | `GET /privacy/operations/:id` | `admin:read` | relatório/checkpoint (sem PII) revalidado no escopo atual; fora do escopo → 404 |
| Cancelamento | `POST /privacy/operations/:id/cancel {reason?}` | `admin:write` | encerra operação não terminal como `failed` com marcador `CANCELLED` (idempotente); retomada posterior → 409; fora do escopo → 404 |
| Anonimização legada | `POST /privacy/contacts/:id/anonymize {reason, requestId?}` | `admin:write` | PII direto do contato; histórico preservado (compatibilidade); contato fora do escopo → 404 |

## Inventário de cópias (AAA-17 / C07)

| Cópia | Finalidade | Retenção proposta (pendente D02) | Exporta | Pseudonimiza | Apaga | Backup |
|---|---|---|---|---|---|---|
| `contact` | Identificação e contato do titular | Enquanto o vínculo operacional existir | sim | sim | não | sim |
| `tutor-link` | Vínculo tutor/paciente | Enquanto o vínculo existir (outro titular) | sim (ids) | não | não | sim |
| `conversation` | Histórico de atendimento | Obrigação operacional | sim | metadata | não | sim |
| `message` | Histórico de mensagens | Obrigação operacional; conteúdo redigido por token | sim | sim | não | sim |
| `note` | Anotações internas | Operacional | sim | sim | não | sim |
| `outbox` | Entrega de eventos | Até processamento/reconciliação | sim | sim | não | sim |
| `dlq` | Falha terminal para replay | Enquanto pendente | sim | sim | não | sim |
| `media-asset` | Anexos | `retentionUntil` quando definido | sim | metadata | bytes (flag) | sim |
| `audit` | Rastreabilidade | 90 dias (base) | sim (referências) | redação preservando ação/ator | não | sim |
| `backup` | Recuperação de desastre | 14 dias (`pg-backup.sh`) | não | não | não | sim |

A cópia `backup` não é reescrita pelo app: a operação a declara como
**residual** e exige reaplicação da política após restore. Os bytes de mídia
só são apagados com `PRIVACY_ALLOW_IRREVERSIBLE_DELETE=true` e a cópia
`media-asset` aprovada em `PRIVACY_APPROVED_DELETE_TYPES`.

## Configuração da política (D02 como configuração)

| Variável | Default | Efeito |
|---|---|---|
| `PRIVACY_OPERATION_MODE` | `dry-run` | `dry-run` planeja/audita sem mutar; `execute` aplica somente as cópias aprovadas |
| `PRIVACY_APPROVED_PSEUDONYMIZE_TYPES` | vazio | CSV de cópias autorizadas à pseudonimização (ex.: `contact,message,note`) |
| `PRIVACY_APPROVED_DELETE_TYPES` | vazio | CSV de cópias autorizadas à eliminação irreversível |
| `PRIVACY_ALLOW_IRREVERSIBLE_DELETE` | `false` | trava mestra da eliminação irreversível (bytes de mídia) |
| `PRIVACY_POLICY_VERSION` | `d02-pending-v1` | versão registrada na trilha e no relatório da operação |

Sem qualquer configuração, a operação responde `mode: dry-run`,
`mutatedCopies: 0` e `fullErasureClaimed: false`. **Habilitar execução é a
ratificação operacional da D02 pelo responsável pelos dados.**

## Operação de pseudonimização/eliminação

- **Idempotente por `requestId`**: repetir o pedido devolve o relatório
  original com `deduplicated: true`; não há segunda mutação.
- **Retomável por checkpoint**: `privacy_operations.steps/checkpoint` guarda o
  passo concluído; falha injetada/real vira `status: failed` com código e a
  retomada continua de onde parou (passos já concluídos não repetem).
- **Redação determinística**: telefone/nome/e-mail/externalId do titular são
  substituídos por `ANONYMIZED-<id>` em `content`, `sender`, `recipient`,
  `metadata`, payloads de outbox/DLQ, `old/new value` de auditoria, nome de
  arquivo de mídia. A transformação é idempotente.
- **Auditoria minimizada**: a trilha grava ator, `requestId`, versão da
  política, modo, resultado, contagens e resíduos — nunca conteúdo, PII nem
  `old/new value` do titular.
- **Resultado parcial explícito**: `partial: true` e
  `fullErasureClaimed: false` sempre que houver resíduo declarado (backup,
  vínculo com outro titular, bytes de mídia retidos). A operação **nunca**
  alega eliminação integral.
- **Reconciliação de falha**: `lgpd.pseudonymize.failed` registra o código do
  erro e o checkpoint; `GET /privacy/operations/:id` mostra o que restou.
- **Teste de reidentificação residual**: `scanResidualIdentifiers` varre as
  cópias no banco; a suíte `aaa-17.integration.test.ts` prova varredura
  positiva antes e vazio depois da operação configurada.

## Escopo de operação e recusas (PROD-16 / BK13)

- **Ator+escopo atuais sempre revalidados**: consulta, listagem (inventário),
  retomada e cancelamento resolvem permissão pela fonte efetiva
  (`role_permissions` do banco quando provisionada; fallback estático apenas
  em instalação legada) e membership de setor no momento da requisição. Papel
  `Admin`/marcador global habilita `all`; ausência de setores nunca é admin.
- **Operação fora do escopo → 404** sem relatório, existência, contato ou
  contagens. A recusa é auditada (`lgpd.*.refused`) com ator, correlação e
  escopo, sem PII.
- **`requestId` vinculado** a ator+contato+modo+escopo: repetir pedido
  idêntico devolve `deduplicated: true`; reuso divergente responde 409
  `REQUEST_ID_CONFLICT` sem relatório alheio.
- **Retomada com revogação**: o membership do ator é reconferido; revogado no
  meio → 404 e nenhum passo novo. Outra identidade com escopo válido retoma do
  checkpoint, e o escopo efetivo é a **interseção** entre o registrado e o
  atual (retomada nunca amplia alcance).
- **Cancelamento**: operação não terminal vira `failed` com marcador
  `CANCELLED` (idempotente); retomada posterior é `not_resumable` (409).
- **Execução irreversível** (bytes de mídia) exige `confirmIrreversible: true`
  e registra a confirmação na auditoria; sem ela nada é mutado e a recusa é
  auditada. `dry-run` nunca muta.
- **Relatório com residuais e checkpoints**: `steps`/`checkpoint` por cópia,
  `residuals` declarados (`backup`, vínculo de outro titular, bytes retidos) e
  `residualScan` com o resultado da reidentificação (hits por cópia) sobre os
  identificadores capturados antes da operação.

## Anonimização legada (compatibilidade)

- `contacts.{phone,name,email,externalId,metadata}` → marcadores irreversíveis;
- `messages.sender` **somente** quando igual ao telefone do titular (outbound da equipe intacto);
- linhas e FKs preservadas (conversas, tarefas, auditoria continuam íntegras);
- escopo declarado como parcial: conteúdo/notas/cópias na auditoria exigem a
  operação C07 acima. O endpoint legado não substitui a política D02.

## Retenção e backups (base)

- Logs operacionais (sem PII além de máscaras): 90 dias.
- `webhook_replay_log`: TTL 24h. Mídia em quarentena INFECTED: 7 dias, depois excluir.
- Backups: retenção 14 dias (`pg-backup.sh`), criptografia em repouso pelo provedor do volume.
- Backups **não** são reescritos por pseudonimização/eliminação; após restore,
  a operação deve ser reaplicada (residual declarado). Eliminação física de
  backups depende do provedor e permanece fora do escopo do código.

## Não coberto (lacunas honestas)

- Portabilidade automatizada entre controladores (exportação via endpoint);
- eliminação física de backups (depende da retenção do provedor);
- reescrita automática de registros de tutor/paciente (outros titulares exigem pedido próprio);
- DPO workflow (fora do escopo do código);
- parecer jurídico de prazos/hipóteses legais (D02 pendente do responsável pelos dados).

## Estado PROD-16: implementado × BLOCKED (D02 OPEN)

| Item | Estado | Observação |
|---|---|---|
| Inventário por cópia (finalidade/retenção/ações/pendência) | IMPLEMENTADO | `GET /privacy/contacts/:id/inventory`; teste PROD-16 AC3 |
| Escopo de operação (consulta/retomada/cancelamento) | IMPLEMENTADO | ator+escopo atuais; 404 sem vazamento |
| `requestId` vinculado a ator+contato+modo+escopo | IMPLEMENTADO | 409 `REQUEST_ID_CONFLICT` sem relatório alheio |
| Redaction determinística + residual scan + checkpoints | IMPLEMENTADO | relatório `steps`/`residualScan`/`residuals` |
| Dry-run sem mutação | IMPLEMENTADO | default do código |
| Confirmação explícita para bytes de mídia | IMPLEMENTADO (gate) | `confirmIrreversible`; execução real ainda depende de configuração D02 |
| Eliminação definitiva de dados/bytes em produção | **BLOCKED** | depende da ratificação D02 (dono: responsável pelos dados). Configuração `PRIVACY_OPERATION_MODE=execute` + listas aprovadas é a ratificação operacional |
| Liberação/reescrita de backups e dados restaurados | **BLOCKED** | DONO: responsável pelos dados + operação (DR); reaplicação da política após restore é manual e declarada residual |
| Retenção de mídia de quarentena/eventos/IA por prazo ratificado | **BLOCKED** | proposta em D02; sem prazo ratificado o código não elimina

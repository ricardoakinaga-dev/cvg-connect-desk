# Contratos de continuidade — revisão R2

A [fotografia recebida](../auditorias/2026-09-13-entregas/evidencias/documentation-before/docs/producao-2026-09-13/CONTRATOS.md) preserva C01–C10. A tabela abaixo reconcilia o que mudou e o que ainda precisa de fechamento. Não redefine interfaces silenciosamente nem ratifica decisões de produto/dados.

| ID | Fronteira | Estado e diferença obrigatória | Donos/tarefas |
|---|---|---|---|
| C01 | Sessão | Sessões opacas/hash e deadlines preservados; provas antigas existem, reexecutar HTTP/PG/WS no candidato integrado. | PROD05/17 |
| C02 | Autorização | Ação/recurso e permissões efetivas implementadas; cobrir todo endpoint legado e mutação de cópia fora do setor. | PROD04/16/26 |
| C03 | Ingresso | Claim/complete/fail implementado. Identidade estável de payload não pode depender de HMAC transitório. Contrato anterior contradiz409 versus2xx para completed: fechar com produtor real/sandbox. | PROD07/08 |
| C04 | Eventos | Outbox/ACK/NACK/DLQ persistentes e worker observável; validar lease/renewal sob batch e efeito lento, crash/replay e consumidores independentes. | PROD09/12 |
| C05 | Entrega | Idempotência, unknown e retenção outbound existem; vincular reconciliação remota e resultado durável da IA para não recalcular/responder em duplicidade. | PROD10/11/20 |
| C06 | Mídia | Pipeline e asset privado conectados; ligar recovery ao runtime e tornar SCAN_FAILED recuperável, com leitura sempre autorizada/clean. | PROD14/15/20/32 |
| C07 | Operação | APIs transacionais entregues; exigir precondição e propagá-la ao cliente. Completar filtros/contexto/relacionamentos/eventos por fluxo. | PROD18–30 |
| C08 | Dados/IA | Budget persistente e nova erasure entregues; bloquear bypass legado, preservar unknown, e resolver D02/D03/D05 antes das ações dependentes. | PROD06/10/13/16/25/26 |
| C09 | Runtime | Health do worker e configuração OTel melhoraram; provar boot/readiness remoto, graceful drain, spans, alertas e rollback. | PROD31/32/36/37 |
| C10 | Evidência | Manifestos/gates existem mas aceitam entradas inválidas. Identidade de fonte/lock/imagem/run, comando/exit/tempo e métricas são obrigatórios. | PROD00/02/03/34/35/40 |

PROD01 deve registrar por contrato os símbolos/caminhos reais, versão, produtor/consumidor, exemplos positivos e negativos, erros, compatibilidade de rollout e check de aceitação. Preserve C01 normal7d/absoluto30d/idle24h e C02 ação+recurso/revogação≤5s; demais metas estão em CRITERIOS.md.

C03 precisa separar autenticidade da tentativa, identidade do evento e resultado do negócio. C05 precisa distinguir nova invocação, retry seguro e reconciliação de resultado ambíguo. C07 deve impedir sobrescrita por cliente antigo sem inventar conflito causado por truncamento de timestamp. Esses são contratos a fechar antes dos respectivos deltas, com regressões de consumidor.

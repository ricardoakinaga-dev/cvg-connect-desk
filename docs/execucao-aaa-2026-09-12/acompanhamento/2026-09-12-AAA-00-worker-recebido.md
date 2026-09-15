# AAA-00 — evidência de worker e fixtures recebida

Conferência documental desta conversa em 12/09/2026. Foram lidos o README de `runtime/evidence/AAA-00/worker-isolation/` e o registro FIND-INV-009/010. Os hashes recalculados de `run-context.ts` (`5cefb5f6b3076d0eb0d80b45af5db2aa22d6cc9eb11f403539e5c5e67850bb38`) e `fixtures.ts` (`c4386358a922c6542c6fadb054d6212a35c3c8b687006c6360c602f3e7bcc3da`) conferem com a entrega.

O coordenador registra execução PASS do worker 1: raiz dedicada, guardas 4/4, migrations, fixtures, seed idempotente de benchmark e teardown. O benchmark aqui é preparação do dataset, não medição de desempenho. Nenhuma suíte ou serviço foi executado nesta conferência.

FIND-INV-009 foi registrado como resolvido no cenário exercitado; FIND-INV-010 permanece aberto para os imports do smoke E2E. O teste de um worker adicional com recursos dos agentes existentes não prova todas as combinações de runs/workers simultâneos. O próprio relatório esclarece que a fórmula de portas não implementa reserva; ownership e verificação de disponibilidade continuam necessários antes de provisionar.

O coordenador registra fixtures, dataset e isolamento exercitado como aceitos para AAA-00, restando provisionamento MinIO/ClamAV/OTel. Preservar o limite do aceite: serviço obrigatório deve existir e ser verificado antes do gate correspondente; inventário ou ausência de Docker não são evidência de execução desse gate. Não declarar o smoke original aprovado enquanto FIND-INV-010 e sua verificação estiverem pendentes.

AAA-04 permanece despachada, aguardando retorno do builder. Esta rodada trouxe progresso de AAA-00 e reconciliação, não implementação de AAA-04. Próxima ação: builder executar o prompt oficial já emitido; coordenador acompanhar e revisar o candidato quando recebido. Não duplicar despacho ou iniciar mais agentes além do limite de três ativos.

Nenhum arquivo de produto, runtime, banco ou serviço foi alterado por esta conferência.

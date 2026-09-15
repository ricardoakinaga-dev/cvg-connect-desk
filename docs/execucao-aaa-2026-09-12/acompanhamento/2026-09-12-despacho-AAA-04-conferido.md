# AAA-04 — despacho conferido

Conferência desta conversa em 12/09/2026. Foram lidos o prompt oficial e as seções de pré-condições, ownership e ambiente do despacho. Os arquivos existem em `runtime/dispatch/AAA-04.md` e `runtime/dispatch/prompt-agente-4.md`.

Hashes recalculados: C01 `abd51f3226fdd7a6a6009f805a188f5c3ed54c893b10ee1f42d1021b18d30668`; C02 `b96ebc6026feffb3db44abbab415eaf806804743c7f7f36a69f1f1f1b0eca46c`. Ambos coincidem com o despacho. A disponibilidade viva de PG 56452/Redis 56682 não foi revalidada aqui; o builder deve conferir marcador antes de escrever.

O despacho permite que um builder disponível assuma o papel Agente 4 e transfere explicitamente os caminhos compartilhados das tarefas encerradas para AAA-04. O número do papel não autoriza quatro agentes simultâneos: permanece o limite de três ativos, incluindo coordenador e eventual crítico.

O builder deve executar o prompt oficial sobre o worktree integrado, preservando as mudanças AAA-02/AAA-03. Sua reprodução anterior à correção usa essa baseline integrada, não uma restauração destrutiva do HEAD antigo. Entregar candidato completo com arquivos novos, manifesto, logs sanitizados e evidência antes/depois; retornar IMPLEMENTED, BLOCKED ou FAILED. Estado canônico, revisão e integração continuam sob o coordenador.

Errata de continuidade: o despacho ainda agrupa inventário e matriz de serviços entre pendências de AAA-00; esses dois documentos já receberam aceite estático. A execução/provisionamento e demais critérios permanecem pendentes. O coordenador deve harmonizar os resumos sem reabrir a entrega documental aceita; isso não bloqueia AAA-04.

Nenhuma alteração de produto, runtime, banco ou serviço foi realizada nesta conferência.

## Adendo — marco consolidado recebido

O coordenador informou correção da contagem Chat para 32/32 no README de AAA-02 e das rotas no despacho AAA-04: pull `GET /gateway/outbound/pending`; confirmação `POST /gateway/outbound/:id/sent`. Informou também liberação das reservas anteriores e transferência do escopo ao builder único de AAA-04. O prompt vigente é `runtime/dispatch/prompt-agente-4.md`; usar os arquivos atuais, não cópias antigas da conversa.

Este retorno conclui a preparação relatada e não contém implementação AAA-04. Próxima ação: encaminhar o prompt oficial ao builder atribuído para execução. Não reiniciar a reconciliação AAA-02/AAA-03 nem criar outro coordenador. O próximo retorno esperado é IMPLEMENTED, BLOCKED ou FAILED de AAA-04, acompanhado de evidências.

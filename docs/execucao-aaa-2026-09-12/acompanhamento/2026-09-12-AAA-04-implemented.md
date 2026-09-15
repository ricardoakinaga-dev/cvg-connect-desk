# AAA-04 — IMPLEMENTED recebido, integração pendente

Conferência desta conversa em 12/09/2026, sem alterar produto, runtime ou bancos e sem executar suítes. Origem: retorno do builder encaminhado pelo usuário.

## Integridade observada

O pacote `/tmp/opencode/aaa-04-candidate/` existe. Hashes conferidos: candidate.diff `961bb9d86fc9d0f0315d5f11e2ecfdca9fc6bc1143ed0c76900ee81be467ad19`; delta-AAA-04.diff `80add3cd1cee9af4af26b9b9ac9d2dc05fdbc48e9c85b09df6d0f031d84cf022`; candidate-files.txt `e5a471ba7c4f03b400274b39f9703c901eb49ec3d61c32a4099b218dfe37981f`.

**Divergências encontradas:** `sha256sum -c candidate-files.txt` aprovou 8/9; o teste `apps/desk-api/src/__tests__/aaa-04.integration.test.ts` diverge. `sha256sum -c log-hashes.txt` aprovou 6/7; `/tmp/opencode/aaa-04-before.log` diverge. A causa e autoria não foram determinadas. Não sobrescrever o manifesto ou o log histórico para aparentar correspondência: preservar versões, identificar alterações e recongelar o candidato/evidências aplicáveis antes da revisão.

O diff contra HEAD acumula trabalho anterior; usar o delta sobre AAA-02/AAA-03 e o snapshot completo para delimitar AAA-04, sem reverter predecessores. Arquivar os dois arquivos novos e todos os nove arquivos integrais em local durável; arquivos temporários não são o arquivo definitivo de entrega.

## Resultado informado e limites

O builder relata 13/13 na suíte dedicada, regressões focadas 33/33, auth 22/22, gateway 15/15 e Chat 32/32. A suíte completa falhou: 157/170, com 13 falhas em chat-routes e outbound-idempotency. O log de depois e o log da suíte completa foram localizados e seus hashes conferem. Nenhum resultado foi reexecutado nesta conversa.

A explicação de fixtures sem setor/assignee incompatíveis com D-C02-3 é hipótese do builder a confirmar pelos casos e logs, não aprovação automática de alteração de testes. Antes de ajustar fixtures, determinar quais cenários deveriam ter acesso e preservar testes que negam terceiros sem vínculo.

## Encaminhamento ao Agente 1

1. Registrar IMPLEMENTED recebido com integração pendente e reconciliar as duas divergências de integridade. Congelar candidato completo e evidências com versões identificadas.
2. Conferir as 13 falhas. Se são cenários positivos que exigem vínculo explícito por D-C02-3, redistribuir formalmente os dois arquivos de teste ao builder para ajustar somente as fixtures necessárias. Não conceder Admin indiscriminadamente nem alterar expectativas negativas para obter verde.
3. Revisar a decisão de contatos sem setor: a implementação permite acesso nessa condição; C02 D-C02-3 fala explicitamente de conversas. Não extrapolar aprovação para contatos sem verificar contrato e política de produto aplicáveis. Registrar decisão ou lacuna específica antes do aceite.
4. Incluir na revisão a autorização de contatos com múltiplos setores: o helper retorna 403 ao encontrar primeiro setor com read sem write; verificar o comportamento esperado quando outro setor permite write e se a ordem de sectorIds pode alterar a decisão. Isso é ponto de revisão por inspeção, não falha reproduzida.
5. Designar crítico fresco para o candidato estável e verificar matriz permissão/membership, revogação de membership em sessão ativa, 404/403, sem setor, recursos relacionados e credenciais de serviço. Cumprir regressão integrada; 170/170 é resultado a verificar, não previsão aceita.
6. Atualizar documentação e estado a cada correção/revisão. Não declarar integrado ou DONE enquanto houver falha aplicável ou condição aberta. Respeitar três agentes ativos e escritor único em runtime.

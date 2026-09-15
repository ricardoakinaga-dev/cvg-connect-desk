# Plano executivo — rodada R3

**Decisão recomendada: continuar desenvolvimento; não promover o candidato atual.** O processo realtime não inicia na CLI auditada, embora testes isolados passem. Além das provas operacionais pendentes, existem falhas de privacidade, recuperação, concorrência e fluxos de usuário.

## Objetivo e resultado esperado

Entregar um candidato que inicia pelos entrypoints reais, rejeita evidência inválida, preserva efeitos/dados sob falha e permite atendimento completo. Depois qualificá-lo com as mesmas imagens, integrações representativas, carga, restore e revisão independente. Documentação e logs devem permitir reproduzir a decisão de release.

## Investimento e prioridade

45 cartões, **284 pontos relativos**: 44 herdados com estimativas preservadas e3 pontos para PROD-44. Não são horas nem percentual de código faltante; recalibrar após primeira fatia aceita. Não há data de deploy inferida. Donos funcionais nos cartões precisam receber nomes no início da execução.

| Ordem | Entrega | Dono funcional | Sinal de resultado |
|---|---|---|---|
| Imediata | Baseline própria, bootstrap realtime e gate confiável | Integrador, runtime e plataforma | CLI/HTTP nativo passa; PROD05 volta a executar; novos adversariais recusados |
| Segurança e durabilidade | Privacidade legada, CAS obrigatório, IA órfã e pool de mídia | Backend/dados | Negativos reais de escopo/conflito/crash e lote50 progridem sem perda/duplicação |
| Operação do usuário | Inbox, timeline/mídia, tarefas/notas/alertas, memberships/admin/Kanban | Produto e frontend com API | Percurso completo e atualizado entre operadores, sem controles inertes |
| Qualificação | CI/imagens, observabilidade real, storage/scanner, carga, restore e a11y | Plataforma, QA e integrador | G01–G12 sustentados por evidência do mesmo candidato |
| Release | Revisão independente, pacote, autorização e piloto | Revisor, responsável release e operador | Decisão revisável; execução só sob autorização aplicável; SLO após deploy |

## Preservar entregas confirmadas

Manter Bearer fail-closed do handler, wiring de token, correções de retry/ACK e gates digest/comando/evento, recuperação de mídia já conectada, sessões opacas/outbox persistente, operações transacionais e melhorias existentes de UI. Os5 achados resolvidos continuam como regressões. O novo plano não autoriza apagar o worktree ou reconstruir o produto do zero.

## Governança e riscos

Fonte canônica: BACKLOG.json; cada cartão tem owner funcional, escrita permitida, locks, dependências, aceites, checks e recuperação. IMPLEMENTED não é DONE; fechar apenas após prova e revisão. Evidências atuais da auditoria são baseline, nunca resultado futuro pré-preenchido. Registrar falhas, skips e ausências com honestidade.

D01–D06 continuam abertas. Avançam correções seguras, fixtures, inventários e pacote; política de eliminação real, contrato relacional ambíguo, ferramentas IA habilitadas e condições de produção exigem decisão do responsável no ponto específico. Preparar proposta revisável antes de pedir essa decisão. [Registro e recomendações](DECISOES.md).

Maior risco técnico imediato: falsa confiança em Vitest/typecheck sem boot nativo. Maior risco de aceite: gate que aceita dados declarativos inválidos. Riscos de dados: bypass legado, escrita obsoleta e processamento perdido sob crash. Riscos de entrega: UI incompleta e infra ainda não exercitada. Todos têm tarefas e critérios no [backlog](BACKLOG.md).

## Conclusão exigida da rodada de implementação

PROD-00–40 e PROD-44 aceitos qualificam candidato; PROD-41 prepara pacote e decisão. PROD-42 implanta quando autorizado; PROD-43 mede estabilização. Não declarar produção pronta enquanto correção obrigatória, prova real ou decisão necessária estiver pendente. A auditoria R3 e sua crítica documental não substituem PROD-40.

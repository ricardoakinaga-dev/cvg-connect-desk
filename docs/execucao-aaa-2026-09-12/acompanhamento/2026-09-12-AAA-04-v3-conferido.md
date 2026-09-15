# AAA-04 v3 — conferência de entrega

Registro desta conversa em 12/09/2026; sem alteração de produto/runtime ou execução de suítes.

O manifesto `runtime/candidates/AAA-04/v3/candidate-files.txt` possui SHA-256 `96e20410f11b62dbed16d6eea8f7014facdb90e3a83a979ec21a6f08d11e6e2e`, correspondente ao retorno. A conferência calculou **11/11** arquivos correspondentes tanto no snapshot `v3/files/` quanto no worktree. O retorno suplementar em `/tmp/opencode/aaa-04-builder-return/RETORNO-AAA-04.md` confere com SHA-256 `ef33ca464e131c45ecca4c29db272e40052f83a648fa94e9b54d183a82d7ead5`.

Foram lidos RECONCILIACAO.md e D-AUTHZ-01-contatos.md. A reconciliação identifica bytes perdidos de v1, log temporário sobrescrito e reprodução controlada autoritativa de v2; essas limitações continuam históricas, não são revertidas pelo sucesso do v3.

O retorno registra v3 com 15/15 testes dedicados e 25 arquivos/172 testes na regressão serial. A reprodução negativa de nove casos cobre v2; os seis casos adicionais foram executados somente depois da alteração. Esta conferência não reexecutou resultados nem constitui revisão independente de produto.

Pendências de fechamento: crítico fresco avaliar v3 estável, mapa de requisitos/asserts, efeito dos vínculos múltiplos e permissões de ação; coordenador registrar ratificação de D-AUTHZ-01, incluindo alcance da política de contatos sem setor e coerência com as permissões globais. Se a decisão alterar materialmente o acesso autorizado em vez de preservar o comportamento já permitido, encaminhar a escolha ao responsável pelo produto, sem inventar aprovação.

Recomendação para a revisão: verificar caso discriminante da ordem de vínculos e, se a evidência for insuficiente, reproduzir no snapshot isolado a implementação anterior que falhava, preservando o candidato do builder. Não exigir nova execução integral sem mudança ou lacuna que a justifique.

Próxima ação do Agente 1: arquivar pacote suplementar com logs sanitizados/hashes, concluir revisão e decisão por versão, tratar achados e integrar o candidato efetivamente aceito. Depois selecionar a próxima tarefa pelas dependências verificadas. AAA-28 permanece etapa final do programa; não substitui a revisão pendente de AAA-04.

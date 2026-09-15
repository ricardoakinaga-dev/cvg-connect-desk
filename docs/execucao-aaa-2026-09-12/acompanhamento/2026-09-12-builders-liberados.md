# Agentes 2 e 3 — transferência e liberação recebidas

Conferência documental desta conversa em 12/09/2026. Nenhuma alteração em produto, runtime, contratos, serviços ou bancos.

O coordenador encaminhou transferência formal de AAA-04 ao Agente 3, aposentadoria do papel Agente 4 e liberação de AAA-06 ao Agente 2. Os prompts e despachos foram localizados e seus hashes calculados para comparação com o retorno.

## Encaminhamento vigente

- Agente 3: `runtime/dispatch/prompt-agente-3-correcoes.md`, vinculado ao cumulativo AAA-04-correcoes-v3. Entrega em `/tmp/cvg-aaa-returns/aaa-04-v5/`.
- Agente 2: `runtime/dispatch/prompt-agente-2-aaa06.md`, vinculado a AAA-06 e C08-AAA06. Entrega em `/tmp/cvg-aaa-returns/aaa-06/`.
- Agente 1: único escritor de runtime/contratos, arquiva os retornos e coordena revisão/integração. Máximo de três agentes ativos; crítico ocupa vaga liberada.

Os bloqueios anteriores por atribuição e ausência de documentos estão superados pelos registros novos. Builders devem ler os arquivos atuais e executar, sem repetir o diagnóstico já entregue. Não confundir prontidão para corrigir com implementação concluída.

## Limites preservados

O flake de contacts-routes tem causa e critério de aceite definidos, mas a correção e seus testes ainda pertencem ao builder: não considerá-lo tecnicamente resolvido apenas pela autorização. Não reproduzir a credencial sintética em logs ou novos documentos; obter configuração pelo mecanismo indicado no despacho.

AAA-04 continua sem integração enquanto achados impeditivos estiverem abertos. AAA-06 tem aceite local delimitado; testes sem Docker não certificam a imagem, compose ou proxy externo. Antes da revisão, preservar candidato completo por hash e trabalhar em cópia estável, sem mutação concorrente de arquivos/fixtures. AAA-05 continua dependente de AAA-04; AAA-28 permanece final do programa.

Próximo retorno esperado: IMPLEMENTED/BLOCKED/FAILED de cada builder, com evidências da execução, seguido da revisão e regressão do coordenador. Não emitir outro despacho de preparação para as mesmas tarefas.

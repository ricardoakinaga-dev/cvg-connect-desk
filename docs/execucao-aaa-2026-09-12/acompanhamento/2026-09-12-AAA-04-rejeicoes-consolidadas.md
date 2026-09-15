# AAA-04 — retornos conflitantes, integração não autorizada

Conferência desta conversa em 12/09/2026. Nenhum código, runtime ou ambiente alterado. Foram recebidos três relatos com versões, veredictos e IDs parcialmente conflitantes. Todos negam integração de AAA-04.

## Observação atual

O controlador lido registra `implemented-in-review`, candidato v4 de 18 casos (manifesto declarado `cfd70b6b…`), v3 rejeitada e H2/listagens pendente. O texto contém tanto PASS no recorte quanto REJECT e registros paralelos de v4. Não usar um campo PASS isolado como liberação.

O retorno também informa outra v4 de 24 casos, manifesto `2bebd852…`, rejeitada por crítico próprio. Rótulo v4 não identifica inequivocamente o artefato: cada revisão deve apontar para hash e snapshot preservado. Reconciliar o arquivo efetivamente presente com os dois registros, sem presumir que o snapshot de outra trilha continua recuperável.

O hash calculado do arquivo atualmente presente em `v4/candidate-files.txt` é `2bebd852ab1380511fda493fa9492cf5fabb1aca38df9dbd55c987e8e48b5f83`, divergente do `cfd70b6b…` declarado pelo estado lido. Confirmada a inconsistência entre ponteiro operacional e manifesto, sem inferir qual trilha deve prevalecer.

O despacho `runtime/dispatch/AAA-04-correcoes-v2.md` existe e redistribui application/infrastructure de tasks/alerts/contacts. Seu foco explícito é H2. Antes de novo trabalho, o coordenador deve consolidá-lo com bypass de notes/task-ref, start-conversation e os demais achados aplicáveis. A redistribuição atual não retroage para transformar escrita anterior fora de escopo em previamente autorizada; preservar a ocorrência e incluir o arquivo no candidato integral.

## Correções a consolidar

- Listagens GET tasks/alerts/contacts: filtrar dados por autorização, inclusive vínculos indiretos, segundo decisão vigente.
- POST notes com `referenceType: task` e `referenceId`: resolver task/recurso real no servidor e negar vínculos não autorizados.
- start-conversation: autorizar contato, setor solicitado e eventual conversa existente antes de retornar dados ou criar recursos.
- Detalhe de contato: verificar filtragem de conversas/últimas mensagens, sem considerar correção alegada como aceite independente.
- Multi-setor: provar decisão independente da ordem com caso discriminante controlado, não depender da ordem incidental de linhas no banco.
- Manifesto: incluir contact.repository e todos os demais arquivos reais, com escopo formal atribuído e snapshots completos.
- Evidência: antes controlado por caso/requisito, manifesto da variante e restauração verificável; JSON real do dry-run; regressões ligadas ao hash final. Flake não se resolve apenas por rerun verde: preservar falha, classificação e condição de aceite aplicável.

## Controle de execução e próxima instrução ao Agente 1

Manter um único coordenador escrevendo estado/contratos e um único builder no escopo. Outros participantes entregam seus retornos em área própria ou temporária, sem editar o candidato do builder. Resolver IDs duplicados por novos IDs e tabela de correspondência append-only; preservar os registros originais.

Escolher snapshot base inequívoco, arquivar as duas v4 se os bytes existirem e marcar ausência quando não existirem. Emitir um único despacho cumulativo para a próxima versão, sem repetir numeração existente. O builder corrige e testa; depois o crítico revisa cópia estável, com fingerprint, sem mutações concorrentes nos arquivos ou fixtures utilizados. Só integrar após fechar achados impeditivos e validar o candidato aprovado.

AAA-05 continua dependente de AAA-04. AAA-06 é possibilidade de trabalho paralelo, não liberação comprovada nesta conferência: seu cartão depende de AAA-01; verificar contrato específico, escopo/compose e ambiente antes do despacho. AAA-28 depende das outras 31 tarefas; não exige a si própria como predecessor e não substitui a revisão atual.

O cartão AAA-06 declara C02 e C08. Portanto, a liberação parcial anterior de AAA-01 para auth/Chat-Gateway não comprova por si só a prontidão de AAA-06; conferir e resolver C08 antes de liberar seu consumidor.

# Retornos AAA-04/AAA-06 — desbloqueio de atribuição

Conferência desta conversa em 12/09/2026. Não altera runtime, contratos, código ou serviços.

## Fatos conferidos

- O cumulativo AAA-04-correcoes-v3 existe e COORDINATION.md escolhe v4-b como base, preservando as perdas e versões anteriores.
- ownership.json ainda atribui código de AAA-04 ao agente-4 e descreve agente-3 como sem escrita ativa. Isso diverge da distribuição solicitada nesta conversa (Agente 1 coordena, Agente 2 prepara AAA-06, Agente 3 corrige AAA-04).
- O cumulativo proíbe runtime/**, mas solicita inventário em runtime/returns/. Resolver a contradição: builder entrega em diretório temporário exclusivo; Agente 1 arquiva em runtime.
- O pacote de preparação de AAA-06 existe, com oito arquivos. C08 não aparece na listagem de contratos congelados. Entrega reconhecida como preparação, sem revisão integral da solução nesta conferência e sem liberação de implementação.
- Atividade do PID informado e escrita em snapshots não comprovam, isoladamente, writer concorrente no código. O impedimento de ownership é concreto; concorrência no código deve ser verificada por caminho e responsável, não por percentual de CPU.

## Instrução ao coordenador

Priorizar a transferência formal do papel builder AAA-04 ao Agente 3, conforme a atribuição do usuário. Encerrar a atribuição anterior no escopo, identificar sessão/run e conferir ausência de escrita conflitante sem encerrar processos alheios. Atualizar ownership, coordenação, despacho e prompt de forma coerente, preservando histórico.

Definir entrega temporária por run para logs/inventário; manter runtime sob escritor único. Incluir formalmente contacts-routes.integration.test.ts para correção mínima da fixture se confirmada a causa do flake. Aceite deve provar não colisão por construção, manter as asserções e incluir repetição focada justificada; definir quantidade antes da verificação, sem substituir correção da causa por tentativas até passar.

Confirmar exclusividade do banco atribuído durante execução e revisão, marcador e fornecimento da credencial sintética de serviço sem expô-la em documentos/logs. Identificar base v4-b por manifesto e anexo do repositório omitido; próximo manifesto deve incluir todos os arquivos autorizados. Não exigir que o builder descubra novamente as regras já definidas no cumulativo.

Depois, revisar a preparação de AAA-06, decidir/congelar C08 no recorte necessário e emitir despacho para o Agente 2 com arquivos exatos e ambiente. Preservar a separação da dívida global de build AAA-14: não incluir troca ampla de instalação/lockfile em AAA-06 sem necessidade demonstrada e redistribuição. Explicitar comportamento DEV, origem pública, ws/wss, nginx/proxy e overrides. Teste equivalente sem Docker só atende as fronteiras que exercita; não certificar imagem/compose que não rodou.

Entregar dois prompts de retomada vinculados aos registros realmente atualizados. O limite é três agentes ativos incluindo o coordenador; crítico ocupa uma vaga quando um builder estiver ocioso. Não criar novo Agente 4 como quarta sessão.

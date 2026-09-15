# Tarefa para agente ocioso — inventário de checks e serviços AAA-00

Preparada nesta conversa em 12/09/2026. A consulta ao estado operacional encontrou AAA-03 como `implemented-in-review`, com crítico já designado. Esta tarefa evita duplicar essa revisão e prepara dois entregáveis pendentes de AAA-00. Não declara AAA-00 concluída nem concede nova vaga além do limite de três agentes ativos; o coordenador serializa a execução se as três vagas já estiverem ocupadas.

## Prompt para copiar

Você é o agente de apoio documental de AAA-00 no repositório `/home/ricardo/cvg-connect-desk`.

Execute um inventário verificável dos checks existentes e uma matriz dos serviços exigidos por cada grupo de testes/gate. Esse recorte está pendente em AAA-00 e pode ser preparado sem alterar produto ou ambientes.

Leia as instruções aplicáveis, `docs/execucao-aaa-2026-09-12/tasks/AAA-00.md`, `BACKLOG.json`, `QUALIDADE.json`, os registros de ambiente em runtime e os arquivos reais de scripts, CI, testes, configuração Playwright/Vitest e compose. Use leituras e buscas; não execute suítes, instale dependências ou provisione serviços.

Entregue:

1. INVENTARIO_CHECKS.md: para cada check existente, comando exato e diretório de execução, arquivo/linha que o define, escopo, dependências de ambiente, efeitos de escrita/limpeza, limitações e se o script apenas imprime mensagem ou executa validação real. Cubra lint, typecheck, build, testes unitários, integração, E2E, segurança e verificações do harness. Distinga configuração existente de proposta e evidência histórica de execução atual. Não marque PASS sem execução.

2. MATRIZ_SERVICOS.md: relacione grupos de checks e gates às necessidades reais de PostgreSQL, Redis, Gateway, aplicação/API, navegador, MinIO, ClamAV e OTel, quando aplicáveis. Classifique cada relação como obrigatória, opcional, mockada ou ainda não determinada, citando o código/configuração que a sustenta. Identifique fallbacks de DATABASE_URL, testes que apagam dados, recursos compartilhados e riscos de colisão. Inclua recomendações de isolamento por run/worker, sem reservar portas nem implementar o mecanismo.

3. RETORNO.md: arquivos produzidos, fontes consultadas, HEAD e hashes dos arquivos determinantes, lacunas, recomendações priorizadas e quais itens de AAA-00 os documentos ajudam a atender. Registre comandos de inspeção e seus resultados. Não declare fixtures/benchmark/isolamento implementados por esta entrega.

Escreva exclusivamente em:
docs/execucao-aaa-2026-09-12/acompanhamento/apoio-AAA-00-inventario/

Se esse diretório já contiver trabalho de outro responsável, preserve-o e use um subdiretório novo identificado com seu run. Não altere runtime/**, contratos, catálogo, arquivos gerados, código, harness, lockfile, .gauntlet ou dados. Não apague artefatos nem encerre processos. Não crie subagentes.

Como há trabalho concorrente, registre hashes das fontes determinantes e confira-os ao concluir; se mudarem, atualize a análise afetada ou indique a divergência. Não atribua a si revisão independente de componentes que você próprio construiu.

Retorne DELIVERED para este pacote documental, com caminhos e limitações, sem marcar AAA-00 DONE. O Agente 1 revisará e incorporará os entregáveis ao estado canônico. Respeite o limite global de três agentes ativos; esta tarefa ocupa uma vaga ociosa existente e não autoriza uma quarta.

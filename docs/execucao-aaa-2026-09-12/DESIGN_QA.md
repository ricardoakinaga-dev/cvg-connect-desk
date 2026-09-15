**Direção visual e matriz de QA — C09**

Tese: uma mesa de atendimento CVG em que o operador identifica prioridade, responde, recupera erros e mantém contexto com pouco esforço. Preservar “Pulso Operacional”, logo/arquivos existentes, paleta e sistema tipográfico como ponto de partida; conferir integridade e procedência. O trabalho é evolução funcional e visual do produto existente. Não usar novas ferramentas de geração ou assets decorativos como requisito herdado de pedidos históricos.

A barra antiga `docs/design/cvg-quality-bar.json` contém baselines de versões anteriores. Revalidá-los em AAA-00/20; não assumir que defeitos de layout ali descritos ainda existem. `QUALIDADE.json` é a barra deste programa; o documento antigo continua histórico. Nenhuma tela foi renderizada para este plano; todos os gates visuais do produto estão NOT_VERIFIED.

**Matriz de rotas, sem amostragem seletiva**

| Dono | Rotas/páginas | Estados adicionais |
|---|---|---|
| AAA-20 | Shell comum | Menu móvel aberto/fechado, foco/restauração, logout, conectividade real |
| AAA-21 | `/login`, `/inbox`, `/dashboard` | Credenciais inválidas; Inbox lista/conversa/contexto/busca/anexo/pending/retry/offline/reconnect/sessão expirada/forbidden; Dashboard parcial/degradado |
| AAA-29 | `/contacts`, `/tutors`, `/patients`, `/notes` | Cadastro, vínculo, validação, edição, falha de salvamento, autoria e foco |
| AAA-30 | `/tasks`, `/alerts`, `/sectors`, `/labels`, `/contact-groups`, `/kanban` | Transições, confirmação, empty real, ação negada, scroll contido; movimento Kanban por teclado/toque |
| AAA-31 | `/admin`, `/audit`, `/settings` | Permissões, mudança/revogação, filtro, estado vazio, erro de leitura/escrita |

São **16 rotas de página**, mais redirecionamento `/` e deep-link de conversa. Todas: normal, loading, empty quando aplicável, erro/retry, conteúdo longo e foco. Modais/drawers/disabled/partial/forbidden/success conforme comportamento existente. N/A exige motivo documentado antes da rodada; não pode ser usado depois para esconder falha. A matriz final enumera cada combinação aplicável em JSON/CSV, com fixture, viewport, revisão, resultado e caminho de evidência. Capturas de todas as rotas em normal em cinco viewports são obrigatórias; estados adicionais de cada rota são observados em desktop e no menor viewport aplicável, além de tablet quando o layout/controle difere.

Viewports: **375×812, 390×844, 768×1024, 1024×768, 1440×900**; testar em torno dos breakpoints existentes de 860 e 1260 CSS px. Captura na resolução nativa, DPR registrado, fonte carregada, fixture sintética estável, console/network limpos de falhas inesperadas. Cobrir teclado virtual, orientação e safe areas quando aplicáveis. Não usar screenshot de HTML mockado para aprovar auth/upload/realtime.

**Interação e acessibilidade.** Automação mais inspeção manual: teclado completo, nome dos controles, foco visível/não encoberto, Escape, restauração de foco, elementos ocultos fora da navegação, erros anunciados, zoom 200% e reflow dedicado, reduced-motion inclusive rolagem JS, contraste real e leitura assistiva dos percursos críticos. O alvo normativo é WCAG 2.2 AA, incluindo critérios aplicáveis de contraste, reflow, interação, foco, nome/papel/valor e mensagens de status; conformidade não é inferida de uma pontuação de ferramenta. [Fonte W3C](https://www.w3.org/TR/WCAG22/).

Alvo ergonômico interno: controles primários de toque com área de 44×44 CSS px quando compatível com densidade; não apresentar esse alvo como requisito universal de AA. Status nunca só por cor. Inbox não pode saltar automaticamente para o fim enquanto o operador lê histórico nem apagar um novo rascunho quando uma resposta antiga chega. Deep-link fora da primeira página precisa continuar acessível sob autorização.

**Desempenho de experiência.** Orçamentos v1: JS inicial gzip <=120 KiB e CSS gzip <=25 KiB; LCP <=2,5 s, INP <=200 ms e CLS <=0,1, com perfil de dispositivo/rede fixado antes da medição. Os limiares de Web Vitals são referência de experiência; medição local não substitui dados de campo no percentil 75. [Fonte Web Vitals](https://web.dev/articles/vitals). Em ensaio local, registrar três execuções, distribuição e pior resultado; sem amostra de campo, declarar essa limitação em vez de alegar SLO observado.

**Rubrica visual de aceitação.** Usar dimensões e pesos controlados abaixo, cada uma 0–10; nota = 100 × soma(peso × nota/10) / soma(pesos aplicáveis). Pesos somam 93 neste conjunto. `Reference fidelity` fica N/A pois não há reconstrução de screenshot requerida; se virar requisito, versionar barra antes de execução. Nenhuma dimensão pode ganhar nota neutra para elevar média.

| Dimensão | Peso |
|---|---:|
| Hierarchy | 8 |
| Typography | 7 |
| Spacing/layout | 7 |
| Color | 5 |
| Consistency | 6 |
| Usability | 10 |
| Responsiveness | 8 |
| Accessibility | 10 |
| Brand/identity | 10 |
| Polish | 5 |
| Asset quality | 4 |
| Interaction quality | 4 |
| Information density | 4 |
| Product specificity | 5 |

Cada nota precisa de observação por rota/estado/região. Faixa 9–10 exige desempenho excelente observado; source code sozinho não sustenta essa nota. O candidato AAA visual exige >=95, confiança HIGH, sem Critical/High aberto, identidade e verdade do produto preservadas, matriz e interações completas.

Dois críticos frescos recebem versões A/B em ordem aleatória, sem notas anteriores, resultado desejado ou justificativa do builder. Registrar o mapeamento A/B somente com o lead; terceiro fresco adjudica se divergirem. Um crítico final distinto inspeciona o conjunto integrado após correções. Registrar hash antes/depois da inspeção; crítico não modifica artefato. Sem render ou revisão independente, visual AAA permanece NOT_ELIGIBLE.

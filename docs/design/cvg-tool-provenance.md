# CVG — proveniência das ferramentas visuais

Capturado em 12/09/2026. Este registro separa artefatos locais de projetos mantidos por ferramentas externas.

## OpenDesign

- Projeto editável: `cvg-connect-desk-pulso-operacional-2026`.
- Execução concluída com sucesso: `10a7b6f5-445a-447c-bd18-ca64dee784ed`.
- Solicitação atribuída: `56fe5a97-b0e4-4874-9dde-ad6ec4d6ea99`.
- Artefato de entrada produzido: `prototype.html`, renderizado pelo projeto OpenDesign local.
- Preview observado durante a execução: `http://127.0.0.1:43619/api/projects/cvg-connect-desk-pulso-operacional-2026/raw/prototype.html`.
- Reinspeção independente por HTTP local em 12/09/2026: `200 OK`, `prototype.html` com 53.066 bytes e SHA-256 `9cfb062450506dc11a8dffa659a6f32218584347e1991d7e8d8af2fc57ed6164`. O HTML contém tokens, shell, Inbox, Dashboard, drawer e breakpoints editáveis; a URL acima permanece diretamente auditável enquanto o daemon local estiver ativo.
- Uso no produto: direção para hierarquia, shell operacional, ritmo de superfícies e composição responsiva; o código de produção foi implementado no repositório React, não importado cegamente.
- Estado da conexão na auditoria final: transporte local encerrado após a execução bem-sucedida. O projeto permanece externo ao Git; os identificadores acima preservam a trilha auditável sem fingir uma nova consulta.

## ComfyUI

- Execução selecionada: `3918eea1-f5e9-42d6-b320-c30f3fda718f`.
- Saída local: `apps/desk-web/public/assets/visual/cvg-water-texture.webp`.
- SHA-256: `bed1e38456509c54acbf591abbd652c6b24f88e53678701caa2014a32e010fec`.
- Uso: textura atmosférica decorativa, sem texto, logo ou cruz; a interface mantém fallback em CSS.

## Blender

- Mecanismo: Blender MCP em modo CLI/background, usado porque a sessão interativa recusou conexão.
- Fonte editável: `docs/design/source/cvg-orbit-pulso.blend`.
- SHA-256 da fonte: `8710272ca73c4f763b9c4e345a876578542507189a6433ec43f1d1fbc6d7a963`.
- Render local: `apps/desk-web/public/assets/visual/cvg-orbit-pulso.webp`.
- SHA-256 do render: `28ad713bf93d630afcba881283aed7edd75e3c5b43c3aa8c8f48cbe0e9eb535f`.
- Verificação MCP final: `status=succeeded`, cena `Scene`, 10 objetos, motor `BLENDER_EEVEE`, resolução-fonte 768×768.
- Uso: escultura abstrata decorativa no login amplo; ocultada em larguras restritas e dispensável ao conteúdo.

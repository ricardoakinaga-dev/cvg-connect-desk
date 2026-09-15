# Crítica documental I1 — passagem 02

**Crítico:** `/root/r3_final_docs_critic_2` · **contexto:** `fork_turns: none` · **modo:** somente leitura.  
**Veredito formal:** `INVALID / REJECT` · **severidade máxima:** HIGH · **confiança:** 0,99.

Durante a inspeção, uma execução concorrente mudou SA-017 de `REWORK` para `IMPLEMENTED` e promoveu SA-013/SA-015, sem regenerar todas as projeções e manifestos. A passagem também encontrou:

- narrativa R2.3 que dizia ter restaurado estados com revisões existentes, embora SA-017 não possuísse artefato I1 final;
- caminho incorreto para o resultado de SA-017;
- linguagem divergente entre `NOT_RUN` e “sem veredito coletivo” para gates não executados;
- V13 contraditório porque o verificador tentou ler o próprio JSON enquanto o redirecionamento o escrevia.

As promoções concorrentes foram reabertas sem descartar código ou prova. SA-017 permanece `REWORK / PENDING_REVIEW`, o caminho foi corrigido, os gates foram uniformizados e V13 passou a ser gerado atomicamente depois de computar o resultado em memória.

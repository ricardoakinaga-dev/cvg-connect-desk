#!/usr/bin/env python3
"""Valida e renderiza o programa documental. Não executa produto nem certifica release."""
from pathlib import Path
import argparse, collections, hashlib, json, sys
ROOT = Path(__file__).resolve().parent
STATES = {'PLANNED','READY','RUNNING','IMPLEMENTED','REVIEW','VERIFIED','DONE','REWORK','BLOCKED'}
def read():
    return json.loads((ROOT/'BACKLOG.json').read_text()), json.loads((ROOT/'REQUISITOS.json').read_text())['requirements']
def validate(backlog, requirements):
    errors=[]; tasks=backlog.get('tasks',[]); ids=[t['id'] for t in tasks]; by={t['id']:t for t in tasks}
    reqids={r['id'] for r in requirements}; covered=set(); active=set(); seen=set()
    if len(ids)!=len(set(ids)): errors.append('IDs de tarefa duplicados')
    if len(reqids)!=59: errors.append('Catálogo deve preservar48 itens + 11 dimensões UX')
    for r in requirements:
        if r.get('target_score',0)<95: errors.append('Meta reduzida: '+r['id'])
    for t in tasks:
        if t.get('status') not in STATES: errors.append('Estado inválido: '+t['id'])
        if t.get('estimate_points',0)<=0: errors.append('Estimativa inválida: '+t['id'])
        for field in ('objective','ownership','verification','gates','evidence_dir','next_action'):
            if not t.get(field): errors.append(f'{t["id"]}: falta {field}')
        if len(t.get('acceptance',[]))<3: errors.append('Aceites insuficientes: '+t['id'])
        if len({a['id'] for a in t.get('acceptance',[])})!=len(t.get('acceptance',[])): errors.append('AC duplicado: '+t['id'])
        if not all(a.get('criterion') and a.get('required') is True for a in t.get('acceptance',[])): errors.append('AC vazio/opcional: '+t['id'])
        if set(t.get('requirements',[]))-reqids: errors.append('Requisito desconhecido: '+t['id'])
        if t.get('kind')=='delivery': covered.update(t.get('requirements',[]))
        for d in t.get('dependencies',[]):
            if d not in by: errors.append(f'Dependência inexistente: {t["id"]} -> {d}')
        if t['status'] in {'READY','RUNNING','IMPLEMENTED','REVIEW','VERIFIED','DONE'}:
            if any(by.get(d,{}).get('status')!='DONE' for d in t['dependencies']): errors.append('Dependência não concluída: '+t['id'])
        if t['status'] in {'VERIFIED','DONE'}:
            if t.get('evidence_state')!='CURRENT' or not t.get('review_ref') or not t.get('evidence'): errors.append('Estado terminal sem prova/revisão: '+t['id'])
            for ref in (part.strip() for part in t.get('review_ref','').split(';')):
                if ref and not (ROOT/ref).is_file(): errors.append('Revisão ausente: '+t['id']+' -> '+ref)
            for e in t.get('evidence',[]):
                p=ROOT/e.get('path','')
                if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=e.get('sha256'): errors.append('Evidência ausente/divergente: '+t['id'])
    def visit(i):
        if i in active: errors.append('Ciclo: '+i); return
        if i in seen or i not in by:return
        active.add(i)
        for d in by[i]['dependencies']:visit(d)
        active.remove(i);seen.add(i)
    for i in by:visit(i)
    if reqids-covered:errors.append('Sem executor: '+','.join(sorted(reqids-covered)))
    findings={a for t in tasks if t.get('kind')=='delivery' for a in t.get('findings',[])}
    if {f'A{i:02}' for i in range(1,11)}-findings:errors.append('Achado sem executor')
    gates={g for t in tasks if t.get('kind')=='delivery' for g in t.get('gates',[])}
    if {f'G{i:02}' for i in range(1,13)}-gates:errors.append('Gate sem produtor')
    if any(t['id'] not in by.get('SA-059',{}).get('dependencies',[]) for t in tasks if t.get('kind')=='delivery'):errors.append('Revisão final não depende de toda entrega')
    if by.get('SA-061',{}).get('dependencies')!=['SA-060'] or by.get('SA-062',{}).get('dependencies')!=['SA-061']:errors.append('Ordem release/estabilização inválida')
    return errors

def render(backlog,reqs):
    tasks=backlog['tasks']; by={t['id']:t for t in tasks}
    lines=['# Backlog executivo','', '**Fonte canônica:** [BACKLOG.json](BACKLOG.json). Este arquivo e os cartões são projeções geradas por `python3 programa.py render`; alterar conteúdo/status no JSON e regenerar. Evidências de execução permanecem em registros próprios.','', '| ID | Entrega | Prioridade | Frente | Marco | Pontos | Dependências | Estado |','|---|---|---|---|---|---:|---|---|']
    for t in sorted(tasks,key=lambda x:x['id']):
        lines.append(f'| [{t["id"]}](tasks/{t["id"]}.md) | {t["title"]} | {t["priority"]} | {t["lane"]} | {t["milestone"]} | {t["estimate_points"]} | {", ".join(t["dependencies"]) or "—"} | {t["status"]} |')
        c=[f'# {t["id"]} — {t["title"]}', '', f'**Estado:** {t["status"]} · **Prioridade:** {t["priority"]} · **Frente:** {t["lane"]} · **Marco:** {t["milestone"]} · **Estimativa relativa:** {t["estimate_points"]} pontos.', '', 'Projeção do [backlog canônico](../BACKLOG.json). Não editar este cartão diretamente.', '', '## Resultado esperado', '', t['objective'], '', '## Entrada e rastreabilidade', '', f'- Requisitos: {", ".join(t["requirements"]) or "Todos na revisão final"}. Consultar [rastreabilidade](../RASTREABILIDADE.md).', f'- Achados: {", ".join(t["findings"]) or "Evolução/preservação das capacidades e fechamento de evidência"}.', f'- Gates: {", ".join(t["gates"])}.', '- Dependências: '+(', '.join(f'[{d}]({d}.md)' for d in t['dependencies']) or 'nenhuma'), '', '## Área de atuação e exclusões', '']
        c.extend('- '+p for p in t['ownership'])
        c.extend(['', 'Antes de atuar, obter reserva das fontes e dos recursos no registro do lead. Caminhos amplos indicam superfície de investigação: reservar arquivos concretos antes de escrever. Não alterar contratos compartilhados, lockfile, schema/migrações ou fixtures comuns sem dono único. Não reverter trabalho alheio.', '', '## Critérios de aceite obrigatórios', ''])
        c.extend(f'- **{a["id"]}:** {a["criterion"]}' for a in t['acceptance'])
        c.extend(['','## Procedimentos de verificação',''])
        c.extend(f'{i}. {v}' for i,v in enumerate(t['verification'],1))
        c.extend(['','Os procedimentos descritos como criar/adicionar são entregáveis desta tarefa, não comandos já disponíveis nem provas executadas. Inspecionar scripts existentes antes de rodar. Escritas de teste usam exclusivamente o runner isolado de SA-003.','', '## Decisões e autorização', ''])
        c.extend([f'- **{d["id"]}:** {d["boundary"]}' for d in t['decisions']] or ['Sem decisão de produto adicional identificada para a entrega local. Conferir a autorização vigente e possíveis efeitos externos antes de executar.'])
        c.extend(['','## Evidências e conclusão','',f'Estado atual da evidência: **{t["evidence_state"]}**. Destino: `{t["evidence_dir"]}`. Registrar candidato, comandos/exits, cenário, estado antes/depois, artefatos/hashes e limitações.','', 'IMPLEMENTED não significa DONE: exigir revisão sem autoria, regressão relevante e integração ao candidato. Aceites, contratos e G01–G12 prevalecem sobre nota. Atualizar [BACKLOG.json](../BACKLOG.json), evidências e [ExecPlan](../PLANO-EXECUTIVO.md), nessa ordem.','', '## Próxima ação e recuperação','',f'**{t["next_action"]["id"]}:** {t["next_action"]["instruction"]}', '',t['recovery'], ''])
        (ROOT/'tasks'/f'{t["id"]}.md').write_text('\n'.join(c))
    lines.extend(['',f'**Total:** {len(tasks)} tarefas, {sum(t["estimate_points"] for t in tasks)} pontos relativos. Não são horas nem datas prometidas.',''])
    (ROOT/'BACKLOG.md').write_text('\n'.join(lines))
    trace=['# Rastreabilidade completa', '', 'As 48 notas e 11 dimensões UX do relatório têm executores de melhoria, além da revisão independente SA-059. Planejamento não altera notas atuais.','', '| ID | Item | Baseline | Meta | Executores |','|---|---|---:|---:|---|']
    for r in reqs:
        owners=[t['id'] for t in tasks if t['kind']=='delivery' and r['id'] in t['requirements']]
        trace.append(f'| {r["id"]} | {r["name"]} | {r["baseline_score"]} | ≥{r["target_score"]} | '+', '.join(f'[{i}](tasks/{i}.md)' for i in owners)+' |')
    for field,title,values in [('findings','Achados A01–A10',[f'A{i:02}' for i in range(1,11)]),('gates','Gates G01–G12',[f'G{i:02}' for i in range(1,13)])]:
        trace.extend(['',f'## {title}','', '| ID | Produtores / executores |','|---|---|'])
        for v in values:trace.append('| '+v+' | '+', '.join(f'[{t["id"]}](tasks/{t["id"]}.md)' for t in tasks if t['kind']=='delivery' and v in t[field])+' |')
    (ROOT/'RASTREABILIDADE.md').write_text('\n'.join(trace)+'\n')

def summary(backlog,reqs):
    ts=backlog['tasks']; by={t['id']:t for t in ts}; cache={}
    def length(i):
        if i not in cache:
            pred=max((length(d) for d in by[i]['dependencies']),default=(0,[]),key=lambda x:x[0]); cache[i]=(pred[0]+by[i]['estimate_points'],pred[1]+[i])
        return cache[i]
    ready=[t['id'] for t in ts if t['status'] in {'PLANNED','READY','REWORK'} and all(by[d]['status']=='DONE' for d in t['dependencies'])]
    return {'task_count':len(ts),'requirement_count':len(reqs),'points':sum(t['estimate_points'] for t in ts),'states':dict(collections.Counter(t['status'] for t in ts)), 'dependency_eligible':ready,'weighted_dependency_path':length('SA-062'),'warning':'Elegibilidade por dependências não verifica decisões, reservas de arquivos, ambiente ou autoridade. Validação do plano não certifica produto.'}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('command',choices=['validate','render','next']);args=p.parse_args()
    b,r=read();errors=validate(b,r)
    if errors:
        print(json.dumps({'valid':False,'errors':errors},ensure_ascii=False,indent=2));return 1
    if args.command=='render':render(b,r)
    print(json.dumps({'valid':True,**summary(b,r)},ensure_ascii=False,indent=2));return 0
if __name__=='__main__':sys.exit(main())

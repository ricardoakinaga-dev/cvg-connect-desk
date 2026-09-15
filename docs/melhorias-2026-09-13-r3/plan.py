#!/usr/bin/env python3
"""Validate planning structure and render documentation; never execute product tasks."""
import hashlib
import json
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent

def validate(data, notes):
    tasks = data['tasks']
    ids = [t['id'] for t in tasks]
    assert len(ids) == len(set(ids)), 'duplicate task'
    known = set(ids)
    audit = {n['id'] for n in notes}
    covered = set()
    for t in tasks:
        assert t['dependencies'] and t['id'] != 'PROD-00' or t['id'] == 'PROD-00', 'missing dependency'
        assert set(t['dependencies']) <= known, 'unknown dependency'
        assert t['id'] not in t['dependencies'], 'self dependency'
        assert t['effort_points'] > 0, 'invalid points'
        assert t['acceptance'] and all(a['requirement'].strip() for a in t['acceptance']), 'missing acceptance'
        assert len({a['id'] for a in t['acceptance']}) == len(t['acceptance']), 'duplicate acceptance'
        assert t['ownership'] and t['checks'] and t['next_action']['summary'], 'incomplete task'
        assert all(not Path(f).is_absolute() and '..' not in Path(f).parts for f in t['ownership']), 'unsafe ownership'
        assert set(t['audit_items']) <= audit, 'unknown audit item'
        if int(t['id'][-2:]) < 40:
            covered.update(t['audit_items'])
        if t['status'] == 'DONE':
            assert t['evidence_refs'], 'DONE without evidence'
    assert covered == audit, f'uncovered audit items: {sorted(audit-covered)}'
    pending = {t['id']: set(t['dependencies']) for t in tasks}
    done = set()
    while pending:
        ready = [k for k,v in pending.items() if v <= done]
        assert ready, 'dependency cycle'
        for k in ready:
            done.add(k)
            del pending[k]
    return f"VALID: {len(tasks)} tasks; {sum(t['effort_points'] for t in tasks)} relative points; {len(audit)} audit items; acyclic dependencies. Planning structure only."

def render(data, notes):
    tasks=data['tasks']
    index=['# Backlog de produção', '', '**Fonte canônica:** [BACKLOG.json](BACKLOG.json). Revisão R3: preserve as entregas descritas em cada cartão. Status deste ciclo começa PLANNED; checks NOT_RUN/TO_CREATE exigem descoberta e execução segura. As evidências recebidas são históricas.', '', '| Tarefa | Prioridade | Marco | Pontos restantes | Dependências |', '|---|---|---|---|---|']
    for t in tasks:
        tid=t['id']
        index.append(f"| [{tid} — {t['title']}](tasks/{tid}.md) | {t['priority']} | {t['milestone']} | {t['effort_points']} | {', '.join(t['dependencies']) or '—'} |")
        lines=[f"# {tid} — {t['title']}", '', f"**Estado:** {t['status']} · **Prioridade:** {t['priority']} · **Marco:** {t['milestone']} · **Estimativa relativa:** {t['effort_points']}", '', f"**Dono funcional:** {t['role']} · **Risco:** {t['risk']} · **Classe:** {t['release_class']}", '', '**Itens auditados:** '+', '.join(t['audit_items']), '', '**Dependências:** '+(', '.join(f'[{x}]({x}.md)' for x in t['dependencies']) or 'Nenhuma; ponto de partida.'), '', '**Decisões:** '+(', '.join(t['decision_refs']) or 'Sem decisão externa específica; verificar contratos e ambiente.'), '', '## Escopo de escrita', '', 'Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.', '', *[f'- `{f}`' for f in t['ownership']], '', '**Locks:** '+(', '.join(t['locks']) or 'Aplicar exclusão por arquivos e recursos do ambiente.'), '', '## Critérios de aceite', '']
        lines[2:2]=['**Observação da auditoria:** '+t['current_observation'], '', '**Tratamento:** '+t['execution_type']+' · '+t['baseline_assessment'], '', '**Achados:** '+(', '.join(t['audit_findings']) or 'Sem achado individual; completar/revalidar os aceites.'), '', '**Origem:** '+t['origin']['program']+' / '+t['origin']['task']+' / estado recebido '+t['origin']['submitted_status'], '']
        lines += [f"- **{a['id']}** — {a['requirement']}" for a in t['acceptance']]
        lines += ['', '## Verificação proposta', '']
        for c in t['checks']:
            lines += [f"Estado: **{c['status']}**. Ambiente: {c['environment']}.", '', c['expected'], '']
            if c['command']: lines += ['```bash',c['command'],'```','']
        lines += ['Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.', '', '## Próxima ação', '', t['next_action']['summary'], '', '**Sinal de conclusão da ação:** '+t['next_action']['completion_signal'], '', '## Recuperação', '', t['rollback'], '', '## Evidência e fechamento', '', 'Evidências: '+(', '.join(t['evidence_refs']) or 'Ainda não produzidas para esta execução.'), '', 'Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.']
        (BASE/'tasks'/f'{tid}.md').write_text('\n'.join(lines)+'\n')
    (BASE/'BACKLOG.md').write_text('\n'.join(index)+'\n')
    lines=['# Rastreabilidade da auditoria', '', 'Os 55 itens têm tarefas executoras antes de PROD-40. A revisão final de todos os itens é adicional e não conta como implementação. Notas abaixo são históricas, não progresso do backlog.', '', '| Item | Descrição auditada | Nota histórica | Tarefas executoras |', '|---|---|---|---|']
    for n in notes:
        owners=[t for t in tasks if int(t['id'][-2:])<40 and n['id'] in t['audit_items']]
        lines.append(f"| {n['id']} | {n['item'].replace('|','/')} | {n['nota']} | "+', '.join(f"[{t['id']}](tasks/{t['id']}.md)" for t in owners)+' |')
    lines += ['', '## Achados históricos reavaliados e novos (RESOLVED exige apenas preservar regressões)', '', '| Achado | Tarefas responsáveis |', '|---|---|']
    findings=json.loads((BASE/data['findings_source']).read_text())
    for f in findings:
        owners=[t for t in tasks if f['id'] in t['audit_findings']]
        lines.append('| '+f['id']+' ['+f['status']+'] — '+f['title']+' | '+', '.join(f"[{t['id']}](tasks/{t['id']}.md)" for t in owners)+' |')
    (BASE/'RASTREABILIDADE.md').write_text('\n'.join(lines)+'\n')

def main():
    data=json.loads((BASE/'BACKLOG.json').read_text())
    audit=(BASE/data['audit']).parent
    assert hashlib.sha256((audit/'RELATORIO.md').read_bytes()).hexdigest()==data['audit_sha256'], 'audit hash mismatch'
    assert hashlib.sha256((BASE/data['notes_source']).read_bytes()).hexdigest()==data['notes_sha256'], 'notes hash mismatch'
    notes=json.loads((BASE/data['notes_source']).read_text())
    findings=json.loads((BASE/data['findings_source']).read_text())
    assert {f['id'] for f in findings} == {i for t in data['tasks'] for i in t['audit_findings']}, 'uncovered findings'
    snapshot=BASE/data['predecessor_snapshot']
    assert hashlib.sha256(snapshot.read_bytes()).hexdigest()==data['predecessor_sha256'], 'predecessor hash mismatch'
    for t in data['tasks']:
        assert t['origin']['task']==t['id'] and t['current_observation'], 'missing lineage'
        assert set(t['decision_refs']) <= {'D01','D02','D03','D04','D05','D06'}, 'unknown decision'
        assert t['status'] in {'PLANNED','READY','RUNNING','IMPLEMENTED','REVIEW','VERIFIED','DONE','REWORK','BLOCKED','FAILED'}, 'invalid status'
    result=validate(data,notes)
    command=sys.argv[1] if len(sys.argv)>1 else 'validate'
    if command=='render':render(data,notes)
    elif command!='validate':raise SystemExit('Usage: plan.py [validate|render]')
    print(result)

if __name__=='__main__':main()

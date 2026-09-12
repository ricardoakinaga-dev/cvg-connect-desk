import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { Icon, type IconName } from '../components/ui/Icon';
import './Notes.css';

interface Note {
  id: string;
  referenceType: string;
  referenceId: string;
  content: string;
  authorUserId: string | null;
  createdAt: string;
}

const refConfig: Record<string, { label: string; icon: IconName; color: string; bg: string }> = {
  conversation: { label: 'Conversa', icon: 'message', color: '#2563eb', bg: '#eff6ff' },
  task: { label: 'Tarefa', icon: 'tasks', color: '#16a34a', bg: '#f0fdf4' },
  tutor: { label: 'Tutor', icon: 'tutors', color: '#7e22ce', bg: '#faf5ff' },
  patient: { label: 'Paciente', icon: 'patients', color: '#c2410c', bg: '#fff7ed' },
};

export function Notes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [filterType, setFilterType] = useState('');
  const [newNote, setNewNote] = useState({ content: '', referenceType: 'conversation', referenceId: '' });

  const fetchNotes = async () => {
    try {
      const data = await api.get<Note[]>('/notes');
      setNotes(data);
    } catch (err) { console.error('Erro:', err); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchNotes(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.content.trim() || !newNote.referenceId.trim()) return;
    try {
      await api.post('/notes', newNote);
      setNewNote({ content: '', referenceType: 'conversation', referenceId: '' });
      setShowCreate(false);
      fetchNotes();
    } catch (err: any) { alert(err.message); }
  };

  const formatDate = (d: string) => {
    const date = new Date(d);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}min atrás`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h atrás`;
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  };

  const filtered = filterType ? notes.filter(n => n.referenceType === filterType) : notes;

  return (
    <div className="notes-page">
      <div className="page-hero">
        <div className="hero-left">
          <span className="page-kicker">Memória clínica</span>
          <h2><Icon name="notes" /> Notas internas</h2>
          <p>Registre observações sobre conversas, tarefas e contatos</p>
        </div>
        <button className="btn-create" onClick={() => setShowCreate(!showCreate)}>
          <Icon name={showCreate ? 'close' : 'plus'} size={17} /> {showCreate ? 'Cancelar' : 'Nova nota'}
        </button>
      </div>

      {showCreate && (
        <form className="create-panel" onSubmit={handleCreate}>
          <div className="create-row">
            <select aria-label="Tipo da referência" value={newNote.referenceType} onChange={e => setNewNote({ ...newNote, referenceType: e.target.value })}>
              {Object.entries(refConfig).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <input aria-label="ID da referência" placeholder="ID da referência" value={newNote.referenceId} onChange={e => setNewNote({ ...newNote, referenceId: e.target.value })} required />
          </div>
          <textarea aria-label="Conteúdo da nota" placeholder="Escreva sua nota..." value={newNote.content} onChange={e => setNewNote({ ...newNote, content: e.target.value })} required rows={3} />
          <button type="submit" className="btn-create">Salvar Nota</button>
        </form>
      )}

      <div className="filter-bar">
        <div className="filter-group">
          <span className="filter-label">Tipo:</span>
          <button className={`chip ${filterType === '' ? 'active' : ''}`} onClick={() => setFilterType('')}>Todos</button>
          {Object.entries(refConfig).map(([k, v]) => (
            <button key={k} className={`chip ${filterType === k ? 'active' : ''}`} onClick={() => setFilterType(k)}><Icon name={v.icon} size={14} /> {v.label}</button>
          ))}
        </div>
        <span className="result-count">{filtered.length} notas</span>
      </div>

      {loading ? (
        <div className="loading-state"><div className="spinner" /> Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state"><span className="empty-icon"><Icon name="notes" /></span><p>Nenhuma nota encontrada</p></div>
      ) : (
        <div className="notes-timeline">
          {filtered.map(note => {
            const ref = refConfig[note.referenceType] || refConfig.conversation;
            return (
              <div key={note.id} className="note-card">
                <div className="note-timeline-dot" style={{ background: ref.color }} />
                <div className="note-content-card">
                  <div className="note-header-row">
                    <span className="note-ref-badge" style={{ background: ref.bg, color: ref.color }}><Icon name={ref.icon} size={14} /> {ref.label}</span>
                    <span className="note-time">{formatDate(note.createdAt)}</span>
                  </div>
                  <div className="note-body">{note.content}</div>
                  <div className="note-footer">
                    <span className="note-ref-id">#{note.referenceId.slice(0, 8)}</span>
                    {note.authorUserId && <span className="note-author">por {note.authorUserId.slice(0, 8)}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

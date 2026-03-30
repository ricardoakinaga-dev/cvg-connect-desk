import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import './Notes.css';

interface Note {
  id: string;
  referenceType: string;
  referenceId: string;
  conversationId: string | null;
  taskId: string | null;
  content: string;
  authorUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function Notes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newNote, setNewNote] = useState({ content: '', referenceType: 'conversation', referenceId: '' });

  const fetchNotes = async () => {
    try {
      const data = await api.get<Note[]>('/notes');
      setNotes(data);
    } catch (err) {
      console.error('Erro ao carregar notas:', err);
    } finally {
      setLoading(false);
    }
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
    } catch (err) {
      console.error('Erro ao criar nota:', err);
    }
  };

  const refTypeLabel = (type: string) => {
    const map: Record<string, string> = { conversation: '💬 Conversa', task: '✓ Tarefa', tutor: '👤 Tutor', patient: '🐾 Paciente' };
    return map[type] || type;
  };

  const formatDate = (d: string) => new Date(d).toLocaleString('pt-BR');

  return (
    <div className="notes-page">
      <div className="page-header">
        <h2>📝 Notas Internas</h2>
        <button className="btn-primary" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? '✕ Cancelar' : '+ Nova Nota'}
        </button>
      </div>

      {showCreate && (
        <form className="create-note-form" onSubmit={handleCreate}>
          <div className="form-row">
            <select value={newNote.referenceType} onChange={e => setNewNote({ ...newNote, referenceType: e.target.value })}>
              <option value="conversation">💬 Conversa</option>
              <option value="task">✓ Tarefa</option>
              <option value="tutor">👤 Tutor</option>
              <option value="patient">🐾 Paciente</option>
            </select>
            <input type="text" placeholder="ID da referência" value={newNote.referenceId} onChange={e => setNewNote({ ...newNote, referenceId: e.target.value })} required />
          </div>
          <textarea placeholder="Conteúdo da nota..." value={newNote.content} onChange={e => setNewNote({ ...newNote, content: e.target.value })} required rows={3} />
          <button type="submit" className="btn-primary">Salvar Nota</button>
        </form>
      )}

      {loading ? (
        <div className="loading">Carregando notas...</div>
      ) : notes.length === 0 ? (
        <div className="empty-state">Nenhuma nota interna encontrada.</div>
      ) : (
        <div className="notes-list">
          {notes.map(note => (
            <div key={note.id} className="note-card">
              <div className="note-header">
                <span className="note-ref-type">{refTypeLabel(note.referenceType)}</span>
                <span className="note-date">{formatDate(note.createdAt)}</span>
              </div>
              <div className="note-content">{note.content}</div>
              <div className="note-footer">
                <span className="note-ref-id">Ref: {note.referenceId.slice(0, 8)}...</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

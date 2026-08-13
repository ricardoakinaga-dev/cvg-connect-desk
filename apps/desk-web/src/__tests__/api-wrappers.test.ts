import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  alertApi,
  api,
  conversationApi,
  dashboardApi,
  deadLetterApi,
  getErrorMessage,
  labelApi,
  sectorApi,
  taskApi,
  transferApi,
  webhookSecurityApi,
  operationalMetricsApi,
} from '../lib/api';

describe('API wrapper behavior', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes unknown errors', () => {
    expect(getErrorMessage(new Error('Falhou'))).toBe('Falhou');
    expect(getErrorMessage('plain', 'fallback')).toBe('fallback');
  });

  it('builds conversation endpoint URLs and payloads', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({});
    const post = vi.spyOn(api, 'post').mockResolvedValue({});

    await conversationApi.list({ status: 'open', queueId: 'queue-1', teamId: 'team-1', sectorId: 'sector-1' });
    await conversationApi.list();
    await conversationApi.getMessages('conversation-1', 25);
    await conversationApi.sendMessage({ conversationId: 'conversation-1', content: 'Oi', recipient: 'contact-1' });

    expect(get).toHaveBeenNthCalledWith(1, '/conversations?status=open&queueId=queue-1&teamId=team-1&sectorId=sector-1');
    expect(get).toHaveBeenNthCalledWith(2, '/conversations');
    expect(get).toHaveBeenNthCalledWith(3, '/conversations/conversation-1/messages?limit=25');
    expect(post).toHaveBeenCalledWith('/messages', { conversationId: 'conversation-1', content: 'Oi', recipient: 'contact-1' });
  });

  it('builds task, alert and dashboard endpoint URLs', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({});
    const post = vi.spyOn(api, 'post').mockResolvedValue({});
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({});

    await taskApi.list({ status: 'pending', assignedTo: 'user-1', priority: 'urgent' });
    await taskApi.get('task-1');
    await taskApi.create({ title: 'Retornar tutor' });
    await taskApi.updateStatus('task-1', { status: 'completed' });
    await alertApi.list({ status: 'active', severity: 'critical', type: 'sla' });
    await alertApi.get('alert-1');
    await alertApi.acknowledge('alert-1', 'user-1');
    await alertApi.resolve('alert-1', 'user-1');
    await dashboardApi.getSummary();
    await dashboardApi.getConversations();
    await dashboardApi.getOpenConversationsCount();
    await dashboardApi.getTasks();
    await dashboardApi.getOverdueTasksCount();
    await dashboardApi.getAlerts();
    await dashboardApi.getActiveAlertsCount();

    expect(get).toHaveBeenCalledWith('/tasks?status=pending&assignedTo=user-1&priority=urgent');
    expect(get).toHaveBeenCalledWith('/tasks/task-1');
    expect(post).toHaveBeenCalledWith('/tasks', { title: 'Retornar tutor' });
    expect(patch).toHaveBeenCalledWith('/tasks/task-1/status', { status: 'completed' });
    expect(get).toHaveBeenCalledWith('/alerts?status=active&severity=critical&type=sla');
    expect(get).toHaveBeenCalledWith('/alerts/alert-1');
    expect(post).toHaveBeenCalledWith('/alerts/alert-1/acknowledge', { acknowledgedBy: 'user-1' });
    expect(post).toHaveBeenCalledWith('/alerts/alert-1/resolve', { resolvedBy: 'user-1' });
    expect(get).toHaveBeenCalledWith('/metrics/summary');
    expect(get).toHaveBeenCalledWith('/metrics/conversations');
    expect(get).toHaveBeenCalledWith('/metrics/conversations/open');
    expect(get).toHaveBeenCalledWith('/metrics/tasks');
    expect(get).toHaveBeenCalledWith('/metrics/tasks/overdue');
    expect(get).toHaveBeenCalledWith('/metrics/alerts');
    expect(get).toHaveBeenCalledWith('/metrics/alerts/active');
  });

  it('builds admin, label, sector and transfer endpoint URLs', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({});
    const post = vi.spyOn(api, 'post').mockResolvedValue({});
    const put = vi.spyOn(api, 'put').mockResolvedValue({});
    const del = vi.spyOn(api, 'delete').mockResolvedValue({});

    await deadLetterApi.list({ resolved: false, limit: 5 });
    await deadLetterApi.list();
    await deadLetterApi.stats();
    await deadLetterApi.retry('dead-1');
    await deadLetterApi.resolve('dead-1');
    await webhookSecurityApi.stats();
    await operationalMetricsApi.get();
    await labelApi.list();
    await labelApi.create({ name: 'VIP' });
    await labelApi.update('label-1', { color: '#fff' } as never);
    await labelApi.delete('label-1');
    await labelApi.getConversationLabels('conversation-1');
    await labelApi.addToConversation('conversation-1', 'label-1');
    await labelApi.removeFromConversation('conversation-1', 'label-1');
    await labelApi.getContactLabels('contact-1');
    await labelApi.addToContact('contact-1', 'label-1');
    await sectorApi.list(true);
    await sectorApi.list();
    await sectorApi.create({ name: 'Recepcao', code: 'recepcao' });
    await sectorApi.update('sector-1', { isActive: true } as never);
    await sectorApi.delete('sector-1');
    await sectorApi.getConversations('sector-1', 'open');
    await sectorApi.getConversations('sector-1');
    await sectorApi.getStats('sector-1');
    await sectorApi.getAllStats();
    await transferApi.create({ contactId: 'contact-1', toSectorId: 'sector-2' });
    await transferApi.list();
    await transferApi.getContactTransfers('contact-1');
    await transferApi.accept('transfer-1');
    await transferApi.reject('transfer-1');

    expect(get).toHaveBeenCalledWith('/admin/dead-letters?resolved=false&limit=5');
    expect(get).toHaveBeenCalledWith('/admin/dead-letters');
    expect(get).toHaveBeenCalledWith('/admin/dead-letters/stats');
    expect(post).toHaveBeenCalledWith('/admin/dead-letters/dead-1/retry', {});
    expect(post).toHaveBeenCalledWith('/admin/dead-letters/dead-1/resolve', {});
    expect(get).toHaveBeenCalledWith('/admin/webhook-security/stats');
    expect(get).toHaveBeenCalledWith('/admin/operational/metrics');
    expect(get).toHaveBeenCalledWith('/labels');
    expect(put).toHaveBeenCalledWith('/labels/label-1', { color: '#fff' });
    expect(del).toHaveBeenCalledWith('/labels/label-1');
    expect(get).toHaveBeenCalledWith('/conversations/conversation-1/labels');
    expect(post).toHaveBeenCalledWith('/conversations/conversation-1/labels', { labelId: 'label-1' });
    expect(del).toHaveBeenCalledWith('/conversations/conversation-1/labels/label-1');
    expect(get).toHaveBeenCalledWith('/contacts/contact-1/labels');
    expect(post).toHaveBeenCalledWith('/contacts/contact-1/labels', { labelId: 'label-1' });
    expect(get).toHaveBeenCalledWith('/sectors?all=true');
    expect(get).toHaveBeenCalledWith('/sectors');
    expect(post).toHaveBeenCalledWith('/sectors', { name: 'Recepcao', code: 'recepcao' });
    expect(put).toHaveBeenCalledWith('/sectors/sector-1', { isActive: true });
    expect(del).toHaveBeenCalledWith('/sectors/sector-1');
    expect(get).toHaveBeenCalledWith('/sectors/sector-1/conversations?status=open');
    expect(get).toHaveBeenCalledWith('/sectors/sector-1/conversations');
    expect(get).toHaveBeenCalledWith('/sectors/sector-1/stats');
    expect(get).toHaveBeenCalledWith('/sectors/stats/overview');
    expect(post).toHaveBeenCalledWith('/transfers', { contactId: 'contact-1', toSectorId: 'sector-2' });
    expect(get).toHaveBeenCalledWith('/transfers');
    expect(get).toHaveBeenCalledWith('/contacts/contact-1/transfers');
    expect(post).toHaveBeenCalledWith('/transfers/transfer-1/accept');
    expect(post).toHaveBeenCalledWith('/transfers/transfer-1/reject');
  });
});

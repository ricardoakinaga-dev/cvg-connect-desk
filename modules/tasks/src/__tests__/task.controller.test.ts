import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cvg/auth', () => ({
  authenticate: vi.fn(async (request: { user?: { id: string } }) => {
    request.user = { id: 'user-auth' };
  }),
  requirePermission: vi.fn(() => vi.fn()),
}));

vi.mock('@cvg/audit', () => ({
  createAuditLog: vi.fn(),
}));

import { AppError, BadRequestError } from '@cvg/shared';
import * as createTaskUseCase from '../application/use-cases/create-task.use-case';
import * as updateTaskStatusUseCase from '../application/use-cases/update-task-status.use-case';
import * as repository from '../infrastructure/repositories/task.repository';
import { registerTaskRoutes } from '../presentation/http/task.controller';

function ok<T>(value: T) {
  return {
    isOk: () => true,
    isErr: () => false,
    value,
  };
}

function fail(error: Error) {
  return {
    isOk: () => false,
    isErr: () => true,
    error,
  };
}

type RouteEntry = {
  handler: (request: unknown, reply: unknown) => Promise<unknown>;
  preHandlers: Array<(request: unknown, reply: unknown) => Promise<unknown>>;
};

type RouteRegistry = {
  post: Record<string, RouteEntry>;
  get: Record<string, RouteEntry>;
  patch: Record<string, RouteEntry>;
};

function createMockRouter() {
  const routes: RouteRegistry = { post: {}, get: {}, patch: {} };

  return {
    routes,
    app: {
      post(path: string, options: { preHandler: RouteEntry['preHandlers'] }, handler: RouteEntry['handler']) {
        routes.post[path] = { handler, preHandlers: options.preHandler };
      },
      get(path: string, options: { preHandler: RouteEntry['preHandlers'] }, handler: RouteEntry['handler']) {
        routes.get[path] = { handler, preHandlers: options.preHandler };
      },
      patch(path: string, options: { preHandler: RouteEntry['preHandlers'] }, handler: RouteEntry['handler']) {
        routes.patch[path] = { handler, preHandlers: options.preHandler };
      },
    } as {
      post: RouteRegistry['post'];
      get: RouteRegistry['get'];
      patch: RouteRegistry['patch'];
    },
  };
}

function createReply() {
  const reply: {
    statusCode?: number;
    payload?: unknown;
    status: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  } = {
    status: vi.fn(function (code: number) {
      this.statusCode = code;
      return this;
    }) as ReturnType<typeof vi.fn>,
    send: vi.fn(function (payload: unknown) {
      this.payload = payload;
      return this;
    }) as ReturnType<typeof vi.fn>,
  };
  return reply;
}

function makeRequest(overrides: Record<string, unknown>) {
  return {
    user: { id: 'user-auth' },
    log: { error: vi.fn() },
    ...overrides,
  };
}

async function runRoute({
  routes,
  method,
  path,
  request,
}: {
  routes: RouteRegistry;
  method: 'post' | 'get' | 'patch';
  path: string;
  request: Record<string, unknown>;
}) {
  const reply = createReply();
  const route = routes[method][path];

  for (const pre of route.preHandlers) {
    await pre(request as never, reply as never);
  }

  await route.handler(request, reply as never);
  return reply;
}

describe('task controller routes', () => {
  let routes: RouteRegistry;

  beforeEach(() => {
    const { app, routes: registeredRoutes } = createMockRouter();
    routes = registeredRoutes;
    registerTaskRoutes(app as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates task and returns 201', async () => {
    vi.spyOn(createTaskUseCase, 'createTask').mockResolvedValue(ok({ id: 'task-1', title: 'Follow up', status: 'pending' }));

    const response = await runRoute({
      routes,
      method: 'post',
      path: '/tasks',
      request: makeRequest({ body: { title: 'Follow up' } }),
    });

    expect(response.statusCode).toBe(201);
    expect(response.payload).toEqual({ id: 'task-1', title: 'Follow up', status: 'pending' });
    expect(createTaskUseCase.createTask).toHaveBeenCalledWith({ title: 'Follow up', userId: 'user-auth', dueAt: undefined });
  });

  it('returns app error on createTask failure', async () => {
    vi.spyOn(createTaskUseCase, 'createTask').mockResolvedValue(
      fail(new BadRequestError('Title is required', 'TITLE_REQUIRED'))
    );

    const response = await runRoute({
      routes,
      method: 'post',
      path: '/tasks',
      request: makeRequest({ body: { title: '' } }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({ error: 'TITLE_REQUIRED', message: 'Title is required' });
  });

  it('lists tasks with success', async () => {
    const list = [{ id: 'task-1' }, { id: 'task-2' }];
    vi.spyOn(repository.taskRepository, 'findAll').mockResolvedValue(list as never);

    const response = await runRoute({
      routes,
      method: 'get',
      path: '/tasks',
      request: makeRequest({ query: {} }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual(list);
  });

  it('returns 500 for listing failures', async () => {
    vi.spyOn(repository.taskRepository, 'findAll').mockRejectedValue(new Error('Database unavailable'));

    const response = await runRoute({
      routes,
      method: 'get',
      path: '/tasks',
      request: makeRequest({ query: {} }),
    });

    expect(response.statusCode).toBe(500);
    expect(response.payload).toEqual({ error: 'INTERNAL_ERROR', message: 'Failed to fetch tasks' });
  });

  it('returns task by id', async () => {
    const task = { id: 'task-1', title: 'Task found' };
    vi.spyOn(repository.taskRepository, 'findById').mockResolvedValue(task as never);

    const response = await runRoute({
      routes,
      method: 'get',
      path: '/tasks/:id',
      request: makeRequest({ params: { id: 'task-1' } }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual(task);
  });

  it('returns 404 when task does not exist', async () => {
    vi.spyOn(repository.taskRepository, 'findById').mockResolvedValue(null as never);

    const response = await runRoute({
      routes,
      method: 'get',
      path: '/tasks/:id',
      request: makeRequest({ params: { id: 'missing' } }),
    });

    expect(response.statusCode).toBe(404);
    expect(response.payload).toEqual({ error: 'NOT_FOUND', message: 'Task not found' });
  });

  it('returns 500 on repository error when loading task by id', async () => {
    vi.spyOn(repository.taskRepository, 'findById').mockRejectedValue(new Error('Connection lost'));

    const response = await runRoute({
      routes,
      method: 'get',
      path: '/tasks/:id',
      request: makeRequest({ params: { id: 'task-1' } }),
    });

    expect(response.statusCode).toBe(500);
    expect(response.payload).toEqual({ error: 'INTERNAL_ERROR', message: 'Failed to fetch task' });
  });

  it('updates task status with success', async () => {
    const updated = { id: 'task-1', status: 'completed', completedAt: null };
    vi.spyOn(updateTaskStatusUseCase, 'updateTaskStatus').mockResolvedValue(ok(updated));

    const response = await runRoute({
      routes,
      method: 'patch',
      path: '/tasks/:id/status',
      request: {
        params: { id: 'task-1' },
        body: { status: 'completed', changedBy: 'agent', reason: 'work finished' },
        user: { id: 'user-1' },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual(updated);
  });

  it('returns app error on status update', async () => {
    vi.spyOn(updateTaskStatusUseCase, 'updateTaskStatus').mockResolvedValue(
      fail(new AppError('Invalid status transition', 422, 'INVALID_STATUS'))
    );

    const response = await runRoute({
      routes,
      method: 'patch',
      path: '/tasks/:id/status',
      request: {
        params: { id: 'task-1' },
        body: { status: 'completed' },
        user: { id: 'user-1' },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.payload).toEqual({ error: 'INVALID_STATUS', message: 'Invalid status transition' });
  });

  it('returns 500 on non app error on status update', async () => {
    vi.spyOn(updateTaskStatusUseCase, 'updateTaskStatus').mockResolvedValue(fail(new Error('Timeout')));

    const response = await runRoute({
      routes,
      method: 'patch',
      path: '/tasks/:id/status',
      request: {
        params: { id: 'task-1' },
        body: { status: 'completed' },
        user: { id: 'user-1' },
      },
    });

    expect(response.statusCode).toBe(500);
    expect(response.payload).toEqual({ error: 'INTERNAL_ERROR', message: 'Failed to update task status' });
  });

  it('bulk updates tasks and returns totals', async () => {
    vi.spyOn(repository.taskRepository, 'update').mockResolvedValue({ id: 'task-1' } as never);

    const response = await runRoute({
      routes,
      method: 'patch',
      path: '/tasks/bulk',
      request: makeRequest({
        body: {
          taskIds: ['task-1', 'task-2'],
          updates: { status: 'completed', priority: 'urgent', assignedTo: 'agent-1' },
        },
      }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual({ success: 2, failed: 0, total: 2 });
  });

  it('bulk updates without optional fields still work', async () => {
    vi.spyOn(repository.taskRepository, 'update').mockResolvedValue({ id: 'task-1' } as never);

    const response = await runRoute({
      routes,
      method: 'patch',
      path: '/tasks/bulk',
      request: makeRequest({
        body: {
          taskIds: ['task-1'],
          updates: { priority: 'low' },
        },
      }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual({ success: 1, failed: 0, total: 1 });
  });

  it('bulk updates with partial errors and failedTasks output', async () => {
    vi.spyOn(repository.taskRepository, 'update').mockImplementation(async (taskId: string) => {
      if (taskId === 'task-bad') {
        throw new Error('Task not found');
      }
      return { id: taskId } as never;
    });

    const response = await runRoute({
      routes,
      method: 'patch',
      path: '/tasks/bulk',
      request: makeRequest({
        body: {
          taskIds: ['task-ok', 'task-bad'],
          updates: { status: 'in_progress' },
        },
      }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toMatchObject({
      success: 1,
      failed: 1,
      total: 2,
      failedTasks: [{ taskId: 'task-bad' }],
    });
  });
});

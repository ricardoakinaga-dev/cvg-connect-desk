import { describe, it, expect } from 'vitest';
import { parsePagination, createPaginatedResponse } from '../pagination';

describe('Pagination', () => {
  describe('parsePagination', () => {
    it('retorna valores padrão quando nenhum parâmetro é fornecido', () => {
      const result = parsePagination({});
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
      expect(result.sortBy).toBe('created_at');
      expect(result.sortOrder).toBe('desc');
    });

    it('calcula offset corretamente para página 2', () => {
      const result = parsePagination({ page: 2, limit: 10 });
      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(10);
    });

    it('limita o máximo de itens por página a 100', () => {
      const result = parsePagination({ limit: 200 });
      expect(result.limit).toBe(100);
    });

    it('não permite página menor que 1', () => {
      const result = parsePagination({ page: -5 });
      expect(result.page).toBe(1);
    });

    it('não permite limit menor que 1', () => {
      const result = parsePagination({ limit: -10 });
      expect(result.limit).toBe(1);
    });
  });

  describe('createPaginatedResponse', () => {
    it('cria resposta paginada correta', () => {
      const data = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const params = parsePagination({ page: 1, limit: 10 });
      const response = createPaginatedResponse(data, 25, params);

      expect(response.data).toEqual(data);
      expect(response.pagination.page).toBe(1);
      expect(response.pagination.limit).toBe(10);
      expect(response.pagination.total).toBe(25);
      expect(response.pagination.totalPages).toBe(3);
      expect(response.pagination.hasNext).toBe(true);
      expect(response.pagination.hasPrev).toBe(false);
    });

    it('marca última página corretamente', () => {
      const data = [{ id: 1 }];
      const params = parsePagination({ page: 3, limit: 10 });
      const response = createPaginatedResponse(data, 25, params);

      expect(response.pagination.hasNext).toBe(false);
      expect(response.pagination.hasPrev).toBe(true);
    });

    it('retorna totalPages 0 quando não há dados', () => {
      const params = parsePagination({});
      const response = createPaginatedResponse([], 0, params);

      expect(response.pagination.totalPages).toBe(0);
      expect(response.pagination.hasNext).toBe(false);
    });
  });
});

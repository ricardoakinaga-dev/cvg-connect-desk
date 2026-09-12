import { describe, expect, it } from 'vitest';
import { classifyConversationAging } from '../infrastructure/dashboard.repository';

describe('conversation aging classification', () => {
  it.each([
    [null, 'fresh'],
    [2, 'fresh'],
    [2.1, 'normal'],
    [8, 'normal'],
    [8.1, 'old'],
    [24, 'old'],
    [24.1, 'critical'],
  ] as const)('classifies %s hours as %s', (hours, expected) => {
    expect(classifyConversationAging(hours)).toBe(expected);
  });
});

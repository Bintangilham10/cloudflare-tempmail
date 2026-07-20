import { describe, expect, it } from 'vitest';
import { makeSnippet } from '../src/utils/parse-email';

describe('Worker test harness', () => {
  it('runs application utilities inside the Workers runtime', () => {
    expect(makeSnippet('quality gate ready', null)).toBe('quality gate ready');
  });
});

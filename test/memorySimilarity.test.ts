import { describe, it, expect } from 'vitest';
import { jaccardSimilarity, tokenize, STOP_WORDS } from '../src/memorySimilarity';

describe('tokenize', () => {
  it('lowercases', () => {
    expect(tokenize('Add Date Range')).toEqual(new Set(['add', 'date', 'range']));
  });
  it('splits on non-alphanumeric', () => {
    expect(tokenize('foo-bar.baz_qux')).toEqual(new Set(['foo', 'bar', 'baz', 'qux']));
  });
  it('drops tokens length 1 (noise)', () => {
    expect(tokenize('a b c hello')).toEqual(new Set(['hello']));
  });
  it('drops stopwords', () => {
    expect(tokenize('the cache to the users')).toEqual(new Set(['cache', 'users']));
  });
  it('drops empty strings', () => {
    expect(tokenize('   ,,,,   ')).toEqual(new Set());
  });
});

describe('jaccardSimilarity', () => {
  it('returns 1.0 for identical strings', () => {
    expect(jaccardSimilarity('add cache to users', 'add cache to users')).toBe(1);
  });
  it('returns 0 for fully disjoint', () => {
    expect(jaccardSimilarity('foo bar', 'baz qux')).toBe(0);
  });
  it('returns 0 for both empty (after tokenization)', () => {
    expect(jaccardSimilarity('the a in', 'on for and')).toBe(0);
  });
  it('half-overlap returns 1/3', () => {
    expect(jaccardSimilarity('cache users', 'cache posts')).toBeCloseTo(0.333, 2);
  });
  it('is case-insensitive', () => {
    expect(jaccardSimilarity('CACHE Users', 'cache USERS')).toBe(1);
  });
  it('treats "add caching" and "Add a caching" the same after stopword removal', () => {
    expect(jaccardSimilarity('add caching to users', 'Add a caching for users')).toBe(1);
  });
});

describe('STOP_WORDS', () => {
  it('contains expected basic stopwords', () => {
    expect(STOP_WORDS.has('the')).toBe(true);
    expect(STOP_WORDS.has('a')).toBe(true);
    expect(STOP_WORDS.has('to')).toBe(true);
    expect(STOP_WORDS.has('and')).toBe(true);
  });
});

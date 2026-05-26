import { describe, it, expect } from 'vitest';
import {
  HOTSPOT_BODY,
  CONVENTION_BODY,
  MODULE_MAP_BODY,
  COLLECTION_NAMES,
  bodySchemaFor,
} from '../src/memorySchema';

describe('HOTSPOT_BODY', () => {
  it('accepts a valid hotspot', () => {
    expect(() => HOTSPOT_BODY.parse({
      file_path: 'src/auth.ts',
      bug_count: 3,
      recent_bug_ids: ['00000000-0000-4000-8000-000000000001'],
      fragility_score: 0.3,
    })).not.toThrow();
  });
  it('rejects empty file_path', () => {
    expect(() => HOTSPOT_BODY.parse({
      file_path: '', bug_count: 1, recent_bug_ids: [], fragility_score: 0.1,
    })).toThrow();
  });
  it('rejects fragility_score > 1', () => {
    expect(() => HOTSPOT_BODY.parse({
      file_path: 'x.ts', bug_count: 1, recent_bug_ids: [], fragility_score: 1.5,
    })).toThrow();
  });
  it('rejects negative bug_count', () => {
    expect(() => HOTSPOT_BODY.parse({
      file_path: 'x.ts', bug_count: -1, recent_bug_ids: [], fragility_score: 0,
    })).toThrow();
  });
  it('accepts optional notes', () => {
    expect(() => HOTSPOT_BODY.parse({
      file_path: 'x.ts', bug_count: 1, recent_bug_ids: [], fragility_score: 0.1,
      notes: 'manually flagged after Q3 incident',
    })).not.toThrow();
  });
});

describe('CONVENTION_BODY', () => {
  it('accepts a valid convention', () => {
    expect(() => CONVENTION_BODY.parse({
      rule: 'use < instead of <=', scope: 'src/**', derivation: 'user-confirmed',
    })).not.toThrow();
  });
  it('rejects empty rule', () => {
    expect(() => CONVENTION_BODY.parse({
      rule: '', scope: 'src/**', derivation: 'user-confirmed',
    })).toThrow();
  });
  it('rejects invalid derivation', () => {
    expect(() => CONVENTION_BODY.parse({
      rule: 'x', scope: 'src/**', derivation: 'made-up',
    })).toThrow();
  });
  it('defaults examples to empty arrays', () => {
    const parsed = CONVENTION_BODY.parse({
      rule: 'x', scope: 's', derivation: 'user-confirmed',
    });
    expect(parsed.examples_good).toEqual([]);
    expect(parsed.examples_bad).toEqual([]);
  });
});

describe('MODULE_MAP_BODY', () => {
  it('accepts a valid module entry', () => {
    expect(() => MODULE_MAP_BODY.parse({
      module: 'src/api/users',
      description: 'User CRUD + auth',
      responsibilities: ['list users', 'create user', 'update profile'],
      key_files: ['src/api/users/index.ts'],
      dependencies: ['src/db', 'src/auth'],
    })).not.toThrow();
  });
  it('rejects empty responsibilities', () => {
    expect(() => MODULE_MAP_BODY.parse({
      module: 'src/x', description: 'd', responsibilities: [],
    })).toThrow();
  });
  it('rejects description > 500 chars', () => {
    expect(() => MODULE_MAP_BODY.parse({
      module: 'src/x', description: 'd'.repeat(501), responsibilities: ['r'],
    })).toThrow();
  });
  it('defaults key_files + dependencies to []', () => {
    const parsed = MODULE_MAP_BODY.parse({
      module: 'src/x', description: 'd', responsibilities: ['r'],
    });
    expect(parsed.key_files).toEqual([]);
    expect(parsed.dependencies).toEqual([]);
  });
});

describe('COLLECTION_NAMES extends to 8 entries', () => {
  it('includes the 3 new collections', () => {
    expect(COLLECTION_NAMES).toEqual([
      'decisions', 'bugs', 'scratch', 'audit', 'verifications',
      'hotspots', 'conventions', 'module-map',
    ]);
  });
});

describe('bodySchemaFor returns new schemas', () => {
  it('hotspots → HOTSPOT_BODY', () => expect(bodySchemaFor('hotspots')).toBe(HOTSPOT_BODY));
  it('conventions → CONVENTION_BODY', () => expect(bodySchemaFor('conventions')).toBe(CONVENTION_BODY));
  it('module-map → MODULE_MAP_BODY', () => expect(bodySchemaFor('module-map')).toBe(MODULE_MAP_BODY));
});

import { describe, expect, it } from 'vitest';
import { parseAnnotations, parseSemanticOverrides, setAnnotation } from '../src/index.js';

describe('parseAnnotations', () => {
  it('parses leading annotations and stops at the SQL body', () => {
    const sql = [
      '-- @viz: bar',
      '-- @title: Revenue',
      '',
      '-- an ordinary comment',
      'SELECT 1 AS x;',
    ].join('\n');

    expect(parseAnnotations(sql)).toEqual({ viz: 'bar', title: 'Revenue' });
  });

  it('lowercases keys and trims values', () => {
    const sql = '-- @VIZ:   Bar  \nSELECT 1;';
    expect(parseAnnotations(sql)).toEqual({ viz: 'Bar' });
  });
});

describe('setAnnotation', () => {
  it('replaces an existing annotation', () => {
    const sql = '-- @viz: bar\n-- @x: month\nSELECT 1;';
    const updated = setAnnotation(sql, 'viz', 'line');
    expect(updated).toBe('-- @viz: line\n-- @x: month\nSELECT 1;');
    expect(parseAnnotations(updated)).toEqual({ viz: 'line', x: 'month' });
  });

  it('inserts a new annotation after the annotation block', () => {
    const sql = '-- @viz: bar\nSELECT 1;';
    const updated = setAnnotation(sql, 'x', 'month');
    expect(updated).toBe('-- @viz: bar\n-- @x: month\nSELECT 1;');
  });

  it('inserts at the top when no annotations exist', () => {
    const updated = setAnnotation('SELECT 1;', 'viz', 'bar');
    expect(updated).toBe('-- @viz: bar\nSELECT 1;');
  });

  it('removes an annotation with null', () => {
    const sql = '-- @viz: bar\n-- @x: month\nSELECT 1;';
    expect(setAnnotation(sql, 'x', null)).toBe('-- @viz: bar\nSELECT 1;');
  });
});

describe('parseSemanticOverrides', () => {
  it('parses column: Type pairs', () => {
    expect(parseSemanticOverrides('revenue: Price, month: YearMonth')).toEqual({
      revenue: 'Price',
      month: 'YearMonth',
    });
  });

  it('ignores malformed pairs', () => {
    expect(parseSemanticOverrides('revenue: Price, junk, : Missing')).toEqual({
      revenue: 'Price',
    });
  });

  it('returns empty for no value', () => {
    expect(parseSemanticOverrides(undefined)).toEqual({});
  });
});

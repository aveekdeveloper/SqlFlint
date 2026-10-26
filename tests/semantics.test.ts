import { describe, expect, it } from 'vitest';
import { inferSemanticType, profileColumns } from '../src/index.js';

describe('inferSemanticType temporal', () => {
  it('detects year-month strings', () => {
    const result = inferSemanticType('month', ['2026-01', '2026-02']);
    expect(result.semanticType).toBe('YearMonth');
    expect(result.kind).toBe('temporal');
  });

  it('detects dates from a date column', () => {
    const result = inferSemanticType('order_date', ['2026-01-31', '2026-02-01']);
    expect(result.semanticType).toBe('Date');
  });

  it('detects date-times from values', () => {
    const result = inferSemanticType('created_at', ['2026-01-31 10:30', '2026-02-01 09:00']);
    expect(result.semanticType).toBe('DateTime');
  });

  it('detects quarters', () => {
    expect(inferSemanticType('quarter', ['Q1', 'Q2']).semanticType).toBe('Quarter');
    expect(inferSemanticType('qtr', ['2026Q1', '2026Q2']).semanticType).toBe('YearQuarter');
  });

  it('detects years by name', () => {
    expect(inferSemanticType('fiscal_year', [2025, 2026]).semanticType).toBe('Year');
  });

  it('detects Date instances', () => {
    expect(inferSemanticType('day', [new Date('2026-01-31')]).semanticType).toBe('Date');
    expect(inferSemanticType('ts', [new Date('2026-01-31T10:30:00')]).semanticType).toBe('DateTime');
  });
});

describe('inferSemanticType measures', () => {
  it('maps rate and pct names to Percentage', () => {
    expect(inferSemanticType('conversion_rate', [0.12]).semanticType).toBe('Percentage');
    expect(inferSemanticType('revenue_pct', [12]).semanticType).toBe('Percentage');
  });

  it('maps change names to PercentageChange', () => {
    expect(inferSemanticType('growth', [-0.05]).semanticType).toBe('PercentageChange');
    expect(inferSemanticType('yoy_change', [0.2]).semanticType).toBe('PercentageChange');
  });

  it('maps money names to Price and Profit', () => {
    expect(inferSemanticType('revenue', [1200]).semanticType).toBe('Price');
    expect(inferSemanticType('unit_price', [9.99]).semanticType).toBe('Price');
    expect(inferSemanticType('gross_margin', [300]).semanticType).toBe('Profit');
  });

  it('maps count-like names to Count', () => {
    expect(inferSemanticType('active_users', [1200]).semanticType).toBe('Count');
    expect(inferSemanticType('order_count', [42]).semanticType).toBe('Count');
  });

  it('maps rank names to Rank', () => {
    expect(inferSemanticType('rank', [1, 2]).semanticType).toBe('Rank');
  });

  it('defaults numeric columns to Quantity', () => {
    const result = inferSemanticType('elapsed', [12.5, 30]);
    expect(result.semanticType).toBe('Quantity');
    expect(result.kind).toBe('measure');
  });
});

describe('inferSemanticType categorical', () => {
  it('maps geo and status names', () => {
    expect(inferSemanticType('country', ['US', 'DE']).semanticType).toBe('Country');
    expect(inferSemanticType('city', ['Berlin']).semanticType).toBe('City');
    expect(inferSemanticType('region', ['NA']).semanticType).toBe('Region');
    expect(inferSemanticType('status', ['open']).semanticType).toBe('Status');
  });

  it('maps id-like numeric columns to ID', () => {
    const result = inferSemanticType('customer_id', [1, 2, 3]);
    expect(result.semanticType).toBe('ID');
    expect(result.kind).toBe('identifier');
  });

  it('detects booleans', () => {
    expect(inferSemanticType('is_active', [true, false]).semanticType).toBe('Boolean');
  });

  it('defaults string columns to Category', () => {
    const result = inferSemanticType('flavor', ['sweet', 'sour']);
    expect(result.semanticType).toBe('Category');
    expect(result.kind).toBe('categorical');
  });
});

describe('profileColumns', () => {
  it('profiles distinct, nulls and evidence', () => {
    const profiles = profileColumns([
      { month: '2026-01', region: 'NA', revenue: 10 },
      { month: '2026-01', region: 'EU', revenue: null },
    ]);

    expect(profiles.map((profile) => profile.name)).toEqual(['month', 'region', 'revenue']);
    expect(profiles[2].nullCount).toBe(1);
    expect(profiles[1].distinct).toBe(2);
    expect(profiles[1].semanticType).toBe('Region');
  });

  it('returns empty for no rows', () => {
    expect(profileColumns([])).toEqual([]);
  });
});

export type ColumnKind = 'temporal' | 'measure' | 'categorical' | 'identifier';

export interface ColumnProfile {
  name: string;
  semanticType: string;
  kind: ColumnKind;
  distinct: number;
  nullCount: number;
  evidence: string;
}

export interface SemanticInference {
  semanticType: string;
  kind: ColumnKind;
  evidence: string;
}

const YEAR_PATTERN = /^\d{4}$/;
const YEAR_MONTH_PATTERN = /^\d{4}-\d{2}$/;
const YEAR_MONTH_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const YEAR_QUARTER_PATTERN = /^\d{4}-?q[1-4]$/i;
const QUARTER_PATTERN = /^q[1-4]$/i;
const MONTH_NAME_PATTERN = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?$/i;
const YEAR_WEEK_PATTERN = /^\d{4}-w\d{1,2}$/i;
const TIME_PATTERN = /^\d{1,2}:\d{2}(:\d{2})?/;

const MEASURE_NAME_RULES: Array<{ pattern: RegExp; type: string; evidence: string }> = [
  { pattern: /(^|_)(change|growth|delta|diff|yoy|mom|qoq|wow)(_|$)/, type: 'PercentageChange', evidence: 'name suggests change over time' },
  { pattern: /pct|percent|%|share|(^|_)(rate|ratio)(_|$)/, type: 'Percentage', evidence: 'name suggests a percentage' },
  { pattern: /profit|margin|earning/, type: 'Profit', evidence: 'name suggests profit' },
  { pattern: /price|revenue|sales|spend|spending|cost|amount|budget|fee|salary|income|turnover|payment|invoice|charge|fund|money|usd|eur|gbp/, type: 'Price', evidence: 'name suggests money' },
  { pattern: /temp|°|celsius|fahrenheit|kelvin/, type: 'Temperature', evidence: 'name suggests temperature' },
  { pattern: /(^|_)(rank|ranking|position|standing)(_|$)|row_number/, type: 'Rank', evidence: 'name suggests a rank' },
  { pattern: /score|rating|grade|stars?/, type: 'Score', evidence: 'name suggests a score' },
  { pattern: /sentiment|nps/, type: 'Sentiment', evidence: 'name suggests sentiment' },
  { pattern: /(^|_)(count|cnt)(_|$)|num_|number_|_count$|qty|quantity|units|users|orders|sessions|visitors|clicks|views|downloads|items|tickets|customers|employees|subscribers|players/, type: 'Count', evidence: 'name suggests a count' },
];

const CATEGORICAL_NAME_RULES: Array<{ pattern: RegExp; type: string; kind: ColumnKind; evidence: string }> = [
  { pattern: /status|stage|phase/, type: 'Status', kind: 'categorical', evidence: 'name suggests status' },
  { pattern: /country|nation/, type: 'Country', kind: 'categorical', evidence: 'name suggests country' },
  { pattern: /(^|_)(state|province)($|_)/, type: 'State', kind: 'categorical', evidence: 'name suggests state or province' },
  { pattern: /region|territory|zone/, type: 'Region', kind: 'categorical', evidence: 'name suggests region' },
  { pattern: /city|town|metro/, type: 'City', kind: 'categorical', evidence: 'name suggests city' },
  { pattern: /latitude|(^|_)lat($|_)/, type: 'Latitude', kind: 'categorical', evidence: 'name suggests latitude' },
  { pattern: /longitude|(^|_)(lon|lng)($|_)/, type: 'Longitude', kind: 'categorical', evidence: 'name suggests longitude' },
  { pattern: /zip|postal/, type: 'ZipCode', kind: 'categorical', evidence: 'name suggests postal code' },
  { pattern: /address|addr/, type: 'Address', kind: 'categorical', evidence: 'name suggests address' },
  { pattern: /(^|_)id($|_)|^id$|_id$|uuid|guid|sku|(^|_)code($|_)/, type: 'ID', kind: 'identifier', evidence: 'name suggests an identifier' },
  { pattern: /categor|segment|group|type|kind|product|item|brand|channel|department|team|platform|device|source|medium|campaign|vertical|industry|genre|topic|subject|bucket|tier|class|model|variant|market|locale/, type: 'Category', kind: 'categorical', evidence: 'name suggests a category' },
  { pattern: /(^|_)(name|title|label|customer|account|email|domain|url|slug|description)(_|$)/, type: 'Name', kind: 'categorical', evidence: 'name suggests a name or label' },
];

const temporalResult = (type: string, evidence: string): SemanticInference => ({
  semanticType: type,
  kind: 'temporal',
  evidence,
});

function inferTemporal(name: string, values: unknown[]): SemanticInference | null {
  const lower = name.toLowerCase();
  const sample = values.slice(0, 100).map((value) => String(value).trim());
  const first = values[0];
  const allMatch = (pattern: RegExp) => sample.length > 0 && sample.every((entry) => pattern.test(entry));
  const hasTimePart = (value: unknown): boolean =>
    value instanceof Date && (value.getHours() !== 0 || value.getMinutes() !== 0 || value.getSeconds() !== 0);

  if (first instanceof Date) {
    return temporalResult(values.some(hasTimePart) ? 'DateTime' : 'Date', 'Date values');
  }

  if (/quarter|qtr/.test(lower)) {
    if (allMatch(YEAR_QUARTER_PATTERN)) return temporalResult('YearQuarter', 'values like 2026Q1');
    if (allMatch(QUARTER_PATTERN)) return temporalResult('Quarter', 'values like Q1');
    return temporalResult('Quarter', 'column name mentions quarter');
  }

  if (/month/.test(lower)) {
    if (allMatch(YEAR_MONTH_PATTERN)) return temporalResult('YearMonth', 'values like 2026-01');
    if (allMatch(MONTH_NAME_PATTERN)) return temporalResult('Month', 'month names');
    return temporalResult('Month', 'column name mentions month');
  }

  if (/(^|_)year($|_)/.test(lower) && !/month/.test(lower)) {
    return temporalResult('Year', 'column name mentions year');
  }

  if (/week/.test(lower)) {
    if (allMatch(YEAR_WEEK_PATTERN)) return temporalResult('YearWeek', 'ISO week values');
    return temporalResult('Week', 'column name mentions week');
  }

  if (/(^|_)(day|dow|weekday)($|_)/.test(lower)) {
    return temporalResult('Day', 'column name mentions day');
  }

  if (/hour/.test(lower)) {
    return temporalResult('Hour', 'column name mentions hour');
  }

  if (/(^|_)time($|_)/.test(lower) && allMatch(TIME_PATTERN)) {
    return temporalResult('Time', 'time-of-day values');
  }

  if (/date|_dt$|(^|_)dt($|_)/.test(lower)) {
    if (allMatch(DATE_TIME_PATTERN)) return temporalResult('DateTime', 'values with a time part');
    if (allMatch(YEAR_MONTH_DAY_PATTERN)) return temporalResult('Date', 'values like 2026-01-31');
    if (allMatch(YEAR_MONTH_PATTERN)) return temporalResult('YearMonth', 'values like 2026-01');
  }

  if (allMatch(DATE_TIME_PATTERN)) return temporalResult('DateTime', 'date-time values');
  if (allMatch(YEAR_MONTH_DAY_PATTERN)) return temporalResult('Date', 'date values');
  if (allMatch(YEAR_QUARTER_PATTERN)) return temporalResult('YearQuarter', 'values like 2026Q1');
  if (allMatch(QUARTER_PATTERN)) return temporalResult('Quarter', 'values like Q1');
  if (allMatch(YEAR_MONTH_PATTERN)) return temporalResult('YearMonth', 'values like 2026-01');
  if (allMatch(YEAR_WEEK_PATTERN)) return temporalResult('YearWeek', 'ISO week values');
  if (allMatch(MONTH_NAME_PATTERN)) return temporalResult('Month', 'month names');
  if (allMatch(TIME_PATTERN)) return temporalResult('Time', 'time-of-day values');

  if (allMatch(YEAR_PATTERN) && sample.every((entry) => Number(entry) >= 1900) && /year|yr|fy/.test(lower)) {
    return temporalResult('Year', 'four-digit values in a year column');
  }

  return null;
}

export function inferSemanticType(name: string, values: unknown[]): SemanticInference {
  const nonNull = values.filter((value) => value !== null && value !== undefined);
  const lower = name.toLowerCase();

  if (nonNull.length === 0) {
    return { semanticType: 'Unknown', kind: 'categorical', evidence: 'no non-null values' };
  }

  if (nonNull.every((value) => typeof value === 'boolean')) {
    return { semanticType: 'Boolean', kind: 'categorical', evidence: 'boolean values' };
  }

  const temporal = inferTemporal(name, nonNull);
  if (temporal) return temporal;

  const numbers = nonNull.filter((value) => {
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'bigint') return true;
    return false;
  }).length;
  const numericRatio = numbers / nonNull.length;

  if (numericRatio >= 0.8) {
    for (const rule of CATEGORICAL_NAME_RULES) {
      if (rule.kind === 'identifier' && rule.pattern.test(lower)) {
        return { semanticType: rule.type, kind: 'identifier', evidence: 'numeric column with an id-like name' };
      }
    }

    for (const rule of MEASURE_NAME_RULES) {
      if (rule.pattern.test(lower)) {
        return { semanticType: rule.type, kind: 'measure', evidence: rule.evidence };
      }
    }

    return { semanticType: 'Quantity', kind: 'measure', evidence: 'mostly numeric values' };
  }

  for (const rule of CATEGORICAL_NAME_RULES) {
    if (rule.pattern.test(lower)) {
      return { semanticType: rule.type, kind: rule.kind, evidence: rule.evidence };
    }
  }

  if (nonNull.every((value) => typeof value === 'string')) {
    return { semanticType: 'Category', kind: 'categorical', evidence: 'text values' };
  }

  return { semanticType: 'Unknown', kind: 'categorical', evidence: 'mixed values' };
}

export function profileColumns(data: Record<string, unknown>[]): ColumnProfile[] {
  if (data.length === 0) return [];

  const names: string[] = [];
  for (const row of data) {
    for (const key of Object.keys(row)) {
      if (!names.includes(key)) names.push(key);
    }
  }

  return names.map((name) => {
    const values = data.map((row) => row[name]);
    const nonNull = values.filter((value) => value !== null && value !== undefined);
    const distinct = new Set(
      nonNull.map((value) => (value instanceof Date ? value.toISOString() : String(value))),
    ).size;
    const inference = inferSemanticType(name, nonNull.slice(0, 500));

    return {
      name,
      semanticType: inference.semanticType,
      kind: inference.kind,
      distinct,
      nullCount: values.length - nonNull.length,
      evidence: inference.evidence,
    };
  });
}

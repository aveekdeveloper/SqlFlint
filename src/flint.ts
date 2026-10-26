import {
  assembleChartjs,
  assembleECharts,
  assemblePlotly,
  assembleVegaLite,
  stripPrivateKeys,
  validateChart,
} from 'flint-chart';
import * as flintChart from 'flint-chart';
import type { Backend, Diagnostic, FlintChartSpec } from './types.js';

type Assembler = (input: unknown) => Record<string, unknown>;

interface ValidationRecord {
  severity?: string;
  code?: string;
  message?: string;
}

interface ValidationResult {
  valid: boolean;
  warnings?: ValidationRecord[];
  errors?: ValidationRecord[];
}

const assemblers: Record<Backend, Assembler> = {
  echarts: assembleECharts as unknown as Assembler,
  vegalite: assembleVegaLite as unknown as Assembler,
  chartjs: assembleChartjs as unknown as Assembler,
  plotly: assemblePlotly as unknown as Assembler,
};

const validate = validateChart as unknown as (
  input: unknown,
  backend: string,
) => ValidationResult;

const registry = flintChart as unknown as Record<string, unknown>;

const SemanticTypes = registry.SemanticTypes as Record<string, string>;
const THEME_PRESETS = registry.THEME_PRESETS as Record<string, unknown>;
const ecAllTemplateDefs = registry.ecAllTemplateDefs as unknown[];
const vlAllTemplateDefs = registry.vlAllTemplateDefs as unknown[];

export const themePresetIds = new Set<string>(Object.keys(THEME_PRESETS));
export { THEME_PRESETS };

export const semanticTypeNames = new Set<string>(Object.values(SemanticTypes));

const templateNameOf = (definition: unknown): string | null => {
  if (!definition || typeof definition !== 'object') return null;
  const chart = (definition as Record<string, unknown>).chart;
  return typeof chart === 'string' ? chart : null;
};

export const echartsTemplateNames = new Set(
  ecAllTemplateDefs.map(templateNameOf).filter((name): name is string => name !== null),
);

export const vegaliteTemplateNames = new Set(
  vlAllTemplateDefs.map(templateNameOf).filter((name): name is string => name !== null),
);

const normalizeTemplate = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\b(?:the\s+)?(?:chart|plot|diagram|graph)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export function matchTemplateName(raw: string): string | null {
  const wanted = normalizeTemplate(raw);
  if (!wanted) return null;

  const names = [...echartsTemplateNames, ...vegaliteTemplateNames];

  for (const name of names) {
    if (normalizeTemplate(name) === wanted) return name;
  }

  for (const name of names) {
    const normalized = normalizeTemplate(name);
    if (normalized.includes(wanted) || wanted.includes(normalized)) return name;
  }

  return null;
}

export function assembleForBackend(
  spec: FlintChartSpec,
  backend: Backend,
): { spec: Record<string, unknown> | null; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];

  try {
    const validation = validate(spec, backend);

    for (const warning of validation.warnings ?? []) {
      diagnostics.push({
        severity: 'warning',
        code: warning.code ?? 'flint_warning',
        message: warning.message ?? 'Flint warning',
      });
    }

    for (const error of validation.errors ?? []) {
      diagnostics.push({
        severity: 'error',
        code: error.code ?? 'assembly_failed',
        message: error.message ?? 'Flint assembly error',
      });
    }

    if (!validation.valid) return { spec: null, diagnostics };

    const assembled = assemblers[backend](spec);
    const clean = stripPrivateKeys(assembled) as unknown as Record<string, unknown>;
    return { spec: clean, diagnostics };
  } catch (error) {
    return {
      spec: null,
      diagnostics: [
        {
          severity: 'error',
          code: 'assembly_failed',
          message: `Flint ${backend} assembly failed: ${(error as Error).message}`,
        },
      ],
    };
  }
}

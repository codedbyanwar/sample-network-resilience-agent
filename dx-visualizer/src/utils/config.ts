// Centralized app configuration.
// Override any value via VITE_* environment variables (or .env file).
// See .env.example for available options.

import type { MockScenario } from './shared';

export const config = {
  /** Bedrock model ID (without cross-region prefix). */
  bedrockModelId: import.meta.env.VITE_BEDROCK_MODEL_ID || 'global.anthropic.claude-opus-5',

  /** Default AWS region used when no credentials are provided. */
  defaultRegion: import.meta.env.VITE_DEFAULT_REGION || 'us-east-1',

  /**
   * Allow-list of regions to scan during multi-region discovery. Comma-separated
   * (e.g. "ap-southeast-1,ap-southeast-5"). When set, discovery is restricted to
   * ONLY these regions — every other discovered region is skipped and never
   * probed. Use this when an org SCP allows only a known set of regions, so the
   * app never even attempts the denied ones. Takes precedence over
   * excludedRegions. Leave empty to scan all discovered regions.
   */
  allowedRegions: (import.meta.env.VITE_ALLOWED_REGIONS || '')
    .split(',')
    .map((r: string) => r.trim())
    .filter(Boolean),

  /**
   * Regions to skip during multi-region discovery. Comma-separated
   * (e.g. "sa-east-1,us-east-2"). Any listed region is never probed, so it
   * produces no per-region fetch errors — useful when an org SCP denies
   * ec2:Describe* in a region where you have no resources anyway. Ignored when
   * allowedRegions is set (an allow-list is the stricter filter).
   */
  excludedRegions: (import.meta.env.VITE_EXCLUDED_REGIONS || '')
    .split(',')
    .map((r: string) => r.trim())
    .filter(Boolean),

  /** Max tool-use rounds per chat turn. */
  maxToolRounds: Number(import.meta.env.VITE_MAX_TOOL_ROUNDS) || 5,

  /** Default mock scenario shown on first load. */
  defaultScenario: (import.meta.env.VITE_DEFAULT_SCENARIO || 'noResiliency') as MockScenario,

  /** App title shown in the top bar. */
  appTitle: import.meta.env.VITE_APP_TITLE || 'Network Resilience Agent',

  /** Bedrock Guardrail identifier (created in the Bedrock console). */
  bedrockGuardrailId: import.meta.env.VITE_BEDROCK_GUARDRAIL_ID || '',

  /** Bedrock Guardrail version (e.g. "1" or "DRAFT"). */
  bedrockGuardrailVersion: import.meta.env.VITE_BEDROCK_GUARDRAIL_VERSION || 'DRAFT',

  /** App version from package.json, injected at build time. */
  appVersion: __APP_VERSION__,
} as const;

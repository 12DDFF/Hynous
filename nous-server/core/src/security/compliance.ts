/**
 * @module @nous/core/security
 * @description Export compliance, threat model, app store declarations, launch strategy
 * @version 1.0.0
 * @spec Specs/Phase-6-Technical-Services/storm-022
 * @storm Brainstorms/Infrastructure/storm-022-security-auth
 *
 * Export compliance by region, threat model, app store encryption
 * declarations, and phased launch strategy. All functions are pure.
 *
 * @see {@link Specs/Phase-6-Technical-Services/storm-022/spec/compliance.ts} - Spec
 */

import {
  type PrivacyTier,
  type Platform,
  ECCN_CLASSIFICATION,
} from './constants';

import {
  type ExportComplianceConfig,
  type ThreatModelEntry,
  type LaunchPhase,
  type AppStoreDeclaration,
} from './types';

// ============================================================
// THREAT MODEL
// ============================================================

/**
 * Complete threat model from brainstorm Section 8.
 *
 * @see storm-022 v1 revision Section 8 - Threat Model
 */
export const THREAT_MODEL: ThreatModelEntry[] = [
  // === THREATS WE PROTECT AGAINST ===
  {
    threat: 'random_hackers',
    protected_by_standard: true,
    protected_by_private: true,
    description:
      'TLS prevents MITM attacks. Server-side encryption (Standard) protects at rest. E2E (Private) protects even if servers breached.',
  },
  {
    threat: 'curious_employees',
    protected_by_standard: false,
    protected_by_private: true,
    description:
      'Standard: Employees could technically access data. Private: Employees CANNOT access (no keys).',
  },
  {
    threat: 'data_breaches',
    protected_by_standard: true,
    protected_by_private: true,
    description:
      'Standard: Attacker gets encrypted data (Turso encryption). Private: Attacker gets doubly-encrypted data (useless).',
  },
  {
    threat: 'legal_subpoenas',
    protected_by_standard: false,
    protected_by_private: true,
    description:
      'Standard: We must comply if legally compelled. Private: We literally cannot comply (no keys).',
  },

  // === THREATS WE DO NOT PROTECT AGAINST ===
  {
    threat: 'device_malware',
    protected_by_standard: false,
    protected_by_private: false,
    description:
      'If attacker controls your device, game over. We cannot protect against keyloggers, screen capture.',
  },
  {
    threat: 'user_error',
    protected_by_standard: false,
    protected_by_private: false,
    description:
      'Sharing recovery code, weak device passcode, etc. We provide warnings but cannot prevent.',
  },
  {
    threat: 'state_level_actors',
    protected_by_standard: false,
    protected_by_private: false,
    description:
      'Rubber-hose cryptanalysis (coercion), advanced forensics on device. Recommendation: Do not be a nation-state target.',
  },
  {
    threat: 'llm_provider',
    protected_by_standard: false,
    protected_by_private: false,
    description:
      'When you send data to Claude/GPT, that provider sees it. We show consent dialog, but cannot control their servers.',
  },
] as const;

// ============================================================
// EXPORT COMPLIANCE BY REGION
// ============================================================

/**
 * Export compliance requirements by region.
 *
 * @see storm-022 v1 revision Section 7 - Export Compliance
 */
export const EXPORT_COMPLIANCE_BY_REGION: ExportComplianceConfig[] = [
  {
    region: 'us',
    standard_tier: 'exempt',
    private_tier: 'requires_documentation',
    documentation_required: [
      'ECCN 5D992 self-classification',
      'Mass market exemption (License Exception ENC §740.17)',
      'Annual self-classification report to BIS',
    ],
    notes: 'Private tier uses AES-256-GCM (proprietary encryption). ~2 business days Apple review.',
  },
  {
    region: 'general',
    standard_tier: 'exempt',
    private_tier: 'requires_documentation',
    documentation_required: [
      'ECCN 5D992 self-classification',
      'Mass market exemption (License Exception ENC §740.17)',
      'Annual self-classification report to BIS',
    ],
    notes:
      'Most markets follow US export rules. Standard tier uses TLS/HTTPS only (OS-provided), ITSAppUsesNonExemptEncryption = NO.',
  },
  {
    region: 'france',
    standard_tier: 'exempt',
    private_tier: 'excluded',
    documentation_required: [
      'ECCN 5D992 self-classification',
      'French encryption declaration (ANSSI)',
      'Additional 1-month review period',
    ],
    notes:
      'France requires additional encryption declaration with ~1 month review. Recommendation: Exclude France at launch, add after approval.',
  },
] as const;

// ============================================================
// LAUNCH STRATEGY
// ============================================================

/**
 * Three-phase launch strategy for compliance rollout.
 *
 * @see storm-022 v1 revision Section 7 - Launch Strategy
 */
export const LAUNCH_STRATEGY: LaunchPhase[] = [
  {
    version: 'v1.0',
    features: ['Standard tier only', 'Clerk auth', 'Cloud search', 'Seamless LLM'],
    markets: ['All markets'],
    compliance_requirements: ['No encryption documentation required', 'ITSAppUsesNonExemptEncryption = NO'],
  },
  {
    version: 'v1.1',
    features: [
      'Add Private tier',
      'E2E encryption (AES-256-GCM)',
      'Client-side HNSW search',
      'LLM consent dialogs',
      'Passkey-derived key hierarchy',
      'Recovery codes (BIP39)',
    ],
    markets: ['US', 'Most international markets'],
    compliance_requirements: [
      'ECCN 5D992 self-classification filed',
      'Mass market exemption (License Exception ENC §740.17)',
      'Annual BIS self-classification report',
      'ITSAppUsesNonExemptEncryption = YES',
      'Google Play encryption declaration',
    ],
  },
  {
    version: 'v1.2',
    features: ['Add France support for Private tier'],
    markets: ['France (Private tier)'],
    compliance_requirements: [
      'French encryption declaration (ANSSI) approved',
      'All v1.1 requirements maintained',
    ],
  },
] as const;

// ============================================================
// APP STORE DECLARATIONS
// ============================================================

/**
 * App store encryption declarations for both launch phases.
 *
 * @see storm-022 v1 revision Section 7 - iOS/Google Play compliance
 */
export const APP_STORE_DECLARATIONS: {
  standard_only: AppStoreDeclaration[];
  with_private_tier: AppStoreDeclaration[];
} = {
  standard_only: [
    { platform: 'ios', uses_non_exempt_encryption: false, self_classification_filed: false },
    { platform: 'android', uses_non_exempt_encryption: false, self_classification_filed: false },
    { platform: 'macos', uses_non_exempt_encryption: false, self_classification_filed: false },
    { platform: 'windows', uses_non_exempt_encryption: false, self_classification_filed: false },
  ],
  with_private_tier: [
    { platform: 'ios', uses_non_exempt_encryption: true, eccn: ECCN_CLASSIFICATION, mass_market_exemption: true, self_classification_filed: true },
    { platform: 'android', uses_non_exempt_encryption: true, eccn: ECCN_CLASSIFICATION, mass_market_exemption: true, self_classification_filed: true },
    { platform: 'macos', uses_non_exempt_encryption: true, eccn: ECCN_CLASSIFICATION, mass_market_exemption: true, self_classification_filed: true },
    { platform: 'windows', uses_non_exempt_encryption: true, eccn: ECCN_CLASSIFICATION, mass_market_exemption: true, self_classification_filed: true },
  ],
} as const;

// ============================================================
// PURE FUNCTIONS
// ============================================================

/**
 * Gets export compliance requirements for a tier in a region.
 *
 * @param tier - Privacy tier to check
 * @param region - Region identifier (e.g., 'us', 'france', 'general')
 * @returns Compliance config for the region, or general config if region not found
 */
export function getComplianceRequirements(
  tier: PrivacyTier,
  region: string,
): ExportComplianceConfig {
  const config = EXPORT_COMPLIANCE_BY_REGION.find((c) => c.region === region);
  if (config) {
    return config;
  }
  // Fall back to 'general' config
  const general = EXPORT_COMPLIANCE_BY_REGION.find((c) => c.region === 'general');
  return general!;
}

/**
 * Returns the complete threat model.
 *
 * @returns All threat model entries
 */
export function getThreatModel(): ThreatModelEntry[] {
  return [...THREAT_MODEL];
}

/**
 * Returns the phased launch strategy.
 *
 * @returns All launch phases in order
 */
export function getLaunchStrategy(): LaunchPhase[] {
  return [...LAUNCH_STRATEGY];
}

/**
 * Checks whether a region supports a given privacy tier.
 *
 * @param region - Region identifier
 * @param tier - Privacy tier to check
 * @returns True if the tier is available in the region (not 'excluded')
 */
export function isRegionSupported(region: string, tier: PrivacyTier): boolean {
  const config = EXPORT_COMPLIANCE_BY_REGION.find((c) => c.region === region);
  if (!config) {
    // Unknown regions fall back to general rules
    return true;
  }

  if (tier === 'standard') {
    return config.standard_tier !== 'excluded';
  }

  return config.private_tier !== 'excluded';
}

/**
 * Gets app store declarations for a platform based on current launch phase.
 *
 * @param platform - Target platform
 * @param includes_private_tier - Whether Private tier is enabled
 * @returns App store declaration for the platform
 */
export function getAppStoreDeclaration(
  platform: Platform,
  includes_private_tier: boolean,
): AppStoreDeclaration {
  const declarations = includes_private_tier
    ? APP_STORE_DECLARATIONS.with_private_tier
    : APP_STORE_DECLARATIONS.standard_only;

  const declaration = declarations.find((d) => d.platform === platform);
  return declaration!;
}

/**
 * Gets threats that a specific tier protects against.
 *
 * @param tier - Privacy tier to check
 * @returns Threat entries where the tier provides protection
 */
export function getProtectedThreats(tier: PrivacyTier): ThreatModelEntry[] {
  return THREAT_MODEL.filter((entry) =>
    tier === 'standard' ? entry.protected_by_standard : entry.protected_by_private,
  );
}

/**
 * Gets threats that a specific tier does NOT protect against.
 *
 * @param tier - Privacy tier to check
 * @returns Threat entries where the tier provides no protection
 */
export function getUnprotectedThreats(tier: PrivacyTier): ThreatModelEntry[] {
  return THREAT_MODEL.filter((entry) =>
    tier === 'standard' ? !entry.protected_by_standard : !entry.protected_by_private,
  );
}

/**
 * @module @nous/core/working-memory/types
 * @description All interfaces and Zod schemas for storm-035 Working Memory
 * @version 1.0.0
 * @spec Specs/Phase-4-Memory-Lifecycle/storm-035
 * @storm Brainstorms/Infrastructure/storm-035-working-memory
 */

import { z } from 'zod';
import {
  PROMOTION_TRIGGERS,
  WM_STATUSES,
  PROMOTION_THRESHOLD,
  SCORE_DECAY_PER_DAY,
  WM_CHECK_INTERVAL_MINUTES,
  WM_DURATION_MULTIPLIER_RANGE,
  type PromotionTrigger,
  type WMStatus,
} from './constants';

// ============================================================
// TRIGGER EVENT
// ============================================================

export interface TriggerEvent {
  type: PromotionTrigger;
  timestamp: Date;
  score_contribution: number;
  details?: Record<string, unknown>;
}

export const TriggerEventSchema = z.object({
  type: z.enum(PROMOTION_TRIGGERS),
  timestamp: z.date(),
  score_contribution: z.number().min(0).max(1),
  details: z.record(z.unknown()).optional(),
});

// ============================================================
// WORKING MEMORY STATE
// ============================================================

export interface WorkingMemoryState {
  entered_at: Date;
  expires_at: Date;
  content_category: string;
  promotion_score: number;
  score_last_updated: Date;
  trigger_events: TriggerEvent[];
  status: WMStatus;
  resolved_at?: Date;
  resolution_reason?: string;
}

export const WorkingMemoryStateSchema = z.object({
  entered_at: z.date(),
  expires_at: z.date(),
  content_category: z.string(),
  promotion_score: z.number().min(0).max(1),
  score_last_updated: z.date(),
  trigger_events: z.array(TriggerEventSchema),
  status: z.enum(WM_STATUSES),
  resolved_at: z.date().optional(),
  resolution_reason: z.string().optional(),
});

// ============================================================
// WORKING MEMORY CONFIG
// ============================================================

export interface WorkingMemoryConfig {
  duration_hours: Record<string, number>;
  user_duration_multiplier: number;
  promotion_threshold: number;
  score_decay_per_day: number;
  check_interval_minutes: number;
  manual_bypass: boolean;
}

export const WorkingMemoryConfigSchema = z.object({
  duration_hours: z.record(z.number().positive()),
  user_duration_multiplier: z.number()
    .min(WM_DURATION_MULTIPLIER_RANGE[0])
    .max(WM_DURATION_MULTIPLIER_RANGE[1])
    .default(1.0),
  promotion_threshold: z.number().min(0).max(1).default(PROMOTION_THRESHOLD),
  score_decay_per_day: z.number().min(0).max(1).default(SCORE_DECAY_PER_DAY),
  check_interval_minutes: z.number().positive().default(WM_CHECK_INTERVAL_MINUTES),
  manual_bypass: z.boolean().default(true),
});

// ============================================================
// PROMOTION RESULT
// ============================================================

export interface PromotionResult {
  nodeId: string;
  finalScore: number;
  durationHours: number;
  triggerCount: number;
  reason: string;
  promotedAt: Date;
  initialStability: number;
  initialDifficulty: number;
}

export const PromotionResultSchema = z.object({
  nodeId: z.string(),
  finalScore: z.number().min(0).max(1),
  durationHours: z.number().min(0),
  triggerCount: z.number().min(0),
  reason: z.string(),
  promotedAt: z.date(),
  initialStability: z.number().positive(),
  initialDifficulty: z.number().min(0).max(1),
});

// ============================================================
// FADE RESULT
// ============================================================

export interface FadeResult {
  nodeId: string;
  finalScore: number;
  durationHours: number;
  triggerCount: number;
  reason: string;
  fadedAt: Date;
}

export const FadeResultSchema = z.object({
  nodeId: z.string(),
  finalScore: z.number().min(0).max(1),
  durationHours: z.number().min(0),
  triggerCount: z.number().min(0),
  reason: z.string(),
  fadedAt: z.date(),
});

// ============================================================
// RESTORATION RESULT
// ============================================================

export interface RestorationResult {
  nodeId: string;
  restoredAt: Date;
  initialStability: number;
  newStrength: number;
}

export const RestorationResultSchema = z.object({
  nodeId: z.string(),
  restoredAt: z.date(),
  initialStability: z.number().positive(),
  newStrength: z.number().min(0).max(1),
});

// ============================================================
// EVALUATION RESULT
// ============================================================

export interface EvaluationResult {
  evaluated: number;
  promoted: number;
  faded: number;
  stillPending: number;
  errors: string[];
  evaluatedAt: Date;
  durationMs: number;
}

export const EvaluationResultSchema = z.object({
  evaluated: z.number().min(0),
  promoted: z.number().min(0),
  faded: z.number().min(0),
  stillPending: z.number().min(0),
  errors: z.array(z.string()),
  evaluatedAt: z.date(),
  durationMs: z.number().min(0),
});

// ============================================================
// WORKING MEMORY ENTRY OPTIONS
// ============================================================

export interface WMEntryOptions {
  contentCategory: string;
  initialScore?: number;
  durationMultiplier?: number;
  skipIfExists?: boolean;
}

export const WMEntryOptionsSchema = z.object({
  contentCategory: z.string(),
  initialScore: z.number().min(0).max(1).optional(),
  durationMultiplier: z.number()
    .min(WM_DURATION_MULTIPLIER_RANGE[0])
    .max(WM_DURATION_MULTIPLIER_RANGE[1])
    .optional(),
  skipIfExists: z.boolean().optional(),
});

// ============================================================
// SCORE CALCULATION INPUT
// ============================================================

export interface ScoreCalculationInput {
  promotionScore: number;
  scoreLastUpdated: Date;
  now?: Date;
}

export const ScoreCalculationInputSchema = z.object({
  promotionScore: z.number().min(0).max(1),
  scoreLastUpdated: z.date(),
  now: z.date().optional(),
});

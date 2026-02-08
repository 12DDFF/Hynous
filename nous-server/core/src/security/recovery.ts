/**
 * @module @nous/core/security
 * @description Recovery system: BIP39 codes, forced verification, grace period
 * @version 1.0.0
 * @spec Specs/Phase-6-Technical-Services/storm-022
 * @storm Brainstorms/Infrastructure/storm-022-security-auth
 *
 * 24-word BIP39 recovery, forced verification, 7-day grace period,
 * recovery code regeneration, and periodic reminders.
 *
 * @see {@link Specs/Phase-6-Technical-Services/storm-022/spec/recovery.ts} - Spec
 */

import {
  type RecoveryReminderType,
  RECOVERY_WORD_COUNT,
  RECOVERY_VERIFICATION_WORD_COUNT,
} from './constants';

import {
  type RecoveryRegenerationResult,
  type RecoveryReminder,
} from './types';

// ============================================================
// RECOVERY CONSTANTS
// ============================================================

/**
 * HKDF info string for deriving recovery key from BIP39 entropy.
 *
 * @see storm-022 v2 Section 9.5
 */
export const RECOVERY_DERIVATION_INFO = 'nous-recovery';

/**
 * Recovery key length in bytes (32 bytes = 256 bits).
 */
export const RECOVERY_KEY_LENGTH_BYTES = 32;

// ============================================================
// RECOVERY REMINDER MESSAGES
// ============================================================

/**
 * Default reminder messages for each recovery reminder type.
 *
 * @see storm-022 v1 revision Section 3 - Periodic Reminders
 */
export const RECOVERY_REMINDER_MESSAGES: Record<RecoveryReminderType, string> = {
  initial: 'Have you stored your recovery code safely? Without it, your data cannot be recovered if you lose all your devices.',
  periodic: 'Recovery code reminder: Make sure your recovery code is still accessible. If you\'ve lost it, regenerate a new one in Settings > Security.',
  new_device: 'Welcome to your new device. Remember, your recovery code is the ultimate backup if you lose access to all your devices.',
} as const;

// ============================================================
// OLD CODE ERROR MESSAGE
// ============================================================

/**
 * Error message shown when user attempts to use an invalidated recovery code.
 *
 * @see storm-022 v2 Section 9.5 - Old Code Behavior
 */
export const OLD_CODE_ERROR_MESSAGE =
  'This recovery code is no longer valid. It was replaced on {date}. If you didn\'t change your passkey, contact support immediately.';

// ============================================================
// PURE FUNCTIONS
// ============================================================

/**
 * Selects random word indices for forced verification.
 * Returns RECOVERY_VERIFICATION_WORD_COUNT (3) random indices
 * from the 24-word mnemonic.
 *
 * @returns Array of 3 unique random indices (0 to 23)
 */
export function getVerificationIndices(): number[] {
  const indices: number[] = [];
  while (indices.length < RECOVERY_VERIFICATION_WORD_COUNT) {
    const idx = Math.floor(Math.random() * RECOVERY_WORD_COUNT);
    if (!indices.includes(idx)) {
      indices.push(idx);
    }
  }
  return indices.sort((a, b) => a - b);
}

/**
 * Verifies the user's answers during forced verification.
 * Checks that the words at the specified indices match.
 *
 * @param mnemonic - The full 24-word recovery code
 * @param indices - The 3 indices being verified
 * @param answers - The user's 3 answers
 * @returns True if all answers match (case-insensitive)
 */
export function verifyRecoveryWords(
  mnemonic: string[],
  indices: number[],
  answers: string[],
): boolean {
  if (indices.length !== answers.length) {
    return false;
  }

  return indices.every((index, i) => {
    const expected = mnemonic[index];
    const answer = answers[i];
    if (expected === undefined || answer === undefined) {
      return false;
    }
    return expected.toLowerCase() === answer.toLowerCase();
  });
}

// ============================================================
// EXTERNAL SERVICE FUNCTIONS
// ============================================================

/**
 * Generates a new 24-word BIP39 recovery mnemonic.
 * Requires BIP39 library and crypto.getRandomValues.
 *
 * @returns Array of 24 BIP39-compliant words
 */
export function generateRecoveryCode(): string[] {
  throw new Error('generateRecoveryCode requires BIP39 library implementation');
}

/**
 * Derives a CryptoKey from a BIP39 mnemonic for recovery purposes.
 * Requires BIP39 library and Web Crypto API.
 *
 * @param _mnemonic - The 24-word BIP39 mnemonic
 * @returns Recovery CryptoKey (AES-256-GCM)
 */
export async function deriveRecoveryKey(
  _mnemonic: string[],
): Promise<CryptoKey> {
  throw new Error('deriveRecoveryKey requires BIP39 library and Web Crypto API implementation');
}

/**
 * Encrypts the user's master key with the recovery key.
 * Requires Web Crypto API.
 *
 * @param _master_key - The user's master CryptoKey
 * @param _recovery_key - CryptoKey derived from recovery mnemonic
 * @returns Encrypted master key blob
 */
export async function encryptMasterKeyForRecovery(
  _master_key: CryptoKey,
  _recovery_key: CryptoKey,
): Promise<Uint8Array> {
  throw new Error('encryptMasterKeyForRecovery requires Web Crypto API implementation');
}

/**
 * Recovers the master key using a recovery mnemonic.
 * Requires BIP39 library and Web Crypto API.
 *
 * @param _mnemonic - The 24-word BIP39 mnemonic
 * @param _encrypted_master - Encrypted master key blob from server
 * @returns Recovered master CryptoKey
 */
export async function recoverMasterKey(
  _mnemonic: string[],
  _encrypted_master: Uint8Array,
): Promise<CryptoKey> {
  throw new Error('recoverMasterKey requires BIP39 library and Web Crypto API implementation');
}

/**
 * Regenerates the recovery code, invalidating the old one.
 * Requires BIP39 library, Web Crypto API, and server-side storage.
 *
 * @param _user_id - User whose recovery code is being regenerated
 * @param _master_key - Current master CryptoKey
 * @returns Regeneration result with new mnemonic
 */
export async function regenerateRecoveryCode(
  _user_id: string,
  _master_key: CryptoKey,
): Promise<RecoveryRegenerationResult> {
  throw new Error('regenerateRecoveryCode requires BIP39 library and server integration');
}

/**
 * Checks whether the grace period is still active for a user.
 * Requires server-side grace period state lookup.
 *
 * @param _user_id - User ID
 * @returns True if grace period is active
 */
export async function isGracePeriodActive(
  _user_id: string,
): Promise<boolean> {
  throw new Error('isGracePeriodActive requires server-side state lookup');
}

/**
 * Recovers the master key via email during the grace period.
 * Requires server-side email verification.
 *
 * @param _user_id - User ID
 * @param _email_token - Email verification token
 * @returns Recovered master CryptoKey
 */
export async function recoverViaEmail(
  _user_id: string,
  _email_token: string,
): Promise<CryptoKey> {
  throw new Error('recoverViaEmail requires server-side email verification implementation');
}

/**
 * Gets the current recovery reminder for a user, if any.
 * Requires server-side reminder state lookup.
 *
 * @param _user_id - User ID
 * @returns Recovery reminder or null if none due
 */
export function getRecoveryReminder(
  _user_id: string,
): RecoveryReminder | null {
  throw new Error('getRecoveryReminder requires server-side state lookup');
}

/**
 * Dismisses a recovery reminder for a user.
 * Requires server-side state update.
 *
 * @param _user_id - User ID
 * @param _reminder_type - Type of reminder being dismissed
 */
export async function dismissRecoveryReminder(
  _user_id: string,
  _reminder_type: RecoveryReminderType,
): Promise<void> {
  throw new Error('dismissRecoveryReminder requires server-side state update');
}

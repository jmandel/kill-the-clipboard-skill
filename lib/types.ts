// Shared API + protocol types (DESIGN.md §4). FROZEN during parallel build:
// interface changes route through the orchestrator, never made unilaterally by a unit.

// --- Control plane --------------------------------------------------------------------

export interface CreateLinkRequest {
  /** base64url HKDF(M, "ktc-shl/v1/auth"); server stores sha256 only. */
  auth: string;
  /** Flag chars in alphabetical order. Default "U". */
  flag?: string;
  /** Epoch seconds. Required (KTC). */
  exp: number;
  /** null/undefined = unlimited. */
  maxUses?: number | null;
  /** Only meaningful with P flag. */
  passcode?: string;
  /** ≤80 chars. */
  label?: string;
}

export interface CreateLinkResponse {
  id: string;
  /** Data-plane URL to embed as the shlink payload `url`. */
  url: string;
}

export interface FileMeta {
  fileId: string;
  contentType: string;
  size: number;
  lastUpdated: string; // ISO 8601
}

export type AccessAction = 'direct' | 'manifest' | 'file';
export type AccessOutcome = 'ok' | 'bad-passcode' | 'inactive';

export interface AccessEntry {
  ts: string; // ISO 8601
  recipient: string;
  action: AccessAction;
  outcome: AccessOutcome;
}

export interface ManageState {
  id: string;
  url: string;
  flag: string;
  label: string | null;
  exp: number;
  maxUses: number | null;
  uses: number;
  active: boolean;
  /** Derived: serving right now? (active && !expired && !exhausted && !locked && !purged) */
  live: boolean;
  purgedAt: string | null;
  passcodeAttemptsRemaining: number | null;
  createdAt: string;
  files: FileMeta[];
  accessLog: AccessEntry[];
}

export interface ManagePatch {
  exp?: number;
  maxUses?: number | null;
  active?: boolean;
  /** Set/replace passcode (P-flag links); null clears nothing — passcode removal not supported. */
  passcode?: string;
  label?: string;
}

export interface AddFileResponse {
  fileId: string;
}

export interface ApiError {
  error: string;
}

// --- Data plane (spec-shaped) ---------------------------------------------------------

export interface ManifestRequest {
  recipient: string;
  passcode?: string;
  embeddedLengthMax?: number;
}

export interface ManifestFile {
  contentType: string;
  location?: string;
  embedded?: string;
  lastUpdated?: string;
}

export interface Manifest {
  status?: 'finalized' | 'can-change' | 'no-longer-valid';
  files: ManifestFile[];
}

export interface PasscodeError {
  remainingAttempts: number;
}

// --- Script stdout contracts (stable shapes agents parse; secrets NEVER appear here) ---

export interface CreateShlOutput {
  status: 'created';
  id: string;
  label: string | null;
  flag: string;
  exp: number;
  maxUses: number | null;
  files: { contentType: string; size: number }[];
  /** Paths to secret-bearing artifacts written to disk. */
  artifacts: { ownerLink: string; shlink: string; viewerLink: string; qrPng: string; meta: string };
}

export interface ValidateOutput {
  status: 'pass' | 'fail';
  errors: { code: string; path: string; message: string }[];
  warnings: { code: string; path: string; message: string }[];
}

// Shared API + protocol types (docs/DESIGN.md §4). FROZEN during parallel build:
// interface changes route through the orchestrator, never made unilaterally by a unit.

// --- Control plane --------------------------------------------------------------------

// The control capability (auth = base64url HKDF(M, "ktc-shl/v1/auth")) travels in the
// Authorization: Bearer header — NEVER in the URL path or body, where proxies and
// access logs retain it. The server stores sha256(auth) only.
export interface CreateLinkRequest {
  /** Flag chars in alphabetical order. Default "U". */
  flag?: string;
  /** Epoch seconds. Required (KTC). */
  exp: number;
  /** null/undefined = unlimited. */
  maxUses?: number | null;
  /** Only meaningful with P flag. */
  passcode?: string;
  /**
   * Label, JWE-encrypted client-side with the link key (compact serialization,
   * cty text/plain) — OPAQUE to the server. Receivers get the plaintext label
   * inside the encrypted shlink payload; the owner page decrypts this copy for
   * display and QR rebuilds. The server never learns the patient's name.
   */
  labelEnc?: string;
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
  /** JWE-encrypted label (see CreateLinkRequest.labelEnc); null when none was set. */
  labelEnc: string | null;
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
  /** Replacement label, JWE-encrypted client-side (see CreateLinkRequest.labelEnc). */
  labelEnc?: string;
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

// --- Script stdout contracts (stable shapes agents parse) ------------------------------
// Relay secrets (owner link, shlink — patient deliverables) MAY appear here; the bare
// master secret / derived key / auth as standalone strings NEVER do (CLAUDE.md tiers).

export interface CreateShlOutput {
  status: 'created';
  id: string;
  label: string | null;
  flag: string;
  exp: number;
  maxUses: number | null;
  files: { contentType: string; size: number }[];
  /** The complete closing chat message — owner page as a markdown link, shlink as
   * inline code, lifetime filled in. The agent pastes this verbatim; composing it
   * by hand is the documented failure mode. */
  handoffMarkdown: string;
  /** Paths to artifacts written to disk. `handoff` is the durable copy of
   * `handoffMarkdown`; `ownerLink`/`shlink` files are what manage-shl.ts reads. */
  artifacts: { ownerLink: string; shlink: string; viewerLink: string; qrPng: string; meta: string; handoff: string };
}

export interface ValidateOutput {
  status: 'pass' | 'fail';
  errors: { code: string; path: string; message: string }[];
  warnings: { code: string; path: string; message: string }[];
}

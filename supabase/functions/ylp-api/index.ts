import type {
  ApiFailure,
  ApiRequest,
  ApiResponse,
  BackendAdapter,
  CreateSessionPayload,
  CreateSessionRpcInput,
  Direction,
  EdgeConfig,
  JwtClaims,
  QrKeyring,
  RateLimitDecision,
  RateLimitScope,
  ScanPayload,
  ScanRpcInput,
} from './types.ts';
import { UnknownBehaviorError } from './types.ts';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STUDENT_ID = /^[a-zA-Z0-9_-]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const CONTROL = /[\x00-\x1f\x7f]/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const QR_TOKEN = /^(?:[A-Za-z0-9_-]{43}|[0-9a-fA-F]{64})$/;
const QR_ENVELOPE_VERSION = 'v1';
const QR_AAD_LABEL = 'qr-token-v1';
const QR_NONCE_BYTES = 12;
const QR_TAG_BYTES = 16;
const JWT_ALGORITHMS = new Set(['RS256', 'ES256']);

export const SCAN_REJECTED = 'scan_rejected';
export const RATE_LIMIT_ERROR = 'Too many requests. Please try again later.';

export interface RateLimitPolicy {
  readonly scope: RateLimitScope;
  readonly limit: number;
  readonly windowSeconds: number;
}

export const RATE_LIMIT_POLICIES: Readonly<Record<RateLimitScope, RateLimitPolicy>> = {
  'login-global': { scope: 'login-global', limit: 30, windowSeconds: 300 },
  'public-session-global': { scope: 'public-session-global', limit: 600, windowSeconds: 60 },
  'scan-global': { scope: 'scan-global', limit: 1200, windowSeconds: 60 },
  'scan-student-session': { scope: 'scan-student-session', limit: 12, windowSeconds: 60 },
};

export class ValidationError extends Error {
  readonly publicCode?: string;
  constructor(message: string, publicCode?: string) {
    super(message);
    this.name = 'ValidationError';
    this.publicCode = publicCode;
  }
}

export class RateLimitExceededError extends Error {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super(RATE_LIMIT_ERROR);
    this.name = 'RateLimitExceededError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class AuthenticationError extends Error {
  constructor(message = 'Authentication failed.') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class CryptoEnvelopeError extends Error {
  constructor(message = 'The class QR could not be processed.') {
    super(message);
    this.name = 'CryptoEnvelopeError';
  }
}

/** Version 3 requestId(value): no trim; string UUID v4 only; lowercased. */
export function normalizeUuidV4(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4.test(value)) {
    throw new ValidationError('A valid UUID v4 request_id is required.');
  }
  return value.toLowerCase();
}

/** Version 3 Phoenix.studentId(value): String conversion, trim, controls/max-40, ASCII allow-list. */
export function normalizeStudentId(value: unknown): string {
  const text = String(value == null ? '' : value).trim();
  if (!text || text.length > 40 || CONTROL.test(text) || !STUDENT_ID.test(text)) {
    throw new ValidationError('Student ID may contain letters, numbers, _ and -.');
  }
  return text;
}

/** Version 3 fingerprint-name component: nullish-to-empty, String, trim, NFC. */
export function normalizeFingerprintStudentName(value: unknown): string {
  return String(value == null ? '' : value).trim().normalize('NFC');
}

/** Version 3 persisted guest-name path: Phoenix.clean, without NFC. */
export function cleanGuestStudentName(value: unknown): string {
  const text = String(value == null ? '' : value).trim();
  if (!text || text.length > 100 || CONTROL.test(text)) {
    throw new ValidationError('Invalid student name.', SCAN_REJECTED);
  }
  return text;
}

/** Compact Version 3 scan fingerprint array serialization. */
export function serializeScanFingerprint(
  sessionId: string,
  studentId: string,
  direction: Direction,
  studentName: unknown,
): string {
  return JSON.stringify([
    sessionId,
    studentId,
    direction,
    normalizeFingerprintStudentName(studentName),
  ]);
}

/** SHA-256 over UTF-8 bytes represented as padded web-safe Base64. */
export async function sha256WebSafeBase64(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_');
}

/** Version 3-compatible QR hash input: hash raw token, never log it. */
export async function hashQrToken(rawQrToken: unknown): Promise<string> {
  if (typeof rawQrToken !== 'string' || !QR_TOKEN.test(rawQrToken)) {
    throw new ValidationError('Invalid class QR. Please scan the QR shared by your teacher.');
  }
  return sha256WebSafeBase64(rawQrToken);
}

function requireSessionText(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new ValidationError(`Invalid ${label}.`);
  return value.trim();
}

function validateSessionSchedule(fields: {
  date: string;
  start_time: string;
  end_time: string;
}, offset: string): void {
  if (!DATE.test(fields.date) || !TIME.test(fields.start_time) || !TIME.test(fields.end_time)) {
    throw new ValidationError('Invalid date or time.');
  }
  const start = new Date(`${fields.date}T${fields.start_time}:00${offset}`);
  const end = new Date(`${fields.date}T${fields.end_time}:00${offset}`);
  const utcDate = new Date(`${fields.date}T00:00:00Z`).toISOString().slice(0, 10);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || utcDate !== fields.date) {
    throw new ValidationError('End time must follow start time on the same day.');
  }
}

/** Exact Version 3 semantic session normalization used for retry comparison. */
export function normalizeCreateSessionFields(
  payload: CreateSessionPayload,
  offset: string,
): { course: string; date: string; start_time: string; end_time: string; late_threshold: number } {
  const courseText = requireSessionText(payload.course, 'course');
  const course = courseText.normalize('NFC');
  if (!course || course.length > 120 || CONTROL.test(course)) {
    throw new ValidationError('Invalid course.');
  }
  const date = requireSessionText(payload.date, 'date');
  const start_time = requireSessionText(payload.start_time, 'start time');
  const end_time = requireSessionText(payload.end_time, 'end time');
  const thresholdText = typeof payload.late_threshold === 'number'
    ? String(payload.late_threshold)
    : requireSessionText(payload.late_threshold, 'late threshold');
  if (!/^\d+(?:\.0+)?$/.test(thresholdText)) {
    throw new ValidationError('Invalid late threshold.');
  }
  const late_threshold = Number(thresholdText);
  const fields = { course, date, start_time, end_time, late_threshold };
  validateSessionSchedule(fields, offset);
  if (!Number.isInteger(late_threshold) || late_threshold > 240) {
    throw new ValidationError('Late threshold must be 0–240 minutes.');
  }
  return fields;
}

/** New approved decision: compact array, SHA-256 UTF-8, padded web-safe Base64. */
export async function canonicalSessionFingerprint(
  payload: CreateSessionPayload,
  offset: string,
): Promise<string> {
  const fields = normalizeCreateSessionFields(payload, offset);
  return sha256WebSafeBase64(JSON.stringify([
    fields.course,
    fields.date,
    fields.start_time,
    fields.end_time,
    fields.late_threshold,
  ]));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!value || !BASE64URL.test(value)) throw new CryptoEnvelopeError('Malformed QR envelope.');
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new CryptoEnvelopeError('Malformed QR envelope.');
  }
}

function qrAad(sessionId: string): Uint8Array {
  return new TextEncoder().encode(`YLP-attendance-staging | ${sessionId} | ${QR_AAD_LABEL}`);
}

function decodeAesKey(keyId: string, encoded: string): Promise<CryptoKey> {
  const raw = base64UrlToBytes(encoded);
  if (raw.length !== 32) throw new CryptoEnvelopeError('Invalid QR encryption key.');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function validateKeyring(keyring: QrKeyring): void {
  if (!keyring.currentKeyId || !keyring.keys[keyring.currentKeyId]) {
    throw new CryptoEnvelopeError('QR encryption key configuration is invalid.');
  }
  for (const [keyId, encoded] of Object.entries(keyring.keys)) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId)) throw new CryptoEnvelopeError('QR key ID is invalid.');
    const raw = base64UrlToBytes(encoded);
    if (raw.length !== 32) throw new CryptoEnvelopeError('QR encryption key must be 32 bytes.');
  }
}

/** Approved QR plaintext: 32 random bytes encoded as unpadded base64url. */
export function generateQrToken(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** Approved envelope: ylpqr:v1:<key-id>:<base64url nonce>:<base64url ciphertext-and-tag>. */
export async function encryptQrToken(rawQrToken: string, sessionId: string, keyring: QrKeyring): Promise<string> {
  if (!QR_TOKEN.test(rawQrToken) || !sessionId) throw new CryptoEnvelopeError('Invalid QR plaintext.');
  validateKeyring(keyring);
  const keyId = keyring.currentKeyId;
  const key = await decodeAesKey(keyId, keyring.keys[keyId]);
  const nonce = crypto.getRandomValues(new Uint8Array(QR_NONCE_BYTES));
  try {
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: qrAad(sessionId), tagLength: QR_TAG_BYTES * 8 },
      key,
      new TextEncoder().encode(rawQrToken),
    );
    return `ylpqr:${QR_ENVELOPE_VERSION}:${keyId}:${bytesToBase64Url(nonce)}:${bytesToBase64Url(new Uint8Array(encrypted))}`;
  } catch {
    throw new CryptoEnvelopeError();
  }
}

/** Decrypts and authenticates an approved envelope; all crypto failures are generic. */
export async function decryptQrToken(envelope: string, sessionId: string, keyring: QrKeyring): Promise<string> {
  if (typeof envelope !== 'string' || !sessionId) throw new CryptoEnvelopeError('Malformed QR envelope.');
  validateKeyring(keyring);
  const parts = envelope.split(':');
  if (parts.length !== 5 || parts[0] !== 'ylpqr' || parts[1] !== QR_ENVELOPE_VERSION) {
    throw new CryptoEnvelopeError('Unsupported QR envelope version.');
  }
  const [, , keyId, nonceEncoded, ciphertextEncoded] = parts;
  if (!keyring.keys[keyId]) throw new CryptoEnvelopeError('QR encryption key is unavailable.');
  const nonce = base64UrlToBytes(nonceEncoded);
  const ciphertextAndTag = base64UrlToBytes(ciphertextEncoded);
  if (nonce.length !== QR_NONCE_BYTES || ciphertextAndTag.length <= QR_TAG_BYTES) {
    throw new CryptoEnvelopeError('Malformed QR envelope.');
  }
  const key = await decodeAesKey(keyId, keyring.keys[keyId]);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: qrAad(sessionId), tagLength: QR_TAG_BYTES * 8 },
      key,
      ciphertextAndTag,
    );
    const rawQrToken = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
    if (!QR_TOKEN.test(rawQrToken)) throw new CryptoEnvelopeError('Invalid QR plaintext.');
    return rawQrToken;
  } catch {
    throw new CryptoEnvelopeError();
  }
}

/** Build the exact opaque payload accepted by ylp_create_session_v1. */
export async function buildCreateSessionRpcInput(
  payload: CreateSessionPayload,
  offset: string,
  qrTokenHash: string,
  qrTokenCiphertext: string,
): Promise<CreateSessionRpcInput> {
  const requestId = normalizeUuidV4(payload.request_id);
  const fields = normalizeCreateSessionFields(payload, offset);
  if (!qrTokenHash || !qrTokenCiphertext) {
    throw new CryptoEnvelopeError('QR encryption output is required.');
  }
  return {
    p_request_id: requestId,
    p_course: fields.course,
    p_scheduled_date: fields.date,
    p_start_time_local: fields.start_time,
    p_end_time_local: fields.end_time,
    p_late_threshold: fields.late_threshold,
    p_qr_token_hash: qrTokenHash,
    p_qr_token_ciphertext: qrTokenCiphertext,
    p_fingerprint: await sha256WebSafeBase64(JSON.stringify([
      fields.course,
      fields.date,
      fields.start_time,
      fields.end_time,
      fields.late_threshold,
    ])),
  };
}

function normalizeSessionTime(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const match = /^(\d{2}:\d{2})(?::\d{2})?$/.exec(value.trim());
  return match ? match[1] : value;
}

function mapSessionFields(data: Record<string, unknown>, offset: string): Record<string, unknown> {
  return {
    ...data,
    date: data.date ?? data.scheduled_date,
    start_time: normalizeSessionTime(data.start_time ?? data.start_time_local),
    end_time: normalizeSessionTime(data.end_time ?? data.end_time_local),
    offset: data.offset ?? offset,
  };
}

/** Map stored ciphertext to the legacy admin session shape without exposing ciphertext. */
export async function mapAdminSessionResponse(value: unknown, keyring: QrKeyring, offset: string): Promise<ApiResponse> {
  const normalized = normalizeBackendResponse(value);
  if (!normalized.ok) return normalized;
  const data = normalized.data as Record<string, unknown>;
  if (typeof data.session_id !== 'string' || typeof data.qr_token_ciphertext !== 'string') {
    return { ok: false, error: 'The service returned an unexpected response.' };
  }
  let qrToken: string;
  try {
    qrToken = await decryptQrToken(data.qr_token_ciphertext, data.session_id, keyring);
  } catch {
    return { ok: false, error: 'The service could not recover the class QR.' };
  }
  const mapped = mapSessionFields(data, offset);
  delete mapped.qr_token_ciphertext;
  delete mapped.qr_token_hash;
  return { ok: true, data: { ...mapped, qr_token: qrToken } };
}

/** Map the internal create-session conflict to the exact Version 3 public contract. */
export function normalizeCreateSessionBackendResponse(value: unknown): ApiResponse {
  if (value && typeof value === 'object') {
    const result = value as Record<string, unknown>;
    if (result.ok === false && result.reason === 'request_id_conflict') {
      return { ok: false, error: 'This request ID belongs to a different session. No changes were made.' };
    }
  }
  return normalizeBackendResponse(value);
}

/** Map a successful create-session response and recover only the authorized admin QR token. */
export async function mapCreateSessionResponse(value: unknown, keyring: QrKeyring, offset: string): Promise<ApiResponse> {
  const conflict = normalizeCreateSessionBackendResponse(value);
  if (!conflict.ok) return conflict;
  const data = conflict.data as Record<string, unknown>;
  if (typeof data.session_id !== 'string' || typeof data.qr_token_ciphertext !== 'string') {
    return { ok: false, error: 'The service returned an unexpected response.' };
  }
  let qrToken: string;
  try {
    qrToken = await decryptQrToken(data.qr_token_ciphertext, data.session_id, keyring);
  } catch {
    return { ok: false, error: 'The service could not recover the class QR.' };
  }
  const mapped = mapSessionFields(data, offset);
  delete mapped.qr_token_ciphertext;
  delete mapped.qr_token_hash;
  return { ok: true, data: { ...mapped, qr_token: qrToken } };
}

/** Map the SQL dashboard read model to the exact Version 3 admin response. */
export async function mapDashboardResponse(value: unknown, keyring: QrKeyring, offset: string): Promise<ApiResponse> {
  const normalized = value && typeof value === 'object' && 'ok' in value
    ? normalizeBackendResponse(value)
    : undefined;
  if (normalized && !normalized.ok) return normalized;
  const raw = normalized ? normalized.data : value;
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'The service returned an unexpected response.' };
  const source = raw as Record<string, unknown>;
  if (!Array.isArray(source.sessions) || !Array.isArray(source.students) || !Array.isArray(source.attendance) || !source.settings || typeof source.settings !== 'object' || typeof source.now !== 'string') {
    return { ok: false, error: 'The service returned an unexpected response.' };
  }
  const settings = source.settings as Record<string, unknown>;
  if (typeof settings.offset !== 'string' || typeof settings.enrolled !== 'boolean' || typeof settings.openMinutes !== 'number' || typeof settings.closeMinutes !== 'number') {
    return { ok: false, error: 'The service returned an unexpected response.' };
  }
  const sessions: Record<string, unknown>[] = [];
  for (const item of source.sessions) {
    if (!item || typeof item !== 'object') return { ok: false, error: 'The service returned an unexpected response.' };
    const session = mapSessionFields(item as Record<string, unknown>, offset);
    if (typeof session.session_id !== 'string' || typeof session.qr_token_ciphertext !== 'string') {
      return { ok: false, error: 'The service could not recover the class QR.' };
    }
    let qrToken: string;
    try {
      qrToken = await decryptQrToken(session.qr_token_ciphertext, session.session_id, keyring);
    } catch {
      return { ok: false, error: 'The service could not recover the class QR.' };
    }
    delete session.qr_token_ciphertext;
    delete session.qr_token_hash;
    sessions.push({ ...session, qr_token: qrToken });
  }
  const students = source.students.map((item) => {
    const student = item as Record<string, unknown>;
    return { student_id: student.student_id, name: student.name, active: student.active };
  });
  const attendance = source.attendance.map((item) => {
    const record = item as Record<string, unknown>;
    return {
      attendance_id: record.attendance_id,
      session_id: record.session_id,
      student_id: record.student_id,
      student_name: record.student_name,
      scan_in: record.scan_in ?? '',
      scan_out: record.scan_out ?? '',
      duration_minutes: record.duration_minutes ?? '',
      status: record.status,
      created_at: record.created_at,
      updated_at: record.updated_at,
    };
  });
  return { ok: true, data: {
    session_creation_idempotency: source.session_creation_idempotency === true,
    sessions,
    students,
    attendance,
    settings: {
      offset: settings.offset,
      enrolled: settings.enrolled,
      openMinutes: settings.openMinutes,
      closeMinutes: settings.closeMinutes,
      scan_request_idempotency: settings.scan_request_idempotency === true,
    },
    now: source.now,
  } };
}

/** Map the public SQL session envelope without returning ciphertext or raw QR data. */
export function mapPublicSessionResponse(value: unknown, offset: string): ApiResponse {
  const normalized = normalizeBackendResponse(value);
  if (!normalized.ok) return normalized;
  const data = normalized.data;
  if (!data || typeof data !== 'object') return { ok: false, error: 'The service returned an unexpected response.' };
  const mapped = mapSessionFields(data as Record<string, unknown>, offset);
  if (typeof mapped.session_id !== 'string' || typeof mapped.course !== 'string' || typeof mapped.date !== 'string' || typeof mapped.start_time !== 'string' || typeof mapped.end_time !== 'string' || typeof mapped.status !== 'string') {
    return { ok: false, error: 'The service returned an unexpected response.' };
  }
  return { ok: true, data: {
    session_id: mapped.session_id,
    course: mapped.course,
    date: mapped.date,
    start_time: mapped.start_time,
    end_time: mapped.end_time,
    status: mapped.status,
    offset: mapped.offset,
    scan_request_idempotency: mapped.scan_request_idempotency === true,
  } };
}

export async function buildScanFingerprint(payload: ScanPayload): Promise<string> {
  normalizeUuidV4(payload.request_id);
  const studentId = normalizeStudentId(payload.student_id);
  if (!payload.session_id || typeof payload.session_id !== 'string') {
    throw new ValidationError('The scan request is invalid.', SCAN_REJECTED);
  }
  if (payload.direction !== 'in' && payload.direction !== 'out') {
    throw new ValidationError('Choose Scan In or Scan Out.');
  }
  return sha256WebSafeBase64(serializeScanFingerprint(payload.session_id, studentId, payload.direction, payload.student_name));
}

function requireDirection(value: unknown): Direction {
  if (value !== 'in' && value !== 'out') throw new ValidationError('Choose Scan In or Scan Out.');
  return value;
}

export function buildScanRpcInput(payload: ScanPayload, qrTokenHash: string, fingerprint: string): ScanRpcInput {
  const requestId = normalizeUuidV4(payload.request_id);
  const studentId = normalizeStudentId(payload.student_id);
  const direction = requireDirection(payload.direction);
  if (!payload.session_id || typeof payload.session_id !== 'string') {
    throw new ValidationError('The scan request is invalid.', SCAN_REJECTED);
  }
  return {
    p_request_id: requestId,
    p_session_id: payload.session_id,
    p_qr_token_hash: qrTokenHash,
    p_student_id: studentId,
    p_student_name: String(payload.student_name == null ? '' : payload.student_name),
    p_direction: direction,
    p_fingerprint: fingerprint,
  };
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** HMAC-SHA-256 subject; raw identifiers never leave this function. */
export async function hmacRateLimitSubject(secret: string, scope: RateLimitScope, subjectInput: string): Promise<string> {
  if (!secret) throw new UnknownBehaviorError('Rate-limit HMAC secret is not configured.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const message = new TextEncoder().encode(`ylp-rate-v1\u0000${scope}\u0000${subjectInput}`);
  const signature = await crypto.subtle.sign('HMAC', key, message);
  return bytesToHex(new Uint8Array(signature));
}

export function rateLimitPolicy(scope: RateLimitScope): RateLimitPolicy {
  return RATE_LIMIT_POLICIES[scope];
}

async function enforceRateLimit(backend: BackendAdapter, config: EdgeConfig, scope: RateLimitScope, subjectInput: string): Promise<RateLimitDecision> {
  const policy = rateLimitPolicy(scope);
  const subjectHash = await hmacRateLimitSubject(config.rateLimitHmacSecret, scope, subjectInput);
  const decision = await backend.consumeRateLimit(scope, subjectHash, policy.limit, policy.windowSeconds);
  if (!decision.allowed) throw new RateLimitExceededError(decision.retry_after_seconds);
  return decision;
}

function base64UrlDecode(value: string): Uint8Array {
  return base64UrlToBytes(value);
}

function parseJwtPart(value: string): Record<string, unknown> {
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(base64UrlDecode(value));
    const parsed = JSON.parse(decoded);
    if (!parsed || typeof parsed !== 'object') throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new AuthenticationError();
  }
}

let jwksCache: { expiresAt: number; keys: Record<string, JsonWebKey> } | null = null;

async function fetchJwks(config: EdgeConfig): Promise<Record<string, JsonWebKey>> {
  if (jwksCache && jwksCache.expiresAt > Date.now()) return jwksCache.keys;
  const response = await fetch(config.authJwksUrl, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new AuthenticationError();
  const body = await response.json() as { keys?: Array<JsonWebKey & { kid?: string }> };
  const keys: Record<string, JsonWebKey> = {};
  for (const key of body.keys ?? []) if (key.kid) keys[key.kid] = key;
  if (!Object.keys(keys).length) throw new AuthenticationError();
  jwksCache = { expiresAt: Date.now() + 300_000, keys };
  return keys;
}

function audiencesMatch(aud: unknown, expected: string): boolean {
  return typeof aud === 'string' ? aud === expected : Array.isArray(aud) && aud.includes(expected);
}

/** Verify JWT signature and required Supabase issuer/audience/session claims. */
export async function verifyAdminJwt(token: string, config: EdgeConfig, nowSeconds = Math.floor(Date.now() / 1000)): Promise<JwtClaims> {
  if (!token || token.split('.').length !== 3) throw new AuthenticationError();
  const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
  const header = parseJwtPart(encodedHeader);
  const payload = parseJwtPart(encodedPayload) as Partial<JwtClaims>;
  const alg = header.alg;
  const kid = header.kid;
  if (typeof alg !== 'string' || !JWT_ALGORITHMS.has(alg) || typeof kid !== 'string') throw new AuthenticationError();
  if (typeof payload.sub !== 'string' || !UUID_V4.test(payload.sub) || typeof payload.session_id !== 'string' || !UUID_V4.test(payload.session_id)) throw new AuthenticationError();
  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds || (typeof payload.nbf === 'number' && payload.nbf > nowSeconds)) throw new AuthenticationError();
  if (payload.iss !== config.authIssuer || !audiencesMatch(payload.aud, config.authAudience)) throw new AuthenticationError();
  const signature = base64UrlDecode(encodedSignature);
  const jwk = (await fetchJwks(config))[kid];
  if (!jwk || jwk.alg && jwk.alg !== alg) throw new AuthenticationError();
  const cryptoKey = await crypto.subtle.importKey('jwk', jwk, alg === 'RS256' ? { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } : { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify(
    alg === 'RS256' ? { name: 'RSASSA-PKCS1-v1_5' } : { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    signature,
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );
  if (!valid) throw new AuthenticationError();
  return payload as JwtClaims;
}

async function requireAdmin(token: string, config: EdgeConfig, backend: BackendAdapter): Promise<JwtClaims> {
  const claims = await verifyAdminJwt(token, config);
  const row = await backend.authorizeAdmin(claims.sub, claims.session_id);
  if (!row || typeof row !== 'object') throw new AuthenticationError();
  const admin = row as Record<string, unknown>;
  if (admin.active !== true || typeof admin.role !== 'string' || !config.adminAllowedRoles.includes(admin.role)) throw new AuthenticationError();
  return claims;
}

async function requireAdminRole(
  token: string,
  config: EdgeConfig,
  backend: BackendAdapter,
  allowedRoles: string[],
): Promise<JwtClaims> {
  const claims = await requireAdmin(token, config, backend);
  const row = await backend.authorizeAdmin(claims.sub, claims.session_id);
  if (!row || typeof row !== 'object') throw new AuthenticationError();
  const role = (row as Record<string, unknown>).role;
  if (typeof role !== 'string' || !allowedRoles.includes(role)) throw new AuthenticationError();
  return claims;
}

export function json<T>(body: ApiResponse<T>, origin: string): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    vary: 'Origin',
  } });
}

export function publicError(error: unknown): ApiFailure {
  if (error instanceof ValidationError) return { ok: false, error: error.message, ...(error.publicCode ? { code: error.publicCode } : {}) };
  if (error instanceof RateLimitExceededError) return { ok: false, error: RATE_LIMIT_ERROR };
  if (error instanceof AuthenticationError) return { ok: false, error: 'Authentication failed.' };
  if (error instanceof CryptoEnvelopeError) return { ok: false, error: error.message };
  if (error instanceof UnknownBehaviorError) return { ok: false, error: 'The service is not ready for this operation.' };
  return { ok: false, error: 'Request failed.' };
}

export function normalizeBackendResponse(value: unknown): ApiResponse {
  if (!value || typeof value !== 'object' || !('ok' in value)) return { ok: false, error: 'The service returned an unexpected response.' };
  const result = value as Record<string, unknown>;
  if (result.ok === true) return { ok: true, data: result.data };
  if (result.ok === false && typeof result.error === 'string') return { ok: false, error: result.error, ...(result.code === SCAN_REJECTED ? { code: SCAN_REJECTED } : {}) };
  return { ok: false, error: 'The service returned an unexpected response.' };
}

function requirePayload(request: ApiRequest): Record<string, unknown> {
  return request.payload && typeof request.payload === 'object' ? request.payload : {};
}

/** Supabase Auth/PostgREST adapter. */
export class SupabaseRpcBackend implements BackendAdapter {
  constructor(private readonly config: EdgeConfig) {}

  private async rpc(name: string, body: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(`${this.config.supabaseUrl}/rest/v1/rpc/${name}`, { method: 'POST', headers: {
      apikey: this.config.supabaseServiceRoleKey,
      authorization: `Bearer ${this.config.supabaseServiceRoleKey}`,
      'content-type': 'application/json',
    }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error('backend rpc failed');
    return response.json();
  }

  async login(payload: Record<string, unknown>, _token: string): Promise<unknown> {
    if (typeof payload.username !== 'string' || !payload.username.trim()) throw new AuthenticationError();
    if (typeof payload.password !== 'string' || !payload.password) throw new AuthenticationError();

    const identity = await this.rpc('ylp_admin_login_identity_v1', {
      p_username: payload.username.trim(),
    });
    const row = Array.isArray(identity) ? identity[0] : identity;
    if (!row || typeof row !== 'object') throw new AuthenticationError();

    const admin = row as Record<string, unknown>;
    if (
      typeof admin.email !== 'string' ||
      !admin.email ||
      typeof admin.role !== 'string' ||
      admin.active !== true
    ) {
      throw new AuthenticationError();
    }

    const response = await fetch(`${this.config.supabaseUrl}/auth/v1/token?grant_type=password`, { method: 'POST', headers: {
      apikey: this.config.supabaseAnonKey,
      'content-type': 'application/json',
    }, body: JSON.stringify({ email: admin.email, password: payload.password }) });
    if (!response.ok) throw new AuthenticationError();

    const result = await response.json() as { access_token?: unknown };
    if (typeof result.access_token !== 'string' || !result.access_token) throw new AuthenticationError();

    await requireAdmin(result.access_token, this.config, this);
    return { ok: true, data: { token: result.access_token, role: admin.role } };
  }

  async authorizeAdmin(adminId: string, sessionId: string): Promise<unknown> {
    const result = await this.rpc('ylp_authorize_admin_v1', { p_admin_id: adminId, p_session_id: sessionId });
    return Array.isArray(result) ? result[0] : result;
  }

  dashboard(_token: string): Promise<unknown> {
    return this.rpc('ylp_dashboard_v1', {});
  }

  createSession(input: CreateSessionRpcInput, _token: string): Promise<unknown> {
    return this.rpc('ylp_create_session_v1', input as unknown as Record<string, unknown>);
  }

  closeSession(sessionId: string, _token: string): Promise<unknown> {
    return this.rpc('ylp_close_session_v1', { p_session_id: sessionId });
  }

  deleteSession(sessionId: string, _token: string): Promise<unknown> {
    return this.rpc('ylp_delete_session_v1', { p_session_id: sessionId });
  }

  session(sessionId: string, qrTokenHash: string): Promise<unknown> {
    return this.rpc('ylp_public_session_v1', { p_session_id: sessionId, p_qr_token_hash: qrTokenHash });
  }

  scan(input: ScanRpcInput): Promise<unknown> {
    return this.rpc('ylp_scan_v1', input as unknown as Record<string, unknown>);
  }

  async logout(token: string): Promise<unknown> {
    const response = await fetch(`${this.config.supabaseUrl}/auth/v1/logout`, { method: 'POST', headers: {
      apikey: this.config.supabaseAnonKey,
      authorization: `Bearer ${token}`,
    } });
    if (!response.ok) throw new AuthenticationError();
    return { ok: true, data: {} };
  }

  async students(): Promise<unknown> {
    return this.rpc('ylp_students_v1', {});
  }

  async createStudent(studentId: string, name: string): Promise<unknown> {
    return this.rpc('ylp_student_create_v1', { p_student_id: studentId, p_name: name });
  }

  async updateStudent(studentId: string, name: string): Promise<unknown> {
    return this.rpc('ylp_student_update_v1', { p_student_id: studentId, p_name: name });
  }

  async setStudentActive(studentId: string, active: boolean): Promise<unknown> {
    return this.rpc('ylp_student_set_active_v1', { p_student_id: studentId, p_active: active });
  }

  async adminAccounts(): Promise<unknown> {
    const result = await this.rpc('ylp_admin_accounts_v1', {});
    return { ok: true, data: result };
  }

  async createAdminAccount(email: string, password: string, username: string | null, role: string): Promise<unknown> {
    const response = await fetch(this.config.supabaseUrl + '/auth/v1/admin/users', {
      method: 'POST',
      headers: {
        apikey: this.config.supabaseServiceRoleKey,
        authorization: 'Bearer ' + this.config.supabaseServiceRoleKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    if (!response.ok) throw new Error('auth user creation failed');
    const created = await response.json() as Record<string, unknown>;
    const nestedUser = created.user && typeof created.user === 'object' ? created.user as Record<string, unknown> : null;
    const adminId = typeof created.id === 'string' ? created.id : nestedUser && typeof nestedUser.id === 'string' ? nestedUser.id : null;
    if (!adminId) throw new Error('auth user creation returned no user id');
    try {
      const profile = await this.rpc('ylp_admin_account_create_profile_v1', { p_admin_id: adminId, p_username: username, p_role: role });
      return { ok: true, data: profile };
    } catch (error) {
      await fetch(this.config.supabaseUrl + '/auth/v1/admin/users/' + encodeURIComponent(adminId), {
        method: 'DELETE',
        headers: { apikey: this.config.supabaseServiceRoleKey, authorization: 'Bearer ' + this.config.supabaseServiceRoleKey },
      });
      throw error;
    }
  }

  async updateAdminAccount(adminId: string, username: string | null, role: string, active: boolean, password?: string): Promise<unknown> {
    if (password) {
      const response = await fetch(this.config.supabaseUrl + '/auth/v1/admin/users/' + encodeURIComponent(adminId), {
        method: 'PUT',
        headers: {
          apikey: this.config.supabaseServiceRoleKey,
          authorization: 'Bearer ' + this.config.supabaseServiceRoleKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) throw new Error('auth user update failed');
    }
    const profile = await this.rpc('ylp_admin_account_update_v1', { p_admin_id: adminId, p_username: username, p_role: role, p_active: active });
    return { ok: true, data: profile };
  }

  async removeAdminAccount(adminId: string): Promise<unknown> {
    const removed = await this.rpc('ylp_admin_account_remove_profile_v1', { p_admin_id: adminId });
    const deleted = await fetch(this.config.supabaseUrl + '/auth/v1/admin/users/' + encodeURIComponent(adminId), {
      method: 'DELETE',
      headers: { apikey: this.config.supabaseServiceRoleKey, authorization: 'Bearer ' + this.config.supabaseServiceRoleKey },
    });
    if (!deleted.ok) throw new Error('auth user removal failed');
    return { ok: true, data: removed };
  }

  async consumeRateLimit(scope: RateLimitScope, subjectHash: string, limit: number, windowSeconds: number): Promise<RateLimitDecision> {
    const result = await this.rpc('ylp_consume_rate_limit_v1', { p_scope: scope, p_subject_hash: subjectHash, p_limit: limit, p_window_seconds: windowSeconds });
    if (!result || typeof result !== 'object' || typeof (result as Record<string, unknown>).allowed !== 'boolean') throw new Error('invalid rate-limit response');
    return result as RateLimitDecision;
  }
}

function assertOrigin(request: Request, config: EdgeConfig): void {
  const origin = request.headers.get('origin');
  if (origin && origin !== config.allowedOrigin) throw new ValidationError('Origin is not allowed.');
}

export async function handleRequest(request: Request, backend: BackendAdapter, config: EdgeConfig): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
    'access-control-allow-origin': config.allowedOrigin,
    'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS', vary: 'Origin',
  } });
  try {
    assertOrigin(request, config);
    if (request.method !== 'POST') throw new ValidationError('Request method is not allowed.');
    const body = await request.json() as ApiRequest;
    const payload = requirePayload(body);
    const token = typeof body.token === 'string' ? body.token : '';
    let result: ApiResponse | unknown;
    switch (body.action) {
      case 'login':
        await enforceRateLimit(backend, config, 'login-global', 'global');
        result = await backend.login(payload, token);
        break;
      case 'logout':
        await requireAdmin(token, config, backend);
        result = await backend.logout(token);
        break;
      case 'dashboard':
        await requireAdmin(token, config, backend);
        result = await mapDashboardResponse(await backend.dashboard(token), config.qrKeyring, config.sessionTimeOffset);
        break;
      case 'students':
        await requireAdminRole(token, config, backend, ['admin']);
        result = await backend.students();
        break;
      case 'createStudent':
        await requireAdminRole(token, config, backend, ['admin']);
        if (typeof payload.student_id !== 'string' || typeof payload.name !== 'string') throw new ValidationError('Student ID and name are required.');
        result = await backend.createStudent(payload.student_id, payload.name);
        break;
      case 'updateStudent':
        await requireAdminRole(token, config, backend, ['admin']);
        if (typeof payload.student_id !== 'string' || typeof payload.name !== 'string') throw new ValidationError('Student ID and name are required.');
        result = await backend.updateStudent(payload.student_id, payload.name);
        break;
      case 'setStudentActive':
        await requireAdminRole(token, config, backend, ['admin']);
        if (typeof payload.student_id !== 'string' || typeof payload.active !== 'boolean') throw new ValidationError('Student ID and active status are required.');
        result = await backend.setStudentActive(payload.student_id, payload.active);
        break;
      case 'adminAccounts':
        await requireAdminRole(token, config, backend, ['admin']);
        result = await backend.adminAccounts();
        break;
      case 'createAdminAccount':
        await requireAdminRole(token, config, backend, ['admin']);
        if (typeof payload.email !== 'string' || typeof payload.password !== 'string' || typeof payload.username !== 'string' || typeof payload.role !== 'string' || !payload.email.trim() || !payload.password || !payload.username.trim() || !['admin', 'operator'].includes(payload.role)) throw new ValidationError('Email, password, username, and role are required.');
        if (payload.password.length < 16) throw new ValidationError('Password must be at least 16 characters.');
        if (!/^[A-Za-z0-9._-]{3,40}$/.test(payload.username.trim())) throw new ValidationError('Username is invalid.');
        result = await backend.createAdminAccount(payload.email.trim(), payload.password, payload.username.trim(), payload.role);
        break;
      case 'updateAdminAccount':
        await requireAdminRole(token, config, backend, ['admin']);
        if (typeof payload.admin_id !== 'string' || typeof payload.username !== 'string' || typeof payload.role !== 'string' || typeof payload.active !== 'boolean' || !['admin', 'operator'].includes(payload.role)) throw new ValidationError('Account ID, username, role, and active status are required.');
        if (!/^[A-Za-z0-9._-]{3,40}$/.test(payload.username.trim())) throw new ValidationError('Username is invalid.');
        if (payload.password !== undefined && (typeof payload.password !== 'string' || payload.password.length < 16)) throw new ValidationError('Password must be at least 16 characters.');
        result = await backend.updateAdminAccount(payload.admin_id, payload.username.trim(), payload.role, payload.active, typeof payload.password === 'string' && payload.password ? payload.password : undefined);
        break;
      case 'removeAdminAccount':
        await requireAdminRole(token, config, backend, ['admin']);
        if (typeof payload.admin_id !== 'string' || !payload.admin_id) throw new ValidationError('Account ID is required.');
        result = await backend.removeAdminAccount(payload.admin_id);
        break;
      case 'closeSession':
        await requireAdmin(token, config, backend);
        if (typeof payload.session_id !== 'string' || !payload.session_id) throw new ValidationError('Session not found.');
        result = await backend.closeSession(payload.session_id, token);
        break;
      case 'deleteSession':
        await requireAdminRole(token, config, backend, ['admin']);
        if (typeof payload.session_id !== 'string' || !payload.session_id) throw new ValidationError('Session not found.');
        result = await backend.deleteSession(payload.session_id, token);
        break;
      case 'migrateSession': {
        await requireAdmin(token, config, backend);
        if (!config.migrationMode) throw new ValidationError('Migration mode is disabled.');
        const migrationPayload = payload as unknown as CreateSessionPayload & { qr_token?: unknown; status?: unknown };
        if (typeof migrationPayload.qr_token !== 'string' || typeof migrationPayload.status !== 'string' || !['active', 'closed'].includes(migrationPayload.status)) {
          throw new ValidationError('Migration session payload is invalid.');
        }
        const requestId = normalizeUuidV4(migrationPayload.request_id);
        const qrTokenHash = await hashQrToken(migrationPayload.qr_token);
        const qrTokenCiphertext = await encryptQrToken(migrationPayload.qr_token, requestId, config.qrKeyring);
        const input = await buildCreateSessionRpcInput(migrationPayload, config.sessionTimeOffset, qrTokenHash, qrTokenCiphertext);
        result = await backend.createSession(input, token);
        result = await mapCreateSessionResponse(result, config.qrKeyring, config.sessionTimeOffset);
        if (migrationPayload.status === 'closed' && result.ok === true) {
          result = await backend.closeSession(requestId, token);
        }
        break;
      }
      case 'createSession': {
        await requireAdmin(token, config, backend);
        const createPayload = payload as unknown as CreateSessionPayload;
        const rawQrToken = generateQrToken();
        const qrTokenHash = await hashQrToken(rawQrToken);
        const qrTokenCiphertext = await encryptQrToken(rawQrToken, normalizeUuidV4(createPayload.request_id), config.qrKeyring);
        const input = await buildCreateSessionRpcInput(createPayload, config.sessionTimeOffset, qrTokenHash, qrTokenCiphertext);
        result = await backend.createSession(input, token);
        result = await mapCreateSessionResponse(result, config.qrKeyring, config.sessionTimeOffset);
        break;
      }
      case 'session': {
        if (typeof payload.session_id !== 'string' || !UUID_V4.test(payload.session_id) || typeof payload.qr_token !== 'string') throw new ValidationError('Invalid class QR. Please scan the QR shared by your teacher.');
        await enforceRateLimit(backend, config, 'public-session-global', 'global');
        const qrHash = await hashQrToken(payload.qr_token);
        result = mapPublicSessionResponse(await backend.session(payload.session_id.toLowerCase(), qrHash), config.sessionTimeOffset);
        break;
      }
      case 'scan': {
        const scanPayload = payload as unknown as ScanPayload;
        await enforceRateLimit(backend, config, 'scan-global', 'global');
        const qrHash = await hashQrToken(scanPayload.qr_token);
        const fingerprint = await buildScanFingerprint(scanPayload);
        const studentId = normalizeStudentId(scanPayload.student_id);
        await enforceRateLimit(backend, config, 'scan-student-session', `${scanPayload.session_id}\u001f${studentId}`);
        result = await backend.scan(buildScanRpcInput(scanPayload, qrHash, fingerprint));
        break;
      }
      default:
        throw new ValidationError('Unknown action.');
    }
    return json(result && typeof result === 'object' && 'ok' in result ? result as ApiResponse : normalizeBackendResponse(result), config.allowedOrigin);
  } catch (error) {
    return json(publicError(error), config.allowedOrigin);
  }
}

function parseQrKeyring(raw: string, currentKeyId: string): QrKeyring {
  try {
    const keys = JSON.parse(raw);
    if (!keys || typeof keys !== 'object' || Array.isArray(keys)) throw new Error();
    const keyring = { currentKeyId, keys: keys as Record<string, string> };
    validateKeyring(keyring);
    return keyring;
  } catch {
    throw new Error('Invalid QR keyring configuration.');
  }
}

if (import.meta.main) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const allowedOrigin = Deno.env.get('YLP_ALLOWED_ORIGIN');
  const authIssuer = Deno.env.get('SUPABASE_JWT_ISSUER') || `${supabaseUrl}/auth/v1`;
  const authAudience = Deno.env.get('SUPABASE_JWT_AUDIENCE') || 'authenticated';
  const authJwksUrl = Deno.env.get('SUPABASE_JWKS_URL') || `${supabaseUrl}/auth/v1/.well-known/jwks.json`;
  const adminLoginEmail = Deno.env.get('YLP_ADMIN_LOGIN_EMAIL');
  const allowedRoles = Deno.env.get('YLP_ADMIN_ALLOWED_ROLES');
  const sessionTimeOffset = Deno.env.get('YLP_SESSION_TIME_OFFSET');
  const qrKeyId = Deno.env.get('YLP_QR_ENCRYPTION_KEY_ID');
  const qrKeysJson = Deno.env.get('YLP_QR_ENCRYPTION_KEYS_JSON');
  const rateLimitHmacSecret = Deno.env.get('YLP_RATE_LIMIT_HMAC_SECRET_V1');
  const migrationMode = Deno.env.get('YLP_MIGRATION_MODE') === 'true';
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey || !allowedOrigin || !adminLoginEmail || !allowedRoles || !sessionTimeOffset || !qrKeyId || !qrKeysJson || !rateLimitHmacSecret) {
    throw new Error('Draft runtime configuration is incomplete.');
  }
  const config: EdgeConfig = {
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceRoleKey: serviceRoleKey,
    authIssuer,
    authAudience,
    authJwksUrl,
    adminLoginEmail,
    adminAllowedRoles: allowedRoles.split(',').map((role) => role.trim()).filter(Boolean),
    sessionTimeOffset,
    qrKeyring: parseQrKeyring(qrKeysJson, qrKeyId),
    allowedOrigin,
    rateLimitHmacSecret,
    migrationMode,
  };
  Deno.serve((request) => handleRequest(request, new SupabaseRpcBackend(config), config));
}


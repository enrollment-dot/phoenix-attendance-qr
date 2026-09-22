/**
 * YLP Attendance Edge Function types.
 */

export type Direction = 'in' | 'out';
export type RateLimitScope = 'login-global' | 'public-session-global' | 'scan-global' | 'scan-student-session';
export interface ApiRequest { action: 'login' | 'dashboard' | 'createSession' | 'migrateSession' | 'closeSession' | 'session' | 'scan' | 'logout'; payload?: Record<string, unknown>; token?: string; }
export interface ApiSuccess<T> { ok: true; data: T; }
export interface ApiFailure { ok: false; error: string; code?: string; }
export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiFailure;
export interface ScanPayload { request_id: string; session_id: string; qr_token: string; student_id: unknown; student_name: unknown; direction: Direction; }
export interface CreateSessionPayload { request_id: string; course: unknown; date: unknown; start_time: unknown; end_time: unknown; late_threshold: unknown; qr_token?: unknown; status?: unknown; }
export interface ScanRpcInput { p_request_id: string; p_session_id: string; p_qr_token_hash: string; p_student_id: string; p_student_name: string; p_direction: Direction; p_fingerprint: string; }
export interface CreateSessionRpcInput { p_request_id: string; p_course: string; p_scheduled_date: string; p_start_time_local: string; p_end_time_local: string; p_late_threshold: number; p_qr_token_hash: string; p_qr_token_ciphertext: string; p_fingerprint: string; }
export interface RateLimitDecision { allowed: boolean; limit: number; remaining: number; retry_after_seconds: number; window_started_at: string; }
export interface JwtClaims { sub: string; session_id: string; iss?: string; aud?: string | string[]; exp: number; nbf?: number; [claim: string]: unknown; }
export interface QrKeyring { currentKeyId: string; keys: Record<string, string>; }
export interface BackendAdapter { login(payload: Record<string, unknown>, token: string): Promise<unknown>; authorizeAdmin(adminId: string, sessionId: string): Promise<unknown>; dashboard(token: string): Promise<unknown>; createSession(input: CreateSessionRpcInput, token: string): Promise<unknown>; closeSession(sessionId: string, token: string): Promise<unknown>; session(sessionId: string, qrTokenHash: string): Promise<unknown>; scan(input: ScanRpcInput): Promise<unknown>; logout(token: string): Promise<unknown>; consumeRateLimit(scope: RateLimitScope, subjectHash: string, limit: number, windowSeconds: number): Promise<RateLimitDecision>; students(): Promise<unknown>; createStudent(studentId: string, name: string): Promise<unknown>; updateStudent(studentId: string, name: string): Promise<unknown>; setStudentActive(studentId: string, active: boolean): Promise<unknown>; }
export interface EdgeConfig { allowedOrigin: string; supabaseUrl: string; supabaseAnonKey: string; supabaseServiceRoleKey: string; authIssuer: string; authAudience: string; authJwksUrl: string; adminLoginEmail: string; adminAllowedRoles: string[]; sessionTimeOffset: string; qrKeyring: QrKeyring; rateLimitHmacSecret: string; }
export class UnknownBehaviorError extends Error { readonly kind = 'unknown_behavior'; constructor(message: string) { super(message); this.name = 'UnknownBehaviorError'; } }

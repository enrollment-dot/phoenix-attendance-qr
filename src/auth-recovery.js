import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

let recoveryClient = null;
let recoverySession = null;

function recoveryCode() {
  return new URLSearchParams(location.search).get('code');
}

export function hasRecoveryRedirect() {
  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
  return (
    hashParams.get('type') === 'recovery' ||
    (hashParams.has('access_token') && hashParams.has('refresh_token')) ||
    Boolean(recoveryCode())
  );
}

function clearRecoveryUrl() {
  if (!location.hash && !location.search) return;
  history.replaceState(null, document.title, location.pathname);
}

export async function initializeRecovery() {
  if (!hasRecoveryRedirect()) return { active: false };

  if (!supabaseUrl || !supabaseAnonKey) {
    clearRecoveryUrl();
    return { active: false, error: 'configuration' };
  }

  const code = recoveryCode();
  recoveryClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: !code,
      flowType: code ? 'pkce' : 'implicit',
      persistSession: false,
      skipAutoInitialize: true,
    },
  });

  try {
    if (code) {
      const { error } = await recoveryClient.auth.exchangeCodeForSession(code);
      if (error) {
        clearRecoveryUrl();
        recoveryClient = null;
        return { active: false, error: 'invalid' };
      }
    }

    const { error } = await recoveryClient.auth.initialize();
    if (error) {
      clearRecoveryUrl();
      recoveryClient = null;
      return { active: false, error: 'invalid' };
    }

    const session = (await recoveryClient.auth.getSession()).data.session;
    if (!session?.access_token) {
      clearRecoveryUrl();
      recoveryClient = null;
      return { active: false, error: 'invalid' };
    }

    recoverySession = session;
    clearRecoveryUrl();
    return { active: true };
  } catch {
    clearRecoveryUrl();
    recoveryClient = null;
    return { active: false, error: 'invalid' };
  }
}

export async function updateRecoveryPassword(password) {
  if (!recoveryClient || !recoverySession?.access_token)
    throw new RecoveryError('invalid');
  try {
    const { error } = await recoveryClient.auth.updateUser({ password });
    if (error) throw error;
    await recoveryClient.auth.signOut({ scope: 'local' });
    recoverySession = null;
    recoveryClient = null;
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    throw new RecoveryError(
      error?.status === 401 || error?.status === 403 ? 'expired' : 'update',
    );
  }
}

export function recoveryMessage(kind) {
  if (kind === 'configuration')
    return 'Password recovery is not configured for this app. Ask the administrator to verify the Supabase environment configuration.';
  if (kind === 'expired')
    return 'This password-recovery link has expired. Request a new recovery email and try again.';
  if (kind === 'invalid')
    return 'This password-recovery link is invalid or has already been used. Request a new recovery email and try again.';
  return 'The new password could not be saved. Request a new recovery email and try again.';
}

export class RecoveryError extends Error {
  constructor(kind) {
    super(recoveryMessage(kind));
    this.kind = kind;
  }
}

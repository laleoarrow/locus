/** Last observed connection result, not a promise that the service is online. */
export interface ConnectionState {
  status: 'untested' | 'testing' | 'success' | 'error';
  checkedAt: number;
  error: string;
}

export const EMPTY_CONNECTION_STATE: ConnectionState = { status: 'untested', checkedAt: 0, error: '' };

/** Internal operation guard; never includes credentials. */
export interface ConnectionAttempt {
  revision: number;
  id: string;
}

export interface StoredConnection extends ConnectionState, ConnectionAttempt {
  sessionId: string;
}

export function connectionView(stored: StoredConnection | undefined, revision: number, sessionId: string): ConnectionState {
  if (!stored || stored.revision !== revision ||
    (stored.status === 'testing' && stored.sessionId !== sessionId)) return { ...EMPTY_CONNECTION_STATE };
  return { status: stored.status, checkedAt: stored.checkedAt, error: stored.error };
}

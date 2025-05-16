import * as http from 'http';
import * as crypto from 'crypto';

// Constants
export const DEFAULT_SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

// Session interface
export interface Session {
  id: string;
  createdAt: number;
  lastAccessed: number;
  clientInfo?: any;
  requestStreams: Map<string, http.ServerResponse>;
}

/**
 * Session manager for MCP HTTP transport
 * Handles session creation, validation, and cleanup
 */
export class SessionManager {
  private sessions = new Map<string, Session>();
  private sessionCleanupInterval: NodeJS.Timeout | null = null;
  private readonly sessionTimeoutMs: number;

  constructor(sessionTimeoutMs = DEFAULT_SESSION_TIMEOUT_MS) {
    this.sessionTimeoutMs = sessionTimeoutMs;
    
    // Set up session cleanup
    this.sessionCleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60 * 1000); // Check every minute
  }

  /**
   * Create a new session
   */
  createSession(clientInfo?: any): Session {
    const sessionId = this.generateSecureId();
    const now = Date.now();
    
    const session: Session = {
      id: sessionId,
      createdAt: now,
      lastAccessed: now,
      clientInfo,
      requestStreams: new Map()
    };
    
    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    
    if (session) {
      // Update last accessed time
      session.lastAccessed = Date.now();
    }
    
    return session;
  }

  /**
   * Delete a session by ID
   */
  deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  /**
   * Check if a session is valid
   */
  isSessionValid(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return false;
    }
    
    const now = Date.now();
    const isExpired = (now - session.lastAccessed) > this.sessionTimeoutMs;
    
    if (isExpired) {
      this.sessions.delete(sessionId);
      return false;
    }
    
    return true;
  }

  /**
   * Clean up expired sessions
   */
  cleanupExpiredSessions(): void {
    const now = Date.now();
    
    this.sessions.forEach((session, sessionId) => {
      if (now - session.lastAccessed > this.sessionTimeoutMs) {
        // Close any open request streams
        session.requestStreams.forEach(res => {
          try {
            res.end();
          } catch (error) {
            // Ignore errors when closing streams
          }
        });
        
        this.sessions.delete(sessionId);
      }
    });
  }

  /**
   * Stop session cleanup
   */
  stop(): void {
    if (this.sessionCleanupInterval) {
      clearInterval(this.sessionCleanupInterval);
      this.sessionCleanupInterval = null;
    }
  }

  /**
   * Generate a secure session ID
   */
  private generateSecureId(): string {
    return crypto.randomBytes(16).toString('hex');
  }
} 
import { hashToken, randomHex } from './random.js';
import type { Scheduler } from './scheduler.js';

export interface Session {
  /** 對其他玩家公開的識別。 */
  readonly playerId: string;
  readonly nickname: string;
  readonly tokenHash: string;
  /** 目前連線的 socket id；斷線為 null。 */
  socketId: string | null;
  cancelExpiry: (() => void) | null;
}

/**
 * 無帳號的玩家身分。重連 token 以 CSPRNG 產生，伺服器只存 SHA-256 雜湊，
 * 記憶體或日誌外洩時不會直接洩漏可用的 token。
 */
export class SessionStore {
  private readonly byHash = new Map<string, Session>();
  private readonly byPlayer = new Map<string, Session>();

  constructor(
    private readonly scheduler: Scheduler,
    /** 斷線且不在任何房間的身分保留多久（毫秒）。 */
    private readonly ttlMs: number,
    /** 玩家是否還在某個房間（在房間內的身分不會過期，直到房間關閉）。 */
    private readonly hasRoom: (playerId: string) => boolean,
  ) {}

  create(nickname: string): { session: Session; token: string } {
    const token = randomHex(32);
    const session: Session = {
      playerId: randomHex(8),
      nickname,
      tokenHash: hashToken(token),
      socketId: null,
      cancelExpiry: null,
    };
    this.byHash.set(session.tokenHash, session);
    this.byPlayer.set(session.playerId, session);
    return { session, token };
  }

  resume(token: string): Session | undefined {
    return this.byHash.get(hashToken(token));
  }

  get(playerId: string): Session | undefined {
    return this.byPlayer.get(playerId);
  }

  get size(): number {
    return this.byPlayer.size;
  }

  /** 綁定 socket；回傳被取代的舊 socket id（如果有）。 */
  attach(session: Session, socketId: string): string | null {
    session.cancelExpiry?.();
    session.cancelExpiry = null;
    const previous = session.socketId;
    session.socketId = socketId;
    return previous;
  }

  /** 解除綁定。只有目前的 socket 斷線才算（舊 socket 被取代後的斷線事件要忽略）。 */
  detach(session: Session, socketId: string): boolean {
    if (session.socketId !== socketId) {
      return false;
    }
    session.socketId = null;
    this.armExpiry(session);
    return true;
  }

  private armExpiry(session: Session): void {
    session.cancelExpiry?.();
    session.cancelExpiry = this.scheduler.after(this.ttlMs, () => {
      session.cancelExpiry = null;
      if (session.socketId !== null) {
        return;
      }
      if (this.hasRoom(session.playerId)) {
        this.armExpiry(session); // 房間總會關閉，屆時再回收
        return;
      }
      this.byHash.delete(session.tokenHash);
      this.byPlayer.delete(session.playerId);
    });
  }
}

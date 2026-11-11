/**
 * 房主橋接：把「中繼伺服器上的客人」接成本機閘道的連線。
 * 房主的瀏覽器（Worker）跑完整的房間與規則；每位客人在這裡看起來就是一條 GatewayConn，
 * 與離線模式的本機連線沒有差別——所以握手、身分（token 由房主簽發）、限流、代管全部沿用。
 */
import {
  RELAY_EVENTS,
  RELAY_PROTOCOL_VERSION,
  type RelayClosedReason,
  type RelayErrorCode,
  type RelayHostOpenAck,
} from '@kot/protocol';
import type { LocalHost } from '../local/host.js';
import { parseToHost, type ToClient, type ToHost } from '../local/protocol.js';
import type { RelaySocket } from './socket.js';

export type BridgeStatus =
  /** 與中繼伺服器的連線中斷，等待自動重連。 */
  | { state: 'offline' }
  | { state: 'online'; code: string }
  /** 房間已被中繼關閉（閒置、房號逾時等），無法接回。 */
  | { state: 'closed'; reason: RelayClosedReason | RelayErrorCode };

export class HostBridge {
  private creds: { code: string; hostKey: string } | null = null;
  private readonly guests = new Map<string, (message: ToHost) => void>();
  private opening: Promise<string> | null = null;
  private done = false;
  private statusHandlers: ((status: BridgeStatus) => void)[] = [];

  constructor(
    private readonly local: LocalHost,
    private readonly socket: RelaySocket,
  ) {
    socket.onEvent(RELAY_EVENTS.guestJoined, (payload) => {
      const guestId = readGuestId(payload);
      if (guestId !== null) this.attachGuest(guestId);
    });
    socket.onEvent(RELAY_EVENTS.guestLeft, (payload) => {
      const guestId = readGuestId(payload);
      if (guestId !== null) this.detachGuest(guestId);
    });
    socket.onEvent(RELAY_EVENTS.fromGuest, (payload) => {
      if (typeof payload !== 'object' || payload === null) return;
      const { guestId, data } = payload as { guestId?: unknown; data?: unknown };
      if (typeof guestId !== 'string') return;
      const message = parseToHost(data);
      if (message === null) return; // 客人不可信：格式不對的信封直接丟掉
      this.guests.get(guestId)?.(message);
    });
    socket.onEvent(RELAY_EVENTS.closed, (payload) => {
      const reason = (payload as { reason?: RelayClosedReason } | null)?.reason ?? 'room_closed';
      this.finish({ state: 'closed', reason });
    });
    socket.onDisconnect(() => {
      if (this.done) return;
      this.emitStatus({ state: 'offline' });
    });
    socket.onConnect(() => {
      // 自動重連後用房號＋金鑰接回同一個房間（客人都還在中繼上）
      if (this.creds) this.resume(this.creds);
    });
  }

  get code(): string | null {
    return this.creds?.code ?? null;
  }

  onStatus(handler: (status: BridgeStatus) => void): void {
    this.statusHandlers.push(handler);
  }

  /** 向中繼伺服器登記房間（只做一次，之後回傳同一個房號）。失敗時 reject，錯誤碼在 message。 */
  open(): Promise<string> {
    if (this.creds) return Promise.resolve(this.creds.code);
    this.opening ??= new Promise<string>((resolve, reject) => {
      const send = (): void => {
        this.socket.emit(
          RELAY_EVENTS.hostOpen,
          { relayVersion: RELAY_PROTOCOL_VERSION },
          (result) => {
            const ack = result as RelayHostOpenAck;
            if (ack.ok) {
              this.creds = { code: ack.code, hostKey: ack.hostKey };
              this.emitStatus({ state: 'online', code: ack.code });
              resolve(ack.code);
            } else {
              this.opening = null;
              reject(new Error(ack.code));
            }
          },
        );
      };
      if (this.socket.connected) send();
      else {
        this.socket.connect?.();
        let sent = false;
        this.socket.onConnect(() => {
          if (!sent) {
            sent = true;
            send();
          }
        });
        this.socket.onConnectError(() => {
          if (!sent) {
            sent = true;
            this.opening = null;
            reject(new Error('unreachable'));
          }
        });
      }
    });
    return this.opening;
  }

  /** 關閉：中斷中繼連線（伺服器會通知客人房主離開）。 */
  close(): void {
    this.done = true;
    for (const guestId of [...this.guests.keys()]) this.detachGuest(guestId);
    this.socket.disconnect();
  }

  // ── 內部 ──────────────────────────────────────────

  private resume(creds: { code: string; hostKey: string }): void {
    this.socket.emit(
      RELAY_EVENTS.hostOpen,
      { relayVersion: RELAY_PROTOCOL_VERSION, code: creds.code, hostKey: creds.hostKey },
      (result) => {
        const ack = result as RelayHostOpenAck;
        if (ack.ok) this.emitStatus({ state: 'online', code: ack.code });
        else this.finish({ state: 'closed', reason: ack.code });
      },
    );
  }

  /** 客人進來（或房主接回後被重新告知）：換一條全新的閘道連線，客人會收到 open 並重新握手。 */
  private attachGuest(guestId: string): void {
    this.detachGuest(guestId);
    const send = (message: ToClient): void => {
      this.socket.emit(RELAY_EVENTS.toGuest, { guestId, data: message });
      if (message.t === 'closed') {
        // 閘道主動中斷這條連線（握手逾時、被取代等）：請伺服器也把客人踢出中繼
        this.guests.delete(guestId);
        this.socket.emit(RELAY_EVENTS.kick, { guestId });
      }
    };
    this.guests.set(guestId, this.local.connect(send));
  }

  private detachGuest(guestId: string): void {
    const receive = this.guests.get(guestId);
    if (!receive) return;
    this.guests.delete(guestId);
    receive({ t: 'close' });
  }

  private finish(status: BridgeStatus): void {
    if (this.done) return;
    this.done = true;
    for (const guestId of [...this.guests.keys()]) this.detachGuest(guestId);
    this.emitStatus(status);
  }

  private emitStatus(status: BridgeStatus): void {
    for (const handler of this.statusHandlers) handler(status);
  }
}

function readGuestId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { guestId } = payload as { guestId?: unknown };
  return typeof guestId === 'string' && guestId.length > 0 && guestId.length <= 40 ? guestId : null;
}

/**
 * 中繼房間登記（ADR-0007）：房號登記、房主與客人配對、轉發不透明訊息。
 * 與傳輸無關（Socket.IO 在 namespace.ts 接上來），所以可以直接用假時鐘單元測試。
 *
 * **不解析遊戲訊息**：data 只量大小、只轉發，不檢視、不記錄（內含重連 token 等）。
 */
import {
  RELAY_EVENTS,
  RELAY_MAX_DATA_BYTES,
  RELAY_PROTOCOL_VERSION,
  RelayHandoverSchema,
  RelayHostOpenSchema,
  RelayJoinSchema,
  RelayKickSchema,
  RelaySuccessionSchema,
  RelayTakeoverSchema,
  RelayToGuestSchema,
  RelayToHostSchema,
  type RelayClosedReason,
  type RelayErrorCode,
  type RelayHostOpenAck,
  type RelayJoinAck,
  type RelayParkAck,
  type RelayServerEvents,
  type RelaySimpleAck,
  type RelayTakeoverAck,
} from '@kot/protocol';
import { generateRoomCode, hashToken, TokenBucket, type Scheduler } from '@kot/room';

export interface RelayConn {
  readonly id: string;
  send<E extends keyof RelayServerEvents>(event: E, payload: RelayServerEvents[E]): void;
  /** 主動中斷；傳輸層之後應呼叫 RelayRegistry.disconnected。 */
  close(): void;
}

export interface RelayOptions {
  scheduler: Scheduler;
  /** 同時登記的房間上限。 */
  maxRooms: number;
  /** 每個房間最多幾位客人。 */
  maxGuests: number;
  /** 連線閒置多久沒有任何訊息就中斷（毫秒）；0＝不踢。 */
  idleKickMs: number;
  /** 房主意外斷線後保留房號多久（毫秒），期間可用房號＋金鑰接回；逾時關房並通知客人。 */
  hostGraceMs: number;
  /** 房主主動「停泊」（所有客人都已直連）後保留房號多久（毫秒）；期間房主可隨時接回，逾時關房。 */
  parkTtlMs: number;
  /**
   * 房主轉移的時序（毫秒）：房主不見之後，第 k 順位要等「寬限＋(k−1)×間隔」才能接手。
   * 由伺服器的時鐘判定（客人自己也會排程，但以伺服器為準，避免兩個人同時成為房主）。
   */
  successionGraceMs?: number;
  successionStaggerMs?: number;
  /** 計畫性交接：指定後備要在多久內接手，逾時就當作沒發生（原房主繼續）。 */
  handoverTtlMs?: number;
  /** 單則訊息 data 的大小上限（序列化後位元組）。 */
  maxDataBytes?: number;
  /** 每個房間每秒可轉發的位元組，以及瞬間上限。 */
  roomBytesPerSecond?: number;
  roomBytesBurst?: number;
  /** 房主連線的訊息速率（預設突發 400、每秒 200）；測試用假時鐘加速時會需要放寬。 */
  hostBurst?: number;
  hostPerSecond?: number;
  randomInt: (maxExclusive: number) => number;
  randomHex: (bytes: number) => string;
}

type Role = { kind: 'host'; room: Room } | { kind: 'guest'; room: Room; guestId: string };

interface Room {
  code: string;
  hostKey: string;
  host: RelayConn | null;
  /** 房主主動離線（停泊）：不是意外斷線，保留較久。 */
  parked: boolean;
  guests: Map<string, RelayConn>;
  bytes: TokenBucket;
  cancelGrace: () => void;
  /** 房主世代：每次轉移加 1。 */
  epoch: number;
  /** 後備順序：接手金鑰的雜湊（第 1 個是第一順位）。 */
  succession: string[];
  /** 房主意外斷線的時間（房主在線上或主動停泊時為 null）。 */
  lostAt: number | null;
  /** 停泊中的房間：第一次有人（直連斷掉的客人）來找房主卻找不到的時間；房主回來就清除。 */
  suspectSince: number | null;
  /** 計畫性交接：房主指定的後備（金鑰雜湊）與期限。 */
  handover: { target: string; until: number } | null;
  /** 已被取代的房主金鑰（舊房主回來時回報 superseded，而不是一般的金鑰錯誤）。 */
  retiredKeys: string[];
}

interface Peer {
  role: Role | null;
  /** 單一連線的訊息速率。 */
  bucket: TokenBucket;
  lastActive: number;
  cancelIdle: () => void;
}

/** 預設：房主不見 10 秒後第一順位接手（給房主重新整理接回的時間），之後每順位多等 3 秒。 */
export const SUCCESSION_GRACE_MS = 10_000;
export const SUCCESSION_STAGGER_MS = 3_000;
export const HANDOVER_TTL_MS = 30_000;
/** 房主不見之後，房間至少保留到最後一順位的接手時間再多這麼久。 */
const SUCCESSION_MARGIN_MS = 10_000;
const MAX_RETIRED_KEYS = 8;

const HOST_BURST = 400;
const HOST_PER_SECOND = 200;
const GUEST_BURST = 30;
const GUEST_PER_SECOND = 5;

export class RelayRegistry {
  private readonly rooms = new Map<string, Room>();
  private readonly peers = new Map<string, Peer>();
  private guestSerial = 0;
  private readonly maxData: number;

  constructor(private readonly options: RelayOptions) {
    this.maxData = options.maxDataBytes ?? RELAY_MAX_DATA_BYTES;
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  guestCount(code: string): number {
    return this.rooms.get(code)?.guests.size ?? 0;
  }

  /** 傳輸層有新連線時呼叫（開始計閒置）。 */
  connected(conn: RelayConn): void {
    const { scheduler } = this.options;
    const peer: Peer = {
      role: null,
      bucket: new TokenBucket(GUEST_BURST, GUEST_PER_SECOND, () => scheduler.now()),
      lastActive: scheduler.now(),
      cancelIdle: () => undefined,
    };
    this.peers.set(conn.id, peer);
    this.armIdle(conn, peer, this.options.idleKickMs);
  }

  /** 房主：建房（回傳房號與金鑰）或用房號＋金鑰接回。 */
  hostOpen(conn: RelayConn, payload: unknown): RelayHostOpenAck {
    const peer = this.touch(conn);
    if (!peer) return { ok: false, code: 'invalid_message' };
    const parsed = RelayHostOpenSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        ok: false,
        code: hasOtherVersion(payload) ? 'protocol_mismatch' : 'invalid_message',
      };
    }
    if (peer.role) return { ok: false, code: 'invalid_message' };
    const { code, hostKey, restore, epoch } = parsed.data;

    if (code !== undefined || hostKey !== undefined) {
      // 接回：必須兩者都帶，且金鑰正確
      let room = code === undefined ? undefined : this.rooms.get(code);
      if (!room && restore === true && code !== undefined && hostKey !== undefined) {
        // 登記遺失（伺服器重啟）：用房主手上的房號與金鑰重新登記
        if (this.rooms.size >= this.options.maxRooms) return { ok: false, code: 'server_full' };
        room = this.registerRoom(conn, code, hostKey);
        room.epoch = epoch ?? 0;
      }
      if (!room || hostKey === undefined) return { ok: false, code: 'room_not_found' };
      if (room.hostKey !== hostKey) {
        return {
          ok: false,
          code: room.retiredKeys.includes(hostKey) ? 'superseded' : 'bad_host_key',
        };
      }
      room.cancelGrace();
      room.parked = false;
      room.lostAt = null;
      room.suspectSince = null;
      const previous = room.host;
      room.host = conn;
      peer.role = { kind: 'host', room };
      this.promoteToHost(peer);
      if (previous && previous.id !== conn.id) {
        // 舊的房主連線（可能還沒被發現斷了）：解除身分後中斷
        this.detachRole(previous);
        previous.close();
      }
      for (const guest of room.guests.values())
        guest.send(RELAY_EVENTS.hostStatus, { online: true });
      // 房主可能漏掉斷線期間的進出：把目前所有客人再告知一次（橋接端對已知的客人會忽略）
      for (const guestId of room.guests.keys()) conn.send(RELAY_EVENTS.guestJoined, { guestId });
      return { ok: true, code: room.code, hostKey: room.hostKey, epoch: room.epoch };
    }

    if (this.rooms.size >= this.options.maxRooms) return { ok: false, code: 'server_full' };
    let newCode = generateRoomCode(this.options.randomInt);
    for (let attempt = 0; this.rooms.has(newCode) && attempt < 100; attempt += 1) {
      newCode = generateRoomCode(this.options.randomInt);
    }
    if (this.rooms.has(newCode)) return { ok: false, code: 'server_full' };
    const room = this.registerRoom(conn, newCode, this.options.randomHex(16));
    peer.role = { kind: 'host', room };
    this.promoteToHost(peer);
    return { ok: true, code: room.code, hostKey: room.hostKey, epoch: room.epoch };
  }

  private registerRoom(conn: RelayConn, code: string, hostKey: string): Room {
    const { scheduler } = this.options;
    const room: Room = {
      code,
      hostKey,
      host: conn,
      parked: false,
      guests: new Map(),
      bytes: new TokenBucket(
        this.options.roomBytesBurst ?? 262_144,
        this.options.roomBytesPerSecond ?? 65_536,
        () => scheduler.now(),
      ),
      cancelGrace: () => undefined,
      epoch: 0,
      succession: [],
      lostAt: null,
      suspectSince: null,
      handover: null,
      retiredKeys: [],
    };
    this.rooms.set(code, room);
    return room;
  }

  /** 客人：用房號加入；成功後房主會收到 guest-joined。 */
  join(conn: RelayConn, payload: unknown): RelayJoinAck {
    const peer = this.touch(conn);
    if (!peer) return { ok: false, code: 'invalid_message' };
    const parsed = RelayJoinSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        ok: false,
        code: hasOtherVersion(payload) ? 'protocol_mismatch' : 'invalid_message',
      };
    }
    if (peer.role) return { ok: false, code: 'invalid_message' };
    const room = this.rooms.get(parsed.data.code);
    if (!room) return { ok: false, code: 'room_not_found' };
    // 停泊中的房間不接新客人（房主不在中繼上，也沒人需要加入；有人斷線時房主會自己回來）
    if (room.host === null || room.parked) {
      // 停泊中的房間有人來找房主卻找不到（通常是他的直連斷了）：從這時起開始計「房主不見」的時間
      if (room.parked) room.suspectSince ??= this.options.scheduler.now();
      return { ok: false, code: 'host_offline' };
    }
    if (room.guests.size >= this.options.maxGuests) return { ok: false, code: 'room_full' };
    this.guestSerial += 1;
    const guestId = `g${String(this.guestSerial)}`;
    room.guests.set(guestId, conn);
    peer.role = { kind: 'guest', room, guestId };
    room.host.send(RELAY_EVENTS.guestJoined, { guestId });
    return { ok: true };
  }

  /** 客人 → 房主（不透明）。 */
  toHost(conn: RelayConn, payload: unknown): void {
    const peer = this.touch(conn);
    if (!peer || peer.role?.kind !== 'guest') return this.fail(conn, 'not_guest');
    if (!this.admit(conn, peer)) return;
    const parsed = RelayToHostSchema.safeParse(payload);
    if (!parsed.success) return this.fail(conn, 'invalid_message');
    const { room, guestId } = peer.role;
    if (!this.chargeBytes(conn, room, parsed.data.data)) return;
    if (room.host === null) return this.fail(conn, 'host_offline');
    room.host.send(RELAY_EVENTS.fromGuest, { guestId, data: parsed.data.data });
  }

  /** 房主 → 某位客人（不透明）。 */
  toGuest(conn: RelayConn, payload: unknown): void {
    const peer = this.touch(conn);
    if (!peer || peer.role?.kind !== 'host') return this.fail(conn, 'not_host');
    if (!this.admit(conn, peer)) return;
    const parsed = RelayToGuestSchema.safeParse(payload);
    if (!parsed.success) return this.fail(conn, 'invalid_message');
    const { room } = peer.role;
    if (!this.chargeBytes(conn, room, parsed.data.data)) return;
    room.guests.get(parsed.data.guestId)?.send(RELAY_EVENTS.fromHost, { data: parsed.data.data });
  }

  /**
   * 房主停泊：所有客人都已改走直連（中繼上沒有客人），房主可以把自己的中繼連線也關掉。
   * 房號與金鑰保留到逾期；房主隨時可用 hostOpen 接回（例如發現有客人的直連斷了）。
   */
  park(conn: RelayConn): RelayParkAck {
    const peer = this.touch(conn);
    if (!peer || peer.role?.kind !== 'host') return { ok: false, code: 'not_host' };
    const { room } = peer.role;
    if (room.guests.size > 0) return { ok: false, code: 'guests_present' };
    room.parked = true;
    return { ok: true };
  }

  /** 房主請伺服器把某位客人踢出中繼（遊戲層的踢人由房主自己處理）。 */
  kick(conn: RelayConn, payload: unknown): void {
    const peer = this.touch(conn);
    if (!peer || peer.role?.kind !== 'host') return this.fail(conn, 'not_host');
    const parsed = RelayKickSchema.safeParse(payload);
    if (!parsed.success) return this.fail(conn, 'invalid_message');
    const guest = peer.role.room.guests.get(parsed.data.guestId);
    if (!guest) return;
    guest.send(RELAY_EVENTS.closed, { reason: 'kicked' });
    this.removeGuest(peer.role.room, parsed.data.guestId);
    this.detachRole(guest);
    guest.close();
  }

  /** 只用來表示「還在」。 */
  ping(conn: RelayConn): void {
    this.touch(conn);
  }

  /** 傳輸層確認連線已關閉。 */
  disconnected(conn: RelayConn): void {
    const peer = this.peers.get(conn.id);
    if (!peer) return;
    peer.cancelIdle();
    this.peers.delete(conn.id);
    const role = peer.role;
    if (!role) return;
    if (role.kind === 'guest') {
      this.removeGuest(role.room, role.guestId);
      return;
    }
    const { room } = role;
    if (room.host?.id !== conn.id) return; // 已被接回的新連線取代
    room.host = null;
    for (const guest of room.guests.values())
      guest.send(RELAY_EVENTS.hostStatus, { online: false });
    room.cancelGrace();
    // 主動停泊的房間保留較久（房主在等直連的客人出狀況時才會回來）；意外斷線只給短暫寬限，
    // 但有後備房主時至少要撐到最後一順位的接手時間
    if (!room.parked) room.lostAt = this.options.scheduler.now();
    const keepMs = room.parked
      ? this.options.parkTtlMs
      : Math.max(this.options.hostGraceMs, this.successionWindowMs(room));
    room.cancelGrace = this.options.scheduler.after(keepMs, () => {
      this.closeRoom(room, 'host_left');
    });
  }

  // ── 房主轉移 ──────────────────────────────────────

  /** 房主登記後備順序（接手金鑰的雜湊）。每次順序改變就重送一次，整份取代。 */
  succession(conn: RelayConn, payload: unknown): RelaySimpleAck {
    const peer = this.touch(conn);
    if (!peer || peer.role?.kind !== 'host') return { ok: false, code: 'not_host' };
    const parsed = RelaySuccessionSchema.safeParse(payload);
    if (!parsed.success) return { ok: false, code: 'invalid_message' };
    peer.role.room.succession = [...new Set(parsed.data.order)];
    return { ok: true };
  }

  /** 房主指定某位後備立刻接手（計畫性交接）。這位在期限內出示金鑰，就不必等寬限期、也不必等房主離線。 */
  handover(conn: RelayConn, payload: unknown): RelaySimpleAck {
    const peer = this.touch(conn);
    if (!peer || peer.role?.kind !== 'host') return { ok: false, code: 'not_host' };
    const parsed = RelayHandoverSchema.safeParse(payload);
    if (!parsed.success) return { ok: false, code: 'invalid_message' };
    const { room } = peer.role;
    if (!room.succession.includes(parsed.data.target)) return { ok: false, code: 'bad_takeover' };
    room.handover = {
      target: parsed.data.target,
      until: this.options.scheduler.now() + (this.options.handoverTtlMs ?? HANDOVER_TTL_MS),
    };
    return { ok: true };
  }

  /**
   * 後備房主要求成為新房主。伺服器只驗證「金鑰雜湊在登記的順序裡」與「時間到了」，不看任何遊戲內容：
   * - 故障接手：房主不在線上（意外斷線，或停泊中有人找不到他），且已超過「寬限＋(順位−1)×間隔」。
   * - 計畫性交接：房主事先指定了這位（期限內），立刻成功，原房主的連線被取代。
   * 成功就換新的房主金鑰、世代加 1；舊金鑰之後只會得到 superseded。
   */
  takeover(conn: RelayConn, payload: unknown): RelayTakeoverAck {
    const peer = this.touch(conn);
    if (!peer || peer.role) return { ok: false, code: 'invalid_message' };
    if (!peer.bucket.take()) return { ok: false, code: 'rate_limited' };
    const parsed = RelayTakeoverSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        ok: false,
        code: hasOtherVersion(payload) ? 'protocol_mismatch' : 'invalid_message',
      };
    }
    const room = this.rooms.get(parsed.data.code);
    if (!room) return { ok: false, code: 'room_not_found' };
    const hash = hashToken(parsed.data.key);
    const index = room.succession.indexOf(hash);
    if (index < 0) return { ok: false, code: 'bad_takeover' };

    const now = this.options.scheduler.now();
    const planned =
      room.handover !== null && room.handover.target === hash && now <= room.handover.until;
    if (!planned) {
      const lost = room.lostAt ?? (room.parked ? room.suspectSince : null);
      if (room.host !== null && !room.parked) return { ok: false, code: 'host_online' };
      if (lost === null) return { ok: false, code: 'host_online' };
      const wait = this.takeoverWaitMs(index);
      const waited = now - lost;
      if (waited < wait) return { ok: false, code: 'too_early', retryInMs: wait - waited };
    }

    // 成立：取代房主
    const previous = room.host;
    room.retiredKeys = [...room.retiredKeys, room.hostKey].slice(-MAX_RETIRED_KEYS);
    room.hostKey = this.options.randomHex(16);
    room.epoch += 1;
    room.succession = [];
    room.handover = null;
    room.lostAt = null;
    room.suspectSince = null;
    room.parked = false;
    room.cancelGrace();
    room.host = conn;
    peer.role = { kind: 'host', room };
    this.promoteToHost(peer);
    if (previous && previous.id !== conn.id) {
      this.detachRole(previous);
      previous.send(RELAY_EVENTS.closed, { reason: 'superseded' });
      previous.close();
    }
    for (const guest of room.guests.values()) guest.send(RELAY_EVENTS.hostStatus, { online: true });
    for (const guestId of room.guests.keys()) conn.send(RELAY_EVENTS.guestJoined, { guestId });
    return { ok: true, code: room.code, hostKey: room.hostKey, epoch: room.epoch };
  }

  /** 第 index（從 0 起算）順位要等多久才能接手。 */
  private takeoverWaitMs(index: number): number {
    return (
      (this.options.successionGraceMs ?? SUCCESSION_GRACE_MS) +
      index * (this.options.successionStaggerMs ?? SUCCESSION_STAGGER_MS)
    );
  }

  /** 房主不見之後，房間要保留多久才能讓所有後備都有機會接手（沒有後備就是 0）。 */
  private successionWindowMs(room: Room): number {
    if (room.succession.length === 0) return 0;
    return this.takeoverWaitMs(room.succession.length - 1) + SUCCESSION_MARGIN_MS;
  }

  // ── 內部 ──────────────────────────────────────────

  private touch(conn: RelayConn): Peer | null {
    const peer = this.peers.get(conn.id);
    if (!peer) return null;
    peer.lastActive = this.options.scheduler.now();
    return peer;
  }

  private promoteToHost(peer: Peer): void {
    const { scheduler } = this.options;
    peer.bucket = new TokenBucket(
      this.options.hostBurst ?? HOST_BURST,
      this.options.hostPerSecond ?? HOST_PER_SECOND,
      () => scheduler.now(),
    );
  }

  private admit(conn: RelayConn, peer: Peer): boolean {
    if (peer.bucket.take()) return true;
    this.fail(conn, 'rate_limited');
    return false;
  }

  private chargeBytes(conn: RelayConn, room: Room, data: unknown): boolean {
    // 只量大小，不檢視內容。序列化失敗（循環參照等）視為不合法。
    let size: number;
    try {
      size = JSON.stringify(data)?.length ?? 0;
    } catch {
      this.fail(conn, 'invalid_message');
      return false;
    }
    if (size > this.maxData) {
      this.fail(conn, 'payload_too_large');
      return false;
    }
    if (!room.bytes.take(Math.max(1, size))) {
      this.fail(conn, 'rate_limited');
      return false;
    }
    return true;
  }

  private fail(conn: RelayConn, code: RelayErrorCode): void {
    conn.send(RELAY_EVENTS.error, { code });
  }

  private removeGuest(room: Room, guestId: string): void {
    if (!room.guests.delete(guestId)) return;
    room.host?.send(RELAY_EVENTS.guestLeft, { guestId });
  }

  private detachRole(conn: RelayConn): void {
    const peer = this.peers.get(conn.id);
    if (peer) peer.role = null;
  }

  private closeRoom(room: Room, reason: RelayClosedReason): void {
    this.rooms.delete(room.code);
    room.cancelGrace();
    const guests = [...room.guests.values()];
    room.guests.clear();
    for (const guest of guests) {
      guest.send(RELAY_EVENTS.closed, { reason });
      const peer = this.peers.get(guest.id);
      if (peer) peer.role = null;
      guest.close();
    }
    const host = room.host;
    room.host = null;
    if (host) {
      const peer = this.peers.get(host.id);
      if (peer) peer.role = null;
      host.send(RELAY_EVENTS.closed, { reason });
      host.close();
    }
  }

  private armIdle(conn: RelayConn, peer: Peer, ms: number): void {
    if (this.options.idleKickMs <= 0) return;
    const { scheduler } = this.options;
    peer.cancelIdle();
    peer.cancelIdle = scheduler.after(ms, () => {
      const idleFor = scheduler.now() - peer.lastActive;
      if (idleFor >= this.options.idleKickMs) {
        conn.send(RELAY_EVENTS.closed, { reason: 'idle_timeout' });
        conn.close();
      } else {
        this.armIdle(conn, peer, this.options.idleKickMs - idleFor);
      }
    });
  }
}

/** 版本欄位存在但不是目前版本。 */
function hasOtherVersion(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'relayVersion' in payload &&
    (payload as { relayVersion: unknown }).relayVersion !== RELAY_PROTOCOL_VERSION
  );
}

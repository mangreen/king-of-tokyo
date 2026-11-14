/**
 * 角色切換端點（M9）：頁面看到的永遠是「一條通往房主的通道」（LocalEndpoint），
 * 但這條通道背後的角色會變：
 *
 *   客人 ──（房主不見、輪到我、接手成功）──▶ 房主 ──（被新房主取代）──▶ 客人
 *
 * 切換時頁面只看到「連線中斷 → 重新連上」，用原本的 token 重新握手就接回原本的座位，
 * 所以 UI 與遊戲畫面完全不需要知道房主換人了（畫面上的「你是房主」之類由 onRole 另外通知）。
 *
 * 客人端：GuestEndpoint ＋ Standby（收複本、必要時接手）。
 * 房主端：HostSide（RelayedHost 的包裝；網頁裡跑在 Worker）。被取代（superseded）就降級回客人。
 */
import type { GuestEndpoint, GuestEndpointOptions } from '../relay/guestEndpoint.js';
import type { LocalEndpoint, ToClient, ToHost } from '../local/protocol.js';
import type { RelayedHost } from '../relay/relayedHost.js';
import type { Scheduler } from '../scheduler.js';
import { Standby, type StandbyState, type TakeoverTarget } from './standby.js';

/** 房主這一側需要的能力（RelayedHost 或 Worker 裡的房主都能實作）。 */
export interface HostSide extends TakeoverTarget {
  /** 接上這一頁自己的連線；回傳收訊函式（與 LocalHost.connect 相同，會先送 open）。 */
  connectPage(send: (message: ToClient) => void): (message: ToHost) => void;
  /** 被新房主取代時呼叫（只會呼叫一次）。 */
  onSuperseded(handler: () => void): void;
  /** 計畫性交接給某位後備；成功時房主身分會立刻被取代（onSuperseded 隨後觸發）。 */
  handover(playerId: string): Promise<{ ok: true } | { ok: false; reason: string }>;
}

/** 把 RelayedHost 包成 HostSide（同執行緒的版本；測試與離線測試用）。 */
export function hostSideOf(relayed: RelayedHost): HostSide {
  return {
    prepare: (replica) => relayed.prepare(replica),
    takeover: (code, key) => relayed.takeover(code, key),
    abandon: () => {
      relayed.bridge.close();
    },
    connectPage: (send) => relayed.connectPage(send),
    onSuperseded: (handler) => {
      relayed.bridge.onStatus((status) => {
        if (status.state === 'closed' && status.reason === 'superseded') handler();
      });
    },
    handover: (playerId) => relayed.bridge.handover(playerId),
  };
}

export type Role = 'guest' | 'host';

export interface RoleInfo {
  role: Role;
  /** 客人時的後備狀態；房主時為 'done'。 */
  standby: StandbyState;
  /** 後備名次（1＝第一順位）；不是後備為 null。 */
  rank: number | null;
  /** 房主世代（接手後遞增）。 */
  epoch: number;
}

export interface RoleEndpointOptions<H extends HostSide> {
  code: string;
  scheduler: Scheduler;
  /** 建立（或重建）客人端點；hooks 要原樣併入端點選項。 */
  createGuest: (hooks: Pick<GuestEndpointOptions, 'onReplica' | 'onHostState'>) => GuestEndpoint;
  /** 建立一個新的房主（尚未登記；接手流程才會 prepare／takeover）。 */
  createHost: () => H;
  onRole?: (info: RoleInfo) => void;
  graceMs?: number;
  staggerMs?: number;
}

export interface RoleEndpoint extends LocalEndpoint {
  readonly role: Role;
  /** 把房主交給某位後備；回傳是否成功（成功後本端會降級成客人）。 */
  handover(playerId: string): Promise<boolean>;
  /** 目前的資訊快照。 */
  info(): RoleInfo;
}

export function createRoleEndpoint<H extends HostSide>(
  options: RoleEndpointOptions<H>,
): RoleEndpoint {
  let handler: (message: ToClient) => void = () => undefined;
  let alive = true;
  let role: Role = 'guest';
  let epoch = 0;
  let guest: GuestEndpoint | null = null;
  let standby: Standby<H> | null = null;
  let host: H | null = null;
  let hostReceive: ((message: ToHost) => void) | null = null;
  let playerId: string | undefined;
  /** 頁面目前是否處於「已連上」。切換角色前若是連上的，要先讓它看到中斷。 */
  let pageOpen = false;

  const notify = (): void => {
    options.onRole?.(info());
  };

  const info = (): RoleInfo => ({
    role,
    standby: role === 'host' ? 'done' : (standby?.state ?? 'watching'),
    rank: role === 'host' ? null : (standby?.rank ?? null),
    epoch: role === 'host' ? epoch : (standby?.mirror.epoch ?? 0),
  });

  /** 所有送給頁面的訊息都經過這裡：記錄連線狀態與自己的玩家 id。 */
  const toPage = (message: ToClient): void => {
    if (!alive) return;
    if (message.t === 'open') pageOpen = true;
    else if (message.t === 'closed' || message.t === 'error') pageOpen = false;
    else if (message.t === 'emit' && message.event === 'server:hello') {
      const id = (message.payload as { playerId?: unknown } | null)?.playerId;
      if (typeof id === 'string') playerId = id;
    }
    handler(message);
  };

  const interruptPage = (): void => {
    if (pageOpen) toPage({ t: 'closed' });
  };

  const startGuest = (resuming: boolean): void => {
    const current = new Standby<H>({
      code: options.code,
      playerId: () => playerId,
      scheduler: options.scheduler,
      create: options.createHost,
      requestReplica: () => guest?.requestReplica(),
      onTakeover: (target, newEpoch) => {
        becomeHost(target, newEpoch);
      },
      onState: () => {
        if (standby === current) notify();
      },
      ...(options.graceMs === undefined ? {} : { graceMs: options.graceMs }),
      ...(options.staggerMs === undefined ? {} : { staggerMs: options.staggerMs }),
    });
    standby = current;
    const endpoint = options.createGuest({
      onReplica: (sync) => {
        current.onReplica(sync);
      },
      onHostState: (state) => {
        current.onHostState(state);
      },
    });
    guest = endpoint;
    endpoint.listen(toPage);
    if (resuming) notify();
  };

  const stopGuest = (): void => {
    standby?.dispose();
    standby = null;
    guest?.terminate();
    guest = null;
  };

  const becomeHost = (target: H, newEpoch: number): void => {
    if (!alive) {
      target.abandon();
      return;
    }
    stopGuest();
    interruptPage(); // 頁面先看到中斷，再看到新連線，才會用 token 重新握手
    role = 'host';
    epoch = newEpoch;
    host = target;
    target.onSuperseded(() => {
      if (host === target) demote();
    });
    hostReceive = target.connectPage(toPage);
    notify();
  };

  /** 被新房主取代：丟掉本機的房間，重新以客人身分加入。 */
  const demote = (): void => {
    const old = host;
    host = null;
    hostReceive = null;
    old?.abandon();
    interruptPage();
    role = 'guest';
    startGuest(true);
  };

  startGuest(false);

  return {
    get role() {
      return role;
    },
    info,
    post(message) {
      if (!alive) return;
      if (role === 'host') hostReceive?.(message);
      else guest?.post(message);
    },
    listen(next) {
      handler = next;
    },
    async handover(targetId) {
      const current = host;
      if (role !== 'host' || current === null) return false;
      const result = await current.handover(targetId);
      // 成功時 onSuperseded 已經（或即將）把我們降級成客人
      return result.ok;
    },
    terminate() {
      alive = false;
      stopGuest();
      host?.abandon();
      host = null;
      hostReceive = null;
    },
  };
}

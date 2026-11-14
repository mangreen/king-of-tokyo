/**
 * 房主轉移測試的共用工具：記憶體中繼＋假時鐘＋「頁面」替身。全部同步、確定性。
 * 一個節點（房主或客人）有自己的假時鐘；節點被「殺掉」就不再推進它的時鐘，等於整個分頁消失。
 */
import { EVENTS, PROTOCOL_VERSION, type Ack, type RoomSnapshot } from '@kot/protocol';
import {
  createGuestEndpoint,
  createRelayedHost,
  type GuestEndpoint,
  type GuestEndpointOptions,
  type HostBridgeOptions,
  type HostSide,
  type RoleEndpoint,
  type RoleEndpointOptions,
  createRoleEndpoint,
  hostSideOf,
  type RelayedHost,
  type RelayedHostOptions,
  type Timings,
  type ToClient,
  type ToHost,
} from '@kot/room';
import { FakeScheduler } from '@kot/room/testing';
import { testCardSet } from '@kot/room/testing-fs';
import { createMemoryRelay, type MemoryRelay, type MemorySocket } from './memoryRelay.js';
import type { RelayOptions } from './registry.js';

export const TIMINGS: Timings = {
  decisionMs: 1000,
  yieldMs: 500,
  awayConnectedMs: 200,
  awayOfflineMs: 50,
  emptyRoomMs: 10_000,
  lobbyOfflineMs: 2_000,
  overRoomMs: 30_000,
  botMs: 100,
};

/** 頁面：包住通往房主的通道，收集事件、同步送請求（pump 之後 ack 一定到了）。 */
export class Page {
  readonly events: ToClient[] = [];
  private nextAck = 1;
  private readonly acks = new Map<number, Ack>();
  token: string | undefined;
  playerId: string | undefined;

  constructor(
    private readonly post: (message: ToHost) => void,
    private readonly settle: () => Promise<void>,
  ) {}

  receive = (message: ToClient): void => {
    this.events.push(message);
    if (message.t === 'ack') this.acks.set(message.ackId, message.result);
    if (message.t === 'emit' && message.event === EVENTS.serverHello) {
      const hello = message.payload as { sessionToken: string; playerId: string };
      this.token = hello.sessionToken;
      this.playerId = hello.playerId;
    }
  };

  async emit(event: string, payload?: unknown): Promise<void> {
    this.post({ t: 'event', event, payload });
    await this.settle();
  }

  async request(event: string, payload: unknown = {}): Promise<Ack> {
    const ackId = this.nextAck;
    this.nextAck += 1;
    this.post({ t: 'event', event, payload, ackId });
    await this.settle();
    const result = this.acks.get(ackId);
    if (result === undefined) throw new Error(`沒有收到 ack：${event}`);
    return result;
  }

  async hello(nickname: string, token?: string): Promise<Record<string, unknown>> {
    const before = this.count(EVENTS.serverHello);
    await this.emit(EVENTS.clientHello, {
      protocolVersion: PROTOCOL_VERSION,
      nickname,
      ...(token === undefined ? {} : { sessionToken: token }),
    });
    if (this.count(EVENTS.serverHello) === before) throw new Error('沒有收到 hello');
    return this.last(EVENTS.serverHello) ?? {};
  }

  last<T = Record<string, unknown>>(event: string): T | undefined {
    for (let i = this.events.length - 1; i >= 0; i -= 1) {
      const m = this.events[i];
      if (m?.t === 'emit' && m.event === event) return m.payload as T;
    }
    return undefined;
  }

  count(event: string): number {
    return this.events.filter((m) => m.t === 'emit' && m.event === event).length;
  }

  room(): RoomSnapshot | null | undefined {
    return this.last<{ room: RoomSnapshot | null }>(EVENTS.roomState)?.room;
  }

  get opens(): number {
    return this.events.filter((m) => m.t === 'open').length;
  }

  get lastEvent(): ToClient | undefined {
    return this.events.at(-1);
  }
}

export interface HostNode {
  relayed: RelayedHost;
  page: Page;
  scheduler: FakeScheduler;
  socket: MemorySocket;
  code: () => string;
}

export interface GuestNode {
  endpoint: GuestEndpoint;
  page: Page;
  scheduler: FakeScheduler;
  socket: MemorySocket;
}

/** 角色切換節點：頁面不知道自己現在是客人還是房主。 */
export interface RoleNode {
  endpoint: RoleEndpoint;
  page: Page;
  scheduler: FakeScheduler;
  /** 目前（或最近一次）作為房主的本機節點；還沒當過房主為 null。 */
  hosts: HostNode[];
  roles: string[];
  /** 頁面用原本的 token 重新握手（真正的頁面在收到 open 後會自動做這件事）。 */
  rehello: () => Promise<Record<string, unknown>>;
}

export class Cluster {
  readonly clock = new FakeScheduler();
  readonly relay: MemoryRelay;
  private readonly alive = new Set<FakeScheduler>();

  constructor(relayOptions: Partial<RelayOptions> = {}) {
    this.relay = createMemoryRelay(this.clock, relayOptions);
  }

  /** 處理所有待處理的訊息與微任務，直到穩定（房主端有 Promise，所以不能只 pump）。 */
  settle = async (): Promise<void> => {
    for (let i = 0; i < 6; i += 1) {
      this.relay.pump();
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
    }
    this.relay.pump();
  };

  /** 新房主節點（尚未建房）。 */
  host(
    options: {
      relayed?: Partial<RelayedHostOptions>;
      bridge?: Omit<HostBridgeOptions, 'canPark'>;
      /** 不替這個節點接自己的頁面（角色切換端點會自己接）。 */
      noPage?: boolean;
    } = {},
  ): HostNode {
    const scheduler = new FakeScheduler();
    this.alive.add(scheduler);
    const socket = this.relay.socket({ autoConnect: false });
    const relayed = createRelayedHost({
      cardSet: testCardSet(),
      scheduler,
      timings: TIMINGS,
      socket,
      ...(options.bridge === undefined ? {} : { bridge: { scheduler, ...options.bridge } }),
      ...options.relayed,
    });
    const page = new Page(() => undefined, this.settle);
    if (options.noPage !== true) {
      const receive = relayed.connectPage(page.receive);
      (page as unknown as { post: (m: ToHost) => void }).post = receive;
    }
    return { relayed, page, scheduler, socket, code: () => relayed.bridge.code ?? '' };
  }

  /** 房主建房，回傳節點（已握手、已建立房間）。 */
  async createdHost(
    nickname = '房主',
    options?: Parameters<Cluster['host']>[0],
  ): Promise<HostNode> {
    const node = this.host(options);
    await node.page.hello(nickname);
    await node.page.request(EVENTS.roomCreate, {});
    return node;
  }

  /** 一開始就是房主的角色切換節點（網頁的房主就是這樣）：建房後被取代時會降級成客人。 */
  async roleHost(nickname = '房主'): Promise<RoleNode & { host: HostNode; code: string }> {
    const scheduler = new FakeScheduler();
    this.alive.add(scheduler);
    const host = this.host({ noPage: true });
    const hosts: HostNode[] = [host];
    const roles: string[] = [];
    let code = '';
    const endpoint = createRoleEndpoint<HostSide>({
      initial: hostSideOf(host.relayed),
      scheduler,
      createGuest: (joinCode, hooks, resuming) =>
        createGuestEndpoint(this.relay.socket(), joinCode, { scheduler, resuming, ...hooks }),
      createHost: () => {
        const node = this.host({ noPage: true });
        hosts.push(node);
        return hostSideOf(node.relayed);
      },
      onRole: (info) => {
        roles.push(`${info.role}:${info.standby}`);
      },
    });
    const page = new Page((m) => {
      endpoint.post(m);
    }, this.settle);
    endpoint.listen(page.receive);
    await this.settle();
    await page.hello(nickname);
    await page.request(EVENTS.roomCreate, {});
    code = host.code();
    return {
      endpoint,
      page,
      scheduler,
      hosts,
      roles,
      rehello: () => page.hello(nickname, page.token),
      host,
      code,
    };
  }

  /** 客人節點：連到房號、握手、加入房間、準備。 */
  async guest(
    code: string,
    nickname: string,
    options: GuestEndpointOptions = {},
    join = true,
  ): Promise<GuestNode> {
    // 呼叫端可以先建好時鐘（例如後備房主的狀態機要與端點共用同一個時鐘）
    const scheduler = (options.scheduler as FakeScheduler | undefined) ?? new FakeScheduler();
    this.alive.add(scheduler);
    const socket = this.relay.socket();
    const endpoint = createGuestEndpoint(socket, code, { ...options, scheduler });
    const page = new Page((m) => {
      endpoint.post(m);
    }, this.settle);
    endpoint.listen(page.receive);
    await this.settle();
    if (join) {
      await page.hello(nickname);
      await page.request(EVENTS.roomJoin, { code });
      await page.request(EVENTS.roomReady, { ready: true });
    }
    return { endpoint, page, scheduler, socket };
  }

  /** 節點的時鐘納入／移出推進範圍（殺掉節點＝移出）。 */
  track(scheduler: FakeScheduler): void {
    this.alive.add(scheduler);
  }
  kill(scheduler: FakeScheduler): void {
    this.alive.delete(scheduler);
  }

  /** 所有活著的節點與中繼一起前進（每步後處理訊息）。 */
  async advance(ms: number, step = 250): Promise<void> {
    for (let t = 0; t < ms; t += step) {
      const dt = Math.min(step, ms - t);
      for (const scheduler of this.alive) scheduler.advance(dt);
      this.clock.advance(dt);
      await this.settle();
    }
  }

  /**
   * 角色切換的玩家節點：先當客人（握手、加入、準備），房主不見時由 Standby 接手，之後以房主身分運作。
   * nickname 用來重新握手；token 由頁面自己記得。
   */
  async roleNode(
    code: string,
    nickname: string,
    extra: Partial<Pick<RoleEndpointOptions<HostSide>, 'graceMs' | 'staggerMs'>> = {},
  ): Promise<RoleNode> {
    const scheduler = new FakeScheduler();
    this.alive.add(scheduler);
    const hosts: HostNode[] = [];
    const roles: string[] = [];
    const endpoint = createRoleEndpoint<HostSide>({
      code,
      scheduler,
      ...extra,
      createGuest: (joinCode, hooks, resuming) =>
        createGuestEndpoint(this.relay.socket(), joinCode, { scheduler, resuming, ...hooks }),
      createHost: () => {
        const node = this.host({ noPage: true });
        hosts.push(node);
        return hostSideOf(node.relayed);
      },
      onRole: (info) => {
        roles.push(`${info.role}:${info.standby}`);
      },
    });
    const page = new Page((m) => {
      endpoint.post(m);
    }, this.settle);
    endpoint.listen(page.receive);
    await this.settle();
    await page.hello(nickname);
    await page.request(EVENTS.roomJoin, { code });
    await page.request(EVENTS.roomReady, { ready: true });
    return {
      endpoint,
      page,
      scheduler,
      hosts,
      roles,
      rehello: () => page.hello(nickname, page.token),
    };
  }
}

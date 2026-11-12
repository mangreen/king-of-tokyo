import { describe, expect, it } from 'vitest';
import type { ToClient, ToHost, WireRtc, WireSwitch } from '../local/protocol.js';
import { FakeScheduler } from '../testing.js';
import { createFakeDirectNetwork } from './fake.js';
import { DirectSession } from './session.js';
import type { DirectConnector } from './types.js';

type RelayMsg<T> = T | WireRtc | WireSwitch;

const validate = <T>(value: unknown): T | null =>
  typeof value === 'object' && value !== null && 't' in value ? (value as T) : null;

/** 一對房主／客人工作階段，中間的「中繼」可以扣住訊息（模擬延遲）。 */
function pair(options: { connector?: DirectConnector | null; connectTimeoutMs?: number } = {}) {
  const net = createFakeDirectNetwork();
  const scheduler = new FakeScheduler();
  const connector = options.connector === undefined ? net.connector : options.connector;
  const hostGot: ToHost[] = [];
  const guestGot: ToClient[] = [];
  const events: string[] = [];
  const queues = { toGuest: [] as RelayMsg<ToClient>[], toHost: [] as RelayMsg<ToHost>[] };
  let holdRelay = false;

  const host: DirectSession<ToClient, ToHost> = new DirectSession<ToClient, ToHost>({
    role: 'host',
    connector,
    scheduler,
    connectTimeoutMs: options.connectTimeoutMs ?? 10_000,
    sendRelay: (m) => {
      queues.toGuest.push(m);
      if (!holdRelay) flush();
    },
    deliver: (m) => hostGot.push(m),
    parse: validate<ToHost>,
    onSwitched: () => events.push('host-switched'),
    onLost: () => events.push('host-lost'),
  });
  const guest: DirectSession<ToHost, ToClient> = new DirectSession<ToHost, ToClient>({
    role: 'guest',
    connector,
    scheduler,
    connectTimeoutMs: options.connectTimeoutMs ?? 10_000,
    sendRelay: (m) => {
      queues.toHost.push(m);
      if (!holdRelay) flush();
    },
    deliver: (m) => guestGot.push(m),
    parse: validate<ToClient>,
    onSwitched: () => events.push('guest-switched'),
    onLost: () => events.push('guest-lost'),
  });

  function route<T extends { t: string }>(
    target: DirectSession<unknown, T>,
    message: RelayMsg<T>,
  ): void {
    if (message.t === 'rtc' || message.t === 'switch')
      target.receiveControl(message as WireRtc | WireSwitch);
    else target.receive(message as T);
  }
  function flush(): void {
    while (queues.toGuest.length > 0 || queues.toHost.length > 0) {
      const g = queues.toGuest.shift();
      if (g) route(guest as DirectSession<unknown, ToClient>, g);
      const h = queues.toHost.shift();
      if (h) route(host as DirectSession<unknown, ToHost>, h);
    }
  }

  return {
    net,
    scheduler,
    host,
    guest,
    hostGot,
    guestGot,
    events,
    hold: (value: boolean) => {
      holdRelay = value;
    },
    flush,
  };
}

const emit = (n: number): ToClient => ({ t: 'emit', event: 'e', payload: n });
const post = (n: number): ToHost => ({ t: 'event', event: 'e', payload: n });
const payloads = (list: (ToClient | ToHost)[]): unknown[] =>
  list.map((m) => ('payload' in m ? m.payload : m.t));

describe('直連切換', () => {
  it('沒有 connector：全部走中繼，行為不變', () => {
    const t = pair({ connector: null });
    t.host.start();
    t.host.send(emit(1));
    t.guest.send(post(2));
    expect(payloads(t.guestGot)).toEqual([1]);
    expect(payloads(t.hostGot)).toEqual([2]);
    expect(t.net.created).toEqual([]);
  });

  it('房主開始協商、通道開啟後兩個方向都切到直連，onSwitched 各一次', () => {
    const t = pair();
    t.host.start();
    expect(t.net.pending).toBe(1);
    t.host.send(emit(1)); // 還走中繼
    t.net.openAll();
    expect(t.host.isDirect).toBe(true);
    expect(t.guest.isDirect).toBe(true);
    expect(t.events.sort()).toEqual(['guest-switched', 'host-switched']);
    t.host.send(emit(2));
    t.guest.send(post(3));
    expect(payloads(t.guestGot)).toEqual([1, 2]);
    expect(payloads(t.hostGot)).toEqual([3]);
  });

  it('順序：直連的訊息比中繼上較早的訊息先到時，先暫存，等中繼標記到了才依序放行', () => {
    const t = pair();
    t.host.start();
    t.hold(true); // 中繼變慢
    t.host.send(emit(1));
    t.host.send(emit(2));
    t.net.openAll(); // 房主排入 switch 標記，之後走直連
    t.host.send(emit(3));
    t.host.send(emit(4));
    // 直連的 3、4 已經到了客人，但中繼的 1、2 與標記還沒到
    expect(t.guestGot).toEqual([]);
    t.hold(false);
    t.flush();
    expect(payloads(t.guestGot)).toEqual([1, 2, 3, 4]);
  });

  it('反方向同樣保序（客人→房主）', () => {
    const t = pair();
    t.host.start();
    t.hold(true); // 兩邊的切換標記都還在路上
    t.net.openAll();
    t.guest.send(post(1)); // 已切到直連，立即送達；但房主還沒收到客人的標記
    expect(t.hostGot).toEqual([]);
    t.hold(false);
    t.flush();
    expect(payloads(t.hostGot)).toEqual([1]);
  });

  it('長訊息切段後經直連送達', () => {
    const t = pair();
    t.host.start();
    t.net.openAll();
    const big = 'x'.repeat(40_000);
    t.host.send({ t: 'emit', event: 'big', payload: big });
    expect(t.guestGot).toHaveLength(1);
    expect((t.guestGot[0] as { payload: string }).payload).toBe(big);
  });

  it('逾時沒連上：放棄直連，繼續走中繼，不算中斷', () => {
    const t = pair({ connectTimeoutMs: 5_000 });
    t.host.start();
    t.scheduler.advance(6_000);
    t.host.send(emit(1));
    expect(payloads(t.guestGot)).toEqual([1]);
    expect(t.events).toEqual([]);
    expect(t.host.isDirect).toBe(false);
  });

  it('已開啟的直連中斷：兩端各通知一次 onLost', () => {
    const t = pair();
    t.host.start();
    t.net.openAll();
    t.net.dropAll();
    expect(t.events.filter((e) => e.endsWith('lost')).sort()).toEqual(['guest-lost', 'host-lost']);
    expect(t.host.isDirect).toBe(false);
  });

  it('對方經直連送來不合法資料：中斷直連（視為中斷），不交給遊戲層', () => {
    const t = pair();
    t.host.start();
    t.net.openAll();
    t.net.inject('host', 'M{not json');
    expect(t.events).toContain('host-lost');
    expect(t.hostGot).toEqual([]);
    const u = pair();
    u.host.start();
    u.net.openAll();
    u.net.inject('guest', `M${JSON.stringify({ nope: 1 })}`); // 沒有 t 欄位：驗證不過
    expect(u.events).toContain('guest-lost');
    expect(u.guestGot).toEqual([]);
  });

  it('標記前塞太多早到訊息：中斷', () => {
    const t = pair();
    t.host.start();
    t.hold(true);
    t.net.openAll();
    for (let i = 0; i < 300; i += 1) t.net.inject('guest', `M${JSON.stringify(emit(i))}`);
    expect(t.events).toContain('guest-lost');
  });
});

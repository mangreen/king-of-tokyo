import { describe, expect, it } from 'vitest';
import { EVENTS, RELAY_PROTOCOL_VERSION } from '@kot/protocol';
import {
  hashToken,
  ReplicaMirror,
  Standby,
  type ReplicaSync,
  type RoomReplica,
  type TakeoverTarget,
} from '@kot/room';
import { FakeScheduler } from '@kot/room/testing';
import { Cluster, type GuestNode, type HostNode } from './testkit.js';

/** 客人收到的複本同步（攔在端點層，頁面完全看不到）。 */
function mirrorOf(): {
  mirror: ReplicaMirror;
  syncs: ReplicaSync[];
  onReplica: (s: ReplicaSync) => void;
} {
  const mirror = new ReplicaMirror();
  const syncs: ReplicaSync[] = [];
  return {
    mirror,
    syncs,
    onReplica: (sync) => {
      syncs.push(sync);
      mirror.apply(sync);
    },
  };
}

async function lobbyWithGuests(cluster: Cluster, n = 2) {
  const host = await cluster.createdHost();
  const mirrors = Array.from({ length: n }, () => mirrorOf());
  const guests: GuestNode[] = [];
  for (const [i, m] of mirrors.entries()) {
    guests.push(
      await cluster.guest(host.code(), `客人${String(i + 1)}`, { onReplica: m.onReplica }),
    );
  }
  return { host, guests, mirrors };
}

describe('複本同步與後備登記（M9-2）', () => {
  it('每位真人客人都收到與房主相同的複本；頁面看不到複本訊息', async () => {
    const cluster = new Cluster();
    const { host, guests, mirrors } = await lobbyWithGuests(cluster);
    await host.page.request(EVENTS.roomAddBot, {});
    const code = host.code();
    const expected = host.relayed.local.host.exportRoom(code);
    expect(expected).not.toBeNull();
    for (const m of mirrors) {
      const snap = m.mirror.snapshot();
      expect(snap).toMatchObject({ code, phase: 'lobby', hostId: host.page.playerId });
      expect(snap?.members.map((x) => x.id).sort()).toEqual(
        expected?.members.map((x) => x.id).sort(),
      );
    }
    for (const g of guests) {
      expect(g.page.events.some((e) => (e as { t: string }).t === 'replica')).toBe(false);
    }
  });

  it('開局後增量同步：後備的日誌隨房主一路追上，重放結果一致', async () => {
    const cluster = new Cluster();
    const { host, guests, mirrors } = await lobbyWithGuests(cluster);
    await host.page.request(EVENTS.roomReady, { ready: true });
    expect(await host.page.request(EVENTS.roomStart, {})).toEqual({ ok: true });
    await cluster.advance(20_000);
    const exported = host.relayed.local.host.exportRoom(host.code());
    expect(exported?.actions.length).toBeGreaterThan(5);
    for (const m of mirrors) {
      expect(m.mirror.actionCount).toBe(exported?.actions.length);
      expect(m.mirror.snapshot()?.actions).toEqual(exported?.actions);
    }
    // 沒有重送整份：後備收到的每則只含新增的部分
    const first = mirrors[0];
    const covered = first?.syncs.reduce((n, s) => n + s.actions.length, 0) ?? 0;
    expect(covered).toBe(exported?.actions.length);
    expect(guests).toHaveLength(2);
  });

  it('接手金鑰只給本人；順序是加入先後；伺服器只存雜湊', async () => {
    const cluster = new Cluster();
    const { host, mirrors } = await lobbyWithGuests(cluster);
    const [k1, k2] = mirrors.map((m) => m.mirror.key);
    expect(k1).toMatch(/^[0-9a-f]{32}$/);
    expect(k2).toMatch(/^[0-9a-f]{32}$/);
    expect(k1).not.toBe(k2);
    // 同步訊息裡不會出現別人的金鑰
    for (const m of mirrors) {
      const text = JSON.stringify(m.syncs);
      const other = m === mirrors[0] ? k2 : k1;
      expect(text).not.toContain(other as string);
    }
    expect(mirrors[0]?.mirror.order).toHaveLength(2);
    expect(mirrors[0]?.mirror.order).toEqual(mirrors[1]?.mirror.order);
    // 伺服器登記的是雜湊：用金鑰試接手，伺服器認得（房主在線上所以是 host_online，不是 bad_takeover）
    const probe = cluster.relay.socket();
    await cluster.settle();
    const results: unknown[] = [];
    for (const key of [k1, k2, 'f'.repeat(32)]) {
      probe.emit(
        'relay:takeover',
        { relayVersion: RELAY_PROTOCOL_VERSION, code: host.code(), key },
        (r) => results.push(r),
      );
    }
    await cluster.settle();
    expect(results).toEqual([
      { ok: false, code: 'host_online' },
      { ok: false, code: 'host_online' },
      { ok: false, code: 'bad_takeover' },
    ]);
    expect(hashToken(k1 as string)).toHaveLength(64);
  });

  it('客人離開或電腦玩家不在順序裡；新客人加入後順序更新', async () => {
    const cluster = new Cluster();
    const { host, guests, mirrors } = await lobbyWithGuests(cluster);
    await host.page.request(EVENTS.roomAddBot, {});
    expect(mirrors[0]?.mirror.order).toHaveLength(2);
    await guests[1]?.page.request(EVENTS.roomLeave, {});
    await cluster.settle();
    expect(mirrors[0]?.mirror.order).toEqual([guests[0]?.page.playerId]);
    const late = mirrorOf();
    const g3 = await cluster.guest(host.code(), '晚到', { onReplica: late.onReplica });
    expect(mirrors[0]?.mirror.order).toEqual([guests[0]?.page.playerId, g3.page.playerId]);
    expect(late.mirror.snapshot()?.members).toHaveLength(4);
  });

  it('客人重連（新連線）後從頭收到完整複本', async () => {
    const cluster = new Cluster();
    const { host, guests } = await lobbyWithGuests(cluster, 1);
    const g = guests[0] as GuestNode;
    g.socket.kill();
    await cluster.settle();
    const again = mirrorOf();
    const g2 = await cluster.guest(host.code(), '客人1', { onReplica: again.onReplica }, false);
    await g2.page.hello('客人1', g.page.token);
    expect(again.mirror.snapshot()?.code).toBe(host.code());
    expect(again.syncs[0]?.from).toBe(0);
  });
});

/** 後備客人：端點＋Standby；接手成功時換成新的房主節點。 */
class RelayedTarget implements TakeoverTarget {
  constructor(readonly node: HostNode) {}
  prepare(replica: RoomReplica) {
    return this.node.relayed.prepare(replica);
  }
  takeover(code: string, key: string) {
    return this.node.relayed.takeover(code, key);
  }
  abandon(): void {
    this.node.relayed.bridge.close();
  }
}

interface StandbyGuest {
  node: GuestNode;
  standby: Standby<RelayedTarget>;
  /** 接手成功後的新房主節點與他自己的頁面（還沒接手為 null）。 */
  taken: { host: HostNode; epoch: number } | null;
  states: string[];
}

async function standbyGuest(
  cluster: Cluster,
  code: string,
  nickname: string,
): Promise<StandbyGuest> {
  const scheduler = new FakeScheduler();
  const result = { taken: null, states: [] } as unknown as StandbyGuest;
  const standby = new Standby<RelayedTarget>({
    code,
    playerId: () => (result.node as GuestNode | undefined)?.page.playerId,
    scheduler,
    create: () => new RelayedTarget(cluster.host()),
    onTakeover: (target, epoch) => {
      result.node.endpoint.terminate();
      result.taken = { host: target.node, epoch };
    },
    requestReplica: () => result.node.endpoint.requestReplica(),
    onState: (state) => result.states.push(state),
  });
  result.standby = standby;
  result.node = await cluster.guest(code, nickname, {
    scheduler,
    onReplica: (sync) => standby.onReplica(sync),
    onHostState: (state) => standby.onHostState(state),
  });
  return result;
}

/** 房主「整個分頁消失」：時鐘停擺、連線斷掉。 */
async function killHost(cluster: Cluster, host: HostNode): Promise<void> {
  cluster.kill(host.scheduler);
  host.socket.kill();
  await cluster.settle();
}

describe('故障接手（M9-3）', () => {
  it('房主消失：第一順位在 10 秒後接手，所有人以原本身分接回，對局繼續到結束', async () => {
    const cluster = new Cluster();
    const host = await cluster.createdHost();
    const code = host.code();
    const g1 = await standbyGuest(cluster, code, '客人1');
    const g2 = await standbyGuest(cluster, code, '客人2');
    await host.page.request(EVENTS.roomReady, { ready: true });
    expect(await host.page.request(EVENTS.roomStart, {})).toEqual({ ok: true });
    await cluster.advance(3_000);
    const before = host.relayed.local.host.exportRoom(code);
    expect(before?.actions.length).toBeGreaterThan(3);

    await killHost(cluster, host);
    expect(g1.standby.state).toBe('waiting');
    await cluster.advance(9_000);
    expect(g1.taken).toBeNull();
    await cluster.advance(2_000);
    expect(g1.taken?.epoch).toBe(1);
    expect(g2.taken).toBeNull(); // 第二順位不會搶

    // 新房主的頁面（原本的客人1）以原本的 token 接回座位
    const next = g1.taken?.host as HostNode;
    const token1 = g1.node.page.token;
    await next.page.hello('客人1', token1);
    expect(next.page.last('server:hello')).toMatchObject({ resumed: true });
    expect(next.page.playerId).toBe(g1.node.page.playerId);
    // 客人2 看到房主換了（連線重開），用原本的 token 接回
    expect(g2.node.page.opens).toBeGreaterThanOrEqual(2);
    await g2.node.page.hello('客人2', g2.node.page.token);
    expect(g2.node.page.last('server:hello')).toMatchObject({ resumed: true });
    expect(g2.node.page.room()?.hostId).toBe(host.page.playerId);

    // 接手的複本是房主消失前的狀態（至少包含當時已同步的所有動作）
    const after = next.relayed.local.host.exportRoom(code);
    expect(after?.actions.slice(0, before?.actions.length)).toEqual(before?.actions);

    // 對局繼續：所有計時器與電腦玩家照常運作，直到結束
    await cluster.advance(300_000);
    const phases = next.page.events.flatMap((m) =>
      m.t === 'emit' && m.event === 'room:state'
        ? [(m.payload as { room: { phase: string } | null }).room?.phase ?? 'closed']
        : [],
    );
    expect(phases).toContain('over'); // 對局正常打完（之後房間照常依閒置規則關閉）
  });
  it('第一順位也不見了：第二順位在 13 秒（10＋3）接手', async () => {
    const cluster = new Cluster();
    const host = await cluster.createdHost();
    const code = host.code();
    const g1 = await standbyGuest(cluster, code, '客人1');
    const g2 = await standbyGuest(cluster, code, '客人2');
    await host.page.request(EVENTS.roomReady, { ready: true });
    await host.page.request(EVENTS.roomStart, {});
    await cluster.advance(2_000);
    await killHost(cluster, host);
    await killHost(cluster, { ...host, scheduler: g1.node.scheduler, socket: g1.node.socket });
    await cluster.advance(12_000);
    expect(g2.taken).toBeNull();
    await cluster.advance(2_000);
    expect(g2.taken?.epoch).toBe(1);
    expect(g1.taken).toBeNull();
  });

  it('房主在寬限內回來：沒有人接手，原房主繼續', async () => {
    const cluster = new Cluster();
    const host = await cluster.createdHost();
    const g1 = await standbyGuest(cluster, host.code(), '客人1');
    await standbyGuest(cluster, host.code(), '客人2');
    host.socket.kill();
    await cluster.advance(6_000);
    host.socket.connect?.();
    await cluster.advance(30_000);
    expect(g1.taken).toBeNull();
    expect(g1.standby.state).toBe('watching');
    expect(cluster.relay.registry.roomCount).toBe(1);
  });

  it('網路分隔而不是死亡：新房主接手後，舊房主回來只會被告知已被取代', async () => {
    const cluster = new Cluster();
    const host = await cluster.createdHost();
    const g1 = await standbyGuest(cluster, host.code(), '客人1');
    await standbyGuest(cluster, host.code(), '客人2');
    const statuses: string[] = [];
    host.relayed.bridge.onStatus((s) =>
      statuses.push(s.state === 'closed' ? `closed:${s.reason}` : s.state),
    );
    host.socket.kill();
    await cluster.advance(11_000);
    expect(g1.taken?.epoch).toBe(1);
    host.socket.connect?.();
    await cluster.advance(2_000);
    expect(statuses).toContain('closed:superseded');
    // 房間仍屬於新房主：舊房主不能再用舊金鑰登記
    expect(cluster.relay.registry.roomCount).toBe(1);
  });
});

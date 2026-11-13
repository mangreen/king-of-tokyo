import { describe, expect, it } from 'vitest';
import { EVENTS, RELAY_PROTOCOL_VERSION } from '@kot/protocol';
import { hashToken, ReplicaMirror, type ReplicaSync } from '@kot/room';
import { Cluster, type GuestNode } from './testkit.js';

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

import { describe, expect, it } from 'vitest';
import { EVENTS } from '@kot/protocol';
import { mixSeed, type AuditReport, type RoomReplica } from '@kot/room';
import type { GameState } from '@kot/rules';
import { Cluster, type HostNode, type Page } from './testkit.js';

function phases(page: Page): string[] {
  return page.events.flatMap((m) =>
    m.t === 'emit' && m.event === 'room:state'
      ? [(m.payload as { room: { phase: string } | null }).room?.phase ?? 'closed']
      : [],
  );
}

function replicaOf(host: HostNode): RoomReplica {
  const replica = host.relayed.local.host.exportRoom(host.code());
  if (!replica) throw new Error('沒有房間');
  // 房主的複本（含儀式紀錄）：和送給後備的是同一份
  const bridge = host.relayed.bridge as unknown as { currentReplica(): RoomReplica | null };
  return bridge.currentReplica() ?? replica;
}

const statusOf = (report: AuditReport, id: string): string | undefined =>
  report.checks.find((c) => c.id === id)?.status;

async function startedGame() {
  const cluster = new Cluster();
  const host = await cluster.createdHost();
  const a = await cluster.roleNode(host.code(), '甲');
  const b = await cluster.roleNode(host.code(), '乙');
  await host.page.request(EVENTS.roomReady, { ready: true });
  return { cluster, host, a, b };
}

describe('種子共同產生與局後稽核（M10）', () => {
  it('誠實的房主：複本帶儀式紀錄、種子就是混出來的；打完後每位客人的稽核全部通過', async () => {
    const { cluster, host, a, b } = await startedGame();
    expect(await host.page.request(EVENTS.roomStart, {})).toEqual({ ok: true });
    const replica = replicaOf(host);
    const ceremony = replica.ceremony;
    expect(ceremony?.attempt).toBe(1);
    expect(Object.keys(ceremony?.contributions ?? {}).sort()).toEqual(
      [a.page.playerId, b.page.playerId].sort(),
    );
    expect(ceremony?.missing).toEqual([]);
    expect(replica.seed).toBe(mixSeed(host.code(), ceremony as never));

    await cluster.advance(300_000);
    expect(phases(host.page)).toContain('over');
    for (const node of [a, b]) {
      expect(node.reports).toHaveLength(1);
      const report = node.reports[0] as AuditReport;
      expect(report.ok).toBe(true);
      for (const id of ['cards', 'commit', 'included', 'seed', 'replay', 'observed']) {
        expect(statusOf(report, id), id).toBe('pass');
      }
      expect(report.compared).toBeGreaterThan(5);
      expect(report.attempt).toBe(1);
    }
  });

  it('頁面看不到儀式訊息，也看不到種子、房主秘密或別人的貢獻', async () => {
    const { cluster, host, a, b } = await startedGame();
    await host.page.request(EVENTS.roomStart, {});
    await cluster.advance(5_000);
    const ceremony = replicaOf(host).ceremony;
    const secrets = [
      String(replicaOf(host).seed),
      ceremony?.hostSecret as string,
      ...Object.values(ceremony?.contributions ?? {}),
    ];
    for (const page of [a.page, b.page, host.page]) {
      const text = JSON.stringify(page.events);
      expect(text).not.toContain('seed-begin');
      expect(text).not.toContain('seed-part');
      for (const secret of secrets) expect(text).not.toContain(secret);
    }
  });

  it('沒有回應的客人：等到逾時才開局，並列在 missing；其餘照常稽核', async () => {
    const cluster = new Cluster();
    const host = await cluster.createdHost();
    const a = await cluster.roleNode(host.code(), '甲');
    const silent = await cluster.guest(host.code(), '舊版', { onSeedBegin: () => null });
    await host.page.request(EVENTS.roomReady, { ready: true });
    const result = host.page.request(EVENTS.roomStart, {}).catch(() => null);
    await result;
    expect(phases(host.page)).not.toContain('playing'); // 還在等舊版客人
    await cluster.advance(5_500);
    expect(phases(host.page)).toContain('playing');
    const ceremony = replicaOf(host).ceremony;
    expect(ceremony?.missing).toEqual([silent.page.playerId]);
    expect(Object.keys(ceremony?.contributions ?? {})).toEqual([a.page.playerId]);
    await cluster.advance(300_000);
    expect(a.reports[0]?.ok).toBe(true);
    expect(a.reports[0]?.missing).toEqual([silent.page.playerId]);
  });

  it('房間裡只有房主一位真人（加電腦）：不進行儀式，立刻開局，沒有稽核對象', async () => {
    const cluster = new Cluster();
    const host = await cluster.createdHost();
    await host.page.request(EVENTS.roomAddBot, {});
    await host.page.request(EVENTS.roomReady, { ready: true });
    expect(await host.page.request(EVENTS.roomStart, {})).toEqual({ ok: true });
    expect(replicaOf(host).ceremony).toBeUndefined();
    expect(phases(host.page)).toContain('playing');
  });

  it('房主關掉儀式（或舊版房主）：稽核略過種子三項，其餘照查；畫面仍然對得上', async () => {
    const cluster = new Cluster();
    const host = await cluster.createdHost('房主', { relayed: { ceremony: { enabled: false } } });
    const a = await cluster.roleNode(host.code(), '甲');
    await host.page.request(EVENTS.roomReady, { ready: true });
    await host.page.request(EVENTS.roomStart, {});
    await cluster.advance(300_000);
    const report = a.reports[0] as AuditReport;
    expect(report.ok).toBe(true);
    expect(statusOf(report, 'seed')).toBe('skip');
    expect(statusOf(report, 'observed')).toBe('pass');
    expect(report.attempt).toBeNull();
  });

  it('房主在對局中偷改狀態（加血）：客人的稽核抓到畫面與規則重放不同', async () => {
    const { cluster, host, a, b } = await startedGame();
    await host.page.request(EVENTS.roomStart, {});
    await cluster.advance(1_500);
    const room = host.relayed.local.host.rooms.room(host.code()) as unknown as {
      state: GameState;
    };
    room.state.monsters[0]!.hp += 5; // 房主偷改記憶體中的狀態；之後每個畫面都帶著這個差異
    await cluster.advance(300_000);
    expect(phases(host.page)).toContain('over');
    for (const node of [a, b]) {
      const report = node.reports[0] as AuditReport;
      expect(report.ok, JSON.stringify(report.checks)).toBe(false);
      // 種子的來源是誠實的；問題出在畫面與規則對不上（重放時動作不合規則，或畫面摘要不同）
      expect(statusOf(report, 'seed')).toBe('pass');
      expect(['replay', 'observed'].some((id) => statusOf(report, id) === 'fail')).toBe(true);
    }
  });

  it('房主只對其中一位客人謊報畫面（日誌與種子都誠實）：被騙的那位稽核失敗，另一位通過', async () => {
    const { cluster, host, a, b } = await startedGame();
    await host.page.request(EVENTS.roomStart, {});
    const room = host.relayed.local.host.rooms.room(host.code()) as unknown as {
      buildUpdate: (viewer: { id: string }, events: unknown[]) => { state: GameState };
    };
    const honest = room.buildUpdate.bind(room);
    room.buildUpdate = (viewer, events) => {
      const update = honest(viewer, events);
      if (viewer.id === a.page.playerId && update.state.version > 10) {
        update.state.monsters[0]!.energy += 1; // 只改畫面，不改實際遊戲
      }
      return update;
    };
    await cluster.advance(300_000);
    expect(phases(host.page)).toContain('over');
    const liar = a.reports[0] as AuditReport;
    expect(liar.ok).toBe(false);
    expect(statusOf(liar, 'replay')).toBe('pass');
    expect(statusOf(liar, 'observed')).toBe('fail');
    expect(b.reports[0]?.ok).toBe(true);
  });

  it('房主接手後仍可稽核：新房主帶著儀式紀錄；沒當房主的客人稽核通過（版本倒退被正確處理）', async () => {
    const { cluster, host, a, b } = await startedGame();
    await host.page.request(EVENTS.roomStart, {});
    await cluster.advance(3_000);
    host.socket.kill();
    cluster.kill(host.scheduler);
    await cluster.settle();
    await cluster.advance(11_000);
    expect(a.endpoint.role).toBe('host');
    await a.rehello();
    await b.rehello();
    // 新房主的複本還帶著原本的儀式紀錄
    const next = a.hosts[0] as HostNode;
    expect(replicaOf(next).ceremony?.attempt).toBe(1);
    await cluster.advance(300_000);
    expect(phases(a.page)).toContain('over');
    // 沒接手的客人稽核通過：承諾與自己的貢獻在換房主後依然對得上
    const report = b.reports.at(-1) as AuditReport;
    expect(report.ok).toBe(true);
    expect(statusOf(report, 'included')).toBe('pass');
    expect(statusOf(report, 'observed')).toBe('pass');
    // 當了房主的人不稽核自己
    expect(a.reports).toHaveLength(0);
  });
});

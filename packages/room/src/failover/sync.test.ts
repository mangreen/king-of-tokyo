import { describe, expect, it } from 'vitest';
import { REPLICA_BATCH, ReplicaMirror, ReplicaSender, ReplicaSyncSchema } from './sync.js';
import type { RoomReplica } from '../replica.js';

function replica(actionCount: number, patch: Partial<RoomReplica> = {}): RoomReplica {
  return {
    version: 1,
    epoch: 0,
    code: 'ABCDE',
    cardSetId: 'original',
    cardSetHash: 'h',
    phase: 'playing',
    hostId: 'p1',
    botSerial: 0,
    members: [],
    seed: 42,
    config: null,
    actions: Array.from({ length: actionCount }, (_, i) => ({ type: 'noop', n: i }) as never),
    ...patch,
  };
}
const KEY = 'a'.repeat(32);

describe('複本同步', () => {
  it('第一次送完整；沒變化不再送；新動作只送新的部分', () => {
    const sender = new ReplicaSender();
    const first = sender.messages(replica(3), KEY, ['p2']);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ from: 0, key: KEY, order: ['p2'] });
    expect(first[0]?.actions).toHaveLength(3);
    expect(sender.messages(replica(3), KEY, ['p2'])).toEqual([]);
    const next = sender.messages(replica(5), KEY, ['p2']);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ from: 3 });
    expect(next[0]?.actions).toHaveLength(2);
  });

  it('只有 meta／順序／金鑰改變也會送（動作為空）', () => {
    const sender = new ReplicaSender();
    sender.messages(replica(2), KEY, ['p2']);
    const changed = sender.messages(replica(2, { hostId: 'p3' }), KEY, ['p2']);
    expect(changed).toHaveLength(1);
    expect(changed[0]?.actions).toEqual([]);
    expect(sender.messages(replica(2, { hostId: 'p3' }), KEY, ['p2', 'p4'])).toHaveLength(1);
    expect(
      sender.messages(replica(2, { hostId: 'p3' }), 'b'.repeat(32), ['p2', 'p4']),
    ).toHaveLength(1);
  });

  it('追上時分批，每批不超過上限', () => {
    const sender = new ReplicaSender();
    const messages = sender.messages(replica(REPLICA_BATCH * 2 + 5), KEY, []);
    expect(messages.map((m) => m.actions.length)).toEqual([REPLICA_BATCH, REPLICA_BATCH, 5]);
    expect(messages.map((m) => m.from)).toEqual([0, REPLICA_BATCH, REPLICA_BATCH * 2]);
    for (const m of messages) expect(ReplicaSyncSchema.safeParse(m).success).toBe(true);
  });

  it('reset 後從頭重送', () => {
    const sender = new ReplicaSender();
    sender.messages(replica(4), KEY, []);
    sender.reset();
    expect(sender.messages(replica(4), KEY, [])[0]?.from).toBe(0);
  });

  it('後備重建出與房主相同的複本（含分批、重疊、倒退）', () => {
    const sender = new ReplicaSender();
    const mirror = new ReplicaMirror();
    expect(mirror.snapshot()).toBeNull();
    for (const m of sender.messages(replica(250), KEY, ['p2'])) expect(mirror.apply(m)).toBe('ok');
    expect(mirror.snapshot()).toEqual(replica(250));
    expect(mirror.key).toBe(KEY);
    expect(mirror.order).toEqual(['p2']);
    for (const m of sender.messages(replica(260), KEY, ['p2'])) mirror.apply(m);
    expect(mirror.snapshot()).toEqual(replica(260));
    // 房主從存檔還原、少了尾端 12 筆：以房主為準
    for (const m of sender.messages(replica(248), KEY, ['p2'])) mirror.apply(m);
    expect(mirror.actionCount).toBe(248);
    expect(mirror.snapshot()).toEqual(replica(248));
  });

  it('漏了中間的訊息：回報 gap，從頭重送後恢復', () => {
    const sender = new ReplicaSender();
    const mirror = new ReplicaMirror();
    const [first] = sender.messages(replica(3), KEY, []);
    mirror.apply(first as never);
    sender.messages(replica(6), KEY, []); // 這則在路上掉了
    const later = sender.messages(replica(9), KEY, []);
    expect(mirror.apply(later[0] as never)).toBe('gap');
    sender.reset();
    const full = sender.messages(replica(9), KEY, []);
    for (const m of full) expect(mirror.apply(m)).toBe('ok');
    expect(mirror.snapshot()).toEqual(replica(9));
  });

  it('世代：舊世代的訊息被忽略；新世代丟掉舊日誌', () => {
    const mirror = new ReplicaMirror();
    const old = new ReplicaSender();
    const fresh = new ReplicaSender();
    for (const m of old.messages(replica(5, { epoch: 1 }), KEY, [])) mirror.apply(m);
    expect(mirror.epoch).toBe(1);
    expect(mirror.apply(old.messages(replica(6, { epoch: 0 }), KEY, [])[0] as never)).toBe('stale');
    for (const m of fresh.messages(replica(3, { epoch: 2 }), KEY, []))
      expect(mirror.apply(m)).toBe('ok');
    expect(mirror.snapshot()).toEqual(replica(3, { epoch: 2 }));
  });

  it('訊息格式驗證：不認識的欄位、過多動作、金鑰格式錯誤都被拒絕', () => {
    const ok = new ReplicaSender().messages(replica(1), KEY, [])[0];
    expect(ReplicaSyncSchema.safeParse(ok).success).toBe(true);
    expect(ReplicaSyncSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(ReplicaSyncSchema.safeParse({ ...ok, key: 'zz' }).success).toBe(false);
    expect(
      ReplicaSyncSchema.safeParse({
        ...ok,
        actions: Array.from({ length: REPLICA_BATCH + 1 }, () => 1),
      }).success,
    ).toBe(false);
  });
});

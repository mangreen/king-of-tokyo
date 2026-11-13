import { describe, expect, it } from 'vitest';
import { FakeScheduler } from '../testing.js';
import type { RoomReplica } from '../replica.js';
import type { TakeoverResult } from '../relay/hostBridge.js';
import { Standby, type TakeoverTarget } from './standby.js';
import type { ReplicaSync } from './sync.js';

const KEY = 'b'.repeat(32);

function sync(order: string[], extra: Partial<ReplicaSync> = {}): ReplicaSync {
  const meta: Omit<RoomReplica, 'actions'> = {
    version: 1,
    epoch: 0,
    code: 'ABCDE',
    cardSetId: 'original',
    cardSetHash: 'h',
    phase: 'lobby',
    hostId: 'host',
    botSerial: 0,
    members: [],
    seed: 1,
    config: null,
  };
  return { epoch: 0, meta, from: 0, actions: [], key: KEY, order, ...extra };
}

class FakeTarget implements TakeoverTarget {
  prepared = 0;
  abandoned = false;
  attempts: number[] = [];
  constructor(
    private readonly scheduler: FakeScheduler,
    private readonly script: (n: number) => TakeoverResult,
  ) {}
  prepare(): { ok: true } {
    this.prepared += 1;
    return { ok: true };
  }
  takeover(): Promise<TakeoverResult> {
    this.attempts.push(this.scheduler.now());
    return Promise.resolve(this.script(this.attempts.length));
  }
  abandon(): void {
    this.abandoned = true;
  }
}

async function tick(scheduler: FakeScheduler, ms: number): Promise<void> {
  scheduler.advance(ms);
  await Promise.resolve();
  await Promise.resolve();
}

function setup(
  me: string,
  order: string[],
  script: (n: number) => TakeoverResult = () => ({ ok: true, epoch: 1 }),
) {
  const scheduler = new FakeScheduler();
  const targets: FakeTarget[] = [];
  const took: { target: FakeTarget; epoch: number }[] = [];
  const needs: number[] = [];
  const standby = new Standby<FakeTarget>({
    code: 'ABCDE',
    playerId: () => me,
    scheduler,
    create: () => {
      const t = new FakeTarget(scheduler, script);
      targets.push(t);
      return t;
    },
    onTakeover: (target, epoch) => took.push({ target, epoch }),
    requestReplica: () => needs.push(scheduler.now()),
  });
  standby.onReplica(sync(order));
  return { standby, scheduler, targets, took, needs };
}

describe('後備房主狀態機', () => {
  it('第一順位：房主消失 10 秒後出手並成為新房主', async () => {
    const { standby, scheduler, targets, took } = setup('a', ['a', 'b']);
    expect(standby.rank).toBe(1);
    standby.onHostState('lost');
    expect(standby.state).toBe('waiting');
    await tick(scheduler, 9_999);
    expect(targets).toHaveLength(0);
    await tick(scheduler, 1);
    expect(targets[0]?.attempts).toEqual([10_000]);
    expect(took).toHaveLength(1);
    expect(took[0]?.epoch).toBe(1);
    expect(standby.state).toBe('done');
  });

  it('第二順位晚 3 秒；房主在那之前被接手（back）就不出手', async () => {
    const { standby, scheduler, targets } = setup('b', ['a', 'b']);
    expect(standby.rank).toBe(2);
    standby.onHostState('lost');
    await tick(scheduler, 12_000);
    expect(targets).toHaveLength(0);
    standby.onHostState('back');
    await tick(scheduler, 5_000);
    expect(targets).toHaveLength(0);
    expect(standby.state).toBe('watching');
  });

  it('too_early：依 retryInMs 重試，複本只還原一次', async () => {
    const { standby, scheduler, targets, took } = setup('a', ['a'], (n) =>
      n < 3 ? { ok: false, reason: 'too_early', retryInMs: 500 } : { ok: true, epoch: 2 },
    );
    standby.onHostState('lost');
    await tick(scheduler, 10_000);
    await tick(scheduler, 500);
    await tick(scheduler, 500);
    expect(targets).toHaveLength(1);
    expect(targets[0]?.prepared).toBe(1);
    expect(targets[0]?.attempts).toEqual([10_000, 10_500, 11_000]);
    expect(took[0]?.epoch).toBe(2);
  });

  it('host_online：丟掉準備好的房間、回到觀望；房主再次消失會重新計時', async () => {
    const { standby, scheduler, targets, took } = setup('a', ['a'], (n) =>
      n === 1 ? { ok: false, reason: 'host_online' } : { ok: true, epoch: 1 },
    );
    standby.onHostState('lost');
    await tick(scheduler, 10_000);
    expect(targets[0]?.abandoned).toBe(true);
    expect(standby.state).toBe('watching');
    await tick(scheduler, 30_000);
    expect(took).toHaveLength(0);
  });

  it('出示金鑰途中看到「房主回來了」（其實是自己成功了）：不丟掉房間', async () => {
    const { standby, scheduler, took, targets } = setup('a', ['a']);
    standby.onHostState('lost');
    scheduler.advance(10_000); // 嘗試中（回覆還沒處理）
    standby.onHostState('back');
    await Promise.resolve();
    await Promise.resolve();
    expect(targets[0]?.abandoned).toBe(false);
    expect(took).toHaveLength(1);
  });

  it('bad_takeover：停手；不在順序中的人不會嘗試', async () => {
    const bad = setup('a', ['a'], () => ({ ok: false, reason: 'bad_takeover' }));
    bad.standby.onHostState('lost');
    await tick(bad.scheduler, 20_000);
    expect(bad.targets).toHaveLength(1);
    expect(bad.standby.state).toBe('idle');

    const out = setup('z', ['a', 'b']);
    expect(out.standby.rank).toBeNull();
    out.standby.onHostState('lost');
    await tick(out.scheduler, 30_000);
    expect(out.targets).toHaveLength(0);
  });

  it('順序在等待期間改變：重新計算出手時間', async () => {
    const { standby, scheduler, targets } = setup('b', ['a', 'b']);
    standby.onHostState('lost');
    await tick(scheduler, 5_000);
    standby.onReplica(sync(['b'], { from: 0 })); // a 離開，b 升為第一順位
    await tick(scheduler, 5_000); // 距消失 10 秒
    expect(targets[0]?.attempts).toEqual([10_000]);
  });

  it('複本有缺口時要求重送', () => {
    const { standby, needs } = setup('a', ['a']);
    standby.onReplica(sync(['a'], { from: 5, actions: [{} as never] }));
    expect(needs).toHaveLength(1);
  });

  it('沒有複本時不嘗試', async () => {
    const scheduler = new FakeScheduler();
    let created = 0;
    const standby = new Standby<FakeTarget>({
      code: 'ABCDE',
      playerId: () => 'a',
      scheduler,
      create: () => {
        created += 1;
        return new FakeTarget(scheduler, () => ({ ok: true, epoch: 1 }));
      },
      onTakeover: () => undefined,
      requestReplica: () => undefined,
    });
    standby.onHostState('lost');
    await tick(scheduler, 20_000);
    expect(created).toBe(0);
  });
});

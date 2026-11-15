import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  defaultConfig,
  greedyBot,
  NO_CARDS,
  redactState,
  type Action,
  type GameState,
} from '@kot/rules';
import { auditGame, ObservationRecorder, viewDigest, type AuditInput } from './audit.js';
import { canonicalJson, digestOf } from './canonical.js';
import {
  beginCeremony,
  commitOf,
  finishCeremony,
  mixSeed,
  verifyCeremony,
  type Ceremony,
} from './ceremony.js';
import type { RoomReplica } from '../replica.js';

const resolve = (id: string) => (id === 'base' ? { hash: 'H', env: NO_CARDS } : null);

/** 電腦打完一整局，順便記下每個版本的狀態。 */
function play(seed: string, players = 3) {
  const config = defaultConfig(players);
  let state = createGame(config, seed, NO_CARDS).state;
  const states: GameState[] = [state];
  const actions: Action[] = [];
  for (let i = 0; i < 5_000 && state.phase !== 'over'; i += 1) {
    const action = greedyBot(state, NO_CARDS);
    const result = applyAction(state, action, NO_CARDS);
    if (!result.ok) throw new Error(result.error);
    state = result.state;
    actions.push(action);
    states.push(state);
  }
  return { config, actions, states, final: state };
}

function replicaOf(seed: string, game: ReturnType<typeof play>, ceremony?: Ceremony): RoomReplica {
  return {
    version: 1,
    epoch: 0,
    code: 'ABCD',
    cardSetId: 'base',
    cardSetHash: 'H',
    phase: 'over',
    hostId: 'h',
    botSerial: 0,
    members: [],
    seed,
    config: game.config,
    actions: game.actions,
    ...(ceremony ? { ceremony } : {}),
  };
}

function observe(game: ReturnType<typeof play>, seat: number | null): Record<number, string> {
  const rec = new ObservationRecorder();
  for (const state of game.states) rec.record(redactState(state, seat));
  return rec.snapshot();
}

describe('canonicalJson', () => {
  it('鍵順序無關、略過 undefined', () => {
    expect(canonicalJson({ b: 1, a: [1, { d: 2, c: undefined }] })).toBe('{"a":[1,{"d":2}],"b":1}');
    expect(digestOf({ a: 1, b: 2 })).toBe(digestOf({ b: 2, a: 1 }));
    expect(digestOf({ a: 1 })).not.toBe(digestOf({ a: 2 }));
  });
});

describe('種子共同產生', () => {
  const secret = 'aa'.repeat(16);
  const r1 = '11'.repeat(16);
  const r2 = '22'.repeat(16);

  it('承諾綁定房號、次數與秘密', () => {
    const c = commitOf('ABCD', 1, secret);
    expect(c).toMatch(/^[0-9a-f]{64}$/);
    expect(commitOf('ABCE', 1, secret)).not.toBe(c);
    expect(commitOf('ABCD', 2, secret)).not.toBe(c);
  });

  it('種子與貢獻抵達順序無關，但任何一方變了種子就變', () => {
    const base = { attempt: 1, hostSecret: secret };
    const a = mixSeed('ABCD', { ...base, contributions: { p1: r1, p2: r2 } });
    expect(mixSeed('ABCD', { ...base, contributions: { p2: r2, p1: r1 } })).toBe(a);
    expect(mixSeed('ABCD', { ...base, contributions: { p1: r1, p2: '33'.repeat(16) } })).not.toBe(
      a,
    );
    expect(mixSeed('ABCD', { ...base, contributions: { p1: r1 } })).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it('finishCeremony 丟掉格式不對的貢獻並列出缺席者', () => {
    const begun = beginCeremony('ABCD', 1, () => secret);
    const { ceremony, seed } = finishCeremony('ABCD', begun, { p1: r1, p2: 'not-hex' }, [
      'p1',
      'p2',
      'p3',
    ]);
    expect(ceremony.contributions).toEqual({ p1: r1 });
    expect(ceremony.missing).toEqual(['p2', 'p3']);
    expect(seed).toBe(mixSeed('ABCD', ceremony));
  });

  it('客人驗證：正常通過；各種竄改都被抓到', () => {
    const begun = beginCeremony('ABCD', 1, () => secret);
    const { ceremony, seed } = finishCeremony('ABCD', begun, { p1: r1, p2: r2 }, ['p1', 'p2']);
    const mine = { attempt: 1, commit: begun.commit, contribution: r1 };
    expect(verifyCeremony('ABCD', ceremony, seed, 'p1', mine)).toMatchObject({
      commit: 'pass',
      included: 'pass',
      seed: 'pass',
    });
    // 房主換了種子
    expect(verifyCeremony('ABCD', ceremony, 'deadbeef', 'p1', mine).seed).toBe('fail');
    // 房主換了秘密（承諾對不上）
    expect(
      verifyCeremony('ABCD', { ...ceremony, hostSecret: 'bb'.repeat(16) }, seed, 'p1', mine).commit,
    ).toBe('fail');
    // 房主開始時給我的承諾與局後的不同
    expect(
      verifyCeremony('ABCD', ceremony, seed, 'p1', { ...mine, commit: 'f'.repeat(64) }).commit,
    ).toBe('fail');
    // 我的貢獻被換掉
    const swapped = { ...ceremony, contributions: { p1: '99'.repeat(16), p2: r2 } };
    expect(verifyCeremony('ABCD', swapped, mixSeed('ABCD', swapped), 'p1', mine).included).toBe(
      'fail',
    );
    // 我沒有參與：略過而不是失敗
    expect(verifyCeremony('ABCD', ceremony, seed, 'p1', null)).toMatchObject({
      commit: 'pass',
      included: 'skip',
      seed: 'pass',
    });
  });
});

describe('ObservationRecorder', () => {
  it('版本倒退時捨棄之後的版本', () => {
    const game = play('round-one-seed-01');
    const rec = new ObservationRecorder();
    for (const state of game.states.slice(0, 8)) rec.record(state);
    expect(rec.size).toBe(8);
    rec.record(game.states[5] as GameState);
    expect(rec.size).toBe(6);
    expect(rec.rewinds).toBe(1);
    expect(rec.snapshot()[5]).toBe(viewDigest(game.states[5] as GameState));
  });
});

describe('auditGame', () => {
  const seedHex = '0123456789abcdef0123456789abcdef';
  const game = play(seedHex);
  const secret = 'aa'.repeat(16);
  const r1 = '11'.repeat(16);
  const begun = beginCeremony('ABCD', 1, () => secret);
  const { ceremony } = finishCeremony('ABCD', begun, { p1: r1 }, ['p1']);
  const ceremonySeed = mixSeed('ABCD', ceremony);
  const honest = play(ceremonySeed);
  const mine = { attempt: 1, commit: begun.commit, contribution: r1 };

  const input = (overrides: Partial<AuditInput> = {}): AuditInput => ({
    replica: replicaOf(ceremonySeed, honest, ceremony),
    observed: observe(honest, 1),
    seat: 1,
    playerId: 'p1',
    mine,
    ...overrides,
  });

  it('誠實的房主：全部通過，比對了每一個版本', () => {
    const report = auditGame(input(), resolve);
    expect(report.checks.map((c) => `${c.id}:${c.status}`)).toEqual([
      'cards:pass',
      'commit:pass',
      'included:pass',
      'seed:pass',
      'replay:pass',
      'observed:pass',
    ]);
    expect(report.ok).toBe(true);
    expect(report.compared).toBe(honest.states.length);
    expect(report.attempt).toBe(1);
  });

  it('沒有儀式（單人房或舊版）：略過種子三項，其他照查', () => {
    const report = auditGame(
      input({ replica: replicaOf(seedHex, game), observed: observe(game, 0), seat: 0, mine: null }),
      resolve,
    );
    expect(report.ok).toBe(true);
    expect(report.checks.filter((c) => c.status === 'skip').map((c) => c.id)).toEqual([
      'commit',
      'included',
      'seed',
    ]);
  });

  it('房主給我的畫面被改過（例如血量）：observed 失敗', () => {
    const observed = observe(honest, 1);
    const tampered = structuredClone(honest.states[4] as GameState);
    tampered.monsters[0]!.hp += 3;
    observed[tampered.version] = viewDigest(redactState(tampered, 1));
    const report = auditGame(input({ observed }), resolve);
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.id === 'observed')?.status).toBe('fail');
    expect(report.checks.find((c) => c.id === 'replay')?.status).toBe('pass');
  });

  it('房主給的動作日誌被改：重放失敗或畫面對不上', () => {
    const replica = replicaOf(ceremonySeed, honest, ceremony);
    replica.actions = replica.actions.slice(0, -3);
    const report = auditGame(input({ replica }), resolve);
    expect(report.ok).toBe(false);
  });

  it('房主揭露的種子不是儀式算出來的：seed 失敗，連畫面也對不上', () => {
    const other = play('ffffffffffffffffffffffffffffffff');
    const report = auditGame(
      input({ replica: replicaOf('ffffffffffffffffffffffffffffffff', other, ceremony) }),
      resolve,
    );
    expect(report.checks.find((c) => c.id === 'seed')?.status).toBe('fail');
    expect(report.ok).toBe(false);
  });

  it('我的貢獻沒被算進去：included 失敗', () => {
    const report = auditGame(input({ mine: { ...mine, contribution: '77'.repeat(16) } }), resolve);
    expect(report.checks.find((c) => c.id === 'included')?.status).toBe('fail');
  });

  it('卡牌組不符或不存在：cards 失敗並停止', () => {
    const replica = replicaOf(ceremonySeed, honest, ceremony);
    expect(auditGame(input({ replica: { ...replica, cardSetHash: 'X' } }), resolve).ok).toBe(false);
    expect(
      auditGame(input({ replica: { ...replica, cardSetId: 'nope' } }), resolve).checks,
    ).toEqual([{ id: 'cards', status: 'fail', detail: '沒有卡牌組 nope' }]);
  });

  it('我看過房主紀錄裡沒有的版本（房主把日誌截短）：observed 失敗', () => {
    const replica = replicaOf(ceremonySeed, honest, ceremony);
    replica.actions = replica.actions.slice(0, 5);
    const report = auditGame(input({ replica }), resolve);
    expect(report.checks.find((c) => c.id === 'observed')?.status).toBe('fail');
    expect(report.checks.find((c) => c.id === 'replay')?.status).toBe('fail');
  });

  it('旁觀者視角（seat = null）也能稽核', () => {
    const report = auditGame(input({ seat: null, observed: observe(honest, null) }), resolve);
    expect(report.ok).toBe(true);
  });
});

/**
 * 局後稽核（ADR-0007 §3、M10）：客人用「房主揭露的種子與動作日誌」重放整場，
 * 檢查房主在對局中給我的每一個畫面都對得上。
 *
 * 能抓到：房主給我的畫面與規則重放的結果不同（改骰子、改血量、改牌）、日誌被改、
 * 種子不是共同產生的（承諾對不上、我的貢獻沒被算進去）。
 * 抓不到（也沒有宣稱）：房主偷看別人的資訊、客人偷看房主的複本——客人本來就是後備房主，
 * 手上有種子；這個信任等級是「朋友之間」，稽核是讓作弊「留下證據」，不是防止。
 */
import {
  applyAction,
  createGame,
  redactState,
  type Action,
  type GameState,
  type RulesEnv,
} from '@kot/rules';
import type { RoomReplica } from '../replica.js';
import { type Ceremony, type MyCeremonyPart, verifyCeremony } from './ceremony.js';
import { digestOf } from './canonical.js';

export type CheckStatus = 'pass' | 'fail' | 'skip';

export type AuditCheckId = 'cards' | 'commit' | 'included' | 'seed' | 'replay' | 'observed';

export interface AuditCheck {
  id: AuditCheckId;
  status: CheckStatus;
  detail?: string;
}

export interface AuditReport {
  /** 沒有任何一項失敗（略過不算失敗）。 */
  ok: boolean;
  checks: AuditCheck[];
  /** 比對了幾個我看過的畫面版本。 */
  compared: number;
  /** 房主最後採用的種子儀式次數；沒有儀式為 null。 */
  attempt: number | null;
  /** 沒有參與種子產生的真人玩家 id。 */
  missing: string[];
  /** 對局動作數（重放用）。 */
  actionCount: number;
}

export interface AuditInput {
  /** 房主給的複本（局後：含種子、動作日誌、儀式紀錄）。 */
  replica: RoomReplica;
  /** 我在對局中看過的畫面：版本 → 狀態摘要。 */
  observed: Record<number, string>;
  /** 我的座位（旁觀者或不明為 null）。 */
  seat: number | null;
  playerId: string | undefined;
  /** 我在這局開始時參與的種子產生；沒有為 null。 */
  mine: MyCeremonyPart | null;
}

/** 依卡牌組 id 取得規則環境與內容雜湊；沒有這個卡牌組時回傳 null。 */
export type CardResolver = (id: string) => { hash: string; env: RulesEnv } | null;

/** 一個版本的畫面摘要，錄製與稽核必須用同一個函式。 */
export function viewDigest(state: GameState): string {
  return digestOf(state);
}

/** 同步稽核（網頁在 Worker 裡呼叫，不卡住畫面）。 */
export function auditGame(input: AuditInput, resolve: CardResolver): AuditReport {
  const { replica } = input;
  const checks: AuditCheck[] = [];
  const ceremony: Ceremony | null = replica.ceremony ?? null;
  const report = (): AuditReport => ({
    ok: checks.every((check) => check.status !== 'fail'),
    checks,
    compared: 0,
    attempt: ceremony?.attempt ?? null,
    missing: ceremony?.missing ?? [],
    actionCount: replica.actions.length,
  });

  // 1. 卡牌組：用的是我手上同一份
  const cards = resolve(replica.cardSetId);
  if (!cards) {
    checks.push({ id: 'cards', status: 'fail', detail: `沒有卡牌組 ${replica.cardSetId}` });
    return report();
  }
  if (cards.hash !== replica.cardSetHash) {
    checks.push({ id: 'cards', status: 'fail', detail: '卡牌組內容與房主宣稱的不同' });
    return report();
  }
  checks.push({ id: 'cards', status: 'pass' });

  if (replica.seed === null || replica.config === null) {
    checks.push({ id: 'replay', status: 'fail', detail: '房主沒有提供種子或設定' });
    return report();
  }

  // 2. 種子的來源
  if (ceremony === null) {
    for (const id of ['commit', 'included', 'seed'] as const) {
      checks.push({ id, status: 'skip', detail: '房主沒有進行種子共同產生' });
    }
  } else {
    const result = verifyCeremony(replica.code, ceremony, replica.seed, input.playerId, input.mine);
    const detail = result.details.join('；');
    checks.push({ id: 'commit', status: result.commit, ...(detail ? { detail } : {}) });
    checks.push({ id: 'included', status: result.included });
    checks.push({ id: 'seed', status: result.seed });
  }

  // 3. 重放，同時算出我看過的版本在規則下應有的摘要
  const wanted = new Set(Object.keys(input.observed).map(Number));
  const expected = new Map<number, string>();
  const note = (state: GameState): void => {
    if (wanted.has(state.version)) {
      expected.set(state.version, viewDigest(redactState(state, input.seat)));
    }
  };
  let state: GameState;
  try {
    const created = createGame(replica.config, replica.seed, cards.env);
    state = created.state;
    note(state);
    for (const [index, action] of (replica.actions as Action[]).entries()) {
      const result = applyAction(state, action, cards.env);
      if (!result.ok) {
        checks.push({
          id: 'replay',
          status: 'fail',
          detail: `第 ${String(index)} 個動作不合規則（${result.error}）`,
        });
        return report();
      }
      state = result.state;
      note(state);
    }
  } catch (error) {
    checks.push({
      id: 'replay',
      status: 'fail',
      detail: error instanceof Error ? error.message : '重放失敗',
    });
    return report();
  }
  checks.push(
    state.phase === 'over'
      ? { id: 'replay', status: 'pass' }
      : { id: 'replay', status: 'fail', detail: '重放到最後，對局還沒有結束' },
  );

  // 4. 我看過的每個畫面
  const bad: number[] = [];
  for (const version of [...wanted].sort((a, b) => a - b)) {
    if (expected.get(version) !== input.observed[version]) bad.push(version);
  }
  checks.push(
    bad.length === 0
      ? { id: 'observed', status: 'pass' }
      : {
          id: 'observed',
          status: 'fail',
          detail: `第 ${bad.slice(0, 5).join('、')} 版${bad.length > 5 ? '等' : ''}畫面與規則重放的結果不同`,
        },
  );
  return { ...report(), compared: wanted.size };
}

/** 對局中的觀察紀錄：每個收到的畫面版本一個摘要。 */
export class ObservationRecorder {
  private readonly digests = new Map<number, string>();
  private last = -1;
  private rewindCount = 0;

  /** 收到房主給的畫面。版本倒退（房主換人後從複本繼續）時，捨棄之後的版本。 */
  record(state: GameState): void {
    const version = state.version;
    if (version < this.last) {
      this.rewindCount += 1;
      for (const key of [...this.digests.keys()]) if (key > version) this.digests.delete(key);
    }
    this.digests.set(version, viewDigest(state));
    this.last = version;
  }

  get rewinds(): number {
    return this.rewindCount;
  }

  get size(): number {
    return this.digests.size;
  }

  snapshot(): Record<number, string> {
    return Object.fromEntries(this.digests);
  }

  clear(): void {
    this.digests.clear();
    this.last = -1;
  }
}

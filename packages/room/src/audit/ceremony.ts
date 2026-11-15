/**
 * 種子共同產生（ADR-0007 §3、M10）：commit–reveal，讓房主不能單方面挑選骰子與牌序。
 *
 * 流程（房主按下「開始」時）：
 *   1. 房主挑一個秘密 r_h，公布承諾 c_h = H(code, attempt, r_h)；
 *   2. 每位客人各自挑 r_i，**只回給房主**（不能廣播：種子一旦人人算得出，隱藏資訊就沒有了）；
 *   3. 種子 = H(code, attempt, r_h, 依玩家 id 排序的所有 r_i)。
 * 局後房主揭露 r_h 與所有 r_i（放在房間複本裡），每位客人檢查：
 *   承諾對得上、自己的 r_i 有被算進去、種子就是這樣算出來的。
 *
 * 保證與限制：房主在看到客人的 r_i 之前就已經承諾了 r_h，所以他選不出特定的種子；
 * 他只能「重來」（attempt 遞增、而且每次都要再向所有客人要一次，客人看得到承諾換了）。
 * 這**不是**防作弊：客人是後備房主，手上本來就有種子（§3），要偷看無法阻止；
 * 沒有參與的人（舊版客人、逾時沒回的人）的貢獻不在其中，會列在 missing。
 */
import { sha256Hex } from '@kot/rules';
import { randomHex } from '../random.js';

/** 一份貢獻或秘密：16 位元組、32 個十六進位字元。 */
export const CONTRIBUTION_PATTERN = /^[0-9a-f]{32}$/;

/** 儀式的紀錄（局後揭露的內容）。 */
export interface Ceremony {
  /** 第幾次嘗試（同一位房主連續開始時遞增）。 */
  attempt: number;
  /** 房主的秘密 r_h（局後才公開；開始時只公布 commit）。 */
  hostSecret: string;
  /** 開始時公布的承諾。 */
  commit: string;
  /** 客人的貢獻：玩家 id → r_i。 */
  contributions: Record<string, string>;
  /** 應該參與卻沒有貢獻的真人玩家 id（逾時、舊版客人…）。 */
  missing: string[];
}

const DOMAIN_COMMIT = 'kot-seed-commit/v1';
const DOMAIN_SEED = 'kot-seed/v1';

/** 房主的承諾。 */
export function commitOf(code: string, attempt: number, hostSecret: string): string {
  return sha256Hex(`${DOMAIN_COMMIT}|${code}|${String(attempt)}|${hostSecret}`);
}

/** 混合所有秘密得到種子（128 位元，與 randomSeed 同樣的形狀）。貢獻依玩家 id 排序，與抵達順序無關。 */
export function mixSeed(
  code: string,
  ceremony: Pick<Ceremony, 'attempt' | 'hostSecret' | 'contributions'>,
): string {
  const ids = Object.keys(ceremony.contributions).sort();
  const parts = ids.map((id) => `${id}=${ceremony.contributions[id] as string}`);
  const text = [DOMAIN_SEED, code, String(ceremony.attempt), ceremony.hostSecret, ...parts].join(
    '|',
  );
  return sha256Hex(text).slice(0, 32);
}

/** 房主端：開始一次儀式，挑秘密並算出承諾。 */
export function beginCeremony(
  code: string,
  attempt: number,
  random: (bytes: number) => string = randomHex,
): { attempt: number; hostSecret: string; commit: string } {
  const hostSecret = random(16);
  return { attempt, hostSecret, commit: commitOf(code, attempt, hostSecret) };
}

/** 客人端：產生這次的貢獻。 */
export function newContribution(random: (bytes: number) => string = randomHex): string {
  return random(16);
}

/** 房主端：收齊（或逾時）之後完成儀式，得到紀錄與種子。 */
export function finishCeremony(
  code: string,
  begun: { attempt: number; hostSecret: string; commit: string },
  contributions: Readonly<Record<string, string>>,
  expected: readonly string[],
): { ceremony: Ceremony; seed: string } {
  const clean: Record<string, string> = {};
  for (const [id, value] of Object.entries(contributions)) {
    if (CONTRIBUTION_PATTERN.test(value)) clean[id] = value;
  }
  const ceremony: Ceremony = {
    attempt: begun.attempt,
    hostSecret: begun.hostSecret,
    commit: begun.commit,
    contributions: clean,
    missing: expected.filter((id) => !(id in clean)).sort(),
  };
  return { ceremony, seed: mixSeed(code, ceremony) };
}

/** 客人手上關於某次儀式的記憶：收到的承諾與自己送出的貢獻。 */
export interface MyCeremonyPart {
  attempt: number;
  commit: string;
  contribution: string;
}

export interface CeremonyCheck {
  /** 承諾與秘密對得上，也和我當時收到的一致（我沒參與時只查前者）。 */
  commit: 'pass' | 'fail';
  /** 我的貢獻有被算進去。 */
  included: 'pass' | 'fail' | 'skip';
  /** 種子確實是這樣混出來的。 */
  seed: 'pass' | 'fail';
  details: string[];
}

/** 客人端：驗證儀式。mine 為 null 表示我沒有參與這一次（重新整理、晚加入），那兩項略過。 */
export function verifyCeremony(
  code: string,
  ceremony: Ceremony,
  seed: string | number,
  playerId: string | undefined,
  mine: MyCeremonyPart | null,
): CeremonyCheck {
  const details: string[] = [];
  let commit: CeremonyCheck['commit'] = 'pass';
  if (commitOf(code, ceremony.attempt, ceremony.hostSecret) !== ceremony.commit) {
    commit = 'fail';
    details.push('房主揭露的秘密與他當初公布的承諾對不上');
  }
  let included: CeremonyCheck['included'] = 'skip';
  if (mine === null) {
    details.push('這局的種子產生你沒有參與（重新整理或中途加入），只能檢查房主自己的承諾');
  } else if (mine.attempt !== ceremony.attempt) {
    details.push(
      `房主最後採用第 ${String(ceremony.attempt)} 次，你只參與過第 ${String(mine.attempt)} 次`,
    );
  } else {
    if (mine.commit !== ceremony.commit) {
      commit = 'fail';
      details.push('開始時房主對你公布的承諾與局後揭露的不一致');
    }
    if (playerId !== undefined && ceremony.contributions[playerId] === mine.contribution) {
      included = 'pass';
    } else {
      included = 'fail';
      details.push('你送出的亂數沒有被算進種子');
    }
  }
  const seedOk = String(seed) === mixSeed(code, ceremony);
  if (!seedOk) details.push('種子不是由承諾與貢獻算出來的');
  return { commit, included, seed: seedOk ? 'pass' : 'fail', details };
}

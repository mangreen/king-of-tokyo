/**
 * 房間複本（ADR-0007 M8、M9）：把一個房間序列化成純 JSON，之後可以完整還原。
 *
 * - 引擎層：種子＋動作日誌，重放即可得到完整狀態（含牌庫順序與亂數位置）；引擎本來就是確定性的。
 * - 房間層：成員、座位、怪獸、準備／離開／代打狀態、房主、電腦序號，引擎狀態裡沒有的部分。
 * - 計時器不存：還原後重新給一整段時間（ADR-0007 §4.6）。
 *
 * M8 用它做「房主重新整理後接回」（存在房主自己的 IndexedDB）；M9 用同一份格式複寫給後備房主。
 *
 * 注意：複本含種子，等於含牌庫與骰子的全部資訊，所以只能留在房主自己的瀏覽器，
 * 或給「後備房主」，不能給一般客人（見 ADR-0007 §3、§4.8）。
 */
import type { Action, RulesConfig, Seed } from '@kot/rules';
import type { Ceremony } from './audit/ceremony.js';

export interface ReplicaMember {
  id: string;
  nickname: string;
  bot: boolean;
  ready: boolean;
  away: boolean;
  left: boolean;
  seat: number | null;
  monster: number | null;
  /** 重連 token 的雜湊（不是 token 本身）；電腦玩家為 null。 */
  tokenHash: string | null;
}

export interface RoomReplica {
  /** 複本格式版本；格式改變時遞增，不認識的版本要拒絕。 */
  version: 1;
  /** 房主任期；每次換房主遞增，客人只跟隨最高的（M9 防分裂腦）。M8 恆為 0。 */
  epoch: number;
  code: string;
  cardSetId: string;
  /** 卡牌組內容雜湊；還原時用它確認手上的卡牌組與原本一致。 */
  cardSetHash: string;
  phase: 'lobby' | 'playing' | 'over';
  hostId: string;
  /** 電腦玩家的流水號（新增電腦時用來取不重複的 id）。 */
  botSerial: number;
  members: ReplicaMember[];
  /** 開局種子；機密。大廳階段為 null。 */
  seed: Seed | null;
  config: RulesConfig | null;
  /** 開局後套用的全部動作（含代管與電腦的動作），依序重放。 */
  actions: Action[];
  /**
   * 這局種子的共同產生紀錄（M10）；沒有進行（只有房主一個真人、舊版複本）為 undefined。
   * 局後客人用它稽核；含各人的亂數貢獻，和種子一樣只給後備房主。
   */
  ceremony?: Ceremony | undefined;
}

/** 還原失敗的原因。 */
export class ReplicaError extends Error {}

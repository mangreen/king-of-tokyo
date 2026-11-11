/**
 * 房間複本的介面草案（M9 房主轉移使用；M5 只定型別，尚未實作也尚未被呼叫）。
 *
 * 後備房主持續收到複本，故障時用它重建房間：
 * - 引擎層：種子＋動作日誌，重播即可得到完整狀態（含牌庫順序與亂數位置）；引擎本來就是確定性的。
 * - 房間層：成員、座位、怪獸、token 雜湊、準備／離開狀態、計時器剩餘等，引擎狀態裡沒有的部分。
 *
 * 注意：複本含種子，等於含牌庫與骰子的全部資訊，所以只能給「後備房主」，不能給一般客人（見 ADR-0007 §3、§4.8）。
 */
import type { Action, Seed } from '@kot/rules';

export interface ReplicaMember {
  id: string;
  nickname: string;
  bot: boolean;
  ready: boolean;
  away: boolean;
  left: boolean;
  monsterId: number | null;
  /** 重連 token 的雜湊（不是 token 本身）。 */
  tokenHash: string | null;
}

export interface RoomReplica {
  /** 複本格式版本；格式改變時遞增，接手方不認識的版本要拒絕。 */
  version: 1;
  /** 房主任期；每次換房主遞增，客人只跟隨最高的（防分裂腦）。 */
  epoch: number;
  code: string;
  cardSetId: string;
  /** 卡牌組內容雜湊；後備房主用它確認自己手上的卡牌組與房主一致。 */
  cardSetHash: string;
  phase: 'lobby' | 'playing' | 'over';
  hostId: string;
  /** 後備順序（玩家 id，第一位最先接手）。 */
  standbyOrder: string[];
  members: ReplicaMember[];
  /** 開局種子；機密。 */
  seed: Seed | null;
  /** 開局後套用的全部動作（含代管與電腦的動作），依序重播。 */
  actions: { playerId: string; action: Action }[];
}

/** 需要的實作：序列化目前房間成複本，或由複本重建房間。M9 才會加到 Room 上。 */
export interface Replicable {
  toReplica(epoch: number): RoomReplica;
}

import type { RuleConfig } from './rulesText.js';

/**
 * 新手教學（純資料與判斷，方便測試）。
 * - 快速規則：第一次進遊戲時跳出的幾張投影片（可跳過、可在設定裡重看）。
 * - 情境提示：第一次遇到某個時機（輪到你擲骰、被攻擊要不要讓位…）時跳出一張小卡，按「知道了」才算看過。
 * 偏好（是否開啟、看過哪些）存在瀏覽器，下次進遊戲記得。
 */

export type HintId = 'roll' | 'yield' | 'hearts' | 'buy';

export interface TutorialState {
  /** 是否顯示新手教學（設定裡可關）。 */
  enabled: boolean;
  /** 快速規則已經看過或跳過。 */
  introSeen: boolean;
  /** 已按過「知道了」的情境提示。 */
  seen: HintId[];
}

export const TUTORIAL_KEY = 'kot.tutorial.v1';

export const HINT_IDS: readonly HintId[] = ['roll', 'yield', 'hearts', 'buy'];

export const defaultTutorial = (): TutorialState => ({ enabled: true, introSeen: false, seen: [] });

/** 解析儲存的內容；任何壞資料都退回預設（不信任 localStorage）。 */
export function parseTutorial(raw: string | null): TutorialState {
  const base = defaultTutorial();
  if (raw === null) return base;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return base;
    const o = v as Record<string, unknown>;
    const seen = Array.isArray(o['seen'])
      ? HINT_IDS.filter((id) => (o['seen'] as unknown[]).includes(id))
      : [];
    return {
      enabled: typeof o['enabled'] === 'boolean' ? o['enabled'] : base.enabled,
      introSeen: typeof o['introSeen'] === 'boolean' ? o['introSeen'] : base.introSeen,
      seen,
    };
  } catch {
    return base;
  }
}

export const serializeTutorial = (s: TutorialState): string => JSON.stringify(s);

export interface Slide {
  icon: string;
  title: string;
  lines: string[];
}

/** 快速規則投影片；數值取自本局設定，不寫死。 */
export function introSlides(c: RuleConfig): Slide[] {
  const n = String(c.maxRolls);
  return [
    {
      icon: '🎯',
      title: '目標',
      lines: [
        '你是一隻大怪獸，在東京亂鬥：打倒對手、搶分數。',
        `回合結束時 ${String(c.victoryPoints)} VP 以上（還活著）就贏；或是成為最後一隻存活的怪獸。`,
        `每隻怪獸有 ${String(c.startingHp)} 點 HP，歸零就淘汰。`,
      ],
    },
    {
      icon: '🎲',
      title: '擲骰',
      lines: [
        `輪到你時擲 ${String(c.diceCount)} 顆骰子，最多擲 ${n} 次。`,
        '重擲前點骰子選擇要「保留」的，其餘重擲；滿意了就按「結算」。',
      ],
    },
    {
      icon: '⭐',
      title: '骰面結算',
      lines: [
        '1／2／3：同點數湊滿 3 顆得該點數的 VP（多一顆再 +1）。',
        '⚡ 能量：每個得 1 能量，拿去買牌。',
        '❤️ 治療：每個回 1 HP（在東京裡無效）。',
        '💥 攻擊：對「東京的另一邊」的所有怪獸各造成傷害。',
      ],
    },
    {
      icon: '🗼',
      title: '東京',
      lines: [
        '東京沒人時，你必須進去，並得 1 VP；回合開始時若在東京裡，再得 2 VP。',
        '在東京裡打東京外的人，在東京外打東京裡的人；東京裡不能補血。',
        '被攻擊的東京怪獸可以「讓位」離開（仍受傷），攻擊者會接手東京。',
      ],
    },
    {
      icon: '🃏',
      title: '買牌',
      lines: [
        '結算後進入買牌階段：用能量買商店面朝上的牌。',
        '買不起、不想要時，可以花 2 能量清掉商店重新翻牌。',
        '持續（Keep）卡留在面前一直有效，一次性（Discard）卡立即發動就丟棄。',
      ],
    },
    {
      icon: '💡',
      title: '看懂畫面',
      lines: [
        '提示的圖示說明結果從哪來：🎲 是骰子造成的、🃏 是卡牌造成的。',
        '怪獸名牌下方的 ☠ 是中毒、🤏 是縮小。',
        '右側的「規則」「我的卡牌」分頁隨時能查；這份教學可以在「⚙ 設定」關閉或重看。',
      ],
    },
  ];
}

export interface Hint {
  icon: string;
  title: string;
  text: string;
}

export function hintFor(id: HintId, c: RuleConfig): Hint {
  switch (id) {
    case 'roll':
      return {
        icon: '🎲',
        title: '輪到你擲骰',
        text: `按「擲骰」；想留下的骰子點一下保留，其餘再擲（最多 ${String(c.maxRolls)} 次）。滿意了按「結算」。`,
      };
    case 'yield':
      return {
        icon: '🚪',
        title: '東京被攻擊了',
        text: '你可以「讓位」離開東京（仍受傷，攻擊者進入東京），或「留在東京」每回合開始得 2 VP——但要承受更多攻擊。',
      };
    case 'hearts':
      return {
        icon: '❤️',
        title: '分配治療',
        text: '你擲出了 ❤️：可以回復自己的 HP、清除中毒／縮小指示物（在東京外才行），分配完按確定。',
      };
    case 'buy':
      return {
        icon: '🛒',
        title: '買牌階段',
        text: '用能量買商店的牌（點牌上的購買）；都不想買可以花 2 能量清商店。完成後按「離開商店」再「結束回合」。',
      };
  }
}

export interface HintContext {
  phase: string;
  myTurn: boolean;
  /** 我現在要做決定的動作種類（擲骰／結算不在內，那兩個看 phase）。 */
  actionTypes: ReadonlySet<string>;
}

/**
 * 現在該顯示哪個情境提示（沒有就 null）。同時符合時優先處理要做決定的：
 * 讓位 > 分配治療 > 買牌 > 擲骰。看過的、教學關閉、快速規則還開著時都不顯示。
 */
export function nextHint(
  tutorial: TutorialState,
  introOpen: boolean,
  ctx: HintContext,
): HintId | null {
  if (!tutorial.enabled || introOpen) return null;
  const candidates: [HintId, boolean][] = [
    ['yield', ctx.actionTypes.has('yieldDecision')],
    ['hearts', ctx.actionTypes.has('heartsDecision')],
    ['buy', ctx.myTurn && ctx.phase === 'buy'],
    ['roll', ctx.myTurn && ctx.phase === 'roll'],
  ];
  for (const [id, on] of candidates) {
    if (on && !tutorial.seen.includes(id)) return id;
  }
  return null;
}

import type { GameEvent } from '@kot/rules';

/** 畫面上跳出的提示（toast）。純資料，方便測試。 */
export type NoticeKind = 'info' | 'good' | 'warn' | 'danger';

export interface Notice {
  /** 同一批事件內唯一；加上版本號就是全域 key。 */
  id: string;
  kind: NoticeKind;
  icon: string;
  text: string;
  /** 附帶的快捷動作（例如「看商店」）。 */
  action?: 'shop';
}

export interface NoticeContext {
  mySeat: number | null;
  nameOf: (seat: number) => string;
  cardName: (id: string) => string;
  victoryPoints: number;
  /** 事件之後（目前）的 VP；用來判斷「快贏了」。 */
  vpNow: (seat: number) => number;
}

/** 距離勝利幾點 VP 時提醒。 */
export const NEAR_WIN_GAP = 5;
/** 一次攻擊達到這麼多點傷害才算「重擊」。 */
export const BIG_HIT = 4;
/** 自己的 HP 低於等於這個值時警告。 */
export const LOW_HP = 3;

const LOC = { city: '東京市', bay: '東京灣' } as const;

/**
 * 從一批事件挑出「重大事件」，其餘（擲骰、回復…）只留在事件日誌裡，不打擾玩家。
 * 重大事件：輪到自己、淘汰、復活、重擊、自己血量見底、進入東京、接近／達成勝利分數、
 * 買牌、中毒或縮小、額外回合、東京灣關閉。
 */
export function noticesFor(events: readonly GameEvent[], c: NoticeContext): Notice[] {
  const out: Notice[] = [];
  const mine = (seat: number): boolean => seat === c.mySeat;
  const who = (seat: number): string => (mine(seat) ? '你' : c.nameOf(seat));
  const push = (n: Omit<Notice, 'id'>): void => {
    out.push({ ...n, id: String(out.length) });
  };

  for (const e of events) {
    switch (e.type) {
      case 'turn_started':
        if (mine(e.seat)) push({ kind: 'good', icon: '🎲', text: '輪到你了！' });
        break;
      case 'eliminated':
        push(
          mine(e.seat)
            ? { kind: 'danger', icon: '💀', text: '你被淘汰了' }
            : {
                kind: 'warn',
                icon: '💀',
                text: `${c.nameOf(e.seat)} 被淘汰${e.by !== null ? `（${who(e.by)}幹的）` : ''}`,
              },
        );
        break;
      case 'revived':
        push({ kind: 'good', icon: '✨', text: `${who(e.seat)}復活了！HP ${String(e.hp)}` });
        break;
      case 'smash':
        if (e.damage >= BIG_HIT) {
          const hitsMe = c.mySeat !== null && e.targets.includes(c.mySeat);
          push({
            kind: hitsMe ? 'danger' : 'warn',
            icon: '💥',
            text: `${who(e.attacker)}發動 ${String(e.damage)} 點重擊${hitsMe ? '，你是目標！' : '！'}`,
          });
        }
        break;
      case 'damage_taken':
        if (mine(e.seat) && e.hp > 0 && e.hp <= LOW_HP) {
          push({ kind: 'danger', icon: '❤️‍🔥', text: `你的 HP 只剩 ${String(e.hp)}！` });
        }
        break;
      case 'entered_tokyo':
        push({
          kind: 'info',
          icon: '🗼',
          text: `${who(e.seat)}進入${LOC[e.location]}`,
        });
        break;
      case 'vp_gained': {
        const now = c.vpNow(e.seat);
        const before = now - e.amount;
        const goal = c.victoryPoints;
        if (before < goal && now >= goal) {
          push({
            kind: mine(e.seat) ? 'good' : 'danger',
            icon: '🏁',
            text: mine(e.seat)
              ? `你達到 ${String(goal)} VP！撐過回合結束就獲勝`
              : `${c.nameOf(e.seat)} 達到 ${String(goal)} VP！`,
          });
        } else if (before < goal - NEAR_WIN_GAP && now >= goal - NEAR_WIN_GAP) {
          push({
            kind: mine(e.seat) ? 'good' : 'warn',
            icon: '⭐',
            text: `${who(e.seat)}離勝利只差 ${String(goal - now)} VP`,
          });
        }
        break;
      }
      case 'card_bought':
        push({
          kind: 'info',
          icon: '🛒',
          text: `${who(e.seat)}買下 ${c.cardName(e.cardId)}`,
        });
        break;
      case 'counter_gained':
        if (mine(e.seat)) {
          push({
            kind: 'warn',
            icon: e.counter === 'poison' ? '☠️' : '🔻',
            text: e.counter === 'poison' ? '你中毒了' : '你被縮小了',
          });
        }
        break;
      case 'extra_turn_granted':
        push({ kind: 'info', icon: '⏩', text: `${who(e.seat)}將再進行一個回合` });
        break;
      case 'bay_closed':
        push({ kind: 'info', icon: '🌊', text: '東京灣關閉了' });
        break;
      default:
        break;
    }
  }
  return out;
}

/** 買牌階段輪到自己、而且買得起東西時的提示。 */
export function shopNotice(buyable: number): Notice | null {
  if (buyable <= 0) return null;
  return {
    id: 'shop',
    kind: 'good',
    icon: '🛒',
    text: `商店有 ${String(buyable)} 張牌買得起`,
    action: 'shop',
  };
}

export const DURATION_MS: Record<NoticeKind | 'shop', number> = {
  info: 3800,
  good: 4500,
  warn: 5500,
  danger: 7000,
  shop: 9000,
};

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
  /** 卡牌圖示（依特效主題）；沒提供就用通用圖示。 */
  cardIcon?: (id: string) => string;
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
/** 一次使用卡牌對「我」造成的變化（只算這張牌效果範圍內的事件）。 */
export interface CardImpact {
  hp: number;
  vp: number;
  energy: number;
  eliminated: boolean;
}

/**
 * 從 card_used 之後的事件，統計對指定座位的影響：
 * 一直算到下一張牌、下一次買牌、回合邊界或下一次骰面攻擊為止。
 */
export function impactOf(
  events: readonly GameEvent[],
  from: number,
  seat: number | null,
): CardImpact {
  const r: CardImpact = { hp: 0, vp: 0, energy: 0, eliminated: false };
  if (seat === null) return r;
  for (let i = from + 1; i < events.length; i++) {
    const e = events[i];
    if (!e) break;
    if (
      e.type === 'card_used' ||
      e.type === 'card_bought' ||
      e.type === 'turn_started' ||
      e.type === 'turn_ended' ||
      e.type === 'smash'
    )
      break;
    switch (e.type) {
      case 'damage_taken':
        if (e.seat === seat) r.hp -= e.amount;
        break;
      case 'healed':
        if (e.seat === seat) r.hp += e.amount;
        break;
      case 'vp_gained':
        if (e.seat === seat) r.vp += e.amount;
        break;
      case 'vp_lost':
        if (e.seat === seat) r.vp -= e.amount;
        break;
      case 'energy_gained':
        if (e.seat === seat) r.energy += e.amount;
        break;
      case 'energy_spent':
        if (e.seat === seat) r.energy -= e.amount;
        break;
      case 'eliminated':
        if (e.seat === seat) r.eliminated = true;
        break;
      default:
        break;
    }
  }
  return r;
}

const signed = (n: number): string => (n > 0 ? `+${String(n)}` : String(n));

/** 「HP -3、⭐ +2、⚡ -1」；沒有變化回傳空字串。 */
export function describeImpact(i: CardImpact): string {
  const parts: string[] = [];
  if (i.hp !== 0) parts.push(`HP ${signed(i.hp)}`);
  if (i.vp !== 0) parts.push(`⭐ ${signed(i.vp)}`);
  if (i.energy !== 0) parts.push(`⚡ ${signed(i.energy)}`);
  if (i.eliminated) parts.push('被淘汰');
  return parts.join('、');
}

export function noticesFor(events: readonly GameEvent[], c: NoticeContext): Notice[] {
  const out: Notice[] = [];
  const mine = (seat: number): boolean => seat === c.mySeat;
  const who = (seat: number): string => (mine(seat) ? '你' : c.nameOf(seat));
  const push = (n: Omit<Notice, 'id'>): void => {
    out.push({ ...n, id: String(out.length) });
  };

  for (const [idx, e] of events.entries()) {
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
      case 'card_used': {
        const impact = impactOf(events, idx, c.mySeat);
        const summary = describeImpact(impact);
        const gain = impact.hp > 0 || impact.vp > 0 || impact.energy > 0;
        // 自己用牌：有收穫就是好事（花能量是代價不算壞事）；別人用牌：任何損失都要警覺
        const bad = mine(e.seat)
          ? impact.eliminated
          : impact.hp < 0 || impact.vp < 0 || impact.energy < 0 || impact.eliminated;
        const good = !bad && gain;
        const base = `${who(e.seat)}使用了【${c.cardName(e.cardId)}】`;
        let tail: string;
        if (summary !== '') tail = `，${mine(e.seat) ? '你' : '對你'}：${summary}`;
        else tail = mine(e.seat) ? '' : '，對你沒有影響';
        push({
          kind: bad ? 'danger' : good ? 'good' : 'info',
          icon: c.cardIcon?.(e.cardId) ?? '🃏',
          text: base + tail,
        });
        break;
      }
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

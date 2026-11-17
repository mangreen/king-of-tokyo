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
  /** 卡面效果文字；這張牌沒有可量化的影響時，用它說明牌的作用。 */
  cardText?: (id: string) => string;
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
/** 一次用牌／被動發動對某個座位造成的變化（只算這張牌效果範圍內的事件）。 */
export interface CardImpact {
  hp: number;
  vp: number;
  energy: number;
  eliminated: boolean;
}

const EMPTY: CardImpact = { hp: 0, vp: 0, energy: 0, eliminated: false };

/** 這張牌的效果範圍：一直算到下一張牌、下一次買牌、回合邊界或下一次骰面攻擊為止。 */
function isBoundary(e: GameEvent): boolean {
  return (
    e.type === 'card_used' ||
    e.type === 'card_triggered' ||
    e.type === 'card_bought' ||
    e.type === 'turn_started' ||
    e.type === 'turn_ended' ||
    e.type === 'smash'
  );
}

/** 牌效果範圍內的事件索引（不含起點）。 */
function spanIndices(events: readonly GameEvent[], from: number): number[] {
  const out: number[] = [];
  for (let i = from + 1; i < events.length; i++) {
    const e = events[i];
    if (!e || isBoundary(e)) break;
    out.push(i);
  }
  return out;
}

function spanAfter(events: readonly GameEvent[], from: number): GameEvent[] {
  return spanIndices(events, from).map((i) => events[i] as GameEvent);
}

/** 範圍內每個座位的 HP／★／⚡ 變化（沒有變化的座位不列）。 */
export function impactsOf(span: readonly GameEvent[]): Map<number, CardImpact> {
  const m = new Map<number, CardImpact>();
  const at = (seat: number): CardImpact => {
    let r = m.get(seat);
    if (!r) {
      r = { ...EMPTY };
      m.set(seat, r);
    }
    return r;
  };
  for (const e of span) {
    switch (e.type) {
      case 'damage_taken':
        at(e.seat).hp -= e.amount;
        break;
      case 'healed':
        at(e.seat).hp += e.amount;
        break;
      case 'vp_gained':
        at(e.seat).vp += e.amount;
        break;
      case 'vp_lost':
        at(e.seat).vp -= e.amount;
        break;
      case 'energy_gained':
        at(e.seat).energy += e.amount;
        break;
      case 'energy_spent':
        at(e.seat).energy -= e.amount;
        break;
      case 'eliminated':
        at(e.seat).eliminated = true;
        break;
      default:
        break;
    }
  }
  for (const [seat, r] of m) {
    if (r.hp === 0 && r.vp === 0 && r.energy === 0 && !r.eliminated) m.delete(seat);
  }
  return m;
}

/** 從 card_used 之後的事件，統計對指定座位的影響。 */
export function impactOf(
  events: readonly GameEvent[],
  from: number,
  seat: number | null,
): CardImpact {
  if (seat === null) return { ...EMPTY };
  return impactsOf(spanAfter(events, from)).get(seat) ?? { ...EMPTY };
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

const FACE_TEXT: Record<string, string> = { energy: '⚡', attack: '💥', heal: '❤️' };
const faceText = (f: unknown): string => FACE_TEXT[String(f)] ?? String(f);

/**
 * 牌效果範圍內，數字以外的變化（多一次擲骰、改骰、額外回合、指示物…）。
 * 這些不影響 HP／★／⚡，但玩家需要知道發生了什麼。
 */
function sideEffects(span: readonly GameEvent[], c: NoticeContext): string[] {
  const who = (seat: number): string => (seat === c.mySeat ? '你' : c.nameOf(seat));
  const out: string[] = [];
  for (const e of span) {
    switch (e.type) {
      case 'rolls_added':
        out.push(
          `${who(e.seat)}本回合多 ${String(e.amount)} 次擲骰機會${
            e.left === undefined ? '' : `（卡上剩 ${String(e.left)} 次）`
          }`,
        );
        break;
      case 'die_changed':
        out.push(`${who(e.seat)}把第 ${String(e.index + 1)} 顆骰子改成 ${faceText(e.face)}`);
        break;
      case 'die_rerolled':
        out.push(
          `${who(e.by)}重擲了${who(e.seat)}的第 ${String(e.index + 1)} 顆骰子：${faceText(e.face)}`,
        );
        break;
      case 'extra_turn_granted':
        out.push(`${who(e.seat)}回合結束後會再進行一個回合`);
        break;
      case 'counter_gained':
        out.push(`${who(e.seat)}得到${e.counter === 'poison' ? '毒' : '縮小'}指示物`);
        break;
      case 'max_hp_changed':
        out.push(`${who(e.seat)}的最大 HP 變成 ${String(e.maxHp)}`);
        break;
      case 'damage_prevented':
        out.push(`${who(e.seat)}擋下 ${String(e.amount)} 點傷害`);
        break;
      case 'card_swapped':
        out.push(`${who(e.seat)}與${who(e.from)}換卡`);
        break;
      case 'deck_peeked':
        out.push(`${who(e.seat)}偷看了牌庫頂的一張牌`);
        break;
      case 'dice_penalty':
        out.push('下個回合所有怪獸少擲 1 顆骰子');
        break;
      case 'entered_tokyo':
        out.push(`${who(e.seat)}進入${LOC[e.location]}`);
        break;
      case 'yielded':
        out.push(`${who(e.seat)}離開了東京`);
        break;
      default:
        break;
    }
  }
  return out;
}

/** 這次效果的完整描述：每個受影響的座位各一段，加上不屬於數字的變化。 */
export function describeEffects(
  span: readonly GameEvent[],
  c: NoticeContext,
  actor: number,
): string {
  const impacts = impactsOf(span);
  const seats = [...impacts.keys()].sort((a, b) => (a === actor ? -1 : b === actor ? 1 : a - b));
  const parts = seats.map((seat) => {
    const who = seat === c.mySeat ? '你' : c.nameOf(seat);
    return `${who} ${describeImpact(impacts.get(seat) ?? EMPTY)}`;
  });
  return [...sideEffects(span, c), ...parts].join('；');
}

export function noticesFor(events: readonly GameEvent[], c: NoticeContext): Notice[] {
  const out: Notice[] = [];
  const mine = (seat: number): boolean => seat === c.mySeat;
  const who = (seat: number): string => (mine(seat) ? '你' : c.nameOf(seat));
  const push = (n: Omit<Notice, 'id'>): void => {
    out.push({ ...n, id: String(out.length) });
  };
  /** 已經寫進某張牌提示裡的事件，不再另外跳提示。 */
  const covered = new Set<number>();

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
        if (covered.has(idx)) break;
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
      case 'card_used':
      case 'card_triggered': {
        // 不分敵我：誰、哪張牌、造成什麼影響（對所有人）。讓玩家也能從別人的牌學到效果
        const indices = spanIndices(events, idx);
        const span = indices.map((i) => events[i] as GameEvent);
        for (const i of indices) {
          const t = events[i]?.type;
          if (t === 'extra_turn_granted' || t === 'counter_gained' || t === 'entered_tokyo') {
            covered.add(i);
          }
        }
        const impacts = impactsOf(span);
        const mineImpact = c.mySeat === null ? undefined : impacts.get(c.mySeat);
        const gain =
          mineImpact !== undefined &&
          (mineImpact.hp > 0 || mineImpact.vp > 0 || mineImpact.energy > 0);
        // 自己用牌：有收穫就是好事（花能量是代價不算壞事）；別人的牌：我有任何損失都要警覺
        const bad =
          mineImpact !== undefined &&
          (mine(e.seat)
            ? mineImpact.eliminated
            : mineImpact.hp < 0 ||
              mineImpact.vp < 0 ||
              mineImpact.energy < 0 ||
              mineImpact.eliminated);
        const good = !bad && gain;
        const base =
          e.type === 'card_used'
            ? `${who(e.seat)}使用了【${c.cardName(e.cardId)}】`
            : `${who(e.seat)}的【${c.cardName(e.cardId)}】發動了`;
        let effect = describeEffects(span, c, e.seat);
        if (effect === '') effect = c.cardText?.(e.cardId) ?? '';
        push({
          kind: bad ? 'danger' : good ? 'good' : 'info',
          icon: c.cardIcon?.(e.cardId) ?? '🃏',
          text: effect === '' ? base : `${base}：${effect}`,
        });
        break;
      }
      case 'counter_gained':
        if (mine(e.seat) && !covered.has(idx)) {
          push({
            kind: 'warn',
            icon: e.counter === 'poison' ? '☠️' : '🔻',
            text: e.counter === 'poison' ? '你中毒了' : '你被縮小了',
          });
        }
        break;
      case 'extra_turn_granted':
        if (covered.has(idx)) break;
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

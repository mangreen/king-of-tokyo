import type { Action, CardDef, GameState } from '@kot/rules';
import { currentActor, legalActions, type RulesEnv } from '@kot/rules';
import type { GameActionInput } from '@kot/protocol';

/** 引擎動作 → 送給伺服器的意圖（座位由伺服器決定，所以去掉 seat）。 */
export function toIntent(action: Action): GameActionInput {
  return Object.fromEntries(
    Object.entries(action).filter(([key]) => key !== 'seat'),
  ) as GameActionInput;
}

export function envOf(cards: readonly CardDef[] | null): RulesEnv {
  const map: Record<string, CardDef> = {};
  for (const card of cards ?? []) map[card.id] = card;
  return { cards: map };
}

/**
 * 我現在可以做的動作（只在輪到我時有值）。直接用規則引擎的 legalActions 推導，
 * 因此按鈕永遠和引擎的判斷一致；伺服器仍會再驗證一次。
 * 擲骰與保留骰子另有專用介面，不在這裡列出。
 */
export function myActions(state: GameState, env: RulesEnv, seat: number | null): Action[] {
  if (seat === null || state.phase === 'over' || currentActor(state) !== seat) return [];
  return legalActions(state, env).filter((a) => a.type !== 'roll' && a.type !== 'endRolling');
}

export interface LabelContext {
  cardName: (id: string) => string;
  nameOf: (seat: number) => string;
}

const FACE_TEXT: Record<string, string> = { energy: '⚡', attack: '💥', heal: '❤️' };
const faceText = (face: number | string): string => FACE_TEXT[String(face)] ?? String(face);

/** 動作按鈕上的文字（繁體中文）。 */
export function labelAction(action: Action, ctx: LabelContext): string {
  switch (action.type) {
    case 'yieldDecision': {
      if (!action.leave) return '留下';
      return action.takeCard === undefined ? '讓位' : `讓位並拿走 ${ctx.cardName(action.takeCard)}`;
    }
    case 'buy': {
      const name = ctx.cardName(action.cardId);
      if (action.from === 'deck') return `買牌庫頂的 ${name}`;
      if (typeof action.from === 'number') return `向 ${ctx.nameOf(action.from)} 買 ${name}`;
      const extras: string[] = [];
      if (action.energy !== undefined) extras.push(`放 ${String(action.energy)} 能量`);
      if (action.target !== undefined) extras.push(`複製 ${ctx.cardName(action.target)}`);
      return `買 ${name}${extras.length > 0 ? `（${extras.join('，')}）` : ''}`;
    }
    case 'sweep':
      return '花 2 能量清掉商店';
    case 'endTurn':
      return '結束回合';
    case 'useCard': {
      const name = ctx.cardName(action.cardId);
      const args = action.args;
      const parts: string[] = [];
      if (args?.die !== undefined) parts.push(`第 ${String(args.die + 1)} 顆`);
      if (args?.face !== undefined) parts.push(`改成 ${faceText(args.face)}`);
      if (args?.target !== undefined) parts.push(`複製 ${ctx.cardName(args.target)}`);
      if (args?.cards !== undefined) parts.push(`賣掉 ${args.cards.map(ctx.cardName).join('、')}`);
      return `使用 ${name}${parts.length > 0 ? `：${parts.join(' ')}` : ''}`;
    }
    case 'reactDecision':
      return action.cardId === null ? '不使用' : `使用 ${ctx.cardName(action.cardId)}`;
    case 'heartsDecision': {
      const parts: string[] = [];
      if (action.self > 0) parts.push(`自己回復 ${String(action.self)}`);
      if (action.poison > 0) parts.push(`移除 ${String(action.poison)} 個毒`);
      if (action.shrink > 0) parts.push(`移除 ${String(action.shrink)} 個縮小`);
      for (const o of action.others) {
        parts.push(`${ctx.nameOf(o.seat)} 回復 ${String(o.amount)}`);
      }
      return parts.length > 0 ? parts.join('，') : '不回復';
    }
    case 'probeDecision':
      return action.die === null ? '不重擲' : `重擲第 ${String(action.die + 1)} 顆骰子`;
    case 'opportunityDecision':
      return action.buy ? '買下這張牌' : '不買';
    case 'roll':
      return '擲骰';
    case 'endRolling':
      return '結算';
  }
}

/** 動作分組：同一張卡的多種參數合併成一組，介面才不會被幾十個按鈕淹沒。 */
export interface ActionGroup {
  key: string;
  title: string | null;
  actions: Action[];
}

export function groupActions(actions: Action[], ctx: LabelContext): ActionGroup[] {
  const groups: ActionGroup[] = [];
  const useByCard = new Map<string, ActionGroup>();
  for (const action of actions) {
    if (action.type === 'useCard') {
      let group = useByCard.get(action.cardId);
      if (!group) {
        group = { key: `use:${action.cardId}`, title: ctx.cardName(action.cardId), actions: [] };
        useByCard.set(action.cardId, group);
        groups.push(group);
      }
      group.actions.push(action);
    } else {
      groups.push({
        key: `${action.type}:${JSON.stringify(action)}`,
        title: null,
        actions: [action],
      });
    }
  }
  return groups;
}

import { NO_CARDS } from './cards/types.js';
import type { RulesEnv } from './cards/types.js';
import { applyAction } from './engine.js';
import { createGame } from './state.js';
import type { Action, GameEvent, GameState, RulesConfig } from './types.js';

/**
 * 由設定、seed 與動作序列重放整場遊戲。任何動作被拒絕就丟出錯誤（日誌損毀或規則版本不符）。
 */
export function replay(
  config: RulesConfig,
  seed: number,
  actions: readonly Action[],
  env: RulesEnv = NO_CARDS,
): { state: GameState; events: GameEvent[] } {
  const created = createGame(config, seed, env);
  let state = created.state;
  const events = [...created.events];
  for (const [index, action] of actions.entries()) {
    const result = applyAction(state, action, env);
    if (!result.ok) {
      throw new Error(`重放失敗：第 ${String(index)} 個動作被拒絕（${result.error}）`);
    }
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}

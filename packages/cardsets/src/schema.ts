/**
 * set.json 的格式與驗證。除了形狀之外，還檢查語意：effectId 必須存在、卡牌種類要符合效果、
 * 必要參數要齊全、id 不重複。驗證失敗一律丟出帶有說明的錯誤，不會默默略過任何一張卡。
 */
import { z } from 'zod';
import { EFFECTS } from '@kot/rules';
import type { CardDef } from '@kot/rules';

const InstantOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('vp'), n: z.number().int().min(0).max(30) }),
  z.object({ op: z.literal('energy'), n: z.number().int().min(0).max(30) }),
  z.object({ op: z.literal('heal'), n: z.number().int().min(0).max(30) }),
  z.object({ op: z.literal('selfDamage'), n: z.number().int().min(0).max(30) }),
  z.object({ op: z.literal('damageOthers'), n: z.number().int().min(0).max(30) }),
  z.object({ op: z.literal('damageAll'), n: z.number().int().min(0).max(30) }),
  z.object({ op: z.literal('othersLoseVp'), n: z.number().int().min(0).max(30) }),
  z.object({ op: z.literal('othersLoseEnergyPer'), per: z.number().int().min(1).max(30) }),
  z.object({ op: z.literal('takeTokyo') }),
  z.object({ op: z.literal('extraTurn') }),
  z.object({
    op: z.literal('perCard'),
    vp: z.number().int().min(0).max(10),
    damage: z.number().int().min(0).max(10),
  }),
]);

const ParamValueSchema = z.union([
  z.number(),
  z.string().max(100),
  z.boolean(),
  z.array(InstantOpSchema).max(10),
]);

export const CardSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/),
  name: z.string().min(1).max(80),
  cost: z.number().int().min(0).max(20),
  kind: z.enum(['keep', 'discard']),
  text: z.string().max(600),
  effectId: z.string().min(1).max(64),
  params: z.record(z.string().max(40), ParamValueSchema),
});

export const CardSetSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(80),
  version: z.number().int().min(1),
  cards: z.array(CardSchema).min(1).max(300),
});

export interface CardSet {
  id: string;
  name: string;
  version: number;
  cards: CardDef[];
}

/** 解析並驗證 set.json 的內容。 */
export function parseCardSet(input: unknown): CardSet {
  const set = CardSetSchema.parse(input) as CardSet;
  const problems = validateCardSetSemantics(set);
  if (problems.length > 0) {
    throw new Error(`卡牌組 ${set.id} 驗證失敗：\n- ${problems.join('\n- ')}`);
  }
  return set;
}

/** 語意檢查，回傳問題清單（空陣列表示通過）。 */
export function validateCardSetSemantics(set: CardSet): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const c of set.cards) {
    if (seen.has(c.id)) problems.push(`卡牌 id 重複：${c.id}`);
    seen.add(c.id);
    const effect = EFFECTS[c.effectId];
    if (!effect) {
      problems.push(`${c.id}（${c.name}）：未知的 effectId「${c.effectId}」`);
      continue;
    }
    if (effect.kind !== c.kind) {
      problems.push(
        `${c.id}（${c.name}）：效果 ${c.effectId} 需要 ${effect.kind} 卡，但這張是 ${c.kind}`,
      );
    }
    for (const key of effect.requiredParams ?? []) {
      if (!(key in c.params)) {
        problems.push(`${c.id}（${c.name}）：缺少參數「${key}」`);
      }
    }
  }
  if (set.cards.length < 6) {
    problems.push('卡牌數量太少（至少 6 張才能開局翻 3 張並有後續補牌）');
  }
  return problems;
}

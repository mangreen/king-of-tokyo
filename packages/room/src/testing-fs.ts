/** 測試用工具（只能在 Node 執行）：從 repo 載入原創卡組。 */
import { fileURLToPath } from 'node:url';
import { loadCardSets, type LoadedCardSet } from '@kot/cardsets';

/** 載入 repo 內提交的原創卡組（測試不依賴使用者自備的 local 卡組）。 */
export function testCardSets(): Map<string, LoadedCardSet> {
  const root = fileURLToPath(new URL('../../../card-sets/', import.meta.url));
  const all = loadCardSets(root);
  const original = all.get('original');
  if (!original) throw new Error('找不到原創卡組');
  return new Map([['original', original]]);
}

export function testCardSet(): LoadedCardSet {
  const set = testCardSets().get('original');
  if (!set) throw new Error('找不到原創卡組');
  return set;
}

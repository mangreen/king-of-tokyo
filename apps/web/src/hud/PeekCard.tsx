import type { CardDef } from '@kot/rules';
import { CardBody } from './CardChip.js';

/**
 * 先知偷看到的牌庫頂：整個買牌階段都留在商店分頁，使用者可以慢慢讀卡面再決定要不要買。
 * （提示只停留幾秒；這裡是「可以隨時回來看」的地方。）
 */
export function PeekCard({ id, def }: { id: string | null; def: CardDef | undefined }) {
  if (id === null) return null;
  return (
    <section className="peek-card" aria-label="偷看到的牌庫頂">
      <h4 className="shop-sub">🔮 你偷看到的牌庫頂</h4>
      <div className="shop-card">{def ? <CardBody def={def} /> : <strong>{id}</strong>}</div>
    </section>
  );
}

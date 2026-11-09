import type { CardDef } from '@kot/rules';
import { Tip } from './Tip.js';

export const KIND_LABEL = { keep: '持續', discard: '一次性' } as const;

/** 卡牌的完整說明（名稱、費用、類型、卡面文字）。 */
export function CardBody({ def }: { def: CardDef }) {
  return (
    <div className="card-body">
      <div className="card-body-head">
        <strong>{def.name}</strong>
        <span className="cost">⚡{def.cost}</span>
        <span className="muted">{KIND_LABEL[def.kind]}</span>
      </div>
      <p>{def.text}</p>
    </div>
  );
}

/** 玩家持有的卡牌小標籤：滑鼠移上去、點一下或長按都會顯示完整說明。 */
export function CardChip({ id, def }: { id: string; def: CardDef | undefined }) {
  if (!def) return <span className="tag">{id}</span>;
  return (
    <Tip label={def.name} content={<CardBody def={def} />} className="tag card-chip">
      {def.name}
    </Tip>
  );
}

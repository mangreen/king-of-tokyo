import { useState, type FormEvent } from 'react';
import { RoomCodeSchema, type CardSetInfo } from '@kot/protocol';

interface Props {
  nickname: string;
  cardSets: CardSetInfo[];
  defaultCardSetId: string | null;
  onCreate: (cardSetId?: string) => void;
  onJoin: (code: string) => void;
  onLogout: () => void;
}

export function Lobby({ nickname, cardSets, defaultCardSetId, onCreate, onJoin, onLogout }: Props) {
  const [code, setCode] = useState('');
  const [chosenSet, setChosenSet] = useState<string | null>(null);
  const cardSetId = chosenSet ?? defaultCardSetId ?? cardSets[0]?.id;
  const [error, setError] = useState<string | null>(null);

  function join(event: FormEvent): void {
    event.preventDefault();
    const parsed = RoomCodeSchema.safeParse(code);
    if (!parsed.success) {
      setError('房號是 5 個字元（英文字母與數字，沒有 I、O、0、1）');
      return;
    }
    onJoin(parsed.data);
  }

  return (
    <div className="card">
      <h2>大廳</h2>
      <p>
        你好，<strong>{nickname}</strong>
      </p>
      <div className="row">
        {cardSets.length > 1 && (
          <label>
            卡牌組{' '}
            <select
              value={cardSetId}
              onChange={(e) => {
                setChosenSet(e.target.value);
              }}
            >
              {cardSets.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}（{c.cardCount} 張）
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          className="primary"
          onClick={() => {
            onCreate(cardSetId);
          }}
        >
          建立房間
        </button>
      </div>
      <hr />
      <form onSubmit={join} className="row">
        <input
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError(null);
          }}
          placeholder="輸入房號"
          maxLength={5}
          aria-label="房號"
          className="code-input"
        />
        <button type="submit">加入房間</button>
      </form>
      {error && <p className="error">{error}</p>}
      <p>
        <button className="link" onClick={onLogout}>
          換暱稱
        </button>
      </p>
    </div>
  );
}

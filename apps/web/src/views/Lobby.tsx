import { useState, type FormEvent } from 'react';
import { RoomCodeSchema } from '@kot/protocol';

interface Props {
  nickname: string;
  onCreate: () => void;
  onJoin: (code: string) => void;
  onLogout: () => void;
}

export function Lobby({ nickname, onCreate, onJoin, onLogout }: Props) {
  const [code, setCode] = useState('');
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
      <button className="primary" onClick={onCreate}>
        建立房間
      </button>
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

import { useState } from 'react';
import type { RoomSnapshot } from '@kot/protocol';
import { describeRole, handoverTo, type RoleStatus } from '../net/roleStatus.js';

interface Props {
  role: NonNullable<RoleStatus>;
  room: RoomSnapshot;
  selfId: string;
}

/** 房主模式的角色說明；房主可以把「房主」交給另一位在線的真人（要離開或換設備時）。 */
export function RolePanel({ role, room, selfId }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const candidates =
    role.role === 'host'
      ? room.players.filter((p) => !p.bot && p.connected && p.id !== selfId)
      : [];

  async function handover(id: string): Promise<void> {
    setBusy(id);
    setFailed(false);
    const ok = await handoverTo(id);
    setBusy(null);
    setFailed(!ok);
  }

  return (
    <div data-testid="role-status">
      <div>{describeRole(role)}</div>
      {role.role === 'host' && candidates.length > 0 && (
        <div className="role-handover">
          換人當房主：
          {candidates.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={busy !== null}
              data-testid={`handover-${p.nickname}`}
              onClick={() => {
                void handover(p.id);
              }}
            >
              {busy === p.id ? '交接中…' : `交給 ${p.nickname}`}
            </button>
          ))}
        </div>
      )}
      {failed && (
        <div role="alert" data-testid="handover-failed">
          交接失敗（對方可能剛好離線），你仍然是房主。
        </div>
      )}
    </div>
  );
}

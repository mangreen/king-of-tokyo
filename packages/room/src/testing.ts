/** 測試用工具：假時鐘與記錄推送的 Publisher（可攜，瀏覽器端測試也能用）。 */
import type { GameCardsMessage, GameUpdateMessage, RoomSnapshot } from '@kot/protocol';
import type { Publisher } from './room.js';
import type { Scheduler } from './scheduler.js';

export class FakeScheduler implements Scheduler {
  private time = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; fn: () => void }>();

  now(): number {
    return this.time;
  }

  after(ms: number, fn: () => void): () => void {
    const id = this.nextId;
    this.nextId += 1;
    this.timers.set(id, { at: this.time + ms, fn });
    return () => {
      this.timers.delete(id);
    };
  }

  get pending(): number {
    return this.timers.size;
  }

  /** 前進時間，依到期順序觸發計時器（觸發中新增的計時器若在範圍內也會觸發）。 */
  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      let nextId: number | null = null;
      let nextAt = Infinity;
      for (const [id, timer] of this.timers) {
        if (timer.at <= target && timer.at < nextAt) {
          nextAt = timer.at;
          nextId = id;
        }
      }
      if (nextId === null) break;
      const timer = this.timers.get(nextId);
      this.timers.delete(nextId);
      if (timer) {
        this.time = Math.max(this.time, timer.at);
        timer.fn();
      }
    }
    this.time = target;
  }
}

export class RecordingPublisher implements Publisher {
  readonly rooms = new Map<string, (RoomSnapshot | null)[]>();
  readonly games = new Map<string, GameUpdateMessage[]>();
  readonly cards = new Map<string, GameCardsMessage[]>();

  gameCards(playerId: string, message: GameCardsMessage): void {
    const list = this.cards.get(playerId) ?? [];
    list.push(message);
    this.cards.set(playerId, list);
  }

  roomState(playerId: string, room: RoomSnapshot | null): void {
    const list = this.rooms.get(playerId) ?? [];
    list.push(room);
    this.rooms.set(playerId, list);
  }

  gameUpdate(playerId: string, message: GameUpdateMessage): void {
    const list = this.games.get(playerId) ?? [];
    list.push(message);
    this.games.set(playerId, list);
  }

  lastRoom(playerId: string): RoomSnapshot | null | undefined {
    return this.rooms.get(playerId)?.at(-1);
  }

  lastGame(playerId: string): GameUpdateMessage | undefined {
    return this.games.get(playerId)?.at(-1);
  }
}

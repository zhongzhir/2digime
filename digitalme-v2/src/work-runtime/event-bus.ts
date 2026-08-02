import type { DomainPushEvent, PushEventListener } from '../shared/events';

/**
 * 内存事件总线 — 单向推送,非事实源。
 * 事件丢失后可通过 ObjectStore 查询恢复当前状态;不持久化第二套状态日志。
 */
export class InMemoryEventBus {
  private readonly listeners = new Set<PushEventListener>();

  subscribe(listener: PushEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(event: DomainPushEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 监听方异常不得反向影响领域状态。
      }
    }
  }
}

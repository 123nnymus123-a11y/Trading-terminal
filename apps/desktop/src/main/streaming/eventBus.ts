export type EventListener = (evt: unknown) => void;

export class EventBus {
  private listeners = new Set<EventListener>();

  publish(evt: unknown) {
    for (const l of this.listeners) l(evt);
  }

  subscribe(listener: EventListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
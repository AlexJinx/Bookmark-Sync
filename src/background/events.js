// 极简事件总线：sync-engine / 自动任务发事件，badge / notify 订阅。
// 新增外发通道（如声音提示、外部 webhook）时在 index.js 里 on() 即可。
const listeners = new Map();

export function on(event, handler) {
  if (!listeners.has(event)) {
    listeners.set(event, []);
  }
  listeners.get(event).push(handler);
}

export async function emit(event, payload = {}) {
  const handlers = listeners.get(event) || [];
  for (const handler of handlers) {
    try {
      await handler(payload);
    } catch (error) {
      console.error(`event handler failed: ${event}`, error);
    }
  }
}

export const Events = Object.freeze({
  AUTO_SYNC_SUCCESS: "autoSync:success",
  AUTO_SYNC_CONFLICT: "autoSync:conflict",
  AUTO_SYNC_ERROR: "autoSync:error",
  MANUAL_SYNC_SUCCESS: "manualSync:success",
  CHANGE_PENDING: "changeSync:pending",
  REMOTE_AHEAD: "remote:ahead"
});

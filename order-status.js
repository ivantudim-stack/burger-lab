import { ORDER_SERVICE_URL, normalizeTracking, validStatusTime } from './model.js';

export const READY_BOARD_URL = `${ORDER_SERVICE_URL}/ready`;

export function parseStatusResponse(payload, id) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || !Object.prototype.hasOwnProperty.call(payload, 'order')) throw new Error('Некорректный ответ сервиса статусов.');
  if (payload.order === null) return null;
  const tracking = normalizeTracking(payload.order, id);
  if (!tracking) throw new Error('Некорректный статус заказа.');
  return tracking;
}

export async function fetchOrderStatus(id, { fetchImpl = globalThis.fetch, signal, timeoutMs = 8000, now = Date.now } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = new URL('/api/status', ORDER_SERVICE_URL);
    url.searchParams.set('orderId', id);
    const response = await fetchImpl(url.href, {
      method: 'GET', credentials: 'omit', mode: 'cors', cache: 'no-store', redirect: 'error',
      headers: { Accept: 'application/json' }, signal: controller.signal,
    });
    if (!response.ok || response.status !== 200) throw new Error('Сервис статусов временно недоступен.');
    const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') throw new Error('Некорректный ответ сервиса статусов.');
    const tracking = parseStatusResponse(await response.json(), id);
    if (controller.signal.aborted) throw new DOMException('Проверка отменена.', 'AbortError');
    return { id, tracking, checkedAt: new Date(now()).toISOString() };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/** A request failure cannot erase the last status; every request contains only an anonymous ID. */
export async function syncOrderStatuses(snapshot, options = {}) {
  const ids = [...new Set(snapshot.map(order => order.id))].slice(0, 30);
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < ids.length && !options.signal?.aborted) {
      const id = ids[next++];
      try { results.push(await fetchOrderStatus(id, options)); }
      catch { results.push({ id, error: true }); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker));
  return results;
}

/** Merge against the current history, never replace it with the snapshot used for the request. */
export function mergeStatusResults(currentOrders, snapshotIds, results) {
  const requested = new Set(snapshotIds);
  const updates = new Map(results.filter(result => requested.has(result.id) && !result.error).map(result => [result.id, result]));
  return currentOrders.slice(0, 30).map(order => {
    const result = updates.get(order.id);
    if (!result || !validStatusTime(result.checkedAt)) return order;
    if (order.statusCheckedAt && Date.parse(result.checkedAt) < Date.parse(order.statusCheckedAt)) return order;
    if (result.tracking === null) return order.tracking ? order : { ...order, statusCheckedAt: result.checkedAt };
    const tracking = normalizeTracking(result.tracking, order.id);
    if (!tracking || (order.fulfillment && tracking.fulfillment !== order.fulfillment)) return order;
    const previous = normalizeTracking(order.tracking, order.id);
    if (previous) {
      if (tracking.createdAt !== previous.createdAt || tracking.fulfillment !== previous.fulfillment
        || tracking.revision < previous.revision || Date.parse(tracking.updatedAt) < Date.parse(previous.updatedAt)) return order;
      if (tracking.revision === previous.revision && JSON.stringify(tracking) !== JSON.stringify(previous)) return order;
    }
    return { ...order, tracking, statusCheckedAt: result.checkedAt };
  });
}

export function statusLabel(tracking) {
  if (!tracking) return 'Сохранена на телефоне · Ожидает подтверждения';
  const delivery = tracking.fulfillment === 'delivery';
  return ({
    accepted: 'Принят рестораном', cooking: 'Готовится',
    ready: delivery ? 'Готов к отправке' : 'Готов к выдаче',
    out_for_delivery: 'Курьер в пути', completed: delivery ? 'Доставлен' : 'Выдан',
    cancelled: 'Отменён рестораном',
  })[tracking.status] || 'Статус не подтверждён';
}

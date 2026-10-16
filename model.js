/** Pure cart and local-request model. No request is sent to the restaurant here. */
export const STORAGE_KEY = 'burger-lab-pwa-v1';
const MAX_QUANTITY = 99;
const MAX_ORDERS = 30;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clean = value => typeof value === 'string' ? value.trim() : '';
const length = value => [...value].length;
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
const nonnegativeInteger = value => Number.isSafeInteger(value) && value >= 0;

function catalogMap(catalog) {
  return new Map((Array.isArray(catalog) ? catalog : [])
    .filter(product => isObject(product) && clean(product.id) && positiveInteger(product.priceRubles))
    .map(product => [product.id, product]));
}

function quantities(stored) {
  if (!isObject(stored)) return {};
  return Object.fromEntries(Object.entries(stored)
    .filter(([id, quantity]) => clean(id) && positiveInteger(quantity))
    .map(([id, quantity]) => [id, Math.min(quantity, MAX_QUANTITY)]));
}

/** Russian domestic numbers; formatting characters match the Android app. */
export function normalizePhone(raw) {
  const value = clean(raw);
  if (!value || !/^\+?[0-9 ()\-\t\u00a0]+$/.test(value)) return '';
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) return `+7${digits}`;
  if (digits.length === 11 && /^[78]/.test(digits)) return `+7${digits.slice(1)}`;
  return '';
}

/** Returns the first user-facing error, or an empty string. */
export function validateCheckout(form = {}) {
  const safe = isObject(form) ? form : {};
  const nameLength = length(clean(safe.name));
  if (nameLength < 2 || nameLength > 80) return 'Укажите имя: от 2 до 80 символов.';
  if (!normalizePhone(safe.phone)) return 'Укажите российский номер телефона: 10 цифр или 11 с 7 / 8.';
  const addressLength = length(clean(safe.address));
  if (safe.delivery === true && (addressLength < 5 || addressLength > 240)) {
    return 'Укажите адрес доставки: от 5 до 240 символов.';
  }
  if (safe.consent !== true) return 'Разрешите передачу контактов вместе с заявкой.';
  return '';
}

/** Restored quantities must be integers. Missing prices cannot enter the cart. */
export function normalizeCart(catalog, storedObject) {
  const products = catalogMap(catalog);
  return Object.fromEntries(Object.entries(quantities(storedObject)).filter(([id]) => products.has(id)));
}

/** Does not mutate either argument. Negative deltas remove items at zero. */
export function addToCart(catalog, cart, id, delta = 1) {
  const next = normalizeCart(catalog, cart);
  if (!catalogMap(catalog).has(id) || !Number.isSafeInteger(delta)) return next;
  const quantity = (Object.prototype.hasOwnProperty.call(next, id) ? next[id] : 0) + delta;
  if (quantity <= 0) delete next[id];
  else Object.defineProperty(next, id, {
    value: Math.min(quantity, MAX_QUANTITY), enumerable: true, writable: true, configurable: true,
  });
  return next;
}

export function cartTotals(catalog, cart, options = {}) {
  const products = catalogMap(catalog);
  const normalized = normalizeCart(catalog, cart);
  let count = 0;
  let subtotal = 0;
  for (const [id, quantity] of Object.entries(normalized)) {
    count += quantity;
    subtotal += products.get(id).priceRubles * quantity;
  }
  if (!Number.isSafeInteger(subtotal)) throw new Error('Сумма корзины слишком велика.');
  const safe = isObject(options) ? options : {};
  const fee = nonnegativeInteger(safe.deliveryFeeRubles) ? safe.deliveryFeeRubles : 0;
  const freeFrom = nonnegativeInteger(safe.freeDeliveryFromRubles)
    ? safe.freeDeliveryFromRubles : 2147483647;
  const deliveryFee = safe.delivery === true && subtotal > 0 && subtotal < freeFrom ? fee : 0;
  const total = subtotal + deliveryFee;
  if (!Number.isSafeInteger(total)) throw new Error('Сумма корзины слишком велика.');
  return { count, subtotal, deliveryFee, total };
}

function formatDate(value) {
  // A preformatted date is useful when restoring or creating deterministic snapshots.
  if (typeof value === 'string' && /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/.test(value)) return value;
  const date = value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Некорректная дата заявки.');
  const parts = new Intl.DateTimeFormat('ru-RU', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const part = type => parts.find(entry => entry.type === type)?.value;
  return `${part('day')}.${part('month')}.${part('year')} ${part('hour')}:${part('minute')}`;
}

function requestId() {
  return globalThis.crypto?.randomUUID?.() || `BL-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Snapshots menu names/prices and produces text for manual sharing. */
export function buildOrder(catalog, cart, form, business = {}, options = {}) {
  const error = validateCheckout(form);
  if (error) throw new Error(error);
  const safeBusiness = isObject(business) ? business : {};
  if (form.delivery === true && safeBusiness.deliveryEnabled !== true) {
    throw new Error('Доставка пока недоступна. Выберите самовывоз.');
  }
  const normalized = normalizeCart(catalog, cart);
  const totals = cartTotals(catalog, normalized, { ...safeBusiness, delivery: form.delivery === true });
  if (!totals.count) throw new Error('Добавьте блюда в корзину.');
  const products = catalogMap(catalog);
  const items = Object.entries(normalized).map(([id, quantity]) => ({
    id, name: clean(products.get(id).name) || id, quantity, priceRubles: products.get(id).priceRubles,
  }));
  const safeOptions = isObject(options) ? options : {};
  const id = clean(safeOptions.id) || requestId();
  const date = formatDate(safeOptions.date);
  const lines = [
    `${clean(safeBusiness.name) || 'BURGER LAB'} — заявка №${id}`,
    date,
    `Имя: ${clean(form.name)}`,
    `Телефон: ${normalizePhone(form.phone)}`,
    `Получение: ${form.delivery === true ? 'доставка' : 'самовывоз'}`,
  ];
  if (form.delivery === true) lines.push(`Адрес доставки: ${clean(form.address)}`);
  else if (clean(safeBusiness.address)) lines.push(`Адрес самовывоза: ${clean(safeBusiness.address)}`);
  lines.push('', ...items.map((item, index) =>
    `${index + 1}. ${item.name} — ${item.quantity} × ${item.priceRubles} ₽ = ${item.quantity * item.priceRubles} ₽`));
  lines.push('', `Блюда: ${totals.subtotal} ₽`);
  if (form.delivery === true) lines.push(`Доставка: ${totals.deliveryFee} ₽`);
  lines.push(`Итого: ${totals.total} ₽`);
  if (clean(form.comment)) lines.push(`Комментарий: ${clean(form.comment)}`);
  lines.push('', 'Заявка сформирована на устройстве и требует отправки и подтверждения рестораном.');
  return {
    id, date, items, subtotal: totals.subtotal, deliveryFee: totals.deliveryFee,
    total: totals.total, text: lines.join('\n'), status: 'local',
  };
}

function normalizeOrder(order) {
  if (!isObject(order) || !clean(order.id) || order.id.length > 160
    || !clean(order.date) || order.date.length > 80
    || !clean(order.text) || order.text.length > 32000
    || !Array.isArray(order.items) || !order.items.length || order.items.length > 1000) return null;
  const items = [];
  for (const item of order.items) {
    if (!isObject(item) || !clean(item.id) || item.id.length > 160
      || !clean(item.name) || item.name.length > 240
      || !positiveInteger(item.quantity) || item.quantity > MAX_QUANTITY
      || !positiveInteger(item.priceRubles)) return null;
    items.push({ id: item.id, name: item.name, quantity: item.quantity, priceRubles: item.priceRubles });
  }
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.priceRubles, 0);
  if (!positiveInteger(subtotal) || subtotal !== order.subtotal
    || !nonnegativeInteger(order.deliveryFee) || !positiveInteger(order.total)
    || order.total !== subtotal + order.deliveryFee) return null;
  return {
    id: order.id, date: order.date, items, subtotal, deliveryFee: order.deliveryFee,
    total: order.total, text: order.text, status: 'local',
  };
}

function normalizeOrders(orders) {
  if (!Array.isArray(orders)) return [];
  const result = [];
  const ids = new Set();
  for (const value of orders) {
    const order = normalizeOrder(value);
    if (order && !ids.has(order.id)) {
      result.push(order);
      ids.add(order.id);
      if (result.length === MAX_ORDERS) break;
    }
  }
  return result;
}

/** Security/quota errors or damaged JSON must never prevent using the menu. */
export function loadState(storage, catalog) {
  try {
    const state = JSON.parse(storage.getItem(STORAGE_KEY));
    if (!isObject(state)) return { cart: {}, orders: [] };
    return { cart: normalizeCart(catalog, state.cart), orders: normalizeOrders(state.orders) };
  } catch {
    return { cart: {}, orders: [] };
  }
}

/** No checkout form is persisted separately; history contains the shared request. */
export function saveState(storage, state) {
  try {
    const safe = isObject(state) ? state : {};
    storage.setItem(STORAGE_KEY, JSON.stringify({ cart: quantities(safe.cart), orders: normalizeOrders(safe.orders) }));
    return true;
  } catch {
    return false;
  }
}

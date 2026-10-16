/* BURGER LAB for iPhone (PWA): menu, cart, local requests sent by SMS / WhatsApp to the restaurant number. */
import { addToCart, buildOrder, cartTotals, loadState, normalizePhone, saveState } from './model.js';

const main = document.getElementById('main');
const sheet = document.getElementById('sheet');
const sheetContent = document.getElementById('sheet-content');
const basketBar = document.getElementById('basket-bar');
const badge = document.getElementById('cart-badge');
const toastBox = document.getElementById('toast');
const notice = document.getElementById('notice');
const ROUTES = ['menu', 'cart', 'orders', 'about'];
const ILLUSTRATIONS = { sauce: '🥫', drink: '🥤', tea: '🍵', coffee: '☕' };
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const STANDALONE = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

const memoryStorage = (() => {
  const data = new Map();
  return { getItem: key => data.has(key) ? data.get(key) : null, setItem: (key, value) => data.set(key, String(value)) };
})();
const storage = (() => { try { return window.localStorage || memoryStorage; } catch { return memoryStorage; } })();

const state = {
  catalog: [], business: {}, cart: {}, orders: [], query: '', category: '',
  form: { name: '', phone: '', address: '', comment: '', delivery: false, consent: false }, formError: '', pendingSend: null,
};

/* ---------- helpers ---------- */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) {
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}
const rub = value => `${new Intl.NumberFormat('ru-RU').format(value)} ₽`;
const product = id => state.catalog.find(item => item.id === id);
const priced = item => Number.isSafeInteger(item.priceRubles) && item.priceRubles > 0;
const orderPhone = () => normalizePhone(state.business.orderPhone || '');
function displayPhone(phone) {
  const d = phone.replace(/\D/g, '');
  return d.length === 11 ? `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}` : phone;
}
function totals() {
  return cartTotals(state.catalog, state.cart, { ...state.business, delivery: state.form.delivery && deliveryEnabled() });
}
const deliveryEnabled = () => state.business.deliveryEnabled === true;
function persist() {
  if (!saveState(storage, { cart: state.cart, orders: state.orders })) toast('Не удалось сохранить на устройстве. Проверьте режим «Частный доступ».');
}
let toastTimer;
function toast(text) {
  toastBox.textContent = text;
  toastBox.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastBox.hidden = true; }, 2800);
}

/* ---------- menu photos: crops of the original menu pages ---------- */
const images = new Map();
function loadImage(src) {
  if (!images.has(src)) images.set(src, new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  }));
  return images.get(src);
}
function art(item, className) {
  const box = el('div', { class: className });
  const [path, rect] = String(item.art || '').split('#');
  if (!rect) {
    box.append(el('div', { class: 'food-illustration', 'aria-hidden': 'true', text: ILLUSTRATIONS[path] || '🍔' }));
    return box;
  }
  const [x, y, w, h] = rect.split(',').map(Number);
  const canvas = el('canvas', { role: 'img', 'aria-label': `Фото: ${item.name}` });
  box.append(canvas);
  requestAnimationFrame(() => loadImage(`./assets/${path}`).then(image => {
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    canvas.width = width;
    canvas.height = height;
    // Cover the box without distortion: centre-crop the menu rectangle to the box aspect.
    let sw = w, sh = h;
    if (w / h > width / height) sw = h * width / height; else sh = w * height / width;
    canvas.getContext('2d').drawImage(image, x + (w - sw) / 2, y + (h - sh) / 2, sw, sh, 0, 0, width, height);
  }).catch(() => {}));
  return box;
}

/* ---------- sheet ---------- */
function openSheet(title, ...content) {
  sheetContent.replaceChildren(
    el('div', { class: 'sheet-header' }, el('h2', { id: 'sheet-title', text: title }),
      el('button', { class: 'close-sheet', 'aria-label': 'Закрыть', onclick: () => sheet.close() }, icon('close'))),
    ...content);
  if (!sheet.open) sheet.showModal();
}
sheet.addEventListener('click', event => { if (event.target === sheet) sheet.close(); });

function showProduct(item) {
  const qty = state.cart[item.id] || 0;
  openSheet(item.name,
    art(item, 'detail-art'),
    item.badge ? el('span', { class: 'eyebrow', text: item.badge.toUpperCase() }) : null,
    el('p', { text: item.description }),
    item.weightGrams ? el('p', { class: 'small', text: `${item.weightGrams} г` }) : null,
    priced(item)
      ? el('button', { class: 'button primary mt-sm', onclick: () => { change(item.id, 1); sheet.close(); } },
        icon('plus'), qty ? `Ещё одну · ${rub(item.priceRubles)} (в корзине ${qty})` : `В корзину · ${rub(item.priceRubles)}`)
      : el('p', { class: 'form-error', text: 'Цена уточняется — позицию пока нельзя добавить в заявку.' }));
}

function showInstall() {
  openSheet('Установить на iPhone',
    el('p', { text: 'Приложение ставится прямо с сайта, без App Store. Значок появится на экране «Домой», меню будет открываться и без интернета.' }),
    el('ol', { class: 'install-steps' },
      el('li', {}, 'Откройте эту страницу в ', el('strong', { text: 'Safari' }), '.'),
      el('li', {}, 'Нажмите ', el('strong', { text: '«Поделиться»' }), ' (квадрат со стрелкой вверх).'),
      el('li', {}, 'Выберите ', el('strong', { text: '«На экран „Домой“»' }), '.'),
      el('li', {}, 'Если есть переключатель ', el('strong', { text: '«Открыть как веб-приложение»' }), ' — включите его.'),
      el('li', {}, 'Нажмите ', el('strong', { text: '«Добавить»' }), '.')),
    el('button', { class: 'button primary', onclick: () => sheet.close() }, 'Понятно'));
}

function smsLink(phone, text) {
  // iOS expects "&body=", Android "?body=".
  return `sms:${phone}${IOS ? '&' : '?'}body=${encodeURIComponent(text)}`;
}

function showSend(order) {
  const phone = orderPhone();
  const copy = el('textarea', { class: 'order-copy', readonly: true, 'aria-label': 'Текст заявки' });
  copy.value = order.text;
  const actions = [];
  if (phone) {
    actions.push(
      el('a', { class: 'button primary', href: smsLink(phone, order.text) }, icon('share'), 'Отправить по SMS'),
      el('a', { class: 'button', href: `https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(order.text)}`, target: '_blank', rel: 'noopener' },
        icon('share'), 'Отправить в WhatsApp'));
  }
  if (navigator.share) {
    actions.push(el('button', { class: 'button', onclick: async () => {
      try { await navigator.share({ title: `Заявка ${state.business.name || 'BURGER LAB'}`, text: order.text }); }
      catch (error) { if (error?.name !== 'AbortError') toast('Не удалось открыть «Поделиться». Скопируйте текст.'); }
    } }, icon('share'), phone ? 'Другое приложение…' : 'Отправить заявку…'));
  }
  actions.push(el('button', { class: 'button ghost', onclick: async () => {
    try { await navigator.clipboard.writeText(order.text); toast('Текст заявки скопирован.'); }
    catch { copy.focus(); copy.select(); toast('Выделите текст и скопируйте вручную.'); }
  } }, 'Скопировать текст'));
  openSheet(`Заявка № ${order.id}`,
    el('p', { text: phone
      ? `Отправьте заявку ресторану на номер ${displayPhone(phone)}. Заказ принят только после подтверждения сотрудником.`
      : 'Отправьте заявку ресторану через удобное приложение. Заказ принят только после подтверждения сотрудником.' }),
    el('div', { class: 'stack' }, actions),
    copy);
}

/* ---------- cart ---------- */
function change(id, delta) {
  state.cart = addToCart(state.catalog, state.cart, id, delta);
  persist();
  updateChrome();
  if (currentRoute() !== 'about') render();
}

function updateChrome() {
  const { count, total } = totals();
  badge.hidden = !count;
  badge.textContent = String(count);
  const showBar = count > 0 && currentRoute() === 'menu';
  basketBar.hidden = !showBar;
  document.body.classList.toggle('basket-visible', showBar);
  basketBar.replaceChildren(el('span', {}, icon('cart'), ` Корзина · ${count} шт.`), el('span', { text: rub(total) }));
  for (const link of document.querySelectorAll('.bottom-nav a')) {
    if (link.dataset.tab === currentRoute()) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}
basketBar.addEventListener('click', () => { location.hash = '#cart'; });

/* ---------- pages ---------- */
function menuPage() {
  const categories = [...new Set(state.catalog.map(item => item.category))];
  const search = el('input', { type: 'search', placeholder: 'Найти блюдо или ингредиент', 'aria-label': 'Поиск по меню', enterkeyhint: 'search' });
  search.value = state.query;
  search.addEventListener('input', () => { state.query = search.value; renderMenuList(); });
  const list = el('div');
  function renderMenuList() {
    const q = state.query.trim().toLowerCase();
    const items = state.catalog.filter(item => (!state.category || item.category === state.category)
      && (!q || `${item.name} ${item.description}`.toLowerCase().includes(q)));
    const groups = [...new Set(items.map(item => item.category))];
    list.replaceChildren(...(items.length ? groups.map(category => el('section', { class: 'mt' },
      el('div', { class: 'section-top' }, el('h2', { text: category }), el('span', { text: `${items.filter(i => i.category === category).length} поз.` })),
      el('div', { class: 'menu-grid' }, items.filter(i => i.category === category).map(card))))
      : [el('div', { class: 'empty' }, icon('search'), el('h2', { text: 'Ничего не найдено' }), el('p', { text: 'Попробуйте другое слово или категорию.' }))]));
  }
  renderMenuList();
  return [
    el('section', { class: 'hero' }, el('span', { class: 'eyebrow', text: state.business.tagline || 'TASTE IS SCIENCE' }),
      el('h1', { text: 'Ваша формула вкуса' }),
      el('p', { text: 'Выберите блюда, оформите заявку и отправьте её ресторану в пару касаний.' })),
    STANDALONE ? null : el('button', { class: 'install-shortcut', onclick: showInstall },
      el('span', { text: 'Установить на экран «Домой» iPhone' }), icon('arrow')),
    el('label', { class: 'search' }, icon('search'), search),
    el('div', { class: 'categories', role: 'toolbar', 'aria-label': 'Категории' },
      ['', ...categories].map(category => el('button', {
        class: 'chip', 'aria-pressed': String(state.category === category),
        onclick: () => { state.category = category; render(); },
      }, category || 'Все'))),
    list,
    state.business.menuNote ? el('p', { class: 'footnote', text: state.business.menuNote }) : null,
  ];
}

function card(item) {
  const qty = state.cart[item.id] || 0;
  const open = () => showProduct(item);
  return el('article', { class: 'product' },
    el('button', { class: 'product-art', 'aria-label': `Подробнее: ${item.name}`, onclick: open }, art(item, 'product-art-inner')),
    el('div', {},
      el('span', { class: 'eyebrow', text: (item.badge || item.category).toUpperCase() }),
      el('button', { class: 'product-name', onclick: open, text: item.name }),
      el('p', { class: 'description', text: item.description }),
      item.weightGrams ? el('div', { class: 'product-size', text: `${item.weightGrams} г` }) : null,
      priced(item)
        ? el('button', { class: `add-product${qty ? ' has-quantity' : ''}`, onclick: () => change(item.id, 1),
          'aria-label': `Добавить ${item.name} в корзину` },
          el('span', { text: qty ? `В корзине ${qty} · ${rub(item.priceRubles)}` : rub(item.priceRubles) }), icon('plus'))
        : el('button', { class: 'add-product', disabled: true }, el('span', { text: 'Цена уточняется' }))));
}

function field(label, key, attrs = {}, wide = false) {
  const input = el(attrs.multiline ? 'textarea' : 'input', { ...attrs, multiline: undefined });
  input.value = state.form[key];
  input.addEventListener('input', () => { state.form[key] = input.value; });
  return el('label', { class: `field${wide ? ' wide' : ''}` }, label, input);
}

function cartPage() {
  const lines = Object.entries(state.cart).map(([id, quantity]) => [product(id), quantity]).filter(([item]) => item);
  if (!lines.length) {
    return [el('div', { class: 'empty' }, icon('cart'), el('h2', { text: 'Корзина пуста' }),
      el('p', { text: 'Добавьте бургеры, пиццу или напитки из меню.' }),
      el('a', { class: 'button primary', href: '#menu' }, 'Открыть меню'))];
  }
  const sum = totals();
  const delivery = deliveryEnabled();
  const phone = orderPhone();
  const consent = el('input', { type: 'checkbox' });
  consent.checked = state.form.consent;
  consent.addEventListener('change', () => { state.form.consent = consent.checked; });
  return [el('div', { class: 'cart-wrap' },
    el('h1', { text: 'Корзина' }),
    el('div', { class: 'stack' }, lines.map(([item, quantity]) => el('div', { class: 'cart-line' },
      el('div', { class: 'cart-line-top' }, el('h3', { text: item.name }), el('span', { class: 'price', text: rub(item.priceRubles * quantity) })),
      el('div', { class: 'cart-line-bottom' }, el('small', { text: `${rub(item.priceRubles)} за шт.` }),
        el('div', { class: 'stepper' },
          el('button', { 'aria-label': `Убрать одну: ${item.name}`, onclick: () => change(item.id, -1) }, '−'),
          el('span', { text: String(quantity) }),
          el('button', { 'aria-label': `Добавить одну: ${item.name}`, onclick: () => change(item.id, 1), disabled: quantity >= 99 }, '+')))))),
    el('div', { class: 'totals' },
      el('div', { class: 'total-line' }, el('span', { text: 'Блюда' }), el('span', { text: rub(sum.subtotal) })),
      delivery && state.form.delivery ? el('div', { class: 'total-line' }, el('span', { text: 'Доставка' }), el('span', { text: rub(sum.deliveryFee) })) : null,
      el('div', { class: 'total-line grand' }, el('span', { text: 'Итого' }), el('strong', { text: rub(sum.total) }))),
    el('section', { class: 'form-section' }, el('h2', { text: 'Получение' }),
      delivery
        ? el('div', { class: 'mode-switch' }, [['Самовывоз', false], ['Доставка', true]].map(([label, value]) =>
          el('button', { class: `button${state.form.delivery === value ? ' primary' : ''}`, 'aria-pressed': String(state.form.delivery === value),
            onclick: () => { state.form.delivery = value; render(); } }, label)))
        : el('p', { text: `Самовывоз${state.business.address ? ` · ${state.business.address}` : ''}. Доставка пока недоступна.` }),
      delivery ? el('p', { class: 'mt-sm', text: state.form.delivery
        ? `Доставка ${state.business.deliveryArea || ''} — ${rub(state.business.deliveryFeeRubles || 0)}.`.replace('  ', ' ')
        : `Самовывоз${state.business.address ? `: ${state.business.address}` : ''}.` }) : null),
    el('section', { class: 'form-section' }, el('h2', { text: 'Контакты' }),
      el('div', { class: 'form-fields' },
        field('Имя', 'name', { autocomplete: 'name', maxlength: '80' }),
        field('Телефон', 'phone', { type: 'tel', inputmode: 'tel', autocomplete: 'tel', placeholder: '+7 900 000-00-00' }),
        delivery && state.form.delivery ? field('Адрес доставки', 'address', { autocomplete: 'street-address', maxlength: '240' }, true) : null,
        field('Комментарий к заказу', 'comment', { multiline: true, maxlength: '500', placeholder: 'Например: без лука' }, true))),
    el('label', { class: 'consent' }, consent,
      el('span', { text: `Согласен(на) передать имя и телефон ресторану вместе с заявкой${phone ? ` на номер ${displayPhone(phone)}` : ''}.` })),
    state.formError ? el('div', { class: 'form-error', role: 'alert', text: state.formError }) : null,
    el('button', { class: 'button primary', onclick: submit }, icon('check'), `Оформить заявку · ${rub(sum.total)}`),
    el('p', { class: 'footnote', text: 'Заявка сохраняется на телефоне, затем вы отправляете её ресторану по SMS или в WhatsApp. Оплата — при получении.' }))];
}

function submit() {
  try {
    const stamp = Date.now().toString(36).toUpperCase().slice(-6);
    const order = buildOrder(state.catalog, state.cart, { ...state.form, delivery: state.form.delivery && deliveryEnabled() },
      state.business, { id: `BL-${stamp}` });
    state.orders = [order, ...state.orders].slice(0, 30);
    state.cart = {};
    state.formError = '';
    state.form.comment = '';
    persist();
    // The send sheet opens after the route change, which closes any open sheet.
    state.pendingSend = order;
    if (currentRoute() === 'orders') window.dispatchEvent(new HashChangeEvent('hashchange'));
    else location.hash = '#orders';
  } catch (error) {
    state.formError = error.message;
    render();
    main.querySelector('.form-error')?.scrollIntoView({ block: 'center' });
  }
}

function ordersPage() {
  if (!state.orders.length) {
    return [el('div', { class: 'empty' }, icon('orders'), el('h2', { text: 'Заявок пока нет' }),
      el('p', { text: 'Оформленные заявки сохраняются здесь: их можно отправить ещё раз или повторить.' }),
      el('a', { class: 'button primary', href: '#menu' }, 'Выбрать блюда'))];
  }
  return [el('div', { class: 'orders-wrap' },
    el('h1', { text: 'Заявки' }),
    el('div', { class: 'stack' }, state.orders.map(order => el('article', { class: 'order-card' },
      el('h2', { text: `№ ${order.id}` }),
      el('div', { class: 'order-meta', text: order.date }),
      el('span', { class: 'order-status', text: 'СОХРАНЕНА НА ТЕЛЕФОНЕ · ЖДЁТ ПОДТВЕРЖДЕНИЯ' }),
      el('p', { class: 'order-items' }, order.items.map((item, index) => [index ? el('br') : null, `${item.name} × ${item.quantity}`])),
      el('div', { class: 'total-line grand' }, el('span', { text: 'Итого' }), el('strong', { text: rub(order.total) })),
      el('div', { class: 'stack mt-sm' },
        el('button', { class: 'button primary', onclick: () => showSend(order) }, icon('share'), 'Отправить ресторану'),
        el('button', { class: 'button', onclick: () => repeat(order) }, 'Повторить заказ'))))),
    el('button', { class: 'button ghost danger mt', onclick: () => {
      if (confirm('Удалить историю заявок с этого телефона? Имена и телефоны в заявках тоже будут удалены.')) {
        state.orders = [];
        persist();
        render();
      }
    } }, 'Удалить историю'))];
}

function repeat(order) {
  if (Object.keys(state.cart).length && !confirm('Заменить текущую корзину блюдами из заявки?')) return;
  let cart = {};
  for (const item of order.items) cart = addToCart(state.catalog, cart, item.id, item.quantity);
  state.cart = cart;
  persist();
  location.hash = '#cart';
  toast('Корзина обновлена. Используются текущие цены меню.');
}

function aboutPage() {
  const b = state.business;
  const phone = orderPhone();
  return [el('div', { class: 'about-wrap' },
    el('span', { class: 'eyebrow', text: b.tagline || 'TASTE IS SCIENCE' }),
    el('h1', { text: `Это ${b.name || 'BURGER LAB'}` }),
    b.logo ? el('img', { class: 'about-logo', src: `./assets/${b.logo}`, alt: `Логотип ${b.name || 'BURGER LAB'}` }) : null,
    el('p', { class: 'about-intro', text: 'Место, где вкус превращается в формулу. Выбирайте блюда из нашего меню и заглядывайте в гости.' }),
    el('div', { class: 'stack mt' },
      phone ? el('div', { class: 'info-card' }, el('span', { class: 'eyebrow', text: 'ЗАЯВКИ ПРИНИМАЕМ' }),
        el('h3', { class: 'mt-sm', text: displayPhone(phone) }), el('p', { text: 'По SMS или в WhatsApp.' }),
        el('a', { class: 'button', href: `tel:${phone}` }, 'Позвонить')) : null,
      b.address ? el('div', { class: 'info-card' }, el('span', { class: 'eyebrow', text: 'АДРЕС' }), el('h3', { class: 'mt-sm', text: b.address })) : null,
      b.hours ? el('div', { class: 'info-card' }, el('span', { class: 'eyebrow', text: 'РЕЖИМ РАБОТЫ' }), el('h3', { class: 'mt-sm', text: b.hours })) : null),
    Array.isArray(b.gallery) && b.gallery.length ? [el('h2', { class: 'mt', text: 'Наша атмосфера' }),
      el('div', { class: 'gallery' }, b.gallery.map(src => el('img', { src: `./assets/${src}`, alt: 'Фотография BURGER LAB', loading: 'lazy' })))] : null,
    el('h2', { class: 'mt', text: 'О ваших данных' }),
    el('p', { text: 'Корзина и последние 30 заявок хранятся только на этом телефоне. Автоматической отправки нет: заявка уходит, только когда вы отправите её по SMS или в WhatsApp. Историю можно удалить на вкладке «Заявки».' }),
    STANDALONE ? null : el('button', { class: 'button mt', onclick: showInstall }, 'Установить на iPhone'),
    el('p', { class: 'footnote', text: `${b.name || 'BURGER LAB'} · веб-приложение 1.0` }))];
}

/* ---------- routing ---------- */
function currentRoute() {
  const route = location.hash.slice(1);
  return ROUTES.includes(route) ? route : 'menu';
}
let lastRoute = '';
function render() {
  const route = currentRoute();
  const pages = { menu: menuPage, cart: cartPage, orders: ordersPage, about: aboutPage };
  const scroll = route === lastRoute ? window.scrollY : 0;
  main.replaceChildren(...pages[route]().flat().filter(Boolean));
  updateChrome();
  window.scrollTo(0, scroll);
  lastRoute = route;
}
window.addEventListener('hashchange', () => {
  state.formError = '';
  if (sheet.open) sheet.close();
  render();
  if (state.pendingSend) {
    showSend(state.pendingSend);
    state.pendingSend = null;
  }
});
document.getElementById('brand-button').addEventListener('click', () => { location.hash = '#about'; });
document.addEventListener('focusin', event => {
  if (event.target.matches('input:not([type=checkbox]), textarea')) document.body.classList.add('keyboard-open');
});
document.addEventListener('focusout', () => document.body.classList.remove('keyboard-open'));
function connectivity() {
  notice.hidden = navigator.onLine;
  notice.className = 'notice warning';
  notice.textContent = 'Нет сети: меню доступно, отправить заявку можно, когда связь появится.';
}
window.addEventListener('online', connectivity);
window.addEventListener('offline', connectivity);

async function start() {
  try {
    const [menu, business] = await Promise.all(['menu', 'business'].map(name =>
      fetch(`./assets/${name}.json`).then(response => {
        if (!response.ok) throw new Error(`${name}.json: ${response.status}`);
        return response.json();
      })));
    state.catalog = Array.isArray(menu) ? menu : [];
    state.business = business && typeof business === 'object' ? business : {};
    Object.assign(state, loadState(storage, state.catalog));
    connectivity();
    render();
  } catch {
    main.replaceChildren(el('div', { class: 'empty' }, el('h2', { text: 'Меню не загрузилось' }),
      el('p', { text: 'Проверьте интернет и откройте приложение ещё раз.' }),
      el('button', { class: 'button primary', onclick: () => location.reload() }, 'Повторить')));
  }
}

if ('serviceWorker' in navigator && window.isSecureContext) {
  // The first install claims the page too; reload only when an older version was in control.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || !hadController) return;
    reloaded = true;
    if (currentRoute() === 'cart') toast('Загружена новая версия — она откроется при следующем запуске.');
    else location.reload();
  });
  navigator.serviceWorker.register('./sw.js').then(registration => {
    const activate = worker => worker && navigator.serviceWorker.controller && worker.postMessage({ type: 'SKIP_WAITING' });
    activate(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => { if (worker.state === 'installed') activate(worker); });
    });
  }).catch(() => {});
}
start();

/**
 * Посредник между приложением «Товары» и Prom.ua.
 *
 * Зачем он нужен: браузер не может обращаться к Prom напрямую, а токены
 * нельзя класть в страницу — её видит любой. Поэтому токены живут здесь,
 * в секретах Cloudflare, и наружу никогда не выходят.
 *
 * Настраивается один раз (см. sync/README-worker.md):
 *   Секреты: APP_PASSWORD, TOKEN_BLACKSTREET, TOKEN_BONNA, TOKEN_CORE22
 *
 * Что умеет:
 *   POST /list  { store, limit, last_id }         -> список товаров
 *   POST /edit  { store, products: [...] }        -> правка товаров
 *   POST /ping  {}                                -> проверка связи
 *
 * В каждом запросе обязателен заголовок  X-App-Password.
 */

const PROM_API = "https://my.prom.ua/api/v1";

/* ---- Стандартный промпт генерации названий и ключевых (Street Code) ---- */
/* Полный рабочий промпт пользователя (дословно). Возвращает СТРОГО JSON:
   { title_ua, title_ru, keywords_ru, keywords_ua }. Описание НЕ генерирует. */
const DEFAULT_GENTEXT_SYS = `ТЫ — ПРОФЕССИОНАЛЬНЫЙ SEO-СПЕЦИАЛИСТ ИНТЕРНЕТ-МАГАЗИНА

Твоя задача — создавать качественные SEO-названия и поисковые запросы для товаров интернет-магазина, размещаемых на Prom.ua и Google Shopping. Основная категория — одежда, обувь и аксессуары. Украинский рынок e-commerce.

ГЛАВНАЯ ЦЕЛЬ: подбирать релевантные названия и поисковые фразы, по которым покупатели реально ищут товар. Не просто много словосочетаний — а релевантные.

ВХОДНЫЕ ДАННЫЕ: фото товара, название/модель, описание, характеристики (часть может отсутствовать). Особое внимание: бренд, точная модель, тип товара, пол, цвет, сезон, материал, утепление, конструкция, особенности, назначение. По фото определяй вид/цвет/конструкцию (капюшон, молния, шнуровка), но НЕ состав ткани, мембрану, скрытое утепление, подлинность. При противоречиях приоритет — явным характеристикам; уточнение пользователя важнее.

НАЗВАНИЕ: создавай название на ДВУХ языках — украинском (title_ua) и русском (title_ru). ВАЖНО: НЕ копируй исходное название дословно — создай НОВОЕ, иначе сформулированное (другой порядок слов, добавь/замени одну значимую характеристику: материал, сезон, особенность), сохраняя точный смысл, бренд, модель и цвет. Название должно заметно отличаться от исходного, но оставаться грамотным и естественным. Структура: Пол + тип товара + бренд + модель + цвет + важная характеристика (порядок можно менять). Правила: без запятых; грамотно и естественно; без рекламных слов (топ/хит/лучший/скидка/оригинал); указывай пол, если известен; учитывай точную модель; правильная категория; не перегружай; не выдумывай. Бренд/модель — только при подтверждении, не утверждай «оригинал». Русское название — грамотная адаптация (не транслит), латинские бренды/модели без изменений. Примеры (укр): «Чоловічі зимові термокросівки Salomon XT-6 Gore-Tex Black Silver чорні зі сріблястими вставками»; «Жіночі кросівки Salomon XT-6 Lab White Rose білі з рожевими вставками»; «Чоловічий спортивний костюм Polo Ralph Lauren сірий з капюшоном на блискавці». Примеры (рус): «Мужские зимние термокроссовки Salomon XT-6 Gore-Tex Black Silver чёрные с серебристыми вставками»; «Женские кроссовки Salomon XT-6 Lab White Rose белые с розовыми вставками».

КЛЮЧЕВЫЕ ЗАПРОСЫ: создавай ДВА отдельных списка — русский (keywords_ru) и украинский (keywords_ua). КАЖДЫЙ список — максимум 1000 символов. 1000 — лимит для КАЖДОГО языка отдельно, не суммируй. Считай ВСЕ символы (буквы, цифры, пробелы, дефисы, переносы строк). ЖЕЛАТЕЛЬНЫЙ РАЗМЕР КАЖДОГО СПИСКА — 900–980 СИМВОЛОВ. Никогда не превышай 1000. Это примерно 40–55 запросов на каждый язык. НЕ останавливайся на 10–20 запросах — это ошибка, список должен быть заполнен до 900–980 символов. Если реально невозможно подобрать столько качественных — используй меньше, но не добавляй нерелевантное ради объёма.

ДЛИНА ЗАПРОСОВ: ~60% короткие (Кросівки Salomon, Salomon XT-6, Худи Armani), ~35% средние (Жіночі кросівки Salomon, Salomon XT-6 чорні), ~5% длинные. Длинные — крайне редко, не заполняй ими список.

БРЕНД В КАЖДОМ ЗАПРОСЕ (или узнаваемый вариант написания: Salomon/Саломон/Соломон, Nike/Найк, Polo Ralph Lauren/Polo/Поло, Armani Exchange/Armani/Армани). НЕ добавляй общие запросы без бренда при известном бренде (неправильно: «Мужские зимние кроссовки»; правильно: «Мужские зимние кроссовки Salomon»). Если бренд не подтверждён — допускаются ключи без бренда, но не выдумывай бренд.

ПОВЕДЕНИЕ ПОКУПАТЕЛЯ: учитывай сокращения и варианты написания (Salomon XT6 / XT-6, Саломон кроссовки, Salomon GTX, Salomon Gore Tex). Приоритет: бренд → тип → модель → пол → сезон → цвет → особенности. Не выдавай предположения за статистику.

ЦВЕТ: только реальный (чорний/сірий/синій/бежевий/білий/коричневий; комбинированные — чорно-сріблястий, біло-рожевий). Не добавляй отсутствующих цветов. Официальную расцветку модели (Black Silver) не меняй без подтверждения.

СЕЗОН: учитывай сезон и утепление. Зимние/термо/на меху — только если подтверждено (мех — только если есть; Gore-Tex сам по себе не доказывает зимнего утепления; термоподкладка не гарантирует сильный мороз). Демисезон/весна/осень — по характеристикам. Не мешай летние ключи к зимней обуви и наоборот.

ОСОБЕННОСТИ — только подтверждённые (обувь: Gore-Tex, GTX, термоподкладка, мех, высокая посадка, быстрая шнуровка, рельефная подошва, водоотталкивающий материал; одежда: капюшон, молния, флис, двунитка, трёхнитка, утепление, вышивка, манжеты). Не путай ветровку/пуховик, кроссовки/ботинки, Gore-Tex/обычный текстиль.

ЗАПРЕЩЕНО: превышать 1000 символов; много длинных запросов; ключи без бренда при известном бренде; нерелевантные категории; неподтверждённые характеристики; неграмотные фразы; повторы; бессмысленные перестановки; Турция/Вьетнам/Китай как ключи; выдуманные бренды/модели; менять пол без основания; несуществующие цвета; мех/Gore-Tex/оригинал без подтверждения; выдуманная статистика.

КАЧЕСТВО рус/укр (Мужские→Чоловічі, Женские→Жіночі, Зимние→Зимові, на меху→на хутрі, на молнии→на блискавці, с капюшоном→з капюшоном, на флисе→на флісі, Чёрные→Чорні, Серые→Сірі, Бежевые→Бежеві). Латинские названия брендов/моделей сохраняй без изменений. Каждый запрос на отдельной строке, без кавычек и без нумерации.

ПРОВЕРКА ПЕРЕД ОТВЕТОМ: название на двух языках без запятых, правильные категория/пол/цвет/модель; все запросы релевантны; большинство короткие/средние; нет повторов; нет неподтверждённого; русский список ≤1000; украинский ≤1000; целевой диапазон 900–980 символов каждый.

ФОРМАТ ОТВЕТА: возвращай ТОЛЬКО JSON, без Markdown, без пояснений, строго такой структуры:
{
  "title_ua": "Назва товару українською",
  "title_ru": "Название товара на русском",
  "keywords_ru": "Русский запрос 1\\nРусский запрос 2\\nРусский запрос 3",
  "keywords_ua": "Український запит 1\\nУкраїнський запит 2\\nУкраїнський запит 3"
}
Внутри keywords_ru и keywords_ua каждый запрос отделяется переносом строки (\\n). Все четыре поля обязательны.

ЖЁСТКОЕ ТРЕБОВАНИЕ ПО ОБЪЁМУ (обязательно): в keywords_ru НЕ МЕНЕЕ 40 запросов (цель 45–55), в keywords_ua НЕ МЕНЕЕ 40 запросов (цель 45–55). Каждый список — 900–980 символов (но не больше 1000). Если в данных товара переданы «Існуючі ключові» — возьми их за основу, сохрани лучшие и ДОБАВЬ новые варианты (другие написания бренда, сокращения модели, пол, цвет, сезон, особенности), чтобы достичь нужного объёма. Список из 10–20 запросов — это ОШИБКА: продолжай добавлять релевантные запросы с брендом, пока не наберёшь ≥40 и ~900–980 символов. Перед ответом сам проверь количество и длину каждого списка.

Приоритет: РЕЛЕВАНТНОСТЬ → КОРОТКИЕ ЗАПРОСЫ → БРЕНД → ТОЧНАЯ МОДЕЛЬ → ОБЪЁМ 40+/900–980 → ЛИМИТ 1000.`;

/* ---- Стандартный промпт генерации ОПИСАНИЯ (Street Code) -------------- */
/* Рабочий промпт пользователя. На выходе — JSON { desc_ua, desc_ru } (HTML для Prom). */
const DEFAULT_GENDESC_SYS = `Ты — профессиональный SEO-копирайтер интернет-магазина одежды и обуви в Украине. Твоя задача — создавать грамотные, привлекательные и SEO-оптимизированные описания товаров для Prom.ua, Google Shopping и органической выдачи Google.

Я отправляю: фото товара, иногда название модели, характеристики поставщика, иногда фото размерной сетки. Анализируй сам и сразу выдавай готовое описание.

ЯЗЫКИ: всегда два полноценных описания — украинский и русский. Перевод грамотный, естественный, без смешения языков. Терминология: кросівки/кроссовки, черевики/ботинки, блискавка/молния, кишені/карманы, підкладка/подкладка, підошва/подошва, бавовна/хлопок, двонитка/двунитка, тринитка/трехнитка, плащівка/плащевка, водовідштовхувальний/водоотталкивающий, утеплення/утепление.

SEO: приоритет Google Shopping и органика, затем Prom. Первые 1–2 предложения содержат основные ключи и идут БЕЗ эмодзи. Важны: категория, материал, сезон, пол, цвет, конструкция, утепление, особенности. Без неестественного повтора ключей и без характеристик ради SEO.

ЗАПРЕЩЕНО в тексте: названия брендов, слова логотип/бирки/фирменный/брендированный/оригинал/реплика/копия/аналог/люкс/премиум/топ качество/качество 1:1. Бренд из данных используй только для понимания модели, в тексте его НЕ повторяй. «Логотип: вышивка» → «Декоративний елемент: вишивка» / «Декоративный элемент: вышивка». «Фирменная фурнитура» → «Фурнітура»/«Фурнитура». Не упоминай сертификаты подлинности, коды проверки, оригинальные этикетки. Не выдавай неоригинальный товар за оригинальный.

ФОТО: определяй цвет, конструкцию, высоту обуви, форму подошвы, капюшон, карманы, застёжку, манжеты, шнуровку, декор. НЕ определяй по фото состав ткани, натуральность кожи/замши, температурный режим, водонепроницаемость, страну, мембрану, состав утеплителя — это только из данных поставщика.

ОБУВЬ: учитывай пол, цвет, материал верха, подкладку, утепление, сезон, подошву, протектор, шнуровку, водоотталкивающие свойства, размеры, страну. Термоподкладку обязательно отражай. Не называй обувь зимней без подтверждения. Различай «Водовідштовхувальний текстиль» и «Водонепроникна мембрана» — не называй текстиль водонепроницаемым. Подошва из пены и резины → «Підошва: піна та гума». Выраженный протектор → «Протектор: рельєфний, для кращого зчеплення з поверхнею». Не обещай абсолютную защиту от скольжения. Не придумывай температурные пределы.

РАЗМЕРНАЯ СЕТКА: если дана фотография сетки — обязательно перепиши текстом на обоих языках, точно сохраняя соответствие размеров и сантиметров, без округления и без выдуманных значений. Формат «Розмірна сітка:» / «Размерная сетка:» со строками «40 — 25 см». Если сетки нет — не выдумывай её.

ОДЕЖДА: учитывай пол, категорию, сезон, материал, состав, утепление, капюшон, карманы, застёжку, манжеты, размеры, страну, декор. «95% хлопок, 5% эластан» → «95% бавовна, 5% еластан». «Турецкая двухнитка» → «Турецька двонитка». «Трехнитка флис» → «Турецька тринитка на флісі». Съёмный капюшон → «Капюшон: відстібний»/«съёмный». Маломерит на полразмера → «Посадка: маломірить приблизно на пів розміру». Полномерная → «Посадка: повнорозмірна». Не придумывай посадку.

ХАРАКТЕРИСТИКИ: после короткого вступления — блок характеристик (Матеріал, Склад тканини, Підкладка, Підошва, Шнурівка, Особливості, Сезон, Виробництво, Розміри, Підбір розміру — только то, что известно). НЕ добавляй отдельные пункты «Тип» и «Колір» — это в название и первые предложения. Не дублируй. Если характеристика неизвестна — пропускай.

РАЗМЕРЫ: сохраняй данный диапазон (S,M,L,XL,XXL; большие 3XL–7XL — отдельно). Если помогаем подобрать — «Підбір розміру: допоможемо підібрати оптимальний розмір» / «Подбор размера: поможем подобрать оптимальный размер».

СТРАНА: только достоверно. Турция→Туреччина, Вьетнам→В'єтнам. При противоречии и неустановленном происхождении — не указывай.

СТИЛЬ: грамотно, естественно, информативно, без воды и преувеличений. Избегай «лучший/идеальное/супер качество/100% защита». Объясняй реальные преимущества. Вступление 1–2 предложения. Заключительный абзац после характеристик/сетки — с естественными SEO-фразами и назначением товара, не повторяя вступление дословно.

Не добавляй цены, артикулы поставщика, дропшиппинг, упаковку, сертификаты. Не объясняй, как создавал. Не используй эмодзи в тексте описания.

ФОРМАТ ОТВЕТА (СТРОГО): верни ТОЛЬКО JSON без пояснений и без Markdown:
{"desc_ua":"...","desc_ru":"..."}
Каждое поле — тело описания в ПРОСТОМ HTML для Prom.ua (НЕ включай SEO-заголовок/название товара отдельной строкой): первые 1–2 предложения в <p>…</p>; затем <p><strong>Характеристики:</strong></p><ul><li><strong>Матеріал:</strong> …</li>…</ul>; если есть размерная сетка — <p><strong>Розмірна сітка:</strong></p><ul><li>40 — 25 см</li>…</ul>; в конце заключительный абзац <p>…</p>. desc_ua — украинский, desc_ru — русский. Без эмодзи, без Markdown-звёздочек, только HTML-теги.`;

/* ---- Индекс для колл-центра (KV) ------------------------------------- */
// Число «полок» (шардов), на которые раскладывается индекс товаров.
// ДОЛЖНО совпадать с таким же числом в приложении публикации (apps/publish).
const SHARDS = 64;
// Приводим артикул к единому виду: верхний регистр, без лишних пробелов.
function normArt(a) {
  return String(a == null ? "" : a).toUpperCase().replace(/\s+/g, " ").trim();
}
// По артикулу вычисляем номер полки (одинаково в воркере и в публикации).
function shardOf(a) {
  const s = normArt(a);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % SHARDS;
}

// Стабильный ключ для доп. полей товара (заметки/сетка).
// Привязан к внутреннему id товара на Prom — он НЕ меняется при смене артикула.
// Если id нет (напр. товар только на Хорошопе) — по артикулу.
// Формула должна совпадать с такой же в search-index.html.
function extraKeyOf(product) {
  if (product && product.detail && product.detail.id) {
    return "pid:" + product.detail.store + ":" + product.detail.id;
  }
  return "art:" + (product ? product.base : "");
}

// Какие магазины известны. Prom — по токену, Хорошоп — по логину и паролю.
const STORES = {
  blackstreet: { type: "prom", token: "TOKEN_BLACKSTREET" },
  bonna:       { type: "prom", token: "TOKEN_BONNA" },
  core22:      { type: "prom", token: "TOKEN_CORE22" },
  streetcode:  { type: "prom", token: "TOKEN_STREETCODE" },
  blink:       { type: "horoshop", domain: "HOROSHOP_DOMAIN",
                 login: "HOROSHOP_LOGIN", password: "HOROSHOP_PASSWORD" },
};

/* ---- Хорошоп: получить токен по логину и паролю ---------------------- */
async function horoshopToken(env, cfg) {
  const domain = String(env[cfg.domain] || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!domain) throw new Error("Не задан секрет " + cfg.domain);

  const r = await fetch(`https://${domain}/api/auth/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: env[cfg.login], password: env[cfg.password] }),
  });
  const text = await r.text();
  let data = {};
  try { data = JSON.parse(text); } catch (e) { data = { raw: text.slice(0, 300) }; }

  const token = data.response && (data.response.token || data.response.access_token);
  if (!token) {
    const L = env[cfg.login], P = env[cfg.password];
    const hint = " · домен=" + domain +
      " · логин=" + (L ? ("задан(" + String(L).length + ")") : "ПУСТ") +
      " · пароль=" + (P ? ("задан(" + String(P).length + ")") : "ПУСТ");
    throw new Error("Хорошоп не дал токен: " + JSON.stringify(data).slice(0, 300) + hint);
  }
  return { domain: domain, token: token };
}

/* ---- Хорошоп: запрос к API ------------------------------------------- */
async function horoshopCall(auth, method, payload) {
  const r = await fetch(`https://${auth.domain}/api/${method}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.assign({ token: auth.token }, payload || {})),
  });
  const text = await r.text();
  let data = {};
  try { data = JSON.parse(text); } catch (e) { data = { raw: text.slice(0, 400) }; }
  return { ok: r.ok, status: r.status, data: data };
}

// Вызов OpenAI Chat с JSON-ответом. Надёжно: если с картинкой пришла ошибка
// (часто 400 — OpenAI не смог скачать фото), повторяем запрос БЕЗ картинки.
async function openaiChatJson(apiKey, model, sys, userText, img) {
  async function once(withImg) {
    const content = [{ type: "text", text: userText }];
    if (withImg && img && /^https?:\/\//i.test(img)) content.push({ type: "image_url", image_url: { url: img } });
    const oa = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model,
        messages: [{ role: "system", content: sys }, { role: "user", content: content }],
        response_format: { type: "json_object" },
        temperature: 0.7,
        max_tokens: 4000,
      }),
    });
    const t = await oa.text();
    let od = {};
    try { od = JSON.parse(t); } catch (e) { od = { raw: t.slice(0, 500) }; }
    return { httpOk: oa.ok, status: oa.status, od: od };
  }
  const hasImg = !!(img && /^https?:\/\//i.test(img));
  let r = await once(hasImg);
  // ошибка + была картинка -> пробуем без неё (и на картинку часто 400)
  if (!r.httpOk && hasImg) r = await once(false);
  if (!r.httpOk) return { ok: false, status: r.status, detail: r.od };
  const msg = r.od.choices && r.od.choices[0] && r.od.choices[0].message && r.od.choices[0].message.content;
  let data = {};
  try { data = JSON.parse(msg); } catch (e) { return { ok: false, status: 502, detail: { error: "не JSON", raw: String(msg || "").slice(0, 500) } }; }
  return { ok: true, data: data };
}

export default {
  async fetch(request, env) {
    // Разрешаем браузеру обращаться к нам (CORS)
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-App-Password",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    // --- ПУБЛИЧНО: отдаём страницу поиска БЕЗ кэша (всегда свежая версия) ---
    // Берём актуальный файл с GitHub Pages (с обходом его кэша) и возвращаем
    // с запретом кэширования — обычного обновления хватает, жёсткое не нужно.
    if (request.method === "GET") {
      const gp = new URL(request.url);
      const gpath = gp.pathname.replace(/\/+$/, "") || "/";
      if (gpath === "/" || gpath === "/app" || gpath === "/search" || gpath === "/poshuk") {
        try {
          const src = "https://jekapozitiven.github.io/tovary-clean/apps/search/index.html?_=" + Date.now();
          const r = await fetch(src, { cf: { cacheTtl: 0, cacheEverything: false } });
          const html = await r.text();
          return new Response(html, {
            status: r.ok ? 200 : 502,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
              "Pragma": "no-cache",
            },
          });
        } catch (e) {
          return new Response("Не вдалося завантажити сторінку пошуку", { status: 502 });
        }
      }
    }

    // --- ПУБЛИЧНО: прокси картинок с CORS (для сверки товаров по фото) -----
    // Браузер не может прочитать пиксели чужого магазина напрямую (CORS),
    // поэтому картинку отдаём через воркер с разрешающим заголовком.
    {
      const u0 = new URL(request.url);
      if ((u0.pathname.replace(/\/+$/, "") || "/") === "/img") {
        const target = u0.searchParams.get("u") || "";
        if (!/^https?:\/\//i.test(target)) return new Response("bad url", { status: 400, headers: cors });
        try {
          const ir = await fetch(target, { cf: { cacheTtl: 86400, cacheEverything: true } });
          const ct = ir.headers.get("content-type") || "";
          if (!ir.ok || ct.indexOf("image/") !== 0) return new Response("not image", { status: 415, headers: cors });
          return new Response(ir.body, {
            status: 200,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Content-Type": ct,
              "Cache-Control": "public, max-age=86400",
            },
          });
        } catch (e) {
          return new Response("fetch error", { status: 502, headers: cors });
        }
      }
    }

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
      });

    if (request.method !== "POST") {
      return json({ error: "Только POST" }, 405);
    }

    const url = new URL(request.url);
    const route = url.pathname.replace(/\/+$/, "") || "/";

    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    // --- ПУБЛИЧНЫЙ поиск для колл-центра (без пароля) ----------------------
    // Отдаёт только витринную информацию из индекса (название, фото, описание,
    // цена, наличие) — то же, что видно на сайте. Токены здесь не участвуют.
    if (route === "/lookup") {
      if (!env.INDEX) return json({ error: "Хранилище индекса не подключено (нет привязки INDEX)" }, 500);
      let product = null;
      // 1) прямой ключ карточки (из списка по названию — открывает именно тот товар)
      const directKey = String(body.key || "");
      if (directKey) {
        const idxD = (await env.INDEX.get("idx:" + shardOf(directKey), "json")) || {};
        if (idxD[directKey]) product = idxD[directKey];
      }
      // 2) поиск по артикулу
      if (!product) {
        const q = normArt(body.q || body.article || body.sku || "");
        if (!q) return json({ found: false, error: "Пустой запрос" });
        const alias = (await env.INDEX.get("alias:" + shardOf(q), "json")) || {};
        let base = alias[q];
        // запасной вариант: артикул разновидности Хорошопа с «хвостом размера»
        if (!base) {
          const cands = [
            q.replace(/Q\d+$/, ""),
            q.replace(/\s+\d+$/, ""),
            q.replace(/\s+[A-ZА-Я]{1,4}$/, ""),
            q.replace(/[A-ZА-Я]{1,4}$/, ""),
          ];
          const seen = {};
          for (const c of cands) {
            const cc = (c || "").trim();
            if (!cc || cc === q || seen[cc]) continue;
            seen[cc] = 1;
            const a2 = (await env.INDEX.get("alias:" + shardOf(cc), "json")) || {};
            if (a2[cc]) { base = a2[cc]; break; }
          }
        }
        // відкидаємо з кінця мітки копій (КОП1) і суфікси магазину (B)/(С)/(S): In-3009 (коп1) (B) -> In-3009
        if (!base) {
          let s = q, prev;
          do { prev = s; s = s.replace(/\s*\((?:КОП\d*|[A-ZА-ЯІЇЄҐ]{1,3})\)\s*$/i, "").trim(); } while (s !== prev && s);
          if (s && s !== q) {
            const a3 = (await env.INDEX.get("alias:" + shardOf(s), "json")) || {};
            if (a3[s]) base = a3[s];
          }
        }
        if (!base) return json({ found: false, query: q });
        const idx = (await env.INDEX.get("idx:" + shardOf(base), "json")) || {};
        product = idx[base];
        if (!product) return json({ found: false, query: q });
      }
      // доп. поля владельца: заметка/сетка. Ключ — стабильный (по id товара).
      const ekey = extraKeyOf(product);
      let extra = (await env.INDEX.get("extra:" + ekey, "json")) || {};
      if (!extra.fit && !extra.note && !extra.hasChart) {
        const old = await env.INDEX.get("extra:" + (product.base || ""), "json");
        if (old) extra = old;
      }
      product.fit = extra.fit || "";
      product.note = extra.note || "";
      product.ship = extra.ship || "";
      product.deposit = extra.deposit || "";
      product.hasChart = !!extra.hasChart;
      product.ekey = ekey;
      // категория СТРОГО магазина запроса (если он указан и есть в карточке),
      // иначе — общая (обратная совместимость).
      const wantStore = String(body.store || "").toLowerCase();
      if (wantStore && product.stores && product.stores[wantStore] &&
          product.stores[wantStore].category) {
        product.category = product.stores[wantStore].category;
      }
      return json({ found: true, product: product });
    }

    // --- ПУБЛИЧНО: лёгкий список товаров для поиска по названию -----------
    if (route === "/catalog") {
      if (!env.INDEX) return json({ ok: false, list: [] });
      const list = (await env.INDEX.get("list", "json")) || [];
      return json({ ok: true, list: list });
    }

    // --- ПУБЛИЧНО: фото размерной сетки товара (до 2 штук) ----------------
    if (route === "/chart") {
      if (!env.INDEX) return json({ ok: false, charts: [] });
      const key = String(body.key || "");
      const base = String(body.base || "");
      let val = key ? await env.INDEX.get("chart:" + key) : null;
      if (!val && base) val = await env.INDEX.get("chart:" + base); // старые данные
      let charts = [];
      if (val) {
        if (val[0] === "[") { try { charts = JSON.parse(val); } catch (e) { charts = []; } }
        else if (val.indexOf("data:") === 0) charts = [val]; // старый одиночный формат
      }
      charts = (Array.isArray(charts) ? charts : []).filter(Boolean).slice(0, 2);
      return json({ ok: charts.length > 0, charts: charts, chart: charts[0] || "" });
    }

    // --- ПУБЛИЧНО: полное описание и фото одного товара (для колл-центра) --
    // Берётся из карточки товара Prom (в общем списке описания часто нет).
    // Отдаёт только витринные поля, токен наружу не выходит.
    if (route === "/detail") {
      const store = String(body.store || "").toLowerCase();
      const cfg = STORES[store];
      if (!cfg || cfg.type !== "prom") return json({ ok: false });
      const token = env[cfg.token];
      const id = String(body.id || "").trim();
      if (!token || !id) return json({ ok: false });
      const promHead = { Authorization: "Bearer " + token, Accept: "application/json" };
      const firstVal = (o) => { for (const k in o) { if (o[k]) return o[k]; } return ""; };
      const pickLang = (o) => (o && typeof o === "object") ? (o.uk || o.ua || o.ru || firstVal(o) || "") : (o || "");
      const extractDesc = (p) => {
        // спочатку УКРАЇНСЬКЕ з мультимовного поля
        const dm = p.description_multilang;
        if (dm && typeof dm === "object" && (dm.uk || dm.ua)) return String(dm.uk || dm.ua);
        const dt = p.description_translations;
        if (dt && typeof dt === "object" && (dt.uk || dt.ua)) return String(dt.uk || dt.ua);
        // інакше — будь-яке доступне
        let desc = pickLang(p.description) || pickLang(dm) || pickLang(dt) ||
                   p.description_uk || p.description_ua || p.description_ru || p.text || "";
        return String(desc || "");
      };
      const imgsOf = (p) => Array.isArray(p.images)
        ? p.images.map((x) => x && (x.url || x.thumbnail_url)).filter(Boolean) : [];
      const getProduct = async (pid) => {
        const rr = await fetch(`${PROM_API}/products/${encodeURIComponent(pid)}`, { headers: promHead });
        if (!rr.ok) return null;
        const dd = JSON.parse((await rr.text()) || "{}");
        return dd.product || dd;
      };
      const nameOf = (x) => (x && x.name_multilang && (x.name_multilang.uk || x.name_multilang.ua))
        ? String(x.name_multilang.uk || x.name_multilang.ua) : String((x && x.name) || "");
      try {
        let p = await getProduct(id);
        if (!p) return json({ ok: false });
        let desc = extractDesc(p);
        let images = imgsOf(p);
        let name = nameOf(p);
        // на Prom описание/укр.назва есть у главной позиции — перейти к ней по variation_base_id
        const baseId = p.variation_base_id;
        if (baseId && String(baseId) !== String(p.id)) {
          const base = await getProduct(baseId);
          if (base) {
            if (!desc) desc = extractDesc(base);
            if (!images.length) images = imgsOf(base);
            const bn = nameOf(base); if (bn) name = bn;
          }
        }
        return json({ ok: true, description: desc, images: images, name: name });
      } catch (e) {
        return json({ ok: false });
      }
    }

    // --- Проверка пароля приложения ---------------------------------------
    const pass = request.headers.get("X-App-Password") || "";
    if (!env.APP_PASSWORD || pass !== env.APP_PASSWORD) {
      return json({ error: "Неверный пароль приложения" }, 401);
    }

    if (route === "/ping") {
      return json({ ok: true, stores: Object.keys(STORES), kv: !!env.INDEX,
        openai: !!env.OPENAI_API_KEY, photos: !!env.PHOTOS, photos_public: !!env.PHOTOS_PUBLIC });
    }

    // --- Генерация AI-фото товара (OpenAI) + сохранение в R2 ---------------
    // body: { prompt, image?(исходное фото url), article?, size? }
    // Нужны: секрет OPENAI_API_KEY, привязка R2 PHOTOS, секрет PHOTOS_PUBLIC (адрес бакета).
    if (route === "/genphoto") {
      if (!env.OPENAI_API_KEY) return json({ error: "Не настроен секрет OPENAI_API_KEY" }, 500);
      if (!env.PHOTOS)         return json({ error: "Не подключено хранилище фото (привязка R2 с именем PHOTOS)" }, 500);
      if (!env.PHOTOS_PUBLIC)  return json({ error: "Не задан секрет PHOTOS_PUBLIC (публичный адрес бакета R2)" }, 500);
      const prompt = String(body.prompt || "").trim().slice(0, 4000);
      if (!prompt) return json({ error: "Пустой prompt" }, 400);
      const size = String(body.size || "1024x1024");
      const srcUrl = String(body.image || "");
      try {
        let oa;
        if (srcUrl && /^https?:\/\//i.test(srcUrl)) {
          // image-to-image (edits) — новое фото на основе исходного
          const ir = await fetch(srcUrl, { cf: { cacheTtl: 3600 } });
          if (!ir.ok) throw new Error("не удалось скачать исходное фото: " + ir.status);
          const ibuf = await ir.arrayBuffer();
          const form = new FormData();
          form.append("model", "gpt-image-1");
          form.append("prompt", prompt);
          form.append("size", size);
          form.append("image", new Blob([ibuf], { type: ir.headers.get("content-type") || "image/jpeg" }), "src.jpg");
          oa = await fetch("https://api.openai.com/v1/images/edits", {
            method: "POST",
            headers: { Authorization: "Bearer " + env.OPENAI_API_KEY },
            body: form,
          });
        } else {
          // text-to-image (generations)
          oa = await fetch("https://api.openai.com/v1/images/generations", {
            method: "POST",
            headers: { Authorization: "Bearer " + env.OPENAI_API_KEY, "Content-Type": "application/json" },
            body: JSON.stringify({ model: "gpt-image-1", prompt: prompt, size: size, n: 1 }),
          });
        }
        const otext = await oa.text();
        let od = {};
        try { od = JSON.parse(otext); } catch (e) { od = { raw: otext.slice(0, 500) }; }
        if (!oa.ok) return json({ error: "OpenAI ответил " + oa.status, detail: od }, 502);
        const b64 = od.data && od.data[0] && od.data[0].b64_json;
        if (!b64) return json({ error: "OpenAI не вернул картинку", detail: od }, 502);
        // base64 -> байты
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const safeArt = String(body.article || "img").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 40);
        const key = "ai/" + safeArt + "-" + Date.now() + ".png";
        await env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: "image/png" } });
        const base = String(env.PHOTOS_PUBLIC).replace(/\/+$/, "");
        return json({ ok: true, url: base + "/" + key, bytes: bytes.length });
      } catch (e) {
        return json({ error: "Сбой генерации фото", detail: String(e.message || e) }, 502);
      }
    }

    // --- Загрузка готового фото (из AiKadry и т.п.) в R2 -------------------
    // body: { b64 (base64 без префикса data:), contentType?, article? }
    if (route === "/putphoto") {
      if (!env.PHOTOS)        return json({ error: "Не подключено хранилище фото (привязка R2 PHOTOS)" }, 500);
      if (!env.PHOTOS_PUBLIC) return json({ error: "Не задан секрет PHOTOS_PUBLIC" }, 500);
      const b64 = String(body.b64 || "");
      if (!b64) return json({ error: "Пустое фото" }, 400);
      const ct = String(body.contentType || "image/png");
      const ext = ct.indexOf("png") >= 0 ? "png" : (ct.indexOf("webp") >= 0 ? "webp" : "jpg");
      try {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const safeArt = String(body.article || "img").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 40);
        const key = "sc/" + safeArt + "-" + Date.now() + "." + ext;
        await env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: ct } });
        return json({ ok: true, url: String(env.PHOTOS_PUBLIC).replace(/\/+$/, "") + "/" + key });
      } catch (e) {
        return json({ error: "Сбой загрузки фото", detail: String(e.message || e) }, 502);
      }
    }

    // --- Перенос картинки из описания в R2 (чтобы Хорошоп не резал внешние) -
    // body: { url } -> { ok, url: <R2 public> }
    if (route === "/fetchphoto") {
      if (!env.PHOTOS)        return json({ error: "Не подключено хранилище фото (привязка R2 PHOTOS)" }, 500);
      if (!env.PHOTOS_PUBLIC) return json({ error: "Не задан секрет PHOTOS_PUBLIC" }, 500);
      const u = String(body.url || "").trim();
      if (!/^https?:\/\//i.test(u)) return json({ error: "Плохой url" }, 400);
      try {
        const resp = await fetch(u);
        if (!resp.ok) return json({ error: "Не скачалось " + resp.status }, 502);
        const ct = (resp.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
        const ext = ct.indexOf("png") >= 0 ? "png" : (ct.indexOf("webp") >= 0 ? "webp" : (ct.indexOf("gif") >= 0 ? "gif" : "jpg"));
        const buf = await resp.arrayBuffer();
        const key = "desc/" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "." + ext;
        await env.PHOTOS.put(key, buf, { httpMetadata: { contentType: ct } });
        return json({ ok: true, url: String(env.PHOTOS_PUBLIC).replace(/\/+$/, "") + "/" + key });
      } catch (e) {
        return json({ error: "Сбой переноса картинки", detail: String(e.message || e) }, 502);
      }
    }

    // --- Генерация текстов товара (назва/опис/ключові) через OpenAI -------
    // body: { name, description, image?, extra?, system? }
    // Возвращает: { ok, data: { name_ua,name_ru, desc_ua,desc_ru, keywords_ua,keywords_ru } }
    if (route === "/gentext") {
      if (!env.OPENAI_API_KEY) return json({ error: "Не настроен секрет OPENAI_API_KEY" }, 500);
      const sys = String(body.system || "").trim() || DEFAULT_GENTEXT_SYS;
      let userText = "Дані товару:\nНазва: " + String(body.name || "") +
        "\nДодатково (бренд/колір/характеристики): " + String(body.extra || "") +
        "\nІснуючий опис: " + String(body.description || "");
      // Исходные ключевые — как основа для расширения до 40+ запросов.
      const exKwUa = String(body.ex_keywords_ua || "").slice(0, 1200);
      const exKwRu = String(body.ex_keywords_ru || "").slice(0, 1200);
      if (exKwUa) userText += "\nІснуючі ключові (укр, розший і переформулюй до 45–55): " + exKwUa;
      if (exKwRu) userText += "\nІснуючі ключові (рус, розший і переформулюй до 45–55): " + exKwRu;
      try {
        const r = await openaiChatJson(env.OPENAI_API_KEY, "gpt-4o", sys, userText, String(body.image || ""));
        if (!r.ok) return json({ error: "OpenAI ответил " + (r.status || "?"), detail: r.detail }, 502);
        return json({ ok: true, data: r.data });
      } catch (e) {
        return json({ error: "Сбой генерации текста", detail: String(e.message || e) }, 502);
      }
    }

    // --- Генерация ОПИСАНИЯ товара через OpenAI ---------------------------
    // body: { name, description, image?, extra?, system? }
    // Возвращает: { ok, data: { desc_ua, desc_ru } }  (HTML для Prom)
    if (route === "/gendesc") {
      if (!env.OPENAI_API_KEY) return json({ error: "Не настроен секрет OPENAI_API_KEY" }, 500);
      const sys = String(body.system || "").trim() || DEFAULT_GENDESC_SYS;
      const userText = "Дані товару:\nНазва: " + String(body.name || "") +
        "\nДодатково (бренд/колір/характеристики): " + String(body.extra || "") +
        "\nІснуючий опис: " + String(body.description || "");
      try {
        const r = await openaiChatJson(env.OPENAI_API_KEY, "gpt-4o", sys, userText, String(body.image || ""));
        if (!r.ok) return json({ error: "OpenAI ответил " + (r.status || "?"), detail: r.detail }, 502);
        return json({ ok: true, data: r.data });
      } catch (e) {
        return json({ error: "Сбой генерации описания", detail: String(e.message || e) }, 502);
      }
    }

    // --- Публикация индекса в KV (только владелец, по паролю) --------------
    // Приложение публикации присылает готовые «полки»: [{key, value}, ...].
    if (route === "/publish") {
      if (!env.INDEX) return json({ error: "Хранилище индекса не подключено (нет привязки INDEX)" }, 500);
      const puts = Array.isArray(body.puts) ? body.puts : [];
      if (!puts.length) return json({ error: "Пустой список puts" }, 400);
      let written = 0;
      for (const p of puts) {
        if (!p || !p.key) continue;
        const value = typeof p.value === "string" ? p.value : JSON.stringify(p.value);
        await env.INDEX.put(String(p.key), value);
        written++;
      }
      return json({ ok: true, written: written });
    }

    // --- Доп. поля товара (владелец): заметка о размере + фото сетки -------
    // Хранятся отдельно от каталога, поэтому переопубликация их НЕ стирает.
    if (route === "/extra-set") {
      if (!env.INDEX) return json({ ok: false, error: "Хранилище не подключено" });
      // пишем по стабильному ключу (id товара), присланному приложением
      const key = String(body.key || body.base || "");
      if (!key) return json({ ok: false, error: "Не указан ключ товара" });
      const extra = (await env.INDEX.get("extra:" + key, "json")) || {};
      if (body.fit !== undefined) extra.fit = String(body.fit || "");
      if (body.note !== undefined) extra.note = String(body.note || "");
      if (body.ship !== undefined) extra.ship = String(body.ship || "");
      if (body.deposit !== undefined) extra.deposit = String(body.deposit || "");
      if (body.charts !== undefined) {
        const arr = (Array.isArray(body.charts) ? body.charts : []).filter(Boolean).slice(0, 2);
        if (arr.length) { await env.INDEX.put("chart:" + key, JSON.stringify(arr)); extra.hasChart = true; }
        else { await env.INDEX.delete("chart:" + key); extra.hasChart = false; }
      } else if (body.chart !== undefined) { // старый одиночный формат
        if (body.chart) { await env.INDEX.put("chart:" + key, JSON.stringify([body.chart])); extra.hasChart = true; }
        else { await env.INDEX.delete("chart:" + key); extra.hasChart = false; }
      }
      await env.INDEX.put("extra:" + key, JSON.stringify(extra));
      return json({ ok: true, extra: extra });
    }

    // --- Массовая запись одного поля для многих товаров (владелец) ---------
    // body: { items: ["<ekey|ukey>", ...], field: "ship"|"fit"|"note", value: "..." }
    if (route === "/extra-bulk") {
      if (!env.INDEX) return json({ ok: false, error: "Хранилище не подключено" });
      const field = String(body.field || "");
      if (["ship", "fit", "note", "deposit"].indexOf(field) < 0) return json({ ok: false, error: "Недопустимое поле" });
      const value = String(body.value == null ? "" : body.value);
      const items = Array.isArray(body.items) ? body.items.slice(0, 300) : [];
      if (!items.length) return json({ ok: false, error: "Пустой список товаров" });
      let done = 0;
      for (const raw of items) {
        let ekey = String(raw || "");
        if (!ekey) continue;
        // если это не стабильный ключ (ekey), а ключ карточки (ukey) — вычислим ekey
        if (ekey.indexOf("pid:") !== 0 && ekey.indexOf("art:") !== 0) {
          const idxD = (await env.INDEX.get("idx:" + shardOf(ekey), "json")) || {};
          const prod = idxD[ekey];
          ekey = prod ? extraKeyOf(prod) : ("art:" + ekey);
        }
        const extra = (await env.INDEX.get("extra:" + ekey, "json")) || {};
        extra[field] = value;
        await env.INDEX.put("extra:" + ekey, JSON.stringify(extra));
        done++;
      }
      return json({ ok: true, updated: done });
    }

    // --- Какой магазин ------------------------------------------------------
    const storeKey = String(body.store || "").toLowerCase();
    const cfg = STORES[storeKey];
    if (!cfg) {
      return json({ error: "Неизвестный магазин: " + storeKey }, 400);
    }

    // ================= ХОРОШОП =================
    if (cfg.type === "horoshop") {
      try {
        const auth = await horoshopToken(env, cfg);

        if (route === "/list") {
          // Берём крупными порциями: у Хорошопа лимит на число запросов в час,
          // поэтому выгоднее меньше обращений, но больше товаров за раз.
          const limit = Math.min(Number(body.limit) || 500, 1000);
          const offset = Number(body.offset) || 0;
          const r = await horoshopCall(auth, "catalog/export", { limit: limit, offset: offset });
          if (!r.ok) return json({ error: "Хорошоп: " + r.status, detail: r.data }, 502);

          const resp = r.data.response || r.data;
          const raw = resp.products || resp.items || (Array.isArray(resp) ? resp : []);

          // если товаров нет — отдаём его ответ целиком, чтобы было видно причину
          if (!Array.isArray(raw) || !raw.length) {
            return json({ products: [], offset: offset, count: 0, horoshop_answer: r.data });
          }

          // приводим к тому же виду, что и товары Prom
          const pick = (o, keys) => {
            for (const k of keys) {
              const v = o && o[k];
              if (v !== undefined && v !== null && v !== "") return v;
            }
            return "";
          };
          const langObj = (v) => (v && typeof v === "object") ? v : { ru: v || "", ua: "" };

          const products = (Array.isArray(raw) ? raw : []).map(function (p) {
            // Название товара (RU/UA) — из title/name в разных вариантах
            const title = langObj(p.title || p.name);
            const nameRu = pick(title, ["ru", "ru_RU", "rus"]) ||
                           pick(p, ["title_ru", "name_ru", "Название(RU)"]);
            const nameUa = pick(title, ["ua", "uk", "ua_UA"]) ||
                           pick(p, ["title_ua", "name_ua", "Название(UA)"]);
            // Название модификации (RU/UA) — размер/вариант
            const mod = langObj(p.modification || p.title_modification || p.mod_title ||
                                p.modification_title || p.mod || "");
            const modRu = pick(mod, ["ru", "ru_RU"]) ||
                          pick(p, ["modification_ru", "Название модификации(RU)"]);
            const modUa = pick(mod, ["ua", "uk"]) ||
                          pick(p, ["modification_ua", "Название модификации(UA)"]);

            // родительский артикул — по нему собираются разновидности
            const parent = p.parent_article || p.article_parent || p.parent ||
                           p.parent_id || p.group_article || null;
            // описание (RU/UA) — для карточки колл-центра
            const descObj = langObj(p.description || p.text || p.descr || "");
            const descRu = pick(descObj, ["ru", "ru_RU"]) ||
                           pick(p, ["description_ru", "description", "text_ru"]);
            const descUa = pick(descObj, ["ua", "uk"]) ||
                           pick(p, ["description_ua", "text_ua"]);
            // категория Хорошопа: parent = {id, value:"Розділ/Підрозділ"} (или строка) —
            // берём последний сегмент пути; отдаём как group, чтобы публикация её сохранила.
            let hcatPath = "";
            if (p.parent && typeof p.parent === "object")
              hcatPath = String(p.parent.value || p.parent.title || p.parent.name || "");
            else if (typeof p.parent === "string") hcatPath = p.parent;
            const hcat = hcatPath
              ? (hcatPath.split(/[\/\\]/).filter(Boolean).pop() || "") : "";
            return {
              id: p.article || p.id,
              external_id: p.article || null,
              // связь с Prom и группировка идут по родительскому артикулу
              sku: parent || p.article || "",
              article: p.article || "",
              name: nameRu || nameUa || "",
              name_multilang: { ru: nameRu || "", uk: nameUa || "" },
              mod_name: { ru: modRu || "", uk: modUa || "" },
              group: hcat ? { name: hcat } : undefined,
              description: descUa || descRu || "",
              price: p.price != null ? Number(p.price) : null,
              old_price: p.price_old != null ? Number(p.price_old) : null,
              presence: p.presence || "",
              status: (p.display_in_showcase === false || p.display_in_showcase === 0 ||
                       p.active === false || p.published === false || p.hidden === true)
                       ? "draft" : "on_display",
              images: (function () {
                const src = p.images || p.image || p.photo;
                if (!src) return [];
                const arr = Array.isArray(src) ? src : [src];
                return arr.filter(Boolean).map(function (u) {
                  return { url: (u && typeof u === "object") ? (u.url || u.src || "") : String(u) };
                });
              })(),
              variation_group_id: parent || null,
            };
          });
          return json({ products: products, offset: offset, count: products.length });
        }

        if (route === "/edit") {
          const list = Array.isArray(body.products) ? body.products : [];
          if (!list.length) return json({ error: "Пустой список товаров" }, 400);

          const products = list.map(function (u) {
            const o = { article: String(u.id) };
            if (u.price != null) o.price = u.price;
            if (u.old_price != null) o.price_old = u.old_price;
            if (u.presence) o.presence = u.presence;              // только если явно задано
            if (u.status) o.display_in_showcase = (u.status === "on_display") ? 1 : 0;
            if (u.discount === null) o.discount = 0;
            else if (u.discount && u.discount.value != null) o.discount = u.discount.value;
            return o;
          });

          const r = await horoshopCall(auth, "catalog/import", { products: products });
          if (!r.ok) return json({ error: "Хорошоп: " + r.status, detail: r.data }, 502);
          return json({ processed_ids: list.map(u => u.id), errors: {}, horoshop: r.data });
        }

        if (route === "/get") {
          return json({ error: "Для Хорошопа отдельный запрос товара не нужен" }, 400);
        }
        return json({ error: "Неизвестный адрес: " + route }, 404);
      } catch (e) {
        return json({ error: String(e.message || e) }, 502);
      }
    }

    // ================= PROM =================
    const token = env[cfg.token];
    if (!token) {
      return json({ error: "Не настроен секрет " + cfg.token }, 500);
    }

    const promHeaders = {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    try {
      // --- Список товаров -------------------------------------------------
      if (route === "/list") {
        const limit = Math.min(Number(body.limit) || 100, 100);
        let path = `${PROM_API}/products/list?limit=${limit}`;
        if (body.last_id) path += `&last_id=${encodeURIComponent(body.last_id)}`;
        if (body.group_id) path += `&group_id=${encodeURIComponent(body.group_id)}`;

        // произвольные параметры (для поиска: search_term, q, sku и т.п.)
        if (body.params && typeof body.params === "object") {
          for (const k of Object.keys(body.params)) {
            const v = body.params[k];
            if (v !== undefined && v !== null && v !== "") {
              path += `&${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
            }
          }
        }

        const r = await fetch(path, { headers: promHeaders });
        const text = await r.text();
        if (!r.ok) {
          return json({ error: `Prom ответил ${r.status}`, detail: text.slice(0, 500) }, 502);
        }
        return json(JSON.parse(text || "{}"));
      }

      // --- Один товар целиком ------------------------------------------
      if (route === "/get") {
        const id = String(body.id || "").trim();
        if (!id) return json({ error: "Не указан id" }, 400);
        const r = await fetch(`${PROM_API}/products/${encodeURIComponent(id)}`, { headers: promHeaders });
        const text = await r.text();
        if (!r.ok) {
          return json({ error: `Prom ответил ${r.status}`, detail: text.slice(0, 500) }, 502);
        }
        return json(JSON.parse(text || "{}"));
      }

      // --- Отправка файла импорта ------------------------------------------
      if (route === "/import") {
        const csv = String(body.csv || "");
        if (!csv) return json({ error: "Пустой файл" }, 400);

        const form = new FormData();
        form.append("file", new Blob([csv], { type: "text/csv" }), "import.csv");
        form.append("mark_missing_product_as", "none");

        const r = await fetch(PROM_API + "/products/import_file", {
          method: "POST",
          headers: { Authorization: "Bearer " + token },
          body: form,
        });
        const text = await r.text();
        let parsed = {};
        try { parsed = JSON.parse(text || "{}"); } catch (e) { parsed = { raw: text }; }
        return json({ status: r.status, ok: r.ok, answer: parsed });
      }

      // --- Чем закончился импорт -------------------------------------------
      if (route === "/import_status") {
        const id = String(body.import_id || "").trim();
        if (!id) return json({ error: "Не указан номер импорта" }, 400);

        const paths = [
          `/products/import_file/status?id=${encodeURIComponent(id)}`,
          `/products/import_file/${encodeURIComponent(id)}`,
          `/products/import_status?id=${encodeURIComponent(id)}`,
        ];
        const tried = [];
        for (const path of paths) {
          try {
            const r = await fetch(PROM_API + path, { headers: promHeaders });
            const text = await r.text();
            let parsed = {};
            try { parsed = JSON.parse(text || "{}"); } catch (e) { parsed = { raw: text.slice(0, 300) }; }
            tried.push({ path: path, status: r.status, answer: parsed });
            if (r.ok) return json({ found: true, status: r.status, answer: parsed, path: path });
          } catch (e) {
            tried.push({ path: path, status: 0, answer: String(e).slice(0, 150) });
          }
        }
        return json({ found: false, tried: tried });
      }

      // --- Правка товаров ---------------------------------------------------
      if (route === "/edit") {
        const products = Array.isArray(body.products) ? body.products : [];
        if (!products.length) {
          return json({ error: "Пустой список товаров" }, 400);
        }
        // необязательный язык: /products/edit?lang=uk
        let editUrl = `${PROM_API}/products/edit`;
        if (body.lang) editUrl += `?lang=${encodeURIComponent(body.lang)}`;

        const headers = Object.assign({}, promHeaders);
        if (body.lang) headers["Accept-Language"] = String(body.lang);

        const r = await fetch(editUrl, {
          method: "POST",
          headers: headers,
          // Prom ждёт сам список, без обёртки {products: ...}
          body: JSON.stringify(products),
        });
        const text = await r.text();
        let parsed = {};
        try { parsed = JSON.parse(text || "{}"); } catch { parsed = { raw: text }; }

        if (!r.ok) {
          return json({ error: `Prom ответил ${r.status}`, detail: parsed }, 502);
        }
        return json(parsed);
      }

      return json({ error: "Неизвестный адрес: " + route }, 404);
    } catch (e) {
      return json({ error: "Сбой посредника", detail: String(e) }, 500);
    }
  },
};

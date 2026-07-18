#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Движок синхронизации товаров: Black Street  ->  Bonna-shop, Core22 (Prom.ua).

Что делает:
  1. Читает товары магазина-источника (Black Street) через Prom API.
  2. Для каждого магазина-приёмника переносит поля, отмеченные в config.json.
  3. Быстрые поля (цена, наличие, количество, скидка, видимость) отправляет
     методом правки /products/edit_by_external_id — доезжают за ~10 минут.
  4. Артикул и название на приёмниках получают суффикс из config (напр. " (B)").

Токены НИКОГДА не хранятся в этом файле и не попадают в репозиторий.
Они берутся из переменных окружения (GitHub Secrets), имена которых заданы
в config.json (поле env_token).

Первый запуск делайте с DRY_RUN=1 — тогда движок только покажет, что собирается
изменить, но ничего не отправит.
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error

API_BASE = "https://my.prom.ua/api/v1"
DRY_RUN = os.environ.get("DRY_RUN", "0") == "1"


# --------------------------------------------------------------------------- #
#  Клиент Prom API
# --------------------------------------------------------------------------- #
class Prom:
    def __init__(self, name, token):
        self.name = name
        self.token = token

    def _request(self, method, path, payload=None):
        url = API_BASE + path
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", "Bearer " + self.token)
        req.add_header("Content-Type", "application/json")
        req.add_header("Accept", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = resp.read().decode("utf-8")
                return json.loads(body) if body else {}
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "ignore")
            raise RuntimeError(f"[{self.name}] HTTP {e.code} на {path}: {detail}")

    def list_products(self, limit=100):
        """Все товары магазина (с постраничной подгрузкой)."""
        items, last_id = [], None
        while True:
            path = f"/products/list?limit={limit}"
            if last_id is not None:
                path += f"&last_id={last_id}"
            data = self._request("GET", path)
            batch = data.get("products", [])
            if not batch:
                break
            items.extend(batch)
            last_id = batch[-1].get("id")
            if len(batch) < limit:
                break
            time.sleep(0.3)  # бережём лимиты
        return items

    def edit_by_external_id(self, products):
        """Быстрая правка по внешнему id. products — список словарей."""
        if not products:
            return {"skipped": True}
        return self._request("POST", "/products/edit_by_external_id",
                             {"products": products})


# --------------------------------------------------------------------------- #
#  Логика переноса
# --------------------------------------------------------------------------- #
FAST_FIELDS = ("price", "presence", "quantity", "discount", "visibility")
CONTENT_FIELDS = ("name", "sku", "description", "images")


def token_for(env_name):
    tok = os.environ.get(env_name)
    if not tok:
        sys.exit(f"Не найден токен в переменной окружения {env_name}. "
                 f"Добавьте его в GitHub Secrets.")
    return tok


def build_fast_update(src, fields):
    """Из товара-источника собираем поля быстрой правки для приёмника."""
    upd = {}
    # ключ соответствия — стабильный external_id (не артикул!)
    upd["external_id"] = str(src.get("external_id") or src.get("id"))

    if fields.get("price") and src.get("price") is not None:
        upd["price"] = src["price"]
    if fields.get("presence") and src.get("presence") is not None:
        upd["presence"] = src["presence"]
    if fields.get("quantity") and src.get("quantity_in_stock") is not None:
        upd["quantity_in_stock"] = src["quantity_in_stock"]
    if fields.get("discount") and src.get("discount") is not None:
        upd["discount"] = src["discount"]
    if fields.get("visibility") and src.get("status") is not None:
        upd["status"] = src["status"]           # on_display / draft / deleted
    return upd


def run():
    cfg_path = os.path.join(os.path.dirname(__file__), "config.json")
    if not os.path.exists(cfg_path):
        sys.exit("Нет файла config.json рядом со скриптом. "
                 "Скачайте его на странице «Актуализация цен» и положите в папку sync/.")

    with open(cfg_path, encoding="utf-8") as f:
        cfg = json.load(f)

    fields = cfg.get("sync_fields", {})
    print(f"== Синхронизация {'(DRY RUN — без изменений)' if DRY_RUN else ''} ==")
    print("Поля:", ", ".join(k for k, v in fields.items() if v) or "—")

    # источник
    src = cfg["source"]
    source = Prom(src["name"], token_for(src["env_token"]))
    products = source.list_products()
    print(f"Источник {src['name']}: {len(products)} товаров")

    # приёмники
    for tgt in cfg["targets"]:
        client = Prom(tgt["name"], token_for(tgt["env_token"]))

        # быстрые поля
        fast = [build_fast_update(p, fields) for p in products]
        fast = [u for u in fast if len(u) > 1]  # где есть что менять кроме ключа
        print(f"\n-> {tgt['name']}: {len(fast)} товаров к быстрой правке")

        if DRY_RUN:
            print("   (dry run) пример:", json.dumps(fast[:2], ensure_ascii=False))
        else:
            # отправляем пачками по 100
            for i in range(0, len(fast), 100):
                chunk = fast[i:i + 100]
                client.edit_by_external_id(chunk)
                print(f"   отправлено {i + len(chunk)}/{len(fast)}")
                time.sleep(0.5)

        # содержимое (название, артикул, описание, фото) — фаза 2, через импорт.
        content_on = [f for f in CONTENT_FIELDS if fields.get(f)]
        if content_on:
            print(f"   [фаза 2] поля через импорт пока не отправляются: {', '.join(content_on)}")
            print(f"   суффикс для артикула/названия: '{tgt.get('suffix', '')}'")

    print("\nГотово.")


if __name__ == "__main__":
    run()

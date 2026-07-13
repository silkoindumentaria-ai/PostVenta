# Consulta a la API de Tiendanube: ordenes con envio "Enviada" en un rango de fechas
import json
import os
import requests

def load_env(path=".env"):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip())

load_env(os.path.join(os.path.dirname(__file__), ".env"))

TN_ACCESS_TOKEN = os.environ["TN_ACCESS_TOKEN"]
TN_STORE_ID = os.environ["TN_STORE_ID"]
BASE_URL = f"https://api.tiendanube.com/v1/{TN_STORE_ID}"
HEADERS = {
    "Authentication": f"bearer {TN_ACCESS_TOKEN}",
    "User-Agent": "SilkoPostVenta (gabrieldecima1028@gmail.com)",
}

DATE_FROM = "2026-06-11T00:00:00+0000"
DATE_TO = "2026-06-19T23:59:59+0000"
SHIPPING_STATUS = "fulfilled"  # "Enviada" en el panel de Tiendanube (la API usa "fulfilled", el campo de la orden devuelve "shipped")
# STATUS = "open"  # solo ordenes aun abiertas
ORDER_NUMBER = 19492  # ej: 19607 para filtrar por el campo "number" de la orden. None = sin filtro


def obtener_ordenes_enviadas():
    ordenes = []
    page = 1
    while True:
        params = {
            "created_at_min": DATE_FROM,
            "created_at_max": DATE_TO,
            "shipping_status": SHIPPING_STATUS,
            # "status": STATUS,
            "per_page": 1,
            "page": page,
        }
        if ORDER_NUMBER is not None:
            params["q"] = str(ORDER_NUMBER)
        resp = requests.get(f"{BASE_URL}/orders", headers=HEADERS, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()

        if not data:
            break

        ordenes.extend(data)

        if len(data) < 200:
            break
        page += 1

    if ORDER_NUMBER is not None:
        ordenes = [o for o in ordenes if o.get("number") == ORDER_NUMBER]

    print(f"Total de ordenes obtenidas: {len(ordenes)}")
    return ordenes


if __name__ == "__main__":
    ordenes = obtener_ordenes_enviadas()
    print(f"Total de ordenes enviadas entre {DATE_FROM} y {DATE_TO}: {len(ordenes)}\n")
    print(json.dumps(ordenes, ensure_ascii=False, indent=2))
    print(f"\nTotal de ordenes obtenidas: {len(ordenes)}")
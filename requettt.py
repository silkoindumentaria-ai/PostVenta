import requests
import json
import os
import sys

# Ruta REST recomendada por la documentación de Gestion Moda
# (devuelve cliente expandido, totales y, opcionalmente, items y pagos)
BASE_URL = "https://gestion.moda/api/v1/ventas"


def load_gm_token():
    """Lee el GM_TOKEN desde backend/.env para no duplicar credenciales."""
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend", ".env")
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            if line.startswith("GM_TOKEN="):
                return line.split("=", 1)[1].strip()
    raise RuntimeError("GM_TOKEN no encontrado en backend/.env")


def get_sales_data(nombre_cliente):
    params = {
        "search": "INDIANA ANABEL MUÑOZ",  # busca por cliente, número, email, factura o comentario
        "limit": 1,                # un solo resultado
        "include_details": 1,      # incluye items y alias "detalles"
        "include_payments": 1,     # incluye pagos (y credit_payments si hubo sobrepago)
    }
    headers = {
        "Authorization": f"Bearer {load_gm_token()}",
        "Content-Type": "application/json",
    }

    try:
        response = requests.get(BASE_URL, headers=headers, params=params, timeout=30)

        if response.status_code == 200:
            sales_data = response.json()

            # Guardamos en el archivo igual que antes
            with open('sales_data.json', 'w', encoding='utf-8') as json_file:
                json.dump(sales_data, json_file, indent=4, ensure_ascii=False)

            total = sales_data.get("meta", {}).get("total", "?")

            # --- Visualización en Terminal ---
            print("\n" + "=" * 50)
            print("VENTA RECUPERADA (Formato JSON)")
            print(f"Búsqueda: \"{nombre_cliente}\" | Coincidencias totales: {total} (mostrando 1)")
            print("=" * 50 + "\n")

            if not sales_data.get("data"):
                print(f"No se encontró ninguna venta para \"{nombre_cliente}\".")
            else:
                print(json.dumps(sales_data, indent=4, ensure_ascii=False))

            print("\n" + "=" * 50)
            print("El resultado anterior se ha guardado en 'sales_data.json'")
            print("=" * 50)

        else:
            print(f"Error al recuperar datos. Código de estado: {response.status_code}")
            print(f"Respuesta del servidor: {response.text}")

    except Exception as e:
        print(f"Ocurrió un error inesperado: {e}")


if __name__ == "__main__":
    # El nombre se puede pasar como argumento: py requettt.py "Aurora Solis"
    if len(sys.argv) > 1:
        nombre = " ".join(sys.argv[1:])
    else:
        nombre = input("Nombre del cliente a buscar: ").strip()

    if nombre:
        get_sales_data(nombre)
    else:
        print("No ingresaste ningún nombre.")

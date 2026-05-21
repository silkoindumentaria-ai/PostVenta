import requests
import json

def get_sales_data():
    url = "https://gestion.moda/api/v1/ventas/obtener?from=2026-04-01&to=2026-04-31&include_details=1&include_payments=1"
    headers = {
        "Authorization": "Bearer 60|yxMtJg6JxG4ZijNa8eaX6XWWlMP2hW5DSMx02p1nbc72c7f3",
        "Content-Type": "application/json"  
    }
    
    try:
        response = requests.get(url, headers=headers)
        
        if response.status_code == 200:
            sales_data = response.json()
            
            # Guardamos en el archivo igual que antes
            with open('sales_data.json', 'w') as json_file:
                json.dump(sales_data, json_file, indent=4)
            
            # --- Visualización en Terminal ---
            print("\n" + "="*50)
            print("DATOS DE VENTAS RECUPERADOS (Formato JSON)")
            print("="*50 + "\n")
            
            # Convertimos el objeto de nuevo a un string JSON formateado para la terminal
            # indent=4 le da los saltos de línea y espacios necesarios
            # sort_keys=True es opcional, pero ayuda a que sea más predecible
            json_formateado = json.dumps(sales_data, indent=4, ensure_ascii=False)
            
            print(json_formateado)
            
            print("\n" + "="*50)
            print("El resultado anterior se ha guardado en 'sales_data.json'")
            print("="*50)
            
        else:
            print(f"Error al recuperar datos. Código de estado: {response.status_code}")
            print(f"Respuesta del servidor: {response.text}")

    except Exception as e:
        print(f"Ocurrió un error inesperado: {e}")

if __name__ == "__main__":
    get_sales_data()
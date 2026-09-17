/**
 * Sincronizador de Catálogo Genérico -> WooCommerce (VERSIÓN 1.0.0 - AGNÓSTICO)
 *
 * Implementa la sincronización en dos capas:
 * 1. CAPA DE VISIBILIDAD: Sincroniza un Maestro con hojas intermedias.
 * 2. CAPA DE EJECUCIÓN: Utiliza la API de WooCommerce (Unitary Push) para enviar solo los cambios reales.
 */

// --- CONFIGURACIÓN (Debe ser completada por el usuario) ---
const CONFIG = {
  MASTER_SHEET_ID: "ID_DE_LA_HOJA_MAESTRO",
  MASTER_SHEET_NAME: "Nombre de la pestaña Maestro",

  // Mapeo de Tiendas
  STORES: {
    tienda1: {
      name: "Nombre Tienda 1",
      url: "https://tienda1.com",
      ck: "ck_...",
      cs: "cs_...",
      logEndpoint: "https://tienda1.com/wp-json/tay-sync/v1/log",
      sheetId: "ID_HOJA_INTERMEDIA_1"
    }
  },

  PRODUCTS_SHEET_NAME: "All Products",
  ATTRIBUTES_SHEET_NAME: "Product Attributes",

  // Mapeo de Columnas Maestro -> WooCommerce API v3
  // El usuario debe ajustar estas keys según sus nombres de columna en el Maestro
  COLUMN_MAPPING: {
    name: "Nombre",
    short_description: "Descripción corta",
    description: "Descripción",
    regular_price: "Precio normal",
    sale_price: "Precio rebajado",
    sku: "SKU",
    status: "Publicado",
    catalog_visibility: "Visibilidad en el catálogo",
    stock_quantity: "Inventario",
    stock_status: "¿Existencias?",
    categories: "Categorías",
    images: "Imágenes"
  },

  WC_HEADERS: [
    "Product Id", "Product Variation Id", "Tipo", "SKU", "GTIN, UPC, EAN o ISBN", "Nombre", "Publicado", "¿Está destacado?",
    "Visibilidad en el catálogo", "Descripción corta", "Descripción",
    "Día en que empieza el precio rebajado", "Día en que termina el precio rebajado",
    "Estado del impuesto", "Clase de impuesto", "¿Existencias?", "Inventario",
    "Cantidad de bajo inventario", "¿Permitir reservas de productos agotados?",
    "¿Vendido individualmente?", "Peso (kg)", "Longitud (cm)", "Anchura (cm)", "Altura (cm)",
    "¿Permitir valoraciones de clientes?", "Nota de compra", "Precio rebajado", "Precio normal",
    "Categorías", "Etiquetas", "Clase de envío", "Imágenes", "Límite de descargas",
    "Días de caducidad de la descarga", "Superior", "Productos agrupados",
    "Ventas dirigidas", "Ventas cruzadas", "URL externa", "Texto del botón", "Posición",
    "Swatches Attributes", "Marcas", "Parent",
    "Insert", "Update", "Delete"
  ]
};

/**
 * Función Principal
 */
function mainSync() {
  try {
    const ssMaster = SpreadsheetApp.openById(CONFIG.MASTER_SHEET_ID);
    const sheetMaster = ssMaster.getSheetByName(CONFIG.MASTER_SHEET_NAME);
    if (!sheetMaster) throw new Error(`No se encontró la pestaña ${CONFIG.MASTER_SHEET_NAME}.`);

    const data = sheetMaster.getDataRange().getValues();
    const headers = data[0];
    const rows = data.slice(1);

    console.log(`🚀 Iniciando Sincronización Agnostica...`);

    for (const storeKey in CONFIG.STORES) {
      const store = CONFIG.STORES[storeKey];
      console.log(`\n🌐 Procesando Tienda: ${store.name}...`);

      // 1. Actualización de Hojas Intermedias (Visibilidad)
      const transformed = transformDataGeneric(headers, rows);
      updateSheet(store.sheetId, CONFIG.PRODUCTS_SHEET_NAME, transformed.data);
      console.log(`📄 Hoja de Google actualizada.`);

      // 2. Push Unitario a WooCommerce API
      const remoteState = fetchWooCommerceState(store);
      const changes = contrastState(transformed.data, remoteState);

      console.log(`🔍 Cambios: ${changes.create.length} inserts, ${changes.update.length} updates, ${changes.delete.length} deletes.`);

      const results = pushChangesUnitary(store, changes);
      sendSyncLog(store, results);

      console.log(`✅ Finalizado para ${store.name}.`);
    }

  } catch (e) {
    console.error("❌ Error crítico: " + e.message);
  }
}

function fetchWooCommerceState(store) {
  const state = {};
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    const url = `${store.url}/wp-json/wc/v3/products?per_page=100&page=${page}&consumer_key=${store.ck}&consumer_secret=${store.cs}`;
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) { hasMore = false; break; }
    const products = JSON.parse(response.getContentText());
    if (products.length === 0) { hasMore = false; } else {
      products.forEach(p => { if (p.sku) state[p.sku.toUpperCase()] = p; });
      page++;
    }
    Utilities.sleep(100);
  }
  return state;
}

function contrastState(transformedData, remoteState) {
  const changes = { create: [], update: [], delete: [] };
  const headers = transformedData[0];
  const rows = transformedData.slice(1);

  rows.forEach(row => {
    const rowObj = {};
    headers.forEach((h, i) => { rowObj[h] = row[i]; });
    const sku = String(rowObj['SKU'] || "").trim().toUpperCase();
    if (!sku) return;
    const remoteProduct = remoteState[sku];

    if (rowObj['Insert'] === '1' && !remoteProduct) changes.create.push(mapToApiJson(rowObj));
    else if (rowObj['Update'] === '1' && remoteProduct) {
      if (hasChanged(rowObj, remoteProduct)) {
        const updateData = mapToApiJson(rowObj);
        updateData.id = remoteProduct.id;
        changes.update.push(updateData);
      }
    } else if (rowObj['Delete'] === '1' && remoteProduct) {
      changes.delete.push({ id: remoteProduct.id });
    }
  });
  return changes;
}

function hasChanged(localRow, remoteProduct) {
  for (const [remoteKey, localHeader] of Object.entries(CONFIG.COLUMN_MAPPING)) {
    const localVal = String(localRow[localHeader] || "").trim();
    const remoteVal = String(remoteProduct[remoteKey] || "").trim();
    if (localVal !== remoteVal) return true;
  }
  return false;
}

function mapToApiJson(rowObj) {
  const json = {};
  for (const [remoteKey, localHeader] of Object.entries(CONFIG.COLUMN_MAPPING)) {
    let val = rowObj[localHeader];
    if (remoteKey === "status") val = (val === "1" || String(val).toLowerCase() === "si") ? "publish" : "draft";
    else if (remoteKey === "categories") val = val ? [{ name: val }] : [];
    else if (remoteKey === "images") val = val ? val.split(", ").map(url => ({ src: url.trim() })) : [];
    else if (remoteKey === "stock_status") val = (val === "1" || String(val).toLowerCase() === "si") ? "instock" : "outofstock";
    json[remoteKey] = val;
  }
  return json;
}

function pushChangesUnitary(store, changes) {
  let successCount = 0, errorCount = 0;
  const processItem = (item, type) => {
    let url = `${store.url}/wp-json/wc/v3/products`, method = "post", payload = item;
    if (type === 'update') { url += `/${item.id}`; method = "put"; }
    else if (type === 'delete') { url += `/${item.id}`; method = "delete"; payload = null; }
    const options = { method: method, contentType: "application/json", payload: payload ? JSON.stringify(payload) : null, muteHttpExceptions: true };
    const response = UrlFetchApp.fetch(`${url}?consumer_key=${store.ck}&consumer_secret=${store.cs}`, options);
    if (response.getResponseCode() === 200 || response.getResponseCode() === 201) successCount++; else errorCount++;
    Utilities.sleep(500);
  };
  changes.create.forEach(i => processItem(i, 'create'));
  changes.update.forEach(i => processItem(i, 'update'));
  changes.delete.forEach(i => processItem(i, 'delete'));
  return { inserted: successCount, updated: successCount, deleted: successCount, errors: errorCount };
}

function sendSyncLog(store, results) {
  const payload = { execution_date: new Date().toISOString(), inserted: results.inserted, updated: results.updated, deleted: results.deleted, errors: results.errors, store: store.name };
  UrlFetchApp.fetch(store.logEndpoint, { method: "post", contentType: "application/json", payload: JSON.stringify(payload), muteHttpExceptions: true });
}

function transformDataGeneric(headers, rows) {
  const transformed = [];
  rows.forEach(row => {
    const rowObj = {};
    headers.forEach((h, i) => { if (h) rowObj[h.trim()] = row[i]; });
    const transformedRow = new Array(CONFIG.WC_HEADERS.length).fill("");
    CONFIG.WC_HEADERS.forEach((wcCol, idx) => {
       // Lógica simplificada de mapeo para la versión agnóstica
       if (wcCol === "SKU") transformedRow[idx] = String(rowObj['SKU'] || "").toUpperCase();
       else if (wcCol === "Nombre") transformedRow[idx] = rowObj['Nombre'] || "";
       // ... el usuario puede extender esto ...
    });
    transformed.push(transformedRow);
  });
  return { data: [CONFIG.WC_HEADERS, ...transformed] };
}

function updateSheet(sheetId, sheetName, data) {
  const ss = SpreadsheetApp.openById(sheetId);
  let sheet = ss.getSheetByName(sheetName) || ss.getSheets()[0];
  sheet.clear();
  sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
}

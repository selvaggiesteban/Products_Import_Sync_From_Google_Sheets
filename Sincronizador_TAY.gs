/**
 * Sincronizador de Catálogo TAY -> WooCommerce (VERSIÓN 3.9.3 - PUSH ARCHITECTURE + STATE-AWARE)
 *
 * Implementa el patrón de "Sincronización Inteligente":
 * 1. Lee el estado actual de WooCommerce (SKUs, precios, etc.).
 * 2. Contrasta el Maestro TAY con el estado remoto.
 * 3. Envía solo los cambios estrictamente necesarios vía WooCommerce Batch API.
 * 4. Registra el resultado en el endpoint custom de WordPress.
 */

// --- CONFIGURACIÓN ---
const CONFIG = {
  MASTER_SHEET_ID: "1COo7jqzvV6hsVVU7lIKdew4nNacFvLF5hFFtp8oB_sg",
  MASTER_SHEET_NAME: "Base de Familia",

  // Configuración de Tiendas (API WooCommerce)
  STORES: {
    retail: {
      name: "Decotay Minoristas",
      url: "https://decotay.com.ar",
      ck: "ck_e5b2cbf086ea5705b5c6f789b88fce85a5010196",
      cs: "cs_13d216beeaf3e75fad64210c72fa327235a6bf77",
      logEndpoint: "https://decotay.com.ar/wp-json/tay-sync/v1/log"
    },
    wholesale: {
      name: "Tay Mayoristas",
      url: "https://tay.com.ar",
      ck: "ck_588f508b47d417c5e43a2247c0f724a3eaf3938a",
      cs: "cs_1a51b1ff7b0bd7e5481bdd2dce6cf74e1fa98f33",
      logEndpoint: "https://tay.com.ar/wp-json/tay-sync/v1/log"
    }
  },

  // Mapeo de Columnas CSV (V3.9) -> Keys de API WooCommerce v3
  API_MAPPING: {
    "Nombre": "name",
    "Descripción corta": "short_description",
    "Descripción": "description",
    "Precio normal": "regular_price",
    "Precio rebajado": "sale_price",
    "SKU": "sku",
    "Publicado": "status", // Se transformará a 'publish' o 'draft'
    "Visibilidad en el catálogo": "catalog_visibility",
    "Inventario": "stock_quantity",
    "¿Existencias?": "stock_status", // 'instock' o 'outofstock'
    "Categorías": "categories", // Requiere procesamiento especial (array)
    "Imágenes": "images" // Requiere procesamiento especial (array)
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
 * Función Principal: Orquestador de la Sincronización
 */
function mainSync() {
  try {
    const ssMaster = SpreadsheetApp.openById(CONFIG.MASTER_SHEET_ID);
    const sheetMaster = ssMaster.getSheetByName(CONFIG.MASTER_SHEET_NAME);
    if (!sheetMaster) throw new Error(`No se encontró la pestaña ${CONFIG.MASTER_SHEET_NAME} en el maestro.`);

    const data = sheetMaster.getDataRange().getValues();
    const headers = data[0];
    const rows = data.slice(1);

    console.log(`🚀 Iniciando Sincronización State-Aware V3.9.3...`);
    console.log(`📊 Total de filas en Maestro: ${rows.length}`);

    // Sincronizar cada tienda definida en la configuración
    for (const storeKey in CONFIG.STORES) {
      const store = CONFIG.STORES[storeKey];
      console.log(`\n🌐 Procesando Tienda: ${store.name}...`);

      // 1. Obtener estado actual de WooCommerce
      const remoteState = fetchWooCommerceState(store);

      // 2. Transformar datos del Maestro para esta tienda
      const transformed = transformData(headers, rows, storeKey === 'retail' ? 'minorista' : 'mayorista');

      // 3. Contrastar y generar cola de cambios
      const changes = contrastState(transformed.data, remoteState);

      console.log(`🔍 Contraste completado: ${changes.create.length} inserts, ${changes.update.length} updates, ${changes.delete.length} deletes.`);

      // 4. Ejecutar Push Batch
      const results = batchPush(store, changes);

      // 5. Registrar logs en WordPress
      sendSyncLog(store, results);

      console.log(`✅ Finalizado para ${store.name}.`);
    }

  } catch (e) {
    console.error("❌ Error crítico en la sincronización: " + e.message);
  }
}

/**
 * Obtiene todos los productos de la tienda y crea un mapa SKU -> Datos
 */
function fetchWooCommerceState(store) {
  console.log(`📥 Descargando estado remoto desde ${store.url}...`);
  const state = {};
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const url = `${store.url}/wp-json/wc/v3/products?per_page=100&page=${page}&consumer_key=${store.ck}&consumer_secret=${store.cs}`;
    const response = UrlFetchApp.fetch(url);
    const products = JSON.parse(response.getContentText());

    if (products.length === 0) {
      hasMore = false;
    } else {
      products.forEach(p => {
        if (p.sku) state[p.sku.toUpperCase()] = p;
      });
      page++;
    }
    // Evitar saturar API
    Utilities.sleep(100);
  }
  console.log(`📦 Estado remoto cargado: ${Object.keys(state).length} productos encontrados.`);
  return state;
}

/**
 * Contrasta los datos transformados con el estado remoto para filtrar cambios reales
 */
function contrastState(transformedData, remoteState) {
  const changes = { create: [], update: [], delete: [] };
  const headers = transformedData[0];
  const rows = transformedData.slice(1);

  rows.forEach(row => {
    const rowObj = {};
    headers.forEach((h, i) => { rowObj[h] = row[i]; });

    const sku = String(rowObj['SKU'] || "").trim().toUpperCase();
    if (!sku) return;

    const insert = rowObj['Insert'] === '1';
    const update = rowObj['Update'] === '1';
    const del = rowObj['Delete'] === '1';

    const remoteProduct = remoteState[sku];

    if (insert && !remoteProduct) {
      changes.create.push(mapToApiJson(rowObj));
    } else if (update && remoteProduct) {
      if (hasChanged(rowObj, remoteProduct)) {
        const updateData = mapToApiJson(rowObj);
        updateData.id = remoteProduct.id;
        changes.update.push(updateData);
      }
    } else if (del && remoteProduct) {
      changes.delete.push({ id: remoteProduct.id });
    }
  });

  return changes;
}

/**
 * Compara los campos clave del Maestro vs WooCommerce para evitar updates redundantes
 */
function hasChanged(localRow, remoteProduct) {
  const fieldsToCompare = {
    "Nombre": "name",
    "Descripción corta": "short_description",
    "Descripción": "description",
    "Precio normal": "regular_price",
    "Precio rebajado": "sale_price",
    "Inventario": "stock_quantity",
    "Publicado": "status"
  };

  for (const [localKey, remoteKey] of Object.entries(fieldsToCompare)) {
    const localVal = String(localRow[localKey] || "").trim();
    const remoteVal = String(remoteProduct[remoteKey] || "").trim();

    // Normalización simple de status
    let normalizedLocal = localVal;
    if (localKey === "Publicado") {
      normalizedLocal = (localVal === "1" || localVal.toLowerCase() === "si") ? "publish" : "draft";
    }

    if (normalizedLocal !== remoteVal) return true;
  }
  return false;
}

/**
 * Mapea una fila de datos (formato CSV) a un objeto JSON compatible con la API de WooCommerce
 */
function mapToApiJson(rowObj) {
  const json = {};
  for (const [csvHeader, apiKey] of Object.entries(CONFIG.API_MAPPING)) {
    let val = rowObj[csvHeader];

    if (csvHeader === "Publicado") {
      val = (val === "1" || String(val).toLowerCase() === "si") ? "publish" : "draft";
    } else if (csvHeader === "Categorías") {
      val = val ? [{ name: val }] : [];
    } else if (csvHeader === "Imágenes") {
      val = val ? val.split(", ").map(url => ({ src: url.trim() })) : [];
    } else if (csvHeader === "¿Existencias?") {
      val = (val === "1" || String(val).toLowerCase() === "si") ? "instock" : "outofstock";
    }

    json[apiKey] = val;
  }
  return json;
}

/**
 * Envía los cambios en lotes de 100 usando la Batch API de WooCommerce
 */
function batchPush(store, changes) {
  const allActions = [...changes.create.map(d => ({ create: d })),
                      ...changes.update.map(d => ({ update: d })),
                      ...changes.delete.map(d => ({ delete: d }))];

  let processed = 0;
  let successCount = 0;
  let errorCount = 0;

  while (processed < allActions.length) {
    const batch = allActions.slice(processed, processed + 100);
    const payload = {
      create: batch.filter(a => a.create).map(a => a.create),
      update: batch.filter(a => a.update).map(a => a.update),
      delete: batch.filter(a => a.delete).map(a => a.delete)
    };

    const options = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const url = `${store.url}/wp-json/wc/v3/products/batch?consumer_key=${store.ck}&consumer_secret=${store.cs}`;
    const response = UrlFetchApp.fetch(url, options);
    const result = JSON.parse(response.getContentText());

    if (response.getResponseCode() === 200) {
      successCount += (result.create.length + result.update.length + result.delete.length);
    } else {
      errorCount += batch.length;
    }

    processed += 100;
  }

  return { inserted: changes.create.length, updated: changes.update.length, deleted: changes.delete.length, errors: errorCount };
}

/**
 * Envía el resumen de la ejecución al endpoint custom en WordPress
 */
function sendSyncLog(store, results) {
  const payload = {
    execution_date: new Date().toISOString(),
    inserted: results.inserted,
    updated: results.updated,
    deleted: results.deleted,
    errors: results.errors,
    store: store.name
  };

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    UrlFetchApp.fetch(store.logEndpoint, options);
  } catch (e) {
    console.error(`❌ No se pudo enviar el log a ${store.name}: ${e.message}`);
  }
}

// --- FUNCIONES DE SOPORTE (Mantenidas de V3.9) ---

function normalizeControlValue(value, columnHeader, sku) {
  const strVal = String(value || "").trim();
  if (strVal === "1") return "1";
  if (strVal === "0") return "0";
  if (strVal !== "") {
    console.warn(`⚠️ ALERTA DE NORMALIZACIÓN: SKU [${sku}] tiene valor ['${strVal}'] en columna ${columnHeader}. Forzado a '0'.`);
  }
  return "0";
}

function transformData(headers, rows, mode) {
  const parents = [];
  const variations = [];
  const mappedIndices = new Set();
  const quality = { brokenParents: 0, missingShortDesc: 0 };

  const variableSkus = new Set();
  const productTypes = new Map();
  rows.forEach(row => {
    const rowObj = {};
    headers.forEach((header, index) => { if (header) rowObj[header.trim()] = row[index]; });
    const itemVal = String(rowObj['Item'] || "").trim();
    const typeVal = rowObj['Tipo'] ? String(rowObj['Tipo']).toLowerCase() : "";
    if (itemVal) {
      const normalizedItem = itemVal.toUpperCase();
      productTypes.set(normalizedItem, typeVal);
      if (typeVal === 'variable') variableSkus.add(normalizedItem);
    }
  });

  rows.forEach(row => {
    const rowObj = {};
    headers.forEach((header, index) => { if (header) rowObj[header.trim()] = row[index]; });

    const transformedRow = new Array(CONFIG.WC_HEADERS.length).fill("");
    const setVal = (wcColName, value) => {
      const idx = CONFIG.WC_HEADERS.indexOf(wcColName);
      if (idx !== -1) {
        transformedRow[idx] = value || "";
        if (value && String(value).trim() !== "") mappedIndices.add(idx);
      }
    };

    const productType = rowObj['Tipo'] ? rowObj['Tipo'].toLowerCase() : "";
    setVal("Product Id", "");
    setVal("Product Variation Id", "");
    setVal("Visibilidad en el catálogo", "visible");

    const itemVal = String(rowObj['Item'] || "").trim();
    const generatedSku = itemVal ? itemVal.toUpperCase() : (rowObj['ID'] ? `ID-${rowObj['ID']}`.toUpperCase() : "");
    setVal("SKU", generatedSku);

    const parentIdx = headers.findIndex(h => h && h.toLowerCase().trim() === 'variable padre');
    let parentVal = (parentIdx !== -1) ? String(row[parentIdx] || "").trim() : "";
    let finalParent = parentVal ? parentVal.toUpperCase() : "";

    if (productType === 'variation') {
      if (parentVal) {
        if (!variableSkus.has(finalParent)) quality.brokenParents++;
      } else {
        quality.brokenParents++;
      }
    }
    setVal("Parent", finalParent);
    setVal("Tipo", rowObj['Tipo']);
    setVal("Nombre", rowObj['Nombre/titulo']);
    setVal("Categorías", rowObj['Categoria WooCommerce']);

    const targetShortDesc = (mode === 'minorista') ? 'descripcion corta MINORISTA FINAL AUTOMATICA' : 'descripcion corta MAYORISTA FINAL AUTOMATICA';
    let shortDescValue = "";
    const idxFinal = headers.findIndex(h => h && h.toLowerCase().trim() === targetShortDesc);
    const idxManual = headers.findIndex(h => h && h.toLowerCase().trim() === 'descripcion corta manual');
    const idxAuto = headers.findIndex(h => h && h.toLowerCase().trim() === 'descripcion corta AUTOMATICA');

    if (idxFinal !== -1 && row[idxFinal]) shortDescValue = row[idxFinal];
    else if (idxManual !== -1 && row[idxManual]) shortDescValue = row[idxManual];
    else if (idxAuto !== -1 && row[idxAuto]) shortDescValue = row[idxAuto];

    if (!shortDescValue) quality.missingShortDesc++;
    setVal("Descripción corta", shortDescValue);
    setVal("Descripción", rowObj['Descripción Larga FINAL AUTOMATICA']);

    if (mode === 'minorista') {
      setVal("Precio normal", rowObj['Precios Minorista']);
      setVal("Precio rebajado", rowObj['Precios oferta minorista']);
      setVal("Publicado", rowObj['Publicada Minorista']);
      setVal("¿Existencias?", rowObj['Existencias Minorista']);
      setVal("Inventario", rowObj['Inventario Minorista']);
      setVal("Cantidad de bajo inventario", rowObj['Cantidad de bajo inventario Minorista']);
    } else {
      setVal("Precio normal", rowObj['Precios Mayorista']);
      setVal("Precio rebajado", rowObj['Precios oferta Mayorista']);
      setVal("Publicado", rowObj['Publicada Mayorista']);
      setVal("¿Existencias?", rowObj['Existencias Mayorista']);
      setVal("Inventario", rowObj['Inventario Mayorista']);
      setVal("Cantidad de bajo inventario", rowObj['Cantidad de bajo inventario Mayorista']);
    }

    setVal("Día en que empieza el precio rebajado", rowObj['Día en que empieza el precio rebajado']);
    setVal("Día en que termina el precio rebajado", rowObj['Día en que termina el precio rebajado']);
    setVal("Peso (kg)", rowObj['Correo - Peso (kg)']);
    setVal("Longitud (cm)", rowObj['Correo - Longitud (cm)']);
    setVal("Anchura (cm)", rowObj['Correo - Ancho (cm)']);
    setVal("Altura (cm)", rowObj['Correo - Altura (cm)']);
    setVal("Clase de envío", rowObj['Clase de envío']);

    const imageCols = ['Imágenes Principal', 'Imágenes Galeria 1', 'Imágenes Galeria 2', 'Imágenes Galeria 3', 'Imágenes Galeria 4'];
    const imgs = imageCols.filter(col => rowObj[col] && String(rowObj[col]).trim() !== "").map(col => rowObj[col]);
    setVal("Imágenes", imgs.join(", "));

    const colorVal = rowObj['Variable Color / Terminación'] || "";
    if (colorVal) setVal("Swatches Attributes", `Color|${colorVal}`);

    setVal("Insert", normalizeControlValue(rowObj['Insert'], 'Insert', generatedSku));
    setVal("Update", normalizeControlValue(rowObj['Update'], 'Update', generatedSku));
    setVal("Delete", normalizeControlValue(rowObj['Delete'], 'Delete', generatedSku));

    if (productType === 'variation') variations.push(transformedRow); else parents.push(transformedRow);
  });

  return { data: [CONFIG.WC_HEADERS, ...parents, ...variations], mappedColsCount: mappedIndices.size, quality };
}

/**
 * Actualiza el contenido de una hoja de Google Sheet.
 */
function updateSheet(sheetId, sheetName, data) {
  try {
    const ss = SpreadsheetApp.openById(sheetId);
    let sheet = ss.getSheetByName(sheetName) || ss.getSheets()[0];
    sheet.clear();
    sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
  } catch (e) {
    console.error(`Error actualizando hoja ${sheetName} en ${sheetId}: ` + e.message);
  }
}

/**
 * Sincroniza la pestaña de atributos en la hoja de destino.
 */
function syncAttributes(sheetId, attrData, commands) {
  try {
    const ss = SpreadsheetApp.openById(sheetId);
    let sheet = ss.getSheetByName(CONFIG.ATTRIBUTES_SHEET_NAME) || ss.insertSheet(CONFIG.ATTRIBUTES_SHEET_NAME);
    const headers = ["Attribute ID", "Attribute Name", "Attribute Label", "Attribute Type", "Attribute Orderby", "Attribute Terms", "Insert", "Update", "Delete"];
    const data = [
      headers,
      ["pa_color", "Color / Terminación", "Color / Terminación", "select", "menu_order", attrData.colors.join(", "), ...commands],
      ["pa_size", "Tamaño", "Tamaño", "select", "menu_order", attrData.sizes.join(", "), ...commands]
    ];
    sheet.clear();
    sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
  } catch (e) {
    console.error(`Error sincronizando atributos en ${sheetId}: ` + e.message);
  }
}

/**
 * Lee los comandos de Insert/Update/Delete de la primera fila del maestro
 * para aplicarlos a la definición de los atributos globales.
 */
function getAttributeCommandsFromMaster(headers, rows) {
  if (rows.length === 0) return ["1", "1", "0"];
  const firstRow = rows[0];
  const rowObj = {};
  headers.forEach((h, i) => { if(h) rowObj[h.trim()] = firstRow[i]; });
  return [
    normalizeControlValue(rowObj['Insert'], 'Insert (Global)', 'GLOBAL'),
    normalizeControlValue(rowObj['Update'], 'Update (Global)', 'GLOBAL'),
    normalizeControlValue(rowObj['Delete'], 'Delete (Global)', 'GLOBAL')
  ];
}

/**
 * Extrae todos los valores únicos de Color y Tamaño para poblar el diccionario de atributos.
 */
function extractUniqueAttributes(headers, rows) {
  const uniqueColors = [];
  const uniqueSizes = [];
  rows.forEach(row => {
    const rowObj = {};
    headers.forEach((h, i) => { if(h) rowObj[h.trim()] = row[i]; });
    if (rowObj['Variable Color / Terminación']) uniqueColors.push(rowObj['Variable Color / Terminación']);
    if (rowObj['Variable Tamaño']) uniqueSizes.push(rowObj['Variable Tamaño']);
  });
  return {
    colors: [...new Set(uniqueColors)].filter(Boolean).sort(),
    sizes: [...new Set(uniqueSizes)].filter(Boolean).sort()
  };
}

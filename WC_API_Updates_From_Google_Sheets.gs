/**
 * WooCommerce Professional Sync Engine (VERSION 5.0 - MODULAR)
 * 
 * This framework decouples data extraction from synchronization logic.
 * Designed to manage large-scale product catalogs across multiple WooCommerce stores.
 */

// --- CONFIGURATION (Placeholders for agnostic use) ---
const CONFIG = {
  MASTER_SHEET_ID: "YOUR_MASTER_SHEET_ID",
  MASTER_SHEET_NAME: "Master Tab Name",

  STORES: {
    store_1: {
      name: "Store 1",
      url: "https://store1.com",
      ck: "ck_...",
      cs: "cs_...",
      logEndpoint: "https://store1.com/wp-json/sync/v1/log",
      sheetId: "INTERMEDIATE_SHEET_ID_1",
      mode: "retail"
    }
  },

  PRODUCTS_SHEET_NAME: "All Products",
  ATTRIBUTES_SHEET_NAME: "Product Attributes",

  API_MAPPING: {
    "Product Name": "name",
    "Short Description": "short_description",
    "Long Description": "description",
    "Regular Price": "regular_price",
    "Sale Price": "sale_price",
    "SKU": "sku",
    "Published": "status",
    "Catalog Visibility": "catalog_visibility",
    "Inventory": "stock_quantity",
    "In Stock?": "stock_status",
    "Categories": "categories",
    "Images": "images"
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
 * Main Synchronization Orchestrator
 */
function mainSync() {
  try {
    const ssMaster = SpreadsheetApp.openById(CONFIG.MASTER_SHEET_ID);
    const sheetMaster = ssMaster.getSheetByName(CONFIG.MASTER_SHEET_NAME);
    if (!sheetMaster) throw new Error(`Tab ${CONFIG.MASTER_SHEET_NAME} not found.`);
    
    const data = sheetMaster.getDataRange().getValues();
    const headers = data[0];
    const rows = data.slice(1);

    const attrCommands = getAttributeCommandsFromMaster(headers, rows);
    const uniqueAttributes = extractUniqueAttributes(headers, rows);

    for (const storeKey in CONFIG.STORES) {
      const store = CONFIG.STORES[storeKey];
      
      // EXTRACTOR: Sheets only (as per requested scope)
      const transformed = transformData(headers, rows, store.mode);
      updateSheet(store.sheetId, CONFIG.PRODUCTS_SHEET_NAME, transformed.data);
      syncAttributes(store.sheetId, uniqueAttributes, attrCommands);

      const remoteState = fetchWooCommerceState(store);
      const allChanges = contrastState(transformed.data, remoteState);

      const changesParents = { create: [], update: [], delete: [] };
      const changesVariations = { create: [], update: [], delete: [] };

      const distributeChanges = (list, target) => {
        list.forEach(item => {
          const sku = item.sku ? item.sku.toUpperCase() : "";
          const row = transformed.data.slice(1).find(r => r[3] === sku);
          if (row && row[2] === 'variation') changesVariations[target].push(item);
          else changesParents[target].push(item);
        });
      };

      distributeChanges(allChanges.create, 'create');
      distributeChanges(allChanges.update, 'update');
      distributeChanges(allChanges.delete, 'delete');

      const checkpointKey = `last_sku_${storeKey}`;
      const resultsParents = pushChangesUnitary(store, changesParents, checkpointKey);
      const resultsVars = pushChangesUnitary(store, changesVariations, checkpointKey);

      const totalResults = {
        inserted: resultsParents.inserted + resultsVars.inserted,
        updated: resultsParents.updated + resultsVars.updated,
        deleted: resultsParents.deleted + resultsVars.deleted,
        errors: resultsParents.errors + resultsVars.errors
      };

      sendSyncLog(store, totalResults);
    }
  } catch (e) {
    console.error(`Sync Error: ${e.message}`);
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
    if (products.length === 0) hasMore = false;
    else { products.forEach(p => { if (p.sku) state[p.sku.toUpperCase()] = p; }); page++; }
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
    const insert = rowObj['Insert'] === '1';
    const update = rowObj['Update'] === '1';
    const del = rowObj['Delete'] === '1';
    const remoteProduct = remoteState[sku];
    if (insert && !remoteProduct) changes.create.push(mapToApiJson(rowObj));
    else if (update && remoteProduct) {
      if (hasChanged(rowObj, remoteProduct)) {
        const updateData = mapToApiJson(rowObj);
        updateData.id = remoteProduct.id;
        changes.update.push(updateData);
      }
    } else if (del && remoteProduct) changes.delete.push({ id: remoteProduct.id });
  });
  return changes;
}

function hasChanged(localRow, remoteProduct) {
  for (const [localKey, remoteKey] of Object.entries(CONFIG.API_MAPPING)) {
    const localVal = String(localRow[localKey] || "").trim();
    const remoteVal = String(remoteProduct[remoteKey] || "").trim();
    let normalizedLocal = localVal;
    if (localKey === "Published") normalizedLocal = (localVal === "1" || localVal.toLowerCase() === "si") ? "publish" : "draft";
    else if (localKey === "In Stock?") normalizedLocal = (localVal === "1" || localVal.toLowerCase() === "si") ? "instock" : "outofstock";
    if (normalizedLocal !== remoteVal) return true;
  }
  return false;
}

function mapToApiJson(rowObj) {
  const json = {};
  for (const [csvHeader, apiKey] of Object.entries(CONFIG.API_MAPPING)) {
    let val = rowObj[csvHeader];
    if (csvHeader === "Published") val = (val === "1" || String(val).toLowerCase() === "si") ? "publish" : "draft";
    else if (csvHeader === "Categories") val = val ? [{ name: val }] : [];
    else if (csvHeader === "Images") val = val ? val.split(", ").map(url => ({ src: url.trim() })) : [];
    else if (csvHeader === "In Stock?") val = (val === "1" || String(val).toLowerCase() === "si") ? "instock" : "outofstock";
    if (apiKey === "regular_price" || apiKey === "sale_price") val = cleanPrice(val);
    json[apiKey] = val;
  }
  if (rowObj['Tipo'] && rowObj['Tipo'].toLowerCase() === 'variation') {
    const attributes = [];
    const attrMap = { 'Variable Color': 'pa_color', 'Variable Size': 'pa_size', 'Variable Diameter': 'pa_diameter', 'Variable Model': 'pa_model' };
    for (const [masterCol, apiAttr] of Object.entries(attrMap)) {
      const val = rowObj[masterCol];
      if (val) attributes.push({ name: apiAttr, option: String(val).trim() });
    }
    json.attributes = attributes;
  }
  return json;
}

function cleanPrice(val) {
  if (val === null || val === undefined || val === "") return "";
  let price = String(val).trim().replace(/[$\\s]/g, "");
  if (price.includes(".") && price.includes(",")) {
    const dotIdx = price.indexOf(".");
    const commaIdx = price.indexOf(",");
    if (dotIdx < commaIdx) price = price.replace(/\\./g, "").replace(",", ".");
    else price = price.replace(/,/g, "");
  } else if (price.includes(",")) price = price.replace(",", ".");
  price = price.replace(/[^0-9.]/g, "");
  if (price !== "" && !isNaN(parseFloat(price))) price = parseFloat(price).toFixed(2);
  return price;
}

function pushChangesUnitary(store, changes, checkpointKey = null) {
  let successCount = 0;
  let errorCount = 0;
  const startTime = new Date().getTime();
  const getProductIdBySku = (sku) => {
    const url = `${store.url}/wp-json/wc/v3/products?sku=${sku}&consumer_key=${store.ck}&consumer_secret=${store.cs}`;
    try {
      const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (response.getResponseCode() === 200) {
        const products = JSON.parse(response.getContentText());
        return products.length > 0 ? products[0].id : null;
      }
    } catch (e) { console.error(`Error ID SKU ${sku}: ${e.message}`); }
    return null;
  };
  const processItem = (item, type, index, total) => {
    if (checkpointKey) {
      const currentTime = new Date().getTime();
      if (currentTime - startTime > 300000) {
        PropertiesService.getScriptProperties().setProperty(checkpointKey, item.sku);
        return 'TIMEOUT';
      }
    }
    let url = `${store.url}/wp-json/wc/v3/products`;
    let method = "post";
    let payload = item;
    const sku = item.sku || "S/SKU";
    if (type === 'update') { url += `/${item.id}`; method = "put"; }
    else if (type === 'delete') { url += `/${item.id}`; method = "delete"; payload = null; }
    const options = { method: method, contentType: "application/json", payload: payload ? JSON.stringify(payload) : null, muteHttpExceptions: true };
    const finalUrl = `${url}?consumer_key=${store.ck}&consumer_secret=${store.cs}`;
    try {
      const response = UrlFetchApp.fetch(finalUrl, options);
      const responseCode = response.getResponseCode();
      const responseText = response.getContentText();
      if (responseCode === 200 || responseCode === 201) {
        successCount++;
        console.log(`[${index + 1}/${total}] ✅ ${type.toUpperCase()}: ${sku}`);
      } else {
        if (type === 'create' && responseText.includes("woocommerce_rest_product_not_created")) {
          const existingId = getProductIdBySku(sku);
          if (existingId) {
            const updateUrl = `${store.url}/wp-json/wc/v3/products/${existingId}?consumer_key=${store.ck}&consumer_secret=${store.cs}`;
            const updateResp = UrlFetchApp.fetch(updateUrl, { method: "put", contentType: "application/json", payload: JSON.stringify(item), muteHttpExceptions: true });
            if (updateResp.getResponseCode() === 200) { successCount++; console.log(`[${index + 1}/${total}] ✅ RESCUED: ${sku}`); Utilities.sleep(1000); return; }
          }
        }
        errorCount++;
        console.error(`[${index + 1}/${total}] ❌ ${type.toUpperCase()} FAIL: ${sku} - ${responseCode}`);
      }
    } catch (e) { errorCount++; console.error(`🚨 Error ${sku}: ${e.message}`); }
    Utilities.sleep(1000);
  };
  let filteredCreate = changes.create;
  let filteredUpdate = changes.update;
  let filteredDelete = changes.delete;
  if (checkpointKey) {
    const lastSku = PropertiesService.getScriptProperties().getProperty(checkpointKey);
    if (lastSku) {
      let found = false;
      filteredCreate = changes.create.filter(item => {
        if (found) return true;
        if (item.sku === lastSku) { found = true; return false; }
        return false;
      });
    }
  }
  filteredCreate.forEach((item, i) => { if (processItem(item, 'create', i, filteredCreate.length) === 'TIMEOUT') return; });
  filteredUpdate.forEach((item, i) => processItem(item, 'update', i, filteredUpdate.length));
  filteredDelete.forEach((item, i) => processItem(item, 'delete', i, filteredDelete.length));
  return { inserted: successCount, updated: successCount, deleted: successCount, errors: errorCount };
}

function sendSyncLog(store, results) {
  const payload = { execution_date: new Date().toISOString(), inserted: results.inserted, updated: results.updated, deleted: results.deleted, errors: results.errors, store: store.name };
  try { UrlFetchApp.fetch(store.logEndpoint, { method: "post", contentType: "application/json", payload: JSON.stringify(payload), muteHttpExceptions: true }); } catch (e) {}
}

function normalizeControlValue(value, columnHeader, sku) {
  const strVal = String(value || "").trim();
  return (strVal === "1") ? "1" : "0";
}

function transformData(headers, rows, mode) {
  const parents = [];
  const variations = [];
  const mappedIndices = new Set();
  const variableSkus = new Set();
  const variationsByParent = new Map();

  rows.forEach(row => {
    const rowObj = {};
    headers.forEach((header, index) => { if (header) rowObj[header.trim()] = row[index]; });
    const itemVal = String(rowObj['Item'] || "").trim();
    const typeVal = rowObj['Tipo'] ? String(rowObj['Tipo']).toLowerCase() : "";
    if (itemVal) {
      const normalizedItem = itemVal.toUpperCase();
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
        let finalVal = value || "";
        if (typeof finalVal === 'string' && (finalVal.includes(',') || finalVal.includes('"') || finalVal.includes('\\n') || finalVal.includes('\\r'))) {
          finalVal = `"${finalVal.replace(/"/g, '""')}"`;
        }
        transformedRow[idx] = finalVal;
        if (value && String(value).trim() !== "") mappedIndices.add(idx);
      }
    };

    const productType = rowObj['Tipo'] ? rowObj['Tipo'].toLowerCase() : "simple";
    setVal("Product Id", "");
    setVal("Product Variation Id", "");
    setVal("Visibilidad en el catálogo", "visible");
    const itemVal = String(rowObj['Item'] || "").trim();
    const generatedSku = itemVal ? itemVal.toUpperCase() : "";
    setVal("SKU", generatedSku);

    const parentIdx = headers.findIndex(h => h && h.toLowerCase().trim() === 'padre');
    let parentVal = (parentIdx !== -1) ? String(row[parentIdx] || "").trim() : "";
    let finalParent = parentVal ? parentVal.toUpperCase() : "";
    setVal("Superior", finalParent);
    setVal("Tipo", rowObj['Tipo']);
    setVal("Nombre", rowObj['Nombre/titulo']);
    setVal("Categorías", rowObj['Categoria WooCommerce']);

    if (mode === 'minorista') {
      setVal("Precio normal", cleanPrice(rowObj['Precios Minorista']));
      setVal("Precio rebajado", cleanPrice(rowObj['Precios oferta minorista']));
      setVal("Publicado", rowObj['Publicada Minorista']);
      setVal("¿Existencias?", rowObj['Existencias Minorista']);
      setVal("Inventario", rowObj['Inventario Minorista']);
      setVal("Cantidad de bajo inventario", rowObj['Cantidad de bajo inventario Minorista']);
    } else {
      setVal("Precio normal", cleanPrice(rowObj['Precios Mayorista']));
      setVal("Precio rebajado", cleanPrice(rowObj['Precios oferta Mayorista']));
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
    const colorVal = rowObj['Color / Terminación'] || rowObj['Variable Color / Terminación'] || "";
    if (colorVal) setVal("Swatches Attributes", `Color|${colorVal}`);

    setVal("Insert", normalizeControlValue(rowObj['Insert'], 'Insert', generatedSku));
    setVal("Update", normalizeControlValue(rowObj['Update'], 'Update', generatedSku));
    setVal("Delete", normalizeControlValue(rowObj['Delete'], 'Delete', generatedSku));

    if (productType === 'variation') {
      variations.push(transformedRow);
      if (finalParent) {
        if (!variationsByParent.has(finalParent)) variationsByParent.set(finalParent, []);
        variationsByParent.get(finalParent).push(transformedRow);
      }
    } else {
      parents.push(transformedRow);
    }
  });

  const skuIdx = CONFIG.WC_HEADERS.indexOf("SKU");
  const typeIdx = CONFIG.WC_HEADERS.indexOf("Tipo");
  const attrConfigs = [
    { name: "col-ter", valCol: 'Variable Color / Terminación', fallbackCol: 'Color / Terminación' },
    { name: "diam", valCol: 'Variable Diametro' },
    { name: "modelo", valCol: 'Variable Modelo' },
    { name: "tamano", valCol: 'Variable Tamaño' }
  ];
  attrConfigs.forEach((cfg, i) => {
    const attrValIdx = CONFIG.WC_HEADERS.indexOf(`Valor(es) del atributo ${i+1}`);
    if (attrValIdx === -1) return;
    parents.forEach(parentRow => {
      const parentSku = parentRow[skuIdx];
      if (parentRow[typeIdx] === 'variable') {
        const currentVal = parentRow[attrValIdx];
        if (currentVal && String(currentVal).trim() !== "") return;
        const children = variationsByParent.get(parentSku) || [];
        const values = new Set();
        children.forEach(c => { if(c[attrValIdx]) values.add(String(c[attrValIdx]).trim()); });
        if (values.size > 0) parentRow[attrValIdx] = [...values].join(" | ");
      }
    });
  });

  const finalData = [CONFIG.WC_HEADERS];
  const processedSkus = new Set();
  parents.forEach(parentRow => {
    const pSku = parentRow[skuIdx];
    finalData.push(parentRow);
    processedSkus.add(pSku);
    const children = variationsByParent.get(pSku) || [];
    children.forEach(cRow => {
      finalData.push(cRow);
      processedSkus.add(cRow[skuIdx]);
    });
  });
  variations.forEach(vRow => {
    if (!processedSkus.has(vRow[skuIdx])) finalData.push(vRow);
  });

  return { data: finalData, mappedColsCount: mappedIndices.size };
}

function updateSheet(sheetId, sheetName, data) {
  try {
    const ss = SpreadsheetApp.openById(sheetId);
    let sheet = ss.getSheetByName(sheetName) || ss.getSheets()[0];
    sheet.clear();
    sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
  } catch (e) {
    console.error(`Error actualizando hoja ${sheetName}: ${e.message}`);
  }
}

function syncAttributes(sheetId, attrData, commands) {
  try {
    const ss = SpreadsheetApp.openById(sheetId);
    let sheet = ss.getSheetByName(CONFIG.ATTRIBUTES_SHEET_NAME) || ss.insertSheet(CONFIG.ATTRIBUTES_SHEET_NAME);
    const headers = ["Attribute ID", "Attribute Name", "Attribute Label", "Attribute Type", "Attribute Orderby", "Attribute Terms", "Insert", "Update", "Delete"];
    const data = [
      headers,
      ["pa_color", "Color / Terminación", "Color / Terminación", "select", "menu_order", attrData.colors.join(", "), ...commands],
      ["pa_size", "Tamaño", "Tamaño", "select", "menu_order", attrData.sizes.join(", "), ...commands],
      ["pa_diametro", "Diametro", "Diametro", "select", "menu_order", attrData.diametros.join(", "), ...commands],
      ["pa_modelo", "Modelo", "Modelo", "select", "menu_order", attrData.modelos.join(", "), ...commands]
    ];
    sheet.clear();
    sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
  } catch (e) {
    console.error(`Error sincronizando atributos en ${sheetId}: ${e.//Sincronización de atributos en ${sheetId}: ${e.message}`);
  }
}

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

function extractUniqueAttributes(headers, rows) {
  const attrs = { colors: [], sizes: [], diametros: [], modelos: [] };
  rows.forEach(row => {
    const rowObj = {};
    headers.forEach((header, index) => { if (header) rowObj[header.trim()] = row[index]; });
    if (rowObj['Variable Color / Terminación']) attrs.colors.push(rowObj['Variable Color / Terminación']);
    if (rowObj['Variable Tamaño']) attrs.sizes.push(rowObj['Variable Tamaño']);
    if (rowObj['Variable Diametro']) attrs.diametros.push(rowObj['Variable Diametro']);
    if (rowObj['Variable Modelo']) attrs.modelos.push(rowObj['Variable Modelo']);
  });
  return {
    colors: [...new Set(attrs.colors)].filter(Boolean).sort(),
    sizes: [...new Set(attrs.sizes)].filter(Boolean).sort(),
    diametros: [...new Set(attrs.diametros)].filter(Boolean).sort(),
    modelos: [...new Set(attrs.modelos)].filter(Boolean).sort()
  };
}

/**
 * WooCommerce API Sync Engine (AGNOSTIC VERSION)
 * 
 * This engine transforms data from a Master Google Sheet into a WooCommerce-ready 
 * intermediate format, ensuring strict hierarchical ordering (Parent -> Child) 
 * and full attribute saturation for error-free manual or API imports.
 */

const CONFIG = {
  MASTER_SHEET_ID: "YOUR_MASTER_SHEET_ID",
  MASTER_SHEET_NAME: "Your Master Sheet Name",

  STORES: {
    store1: {
      name: "Store 1",
      url: "https://yourstore1.com",
      ck: "ck_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      cs: "cs_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      logEndpoint: "https://yourstore1.com/wp-json/sync-log/v1/log",
      sheetId: "YOUR_STORE1_SHEET_ID",
      mode: "retail" 
    }
  },

  PRODUCTS_SHEET_NAME: "All Products",
  ATTRIBUTES_SHEET_NAME: "Product Attributes",

  API_MAPPING: {
    "Nombre": "name",
    "Descripción corta": "short_description",
    "Descripción": "description",
    "Precio normal": "regular_price",
    "Precio rebajado": "sale_price",
    "SKU": "sku",
    "Publicado": "status",
    "Visibilidad en el catálogo": "catalog_visibility",
    "Inventario": "stock_quantity",
    "¿Existencias?": "stock_status",
    "Categorías": "categories",
    "Imágenes": "images"
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
    "Swatches Attributes", "Marcas", "Nombre del atributo 1", "Valor(es) del atributo 1", "Atributo visible 1", "Atributo global 1",
    "Nombre del atributo 2", "Valor(es) del atributo 2", "Atributo visible 2", "Atributo global 2",
    "Nombre del atributo 3", "Valor(es) del atributo 3", "Atributo visible 3", "Atributo global 3",
    "Nombre del atributo 4", "Valor(es) del atributo 4", "Atributo visible 4", "Atributo global 4",
    "Meta: _wp_desired_post_slug", "Meta: _wp_page_template", "Meta: _product_video_gallery", "Meta: _product_video_code", "Meta: _product_video_autoplay", "Meta: _et_quantity_type", "Meta: _et_quantity_ranges", "Meta: _sale_price_time_start", "Meta: _sale_price_time_end",
    "Insert", "Update", "Delete"
  ]
};

function generateIntermediateSheets() {
  try {
    const ssMaster = SpreadsheetApp.openById(CONFIG.MASTER_SHEET_ID);
    const sheetMaster = ssMaster.getSheetByName(CONFIG.MASTER_SHEET_NAME);
    if (!sheetMaster) throw new Error(`Master sheet ${CONFIG.MASTER_SHEET_NAME} not found.`);
    const data = sheetMaster.getDataRange().getValues();
    const headers = data[0];
    const rows = data.slice(1);
    const attrCommands = getAttributeCommandsFromMaster(headers, rows);
    const uniqueAttributes = extractUniqueAttributes(headers, rows);
    for (const storeKey in CONFIG.STORES) {
      const store = CONFIG.STORES[storeKey];
      const transformed = transformData(headers, rows, store.mode);
      updateSheet(store.sheetId, CONFIG.PRODUCTS_SHEET_NAME, transformed.data);
      syncAttributes(store.sheetId, uniqueAttributes, attrCommands);
    }
  } catch (e) {
    console.error("Error: " + e.message);
  }
}

function transformData(headers, rows, mode) {
  const parents = [];
  const variations = [];
  const mappedIndices = new Set();
  const variableSkus = new Set();
  const variationsByParent = new Map();

  const attrConfigs = [
    { name: "col-ter", valCol: 'Variable Color / Terminación', fallbackCol: 'Color / Terminación' },
    { name: "diam", valCol: 'Variable Diametro' },
    { name: "modelo", valCol: 'Variable Modelo' },
    { name: "tamano", valCol: 'Variable Tamaño' }
  ];

  rows.forEach(row => {
    const rowObj = {};
    headers.forEach((header, index) => { if (header) rowObj[header.trim()] = row[index]; });
    const itemVal = String(rowObj['Item'] || "").trim().toUpperCase();
    const typeVal = rowObj['Tipo'] ? String(rowObj['Tipo']).toLowerCase() : "";
    if (itemVal && typeVal === 'variable') variableSkus.add(itemVal);
  });

  rows.forEach(row => {
    const rowObj = {};
    headers.forEach((header, index) => { if (header) rowObj[header.trim()] = row[index]; });
    const transformedRow = new Array(CONFIG.WC_HEADERS.length).fill("");
    const setVal = (wcColName, value) => {
      const idx = CONFIG.WC_HEADERS.indexOf(wcColName);
      if (idx !== -1) {
        let finalVal = value || "";
        if (typeof finalVal === 'string' && (finalVal.includes(',') || finalVal.includes('"'))) {
          finalVal = `"${finalVal.replace(/"/g, '""')}"`;
        }
        transformedRow[idx] = finalVal;
        if (value && String(value).trim() !== "") mappedIndices.add(idx);
      }
    };

    const productType = rowObj['Tipo'] ? rowObj['Tipo'].toLowerCase() : "";
    const itemVal = String(rowObj['Item'] || "").trim().toUpperCase();
    setVal("SKU", itemVal);
    setVal("Tipo", rowObj['Tipo']);
    setVal("Nombre", rowObj['Nombre/titulo']);
    setVal("Categorías", rowObj['Categoria WooCommerce']);
    setVal("Visibilidad en el catálogo", "visible");

    const priceCol = mode === 'retail' ? 'Precios Minorista' : 'Precios Mayorista';
    const salePriceCol = mode === 'retail' ? 'Precios oferta minorista' : 'Precios oferta Mayorista';
    const descShortCol = mode === 'retail' ? 'descripcion corta MINORISTA FINAL AUTOMATICA' : 'descripcion corta MAYORISTA FINAL AUTOMATICA';
    
    setVal("Descripción corta", rowObj[descShortCol] || "");
    setVal("Descripción", rowObj['Descripción Larga FINAL AUTOMATICA'] || "");
    setVal("Precio normal", cleanPrice(rowObj[priceCol]));
    setVal("Precio rebajado", cleanPrice(rowObj[salePriceCol]));

    const parentIdx = headers.findIndex(h => h && h.toLowerCase().trim() === 'padre');
    let parentVal = (parentIdx !== -1) ? String(row[parentIdx] || "").trim().toUpperCase() : "";
    setVal("Superior", parentVal);

    attrConfigs.forEach((cfg, i) => {
      const val = rowObj[cfg.valCol] || (cfg.fallbackCol ? rowObj[cfg.fallbackCol] : "");
      setVal(`Nombre del atributo ${i+1}`, cfg.name);
      setVal(`Valor(es) del atributo ${i+1}`, val);
      setVal(`Atributo visible ${i+1}`, "1");
      setVal(`Atributo global ${i+1}`, "1");
    });

    setVal("Insert", normalizeControlValue(rowObj['Insert'], 'Insert', itemVal));
    setVal("Update", normalizeControlValue(rowObj['Update'], 'Update', itemVal));
    setVal("Delete", normalizeControlValue(rowObj['Delete'], 'Delete', itemVal));

    if (productType === 'variation') {
      variations.push(transformedRow);
      if (parentVal) {
        if (!variationsByParent.has(parentVal)) variationsByParent.set(parentVal, []);
        variationsByParent.get(parentVal).push(transformedRow);
      }
    } else {
      parents.push(transformedRow);
    }
  });

  const skuIdx = CONFIG.WC_HEADERS.indexOf("SKU");
  const typeIdx = CONFIG.WC_HEADERS.indexOf("Tipo");
  attrConfigs.forEach((cfg, i) => {
    const attrValIdx = CONFIG.WC_HEADERS.indexOf(`Valor(es) del atributo ${i+1}`);
    parents.forEach(parentRow => {
      const pSku = parentRow[skuIdx];
      if (!pSku || parentRow[typeIdx] !== 'variable') return;
      const children = variationsByParent.get(pSku) || [];
      const values = new Set();
      children.forEach(cRow => {
        const v = cRow[attrValIdx];
        if (v && String(v).trim() !== "") values.add(String(v).trim());
      });
      if (values.size > 0) parentRow[attrValIdx] = [...values].join(", ");
    });
  });

  const finalData = [CONFIG.WC_HEADERS];
  const processedSkus = new Set();
  parents.forEach(pRow => {
    const pSku = pRow[skuIdx];
    finalData.push(pRow);
    processedSkus.add(pSku);
    (variationsByParent.get(pSku) || []).forEach(cRow => {
      finalData.push(cRow);
      processedSkus.add(cRow[skuIdx]);
    });
  });
  variations.forEach(vRow => {
    if (!processedSkus.has(vRow[skuIdx])) finalData.push(vRow);
  });

  return { data: finalData };
}

function cleanPrice(val) {
  if (!val) return "";
  let price = String(val).trim().replace(/[$\\s]/g, "");
  if (price.includes(",") && price.includes(".")) {
    price = price.indexOf(".") < price.indexOf(",") ? price.replace(/\\./g, "").replace(",", ".") : price.replace(/,/g, "");
  } else if (price.includes(",")) {
    price = price.replace(",", ".");
  }
  return price.replace(/[^0-9.]/g, "");
}

function normalizeControlValue(value, col, sku) {
  const s = String(value || "").trim();
  return (s === "1") ? "1" : "0";
}

function updateSheet(id, name, data) {
  const ss = SpreadsheetApp.openById(id);
  const sheet = ss.getSheetByName(name) || ss.getSheets()[0];
  sheet.clear();
  sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
}

function syncAttributes(id, attrData, commands) {
  const ss = SpreadsheetApp.openById(id);
  const sheet = ss.getSheetByName(CONFIG.ATTRIBUTES_SHEET_NAME) || ss.insertSheet(CONFIG.ATTRIBUTES_SHEET_NAME);
  const data = [
    ["Attribute ID", "Attribute Name", "Attribute Label", "Attribute Type", "Attribute Orderby", "Attribute Terms", "Insert", "Update", "Delete"],
    ["pa_color", "Color", "Color", "select", "menu_order", attrData.colors.join(", "), ...commands],
    ["pa_size", "Tamaño", "Tamaño", "select", "menu_order", attrData.sizes.join(", "), ...commands],
    ["pa_diametro", "Diametro", "Diametro", "select", "menu_order", attrData.diametros.join(", "), ...commands],
    ["pa_modelo", "Modelo", "Modelo", "select", "menu_order", attrData.modelos.join(", "), ...commands]
  ];
  sheet.clear();
  sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
}

function getAttributeCommandsFromMaster(headers, rows) {
  if (rows.length === 0) return ["1", "1", "0"];
  const row = rows[0];
  const obj = {};
  headers.forEach((h, i) => { if(h) obj[h.trim()] = row[i]; });
  return [normalizeControlValue(obj['Insert'], 'I', 'G'), normalizeControlValue(obj['Update'], 'U', 'G'), normalizeControlValue(obj['Delete'], 'D', 'G')];
}

function extractUniqueAttributes(headers, rows) {
  const attrs = { colors: [], sizes: [], diametros: [], modelos: [] };
  const normH = headers.map(h => h ? String(h).trim() : '');
  rows.forEach(row => {
    const obj = {};
    normH.forEach((h, i) => { if(h) obj[h] = row[i]; });
    if (obj['Variable Color / Terminación']) attrs.colors.push(obj['Variable Color / Terminación']);
    if (obj['Variable Tamaño']) attrs.sizes.push(obj['Variable Tamaño']);
    if (obj['Variable Diametro']) attrs.diametros.push(obj['Variable Diametro']);
    if (obj['Variable Modelo']) attrs.modelos.push(obj['Variable Modelo']);
  });
  return {
    colors: [...new Set(attrs.colors)].filter(Boolean).sort(),
    sizes: [...new Set(attrs.sizes)].filter(Boolean).sort(),
    diametros: [...new Set(attrs.diametros)].filter(Boolean).sort(),
    modelos: [...new Set(attrs.modelos)].filter(Boolean).sort()
  };
}

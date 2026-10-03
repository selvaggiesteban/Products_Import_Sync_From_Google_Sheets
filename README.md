# WooCommerce API Sync Engine from Google Sheets

A professional, agnostic Google Apps Script framework designed to synchronize product catalogs from a Master Google Sheet to WooCommerce stores. This tool specializes in generating "Anti-Error" intermediate sheets that guarantee perfect manual or API imports.

## 🚀 Core Features

### 🛡️ Anti-Error Import Logic
- **Hierarchical Ordering**: Automatically sorts products in the sequence `Parent Product` $\rightarrow$ `Variations`. This is critical for WooCommerce to correctly associate variations with their parents during import.
- **Attribute Saturation**: Automatically extracts all possible values from child variations and injects them into the parent product. This ensures "Variable" products are correctly recognized and displayed in the store.
- **CSV Standard Alignment**: Generates intermediate sheets based on the official WooCommerce CSV structure (60+ columns), preventing mapping errors.
- **Data Normalization**: Cleans prices, formats strings for CSV safety, and normalizes control flags (Insert/Update/Delete).

### ⚙️ Technical Capabilities
- **State-Aware Sync**: Contrasts local sheet data against remote API state to push only modified records.
- **Checkpoint System**: Uses `PropertiesService` to save progress (`last_sku`), allowing the script to resume after Google Apps Script execution timeouts.
- **Automatic SKU Recovery**: If a "Product already exists" error occurs during creation, the engine automatically performs an ID lookup and converts the request into an update.
- **Multi-Store Support**: Single codebase managing multiple store configurations (Retail/Wholesale).

## 🛠️ Setup & Configuration

1. **Clone the Script**: Copy the content of `WC_API.gs` into your Google Apps Script editor.
2. **Configure `CONFIG` Object**:
   - `MASTER_SHEET_ID`: The ID of your source catalog.
   - `STORES`: Add your WooCommerce consumer keys, secrets, and destination sheet IDs.
   - `API_MAPPING`: Align the Master Sheet column names with the internal API keys.
3. **Prepare Master Sheet**: Ensure your Master Sheet has the required columns: `Item` (SKU), `Tipo` (simple/variable/variation), `Padre` (Parent SKU for variations), and your pricing/description columns.
4. **Run**: Execute `generateIntermediateSheets()` to create the formatted CSV sheets, or `mainSync()` for full API synchronization.

## 🔍 Normalization Details

The engine performs the following transformations to ensure data integrity:
- **Price Cleaning**: Removes currency symbols and handles European/US decimal formats.
- **CSV Escaping**: Wraps values containing commas or quotes in double quotes to prevent row-shifting.
- **Attribute Mapping**: Maps custom Master Sheet columns (e.g., `Variable Color`) to WooCommerce global attributes (e.g., `pa_color`).

## 🆘 Troubleshooting

| Problem | Solution |
|---|---|
| Variations not linked to parent | Ensure the `Padre` column in the Master Sheet contains the exact SKU of the parent. |
| Attributes missing in Store | Verify that attributes are defined in the `Product Attributes` sheet before importing products. |
| Script Timeout | The `mainSync` function uses checkpoints; simply run the function again to resume from the last processed SKU. |
| Product "Simple" instead of "Variable" | The `Attribute Saturation` feature fixes this by populating parent attributes from children. |

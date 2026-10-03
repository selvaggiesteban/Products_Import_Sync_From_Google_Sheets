# WooCommerce Professional Sync Engine

A high-performance synchronization framework built with Google Apps Script (GAS) to manage large-scale product catalogs across multiple WooCommerce stores.

This engine optimizes the flow of data from Google Sheets to the WooCommerce API, ensuring 100% data integrity and overcoming the common limitations of the GAS environment.

## System Architecture

The framework operates as a linear pipeline, ensuring that data is normalized and validated before reaching the WooCommerce API:

[Google Sheet Source] -> [Transformation Engine] -> [Contrast Manager] -> [Unitary Pusher] -> [Logging]

### 1. Data Extraction Strategy
The engine utilizes a high-efficiency reading process for Master Sheets, incorporating intermediate visibility layers to allow user verification before the API push.

### 2. Transformation & Normalization Engine
Ensures a seamless transfer between human-readable data and machine-readable API requirements:
- Hierarchical Ordering: Guarantees a strict Parent -> Variation sequence, mandatory for WooCommerce manual imports and API stability.
- Attribute Saturation: Automatically populates parent product attributes by scanning all associated variations.
- Price Normalization: A robust cleanPrice logic that handles various currency formats and decimal separators.

### 3. Intelligence & Stability Layer
Designed for high-volume catalogs where traditional scripts would fail:
- State-Aware Sync: Downloads the current remote state first and performs a field-by-field diff, pushing only actual changes to minimize API load.
- Checkpoint System: Uses PropertiesService to save progress. If a GAS timeout occurs, the script resumes exactly from the last processed SKU.
- Automatic SKU Recovery: If a product creation fails because the SKU already exists, the system automatically retrieves the Product ID and converts the operation into an Update.

---

## Implementation Guide

### Required Credentials
For each store, the following is required:
- WooCommerce REST API Keys: Consumer Key (ck) and Consumer Secret (cs) with Read/Write permissions.
- Google Spreadsheet IDs: Master Sheet ID and Intermediate Sheet ID.
- Log Endpoint: A WordPress REST endpoint (via the provided plugin) to track execution results.

### Data Mapping (Source -> WooCommerce)
The framework maps source fields to the WooCommerce API v3. Typical mapping includes:

| Source Field (Example) | WC API Key | Purpose |
| :--- | :--- | :--- |
| Product Name | name | Public title |
| Regular Price | regular_price | Standard selling price |
| SKU | sku | Unique identifier (Required) |
| Published | status | publish or draft |
| Inventory | stock_quantity | Numerical stock amount |
| Categories | categories | Categorization arrays |

---

## Setup & Configuration

### 1. WordPress Site Configuration
1. Upload the `woocommerce-api-updates.php` plugin to your `/wp-content/plugins/` directory.
2. Activate the plugin via the WordPress Admin panel.
3. Generate REST API keys: **WooCommerce > Settings > Advanced > REST API**. Ensure the keys have **Read/Write** permissions.

### 2. Google Apps Script Setup
1. Open your Google Spreadsheet.
2. Go to **Extensions > Apps Script**.
3. Create a new script file and paste the contents of `WC_API_Updates_From_Google_Sheets.gs`.
4. Save the project.

### 3. Configuring the CONFIG Object
Locate the `const CONFIG` block at the top of the script and update the following:

- **Global Settings**:
  - `MASTER_SHEET_ID`: The ID of the spreadsheet containing your master catalog.
  - `MASTER_SHEET_NAME`: The exact name of the tab where the data is located.

- **Store-Specific Settings**:
  - `url`: Your store's base URL (e.g., `https://yourstore.com`).
  - `ck` & `cs`: Your WooCommerce Consumer Key and Consumer Secret.
  - `logEndpoint`: The URL provided by the logger plugin (usually `yourstore.com/wp-json/sync/v1/log`).
  - `sheetId`: ID of the spreadsheet used for intermediate verification sheets.

- **Column Mapping**:
  - Update the `API_MAPPING` object to match the headers in your Master Sheet. For example, if your column is named "Product Title", change `"Product Name": "name"` to `"Product Title": "name"`.

### 4. Execution & Maintenance
1. Select the `mainSync` function from the toolbar.
2. Click **Run**.
3. **Handling Timeouts**: Because of Google's execution limits, the script may stop. Simply click **Run** again; the system will read the last processed SKU from `PropertiesService` and resume without duplicating data.

---

## Troubleshooting

### Common Issues & Solutions

**1. "Product already exists" (HTTP 400/500)**
- **Problem**: Attempting to create a product with a SKU that already exists in WooCommerce.
- **Solution**: Integrated **Automatic SKU Recovery**. The engine detects this error, performs a real-time ID lookup by SKU, and automatically switches the operation from `POST` (Create) to `PUT` (Update).

**2. Google Apps Script Execution Timeout**
- **Problem**: GAS scripts have a maximum runtime (usually 6 minutes), which is insufficient for large catalogs.
- **Solution**: **Checkpoint System**. The script saves the last successfully processed SKU in `PropertiesService`. Upon restart, it skips already processed items and resumes exactly where it left off.

**3. Missing Parent Attributes in Variations**
- **Problem**: WooCommerce requires parents of variable products to have defined attributes, or the variations will not be associated correctly.
- **Solution**: **Attribute Saturation**. The transformation engine scans all child variations and automatically "saturates" the parent with the consolidated attribute values before pushing to the API.

**4. Incorrect Product Ordering during Manual Imports**
- **Problem**: Standard exports often group all parents first, then all variations, breaking the hierarchical link in some import tools.
- **Solution**: **Hierarchical Clustering**. The engine refactors the data output so that each child variation is listed immediately after its specific parent.

**5. Price Formatting Errors**
- **Problem**: API rejection due to currency symbols, spaces, or inconsistent decimal separators (comma vs dot).
- **Solution**: **Robust price cleaning**. The `cleanPrice` function strips non-numeric characters and normalizes decimal separators to meet WooCommerce API requirements.

## License
MIT License.

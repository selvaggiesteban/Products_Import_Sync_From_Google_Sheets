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

## Setup & Deployment

### 1. Install the Logging Plugin
Deploy the woocommerce-api-updates.php plugin to your WordPress site to enable execution tracking.

### 2. Deploy the Engine
Copy the WC_API_Updates_From_Google_Sheets.gs code into your Google Apps Script editor.

### 3. Configure
Update the CONFIG object with your store credentials, source IDs, and column mappings.

### 4. Execution
Run the mainSync function. For large catalogs, the system will automatically handle timeouts via the checkpoint system—simply run the function again to resume.

## License
MIT License.

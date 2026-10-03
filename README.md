# WooCommerce Professional Sync Engine

A high-performance, agnostic synchronization framework built with Google Apps Script (GAS) to manage large-scale product catalogs across multiple WooCommerce stores.

This engine decouples data extraction from API execution, allowing catalog management from various sources (Google Sheets or REST API Endpoints) while ensuring 100% data integrity and avoiding the common limitations of the GAS environment.

## System Architecture

The framework operates as a linear pipeline, ensuring that data is normalized and validated before reaching the WooCommerce API:

[Data Source] -> [Transformation Engine] -> [Contrast Manager] -> [Unitary Pusher] -> [Logging]

### 1. Data Source Strategies
The engine is source-agnostic, implementing a strategy pattern for extraction:
- Google Sheets Strategy: High-efficiency reading of Master Sheets with intermediate visibility layers.
- API Endpoint Strategy: Direct integration with external JSON REST APIs for real-time catalog fetching.

### 2. Transformation & Normalization Engine
Ensures a seamless transfer between human-readable data and machine-readable API requirements:
- Hierarchical Ordering: Guarantees a strict Parent -> Variation sequence, mandatory for WooCommerce manual imports and API stability.
- Attribute Saturation: Automatically populates parent product attributes by scanning all associated variations.
- Price Normalization: A robust cleanPrice logic that handles various currency formats and decimal separators.
- State Mapping: Translates human inputs (e.g., "SÍ", "1") into API-standard statuses (publish, instock).

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
- Data Source: Either a Google Sheet ID or a JSON Endpoint URL.
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

# WooCommerce Professional Catalog Synchronizer (Google Sheets to WC API)

A professional-grade synchronization engine built with Google Apps Script (GAS) that allows managing one or multiple WooCommerce stores from a single Master Google Sheet. 

This tool is designed for high-volume catalogs, implementing advanced engineering patterns to overcome the common limitations of the Google Apps Script environment.

## Core Engineering Features

### 1. Checkpoint System (Timeout Prevention)
Google Apps Script has a strict execution time limit. To handle large catalogs, this script implements a **Checkpoint System** using `PropertiesService`. If the execution reaches the safety time limit, it saves the last processed SKU and stops. When restarted, it resumes exactly where it left off.

### 2. Automatic SKU Recovery
Prevents synchronization breaks caused by existing products. If the script attempts to create a product that already exists in WooCommerce, it captures the error, queries the API for the existing Product ID, and automatically converts the operation into an **Update**.

### 3. Dual-Store Architecture (Retail & Wholesale)
Supports multi-tenant synchronization. You can define different pricing, stock, and visibility rules for multiple stores (e.g., a Retail store and a Wholesale store) within the same Master Sheet.

### 4. State-Aware Synchronization
To optimize API usage and speed, the script first downloads the current remote state of the store. It then contrasts the Master Sheet with the remote data and pushes only the **actual changes**, avoiding redundant API calls.

---

## Implementation Guide

### Required Credentials & Access
To implement this automation, you need the following credentials for each store:
- **WooCommerce REST API Keys**: 
    - `Consumer Key (ck)`: Unique identifier for the API user.
    - `Consumer Secret (cs)`: Secret key for authentication.
    - *Permissions*: Must have **Read/Write** access.
- **Google Spreadsheet IDs**:
    - `Master Sheet ID`: The ID of the main database.
    - `Intermediate Sheet ID`: The ID of the store-specific sheet used for visibility.
- **Log Endpoint**:
    - A WordPress URL (e.g., `/wp-json/tay-sync/v1/log`) where the script sends the execution summary.

### Column Mapping (Master Sheet $\rightarrow$ WooCommerce)
The script maps columns from your Master Sheet to the WooCommerce API v3. You must ensure your Master Sheet contains these fields:

| Master Column (Example) | WC API Key | Description |
| :--- | :--- | :--- |
| Product Name | `name` | The public title of the product |
| Short Description | `short_description` | Brief summary for the product page |
| Long Description | `description` | Full detailed description |
| Regular Price | `regular_price` | Standard selling price |
| Sale Price | `sale_price` | Discounted price |
| SKU | `sku` | Unique product identifier (Required) |
| Published | `status` | `1` = publish, `0` = draft |
| Catalog Visibility | `catalog_visibility` | visibility in the store |
| Inventory | `stock_quantity` | Numerical stock amount |
| In Stock? | `stock_status` | `1` = instock, `0` = outofstock |
| Categories | `categories` | Comma-separated category names |
| Images | `images` | Comma-separated image URLs |

---

## Automation Workflow

The synchronization follows a linear, high-efficiency pipeline:

1.  **Data Extraction**: The script reads the `Master Sheet` and identifies all products.
2.  **Transformation**: Based on the store mode (Retail vs Wholesale), it extracts the corresponding prices and stock from the Master and generates a formatted dataset.
3.  **Visibility Layer**: The transformed data is pushed to the `Intermediate Sheet`, allowing the user to verify what will be sent to the API.
4.  **Remote State Fetch**: The script downloads all existing products from the WooCommerce store to create a local map of current SKUs and values.
5.  **Contrast Analysis**: The local data is compared against the remote state to generate a queue of only necessary actions:
    - `Insert`: Product exists in Master but not in WC.
    - `Update`: Product exists in both but values have changed.
    - `Delete`: Product marked for deletion in Master.
6.  **Unitary Push with Recovery**: Changes are sent one by one. If a "Create" fails because the SKU exists, the **Recovery System** finds the ID and executes an "Update".
7.  **Logging**: A final summary (inserted, updated, deleted, errors) is sent to the WordPress log endpoint.

---

## Setup Steps
1. **Install Logger**: Install `products-import-sync-logger.php` as a plugin in your WordPress site.
2. **Prepare Sheets**: Create your Master and Intermediate spreadsheets.
3. **Deploy Script**: Copy `Sincronizador_Generic.gs` into the Google Apps Script editor of your Master Sheet.
4. **Configure**: Fill in the `CONFIG` object with your credentials and column names.
5. **Run**: Execute `mainSync`.

## License
MIT License.

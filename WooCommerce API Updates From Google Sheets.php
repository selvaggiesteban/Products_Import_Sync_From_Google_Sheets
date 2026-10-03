<?php
/**
 * Plugin Name: Products Import Sync Logger
 * Description: Captura logs de sincronización desde Google Apps Script mediante un endpoint REST.
 * Version: 1.0.0
 * Author: Esteban Selvaggi
 */

if (!defined('ABSPATH')) exit;

class Products_Import_Sync_Logger {
    private $table_name;

    public function __construct() {
        global $wpdb;
        $this->table_name = $wpdb->prefix . 'tay_sync_logs';

        register_activation_hook(__FILE__, array($this, 'activate'));
        add_action('rest_api_init', array($this, 'register_routes'));
    }

    public function activate() {
        global $wpdb;
        $charset_collate = $wpdb->get_charset_collate();

        $sql = "CREATE TABLE $this->table_name (
            id mediumint(9) NOT NULL AUTO_INCREMENT,
            execution_date datetime DEFAULT '0000-00-00 00:00:00' NOT NULL,
            inserted int(11) DEFAULT 0 NOT NULL,
            updated int(11) DEFAULT 0 NOT NULL,
            deleted int(11) DEFAULT 0 NOT NULL,
            errors int(11) DEFAULT 0 NOT NULL,
            store varchar(100) DEFAULT '' NOT NULL,
            PRIMARY KEY  (id)
        ) $charset_collate;";

        require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
        dbDelta($sql);
    }

    public function register_routes() {
        register_rest_route('tay-sync/v1', '/log', array(
            'methods' => 'POST',
            'callback' => array($this, 'handle_log'),
            'permission_callback' => '__return_true',
        ));
    }

    public function handle_log($request) {
        global $wpdb;
        $params = $request->get_json_params();

        if (empty($params['store'])) {
            return new WP_Error('no_store', 'Falta el parámetro store', array('status' => 400));
        }

        $wpdb->insert(
            $this->table_name,
            array(
                'execution_date' => $params['execution_date'] ?? current_time('mysql'),
                'inserted'       => $params['inserted'] ?? 0,
                'updated'       => $params['updated'] ?? 0,
                'deleted'       => $params['deleted'] ?? 0,
                'errors'        => $params['errors'] ?? 0,
                'store'          => sanitize_text_field($params['store']),
            )
        );

        return new WP_REST_Response(array('status' => 'success', 'message' => 'Log registrado'), 200);
    }
}

new Products_Import_Sync_Logger();

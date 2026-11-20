<?php
require 'C:/laragon/www/prime-fleet-fresh/wp-load.php';
echo 'env=' . wp_get_environment_type() . PHP_EOL;
$s = get_option( 'prime_fleet_settings', array() );
if ( ! is_array( $s ) ) {
	$s = array();
}
echo 'cloud_setting=' . ( isset( $s['whatsapp_cloud_url'] ) ? $s['whatsapp_cloud_url'] : '(empty)' ) . PHP_EOL;
echo 'key_setting=' . ( isset( $s['whatsapp_license_key'] ) ? $s['whatsapp_license_key'] : '(empty)' ) . PHP_EOL;
echo 'resolved=' . \Prime_Fleet\Messaging\WhatsApp\Cloud_Channel::resolve_base_url( $s ) . PHP_EOL;
$key = 'PF-4EA00705-5CFFA3F5-7042CBDA';
$base = \Prime_Fleet\Messaging\WhatsApp\Cloud_Channel::resolve_base_url( $s );
$res  = wp_remote_post(
	untrailingslashit( $base ) . '/api/v1/validate',
	array(
		'timeout' => 20,
		'headers' => array( 'Content-Type' => 'application/json' ),
		'body'    => wp_json_encode(
			array(
				'license_key' => $key,
				'site_url'    => home_url( '/' ),
			)
		),
	)
);
if ( is_wp_error( $res ) ) {
	echo 'wp_error=' . $res->get_error_message() . PHP_EOL;
	exit( 1 );
}
echo 'http=' . wp_remote_retrieve_response_code( $res ) . PHP_EOL;
echo 'body=' . wp_remote_retrieve_body( $res ) . PHP_EOL;

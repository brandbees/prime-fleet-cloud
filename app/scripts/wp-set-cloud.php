<?php
$s = get_option( 'prime_fleet_settings', array() );
if ( ! is_array( $s ) ) {
	$s = array();
}
$s['whatsapp_channel_enabled'] = 1;
$s['whatsapp_driver']          = 'cloud';
$s['whatsapp_cloud_url']       = 'http://127.0.0.1:3000';
$s['whatsapp_license_key']     = 'PF-C5A7BAB0-C124D087-E6F13FA1';
update_option( 'prime_fleet_settings', $s );

$ch = Prime_Fleet\Messaging\WhatsApp\Channel_Factory::make();
echo 'driver=' . $s['whatsapp_driver'] . PHP_EOL;
echo 'channel=' . ( $ch ? get_class( $ch ) : 'null' ) . PHP_EOL;
echo 'url=' . $s['whatsapp_cloud_url'] . PHP_EOL;
echo 'key=' . substr( $s['whatsapp_license_key'], 0, 14 ) . '...' . PHP_EOL;

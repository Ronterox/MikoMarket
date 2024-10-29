<?php

foreach (file(__DIR__ . '/../.env') as $line) {
    [$name, $val] = explode('=', $line, 2);
    $t = function($s) { return trim($s); };
    putenv("{$t($name)}={$t($val)}");
}

$symbol = filter_var($_GET['symbol'], FILTER_SANITIZE_FULL_SPECIAL_CHARS);

$api_key = getenv('POLYGON_API_KEY');
$base_url = 'https://api.polygon.io/v2/aggs/ticker';

$start_date = '2023-01-09';
$end_date = date('Y-m-d');

$req = "$base_url/$symbol/range/1/day/$start_date/$end_date?apiKey=$api_key";
$cache = __DIR__ . '/../cache/' . md5($req) . '.json';

if (!file_exists($cache)) {
    $json = file_get_contents($req);
    file_put_contents($cache, $json) or die('Cache failed');
} else {
    $json = file_get_contents($cache);
    header('Cache-Control: max-age=86400');
}

$data = json_decode($json, true);

header('Content-Type: application/json');
echo json_encode($data);

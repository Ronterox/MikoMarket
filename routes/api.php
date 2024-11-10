<?php

use LupeCode\phpTraderNative\Trader;

$bd = new SQLite3(CACHE . 'data.db');
$bd->exec('CREATE TABLE IF NOT EXISTS queries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT NOT NULL,
    data TEXT
)');

$symbol = filter_var($_GET['symbol'], FILTER_SANITIZE_FULL_SPECIAL_CHARS);

$api_key = POLYGON_API_KEY;
$base_url = 'https://api.polygon.io/v2/aggs/ticker';

$start_date = '2022-01-09';
$end_date = date('Y-m-d');

$req = "$base_url/$symbol/range/1/day/$start_date/$end_date?adjusted=false&apiKey=$api_key";
$res = $bd->query('SELECT data FROM queries WHERE query = "' . $req . '"') or die($bd->lastErrorMsg());
$row = $res->fetchArray();

if (!$row) {
    $json = file_get_contents($req);
    $bd->exec("INSERT INTO queries (query, data) VALUES ('$req', '$json')") or die($bd->lastErrorMsg());
} else {
    $json = $row['data'];
    header('Cache-Control: max-age=86400');
}

$bd->close();
$data = json_decode($json, true);

$df = [
    'time' => [],
    'close' => [],
    'open' => [],
    'high' => [],
    'low' => [],
];

array_walk($data['results'], function($a) {
    global $df;
    array_push($df['time'], date('Y-m-d', $a['t'] / 1000));
    array_push($df['close'], $a['c']);
    array_push($df['open'], $a['o']);
    array_push($df['high'], $a['h']);
    array_push($df['low'], $a['l']);
}, $data['results']);

$df['sma200'] = Trader::sma($df['close'], 200);
$df['sma50'] = Trader::sma($df['close'], 50);

header('Content-Type: application/json');
echo json_encode($df);

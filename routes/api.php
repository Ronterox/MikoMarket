<?php

use LupeCode\phpTraderNative\Trader;

if (!isset($_REQUEST['symbol'])) {
    $_POST = json_decode(file_get_contents('php://input'), true);
    $_REQUEST['symbol'] = $_POST['symbol'];
}

if (isset($_REQUEST['symbol'])) {
    $bd = new SQLite3(CACHE . 'data.db');
    $bd->exec('CREATE TABLE IF NOT EXISTS queries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT NOT NULL,
    data TEXT
    )');

    $symbol = filter_var($_REQUEST['symbol'], FILTER_SANITIZE_FULL_SPECIAL_CHARS);
    $api_key = POLYGON_API_KEY;
    $base_url = 'https://api.polygon.io/v2/aggs/ticker';

    $start_date = '2023-11-14';
    $end_date = '2024-02-16';

    $multiplier = 3;
    $timespan = 'minute';
    $limit = 50000; # Max: 50000, aggregates is count * multiplier

    $req = "$base_url/$symbol/range/$multiplier/$timespan/$start_date/$end_date?limit=$limit&apiKey=$api_key";
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

    array_walk($data['results'], function ($a) {
        global $df;
        array_push($df['time'], $a['t']);
        array_push($df['close'], $a['c']);
        array_push($df['open'], $a['o']);
        array_push($df['high'], $a['h']);
        array_push($df['low'], $a['l']);
    }, $data['results']);

    header('Content-Type: application/json');
    if ($_SERVER['REQUEST_METHOD'] == 'POST') {
        $ta = $_POST['ta'];
        foreach($ta as $key => $value) {
            foreach ($ta[$key] as $k => $v) {
                try {
                    $ta[$key][$k] = Trader::$key($df['close'], $k);
                } catch (Throwable $th) {
                    echo json_encode(['error' => $th->getMessage()]);
                    return;
                }
            }
        }
        echo json_encode($ta);
    } else {
        echo json_encode($df);
    }
} else {
    header('Content-Type: application/json');
    echo json_encode(['error' => 'No symbol provided']);
}

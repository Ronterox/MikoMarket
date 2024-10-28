<?php
// view('trading');

$json = file_get_contents('https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=IBM&interval=5min&apikey=UI89OO8T48MSWZX2');
$data = json_decode($json, true);

header('Content-Type: application/json');
echo json_encode($data['Time Series (5min)']);

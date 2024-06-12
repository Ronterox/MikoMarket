<?php

require_once 'view.php';

if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    return;
}

global $max;
$max = 15;
$num_candles = filter_input(INPUT_GET, 'num_candles', FILTER_VALIDATE_INT) ?: 10;

$call = filter_input(INPUT_GET, 'call', FILTER_VALIDATE_INT);
$put = filter_input(INPUT_GET, 'put', FILTER_VALIDATE_INT);
$simulate = filter_input(INPUT_POST, 'simulate', FILTER_VALIDATE_BOOLEAN);

if ($call || $put) {
    $id = $call ? 'call' : 'put';
    $value = $call ?? $put;
    $title = ucfirst($id);

    $event = 'setOrder';
    $url = __FILE__;
    header("HX-Trigger: {$event}");

    echo "
    <div
        id='{$id}'
        hx-delete='/candles.php'
        hx-trigger='{$event} from:body'
        hx-swap='delete'>
        <h1>{$title}: {$value}</h1>
    </div>";
    return;
} elseif ($simulate !== null) {
    $speed = filter_input(INPUT_POST, 'speed', FILTER_VALIDATE_FLOAT);
    if ($simulate) {
        echo "
        <button
            class='simulating'
            name='simulate'
            value='false'
        >
            Stop Simulation
            <div
            hx-get='/candles.php?num_candles=1'
            hx-target='#candles'
            hx-swap='beforeend'
            hx-select='#candles > .candle'
            hx-trigger='every {$speed}s'
            ></div>
        </button>
        ";
    } else {
        echo '
        <button
            class="simulation"
            name="simulate"
            value="true"
        >
            Start Simulation
        </button>';
    }
    return;
}

function rng(): int
{
    global $max;
    return rand(-$max, $max - 1) + 1;
}

function rnghigh(): int
{
    global $max;
    return rand($max - 2, $max);
}

function rnglow(): int
{
    global $max;
    return rand(-$max + 2, -$max);
}

$highs = array_map('rnghigh', range(1, $num_candles));
$lows = array_map('rnglow', range(1, $num_candles));
$closes = array_map('rng', range(1, $num_candles));
$opens = array_map('rng', range(1, $num_candles));

$candles = array_map(function ($high, $low, $open, $close) {
    return compact('high', 'low', 'open', 'close');
}, $highs, $lows, $opens, $closes);

view('candles', compact('candles', 'closes'));


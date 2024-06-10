<?php

if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    return;
}

$max = 15;
$num_candles = filter_input(INPUT_GET, 'num_candles', FILTER_VALIDATE_INT) ?: $default_candles;

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
        hx-delete='#'
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

?>

<h1 id='money' hx-swap-oob='true'>Winnings: <?= end($closes) ?></h1>
<section id='candles'>
    <?php
    function orderButton(string $order, int $value)
    {
        return "
        <button
            hx-get='/candles.php?{$order}={$value}'
            hx-target='closest .candle-part'
            hx-swap='beforeend'
            class='{$order}'>
            " . ucfirst($order) . "
        </button>";
    }

    function popover($name, $value)
    {
        return "
        <div class='popover'>
            <h1>{$name}: {$value}</h1>
            " . orderButton('call', $value) ."
            " . orderButton('put', $value) ."
        </div>";
    }

    function candle_part(string $class, int $height, array $popover)
    {
        $popover = array_map(fn ($name, $value) => popover($name, $value), array_keys($popover), $popover);
        return "
        <div class='{$class} candle-part' style='height: {$height}vh;'>
            " . implode('', $popover) . "
        </div>";
    }

    foreach ($candles as $candle) :
        extract($candle);
        $close_high = $close > $open;
        $close_low = !$close_high;
        $class = $close_high ? 'candle-green' : 'candle-red';
    ?>
        <div class="candle">
            <?php
            echo candle_part($class . ' line', $close_high ? abs($high - $close) : abs($high - $open), ['High' => $high]);

            $candle_open = candle_part($class, abs($close - $open) + 1, ['Open' => $open]);
            $candle_close = candle_part($class, abs($open - $close) + 1, ['Close' => $close]);
            echo $close_high ? $candle_close . $candle_open : $candle_open . $candle_close;

            echo candle_part($class . ' line', $close_low ? abs($low - $close) : abs($low - $open), ['Low' => $low]);
            ?>
        </div>
    <?php endforeach ?>
</section>

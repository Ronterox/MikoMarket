<?php

$max = 15;
$num_candles = filter_input(INPUT_GET, 'num_candles', FILTER_VALIDATE_INT) ?: 10;

$start = filter_input(INPUT_GET, 'start', FILTER_VALIDATE_INT);
$simulate = filter_input(INPUT_GET, 'simulate', FILTER_VALIDATE_BOOLEAN);

if ($start) {
    echo "
    <div id='start'>
        <h1>Start: {$start}</h1>
    </div>";
    return;
} elseif ($simulate !== null) {
    if ($simulate) {
        $button = '
            <button
            class="simulating"
            hx-get="/candles.php?simulate=false"
            hx-swap="outerHTML"
            >
                Stop Simulation
                <div
                hx-get="/candles.php?num_candles=1"
                hx-target="#candles"
                hx-swap="beforeend"
                hx-select="#candles > .candle"
                hx-trigger="every 1s"
                ></div>
            </button>
        ';
    } else {
        $button = '
            <button
            class="simulation"
            hx-get="/candles.php?simulate=true"
            hx-swap="outerHTML"
            >Start Simulation</button>
        ';
    }
    echo $button;
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

<section id='candles'>
    <?php
    function popover($name, $value)
    {
        $title = ucfirst($name);
        return "<div class='popover'><h1>{$title}: {$value}</h1></div>";
    }

    function candle_part(int $get_value, string $class, int $height, array $popover)
    {
        $popover = array_map(fn ($name, $value) => popover($name, $value), array_keys($popover), $popover);
        return "
        <div
            hx-get='/candles.php?start={$get_value}'
            hx-swap='beforeend'
            class='{$class}'
            style='height: {$height}vh;'>
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
            echo candle_part($high, $class . ' line', $close_high ? abs($high - $close) : abs($high - $open), ['high' => $high]);

            $candle_open = candle_part($open, $class, abs($close - $open) + 1, ['open' => $open]);
            $candle_close = candle_part($close, $class, abs($open - $close) + 1, ['close' => $close]);
            echo $close_high ? $candle_close . $candle_open : $candle_open . $candle_close;

            echo candle_part($low, $class . ' line', $close_low ? abs($low - $close) : abs($low - $open), ['low' => $low]);
            ?>
        </div>
    <?php endforeach ?>
</section>

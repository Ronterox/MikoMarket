<?php

if (isset($_GET['start'])) {
    $start = filter_input(INPUT_GET, 'start', FILTER_VALIDATE_INT);
    echo "
    <div id='start'>
        <h1>Start: {$start}</h1>
    </div>";
    return;
}

?>

<section id='candles'>
    <?php
    $x = 0;
    $y = 30;

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
        <div class="candle" style="top: <?= $y ?>vh; left: <?= $x ?>vw;">
            <?php
            echo candle_part($high, $class . ' line', $close_high ? abs($high - $close) : abs($high - $open), ['high' => $high]);

            $candle_open = candle_part($open, $class, abs($close - $open), ['open' => $open]);
            $candle_close = candle_part($close, $class, abs($open - $close), ['close' => $close]);
            echo $close_high ? $candle_close . $candle_open : $candle_open . $candle_close;

            echo candle_part($low, $class . ' line', $close_low ? abs($low - $close) : abs($low - $open), ['low' => $low]);
            ?>
        </div>
    <?php
        $x += 1;
    endforeach
    ?>
</section>

<?php

function rng(): int
{
    return rand(3, 10);
}

function rnglow(): int
{
    return rand(1, 3);
}

function rnghigh(): int
{
    return rand(8, 10);
}


$num_candles = 8;

$highs = array_map('rnghigh', range(1, $num_candles));
$lows = array_map('rnglow', range(1, $num_candles));
$ends = array_map('rng', range(1, $num_candles));
$starts = array_map('rng', range(1, $num_candles));

$candles = array_map(function ($high, $low, $start, $end) {
    return compact('high', 'low', 'start', 'end');
}, $highs, $lows, $starts, $ends);

?>

<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Document</title>
    <style>
        .candles {
            min-height: 100vh;
        }

        .candle,
        .candle-red,
        .candle-green {
            width: 10vw;
            height: 40vh;
            display: inline-block;
            position: relative;
            overflow: visible;
        }

        .candle-red {
            background-color: #f00;
        }

        .candle-green {
            background-color: #0f0;
        }

        .line {
            width: 0.5vw;
            margin: 0 45%;
        }

        body {
            cursor: pointer;
        }
    </style>
    <script src="https://unpkg.com/htmx.org/dist/htmx.min.js"></script>
</head>

<body>
    <section class='candles'>
        <?php
        $x = 0;
        $y = 30;

        foreach ($candles as $candle) :
            extract($candle);
            $class = $start > $end ? 'candle-red' : 'candle-green';
        ?>
            <div class="candle" style="top: <?= $y ?>vh; left: <?= $x ?>vw;">
                <div class="<?= $class ?> line" style="height: <?= $high ?>vh;"></div>
                <div class=<?= $class ?> style="height: <?= $start ?>vh;"></div>
                <div class=<?= $class ?> style="height: <?= $end ?>vh;"></div>
                <div class="<?= $class ?> line" style="height: <?= $low ?>vh;"></div>
            </div>
        <?php
            $x += 1;
        endforeach
        ?>
    </section>
</body>

</html>

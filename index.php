<?php

function rng(): int
{
    return rand(1, 10);
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
$closes = array_map('rng', range(1, $num_candles));
$opens = array_map('rng', range(1, $num_candles));

$candles = array_map(function ($high, $low, $open, $close) {
    return compact('high', 'low', 'open', 'close');
}, $highs, $lows, $opens, $closes);

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
            cursor: pointer;
        }

        .candle-red:hover,
        .candle-green:hover {
            z-index: 100;
            box-shadow: 0 0 10px 8px #000;
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

        .popover {
            top: -15%;
            left: 15%;
            display: none;
            position: absolute;
            background-color: #fff;
            border: 1px solid #000;
            padding: 1em;
            z-index: 100;
            white-space: nowrap;
        }

        .candle:hover .popover {
            display: block;
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
            $class = $open > $close ? 'candle-red' : 'candle-green';
        ?>
            <div class="candle" style="top: <?= $y ?>vh; left: <?= $x ?>vw;">
                <div class="<?= $class ?> line" style="height: <?= $high ?>vh;"></div>
                <div class=<?= $class ?> style="height: <?= $open ?>vh;"></div>
                <div class=<?= $class ?> style="height: <?= $close ?>vh;"></div>
                <div class="<?= $class ?> line" style="height: <?= $low ?>vh;"></div>
                <div class="popover">
                    <h1>Open: <?= $open ?></h1>
                    <h1>Close: <?= $close ?></h1>
                </div>
            </div>
        <?php
            $x += 1;
        endforeach
        ?>
    </section>
</body>

</html>

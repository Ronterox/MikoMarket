<?php

$max = 15;

function rng(): int
{
    global $max;
    return rand(-$max, $max - 1) + 1;
}

function rnghigh(): int
{
    global $max;
    return rand($max-2, $max);
}

function rnglow(): int
{
    global $max;
    return rand(-$max+2, -$max);
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
            top: -50%;
            left: 50%;
            display: none;
            position: absolute;
            background-color: #fff;
            border: 1px solid #000;
            padding: 1em;
            z-index: 100;
            white-space: nowrap;
        }

        .candle:hover:nth-of-type(2n) .popover {
            right: 50%;
            left: auto;
        }

        .candle:hover .candle-red,
        .candle:hover .candle-green {
            opacity: 0.5;
        }

        .candle-red:hover,
        .candle-green:hover {
            opacity: 1 !important;
            box-shadow: 0 0 10px 8px #000;
        }

        .candle-red:hover .popover,
        .candle-green:hover .popover {
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

        function popover($name, $value)
        {
            $title = ucfirst($name);
            return "<div class='popover'><h1>{$title}: {$value}</h1></div>";
        }

        foreach ($candles as $candle) :
            extract($candle);
            $close_high = $close > $open;
            $close_low = !$close_high;
            $class = $close_high ? 'candle-green' : 'candle-red';
        ?>
            <div class="candle" style="top: <?= $y ?>vh; left: <?= $x ?>vw;">
                <div class="<?= $class ?> line" style="height: <?= $close_high ? abs($high - $close) : abs($high - $open) ?>vh;">
                    <?= popover('high', $high) ?>
                </div>
                <div class=<?= $class ?> style="height: <?= abs($open - $close) ?>vh;">
                    <?= $close_high ? popover('close', $close) : popover('open', $open) ?>
                </div>
                <div class=<?= $class ?> style="height: <?= abs($close - $open) ?>vh;">
                    <?= $close_low ? popover('close', $close) : popover('open', $open) ?>
                </div>
                <div class="<?= $class ?> line" style="height: <?= $close_low ? abs($low - $close) : abs($low - $open) ?>vh;">
                    <?= popover('low', $low) ?>
                </div>
            </div>
        <?php
            $x += 1;
        endforeach
        ?>
    </section>
</body>

</html>

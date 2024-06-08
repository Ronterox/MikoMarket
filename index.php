<?php

$max = 15;
$num_candles = filter_input(INPUT_POST, 'num_candles', FILTER_VALIDATE_INT) ?: 10;

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

if (isset($_POST['num_candles'])) {
    return require 'candles.php';
}

?>

<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Miko Market</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 0;
        }

        header {
            background-color: #000;
            font-size: 1.2em;
            text-align: center;
            color: #fff;
            padding: 1em;
            position: sticky;
            margin-bottom: 1em;
            top: 0;
        }

        header input {
            width: 5em;
            margin: 0 1em;
            font-size: 1em;
            border: 1px solid #000;
            border-radius: 0.5em;
            padding: 0.5em;
        }

        header button {
            font-size: 1em;
            border: 1px solid #000;
            border-radius: 0.5em;
            padding: 0.5em;
            background-color: #fff;
            cursor: pointer;
        }

        label {
            cursor: pointer;
        }

        button.simulation {
            margin-top: 1em;
        }

        header *:hover {
            color: yellowgreen;
        }

        #candles {
            scroll-snap-type: x mandatory;
            white-space: nowrap;
            overflow-x: scroll;
            overflow-y: visible;
        }

        #start {
            position: absolute;
            white-space: nowrap;
            font-size: 1.5em;
            text-align: center;
            padding: 1em;
            text-shadow: 0 0 10px #000;
            color: yellowgreen;
            z-index: 100;
        }

        .candle,
        .candle-red,
        .candle-green {
            width: 10vw;
            height: 40vh;
            margin: 0 1vw;
            display: inline-block;
            overflow: visible;
            cursor: pointer;
            white-space: normal;
            scroll-snap-align: start;
            scroll-snap-stop: always;
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
    <header>
        <h1>Miko Market</h1>
        <form hx-post="#" hx-swap="outerHTML" hx-target="#candles">
            <label>
                <span>Number of candles:</span>
                <input type="number" name="num_candles" value="<?= $num_candles ?>">
            </label>
            <button>Submit</button>
        </form>
        <button class="simulation">Start Simulation</button>
        <button class="simulation">Stop Simulation</button>
    </header>
    <?php require 'candles.php'; ?>
</body>

</html>

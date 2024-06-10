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

        button.simulation,
        button.simulating {
            margin-top: 1em;
        }

        button.call,
        button.put {
            margin: 0 0.5em;
            padding: 0.5em;
            border: 1px solid #000;
            border-radius: 0.5em;
            cursor: pointer;
        }

        button.call {
            background-color: #0f0;
            color: #000;
        }

        button.put {
            background-color: #f00;
            color: #fff;
        }

        header *:hover {
            color: yellowgreen;
        }

        header:has(.simulating)~#candles {
            scroll-snap-type: x mandatory;
        }

        #candles {
            white-space: nowrap;
            overflow-x: scroll;
            overflow-y: visible;
        }

        #call,
        #put {
            position: absolute;
            white-space: nowrap;
            font-size: 1.5em;
            text-align: center;
            padding: 1em;
            text-shadow: 0 0 10px #000;
            color: yellowgreen;
            z-index: 100;
        }

        #money {
            font-size: 1.5em;
            text-align: center;
            padding: 1em;
            text-shadow: 0 0 10px #000;
            color: yellowgreen;
        }

        .candle,
        .candle-red,
        .candle-green {
            width: 10vw;
            height: 40vh;
            margin: 0 1vw;
            display: inline-block;
            position: relative;
            overflow: visible;
            cursor: pointer;
            white-space: normal;
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
            white-space: nowrap;
            background-color: #fff;
            border: 1px solid #000;
            padding: 1em;
            z-index: 100;
        }

        .candle:hover:nth-of-type(2n) .popover {
            right: 50%;
            left: auto;
        }

        .candle-red:hover,
        .candle-green:hover {
            opacity: 1 !important;
            box-shadow: 0 0 10px 8px #000;
        }

        .candle:hover .candle-red,
        .candle:hover .candle-green {
            opacity: 0.5;
        }

        .candle-red:hover .popover,
        .candle-green:hover .popover {
            display: block;
        }

        .candle:last-child {
            scroll-snap-align: end;
        }
    </style>
    <script src="https://unpkg.com/htmx.org/dist/htmx.min.js"></script>
</head>

<body>
    <header>
        <h1>Miko Market</h1>
        <form hx-get="/candles.php" hx-swap="outerHTML" hx-target="#candles">
            <label>
                <span>Number of candles:</span>
                <input type="number" min="1" max="10000" name="num_candles" value="10">
            </label>
            <button>Submit</button>
        </form>
        <button class="simulation" hx-get="/candles.php?simulate=true" hx-swap="outerHTML">Start Simulation</button>
    </header>
    <?php require 'candles.php'; ?>
</body>

</html>

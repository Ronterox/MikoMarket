<?php

switch ($_SERVER['REQUEST_METHOD']) {
    case 'GET':
        $call = filter_input(INPUT_GET, 'call', FILTER_VALIDATE_INT);
        $put = filter_input(INPUT_GET, 'put', FILTER_VALIDATE_INT);

        if ($call || $put) {
            $value = $call ?? $put;
            $title = $call ? 'Call' : 'Put';
            $event = 'setOrder';

            header("HX-Trigger: {$event}");
            view('candles', compact('value', 'title', 'event'), 'order-tag');
        } else {
            $max_value = 15;
            $num_candles = filter_input(INPUT_GET, 'num_candles', FILTER_VALIDATE_INT) ?? 10;
            $order = filter_input(INPUT_GET, 'order', FILTER_VALIDATE_INT);

            $rng = fn () => rand(-$max_value, $max_value - 1) + 1;
            $rnghigh = fn () => rand($max_value - 2, $max_value);
            $rnglow = fn () => rand(-$max_value + 2, -$max_value);
            $candle_parts = fn ($function) => array_map($function, range(1, $num_candles));

            $highs = $candle_parts($rnghigh);
            $lows = $candle_parts($rnglow);
            $closes = $candle_parts($rng);
            $opens = $candle_parts($rng);

            $candles = array_map(function ($high, $low, $open, $close) {
                return compact('high', 'low', 'open', 'close');
            }, $highs, $lows, $opens, $closes);

            $winnings = $order ? end($closes) - $order : 0;
            view('candles', compact('candles', 'closes', 'winnings'));
        }
        break;
    case 'POST':
        $speed = filter_input(INPUT_POST, 'speed', FILTER_VALIDATE_FLOAT);
        $simulate = filter_input(INPUT_POST, 'simulate', FILTER_VALIDATE_BOOLEAN);
        if ($simulate) {
            view('index', compact('speed'), 'simulating-form');
        } else {
            view('index', [], 'simulation-form');
        }
        break;
    default:
        break;
}

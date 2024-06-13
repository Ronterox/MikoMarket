<?php

function view(string $filename, array $data = [], string $block = null)
{
    $cache = __DIR__ . '/cache/' . md5($filename) . '.php';
    $file = __DIR__ . '/html/' . $filename . '.html';

    $patterns = [
        '/{{\s*(.+?)\s*}}/' => '<?= $1 ?>', // {{ $var }}
        '/@require\s+[\'"](.+)[\'"]/' => '<?php require "routes/$1"; ?>', // @require 'file'
        '/@import\s+[\'"](.+)[\'"]/' => '<?php include "css/$1"; include "css/#$1"; include "css/_$1"; ?>', // @require 'file'
        '/@block\s+.+?@endblock/s' => '', // @block ... @endblock
        '/@foreach\s+(.+?)\s+in\s+(.+?)[\r\n]+(.+?)@endforeach/s' => '<?php foreach($2 as $1): extract($1); ?>$3<?php endforeach; ?>', // @foreach $var in $array ... @endforeach
    ];

    $html = file_get_contents($file);

    $html = preg_replace_callback('/@render\s+(.+)/', function ($renders) use ($html) {
        preg_match("/@block\s+{$renders[1]}\s*(.+?)@endblock/s", $html, $block);
        return $block[1];
    }, $html);

    if ($block) {
        preg_match("/@block\s+{$block}\s*(.+?)@endblock/s", $html, $block);
        $html = $block[1];
    }

    $html = preg_replace(array_keys($patterns), array_values($patterns), $html);

    @mkdir(__DIR__ . '/cache');
    file_put_contents($cache, $html);

    extract($data);
    require $cache;
}

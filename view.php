<?php

function view($filename, $data = [], $block = null)
{
    $cache = __DIR__ . '/cache/' . md5($filename) . '.php';
    $file = __DIR__ . '/html/' . $filename . '.html';

    $patterns = [
        '/{{\s*(.+?)\s*}}/' => '<?= $1 ?>', // {{ $var }}
        '/@require\s+(.+)/' => '<?php require $1; ?>', // @require 'file'
    ];

    $html = file_get_contents($file);
    $html = preg_replace(array_keys($patterns), array_values($patterns), $html);


    @mkdir(__DIR__ . '/cache');
    file_put_contents($cache, $html);

    extract($data);
    require $cache;
}

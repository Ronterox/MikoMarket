<?php

function view(string $filename, array $data = [], string $block = null)
{
    $cache = __DIR__ . '/cache/' . md5($filename) . '.php';
    $file = __DIR__ . '/html/' . $filename . '.html';

    $patterns = [
        '/{{\s*(.+?)\s*}}/' => '<?= $1 ?>', // {{ $var }}
        '/@require\s+(.+)/' => '<?php require $1; ?>', // @require 'file'
        '/@block\s+.+?@endblock/s' => '', // @block ... @endblock
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

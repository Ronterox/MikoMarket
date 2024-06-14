<?php

function dd($var)
{
    echo '<pre>';
    print_r($var);
    echo '</pre>';
}

function render(string $html): callable
{
    return function ($renders) use ($html) {
        $blockname = $renders[1];

        $found = preg_match("/@block\s+{$blockname}\s*(.+?)@endblock/s", $html, $block);
        if (!$found) {
            error_log("Block {$renders[1]} not found");
            return '';
        }

        $block_declaration = preg_split('#\r?\n#', $block[1], 2)[0];
        $block_vars = preg_match_all("/\.(\w+)*/", $block_declaration, $varnames);
        $num_params = preg_match_all('/{{\s*(.+?)\s*}}/', $renders[2] ?? '', $params);

        if ($num_params != $block_vars) {
            error_log("Number of parameters in @render {$blockname} does not match @block {$blockname}");
            return '';
        }

        for ($i = 0; $i < $num_params; $i++) {
            $varname = $varnames[1][$i];
            $param = $params[1][$i];
            $block[1] = preg_replace("/\.{$varname}/", "<?php \${$varname}={$param} ?>", $block[1]);
        }

        return $block[1];
    };
}

function view(string $filename, array $data = [], string $block = null)
{
    $cache = __DIR__ . '/cache/' . md5($filename . $block ?? '') . '.php';
    $file = __DIR__ . '/html/' . $filename . '.html';

    if (file_exists($cache) && filemtime($cache) >= filemtime($file)) {
        // echo "Cached: $cache\n";
        extract($data);
        return require $cache;
    }

    $patterns = [
        '/{{\s*(.+?)\s*}}/' => '<?= $1 ?>', // {{ $var }}
        '/@require\s+[\'"](.+)[\'"]/' => '<?php require "routes/$1"; ?>', // @require 'file'
        '/@import\s+[\'"](.+)[\'"]/' => '<?php include "css/$1"; include "css/#$1"; include "css/_$1"; ?>', // @require 'file'
        '/@block\s+.+?@endblock/s' => '', // @block ... @endblock
        '/@foreach\s+(.+?)\s+in\s+(.+?)[\r\n]+(.+?)@endforeach/s' => '<?php foreach($2 as $1): extract($1); ?>$3<?php endforeach; ?>', // @foreach $var in $array ... @endforeach
        '/@if\s+(.+)/' => '<?php if($1): ?>', // @if $var
        '/@else/' => '<?php else: ?>', // @else
        '/@endif/' => '<?php endif; ?>', // @endif
    ];

    $html = file_get_contents($file);

    $render_tags = fn ($html) => preg_replace_callback('/@render\s+([\w-]+)\s*({{.*}})*/', render($html), $html);
    while (preg_match('/@render\s+([\w-]+)\s*({{.*}})*/', $html)) {
        $html = $render_tags($html);
    }

    if ($block) {
        $found = preg_match("/@block\s+{$block}\s*(.+?)@endblock/s", $html, $match);
        if (!$found) {
            error_log("Block {$block} not found");
            return '';
        }
        $html = $render_tags("@render {$block}" . $match[0]);
    }

    $html = preg_replace(array_keys($patterns), array_values($patterns), $html);

    @mkdir(__DIR__ . '/cache');
    file_put_contents($cache, $html);

    extract($data);
    return require $cache;
}

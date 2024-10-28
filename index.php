<?php

$uri = parse_url($_SERVER['REQUEST_URI'])['path'];

$routes_dir = __DIR__ . '/routes/';
$routes = ['/' => $routes_dir . 'index.php'];

foreach (scandir($routes_dir) as $file) {
    if ($file === '.' || $file === '..') continue;

    $route = substr($file, 0, -4);
    $routes["/{$route}"] = $routes_dir . $file;
}

if (!array_key_exists($uri, $routes)) {
    http_response_code(404);
    die('<h1>404 not found</h1>');
}

require_once 'view.php';
require $routes[$uri];

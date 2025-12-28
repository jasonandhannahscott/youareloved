<?php
session_start();

// Inline auth config
$realPassword = 'zenith1950';
$cookieName = 'zenith_remember_me';
$salt = 'some_random_salt_string';

// Auth check
$isLoggedIn = false;
if (!empty($_SESSION['zenith_auth']) && $_SESSION['zenith_auth'] === true) {
    $isLoggedIn = true;
} elseif (isset($_COOKIE[$cookieName])) {
    if ($_COOKIE[$cookieName] === hash('sha256', $realPassword . $salt)) {
        $_SESSION['zenith_auth'] = true;
        $isLoggedIn = true;
    }
}

if (!$isLoggedIn) {
    http_response_code(401);
    exit('Unauthorized');
}

$file = $_GET['file'] ?? '';

if (empty($file)) {
    http_response_code(400);
    exit('Bad request');
}

$file = urldecode($file);
$file = str_replace(['..', "\0"], '', $file);

$basePath = realpath(__DIR__ . '/protected');
if ($basePath === false) {
    http_response_code(500);
    exit('Protected directory not found');
}

$filePath = $basePath . '/' . $file;
$realFilePath = realpath($filePath);

if ($realFilePath === false || strpos($realFilePath, $basePath) !== 0) {
    http_response_code(404);
    exit('File not found: ' . $file);
}

if (!file_exists($realFilePath) || !is_readable($realFilePath)) {
    http_response_code(404);
    exit('File not readable');
}

$extension = strtolower(pathinfo($realFilePath, PATHINFO_EXTENSION));
$mimeTypes = [
    'json' => 'application/json',
    'mp3' => 'audio/mpeg',
    'mp4' => 'video/mp4',
    'mkv' => 'video/x-matroska',
    'webm' => 'video/webm',
    'jpg' => 'image/jpeg',
    'jpeg' => 'image/jpeg',
    'png' => 'image/png',
    'gif' => 'image/gif',
];

$contentType = $mimeTypes[$extension] ?? 'application/octet-stream';
$fileSize = filesize($realFilePath);

if (in_array($extension, ['mp3', 'mp4', 'mkv', 'webm'])) {
    $start = 0;
    $end = $fileSize - 1;
    
    if (isset($_SERVER['HTTP_RANGE'])) {
        $range = $_SERVER['HTTP_RANGE'];
        if (preg_match('/bytes=(\d+)-(\d*)/', $range, $matches)) {
            $start = intval($matches[1]);
            if (!empty($matches[2])) {
                $end = intval($matches[2]);
            }
        }
        
        http_response_code(206);
        header("Content-Range: bytes $start-$end/$fileSize");
    }
    
    header('Accept-Ranges: bytes');
    header("Content-Length: " . ($end - $start + 1));
    header("Content-Type: $contentType");
    
    $fp = fopen($realFilePath, 'rb');
    fseek($fp, $start);
    
    $bufferSize = 8192;
    $remaining = $end - $start + 1;
    
    while ($remaining > 0 && !feof($fp)) {
        $readSize = min($bufferSize, $remaining);
        echo fread($fp, $readSize);
        $remaining -= $readSize;
        flush();
    }
    
    fclose($fp);
} else {
    header("Content-Type: $contentType");
    header("Content-Length: $fileSize");
    readfile($realFilePath);
}

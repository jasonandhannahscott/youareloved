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
    // Critical for large file streaming
    set_time_limit(0);
    ignore_user_abort(false);
    
    // Clear all output buffers
    while (ob_get_level()) {
        ob_end_clean();
    }
    
    $start = 0;
    $end = $fileSize - 1;
    
    header('Accept-Ranges: bytes');
    header("Content-Type: $contentType");
    
    if (isset($_SERVER['HTTP_RANGE'])) {
        $range = $_SERVER['HTTP_RANGE'];
        if (preg_match('/bytes=(\d*)-(\d*)/', $range, $matches)) {
            $start = $matches[1] !== '' ? intval($matches[1]) : 0;
            $end = $matches[2] !== '' ? intval($matches[2]) : $fileSize - 1;
        }
        
        // Validate range
        if ($start > $end || $start >= $fileSize) {
            http_response_code(416); // Range Not Satisfiable
            header("Content-Range: bytes */$fileSize");
            exit;
        }
        
        $end = min($end, $fileSize - 1);
        
        http_response_code(206);
        header("Content-Range: bytes $start-$end/$fileSize");
    }
    
    $length = $end - $start + 1;
    header("Content-Length: $length");
    
    $fp = fopen($realFilePath, 'rb');
    if (!$fp) {
        http_response_code(500);
        exit('Cannot open file');
    }
    
    fseek($fp, $start);
    
    $bufferSize = 1024 * 256; // 256KB chunks (larger for video)
    $remaining = $length;
    
    while ($remaining > 0 && !feof($fp) && connection_status() === 0) {
        $readSize = min($bufferSize, $remaining);
        $data = fread($fp, $readSize);
        if ($data === false) break;
        echo $data;
        $remaining -= strlen($data);
        flush();
    }
    
    fclose($fp);
    
} else {
    header("Content-Type: $contentType");
    header("Content-Length: $fileSize");
    readfile($realFilePath);
}
<?php

// --- DEBUG SETTINGS ---
// Set to true to enable logging to 'debug_serve.log'
// Set to false when done troubleshooting
$debugMode = false;

function writeLog($message) {
    global $debugMode;
    if ($debugMode) {
        $logFile = __DIR__ . '/debug_serve.log';
        $timestamp = date('Y-m-d H:i:s');
        // Use FILE_APPEND to keep history, usually easier to read on tail -f
        @file_put_contents($logFile, "[$timestamp] $message" . PHP_EOL, FILE_APPEND);
    }
}

// 1. Disable Compression (Crucial for video files)
@ini_set('zlib.output_compression', 'Off');
@ini_set('output_buffering', 'Off');
@ini_set('output_handler', '');

session_start();

// --- CONFIGURATION ---
$realPassword = 'zenith1950';
$cookieName   = 'zenith_remember_me';
$salt         = 'some_random_salt_string';

// 2. Security Check
$isAuthenticated = false;

if (!empty($_SESSION['zenith_auth'])) {
    $isAuthenticated = true;
} elseif (isset($_COOKIE[$cookieName])) {
    $expectedToken = hash('sha256', $realPassword . $salt);
    if ($_COOKIE[$cookieName] === $expectedToken) {
        $_SESSION['zenith_auth'] = true;
        $isAuthenticated = true;
    }
}

if (!$isAuthenticated) {
    writeLog("Auth Failed for IP: " . $_SERVER['REMOTE_ADDR']);
    header("HTTP/1.0 403 Forbidden");
    die("Access Denied");
}

// 3. Close the session immediately to prevent locking 
// (Allows the browser to download parallel streams if needed)
session_write_close();

// --- CRITICAL FIX 1: NGINX BUFFERING ---
// Explicitly tell Nginx NOT to buffer this response. 
// This fixes the NS_BINDING_ABORTED error in Firefox/Chrome.
header('X-Accel-Buffering: no');

// 4. Path Sanitization
$file = $_GET['file'] ?? '';
writeLog("Raw Request: " . $file);

// --- CRITICAL FIX 2: WINDOWS PATHS ---
// Convert Windows backslashes (\) to Linux forward slashes (/)
// This fixes the 404 error for folders containing backslashes in the JSON.
$file = str_replace('\\', '/', $file);

$file = str_replace(['..', "\0"], '', $file); // Added null byte protection

// 5. Define the protected path
$path = __DIR__ . '/protected/' . $file;
writeLog("Resolved Path: " . $path);

if (file_exists($path) && is_file($path)) {
    
    // Check read permissions
    if (!is_readable($path)) {
        writeLog("ERROR: File exists but is NOT readable (Check Permissions): " . $path);
        header("HTTP/1.0 403 Forbidden");
        die("File permission error");
    }

    // 6. AGGRESSIVE BUFFER CLEANING
    // Loop until all buffers are closed to remove any stray whitespace included by other scripts/configs
    while (ob_get_level()) {
        ob_end_clean();
    }

    $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
    $mimeTypes = [
        'json' => 'application/json',
        'mp3'  => 'audio/mpeg',
        'mp4'  => 'video/mp4',
        'm4a'  => 'audio/mp4',
        'mkv'  => 'video/x-matroska',
        'webm' => 'video/webm'
    ];
    
    $contentType = $mimeTypes[$ext] ?? 'application/octet-stream';
    $fileSize = filesize($path);
    
    $fp = fopen($path, 'rb');
    if (!$fp) {
        writeLog("CRITICAL: Could not fopen path: " . $path);
        header("HTTP/1.0 500 Internal Server Error");
        die("Could not open file");
    }

    $start = 0;
    $end = $fileSize - 1;
    $isRange = false;

    // --- RANGE LOGIC FIX ---
    if (isset($_SERVER['HTTP_RANGE'])) {
        $isRange = true;
        writeLog("Range Request: " . $_SERVER['HTTP_RANGE']);
        
        // Case 1: Standard Range (e.g., bytes=0- or bytes=0-1024)
        if (preg_match('/bytes=(\d+)-(\d*)/', $_SERVER['HTTP_RANGE'], $matches)) {
            $start = intval($matches[1]);
            $end = ($matches[2] === '') ? $fileSize - 1 : intval($matches[2]);
        } 
        // Case 2: Suffix Range (e.g., bytes=-500 -> last 500 bytes)
        // This is the specific fix for Firefox metadata errors
        elseif (preg_match('/bytes=-(\d+)/', $_SERVER['HTTP_RANGE'], $matches)) {
            $suffix = intval($matches[1]);
            $start = $fileSize - $suffix;
            $end = $fileSize - 1;
        }

        // Safety bounds
        $start = max(0, $start);
        $end = min($end, $fileSize - 1);
    }

    $length = $end - $start + 1;

    if ($isRange) {
        header('HTTP/1.1 206 Partial Content');
        header('Content-Range: bytes ' . $start . '-' . $end . '/' . $fileSize);
    } else {
        header('HTTP/1.1 200 OK');
    }
    
    header('Content-Type: ' . $contentType);
    header('Content-Length: ' . $length);
    header('Accept-Ranges: bytes');
    header('Content-Disposition: inline; filename="' . basename($path) . '"');
    
    // Explicitly disable cache for testing if issues persist
    // header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    // header('Cache-Control: post-check=0, pre-check=0', false);
    // header('Pragma: no-cache');

    fseek($fp, $start);

    $bufferSize = 1024 * 8; 
    $bytesSent = 0;

    while (!feof($fp) && ($bytesSent < $length)) {
        // Stop serving if user disconnects (Saves bandwidth)
        if (connection_aborted()) {
            break;
        }

        $readSize = min($bufferSize, $length - $bytesSent);
        $buffer = fread($fp, $readSize);
        echo $buffer;
        flush(); 
        
        $bytesSent += strlen($buffer);
    }

    fclose($fp);
    writeLog("Stream Complete/Aborted. Sent: $bytesSent bytes");
    exit;

} else {
    writeLog("ERROR: File Not Found at path: " . $path);
    header("HTTP/1.0 404 Not Found");
    die("File not found");
}
?>
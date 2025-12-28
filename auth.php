<?php
require_once __DIR__ . '/config.php';

function isAuthenticated(): bool {
    if (!empty($_SESSION['zenith_auth']) && $_SESSION['zenith_auth'] === true) {
        return true;
    }
    
    if (isset($_COOKIE[AUTH_COOKIE_NAME])) {
        if ($_COOKIE[AUTH_COOKIE_NAME] === hash('sha256', AUTH_PASSWORD . AUTH_SALT)) {
            $_SESSION['zenith_auth'] = true;
            return true;
        }
    }
    
    return false;
}

function verifyPassword(string $password): bool {
    return $password === AUTH_PASSWORD;
}

function setAuthSession(): void {
    $_SESSION['zenith_auth'] = true;
}

function setRememberCookie(): void {
    $hash = hash('sha256', AUTH_PASSWORD . AUTH_SALT);
    setcookie(AUTH_COOKIE_NAME, $hash, time() + AUTH_COOKIE_DURATION, '/', '', true, true);
}

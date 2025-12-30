<?php
session_start();

header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("Cache-Control: post-check=0, pre-check=0", false);
header("Pragma: no-cache");

// Inline auth
$realPassword = 'zenith1950';
$cookieName = 'zenith_remember_me';
$salt = 'some_random_salt_string';

$isLoggedIn = false;
if (!empty($_SESSION['zenith_auth']) && $_SESSION['zenith_auth'] === true) {
    $isLoggedIn = true;
} elseif (isset($_COOKIE[$cookieName])) {
    if ($_COOKIE[$cookieName] === hash('sha256', $realPassword . $salt)) {
        $_SESSION['zenith_auth'] = true;
        $isLoggedIn = true;
    }
}
?>
<?php include __DIR__ . '/includes/header.php'; ?>
<?php include __DIR__ . '/includes/content.php'; ?>

	<script src="js/auth-gate.js"></script>
    
    <!-- Core state and configuration -->
    <script src="js/state.js"></script>
    
    <!-- Extracted modules -->
    <script src="js/audio-engine.js"></script>
    <script src="js/playback-state.js"></script>
    <script src="js/dial-renderer.js"></script>
    
    <!-- Main application -->
    <script src="js/app.js"></script>
    <script src="js/init.js"></script>
</body>
</html>
<?php
/**
 * Frankenstein CMS - Simple PHP Bouncer
 *
 * Supports password auth and short-lived session tokens so the site
 * password is not sent on every request after the first successful login.
 *
 * Session token format (stateless HMAC):
 *   base64url(email) . "." . base64url(expiry_unix) . "." . base64url(hmac)
 * HMAC key = site password (already known only to server + client).
 * Default TTL: 8 hours.
 *
 * sites file format (see "Where the sites live" below for WHERE to put it):
 * {
 *   "user@site1.com": {
 *      "password": "your-password",          // or a password_hash() value ($2y$… / $argon2id$…)
 *      "github_token": "ghp_your_token",
 *      "github_owner": "your-github-user",   // recommended: this client can only reach this repo
 *      "github_repo": "your-repo"
 *   }
 * }
 *
 * Only the GitHub endpoints the CMS needs are proxied (repo info, contents,
 * commits, git trees/blobs) - never the rest of the API. Set the environment
 * variable FRANKENSTEIN_ALLOWED_ORIGIN to your CMS origin to restrict CORS.
 */

$allowedOrigin = getenv('FRANKENSTEIN_ALLOWED_ORIGIN') ?: '*';
header("Access-Control-Allow-Origin: $allowedOrigin");
if ($allowedOrigin !== '*') {
    header("Vary: Origin");
}
header("Access-Control-Allow-Methods: GET, HEAD, PUT, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Site-Email, Site-Password, Site-Session, Accept");
header("Access-Control-Expose-Headers: X-Session-Token, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// --- Where the sites live (passwords + GitHub tokens!) ----------------------
// A file next to this script can usually be DOWNLOADED by URL, so the plain
// sites.json in this folder is refused. In order of preference:
//   1. FRANKENSTEIN_SITES = full path of a JSON file outside the web root
//   2. sites.php next to this script: <?php return [ "email" => [ ... ] ];
//      (requested by URL it just runs and prints nothing, so it cannot leak)
//   3. ../sites.json, one folder above this script (normally not web-served)
function load_sites() {
    $env = getenv('FRANKENSTEIN_SITES');
    if ($env && is_file($env)) {
        return json_decode(file_get_contents($env), true);
    }
    if (is_file(__DIR__ . '/sites.php')) {
        return require __DIR__ . '/sites.php';
    }
    if (is_file(dirname(__DIR__) . '/sites.json')) {
        return json_decode(file_get_contents(dirname(__DIR__) . '/sites.json'), true);
    }
    if (is_file(__DIR__ . '/sites.json') && getenv('FRANKENSTEIN_ALLOW_PUBLIC_SITES_JSON') !== '1') {
        http_response_code(500);
        echo "Bouncer Error: sites.json next to bouncer.php can be downloaded by anyone. "
           . "Move it one folder up, or rename it to sites.php (see the header of bouncer.php).";
        exit;
    }
    if (is_file(__DIR__ . '/sites.json')) {
        return json_decode(file_get_contents(__DIR__ . '/sites.json'), true);
    }
    return null;
}

$sites = load_sites();
if (!is_array($sites)) {
    http_response_code(500);
    echo "Bouncer Error: no valid sites file found (see the header of bouncer.php).";
    exit;
}

$email = $_SERVER['HTTP_SITE_EMAIL'] ?? '';
$password = $_SERVER['HTTP_SITE_PASSWORD'] ?? '';
$session = $_SERVER['HTTP_SITE_SESSION'] ?? '';

if (empty($email)) {
    http_response_code(400);
    echo "Missing Site-Email";
    exit;
}

$throttleKey = client_key();
if (throttle_blocked($throttleKey, sys_get_temp_dir())) {
    http_response_code(429);
    header('Retry-After: 900');
    echo "Too many failed attempts. Try again in a few minutes.";
    exit;
}

$siteConfig = $sites[$email] ?? ['password' => 'dummy', 'github_token' => 'dummy'];
$sitePassword = $siteConfig['password'];
$siteExists = isset($sites[$email]);

$authenticated = false;
$issueSession = false;

function b64url_encode($data) {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function b64url_decode($data) {
    $remainder = strlen($data) % 4;
    if ($remainder) {
        $data .= str_repeat('=', 4 - $remainder);
    }
    return base64_decode(strtr($data, '-_', '+/'));
}

function make_session_token($email, $password, $ttl = 28800) {
    $exp = (string)(time() + $ttl);
    $payload = b64url_encode($email) . '.' . b64url_encode($exp);
    $sig = b64url_encode(hash_hmac('sha256', $payload, $password, true));
    return $payload . '.' . $sig;
}

// BOUNCER-GUARD-START
/**
 * Whitelist of GitHub requests the CMS may make through this bouncer.
 * Mirrors isAllowedGithubRequest() in bouncer-node.js and the Supabase
 * function (tests/bouncer.test.js keeps the three in sync).
 */
/**
 * Files a client may WRITE: the pages the CMS edits (.html/.htm) and image uploads
 * straight into img/. Never dotfiles/dot-folders (.github, .env ...), scripts,
 * styles, configs or SVG (it can carry scripts).
 */
function github_write_path_allowed($parts) {
    if (count($parts) === 0) return false;
    foreach ($parts as $p) {
        if ($p !== '' && $p[0] === '.') return false;
    }
    $name = strtolower($parts[count($parts) - 1]);
    if (preg_match('/\.html?$/', $name)) return true;
    return count($parts) === 2 && $parts[0] === 'img' && preg_match('/\.(png|jpe?g|gif|webp|avif|ico)$/', $name) === 1;
}

function github_request_allowed($method, $rawPath, $owner = null, $repo = null) {
    $method = strtoupper($method);
    if (preg_match('/[\x00-\x20\\\\]/', $rawPath)) return false;
    $parts = explode('?', $rawPath, 2);
    $pathname = $parts[0];
    if ($pathname === '' || $pathname[0] !== '/') $pathname = '/' . $pathname;
    $segments = array_values(array_filter(explode('/', $pathname), function ($s) { return $s !== ''; }));
    $decoded = array();
    foreach ($segments as $s) {
        $d = rawurldecode($s);
        if ($d === '.' || $d === '..' || strpos($d, '/') !== false || strpos($d, '\\') !== false) return false;
        $decoded[] = $d;
    }
    if (count($segments) < 3 || $segments[0] !== 'repos') return false;
    if ($owner !== null && $owner !== '' && strcasecmp(rawurldecode($segments[1]), $owner) !== 0) return false;
    if ($repo !== null && $repo !== '' && strcasecmp(rawurldecode($segments[2]), $repo) !== 0) return false;
    $readOnly = ($method === 'GET' || $method === 'HEAD');
    if (count($segments) === 3) return $readOnly;
    switch ($segments[3]) {
        case 'contents': return $readOnly || ($method === 'PUT' && github_write_path_allowed(array_slice($decoded, 4)));
        case 'commits': return $readOnly;
        case 'git': return $readOnly && isset($segments[4]) && in_array($segments[4], array('blobs', 'trees'), true);
        default: return false;
    }
}
// BOUNCER-GUARD-END

// BOUNCER-THROTTLE-START
/**
 * Failed-login throttle per client. State lives in small files in the temp dir.
 * sleep() alone does not stop an attacker (parallel requests) and ties up PHP
 * workers, so after too many failures the client is simply refused for a while.
 */
function throttle_file($key, $dir) {
    return rtrim($dir, '/\\') . '/frankenstein-throttle-' . hash('sha256', $key);
}

function throttle_read($key, $dir, $window, $now) {
    $f = throttle_file($key, $dir);
    if (!is_file($f)) return 0;
    $data = json_decode((string) @file_get_contents($f), true);
    if (!is_array($data) || !isset($data['first'], $data['count'])) return 0;
    if ($now - $data['first'] > $window) return 0;
    return (int) $data['count'];
}

function throttle_blocked($key, $dir, $max = 10, $window = 900, $now = null) {
    return throttle_read($key, $dir, $window, $now ?? time()) >= $max;
}

function throttle_fail($key, $dir, $window = 900, $now = null) {
    $now = $now ?? time();
    $f = throttle_file($key, $dir);
    $fh = @fopen($f, 'c+');
    if (!$fh) return;
    flock($fh, LOCK_EX);
    $data = json_decode((string) stream_get_contents($fh), true);
    if (!is_array($data) || !isset($data['first'], $data['count']) || $now - $data['first'] > $window) {
        $data = array('first' => $now, 'count' => 0);
    }
    $data['count']++;
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode($data));
    flock($fh, LOCK_UN);
    fclose($fh);
}

function throttle_reset($key, $dir) {
    @unlink(throttle_file($key, $dir));
}
// BOUNCER-THROTTLE-END

function client_key() {
    // Behind a proxy (e.g. Cloudflare) REMOTE_ADDR is the proxy: opt in to its header
    if (getenv('FRANKENSTEIN_TRUST_PROXY') === '1' && !empty($_SERVER['HTTP_CF_CONNECTING_IP'])) {
        return $_SERVER['HTTP_CF_CONNECTING_IP'];
    }
    return $_SERVER['REMOTE_ADDR'] ?? 'unknown';
}

function password_matches($stored, $given) {
    if (preg_match('/^\$(2y|2a|argon2id|argon2i)\$/', $stored)) {
        return password_verify($given, $stored);
    }
    return hash_equals($stored, $given);
}

function verify_session_token($token, $email, $password) {
    $parts = explode('.', $token);
    if (count($parts) !== 3) return false;
    list($eB64, $expB64, $sigB64) = $parts;
    $tokenEmail = b64url_decode($eB64);
    $exp = intval(b64url_decode($expB64));
    if ($tokenEmail !== $email) return false;
    if ($exp < time()) return false;
    $payload = $eB64 . '.' . $expB64;
    $expected = b64url_encode(hash_hmac('sha256', $payload, $password, true));
    return hash_equals($expected, $sigB64);
}

$validSession = !empty($session) && verify_session_token($session, $email, $sitePassword);
$validPassword = !empty($password) && password_matches($sitePassword, $password);

if ($siteExists && $validSession) {
    $authenticated = true;
} elseif ($siteExists && $validPassword) {
    $authenticated = true;
    $issueSession = true;
} else {
    throttle_fail($throttleKey, sys_get_temp_dir());
    sleep(1);
    http_response_code(401);
    echo "Unauthorized: Incorrect credentials";
    exit;
}

if ($issueSession) {
    throttle_reset($throttleKey, sys_get_temp_dir());
    header('X-Session-Token: ' . make_session_token($email, $sitePassword));
}

$token = $sites[$email]['github_token'];

$path = $_GET['path'] ?? '/';

if (!github_request_allowed(
    $_SERVER['REQUEST_METHOD'],
    $path,
    $siteConfig['github_owner'] ?? null,
    $siteConfig['github_repo'] ?? null
)) {
    http_response_code(403);
    header('Content-Type: application/json');
    echo json_encode(['message' => 'Bouncer: this request is not allowed.']);
    exit;
}

// Read the body first and refuse oversized requests before doing anything else
$body = '';
if ($_SERVER['REQUEST_METHOD'] !== 'GET' && $_SERVER['REQUEST_METHOD'] !== 'HEAD') {
    $body = file_get_contents('php://input');
    if (strlen($body) > 8 * 1024 * 1024) {
        http_response_code(413);
        echo "Request too large.";
        exit;
    }
}

$url = "https://api.github.com" . (str_starts_with($path, '/') ? $path : "/$path");

$ch = curl_init($url);

// One Accept header only: a second one made GitHub return JSON instead of the
// raw file the CMS asked for (CSS / images in the editor preview).
$accept = (isset($_SERVER['HTTP_ACCEPT']) && $_SERVER['HTTP_ACCEPT'] !== '')
    ? $_SERVER['HTTP_ACCEPT']
    : 'application/vnd.github+json';

$headers = [
    "Authorization: Bearer $token",
    "Accept: $accept",
    "User-Agent: Frankenstein-CMS-PHP-Bouncer"
];

$forwardHeaders = ['Content-Type'];
foreach ($forwardHeaders as $h) {
    $headerName = 'HTTP_' . strtoupper(str_replace('-', '_', $h));
    if (isset($_SERVER[$headerName])) {
        $headers[] = "$h: " . $_SERVER[$headerName];
    }
}

curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_HEADER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 30);

if ($_SERVER['REQUEST_METHOD'] !== 'GET' && $_SERVER['REQUEST_METHOD'] !== 'HEAD') {
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $_SERVER['REQUEST_METHOD']);
    if ($body) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }
}

$raw = curl_exec($ch);
$headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error = curl_error($ch);
curl_close($ch);

if ($error) {
    http_response_code(502);
    echo "Bouncer proxy error: $error";
    exit;
}

$respHeaders = substr($raw, 0, $headerSize);
$response = substr($raw, $headerSize);

http_response_code($httpCode);

foreach (explode("\r\n", $respHeaders) as $line) {
    if (stripos($line, 'Content-Type:') === 0 || stripos($line, 'Content-Length:') === 0
        || stripos($line, 'X-RateLimit-Remaining:') === 0 || stripos($line, 'X-RateLimit-Reset:') === 0
        || stripos($line, 'Retry-After:') === 0) {
        header($line);
    }
}

echo $response;

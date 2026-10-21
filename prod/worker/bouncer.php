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
 * sites.json format:
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

$configFile = __DIR__ . '/sites.json';
if (!file_exists($configFile)) {
    http_response_code(500);
    echo "Bouncer Error: sites.json not found.";
    exit;
}

$sites = json_decode(file_get_contents($configFile), true);

$email = $_SERVER['HTTP_SITE_EMAIL'] ?? '';
$password = $_SERVER['HTTP_SITE_PASSWORD'] ?? '';
$session = $_SERVER['HTTP_SITE_SESSION'] ?? '';

if (empty($email)) {
    http_response_code(400);
    echo "Missing Site-Email";
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
function github_request_allowed($method, $rawPath, $owner = null, $repo = null) {
    $method = strtoupper($method);
    if (preg_match('/[\x00-\x20\\\\]/', $rawPath)) return false;
    $parts = explode('?', $rawPath, 2);
    $pathname = $parts[0];
    if ($pathname === '' || $pathname[0] !== '/') $pathname = '/' . $pathname;
    $segments = array_values(array_filter(explode('/', $pathname), function ($s) { return $s !== ''; }));
    foreach ($segments as $s) {
        $d = rawurldecode($s);
        if ($d === '.' || $d === '..' || strpos($d, '/') !== false || strpos($d, '\\') !== false) return false;
    }
    if (count($segments) < 3 || $segments[0] !== 'repos') return false;
    if ($owner !== null && $owner !== '' && strcasecmp(rawurldecode($segments[1]), $owner) !== 0) return false;
    if ($repo !== null && $repo !== '' && strcasecmp(rawurldecode($segments[2]), $repo) !== 0) return false;
    $readOnly = ($method === 'GET' || $method === 'HEAD');
    if (count($segments) === 3) return $readOnly;
    switch ($segments[3]) {
        case 'contents': return $readOnly || $method === 'PUT';
        case 'commits': return $readOnly;
        case 'git': return $readOnly && isset($segments[4]) && in_array($segments[4], array('blobs', 'trees'), true);
        default: return false;
    }
}
// BOUNCER-GUARD-END

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
    sleep(2);
    http_response_code(401);
    echo "Unauthorized: Incorrect credentials";
    exit;
}

if ($issueSession) {
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
    $body = file_get_contents('php://input');
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

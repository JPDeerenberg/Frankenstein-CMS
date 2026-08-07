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
 *      "password": "your-password",
 *      "github_token": "ghp_your_token"
 *   }
 * }
 */

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, HEAD, POST, OPTIONS, PUT, DELETE, PATCH");
header("Access-Control-Allow-Headers: Content-Type, Site-Email, Site-Password, Site-Session, Accept");
header("Access-Control-Expose-Headers: X-Session-Token");

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
$validPassword = !empty($password) && hash_equals($sitePassword, $password);

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
$url = "https://api.github.com" . (str_starts_with($path, '/') ? $path : "/$path");

$ch = curl_init($url);

$headers = [
    "Authorization: Bearer $token",
    "Accept: application/vnd.github.v3+json",
    "User-Agent: Frankenstein-CMS-PHP-Bouncer"
];

$forwardHeaders = ['Content-Type', 'Accept'];
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
    if (stripos($line, 'Content-Type:') === 0 || stripos($line, 'Content-Length:') === 0) {
        header($line);
    }
}

echo $response;

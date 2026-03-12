<?php
/**
 * Frankenstein CMS - Simple PHP Bouncer
 * 
 * To use:
 * 1. Upload this file to your PHP server.
 * 2. Create a 'sites.json' in the same folder (protect it or put it outside web root).
 * 
 * sites.json format:
 * {
 *   "user@site1.com": {
 *      "password": "your-password",
 *      "github_token": "ghp_your_token"
 *   }
 * }
 */

// 1. CORS Headers
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, HEAD, POST, OPTIONS, PUT, DELETE, PATCH");
header("Access-Control-Allow-Headers: Content-Type, Site-Email, Site-Password, Accept");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// 2. Load Configuration
$configFile = __DIR__ . '/sites.json';
if (!file_exists($configFile)) {
    http_response_code(500);
    echo "Bouncer Error: sites.json not found.";
    exit;
}

$sites = json_decode(file_get_contents($configFile), true);

// 3. Extract credentials
$email = $_SERVER['HTTP_SITE_EMAIL'] ?? '';
$password = $_SERVER['HTTP_SITE_PASSWORD'] ?? '';

if (empty($email) || empty($password)) {
    http_response_code(400);
    echo "Missing Site-Email or Site-Password";
    exit;
}

// 4. Authenticate
if (!isset($sites[$email]) || $sites[$email]['password'] !== $password) {
    sleep(2); // Anti-brute force
    http_response_code(401);
    echo "Unauthorized: Incorrect credentials";
    exit;
}

$token = $sites[$email]['github_token'];

// 5. Proxy to GitHub
$path = $_GET['path'] ?? '/';
$url = "https://api.github.com" . (str_starts_with($path, '/') ? $path : "/$path");

$ch = curl_init($url);

$headers = [
    "Authorization: Bearer $token",
    "Accept: application/vnd.github.v3+json",
    "User-Agent: Frankenstein-CMS-PHP-Bouncer"
];

// Forward relevant headers from the original request
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

if ($_SERVER['REQUEST_METHOD'] !== 'GET' && $_SERVER['REQUEST_METHOD'] !== 'HEAD') {
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $_SERVER['REQUEST_METHOD']);
    $body = file_get_contents('php://input');
    if ($body) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }
}

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);

curl_close($ch);

// 6. Forward Response
http_response_code($httpCode);
if ($contentType) {
    header("Content-Type: $contentType");
}
echo $response;

<?php
// Relai same-origin vers l'API de l'Instituto Hidrográfico (pas d'en-tête CORS côté source).
// Aucun paramètre accepté : ce n'est pas un proxy ouvert, il ne sait appeler qu'une URL.
// Sortie identique au widget Übersicht : {status, fetchedAt, error, data}, toujours HTTP 200.
// Cache disque : resservi tel quel pendant CACHE_TTL, puis en secours (status "stale")
// si la source est en panne (cas du 25/10/2026 : HTTP 500 sur tout hmapi).

declare(strict_types=1);

const PORT_ID    = 19;          // Barra de Faro-Olhão
const NAV_BACK   = 3;
const NAV_FORWARD = 21;
const CACHE_TTL  = 6 * 3600;    // les prédictions ne changent pas : 6 h suffit largement
const TIMEOUT    = 10;
const RETRY_AFTER = 15 * 60;    // après un échec, attendre avant de réessayer la source

$cacheDir  = __DIR__ . '/cache';
$cacheFile = $cacheDir . '/tides.json';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache');

function fetchUrl(string $url): array {
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => TIMEOUT,
            CURLOPT_CONNECTTIMEOUT => TIMEOUT,
            CURLOPT_USERAGENT      => 'maree-faro/1.0',
        ]);
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = curl_errno($ch);
        if ($err) throw new RuntimeException('réseau injoignable');
        if ($code !== 200) throw new RuntimeException('HTTP ' . $code);
    } else {
        $ctx  = stream_context_create(['http' => ['timeout' => TIMEOUT, 'ignore_errors' => true, 'user_agent' => 'maree-faro/1.0']]);
        $body = @file_get_contents($url, false, $ctx);
        if ($body === false) throw new RuntimeException('réseau injoignable');
        $status = $http_response_header[0] ?? '';
        if (!preg_match('/\s200\s/', $status)) {
            preg_match('/\s(\d{3})\s/', $status, $m);
            throw new RuntimeException('HTTP ' . ($m[1] ?? '?'));
        }
    }
    $json = json_decode((string) $body, true);
    if (!is_array($json)) throw new RuntimeException('réponse invalide');
    return $json;
}

function readCache(string $file): ?array {
    if (!is_file($file)) return null;
    $c = json_decode((string) @file_get_contents($file), true);
    return is_array($c) && isset($c['data']) ? $c : null;
}

$cached = readCache($cacheFile);
if ($cached && (time() - (int) @filemtime($cacheFile)) < CACHE_TTL) {
    echo json_encode($cached, JSON_UNESCAPED_UNICODE);
    exit;
}

// Source en panne récemment : ne pas la réinterroger à chaque visite (4 appels × 10 s de délai).
$failFile = $cacheDir . '/lastfail.txt';
if ($cached && is_file($failFile) && (time() - (int) @filemtime($failFile)) < RETRY_AFTER) {
    $cached['status'] = 'stale';
    $cached['error']  = trim((string) @file_get_contents($failFile)) ?: 'indisponible';
    echo json_encode($cached, JSON_UNESCAPED_UNICODE);
    exit;
}

// Verrou : une seule requête rafraîchit la source, les autres servent le cache existant.
@mkdir($cacheDir, 0755, true);
$lock = @fopen($cacheDir . '/.lock', 'c');
if ($lock && !flock($lock, LOCK_EX | LOCK_NB) && $cached) {
    echo json_encode($cached, JSON_UNESCAPED_UNICODE);
    exit;
}

$tz    = new DateTimeZone('Europe/Lisbon');
$today = new DateTimeImmutable('today', $tz);
$d     = $today->modify('-' . (NAV_BACK + 1) . ' days');
$end   = $today->modify('+' . (NAV_FORWARD + 1) . ' days');

try {
    $results = [];
    // L'API plafonne silencieusement period à 7 jours : appels enchaînés.
    while ($d <= $end) {
        $url = 'https://www.hidrografico.pt/hmapi/tidestation/?portID=' . PORT_ID
             . '&startDate=' . $d->format('Y-m-d') . '&period=7';
        $results = array_merge($results, fetchUrl($url));
        $d = $d->modify('+7 days');
    }
    $out = [
        'status'    => 'ok',
        'fetchedAt' => (new DateTimeImmutable('now', $tz))->format('Y-m-d\TH:i'),
        'error'     => null,
        'data'      => $results,
    ];
    $tmp = $cacheFile . '.tmp';
    if (@file_put_contents($tmp, json_encode($out, JSON_UNESCAPED_UNICODE)) !== false) @rename($tmp, $cacheFile);
    @unlink($failFile);
} catch (Throwable $e) {
    $msg = $e instanceof RuntimeException ? $e->getMessage() : get_class($e);
    @file_put_contents($failFile, $msg);
    if ($cached) {
        $out = $cached;
        $out['status'] = 'stale';
        $out['error']  = $msg;
    } else {
        $out = ['status' => 'error', 'fetchedAt' => null, 'error' => $msg, 'data' => null];
    }
}

if ($lock) { flock($lock, LOCK_UN); fclose($lock); }
echo json_encode($out, JSON_UNESCAPED_UNICODE);

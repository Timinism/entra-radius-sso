<?php

declare(strict_types=1);

require __DIR__.'/bootstrap.php';
require __DIR__.'/Lab.php';

date_default_timezone_set('America/Chicago');
session_start();
if (empty($_SESSION['csrf'])) {
    $_SESSION['csrf'] = bin2hex(random_bytes(16));
}

$lab = Lab::open(__DIR__.'/data');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$partial = isset($_GET['partial']);

if ($method === 'POST') {
    $token = (string) ($_POST['_token'] ?? '');
    if (! hash_equals((string) $_SESSION['csrf'], $token)) {
        http_response_code(419);
        echo 'The form expired. Reload the page and try again.';
        return;
    }
    if ($path === '/settings') {
        $incoming = $_POST['settings'] ?? [];
        $lab->saveSettings(is_array($incoming) ? $incoming : []);
        $_SESSION['notice'] = 'Saved. The next poll uses these keys.';
        header('Location: /settings');
        return;
    }
    if ($path === '/settings/test') {
        $result = $lab->test((int) ($_POST['device_id'] ?? 0), trim((string) ($_POST['api_key'] ?? '')));
        $_SESSION['notice'] = $result['message'];
        header('Location: /settings');
        return;
    }
    http_response_code(404);
    echo 'Not found';
    return;
}

$lab->tick();

if ($path === '/' || $path === '') {
    $html = $lab->dashboard($_GET);
    echo $partial ? $html : layout('Palo Alto VPN', 'vpn', $html, true);
    return;
}

if ($path === '/settings') {
    $notice = $_SESSION['notice'] ?? null;
    unset($_SESSION['notice']);
    echo layout('VPN settings', 'settings', $lab->settings(is_string($notice) ? $notice : null), false);
    return;
}

if (preg_match('#^/device/(\d+)(?:/([a-z0-9-]+))?$#', $path, $match)) {
    $deviceId = (int) $match[1];
    $tab = $match[2] ?? 'overview';
    $known = Lab::firewalls()[$deviceId] ?? null;
    if ($known === null) {
        http_response_code(404);
        echo layout('Unknown firewall', 'vpn', '<p>That firewall is not in the lab.</p>', false);
        return;
    }
    $name = (string) $known['display_name'];
    $host = (string) $known['hostname'];
    if ($tab === 'panos-vpn') {
        $html = $lab->deviceTab($deviceId, $_GET);
        echo $partial ? $html : layout($name.' VPN', 'vpn', deviceShell($deviceId, $name, $host, 'vpn', (string) $html), true);
        return;
    }
    if ($tab !== 'overview') {
        http_response_code(404);
        echo layout('Not found', 'vpn', '<p>That device tab is not part of the lab.</p>', false);
        return;
    }
    $overview = '<section class="device-overview"><p>PAN-OS firewall. Site-to-site tunnels and GlobalProtect users are on the VPN tab.</p></section>';
    echo layout($name, 'vpn', deviceShell($deviceId, $name, $host, 'overview', $overview), false);
    return;
}

http_response_code(404);
echo layout('Not found', 'vpn', '<p>That page is not part of the VPN plugin.</p>', false);

function deviceShell(int $deviceId, string $name, string $host, string $tab, string $body): string
{
    $safeName = htmlspecialchars($name, ENT_QUOTES);
    $safeHost = htmlspecialchars($host, ENT_QUOTES);
    $overview = $tab === 'overview' ? ' class="on"' : '';
    $vpn = $tab === 'vpn' ? ' class="on"' : '';

    return <<<HTML
<div class="device-shell">
  <div class="device-head">
    <p class="kicker">Device</p>
    <h2>{$safeName}</h2>
    <p class="muted">{$safeHost}</p>
    <nav class="device-tabs" aria-label="Device tabs">
      <a href="/device/{$deviceId}"{$overview}>Overview</a>
      <a href="/device/{$deviceId}/panos-vpn"{$vpn}>VPN</a>
    </nav>
  </div>
  <div class="device-body">{$body}</div>
</div>
HTML;
}

function layout(string $title, string $active, string $body, bool $live): string
{
    $vpn = $active === 'vpn' ? ' class="on"' : '';
    $settings = $active === 'settings' ? ' class="on"' : '';
    $liveAttr = $live ? '1' : '0';
    $safeTitle = htmlspecialchars($title, ENT_QUOTES);

    return <<<HTML
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{$safeTitle} · LibreNMS</title>
<style>
  body { margin: 0; background: #e7edf2; color: #1b2836; font-family: "Segoe UI", "Helvetica Neue", sans-serif; }
  .labbar { display: flex; align-items: center; gap: 22px; background: #16324f; color: white; padding: 0 18px; height: 52px; }
  .labbar a { color: #d5e2ee; text-decoration: none; font-weight: 650; }
  .brand { color: white; letter-spacing: -0.03em; font-size: 18px; margin-right: 8px; }
  .labbar nav { display: flex; gap: 16px; }
  .labbar a.on { color: white; box-shadow: inset 0 -2px 0 white; padding: 16px 0; }
  .pill { margin-left: auto; border: 1px solid #3d6284; border-radius: 999px; padding: 4px 10px; font-size: 12px; color: #d5e2ee; }
  main { max-width: 1180px; margin: 0 auto; padding: 18px 16px 48px; }
  .note { color: #5e6d7c; font-size: 13px; margin: 0 0 14px; }
  .device-shell { background: white; border: 1px solid #d5dee8; border-radius: 10px; overflow: hidden; }
  .device-head { padding: 16px 18px 0; }
  .device-head h2 { margin: 4px 0 0; font-size: 22px; }
  .device-tabs { display: flex; gap: 4px; margin-top: 14px; border-bottom: 1px solid #d5dee8; }
  .device-tabs a { color: #3d5166; text-decoration: none; font-weight: 650; padding: 10px 14px; border-bottom: 2px solid transparent; }
  .device-tabs a.on { color: #16324f; border-bottom-color: #16324f; }
  .device-body { padding: 16px 18px 20px; }
  .device-overview h2 { margin: 4px 0 8px; font-size: 22px; }
  .kicker { margin: 0; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #5e6d7c; font-weight: 700; }
  .muted { color: #5e6d7c; }
  @media (max-width: 800px) {
    .labbar { height: auto; flex-wrap: wrap; padding: 10px 14px; }
    .pill { margin-left: 0; }
    .device-tabs { overflow-x: auto; }
  }
</style>
</head>
<body data-live="{$liveAttr}">
<header class="labbar">
  <a class="brand" href="/">LibreNMS</a>
  <nav>
    <a href="/"{$vpn}>Palo Alto VPN</a>
    <a href="/settings"{$settings}>Settings</a>
  </nav>
  <span class="pill">Lab · simulated PAN-OS</span>
</header>
<main>
  <p class="note">Four firewalls are simulated here. Tunnel counters and GlobalProtect sessions move every few seconds. Install this plugin in LibreNMS to poll real PAN-OS firewalls.</p>
  {$body}
</main>
<script>
if (document.body.dataset.live === '1') {
  setInterval(async () => {
    if (document.hidden || document.querySelector('details[open]') || document.activeElement && document.activeElement.matches('input, textarea, select')) return;
    const url = new URL(location.href);
    url.searchParams.set('partial', '1');
    const response = await fetch(url, { headers: { 'X-Partial': '1' } });
    if (!response.ok) return;
    const html = await response.text();
    const wrap = document.createElement('div');
    wrap.innerHTML = html.trim();
    const next = wrap.querySelector('#pv-root');
    const current = document.getElementById('pv-root');
    if (next && current) current.replaceWith(next);
  }, 5000);
}
</script>
</body>
</html>
HTML;
}

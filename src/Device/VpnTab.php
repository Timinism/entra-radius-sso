<?php

declare(strict_types=1);

namespace LibreNmsPlugin\PanosVpn\Device;

use App\Models\Device;
use Illuminate\Http\Request;
use LibreNMS\Interfaces\UI\DeviceTab;
use LibreNmsPlugin\PanosVpn\View\Pages;

/**
 * LibreNMS has no plugin hook for device tabs. The service provider
 * appends this class to PageTabs::$tabsClasses on PAN-OS devices.
 */
class VpnTab implements DeviceTab
{
    public static bool $registered = false;

    public function visible(Device $device): bool
    {
        return strtolower((string) ($device->os ?? '')) === 'panos';
    }

    public function slug(): string
    {
        return 'panos-vpn';
    }

    public function icon(): string
    {
        return 'fa-lock';
    }

    public function name(): string
    {
        return 'VPN';
    }

    /**
     * @return array{panel_html: string}
     */
    public function data(Device $device, Request $request): array
    {
        $query = $request->query();

        return [
            'panel_html' => Pages::device((int) $device->device_id, is_array($query) ? $query : []),
        ];
    }
}

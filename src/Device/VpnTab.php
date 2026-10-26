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
    public function visible(Device $device): bool
    {
        if (($device->os ?? '') !== 'panos') {
            return false;
        }

        $user = function_exists('auth') ? auth()->user() : null;

        return $user !== null && $user->can('global-read');
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

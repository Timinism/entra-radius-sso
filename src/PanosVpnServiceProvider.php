<?php

declare(strict_types=1);

namespace LibreNmsPlugin\PanosVpn;

use Illuminate\Support\ServiceProvider;
use LibreNMS\Interfaces\Plugins\Hooks\DeviceOverviewHook;
use LibreNMS\Interfaces\Plugins\Hooks\MenuEntryHook;
use LibreNMS\Interfaces\Plugins\Hooks\SettingsHook;
use LibreNMS\Interfaces\Plugins\Hooks\SinglePageHook;
use LibreNMS\Interfaces\Plugins\PluginManagerInterface;
use LibreNmsPlugin\PanosVpn\Console\PollCommand;
use LibreNmsPlugin\PanosVpn\Device\VpnTab;
use LibreNmsPlugin\PanosVpn\Hooks\DeviceOverview;
use LibreNmsPlugin\PanosVpn\Hooks\MenuEntry;
use LibreNmsPlugin\PanosVpn\Hooks\Page;
use LibreNmsPlugin\PanosVpn\Hooks\Settings;
use LibreNmsPlugin\PanosVpn\Http\SettingsSync;
use LibreNmsPlugin\PanosVpn\Listeners\PollAfterDevice;

class PanosVpnServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->commands([PollCommand::class]);
    }

    public function boot(PluginManagerInterface $pluginManager): void
    {
        $pluginName = 'panos-vpn';

        $pluginManager->publishHook($pluginName, MenuEntryHook::class, MenuEntry::class);
        $pluginManager->publishHook($pluginName, SinglePageHook::class, Page::class);
        $pluginManager->publishHook($pluginName, DeviceOverviewHook::class, DeviceOverview::class);
        $pluginManager->publishHook($pluginName, SettingsHook::class, Settings::class);

        $this->loadMigrationsFrom(__DIR__.'/../database/migrations');
        $this->listenForSettingsSaves();

        if (! $pluginManager->pluginEnabled($pluginName)) {
            return;
        }

        $this->loadViewsFrom(__DIR__.'/../resources/views', $pluginName);
        $this->loadRoutesFrom(__DIR__.'/../routes/web.php');
        $this->registerDeviceTab();

        if (class_exists(\App\Events\DevicePolled::class)) {
            $this->app['events']->listen(\App\Events\DevicePolled::class, PollAfterDevice::class);
        }
    }

    private function registerDeviceTab(): void
    {
        $tabs = \App\View\Components\Device\PageTabs::class;
        try {
            if (! class_exists($tabs)) {
                return;
            }
            $this->app['view']->addLocation(dirname(__DIR__).'/resources/device-tab');
            $reflection = new \ReflectionClass($tabs);
            if (! $reflection->hasProperty('tabsClasses')) {
                return;
            }
            $property = $reflection->getProperty('tabsClasses');
            $property->setAccessible(true);
            $current = $property->getValue();
            if (! is_array($current)) {
                return;
            }
            $current['panos-vpn'] = VpnTab::class;
            $property->setValue(null, $current);
            VpnTab::$registered = true;
        } catch (\Throwable) {
            VpnTab::$registered = false;
        }
    }

    private function listenForSettingsSaves(): void
    {
        try {
            $this->app->booted(function (): void {
                $this->app['router']->pushMiddlewareToGroup('web', SettingsSync::class);
            });
            if (class_exists(\App\Models\Plugin::class)) {
                \App\Models\Plugin::saving([SettingsSync::class, 'normalize']);
            }
        } catch (\Throwable) {
            // A settings-save failure must not stop the plugin from publishing its hooks.
        }
    }
}

<?php

declare(strict_types=1);

namespace Flex\Commerce;

use Flex\Extension\V1\PublicAssetRegistrarInterface;

/**
 * The public file groups of the storefront (frontend.public.groups in plugin.json): the storefront on pages with
 * products, checkout only on checkout and order pages. The cart and the header count load on every page.
 */
final class CommerceAssets
{
    private static ?PublicAssetRegistrarInterface $registrar = null;

    public static function use(?PublicAssetRegistrarInterface $registrar): void
    {
        self::$registrar = $registrar;
    }

    public static function storefront(): void
    {
        self::$registrar?->enqueue('storefront');
    }

    public static function checkout(): void
    {
        self::$registrar?->enqueue('checkout');
    }
}

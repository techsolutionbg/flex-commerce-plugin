<?php

declare(strict_types=1);

namespace Flex\Commerce;

use Flex\Extension\V1\{UpdatablePluginInterface, BootablePluginInterface, PluginContext, PluginInterface};

final class CommercePlugin implements PluginInterface, BootablePluginInterface, UpdatablePluginInterface
{
    public function install(PluginContext $context): void
    {
        (new CatalogStore())->install();
        (new OrderStore())->install();
        (new StorefrontPages())->ensure();
    }
    public function activate(PluginContext $context): void
    {
        (new CatalogStore())->install();
        (new OrderStore())->install();
        (new StorefrontPages())->ensure();
    }
    public function update(PluginContext $context, string $fromVersion): void { $this->install($context); }
    public function deactivate(PluginContext $context): void {}
    public function boot(PluginContext $context): void
    {
        (new StorefrontPages())->ensure();
        $context->api->addFilter('public.content', static fn(mixed $html): mixed => is_string($html) ? (new CatalogEmbedRenderer())->content($html) : $html);
        $context->routes?->publicRoute('GET', '/favourites', StorefrontController::class, 'favourites');
        $context->routes?->publicRoute('GET', '/checkout', OrderController::class, 'checkout');
        $context->routes?->publicRoute('GET', '/order-received', OrderController::class, 'order-received');
        $context->routes?->get('/checkout/data', OrderController::class, 'checkout-data');
        $context->routes?->post('/checkout/data', OrderController::class, 'checkout-submit', [\Flex\Session\CsrfMiddleware::class]);
        $context->admin?->page('orders', 'Поръчки', 'assets/admin.js', false, ['group' => 'commerce', 'icon' => 'shopping-bag', 'section' => 'sales', 'order' => 1]);
        $context->routes?->admin('GET', '/orders', OrderController::class, 'orders');
        $context->routes?->admin(['GET','PUT'], '/orders/{id:number}', OrderController::class, 'order');
        $context->routes?->publicRoute('GET', '/cart', StorefrontController::class, 'cart');
        $context->routes?->publicRoute('GET', '/catalog', StorefrontController::class, 'catalog');
        $context->routes?->publicRoute('GET', '/catalog/category/{slug}', StorefrontController::class, 'category');
        $context->routes?->publicRoute('GET', '/product/{slug}', StorefrontController::class, 'product');
        $context->routes?->get('/favourites', LegacyStorefrontRedirectController::class, 'redirect-favourites');
        $context->routes?->get('/favourites/data', StorefrontController::class, 'favourites-data');
        $context->routes?->get('/cart', LegacyStorefrontRedirectController::class, 'redirect-cart');
        $context->routes?->get('/cart/data', CartController::class, 'cart');
        $context->routes?->post('/cart/data', CartController::class, 'cart-update', [\Flex\Session\CsrfMiddleware::class]);
        $context->routes?->get('/suggestions', StorefrontController::class, 'suggestions');
        $context->routes?->get('/catalog', LegacyStorefrontRedirectController::class, 'redirect-catalog');
        $context->routes?->get('/catalog/category/{slug}', LegacyStorefrontRedirectController::class, 'redirect-category');
        $context->routes?->get('/preview/{slug}', StorefrontController::class, 'preview');
        $context->routes?->get('/product/{slug}', LegacyStorefrontRedirectController::class, 'redirect-product');
        $context->admin?->page('products', 'Продукти', 'assets/admin.js', false, ['group' => 'commerce', 'icon' => 'shopping-bag', 'section' => 'catalog', 'order' => 1]);
        $context->admin?->page('categories', 'Категории', 'assets/admin.js', false, ['group' => 'commerce', 'icon' => 'file-text', 'section' => 'catalog', 'order' => 2]);
        $context->admin?->page('sales', 'Продажби', 'assets/admin.js', false, ['group' => 'commerce', 'icon' => 'shopping-bag', 'section' => 'sales', 'order' => 2]);
        $context->routes?->admin(['GET', 'POST'], '/sales', CatalogController::class, 'sales');
        $context->routes?->admin('PUT', '/sales/{id:number}', CatalogController::class, 'sales-record');
        $context->admin?->page('settings', 'Настройки', 'assets/admin.js', false, ['group' => 'commerce', 'icon' => 'settings', 'section' => 'settings', 'order' => 1]);
        $context->routes?->admin(['GET', 'PUT'], '/settings', CatalogController::class, 'settings');
        foreach (['products', 'categories'] as $kind) {
            $context->routes?->admin(['GET', 'POST'], '/' . $kind, CatalogController::class, $kind);
            $context->routes?->admin(['GET', 'PUT', 'DELETE'], '/' . $kind . '/{id:number}', CatalogController::class, $kind . '-record');
            $context->routes?->admin('POST', '/' . $kind . '/{id:number}/{action:restore}', CatalogController::class, $kind . '-restore');
            $context->routes?->admin('DELETE', '/' . $kind . '/{id:number}/{action:force}', CatalogController::class, $kind . '-force');
        }
    }
}

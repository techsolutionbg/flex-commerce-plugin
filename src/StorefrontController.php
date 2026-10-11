<?php

declare(strict_types=1);

namespace Flex\Commerce;

use Flex\Configuration\ProjectPaths;
use Flex\Contracts\Http\ResponseFactoryInterface;
use Flex\Media\PublicMediaApi;
use Flex\Menus\{PublicMenuApi, PublicMenuRenderer};
use Flex\Pages\{Page, PageRepository};
use Flex\Settings\SectionSettings;
use Flex\Themes\ThemeManager;
use Psr\Http\Message\{ResponseInterface, ServerRequestInterface};
use Twig\{Environment, Loader\FilesystemLoader};

final readonly class StorefrontController
{
    public function __construct(private ResponseFactoryInterface $responses, private ThemeManager $themes, private PageRepository $pages, private PublicMenuRenderer $menus, private PublicMediaApi $media, private SectionSettings $settings, private ProjectPaths $paths, private \Flex\Extension\V1\ExtensionApiInterface $extensions) {}
    public function __invoke(ServerRequestInterface $request, array $arguments = []): ResponseInterface
    {
        $preview = str_contains($request->getUri()->getPath(), '/preview/');
        $favouritesData = str_ends_with($request->getUri()->getPath(), '/favourites/data');
        $suggestions = str_ends_with($request->getUri()->getPath(), '/suggestions');
        $public = $this->settings->all('public');
        if (($public['closed'] ?? '0') === '1') {
            if ($suggestions || $favouritesData || $preview) {
                return $this->responses->json(['products' => []], 503, ['Cache-Control' => 'no-store']);
            }
            return $this->page('Магазинът временно е затворен', '<p>' . htmlspecialchars($public['closed_message'], ENT_QUOTES, 'UTF-8') . '</p>', 503, ['type' => 'closed', 'request' => $request])->withHeader('Retry-After', '300');
        }
        if (str_ends_with($request->getUri()->getPath(), '/cart')) {
            return $this->page('Количка', $this->template('cart.twig', []), 200, ['type' => 'cart', 'path' => '/cart', 'request' => $request]);
        }
        if (str_ends_with($request->getUri()->getPath(), '/favourites')) {
            return $this->page('Любими', $this->template('favourites.twig', []), 200, ['type' => 'favourites', 'path' => '/favourites', 'request' => $request]);
        }
        $catalog = new PublicCatalog();
        try {
            if ($favouritesData) {
                $products = $catalog->favourites($request->getQueryParams()['ids'] ?? '');
                $html = '';
                foreach ($products as $product) $html .= $this->template('product-card.twig', ['product' => $product]);
                return $this->responses->json(['html' => $html, 'ids' => array_column($products, 'id')], 200, ['Cache-Control' => 'no-store']);
            }
            if ($suggestions) {
                $data = $catalog->listing(['q' => $request->getQueryParams()['q'] ?? '']);
                $products = array_map(static fn(array $product): array => [
                    'name' => $product['name'], 'url' => '/product/' . rawurlencode($product['slug']),
                    'price' => $product['price'], 'currency' => $product['currency'],
                    'image' => $product['images'][0]['thumbnail_url'] ?? null,
                ], array_slice($data['products'], 0, 5));
                return $this->responses->json(['products' => $products], 200, ['Cache-Control' => 'no-store']);
            }
            if ($preview || str_contains($request->getUri()->getPath(), '/product/')) {
                $product = $catalog->product((string) ($arguments['slug'] ?? ''));
                $config = \HTMLPurifier_Config::createDefault();
                $config->set('Cache.DefinitionImpl', null);
                $config->set('HTML.Allowed', 'p[class],br,strong,em,u,s,blockquote,ul,ol,li,h1,h2,h3,h4,h5,h6,a[href|title],img[src|alt|title|width|height],pre,code,span[class]');
                $config->set('URI.AllowedSchemes', ['http' => true, 'https' => true, 'mailto' => true]);
                $product['description'] = (new \HTMLPurifier($config))->purify($product['description']);
                $settings = (new CatalogStore())->settings();
                $productView = [
                    'product' => $product,
                    'shipping_terms_url' => (string) ($settings['shipping_terms_url'] ?? ''),
                    'product_page_layout' => $settings['product_page_layout'],
                ];
                if ($preview) {
                    $html = $this->template('product.twig', $productView + ['quick_view' => true]);
                    return $this->responses->json(['html' => str_replace(['id="commerce-product-', 'for="commerce-product-'], ['id="commerce-preview-product-', 'for="commerce-preview-product-'], $html)], 200, ['Cache-Control' => 'no-store']);
                }
                return $this->page($product['name'], $this->template('product.twig', $productView), 200, ['type' => 'product', 'path' => '/product/' . rawurlencode($product['slug']), 'product' => $product, 'request' => $request]);
            }
            $data = $catalog->listing($request->getQueryParams(), isset($arguments['slug']) ? (string) $arguments['slug'] : null);
            $base = '/catalog' . ($data['category'] ? '/category/' . rawurlencode($data['category']['slug']) : '');
            $queryFilters = array_filter(
                $data['filters'],
                static fn(mixed $value): bool => !(is_string($value) && $value === ''),
            );
            $data['page_urls'] = [];
            for ($page = max(1, $data['page'] - 2); $page <= min($data['pages'], $data['page'] + 2); $page++) {
                $data['page_urls'][$page] = $this->catalogUrl($base, $queryFilters, $page);
            }
            $data['first_url'] = $this->catalogUrl($base, $queryFilters, 1);
            $data['last_url'] = $this->catalogUrl($base, $queryFilters, $data['pages']);
            $data['previous_url'] = $this->catalogUrl($base, $queryFilters, max(1, $data['page'] - 1));
            $data['next_url'] = $this->catalogUrl($base, $queryFilters, min($data['pages'], $data['page'] + 1));
            $data['base_url'] = $base;
            $filtered = array_diff_key($queryFilters, ['sort' => true]) !== [] || ($queryFilters['sort'] ?? 'newest') !== 'newest';
            return $this->page($data['category']['name'] ?? 'Продукти', $this->template('catalog.twig', $data), 200, [
                'type' => $data['category'] ? 'category' : 'catalog',
                'path' => $this->catalogUrl($base, [], $data['page']),
                'category' => $data['category'],
                'page' => $data['page'],
                'filtered' => $filtered,
                'request' => $request,
            ]);
        } catch (CommerceException $error) {
            if ($suggestions || $favouritesData || $preview) {
                return $this->responses->json(['products' => [], 'error' => $error->getMessage()], $error->getCode(), ['Cache-Control' => 'no-store']);
            }
            return $this->page($error->getCode() === 404 ? 'Не е намерено' : 'Невалидно търсене', '<p>' . htmlspecialchars($error->getMessage(), ENT_QUOTES, 'UTF-8') . '</p><a href="/catalog">Към каталога</a>', $error->getCode(), ['type' => 'error', 'request' => $request]);
        }
    }
    public function checkoutPage(): ResponseInterface
    {
        $extras = $this->extensions->applyFilters('commerce.checkout.assets', [], []);
        $extraHtml = '';
        if (is_array($extras)) {
            foreach ($extras as $asset) {
                if (!is_array($asset) || !is_string($asset['href'] ?? null)) {
                    continue;
                }
                $href = htmlspecialchars($asset['href'], ENT_QUOTES, 'UTF-8');
                $extraHtml .= (($asset['type'] ?? 'script') === 'style')
                    ? '<link rel="stylesheet" href="' . $href . '">'
                    : '<script type="module" src="' . $href . '"></script>';
            }
        }

        return $this->page('Завършване на поръчката', $extraHtml . $this->template('checkout.twig', []), 200, ['type' => 'checkout', 'path' => '/checkout']);
    }
    public function orderPage(array $order, int $expiresAt = 0): ResponseInterface { return $this->page('Поръчката е получена', $this->template('order-received.twig', ['order'=>$order, 'expires_at'=>$expiresAt]), 200, ['type' => 'order']); }
    public function orderError(string $message, int $status): ResponseInterface { return $this->page('Поръчка', '<p>'.htmlspecialchars($message, ENT_QUOTES, 'UTF-8').'</p><a href="/cart">Към количката</a>', $status, ['type' => 'error']); }
    private function catalogUrl(string $base, array $filters, int $page): string
    {
        $query = $filters;
        if ($page > 1) {
            $query['page'] = $page;
        }
        $qs = http_build_query($query);

        return $qs === '' ? $base : $base . '?' . $qs;
    }
    private function template(string $template, array $data): string
    {
        if ($template === 'product.twig') {
            $data['extra_tabs'] = $this->extensions?->applyFilters('commerce.product.tabs', [], ['product' => $data['product'], 'quick_view' => $data['quick_view'] ?? false]) ?? [];
        }
        $loader = new FilesystemLoader(__DIR__ . '/../templates');
        $override = $this->paths->themes($this->themes->activeTheme() . '/commerce');
        if ($this->themes->activeTheme() !== '' && is_dir($override)) {
            $loader->prependPath($override);
        }
        return (new Environment($loader, ['cache' => false, 'strict_variables' => true, 'autoescape' => 'html']))->render($template, $data);
    }
    /** @param array<string, mixed> $seo Page type, canonical path and product/category data for public.head and public.title. */
    private function page(string $title, string $content, int $status = 200, array $seo = []): ResponseInterface
    {
        $request = $seo['request'] ?? null;
        unset($seo['request']);
        $context = ['commerce' => $seo + ['type' => 'page', 'status' => $status, 'title' => $title], 'request' => $request];
        $headTags = $this->extensions->applyFilters('public.head', '', $context);
        $documentTitle = $this->extensions->applyFilters('public.title', $title, $context);
        // The theme prints these groups with the plugin files for every page (header count, cart, toasts).
        CommerceAssets::storefront();
        if (in_array($seo['type'] ?? '', ['checkout', 'order'], true)) {
            CommerceAssets::checkout();
        }
        $content = '<div class="flex-commerce-storefront">' . $content . '</div>';
        $pages = $this->pages->publicPageSet();
        $capabilities = $this->themes->capabilities();
        $menus = $this->menus->forTheme($capabilities['theme'] ?? '', $pages, $capabilities['menu_locations']);
        $menus['__flex_menu_api'] = new PublicMenuApi($this->menus, $pages);
        $menus['__flex_media_api'] = $this->media;
        // A transient page lets any active theme provide its usual header, menus and footer.
        $page = new Page(['title' => $title, 'slug' => 'commerce', 'content' => $content, 'status' => 'published', 'settings' => []]);
        return $this->responses->html($this->themes->render('page.twig', ['page' => $page, 'page_settings' => [], 'page_public_path' => 'plugins/flex/commerce/catalog', 'head_tags' => is_string($headTags) ? $headTags : '', 'document_title' => is_string($documentTitle) && trim($documentTitle) !== '' ? $documentTitle : $title, 'navigation' => [], 'featured_media' => []] + $menus), $status, ['Cache-Control' => 'no-store']);
    }
}

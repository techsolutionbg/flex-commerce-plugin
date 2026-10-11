<?php

declare(strict_types=1);
namespace Flex\Commerce\Tests;

use Flex\Commerce\{CatalogStore, PublicCatalog, CommerceException};
use Flex\Configuration\ConfigurationRepository;
use Flex\Database\DatabaseManager;
use Illuminate\Database\Schema\Blueprint;
use PHPUnit\Framework\TestCase;
require_once __DIR__ . '/../src/CommerceException.php';
require_once __DIR__ . '/../src/CatalogStore.php';
require_once __DIR__ . '/../src/PublicCatalog.php';
require_once __DIR__ . '/../src/CartStore.php';
require_once __DIR__ . '/../src/SalesStore.php';
require_once __DIR__ . '/../src/CommerceAssets.php';
require_once __DIR__ . '/../src/CatalogEmbedRenderer.php';

final class PublicCatalogTest extends TestCase
{
    private DatabaseManager $db;
    private CatalogStore $admin;
    private PublicCatalog $public;
    protected function setUp(): void
    {
        $this->db = new DatabaseManager(new ConfigurationRepository(['database' => ['default' => 'sqlite', 'connections' => ['sqlite' => ['driver' => 'sqlite', 'database' => ':memory:', 'prefix' => '']]]]));
        $this->db->schema()->create('settings', static function (Blueprint $t): void { $t->string('key')->primary(); $t->text('value'); });
        $this->db->schema()->create('media', static function (Blueprint $t): void {
            $t->increments('id'); $t->string('title'); $t->string('mime'); $t->string('thumbnail_path')->nullable(); $t->string('alt')->default(''); $t->string('caption')->default(''); $t->text('description')->default(''); $t->softDeletes();
        });
        $this->db->connection()->table('media')->insert([['id' => 1, 'title' => 'Photo', 'mime' => 'image/jpeg', 'thumbnail_path' => 'preview.png'], ['id' => 2, 'title' => 'Second', 'mime' => 'image/jpeg', 'thumbnail_path' => null]]);
        $this->admin = new CatalogStore($this->db->connection()); $this->admin->install();
        $this->public = new PublicCatalog($this->db->connection());
    }
    public function testQuickViewReusesProductDetailsAndCardsExposePreview(): void
    {
        $saved = $this->product(['images' => [1, 2], 'sale_price' => '9.00']);
        $product = $this->public->product($saved['slug']);
        $twig = new \Twig\Environment(new \Twig\Loader\FilesystemLoader(__DIR__ . '/../templates'), ['strict_variables' => true, 'autoescape' => 'html']);
        $card = $twig->render('product-card.twig', ['product' => $product]);
        self::assertStringContainsString('data-commerce-preview="' . $saved['slug'] . '"', $card);
        $html = $twig->render('product.twig', ['product' => $product, 'quick_view' => true, 'shipping_terms_url' => '/shipping-terms']);
        self::assertStringNotContainsString('commerce-breadcrumbs', $html);
        foreach (['data-commerce-purchase', 'data-commerce-quick-order', 'data-commerce-favorite', 'data-commerce-thumbnail', 'commerce-sale-price', 'data-commerce-product-tabs', 'Виж всички подробности', 'commerce-shipping-terms', 'Условия за доставка'] as $marker) self::assertStringContainsString($marker, $html);
        self::assertStringContainsString('data-commerce-redirect="/cart"', $card);
        self::assertStringContainsString('href="/shipping-terms"', $html);
    }
    protected function tearDown(): void { $this->db->disconnect(); }
    private function product(array $patch = []): array { return $this->admin->save('products', array_replace(['name' => 'Gift', 'price' => '12.34', 'stock' => 2, 'status' => 'active'], $patch)); }
    public function testSalePricesApplyToCatalogueSortingProductAndCart(): void
    {
        $sale = $this->product(['price' => '20.00', 'sale_price' => '9.99']);
        $normal = $this->product(['price' => '12.00']);
        $record = $this->public->product($sale['slug']);
        self::assertTrue($record['on_sale']);
        self::assertSame('20,00', $record['regular_price']);
        self::assertSame('9,99', $record['price']);
        self::assertSame(999, $record['price_minor']);
        self::assertSame(50, $record['discount_percent']);
        self::assertSame([$sale['id'], $normal['id']], array_column($this->public->listing(['sort' => 'price_asc'])['products'], 'id'));
        $cart = new \Flex\Commerce\CartStore($this->db->connection());
        self::assertSame(1998, $cart->summary([$sale['id'] => 2])['totals'][0]['amount_minor']);
        $sale['sale_price'] = '';
        $this->admin->save('products', $sale, $sale['id']);
        self::assertFalse($this->public->product($sale['slug'])['on_sale']);
        self::assertSame(4000, $cart->summary([$sale['id'] => 2])['totals'][0]['amount_minor']);
    }
    public function testFavouritesPreserveOrderAndExcludeHiddenProducts(): void
    {
        $first = $this->product();
        $second = $this->product(['sale_price' => '9.00']);
        $hidden = $this->product(['status' => 'draft']);
        $ids = implode(',', [$second['id'], $hidden['id'], $first['id'], $second['id'], 999]);
        $results = $this->public->favourites($ids);
        self::assertSame([$second['id'], $first['id']], array_column($results, 'id'));
        self::assertSame('9,00', $results[0]['price']);
        self::assertSame([], $this->public->favourites(''));
        $this->expectException(CommerceException::class);
        $this->public->favourites('1,invalid');
    }
    public function testBestsellersUseCompletedSalesAndReversibleCancellation(): void
    {
        $a = $this->product(['name' => 'A']);
        $b = $this->product(['name' => 'B']);
        $hidden = $this->product(['status' => 'draft']);
        $sales = new \Flex\Commerce\SalesStore($this->db->connection());
        self::assertSame([], $this->public->bestsellers());
        $sales->record(['product_id' => $a['id'], 'quantity' => 2, 'reference' => 'ORDER-1']);
        $sales->record(['product_id' => $b['id'], 'quantity' => 5, 'reference' => 'ORDER-1']);
        $sales->record(['product_id' => $hidden['id'], 'quantity' => 50, 'reference' => 'ORDER-2']);
        self::assertSame([$b['id'], $a['id']], array_column($this->public->bestsellers(), 'id'));
        self::assertSame(50, $sales->report()['ranking'][0]['sold']);
        try { $sales->record(['product_id' => $a['id'], 'quantity' => 2, 'reference' => 'ORDER-1']); self::fail('Duplicate recorded'); }
        catch (CommerceException $e) { self::assertSame(409, $e->getCode()); }
        self::assertSame(5, $this->admin->get('products', $b['id'])['sold']);
        self::assertSame(2, array_column($this->admin->index('products'), 'sold', 'id')[$a['id']]);
        $sales->cancel(2, true);
        self::assertSame(0, array_column($this->admin->index('products'), 'sold', 'id')[$b['id']]);
        self::assertSame([$a['id']], array_column($this->public->bestsellers(), 'id'));
        $sales->cancel(2, false);
        self::assertSame([$b['id']], array_column($this->public->bestsellers(1), 'id'));
        self::assertSame(2, $this->admin->get('products', $a['id'])['stock']);
        $this->expectException(CommerceException::class);
        $sales->record(['product_id' => $a['id'], 'quantity' => 0, 'reference' => 'ORDER-3']);
    }
    public function testTopProductsAreOptInPublicAndEmptySectionsAreOmitted(): void
    {
        $renderer = new \Flex\Commerce\CatalogEmbedRenderer($this->public);
        self::assertSame('', $renderer->bestsellers());
        self::assertSame('', $renderer->topProducts());
        $normal = $this->product();
        $top = $this->product(['name' => 'Selected top', 'is_top' => true]);
        $this->product(['is_top' => true, 'status' => 'draft']);
        $trashed = $this->product(['is_top' => true]);
        $this->admin->action('products', $trashed['id'], 'trash', $trashed['version']);
        self::assertFalse($normal['is_top']);
        self::assertSame([$top['id']], array_column($this->public->topProducts(), 'id'));
        self::assertStringContainsString('commerce-top-products-heading', $renderer->topProducts());
        self::assertStringContainsString('Selected top', $renderer->topProducts());
        self::assertStringContainsString('Специално подбрани', $renderer->topProducts());
        self::assertStringNotContainsString('Разгледай всички продукти', $renderer->topProducts());
        $top['is_top'] = false;
        $this->admin->save('products', $top, $top['id']);
        self::assertSame('', $renderer->topProducts());
        $this->expectException(CommerceException::class);
        $this->product(['is_top' => 'false']);
    }
    public function testPrimaryImageIsExplicitAndPrecedesAdditionalImages(): void
    {
        $product = $this->product(['images' => [1, 2], 'primary_image_id' => 2]);
        self::assertSame(2, $product['primary_image_id']);
        self::assertSame([2, 1], $product['images']);
        self::assertSame([2, 1], array_column($this->public->product($product['slug'])['images'], 'id'));
        $product['primary_image_id'] = null;
        $product['images'] = [1];
        $updated = $this->admin->save('products', $product, $product['id']);
        self::assertNull($updated['primary_image_id']);
        self::assertSame([1], $updated['images']);
        $this->expectException(CommerceException::class);
        $this->product(['images' => [1], 'primary_image_id' => 2]);
    }
    public function testInvalidSalePriceIsRejected(): void
    {
        foreach (['20.00', '21.00', '-1', '1.234'] as $price) {
            try { $this->product(['price' => '20.00', 'sale_price' => $price]); self::fail('Invalid sale accepted'); }
            catch (CommerceException $e) { self::assertSame(422, $e->getCode()); }
        }
    }
    public function testCatalogueEmbedsOnlyInContentAndKeepsStoredText(): void
    {
        $this->product(['name' => 'Visible gift']);
        $this->product(['name' => 'Hidden gift', 'status' => 'draft']);
        $renderer = new \Flex\Commerce\CatalogEmbedRenderer($this->public);
        $assets = new class implements \Flex\Extension\V1\PublicAssetRegistrarInterface {
            /** @var list<string> */
            public array $groups = [];
            public function enqueue(string $group): void { $this->groups[] = $group; }
            public function enqueueWhen(string $group, callable $condition): void {}
        };
        \Flex\Commerce\CommerceAssets::use($assets);
        self::assertSame('<p>Plain content</p>', $renderer->content('<p>Plain content</p>'));
        self::assertSame([], $assets->groups, 'pages without a catalogue do not load the storefront');
        $input = '<p>Introduction</p><p>[commerce_catalog]</p><pre>[commerce_catalog]</pre>';
        $output = $renderer->content($input);
        self::assertSame(['storefront'], $assets->groups);
        self::assertStringNotContainsString('storefront.js', $output, 'the storefront files come with the page tags, not the content');
        \Flex\Commerce\CommerceAssets::use(null);
        self::assertStringContainsString('Visible gift', $output);
        self::assertStringNotContainsString('Hidden gift', $output);
        self::assertStringContainsString('<pre>[commerce_catalog]</pre>', $output);
        self::assertStringNotContainsString('<p><div', $output);
        self::assertSame('<p>Plain content</p>', $renderer->content('<p>Plain content</p>'));
    }
    public function testOnlyActiveNonTrashedProductsAndCategoriesArePublic(): void
    {
        $visible = $this->product();
        $draft = $this->product(['status' => 'draft']);
        $inactive = $this->product(['status' => 'inactive']);
        $trashed = $this->product(); $this->admin->action('products', $trashed['id'], 'trash', 1);
        $this->admin->save('categories', ['name' => 'Hidden', 'status' => 'draft']);
        $activeCategory = $this->admin->save('categories', ['name' => 'Active', 'status' => 'active']);
        self::assertSame([$visible['id']], array_column($this->public->listing()['products'], 'id'));
        self::assertSame([$activeCategory['id']], array_column($this->public->categories(), 'id'));
        foreach ([$draft, $inactive, $trashed] as $hidden) {
            try { $this->public->product($hidden['slug']); self::fail('Hidden product exposed'); }
            catch (CommerceException $e) { self::assertSame(404, $e->getCode()); }
        }
        self::assertArrayNotHasKey('version', $this->public->product($visible['slug']));
    }
    public function testCategorySearchAndAvailabilityFilters(): void
    {
        $category = $this->admin->save('categories', ['name' => 'Office', 'status' => 'active']);
        $match = $this->product(['name' => 'Notebook 100% handmade', 'category_ids' => [$category['id']], 'currency' => 'USD']);
        $this->product(['name' => 'Notebook 1000 handmade', 'category_ids' => [$category['id']], 'currency' => 'USD', 'stock' => 0]);
        $this->product(['name' => 'Other', 'currency' => 'EUR']);
        $result = $this->public->listing(['q' => '100%', 'currency' => 'USD', 'stock' => '1'], $category['slug']);
        self::assertSame([$match['id']], array_column($result['products'], 'id'));
        self::assertSame(1, $result['total']);
        self::assertSame(2, $this->public->listing([], $category['slug'])['total']);
        self::assertSame(0, $this->public->listing(['q' => "' OR 1=1 --"])['total']);
    }
    public function testSaleAndPriceRangeFilters(): void
    {
        $sale = $this->product(['name' => 'Promo', 'price' => '20.00', 'sale_price' => '8.00']);
        $mid = $this->product(['name' => 'Mid', 'price' => '15.00']);
        $high = $this->product(['name' => 'High', 'price' => '40.00']);
        $saleOnly = $this->public->listing(['sale' => '1']);
        self::assertSame([$sale['id']], array_column($saleOnly['products'], 'id'));
        self::assertSame('1', $saleOnly['filters']['sale']);
        $range = $this->public->listing(['min_price' => '10', 'max_price' => '16']);
        self::assertSame([$mid['id']], array_column($range['products'], 'id'));
        self::assertSame('10.00', $range['filters']['min_price']);
        self::assertSame('16.00', $range['filters']['max_price']);
        self::assertSame('8.00', $range['price_bounds']['min']);
        self::assertSame('40.00', $range['price_bounds']['max']);
        try {
            $this->public->listing(['min_price' => '20', 'max_price' => '10']);
            self::fail('Inverted price range accepted');
        } catch (CommerceException $e) {
            self::assertSame(422, $e->getCode());
        }
        foreach ([['sale' => 'yes'], ['min_price' => '1.234'], ['max_price' => '-1']] as $filters) {
            try {
                $this->public->listing($filters);
                self::fail('Invalid filter accepted');
            } catch (CommerceException $e) {
                self::assertSame(422, $e->getCode());
            }
        }
        self::assertSame(3, $this->public->listing(['min_price' => '', 'max_price' => '', 'sale' => ''])['total']);
    }
    public function testPaginationHasStableOrderingAndMissingPagesReturn404(): void
    {
        for ($i = 0; $i < 15; $i++) $this->product(['name' => 'Item ' . $i]);
        $first = $this->public->listing(); $second = $this->public->listing(['page' => '2']);
        self::assertSame(15, $first['total']); self::assertSame(2, $first['pages']);
        self::assertSame(1, $first['from']); self::assertSame(12, $first['to']);
        self::assertSame(13, $second['from']); self::assertSame(15, $second['to']);
        self::assertCount(12, $first['products']); self::assertCount(3, $second['products']);
        self::assertSame([], array_intersect(array_column($first['products'], 'id'), array_column($second['products'], 'id')));
        $first += ['base_url' => '/catalog', 'page_urls' => [1 => '/catalog', 2 => '/catalog?page=2'], 'first_url' => '/catalog', 'last_url' => '/catalog?page=2', 'previous_url' => '/catalog', 'next_url' => '/catalog?page=2'];
        $twig = new \Twig\Environment(new \Twig\Loader\FilesystemLoader(__DIR__ . '/../templates'), ['strict_variables' => true, 'autoescape' => 'html']);
        $html = $twig->render('catalog.twig', $first);
        self::assertStringContainsString('commerce-pagination', $html);
        self::assertStringContainsString('Страница 1 от 2', $html);
        self::assertStringContainsString('Показани 1–12 от 15', $html);
        self::assertStringContainsString('aria-current="page"', $html);
        $this->expectException(CommerceException::class); $this->public->listing(['page' => 3]);
    }
    public function testMediaOrderLocalTextAndDeletedImages(): void
    {
        $p = $this->product(['images' => [2, 1], 'image_details' => [2 => ['alt' => 'Only this product', 'title' => '']]]);
        $record = $this->public->product($p['slug']);
        self::assertSame([2, 1], array_column($record['images'], 'id'));
        self::assertSame('Only this product', $record['images'][0]['alt']);
        self::assertSame('', $record['images'][0]['title']);
        self::assertSame('/media-files/1/thumbnail', $record['images'][1]['thumbnail_url']);
        $this->db->connection()->table('media')->where('id', 2)->update(['deleted_at' => gmdate('Y-m-d H:i:s')]);
        self::assertSame([1], array_column($this->public->product($p['slug'])['images'], 'id'));
    }
    public function testInvalidParametersAreRejected(): void
    {
        foreach ([['q' => []], ['sort' => 'DROP TABLE'], ['page' => 0], ['stock' => []]] as $filters) {
            try { $this->public->listing($filters); self::fail('Invalid query accepted'); }
            catch (CommerceException $e) { self::assertSame(422, $e->getCode()); }
        }
        $this->expectException(CommerceException::class); $this->public->category('unknown');
    }
    public function testPriceSortingStaysWithinCurrenciesAndTemplateEscapesNames(): void
    {
        $cheap = $this->product(['name' => '<script>alert(1)</script>', 'price' => '1.01']);
        $expensive = $this->product(['price' => '100.00']);
        $usd = $this->product(['price' => '0.01', 'currency' => 'USD']);
        $data = $this->public->listing(['sort' => 'price_asc', 'currency' => 'EUR']);
        self::assertSame([$cheap['id'], $expensive['id'], $usd['id']], array_column($data['products'], 'id'));
        self::assertArrayNotHasKey('currency', $data['filters']);
        $data += ['base_url' => '/catalog', 'page_urls' => [], 'first_url' => '/catalog', 'last_url' => '/catalog', 'previous_url' => '/catalog', 'next_url' => '/catalog'];
        $twig = new \Twig\Environment(new \Twig\Loader\FilesystemLoader(__DIR__ . '/../templates'), ['strict_variables' => true, 'autoescape' => 'html']);
        $html = $twig->render('catalog.twig', $data);
        self::assertStringNotContainsString('name="currency"', $html);
        self::assertStringNotContainsString('Приложи', $html);
        self::assertStringContainsString('data-commerce-live-filters', $html);
        self::assertStringContainsString('name="min_price"', $html);
        self::assertStringContainsString('name="sale"', $html);
        self::assertStringContainsString('flex-checkbox', $html);
        self::assertStringContainsString('flex-checkbox__control', $html);
        self::assertStringNotContainsString('<script>alert', $html);
        self::assertStringContainsString('&lt;script&gt;alert(1)&lt;/script&gt;', $html);
    }
    public function testCartChecksCumulativeQuantityAndCurrentStock(): void
    {
        $product = $this->product(['stock' => 3]);
        $store = new \Flex\Commerce\CartStore($this->db->connection());
        $cart = $store->add([], $product['id'], 2);
        self::assertSame(2, $store->summary($cart)['count']);
        self::assertSame(1, $store->summary($cart)['items'][0]['remaining']);
        try {
            $store->add($cart, $product['id'], 2);
            self::fail('Cumulative stock must be enforced.');
        } catch (CommerceException $error) { self::assertSame(409, $error->getCode()); }
        $cart = $store->add($cart, $product['id'], 1);
        self::assertSame(3, $cart[$product['id']]);
        $this->db->connection()->table('flex_commerce_products')->where('id', $product['id'])->update(['stock' => 1]);
        self::assertSame(1, $store->summary($cart)['count']);
        $this->db->connection()->table('flex_commerce_products')->where('id', $product['id'])->update(['status' => 'inactive']);
        self::assertSame([], $store->summary($cart)['items']);
        $this->expectException(CommerceException::class);
        $store->add([], $product['id'], 1);
    }
    public function testCartRejectsInvalidQuantitiesAndUnavailableProducts(): void
    {
        $product = $this->product();
        $store = new \Flex\Commerce\CartStore($this->db->connection());
        foreach ([0, -1, '1.5', 1.5, true, [], 'abc', 1000001] as $quantity) {
            try { $store->add([], $product['id'], $quantity); self::fail('Invalid quantity accepted.'); }
            catch (CommerceException $error) { self::assertSame(422, $error->getCode()); }
        }
        $this->db->connection()->table('flex_commerce_products')->where('id', $product['id'])->update(['stock' => 0]);
        self::assertSame(0, $store->stock($product['id']));
        $this->expectException(CommerceException::class);
        $store->add([], $product['id'], 1);
    }
    public function testCartEditsQuantitiesAndCalculatesTotalsPerCurrency(): void
    {
        $first = $this->product(['name' => 'First', 'price' => '0.10', 'stock' => 10, 'currency' => 'EUR', 'images' => [1]]);
        $second = $this->product(['name' => 'Second', 'price' => '2.35', 'stock' => 10, 'currency' => 'USD']);
        $store = new \Flex\Commerce\CartStore($this->db->connection());
        $cart = $store->add([], $first['id'], 1);
        $cart = $store->add($cart, $second['id'], 2);
        $cart = $store->setQuantity($cart, $first['id'], 3);
        $summary = $store->summary($cart);
        self::assertSame(5, $summary['count']);
        self::assertSame([['currency' => 'EUR', 'amount_minor' => 30, 'amount' => '0,30'], ['currency' => 'USD', 'amount_minor' => 470, 'amount' => '4,70']], $summary['totals']);
        self::assertSame('/media-files/1/thumbnail', $summary['items'][0]['image']);
        self::assertSame('0,30', $summary['items'][0]['line_total']);
        self::assertSame(10, $summary['items'][0]['stock']);
        $cart = $store->setQuantity($cart, $first['id'], 1);
        self::assertSame(1, $cart[$first['id']]);
        foreach ([0, -1, 1.5, [], 11] as $quantity) {
            try { $store->setQuantity($cart, $first['id'], $quantity); self::fail('Invalid replacement quantity accepted.'); }
            catch (CommerceException $error) { self::assertContains($error->getCode(), [422, 409]); }
        }
        $this->db->connection()->table('flex_commerce_products')->where('id', $first['id'])->update(['price_minor' => 125]);
        self::assertSame('1,25', $store->summary($cart)['totals'][0]['amount']);
        unset($cart[$first['id']], $cart[$second['id']]);
        self::assertSame(['items' => [], 'count' => 0, 'totals' => []], $store->summary($cart));
    }
}
